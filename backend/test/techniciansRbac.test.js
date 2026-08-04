process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const technicianRoutes = require("../src/routes/technicians");

let server;
let baseUrl;
let superAdmin;
let admin;
let employee;
let technician;
let otherBranchId;
let fixtureTechnicianId;

const tokenFor = (user, overrides = {}) => jwt.sign(
  {
    userId: user.user_id,
    role: overrides.role || user.role_name,
    branchId: overrides.branchId ?? user.branch_id,
  },
  process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod",
  { expiresIn: "5m" }
);

test.before(async () => {
  const users = (await db.query(
    `SELECT u.user_id,u.branch_id,r.role_name
       FROM users u JOIN system_roles r ON r.role_id=u.role_id
      WHERE COALESCE(u.is_active,TRUE)=TRUE
        AND LOWER(COALESCE(u.status,'Active')) NOT IN ('inactive','disabled','deactivated')
      ORDER BY u.user_id`
  )).rows;
  superAdmin = users.find((user) => String(user.role_name).toLowerCase() === "superadmin");
  admin = users.find((user) => String(user.role_name).toLowerCase() === "admin" && user.branch_id);
  employee = users.find((user) => String(user.role_name).toLowerCase() === "employee" && user.branch_id);
  assert.ok(superAdmin && admin && employee, "technician RBAC tests require active SuperAdmin, Admin, and Employee users");

  otherBranchId = (await db.query(
    "SELECT branch_id FROM branches WHERE branch_id<>$1 ORDER BY branch_id LIMIT 1",
    [admin.branch_id]
  )).rows[0]?.branch_id;
  assert.ok(otherBranchId, "technician RBAC tests require at least two branches");

  technician = users.find(
    (user) => String(user.role_name).toLowerCase() === "technician" && Number(user.branch_id) === Number(admin.branch_id)
  );
  if (!technician) {
    const roleId = (await db.query("SELECT role_id FROM system_roles WHERE LOWER(role_name)='technician' LIMIT 1")).rows[0].role_id;
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    technician = (await db.query(
      `INSERT INTO users (full_name,email,password_hash,role_id,branch_id,company_name,status,is_active)
       VALUES ($1,$2,'test-only',$3,$4,'AstreaBlue QA','Active',TRUE)
       RETURNING user_id,branch_id`,
      [`QA Technician ${suffix}`, `qa-tech-${suffix}@example.invalid`, roleId, admin.branch_id]
    )).rows[0];
    technician.role_name = "Technician";
    fixtureTechnicianId = technician.user_id;
  }

  const app = express();
  app.use(express.json());
  app.use("/api/v1/technicians", technicianRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixtureTechnicianId) await db.query("DELETE FROM users WHERE user_id=$1", [fixtureTechnicianId]);
  await db.rawPool.end();
});

test("technician directory rejects anonymous and Employee callers", async () => {
  assert.equal((await fetch(`${baseUrl}/api/v1/technicians`)).status, 401);
  const response = await fetch(
    `${baseUrl}/api/v1/technicians?role_name=SuperAdmin&branch_id=${admin.branch_id}`,
    { headers: { authorization: `Bearer ${tokenFor(employee, { role: "SuperAdmin" })}` } }
  );
  assert.equal(response.status, 403);
});

test("Admin identity and branch come from the database, not forged query or token claims", async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/technicians?role_name=SuperAdmin&branch_id=${otherBranchId}`,
    { headers: { authorization: `Bearer ${tokenFor(admin, { role: "SuperAdmin", branchId: otherBranchId })}` } }
  );
  assert.equal(response.status, 200);
  const rows = await response.json();
  assert.ok(rows.some((row) => Number(row.user_id) === Number(technician.user_id)));
  assert.ok(rows.every((row) => Number(row.branch_id) === Number(admin.branch_id)));
});

test("Technicians can only retrieve their own assignment option", async () => {
  const response = await fetch(`${baseUrl}/api/v1/technicians`, {
    headers: { authorization: `Bearer ${tokenFor(technician)}` },
  });
  assert.equal(response.status, 200);
  const rows = await response.json();
  assert.deepEqual(rows.map((row) => Number(row.user_id)), [Number(technician.user_id)]);
});

test("SuperAdmin can scope assignment options to a selected branch", async () => {
  const response = await fetch(`${baseUrl}/api/v1/technicians?branch_id=${admin.branch_id}`, {
    headers: { authorization: `Bearer ${tokenFor(superAdmin)}` },
  });
  assert.equal(response.status, 200);
  const rows = await response.json();
  assert.ok(rows.some((row) => Number(row.user_id) === Number(technician.user_id)));
  assert.ok(rows.every((row) => Number(row.branch_id) === Number(admin.branch_id)));
});
