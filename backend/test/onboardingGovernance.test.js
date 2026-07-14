process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const onboardingRoutes = require("../src/routes/onboarding");
const onboardingAccessGuard = require("../src/middleware/onboardingAccessGuard");

let server;
let baseUrl;
let userId;
let superAdminUserId;
let consentId;
const secret = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";

test.before(async () => {
  const role = await db.query(`SELECT role_id FROM system_roles WHERE LOWER(role_name)='employee' LIMIT 1`);
  assert.ok(role.rows[0]?.role_id);
  const created = await db.query(
    `INSERT INTO users (full_name,email,password_hash,role_id,company_name,status,is_active,onboarding_status,onboarding_required,onboarding_version)
     VALUES ('Onboarding Test Employee',$1,'test',$2,'AstreaBlue','Active',TRUE,'Account Created',TRUE,'1.0') RETURNING user_id`,
    [`onboarding-${Date.now()}@example.test`, role.rows[0].role_id]
  );
  userId = created.rows[0].user_id;
  const superAdminRole = await db.query(`SELECT role_id FROM system_roles WHERE LOWER(role_name)='superadmin' LIMIT 1`);
  assert.ok(superAdminRole.rows[0]?.role_id);
  const createdSuperAdmin = await db.query(
    `INSERT INTO users (full_name,email,password_hash,role_id,company_name,status,is_active,onboarding_status,onboarding_required,onboarding_version)
     VALUES ('Onboarding Test SuperAdmin',$1,'test',$2,'AstreaBlue','Active',TRUE,'Account Created',TRUE,'1.0') RETURNING user_id`,
    [`onboarding-superadmin-${Date.now()}@example.test`, superAdminRole.rows[0].role_id]
  );
  superAdminUserId = createdSuperAdmin.rows[0].user_id;
  const app = express();
  app.use(express.json());
  app.use("/api/v1/onboarding", onboardingRoutes);
  app.use("/api/v1", onboardingAccessGuard);
  app.get("/api/v1/private", (_req, res) => res.json({ success: true }));
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await db.query(`DELETE FROM user_onboarding_history WHERE user_id=$1`, [userId]);
  if (consentId) {
    await db.query(`DELETE FROM endpoint_monitoring_policies WHERE consent_id=$1`, [consentId]);
    await db.query(`DELETE FROM consent_audit_logs WHERE consent_id=$1`, [consentId]);
    await db.query(`DELETE FROM consent_documents WHERE consent_id=$1`, [consentId]);
  }
  await db.query(`DELETE FROM users WHERE user_id=$1`, [userId]);
  await db.query(`DELETE FROM users WHERE user_id=$1`, [superAdminUserId]);
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.rawPool.end();
});

function headers() {
  const token = jwt.sign({ userId, role: "Employee", branchId: null }, secret, { expiresIn: "5m" });
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

function superAdminHeadersWithStaleRoleClaim() {
  const token = jwt.sign({ userId: superAdminUserId, role: "Employee", branchId: null }, secret, { expiresIn: "5m" });
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

test("database SuperAdmin role bypasses employee onboarding even with a stale JWT role", async () => {
  const response = await fetch(`${baseUrl}/api/v1/private`, { headers: superAdminHeadersWithStaleRoleClaim() });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
});

test("mandatory onboarding state cannot be bypassed", async () => {
  const status = await fetch(`${baseUrl}/api/v1/onboarding/status`, { headers: headers() });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).data.must_complete_onboarding, true);

  const blocked = await fetch(`${baseUrl}/api/v1/private`, { headers: headers() });
  assert.equal(blocked.status, 428);
  assert.equal((await blocked.json()).code, "ONBOARDING_REQUIRED");

  const privacy = await fetch(`${baseUrl}/api/v1/onboarding/privacy-notice-viewed`, { method: "POST", headers: headers() });
  assert.equal(privacy.status, 200);
  assert.equal((await privacy.json()).data.onboarding_status, "Consent Required");

  await db.query(`UPDATE users SET onboarding_status='Completed',onboarding_required=FALSE,onboarding_completed_at=CURRENT_TIMESTAMP WHERE user_id=$1`, [userId]);
  assert.equal((await fetch(`${baseUrl}/api/v1/private`, { headers: headers() })).status, 200);
});

test("approved consent reconciles a stuck submitted onboarding state", async () => {
  const created = await db.query(
    `INSERT INTO consent_documents (
       employee_id,employee_full_name,employee_email,monitoring_preferences,status,active,signed_at,submitted_at,approved_at
     ) VALUES ($1,'Onboarding Test Employee','onboarding@example.test','["window_title"]'::jsonb,'approved',FALSE,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     RETURNING consent_id`,
    [userId]
  );
  consentId = created.rows[0].consent_id;
  await db.query(
    `UPDATE users SET onboarding_status='Consent Submitted',onboarding_required=TRUE,
       onboarding_completed_at=NULL,onboarding_consent_id=$2 WHERE user_id=$1`,
    [userId, consentId]
  );

  const response = await fetch(`${baseUrl}/api/v1/onboarding/status`, { headers: headers() });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.onboarding_status, "Completed");
  assert.equal(payload.data.onboarding_required, false);
  assert.equal(payload.data.must_complete_onboarding, false);
  assert.equal(payload.data.consent_status, "approved");
});
