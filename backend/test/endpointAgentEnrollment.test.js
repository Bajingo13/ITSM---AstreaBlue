process.env.NODE_ENV = "test";
process.env.MONITORING_AGENT_TOKEN = "legacy-agent-test-token";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const routes = require("../src/routes/laptopMonitoring");

let server;
let baseUrl;
let branchId;
let actorId;
const deviceIds = [];
const codeIds = [];
const secret = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";

function managerToken(role = "Admin") {
  return jwt.sign({ userId: actorId, role, branchId }, secret, { expiresIn: "5m" });
}

function jsonHeaders(token) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function adminRequest(path, method = "GET", body, role = "Admin") {
  return fetch(`${baseUrl}/api/v1/laptop-monitoring${path}`, {
    method,
    headers: jsonHeaders(managerToken(role)),
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function agentRequest(path, token, method = "GET", body) {
  return fetch(`${baseUrl}/api/v1/laptop-monitoring${path}`, {
    method,
    headers: { "x-agent-token": token, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function createEnrollmentCode(hostname) {
  const response = await adminRequest("/enrollment-codes", "POST", {
    branch_id: branchId,
    intended_hostname: hostname,
    expires_in_minutes: 10,
  });
  assert.equal(response.status, 201);
  const data = (await response.json()).data;
  codeIds.push(data.enrollment_code_id);
  assert.match(data.enrollment_code, /^ABENR-/);
  return data.enrollment_code;
}

async function enroll(code, deviceUuid, hostname) {
  const response = await fetch(`${baseUrl}/api/v1/laptop-monitoring/enroll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      enrollment_code: code,
      device_uuid: deviceUuid,
      hostname,
      device_name: hostname,
      agent_version: "enrollment-test-1.0",
    }),
  });
  const body = await response.json();
  if (response.status === 201) deviceIds.push(body.data.device_id);
  return { response, body };
}

function heartbeatBody(deviceUuid, hostname) {
  return { device_uuid: deviceUuid, hostname, device_name: hostname, agent_version: "enrollment-test-1.0" };
}

test.before(async () => {
  const branch = await db.query(`SELECT branch_id FROM branches ORDER BY branch_id LIMIT 1`);
  const actor = await db.query(`SELECT user_id FROM users ORDER BY user_id LIMIT 1`);
  branchId = branch.rows[0]?.branch_id;
  actorId = actor.rows[0]?.user_id;
  assert.ok(branchId);
  assert.ok(actorId);
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/v1/laptop-monitoring", routes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (deviceIds.length || codeIds.length) {
    await db.query(
      `DELETE FROM endpoint_enrollment_audit_logs
       WHERE device_id=ANY($1::bigint[]) OR enrollment_code_id=ANY($2::bigint[])`,
      [deviceIds, codeIds]
    );
  }
  if (codeIds.length) await db.query(`DELETE FROM endpoint_enrollment_codes WHERE enrollment_code_id=ANY($1::bigint[])`, [codeIds]);
  if (deviceIds.length) await db.query(`DELETE FROM monitored_devices WHERE device_id=ANY($1::bigint[])`, [deviceIds]);
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.rawPool.end();
});

test("enrollment management requires an administrator", async () => {
  assert.equal((await adminRequest("/enrollment-codes", "GET", undefined, "Employee")).status, 403);
  assert.equal((await adminRequest("/enrollment-codes", "GET", undefined, "Technician")).status, 403);
  assert.equal((await adminRequest("/enrollment-codes")).status, 200);
});

test("single-use enrollment issues isolated per-device credentials", async () => {
  const firstUuid = crypto.randomUUID();
  const secondUuid = crypto.randomUUID();
  const firstCode = await createEnrollmentCode("ENROLLMENT-TEST-ONE");
  const first = await enroll(firstCode, firstUuid, "ENROLLMENT-TEST-ONE");
  assert.equal(first.response.status, 201);
  assert.match(first.body.data.device_credential, /^ABDEV-/);
  assert.equal(first.body.data.enrollment_status, "Enrolled");

  const replay = await enroll(firstCode, crypto.randomUUID(), "ENROLLMENT-TEST-ONE");
  assert.equal(replay.response.status, 401);

  const secondCode = await createEnrollmentCode("ENROLLMENT-TEST-TWO");
  const second = await enroll(secondCode, secondUuid, "ENROLLMENT-TEST-TWO");
  assert.equal(second.response.status, 201);
  assert.notEqual(first.body.data.device_credential, second.body.data.device_credential);

  const firstHeartbeat = await agentRequest("/heartbeat", first.body.data.device_credential, "POST", heartbeatBody(firstUuid, "ENROLLMENT-TEST-ONE"));
  assert.equal(firstHeartbeat.status, 200);
  const secondHeartbeat = await agentRequest("/heartbeat", second.body.data.device_credential, "POST", heartbeatBody(secondUuid, "ENROLLMENT-TEST-TWO"));
  assert.equal(secondHeartbeat.status, 200);
  const activityWithoutConsent = await agentRequest("/activity", second.body.data.device_credential, "POST", {
    device_uuid: secondUuid,
    hostname: "ENROLLMENT-TEST-TWO",
    app_name: "Consent Boundary Test",
    window_title: "This event must be rejected",
    idle_seconds: 0,
  });
  assert.equal(activityWithoutConsent.status, 403);

  const crossDevice = await agentRequest("/heartbeat", second.body.data.device_credential, "POST", heartbeatBody(firstUuid, "ENROLLMENT-TEST-ONE"));
  assert.equal(crossDevice.status, 403);
  const missingIdentity = await agentRequest("/heartbeat", first.body.data.device_credential, "POST", { hostname: "ENROLLMENT-TEST-ONE" });
  assert.equal(missingIdentity.status, 400);

  const rotation = await adminRequest(`/devices/${first.body.data.device_id}/credentials/rotate`, "POST", {});
  assert.equal(rotation.status, 200);
  const rotatedCredential = (await rotation.json()).data.device_credential;
  assert.match(rotatedCredential, /^ABDEV-/);
  assert.equal((await agentRequest("/heartbeat", first.body.data.device_credential, "POST", heartbeatBody(firstUuid, "ENROLLMENT-TEST-ONE"))).status, 401);
  assert.equal((await agentRequest("/heartbeat", rotatedCredential, "POST", heartbeatBody(firstUuid, "ENROLLMENT-TEST-ONE"))).status, 200);

  const revoke = await adminRequest(`/devices/${first.body.data.device_id}/credentials/revoke`, "POST", { reason: "Automated revocation test" });
  assert.equal(revoke.status, 200);
  assert.equal((await agentRequest("/heartbeat", rotatedCredential, "POST", heartbeatBody(firstUuid, "ENROLLMENT-TEST-ONE"))).status, 401);
  assert.equal((await agentRequest("/heartbeat", second.body.data.device_credential, "POST", heartbeatBody(secondUuid, "ENROLLMENT-TEST-TWO"))).status, 200);
});

test("legacy global token remains available during migration", async () => {
  const deviceUuid = crypto.randomUUID();
  const hostname = "LEGACY-MIGRATION-TEST";
  const response = await agentRequest("/heartbeat", process.env.MONITORING_AGENT_TOKEN, "POST", heartbeatBody(deviceUuid, hostname));
  assert.equal(response.status, 200);
  deviceIds.push((await response.json()).data.device_id);
});
