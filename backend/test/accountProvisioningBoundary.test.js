process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const userRoutes = require("../src/routes/users");
const inviteRoutes = require("../src/routes/invites");

const secret = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
let server;
let baseUrl;
let superAdminId;
let employeeRoleId;
let branchId;

function authHeaders() {
  const token = jwt.sign(
    { userId: superAdminId, role: "SuperAdmin", branchId: null },
    secret,
    { expiresIn: "5m" }
  );
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

test.before(async () => {
  const [superAdmin, employeeRole, branch] = await Promise.all([
    db.query(`SELECT u.user_id FROM users u JOIN system_roles r ON r.role_id=u.role_id WHERE LOWER(r.role_name)='superadmin' LIMIT 1`),
    db.query(`SELECT role_id FROM system_roles WHERE LOWER(role_name)='employee' LIMIT 1`),
    db.query(`SELECT branch_id FROM branches ORDER BY branch_id LIMIT 1`),
  ]);
  superAdminId = superAdmin.rows[0]?.user_id;
  employeeRoleId = employeeRole.rows[0]?.role_id;
  branchId = branch.rows[0]?.branch_id;
  assert.ok(superAdminId && employeeRoleId && branchId);

  const app = express();
  app.use(express.json());
  app.use("/api/v1/users", userRoutes);
  app.use("/api/v1/invites", inviteRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.rawPool.end();
});

test("direct user creation cannot bypass Employee Lifecycle onboarding", async () => {
  const response = await fetch(`${baseUrl}/api/v1/users`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      full_name: "Boundary Test Employee",
      email: `boundary-direct-${Date.now()}@example.test`,
      password: "Password1",
      role_id: employeeRoleId,
      branch_id: branchId,
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.match(payload.error, /Employee Lifecycle onboarding/i);
});

test("generic invitations cannot bypass the lifecycle Employee invitation", async () => {
  const suffix = Date.now();
  const response = await fetch(`${baseUrl}/api/v1/invites`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      full_name: "Boundary Invite Employee",
      personal_email: `boundary-personal-${suffix}@example.test`,
      company_email: `boundary-company-${suffix}@example.test`,
      role_id: employeeRoleId,
      branch_id: branchId,
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.match(payload.error, /Employee Lifecycle onboarding/i);
});
