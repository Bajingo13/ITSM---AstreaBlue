process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const analyticsCenterRoutes = require("../src/routes/analyticsCenter");

let server;
let baseUrl;
let branchId;
let superAdminUser;
let adminUser;
let technicianUser;

const tokenFor = (user, claimedRole = null) => jwt.sign(
  { userId: user.user_id, role: claimedRole || user.role_name, branchId: user.branch_id },
  process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod",
  { expiresIn: "5m" }
);

test.before(async () => {
  branchId = (await db.query("SELECT branch_id FROM branches ORDER BY branch_id LIMIT 1")).rows[0]?.branch_id;
  assert.ok(branchId, "analytics tests require at least one branch");
  const users = await db.query(`
    SELECT u.user_id,u.branch_id,r.role_name
      FROM users u JOIN system_roles r ON r.role_id=u.role_id
     WHERE COALESCE(u.is_active,TRUE)=TRUE
       AND LOWER(COALESCE(u.status,'Active')) NOT IN ('inactive','disabled','deactivated')
       AND LOWER(r.role_name) IN ('superadmin','admin','technician')
     ORDER BY u.user_id`);
  superAdminUser = users.rows.find((user) => String(user.role_name).toLowerCase() === "superadmin");
  adminUser = users.rows.find((user) => String(user.role_name).toLowerCase() === "admin" && user.branch_id);
  technicianUser = users.rows.find((user) => String(user.role_name).toLowerCase() === "technician" && user.branch_id);
  assert.ok(superAdminUser && adminUser && technicianUser, "analytics tests require active SuperAdmin, Admin, and Technician users");
  branchId = adminUser.branch_id;
  const app = express();
  app.use("/api/v1/analytics", analyticsCenterRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.rawPool.end();
});

test("enterprise summary enforces authentication and returns complete manager analytics", async () => {
  assert.equal((await fetch(`${baseUrl}/api/v1/analytics/summary`)).status, 401);

  const response = await fetch(`${baseUrl}/api/v1/analytics/summary`, {
    headers: { authorization: `Bearer ${tokenFor(superAdminUser)}` },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  for (const section of ["service_desk", "problems", "assets", "endpoints", "sla", "knowledge", "compliance", "resources", "projects", "replacements"]) {
    assert.ok(Object.hasOwn(body.data, section), `missing ${section}`);
  }
  assert.equal(body.data.replacements.available, true);
  assert.ok(Object.hasOwn(body.data.replacements, "awaiting_approval"));
});

test("technicians cannot access reporting and analytics", async () => {
  const headers = { authorization: `Bearer ${tokenFor(technicianUser)}` };
  const response = await fetch(`${baseUrl}/api/v1/analytics/summary`, { headers });
  assert.equal(response.status, 403);
  assert.match((await response.json()).message, /administrators/i);
  assert.equal((await fetch(`${baseUrl}/api/v1/analytics/custom-report`, { headers })).status, 403);
});

test("administrators can generate branch-scoped reports and TXT exports", async () => {
  const headers = { authorization: `Bearer ${tokenFor(adminUser)}` };
  const optionResponse = await fetch(`${baseUrl}/api/v1/analytics/report-options`, { headers });
  assert.equal(optionResponse.status, 200);
  const options = (await optionResponse.json()).data;
  assert.equal(options.branches.length, 1);
  assert.equal(String(options.branches[0].branch_id), String(branchId));
  assert.ok(Array.isArray(options.categories));
  assert.ok(Array.isArray(options.technicians));

  const report = await fetch(`${baseUrl}/api/v1/analytics/custom-report`, { headers });
  assert.equal(report.status, 200);
  assert.ok(Array.isArray((await report.json()).data));

  const textExport = await fetch(`${baseUrl}/api/v1/analytics/custom-report/export?format=txt`, { headers });
  assert.equal(textExport.status, 200);
  assert.match(textExport.headers.get("content-type") || "", /text\/plain/);
  assert.match(await textExport.text(), /CUSTOM SERVICE DESK REPORT/);
});
