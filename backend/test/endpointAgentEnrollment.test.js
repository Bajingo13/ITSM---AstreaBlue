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
const consentIds = [];
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
  if (consentIds.length) await db.query(`DELETE FROM consent_documents WHERE consent_id=ANY($1::bigint[])`, [consentIds]);
  if (deviceIds.length) await db.query(`DELETE FROM monitored_devices WHERE device_id=ANY($1::bigint[])`, [deviceIds]);
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.rawPool.end();
});

test("enrollment management requires an administrator", async () => {
  assert.equal((await adminRequest("/enrollment-codes", "GET", undefined, "Employee")).status, 403);
  assert.equal((await adminRequest("/enrollment-codes", "GET", undefined, "Technician")).status, 403);
  assert.equal((await adminRequest("/enrollment-codes")).status, 200);
});

test("endpoint checklist separates signed consent from administrator approval", () => {
  const now = new Date().toISOString();
  const base = {
    device_uuid: crypto.randomUUID(),
    device_id: 1,
    hostname: "CHECKLIST-TEST",
    asset_id: 1,
    assigned_user_id: 9,
    consent_id: "100",
    consent_status: "pending_employee",
    consent_submitted: true,
    consent_approved: false,
    last_seen_at: now,
    last_activity_at: now,
    last_idle_detection_at: now,
    last_hardware_inventory_at: now,
    last_software_inventory_at: now,
    last_policy_sync_at: now,
    policy_generated_at: now,
    policy_json: { features: {} },
  };
  const submitted = routes._test.buildEndpointHealth(base).checklist;
  assert.equal(submitted.find((item) => item.step === "Consent Submitted").status, "Complete");
  assert.equal(submitted.find((item) => item.step === "Consent Approved").status, "Pending");

  const approved = routes._test.buildEndpointHealth({ ...base, consent_approved: true }).checklist;
  assert.equal(approved.find((item) => item.step === "Consent Approved").status, "Complete");
});

test("endpoint health distinguishes disabled activity from stale activity", () => {
  const now = new Date().toISOString();
  const base = {
    device_uuid: crypto.randomUUID(),
    device_id: 2,
    hostname: "ACTIVITY-HEALTH-TEST",
    asset_id: 1,
    assigned_user_id: 9,
    consent_id: "101",
    consent_status: "approved",
    consent_submitted: true,
    consent_approved: true,
    last_seen_at: now,
    last_activity_at: "2026-01-01T00:00:00.000Z",
    last_idle_detection_at: "2026-01-01T00:00:00.000Z",
    last_hardware_inventory_at: now,
    last_software_inventory_at: now,
    last_policy_sync_at: now,
    policy_generated_at: now,
  };

  const disabled = routes._test.buildEndpointHealth({
    ...base,
    policy_json: {
      features: {
        activity_monitoring_enabled: { enabled: false, consent_required: true, reason: "Employee consent excludes activity." },
        screenshot_monitoring_enabled: { enabled: true, consent_required: true },
      },
    },
  });
  assert.equal(disabled.activity.status, "Disabled");
  assert.equal(disabled.idle_detection.status, "Disabled");
  assert.equal(disabled.checklist.find((item) => item.step === "Monitoring Active").status, "Not Applicable");

  const enabled = routes._test.buildEndpointHealth({
    ...base,
    last_activity_at: now,
    last_idle_detection_at: now,
    policy_json: {
      features: {
        activity_monitoring_enabled: { enabled: true, consent_required: true },
      },
    },
  });
  assert.equal(enabled.activity.status, "Healthy");
  assert.equal(enabled.idle_detection.status, "Healthy");
  assert.equal(enabled.checklist.find((item) => item.step === "Monitoring Active").status, "Complete");
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

  const hardwareUpload = await agentRequest("/hardware-inventory", second.body.data.device_credential, "POST", {
    device_uuid: secondUuid,
    hostname: "ENROLLMENT-TEST-TWO",
    manufacturer: "AstreaBlue Test",
    model: "Inventory Endpoint",
    serial_number: "AB-INV-001",
    cpu_name: "Test CPU",
    total_ram_gb: 16,
    os_name: "Windows",
    os_version: "11",
    os_build: "26100",
    architecture: "64-bit",
    disk_total_gb: 512,
    disk_free_gb: 256,
    scanned_at: new Date().toISOString(),
  });
  assert.equal(hardwareUpload.status, 200);
  const softwareUpload = await agentRequest("/software-inventory", second.body.data.device_credential, "POST", {
    device_uuid: secondUuid,
    hostname: "ENROLLMENT-TEST-TWO",
    software: [{ software_name: "AstreaBlue Test App", version: "1.0", publisher: "AstreaBlue" }],
  });
  assert.equal(softwareUpload.status, 201);
  const policyDownload = await agentRequest(
    `/policy?device_uuid=${encodeURIComponent(secondUuid)}`,
    second.body.data.device_credential
  );
  assert.equal(policyDownload.status, 200);
  const policyBody = await policyDownload.json();
  assert.equal(policyBody.data.policy_name, "Default (Safe)");
  assert.equal(policyBody.data.applicationMonitoring, false);
  assert.equal(policyBody.data.screenshot_interval_minutes, 15);
  assert.equal(policyBody.data.screenshot_retention_days, 30);

  const screenshotWithoutConsent = await agentRequest(
    `/screenshot-permission?device_uuid=${encodeURIComponent(secondUuid)}`,
    second.body.data.device_credential
  );
  assert.equal(screenshotWithoutConsent.status, 200);
  const screenshotWithoutConsentBody = await screenshotWithoutConsent.json();
  assert.equal(screenshotWithoutConsentBody.data.allowed, false);
  assert.match(screenshotWithoutConsentBody.data.reason, /assigned to an employee/i);

  const usbWithoutConsent = await agentRequest(
    `/usb-monitoring-permission?device_uuid=${encodeURIComponent(secondUuid)}`,
    second.body.data.device_credential
  );
  assert.equal(usbWithoutConsent.status, 200);
  assert.equal((await usbWithoutConsent.json()).data.allowed, false);

  const crossDevicePermission = await agentRequest(
    `/screenshot-permission?device_uuid=${encodeURIComponent(firstUuid)}`,
    second.body.data.device_credential
  );
  assert.equal(crossDevicePermission.status, 403);

  const deviceDetails = await adminRequest(`/devices/${second.body.data.device_id}/activity`);
  assert.equal(deviceDetails.status, 200);
  const deviceDetailsBody = await deviceDetails.json();
  assert.equal(deviceDetailsBody.data.hardware.serial_number, "AB-INV-001");
  assert.equal(deviceDetailsBody.data.software.some((item) => item.software_name === "AstreaBlue Test App"), true);
  assert.equal(deviceDetailsBody.data.policy.policy_name, "Default (Safe)");
  assert.match(deviceDetailsBody.data.policy.policy_version, /^\d+\.\d+$/);
  assert.ok(deviceDetailsBody.data.policy.generated_at);

  const devicesResponse = await adminRequest("/devices");
  assert.equal(devicesResponse.status, 200);
  const devicesBody = await devicesResponse.json();
  const syncedDevice = devicesBody.data.find((device) => device.device_uuid === secondUuid);
  assert.ok(syncedDevice.policy_synced_at);

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

test("approved consent policy becomes the agent baseline without a manual policy assignment", async () => {
  const deviceUuid = crypto.randomUUID();
  const hostname = "CONSENT-POLICY-BASELINE";
  const code = await createEnrollmentCode(hostname);
  const enrolled = await enroll(code, deviceUuid, hostname);
  assert.equal(enrolled.response.status, 201);
  const credential = enrolled.body.data.device_credential;

  await db.query(
    `UPDATE monitored_devices SET assigned_user_id=$1, branch_id=$2 WHERE device_uuid=$3::uuid`,
    [actorId, branchId, deviceUuid]
  );
  const consent = await db.query(
    `INSERT INTO consent_documents
       (employee_id,employee_full_name,employee_email,form_title,consent_version,
        monitoring_preferences,status,active,approved_at)
     VALUES ($1,'Consent Policy Test','consent-policy-test@astreablue.test',
       'Endpoint Monitoring Consent','1.0',$2::jsonb,'approved',true,CURRENT_TIMESTAMP)
     RETURNING consent_id`,
    [actorId, JSON.stringify(["app_usage", "idle_time", "window_title", "screenshot", "usb_monitoring", "website_monitoring"])]
  );
  const consentId = consent.rows[0].consent_id;
  consentIds.push(consentId);
  await db.query(
    `INSERT INTO endpoint_monitoring_policies
       (consent_id,consent_version,employee_id,device_uuid,application_monitoring,
        web_monitoring,screenshot_monitoring,usb_monitoring,location_tracking,status)
     VALUES ($1,'1.0',$2,NULL,false,false,false,false,false,'active')`,
    [consentId, actorId]
  );

  const policyResponse = await agentRequest(`/policy/latest?device_uuid=${encodeURIComponent(deviceUuid)}`, credential);
  assert.equal(policyResponse.status, 200);
  const policy = (await policyResponse.json()).data;
  assert.equal(policy.policy_name, "Approved Consent Policy");
  assert.equal(policy.activity_monitoring_enabled, true);
  assert.equal(policy.screenshot_monitoring_enabled, true);
  assert.equal(policy.browser_monitoring_enabled, true);
  assert.equal(policy.usb_monitoring_enabled, true);
  assert.equal(policy.location_tracking_enabled, false);
  assert.equal(policy.screenshot_interval_minutes, 15);
  assert.equal(policy.screenshot_retention_days, 30);

  const screenshotPermission = await agentRequest(
    `/screenshot-permission?device_uuid=${encodeURIComponent(deviceUuid)}`,
    credential
  );
  assert.equal(screenshotPermission.status, 200);
  const screenshotPermissionBody = await screenshotPermission.json();
  assert.equal(screenshotPermissionBody.data.allowed, true);
  assert.equal(String(screenshotPermissionBody.data.consent_id), String(consentId));

  const usbPermission = await agentRequest(
    `/usb-monitoring-permission?device_uuid=${encodeURIComponent(deviceUuid)}`,
    credential
  );
  assert.equal(usbPermission.status, 200);
  assert.equal((await usbPermission.json()).data.allowed, true);

  const activity = await agentRequest("/activity", credential, "POST", {
    device_uuid: deviceUuid,
    hostname,
    app_name: "Consent Policy Test",
    window_title: "Approved activity",
    idle_seconds: 5,
    occurred_at: new Date().toISOString(),
  });
  assert.equal(activity.status, 201);

  await db.query(
    `UPDATE consent_documents SET monitoring_preferences=$1::jsonb WHERE consent_id=$2`,
    [JSON.stringify(["app_usage", "usb_monitoring"]), consentId]
  );
  const categoryExcluded = await agentRequest(
    `/screenshot-permission?device_uuid=${encodeURIComponent(deviceUuid)}`,
    credential
  );
  assert.equal(categoryExcluded.status, 200);
  const categoryExcludedBody = await categoryExcluded.json();
  assert.equal(categoryExcludedBody.data.allowed, false);
  assert.match(categoryExcludedBody.data.reason, /excludes Screenshot Monitoring/i);

  await db.query(
    `UPDATE consent_documents
     SET status='submitted',active=false,monitoring_preferences=$1::jsonb
     WHERE consent_id=$2`,
    [JSON.stringify(["screenshot", "usb_monitoring"]), consentId]
  );
  const awaitingApproval = await agentRequest(
    `/screenshot-permission?device_uuid=${encodeURIComponent(deviceUuid)}`,
    credential
  );
  assert.equal(awaitingApproval.status, 200);
  const awaitingApprovalBody = await awaitingApproval.json();
  assert.equal(awaitingApprovalBody.data.allowed, false);
  assert.match(awaitingApprovalBody.data.reason, /No active approved consent/i);

  await db.query(`UPDATE consent_documents SET status='withdrawn',active=false WHERE consent_id=$1`, [consentId]);
  const withdrawnUsb = await agentRequest(
    `/usb-monitoring-permission?device_uuid=${encodeURIComponent(deviceUuid)}`,
    credential
  );
  assert.equal(withdrawnUsb.status, 200);
  assert.equal((await withdrawnUsb.json()).data.allowed, false);
});
