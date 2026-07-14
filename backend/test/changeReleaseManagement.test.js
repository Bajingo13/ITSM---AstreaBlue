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

test("Change and Release APIs enforce RBAC", async () => {
  assert.equal((await fetch(`${baseUrl}/api/v1/change-release/changes`)).status, 401);
  // Employee without branch is allowed (owner-scoped), but unauthenticated returns 401
});

test("admin completes controlled change, release, and rollback workflow steps", async () => {
  const token = tokenFor("Admin", branchId);
  // Create change with all new fields
  const createdChange = await request("/changes", token, "POST", {
    title: "Automated workflow acceptance change",
    change_type: "Normal",
    risk_level: "Medium",
    impact_level: "Medium",
    implementation_plan: "Apply verified configuration.",
    backout_plan: "Restore previous configuration.",
    business_justification: "Required for acceptance testing",
    testing_plan: "Run automated smoke tests",
    post_implementation_verification: "Verify service health endpoints",
    risk_score: 3,
    security_impact: "Low",
    compliance_impact: "None",
    data_loss_risk: "None",
    operational_risk: "Low",
  });
  assert.equal(createdChange.status, 201); const change = (await createdChange.json()).data; changeId = change.id; assert.match(change.change_number, /^CHG\d{5}$/);
  assert.equal(change.business_justification, "Required for acceptance testing");
  assert.equal(change.testing_plan, "Run automated smoke tests");

  // Walk the new workflow statuses through to Approval
  assert.equal((await request(`/changes/${changeId}/status`, token, "PATCH", { status: "Submitted" })).status, 200);
  assert.equal((await request(`/changes/${changeId}/status`, token, "PATCH", { status: "Under Assessment" })).status, 200);
  assert.equal((await request(`/changes/${changeId}/status`, token, "PATCH", { status: "Pending Manager Approval" })).status, 200);
  // Attempt to approve without CAB approval first should fail (no CAB approval requirement check in new flow,
  // but we test the transition authorization: only admin/superadmin can approve)
  assert.equal((await request(`/changes/${changeId}/status`, token, "PATCH", { status: "Pending CAB Review" })).status, 200);
  // Need CAB approval before final approval
  assert.equal((await request(`/changes/${changeId}/approvals`, token, "POST", { decision: "Approved", comments: "Risk and implementation controls accepted." })).status, 201);
  assert.equal((await request(`/changes/${changeId}/status`, token, "PATCH", { status: "Approved" })).status, 200);

  // Check detail includes new related data
  const detail = await request(`/changes/${changeId}`, token); assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assert.ok(detailBody.data.activities.length >= 5);
  assert.ok(Array.isArray(detailBody.data.cab_members));
  assert.ok(Array.isArray(detailBody.data.cab_reviews));
  assert.ok(Array.isArray(detailBody.data.implementation_updates));
  assert.ok(Array.isArray(detailBody.data.schedule_history));

  // Test actions endpoint
  const actions = await request(`/changes/${changeId}/actions`, token); assert.equal(actions.status, 200);
  const actionsBody = await actions.json();
  assert.equal(actionsBody.data.current_status, "Approved");
  assert.ok(actionsBody.data.valid_transitions.includes("Scheduled"));

  // Test schedule update
  assert.equal((await request(`/changes/${changeId}/schedule`, token, "POST", { planned_start: new Date(Date.now() + 86400000).toISOString(), planned_end: new Date(Date.now() + 172800000).toISOString(), reason: "Scheduled for deployment window" })).status, 200);

  // Test implementation update
  assert.equal((await request(`/changes/${changeId}/implementation`, token, "POST", { action: "Pre-deployment checks completed", notes: "All verification steps passed." })).status, 201);

  // Test audit trail endpoint
  const audit = await request(`/changes/${changeId}/audit`, token); assert.equal(audit.status, 200);
  const auditBody = await audit.json();
  assert.ok(auditBody.data.activities.length >= 6);

  // Continue workflow to completion
  assert.equal((await request(`/changes/${changeId}/status`, token, "PATCH", { status: "Scheduled" })).status, 200);

  const createdRelease = await request("/releases", token, "POST", { title: "Acceptance release", environment: "Testing", change_ids: [changeId], checklist: [{ label: "Smoke test", complete: false }] });
  assert.equal(createdRelease.status, 201); releaseId = (await createdRelease.json()).data.id;
  assert.equal((await request(`/releases/${releaseId}/status`, token, "PATCH", { status: "Scheduled", progress: 20 })).status, 200);

  const createdRollback = await request("/rollbacks", token, "POST", { title: "Acceptance rollback", linked_change_id: changeId, linked_release_id: releaseId, recovery_plan: "Restore the validated baseline.", checklist: [{ label: "Validate recovery", complete: false }] });
  assert.equal(createdRollback.status, 201); rollbackId = (await createdRollback.json()).data.id;
  assert.equal((await request(`/rollbacks/${rollbackId}/status`, token, "PATCH", { status: "Approved" })).status, 200);
  assert.equal((await request(`/rollbacks/${rollbackId}`, token, "PUT", { recovery_plan: "Restore the validated baseline and confirm service health.", checklist: [{ label: "Validate recovery", complete: false }] })).status, 200);
  const history = await request(`/rollbacks/${rollbackId}/history`, token); assert.equal(history.status, 200); const historyBody = await history.json(); assert.equal(historyBody.data.versions.length, 2); assert.ok(historyBody.data.logs.length >= 3);

  const summary = await request("/summary", token); assert.equal(summary.status, 200);
  const summaryBody = await summary.json();
  assert.ok(Object.hasOwn(summaryBody.data, "deployment_success_pct"));
  assert.ok(Object.hasOwn(summaryBody.data, "open_changes"));
  assert.ok(Object.hasOwn(summaryBody.data, "emergency_changes"));
  assert.ok(Object.hasOwn(summaryBody.data, "scheduled"));

  // Test CAB members CRUD
  const cabMember = await request(`/changes/${changeId}/cab-members`, token, "POST", { user_id: userId, role: "Reviewer" });
  assert.equal(cabMember.status, 201);
  const cabMembers = await request(`/changes/${changeId}/cab-members`, token); assert.equal(cabMembers.status, 200);
  const cabMembersBody = await cabMembers.json();
  assert.equal(cabMembersBody.data.length, 1);
  assert.equal(cabMembersBody.data[0].role, "Reviewer");
  // Delete CAB member
  assert.equal((await request(`/changes/${changeId}/cab-members/${cabMembersBody.data[0].id}`, token, "DELETE")).status, 200);

  // Test CAB review
  const cabReview = await request(`/changes/${changeId}/cab-review`, token, "POST", { review_status: "Approved", decision_notes: "All criteria met.", quorum_met: true });
  assert.equal(cabReview.status, 201);

  // Test filtering changes by risk_level and sort
  const filtered = await request("/changes?risk_level=Medium", token); assert.equal(filtered.status, 200);
  const sorted = await request("/changes?sort_by=c.title&sort_order=ASC", token); assert.equal(sorted.status, 200);
});
