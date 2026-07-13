process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const routes = require("../src/routes/changeReleaseManagement");

let server; let baseUrl; let branchId; let userId; let changeId; let releaseId; let rollbackId;
const tokenFor = (role, branch = null) => jwt.sign({ userId, role, branchId: branch }, process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod", { expiresIn: "5m" });
const jsonHeaders = (token) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const request = (path, token, method = "GET", body) => fetch(`${baseUrl}/api/v1/change-release${path}`, { method, headers: jsonHeaders(token), body: body ? JSON.stringify(body) : undefined });

test.before(async () => {
  branchId = (await db.query("SELECT branch_id FROM branches ORDER BY branch_id LIMIT 1")).rows[0]?.branch_id;
  userId = (await db.query("SELECT user_id FROM users ORDER BY user_id LIMIT 1")).rows[0]?.user_id;
  assert.ok(branchId);
  assert.ok(userId);
  const app = express(); app.use(express.json()); app.use("/api/v1/change-release", routes);
  server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (rollbackId) await db.query("DELETE FROM rollback_procedures WHERE id=$1", [rollbackId]);
  if (releaseId) await db.query("DELETE FROM release_plans WHERE id=$1", [releaseId]);
  if (changeId) await db.query("DELETE FROM change_requests WHERE id=$1", [changeId]);
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.rawPool.end();
});

test("Change and Release APIs enforce manager RBAC", async () => {
  assert.equal((await fetch(`${baseUrl}/api/v1/change-release/changes`)).status, 401);
  assert.equal((await request("/changes", tokenFor("Technician", branchId))).status, 403);
});

test("admin completes controlled change, release, and rollback workflow steps", async () => {
  const token = tokenFor("Admin", branchId);
  const createdChange = await request("/changes", token, "POST", { title: "Automated workflow acceptance change", change_type: "Normal", risk_level: "Medium", impact_level: "Medium", implementation_plan: "Apply verified configuration.", backout_plan: "Restore previous configuration." });
  assert.equal(createdChange.status, 201); const change = (await createdChange.json()).data; changeId = change.id; assert.match(change.change_number, /^CHG-\d{8}\d{3}$/);

  for (const status of ["Submitted", "Risk Assessment", "CAB Review"]) assert.equal((await request(`/changes/${changeId}/status`, token, "PATCH", { status })).status, 200);
  assert.equal((await request(`/changes/${changeId}/status`, token, "PATCH", { status: "Approved" })).status, 409);
  assert.equal((await request(`/changes/${changeId}/approvals`, token, "POST", { decision: "Approved", comments: "Risk and implementation controls accepted." })).status, 201);
  assert.equal((await request(`/changes/${changeId}/status`, token, "PATCH", { status: "Approved" })).status, 200);
  const detail = await request(`/changes/${changeId}`, token); assert.equal(detail.status, 200); assert.ok((await detail.json()).data.activities.length >= 5);

  const createdRelease = await request("/releases", token, "POST", { title: "Acceptance release", environment: "Testing", change_ids: [changeId], checklist: [{ label: "Smoke test", complete: false }] });
  assert.equal(createdRelease.status, 201); releaseId = (await createdRelease.json()).data.id;
  assert.equal((await request(`/releases/${releaseId}/status`, token, "PATCH", { status: "Scheduled", progress: 20 })).status, 200);

  const createdRollback = await request("/rollbacks", token, "POST", { title: "Acceptance rollback", linked_change_id: changeId, linked_release_id: releaseId, recovery_plan: "Restore the validated baseline.", checklist: [{ label: "Validate recovery", complete: false }] });
  assert.equal(createdRollback.status, 201); rollbackId = (await createdRollback.json()).data.id;
  assert.equal((await request(`/rollbacks/${rollbackId}/status`, token, "PATCH", { status: "Approved" })).status, 200);
  assert.equal((await request(`/rollbacks/${rollbackId}`, token, "PUT", { recovery_plan: "Restore the validated baseline and confirm service health.", checklist: [{ label: "Validate recovery", complete: false }] })).status, 200);
  const history = await request(`/rollbacks/${rollbackId}/history`, token); assert.equal(history.status, 200); const historyBody = await history.json(); assert.equal(historyBody.data.versions.length, 2); assert.ok(historyBody.data.logs.length >= 3);

  const summary = await request("/summary", token); assert.equal(summary.status, 200); assert.ok(Object.hasOwn((await summary.json()).data, "deployment_success_pct"));
});
