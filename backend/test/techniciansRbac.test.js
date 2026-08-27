process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { createFixtureScope } = require("./helpers/fixtures");
const technicianRoutes = require("../src/routes/technicians");

let server;
let baseUrl;
let fixtures;
let superAdmin;
let admin;
let employee;
let technician;
let otherBranchId;

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
  fixtures = createFixtureScope();
  const seeded = await fixtures.seedRbacSet(
    ["SuperAdmin", "Admin", "Employee", "Technician"],
    { label: "Technicians RBAC" }
  );
  ({ superadmin: superAdmin, admin, employee, technician } = seeded.users);
  otherBranchId = seeded.otherBranchId;

  const app = express();
  app.use(express.json());
  app.use("/api/v1/technicians", technicianRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixtures) await fixtures.cleanup();
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
