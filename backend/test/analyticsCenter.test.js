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

const tokenFor = (role, branch = null) => jwt.sign(
  { userId: 1, role, branchId: branch },
  process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod",
  { expiresIn: "5m" }
);

test.before(async () => {
  branchId = (await db.query("SELECT branch_id FROM branches ORDER BY branch_id LIMIT 1")).rows[0]?.branch_id;
  assert.ok(branchId, "analytics tests require at least one branch");
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
    headers: { authorization: `Bearer ${tokenFor("SuperAdmin")}` },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  for (const section of ["service_desk", "problems", "assets", "endpoints", "sla", "knowledge", "compliance", "resources", "projects", "change"]) {
    assert.ok(Object.hasOwn(body.data, section), `missing ${section}`);
  }
  assert.equal(body.data.change.available, true);
  assert.ok(Object.hasOwn(body.data.change, "cab_queue"));
});

test("technicians cannot access reporting and analytics", async () => {
  const headers = { authorization: `Bearer ${tokenFor("Technician", branchId)}` };
  const response = await fetch(`${baseUrl}/api/v1/analytics/summary`, { headers });
  assert.equal(response.status, 403);
  assert.match((await response.json()).message, /administrators/i);
  assert.equal((await fetch(`${baseUrl}/api/v1/analytics/custom-report`, { headers })).status, 403);
});

test("administrators can generate branch-scoped reports and CSV exports", async () => {
  const headers = { authorization: `Bearer ${tokenFor("Admin", branchId)}` };
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

  const csv = await fetch(`${baseUrl}/api/v1/analytics/custom-report/export?format=csv`, { headers });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type") || "", /text\/csv/);
  assert.match(await csv.text(), /^ticket_number,title,priority,status/);
});
