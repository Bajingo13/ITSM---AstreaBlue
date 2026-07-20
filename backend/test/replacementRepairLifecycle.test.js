process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const replacementRoutes = require("../src/routes/replacementRequests");

const app = express();
app.use(express.json());
app.use("/api/v1/replacement-requests", replacementRoutes);

let server;
let baseUrl;
let employee;
let superAdmin;
let assetId;
let requestId;

function tokenFor(user, role) {
  return jwt.sign(
    { userId: user.user_id, role, branchId: user.branch_id || null },
    process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod",
    { expiresIn: "5m" }
  );
}

async function transition(status, body = {}) {
  const response = await fetch(`${baseUrl}/api/v1/replacement-requests/${requestId}/status`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${tokenFor(superAdmin, "SuperAdmin")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ status, ...body }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, payload.message || JSON.stringify(payload));
  return payload.data;
}

test.before(async () => {
  employee = (await db.query(`
    SELECT u.user_id,u.full_name,u.branch_id
    FROM users u JOIN system_roles r ON r.role_id=u.role_id
    WHERE LOWER(r.role_name)='employee' AND u.branch_id IS NOT NULL
    ORDER BY u.user_id LIMIT 1
  `)).rows[0];
  superAdmin = (await db.query(`
    SELECT u.user_id,u.branch_id
    FROM users u JOIN system_roles r ON r.role_id=u.role_id
    WHERE LOWER(r.role_name)='superadmin'
    ORDER BY u.user_id LIMIT 1
  `)).rows[0];
  assert.ok(employee && superAdmin, "Replacement lifecycle QA requires an employee and SuperAdmin.");

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const asset = await db.query(`
    INSERT INTO hardware_assets
      (serial_number,brand,asset_name,asset_type,status,branch_id,employee_id,assigned_name)
    VALUES($1,'AstreaBlue QA','Repair Lifecycle Laptop','Laptop','In Use',$2,$3,$4)
    RETURNING asset_id
  `, [`QA-REPAIR-${suffix}`, employee.branch_id, employee.user_id, employee.full_name]);
  assetId = asset.rows[0].asset_id;

  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (requestId) await db.query("DELETE FROM replacement_requests WHERE id=$1", [requestId]);
  if (assetId) {
    await db.query("DELETE FROM asset_history WHERE asset_id=$1", [assetId]);
    await db.query("DELETE FROM hardware_assets WHERE asset_id=$1", [assetId]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.rawPool.end();
});

test("repair lifecycle restores an assigned laptop to its pre-repair In Use status", async () => {
  const createResponse = await fetch(`${baseUrl}/api/v1/replacement-requests`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokenFor(employee, "Employee")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      current_asset_id: assetId,
      title: "QA repair lifecycle",
      description: "Validate status preservation from assessment through completed repair.",
      damage_type: "Hardware",
      urgency: "Medium",
    }),
  });
  const created = await createResponse.json();
  assert.equal(createResponse.status, 201, created.message || JSON.stringify(created));
  requestId = created.data.id;

  await transition("Under Assessment");
  await transition("Repair Recommended", {
    diagnosis: "Replaceable power component failure.",
    recommendation: "Repair the existing assigned laptop.",
  });
  await transition("In Repair");

  let request = (await db.query(
    "SELECT status,pre_repair_asset_status FROM replacement_requests WHERE id=$1",
    [requestId]
  )).rows[0];
  let asset = (await db.query("SELECT status,condition_after FROM hardware_assets WHERE asset_id=$1", [assetId])).rows[0];
  assert.deepEqual(request, { status: "In Repair", pre_repair_asset_status: "In Use" });
  assert.equal(asset.status, "In Repair");
  assert.equal(asset.condition_after, "Needs Repair");

  await transition("Repaired", { repair_resolution: "Power component replaced and diagnostics passed." });

  request = (await db.query(
    "SELECT status,pre_repair_asset_status FROM replacement_requests WHERE id=$1",
    [requestId]
  )).rows[0];
  asset = (await db.query("SELECT status,condition_after,notes FROM hardware_assets WHERE asset_id=$1", [assetId])).rows[0];
  assert.deepEqual(request, { status: "Repaired", pre_repair_asset_status: "In Use" });
  assert.equal(asset.status, "In Use");
  assert.equal(asset.condition_after, "Working");
  assert.match(asset.notes, /Power component replaced and diagnostics passed/);
});
