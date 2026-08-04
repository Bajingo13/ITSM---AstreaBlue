process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const cmdbRoutes = require("../src/routes/cmdb");

const secret = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
let server;
let baseUrl;
let superAdmin;
let admin;
let nonAdmin;
let otherBranch;
let ownCi;
let otherCi;

function tokenFor(user, overrides = {}) {
  return jwt.sign(
    {
      userId: user.user_id,
      role: overrides.role || user.role_name,
      branchId: overrides.branchId === undefined ? user.branch_id : overrides.branchId,
    },
    secret,
    { expiresIn: "5m" }
  );
}

test.before(async () => {
  superAdmin = (await db.query(`
    SELECT u.user_id,u.branch_id,r.role_name
      FROM users u JOIN system_roles r ON r.role_id=u.role_id
     WHERE LOWER(r.role_name)='superadmin' AND COALESCE(u.is_active,TRUE)=TRUE
       AND LOWER(COALESCE(u.status,'Active')) NOT IN ('inactive','disabled','deactivated')
     ORDER BY u.user_id LIMIT 1`)).rows[0];
  admin = (await db.query(`
    SELECT u.user_id,u.branch_id,r.role_name
      FROM users u JOIN system_roles r ON r.role_id=u.role_id
     WHERE LOWER(r.role_name)='admin' AND u.branch_id IS NOT NULL
       AND COALESCE(u.is_active,TRUE)=TRUE
       AND LOWER(COALESCE(u.status,'Active')) NOT IN ('inactive','disabled','deactivated')
     ORDER BY u.user_id LIMIT 1`)).rows[0];
  nonAdmin = (await db.query(`
    SELECT u.user_id,u.branch_id,r.role_name
      FROM users u JOIN system_roles r ON r.role_id=u.role_id
     WHERE LOWER(r.role_name) IN ('employee','technician','hr')
       AND COALESCE(u.is_active,TRUE)=TRUE
       AND LOWER(COALESCE(u.status,'Active')) NOT IN ('inactive','disabled','deactivated')
     ORDER BY u.user_id LIMIT 1`)).rows[0];
  assert.ok(superAdmin, "CMDB RBAC tests require an active SuperAdmin");
  assert.ok(admin, "CMDB RBAC tests require an active branch Admin");
  assert.ok(nonAdmin, "CMDB RBAC tests require an active non-admin user");

  otherBranch = (await db.query(
    `SELECT branch_id FROM branches WHERE branch_id <> $1 ORDER BY branch_id LIMIT 1`,
    [admin.branch_id]
  )).rows[0];
  assert.ok(otherBranch, "CMDB RBAC tests require a second branch");

  const stamp = `${Date.now()}-${process.pid}`;
  ownCi = (await db.query(
    `INSERT INTO config_items (ci_name,ci_type,branch_id,environment,status)
     VALUES ($1,'Application',$2,'Testing','Active') RETURNING ci_id,branch_id`,
    [`QA-CMDB-OWN-${stamp}`, admin.branch_id]
  )).rows[0];
  otherCi = (await db.query(
    `INSERT INTO config_items (ci_name,ci_type,branch_id,environment,status)
     VALUES ($1,'Application',$2,'Testing','Active') RETURNING ci_id,branch_id`,
    [`QA-CMDB-OTHER-${stamp}`, otherBranch.branch_id]
  )).rows[0];

  const app = express();
  app.use(express.json());
  app.use("/api/v1/cmdb", cmdbRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (ownCi || otherCi) {
    await db.query(`DELETE FROM ci_dependencies WHERE source_ci_id = ANY($1::int[]) OR target_ci_id = ANY($1::int[])`, [
      [ownCi?.ci_id, otherCi?.ci_id].filter(Boolean),
    ]);
    await db.query(`DELETE FROM config_items WHERE ci_id = ANY($1::int[])`, [
      [ownCi?.ci_id, otherCi?.ci_id].filter(Boolean),
    ]);
  }
  await db.rawPool.end();
});

test("CMDB rejects unauthenticated and non-administrative callers", async () => {
  const unauthenticated = await fetch(`${baseUrl}/api/v1/cmdb/config-items?role_name=SuperAdmin`);
  assert.equal(unauthenticated.status, 401);

  const denied = await fetch(`${baseUrl}/api/v1/cmdb/config-items?role_name=SuperAdmin`, {
    headers: { authorization: `Bearer ${tokenFor(nonAdmin, { role: "SuperAdmin" })}` },
  });
  assert.equal(denied.status, 403);
});

test("SuperAdmin can read configuration items across branches", async () => {
  const response = await fetch(`${baseUrl}/api/v1/cmdb/config-items`, {
    headers: { authorization: `Bearer ${tokenFor(superAdmin)}` },
  });
  assert.equal(response.status, 200);
  const rows = await response.json();
  assert.ok(rows.some((row) => Number(row.ci_id) === Number(ownCi.ci_id)));
  assert.ok(rows.some((row) => Number(row.ci_id) === Number(otherCi.ci_id)));
});

test("Admin identity comes from the database and cannot be elevated with query parameters", async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/cmdb/config-items?role_name=SuperAdmin&branch_id=${otherBranch.branch_id}`,
    { headers: { authorization: `Bearer ${tokenFor(admin, { role: "SuperAdmin", branchId: otherBranch.branch_id })}` } }
  );
  assert.equal(response.status, 200);
  const rows = await response.json();
  assert.ok(rows.some((row) => Number(row.ci_id) === Number(ownCi.ci_id)));
  assert.ok(!rows.some((row) => Number(row.ci_id) === Number(otherCi.ci_id)));

  const hidden = await fetch(`${baseUrl}/api/v1/cmdb/config-items/${otherCi.ci_id}?role_name=SuperAdmin`, {
    headers: { authorization: `Bearer ${tokenFor(admin, { role: "SuperAdmin" })}` },
  });
  assert.equal(hidden.status, 404);
});

test("Admin cannot create, update, or delete configuration items outside the assigned branch", async () => {
  const headers = {
    authorization: `Bearer ${tokenFor(admin, { role: "SuperAdmin" })}`,
    "content-type": "application/json",
  };
  const create = await fetch(`${baseUrl}/api/v1/cmdb/config-items?role_name=SuperAdmin`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ci_name: "QA forbidden CI", ci_type: "Server", branch_id: otherBranch.branch_id }),
  });
  assert.equal(create.status, 403);

  const update = await fetch(`${baseUrl}/api/v1/cmdb/config-items/${otherCi.ci_id}?role_name=SuperAdmin`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ ci_name: "QA forbidden update" }),
  });
  assert.equal(update.status, 403);

  const remove = await fetch(`${baseUrl}/api/v1/cmdb/config-items/${otherCi.ci_id}?role_name=SuperAdmin`, {
    method: "DELETE",
    headers,
  });
  assert.equal(remove.status, 403);
});

test("Admin can create a configuration item in the assigned branch", async () => {
  const response = await fetch(`${baseUrl}/api/v1/cmdb/config-items`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokenFor(admin)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ci_name: `QA-CMDB-CREATED-${Date.now()}`,
      ci_type: "Server",
      branch_id: admin.branch_id,
      environment: "Testing",
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(Number(body.data.branch_id), Number(admin.branch_id));
  await db.query(`DELETE FROM config_items WHERE ci_id=$1`, [body.data.ci_id]);
});
