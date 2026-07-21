process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const projectAnalyticsRoutes = require("../src/routes/projectAnalytics");

let server;
let baseUrl;
let superAdmin;

test.before(async () => {
  superAdmin = (await db.query(`
    SELECT u.user_id,u.branch_id,r.role_name
      FROM users u JOIN system_roles r ON r.role_id=u.role_id
     WHERE LOWER(r.role_name)='superadmin' AND COALESCE(u.is_active,TRUE)=TRUE
       AND LOWER(COALESCE(u.status,'Active')) NOT IN ('inactive','disabled','deactivated')
     ORDER BY u.user_id LIMIT 1`)).rows[0];
  assert.ok(superAdmin, "project analytics tests require an active SuperAdmin");
  const app = express();
  app.use("/api/v1/projects", projectAnalyticsRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.rawPool.end();
});

test("project analytics dashboard is authenticated, complete, and cacheable", async () => {
  const unauthorized = await fetch(`${baseUrl}/api/v1/projects/dashboard`);
  assert.equal(unauthorized.status, 401);

  const token = jwt.sign(
    { userId: superAdmin.user_id, role: "SuperAdmin", branchId: superAdmin.branch_id || null },
    process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod",
    { expiresIn: "5m" }
  );
  const headers = { authorization: `Bearer ${token}` };
  const first = await fetch(`${baseUrl}/api/v1/projects/dashboard`, { headers });
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.success, true);
  for (const key of ["portfolio", "schedule", "milestones", "risks", "costs", "resources", "forecast", "problems"]) {
    assert.ok(Object.hasOwn(body.data, key), `missing ${key}`);
  }
  assert.equal(body.meta.cached, false);

  const second = await fetch(`${baseUrl}/api/v1/projects/dashboard`, { headers });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).meta.cached, true);
});
