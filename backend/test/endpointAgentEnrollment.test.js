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
// Real users created for role-boundary coverage. The DB role is authoritative,
// so a forged JWT claim cannot stand in for an actual Employee/Technician row.
const roleActors = {};
const roleActorIds = [];
const deviceIds = [];
const codeIds = [];
const consentIds = [];
const policyIds = [];
const ticketIds = [];
const assetIds = [];
const userIds = [];
const lifecycleCaseIds = [];
const secret = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";

function managerToken(role = "SuperAdmin") {
  // Use the real user whose database role matches when one was provisioned;
  // otherwise fall back to the bootstrap actor (a SuperAdmin).
  const actor = roleActors[String(role).toLowerCase()];
  const userId = actor ? actor.user_id : actorId;
  const claimBranch = actor ? actor.branch_id ?? null : branchId;
  return jwt.sign({ userId, role, branchId: claimBranch }, secret, { expiresIn: "5m" });
}

function jsonHeaders(token) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function adminRequest(path, method = "GET", body, role = "SuperAdmin") {
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
  const actor = await db.query(
    `SELECT u.user_id FROM users u JOIN system_roles r ON r.role_id=u.role_id
      WHERE LOWER(r.role_name)='superadmin' ORDER BY u.user_id LIMIT 1`
  );
  branchId = branch.rows[0]?.branch_id;
  actorId = actor.rows[0]?.user_id;
  assert.ok(branchId);
  assert.ok(actorId);

  // Provision real Employee and Technician accounts so role-boundary checks
  // exercise the database role rather than a forged token claim. These rows
  // carry no dependent records, so teardown is a simple delete.
  for (const roleName of ["Admin", "Employee", "Technician"]) {
    const roleRow = await db.query(
      `SELECT role_id FROM system_roles WHERE LOWER(role_name)=LOWER($1) LIMIT 1`,
      [roleName]
    );
    const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const created = await db.query(
      `INSERT INTO users (full_name,email,password_hash,role_id,company_name,branch_id,status,is_active)
       VALUES ($1,$2,'test-only',$3,'AstreaBlue QA',$4,'Active',TRUE)
       RETURNING user_id`,
      [`QA ${roleName} ${stamp}`, `qa-${roleName.toLowerCase()}-${stamp}@example.invalid`, roleRow.rows[0].role_id, branchId]
    );
    roleActors[roleName.toLowerCase()] = { user_id: created.rows[0].user_id, branch_id: branchId };
    roleActorIds.push(created.rows[0].user_id);
  }

  // Clear any monitoring override left on the bootstrap actor by an earlier run
  // so consent-derived policy flags are evaluated cleanly.
  await db.query(`DELETE FROM endpoint_monitoring_overrides WHERE employee_id=$1`, [actorId]);
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/v1/laptop-monitoring", routes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (ticketIds.length) {
    await db.query(`DELETE FROM notifications WHERE related_ticket_id=ANY($1::int[])`, [ticketIds]);
    await db.query(`DELETE FROM ticket_history WHERE ticket_id=ANY($1::int[])`, [ticketIds]);
    await db.query(`DELETE FROM integration_audit_logs WHERE metadata->>'ticket_id'=ANY($1::text[])`, [ticketIds.map(String)]);
    await db.query(`DELETE FROM tickets WHERE id=ANY($1::int[])`, [ticketIds]);
  }
  if (policyIds.length) await db.query(`DELETE FROM endpoint_policies WHERE id=ANY($1::bigint[])`, [policyIds]);
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
  if (assetIds.length) await db.query(`DELETE FROM hardware_assets WHERE asset_id=ANY($1::int[])`, [assetIds]);
  if (lifecycleCaseIds.length) await db.query(`DELETE FROM employee_lifecycle_cases WHERE lifecycle_case_id=ANY($1::bigint[])`, [lifecycleCaseIds]);
  if (userIds.length) await db.query(`DELETE FROM users WHERE user_id=ANY($1::int[])`, [userIds]);
  await db.query(`DELETE FROM endpoint_monitoring_overrides WHERE employee_id=$1`, [actorId]);
  if (roleActorIds.length) {
    await db.query(`DELETE FROM endpoint_monitoring_overrides WHERE employee_id=ANY($1::int[])`, [roleActorIds]);
    await db.query(`DELETE FROM users WHERE user_id=ANY($1::int[])`, [roleActorIds]);
  }
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

  const screenshotList = await adminRequest("/screenshots");
  assert.equal(screenshotList.status, 200);
  assert.ok(Array.isArray((await screenshotList.json()).data));
  const screenshotStats = await adminRequest("/screenshots/stats");
  assert.equal(screenshotStats.status, 200);
  assert.equal(typeof (await screenshotStats.json()).data.storage_used_mb, "string");
  assert.equal((await adminRequest("/screenshots/999999999/content")).status, 404);

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

test("device assignment synchronizes ownership and requests consent when approval is missing", async () => {
  const role = await db.query(
    `SELECT role_id FROM system_roles WHERE LOWER(role_name)='employee' ORDER BY role_id LIMIT 1`
  );
  assert.ok(role.rows[0]?.role_id);

  const unique = crypto.randomUUID();
  const employee = await db.query(
    `INSERT INTO users (
       full_name, email, password_hash, role_id, company_name, branch_id,
       department, onboarding_status, onboarding_required, is_active
     ) VALUES ($1,$2,'assignment-test-password-hash',$3,'AstreaBlue',$4,'IT','Completed',false,true)
     RETURNING user_id`,
    ["Endpoint Assignment Test", `endpoint-assignment-${unique}@astreablue.test`, role.rows[0].role_id, branchId]
  );
  const employeeId = employee.rows[0].user_id;
  userIds.push(employeeId);

  const asset = await db.query(
    `INSERT INTO hardware_assets (
       serial_number, brand, model_name, asset_name, asset_type, status, branch_id, department
     ) VALUES ($1,'AstreaBlue','Assignment Test','Assignment Test Laptop','Laptop','Active',$2,'Operations')
     RETURNING asset_id`,
    [`ASSIGN-${unique}`, branchId]
  );
  const assetId = asset.rows[0].asset_id;
  assetIds.push(assetId);

  const deviceUuid = crypto.randomUUID();
  const hostname = `ASSIGN-${unique.slice(0, 8)}`;
  const code = await createEnrollmentCode(hostname);
  const enrolled = await enroll(code, deviceUuid, hostname);
  assert.equal(enrolled.response.status, 201);

  await db.query(
    `UPDATE users SET onboarding_status='Consent Approved',onboarding_required=TRUE
      WHERE user_id=$1`,
    [employeeId]
  );
  const lifecycleCase = await db.query(
    `INSERT INTO employee_lifecycle_cases
       (case_number,lifecycle_type,employee_id,branch_id,status,created_by)
     VALUES($1,'Onboarding',$2,$3,'In Progress',$4)
     RETURNING lifecycle_case_id`,
    [`ONB-ASSIGN-${unique.slice(0, 24)}`, employeeId, branchId, actorId]
  );
  lifecycleCaseIds.push(lifecycleCase.rows[0].lifecycle_case_id);

  const assignment = await adminRequest(
    `/devices/${enrolled.body.data.device_id}/assign`,
    "PUT",
    {
      assigned_user_id: employeeId,
      branch_id: branchId,
      asset_id: assetId,
      department: "IT",
      reason: "Assignment regression test",
    }
  );
  const assignmentBody = await assignment.json();
  assert.equal(assignment.status, 200, JSON.stringify(assignmentBody));
  assert.equal(assignmentBody.consent?.approved, false);
  assert.equal(assignmentBody.consent?.pending, true);
  assert.match(assignmentBody.message, /Consent was requested/i);

  const requestedConsent = await db.query(
    `SELECT consent_id, status
     FROM consent_documents
     WHERE employee_id=$1 AND status='pending_employee'
     ORDER BY consent_id DESC LIMIT 1`,
    [employeeId]
  );
  assert.equal(requestedConsent.rows[0]?.status, "pending_employee");
  consentIds.push(requestedConsent.rows[0].consent_id);

  const linkedAsset = await db.query(
    `SELECT employee_id, assigned_name, status FROM hardware_assets WHERE asset_id=$1`,
    [assetId]
  );
  assert.equal(linkedAsset.rows[0].employee_id, String(employeeId));
  assert.equal(linkedAsset.rows[0].assigned_name, "Endpoint Assignment Test");
  assert.equal(linkedAsset.rows[0].status, "In Use");

  const linkedDevice = await db.query(
    `SELECT assigned_user_id, branch_id, asset_id FROM monitored_devices WHERE device_id=$1`,
    [enrolled.body.data.device_id]
  );
  assert.equal(linkedDevice.rows[0].assigned_user_id, employeeId);
  assert.equal(linkedDevice.rows[0].branch_id, branchId);
  assert.equal(linkedDevice.rows[0].asset_id, assetId);

  const unassignment = await adminRequest(
    `/devices/${enrolled.body.data.device_id}/assign`,
    "PUT",
    {
      assigned_user_id: null,
      asset_id: assetId,
      reason: "Ownership removal regression test",
    }
  );
  const unassignmentBody = await unassignment.json();
  assert.equal(unassignment.status, 200, JSON.stringify(unassignmentBody));

  const unassignedAsset = await db.query(
    `SELECT employee_id, assigned_name, department, status FROM hardware_assets WHERE asset_id=$1`,
    [assetId]
  );
  assert.equal(unassignedAsset.rows[0].employee_id, null);
  assert.equal(unassignedAsset.rows[0].assigned_name, null);
  assert.equal(unassignedAsset.rows[0].department, "Operations");
  assert.equal(unassignedAsset.rows[0].status, "Available");

  const unassignedDevice = await db.query(
    `SELECT assigned_user_id, branch_id, asset_id, department FROM monitored_devices WHERE device_id=$1`,
    [enrolled.body.data.device_id]
  );
  assert.equal(unassignedDevice.rows[0].assigned_user_id, null);
  assert.equal(unassignedDevice.rows[0].branch_id, branchId);
  assert.equal(unassignedDevice.rows[0].asset_id, assetId);
  assert.equal(unassignedDevice.rows[0].department, null);

  const ownershipHistory = await db.query(
    `SELECT event_type FROM asset_history WHERE asset_id=$1 ORDER BY history_id`,
    [assetId]
  );
  assert.deepEqual(
    ownershipHistory.rows.map((row) => row.event_type),
    ["Endpoint Owner Assigned", "Endpoint Owner Removed"]
  );
});

test("approved consent policy becomes the agent baseline without a manual policy assignment", async () => {
  const deviceUuid = crypto.randomUUID();
  const hostname = "CONSENT-POLICY-BASELINE";
  const code = await createEnrollmentCode(hostname);
  const enrolled = await enroll(code, deviceUuid, hostname);
  assert.equal(enrolled.response.status, 201);
  const credential = enrolled.body.data.device_credential;

  // Automatic DLP incident creation enforces that the device's assigned user
  // belongs to the device branch, so this device must be owned by a real
  // branch-bound employee rather than the branchless bootstrap SuperAdmin.
  const consentEmployee = await db.query(
    `INSERT INTO users (full_name,email,password_hash,role_id,company_name,branch_id,status,is_active)
     SELECT 'Consent Policy Employee',$1,'test-only',role_id,'AstreaBlue QA',$2,'Active',TRUE
       FROM system_roles WHERE LOWER(role_name)='employee' LIMIT 1
     RETURNING user_id`,
    [`consent-policy-emp-${crypto.randomUUID()}@example.invalid`, branchId]
  );
  const consentEmployeeId = consentEmployee.rows[0].user_id;
  userIds.push(consentEmployeeId);

  await db.query(
    `UPDATE monitored_devices SET assigned_user_id=$1, branch_id=$2 WHERE device_uuid=$3::uuid`,
    [consentEmployeeId, branchId, deviceUuid]
  );
  const consent = await db.query(
    `INSERT INTO consent_documents
       (employee_id,employee_full_name,employee_email,form_title,consent_version,
        monitoring_preferences,status,active,approved_at)
     VALUES ($1,'Consent Policy Test','consent-policy-test@astreablue.test',
       'Endpoint Monitoring Consent','1.0',$2::jsonb,'approved',true,CURRENT_TIMESTAMP)
     RETURNING consent_id`,
    [consentEmployeeId, JSON.stringify(["app_usage", "idle_time", "window_title", "screenshot", "usb_monitoring", "website_monitoring"])]
  );
  const consentId = consent.rows[0].consent_id;
  consentIds.push(consentId);
  await db.query(
    `INSERT INTO endpoint_monitoring_policies
       (consent_id,consent_version,employee_id,device_uuid,application_monitoring,
        web_monitoring,screenshot_monitoring,usb_monitoring,location_tracking,status)
     VALUES ($1,'1.0',$2,NULL,false,false,false,false,false,'active')`,
    [consentId, consentEmployeeId]
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
  assert.equal(policy.usb_scan_interval_seconds, 15);
  assert.equal(policy.dlp_large_transfer_mb, 100);

  const deviceOverride = await db.query(
    `INSERT INTO consent_documents
       (employee_id,employee_full_name,employee_email,form_title,consent_version,
        monitoring_preferences,status,active,approved_at,device_uuid)
     VALUES ($1,'Consent Policy Test','consent-policy-test@astreablue.test',
       'Endpoint Monitoring Consent','1.1',$2::jsonb,'approved',true,CURRENT_TIMESTAMP,$3::uuid)
     RETURNING consent_id`,
    [consentEmployeeId, JSON.stringify(["usb_monitoring"]), deviceUuid]
  );
  const overrideConsentId = deviceOverride.rows[0].consent_id;
  consentIds.push(overrideConsentId);
  const overridePolicyResponse = await agentRequest(`/policy/latest?device_uuid=${encodeURIComponent(deviceUuid)}`, credential);
  assert.equal(overridePolicyResponse.status, 200);
  const overridePolicy = (await overridePolicyResponse.json()).data;
  assert.equal(String(overridePolicy.consent_id), String(overrideConsentId));
  assert.equal(overridePolicy.screenshot_monitoring_enabled, false);
  assert.equal(overridePolicy.usb_monitoring_enabled, true);

  await db.query(
    `UPDATE consent_documents SET status='superseded',active=false WHERE consent_id=$1`,
    [overrideConsentId]
  );
  const fallbackPolicyResponse = await agentRequest(`/policy/latest?device_uuid=${encodeURIComponent(deviceUuid)}`, credential);
  assert.equal(fallbackPolicyResponse.status, 200);
  const fallbackPolicy = (await fallbackPolicyResponse.json()).data;
  assert.equal(String(fallbackPolicy.consent_id), String(consentId));
  assert.equal(fallbackPolicy.screenshot_monitoring_enabled, true);

  const screenshotPermission = await agentRequest(
    `/screenshot-permission?device_uuid=${encodeURIComponent(deviceUuid)}`,
    credential
  );
  assert.equal(screenshotPermission.status, 200);
  const screenshotPermissionBody = await screenshotPermission.json();
  assert.equal(screenshotPermissionBody.data.allowed, true);
  assert.equal(String(screenshotPermissionBody.data.consent_id), String(consentId));

  const overrideAuditReason = `endpoint-screenshot-control-test-${crypto.randomUUID()}`;
  const forbiddenPause = await adminRequest(`/employees/${consentEmployeeId}/screenshot-control`, "POST", {
    suspended: true,
    reason: overrideAuditReason,
  }, "Admin");
  assert.equal(forbiddenPause.status, 403);

  try {
    const initialControl = await adminRequest(`/employees/${consentEmployeeId}/screenshot-control`, "GET", undefined, "SuperAdmin");
    assert.equal(initialControl.status, 200);
    assert.equal((await initialControl.json()).data.suspended, false);

    const pauseResponse = await adminRequest(`/employees/${consentEmployeeId}/screenshot-control`, "POST", {
      suspended: true,
      reason: overrideAuditReason,
    }, "SuperAdmin");
    assert.equal(pauseResponse.status, 200);
    assert.equal((await pauseResponse.json()).data.suspended, true);

    const blockedPermission = await agentRequest(
      `/screenshot-permission?device_uuid=${encodeURIComponent(deviceUuid)}`,
      credential
    );
    assert.equal(blockedPermission.status, 200);
    const blockedPermissionBody = await blockedPermission.json();
    assert.equal(blockedPermissionBody.data.allowed, false);
    assert.match(blockedPermissionBody.data.reason, /endpoint-screenshot-control-test/i);

    const pausedPolicyResponse = await agentRequest(`/policy/latest?device_uuid=${encodeURIComponent(deviceUuid)}`, credential);
    assert.equal(pausedPolicyResponse.status, 200);
    const pausedPolicy = (await pausedPolicyResponse.json()).data;
    assert.equal(pausedPolicy.screenshot_monitoring_enabled, false);
    assert.equal(pausedPolicy.superadmin_overrides.screenshot_monitoring_enabled.suspended, true);
  } finally {
    const resumeResponse = await adminRequest(`/employees/${consentEmployeeId}/screenshot-control`, "POST", {
      suspended: false,
      reason: overrideAuditReason,
    }, "SuperAdmin");
    assert.equal(resumeResponse.status, 200);
    await db.query(
      `DELETE FROM endpoint_policy_audit_logs
       WHERE action IN ('screenshot_monitoring_suspended','screenshot_monitoring_resumed')
         AND details->>'reason'=$1`,
      [overrideAuditReason]
    );
  }

  const resumedPermission = await agentRequest(
    `/screenshot-permission?device_uuid=${encodeURIComponent(deviceUuid)}`,
    credential
  );
  assert.equal(resumedPermission.status, 200);
  assert.equal((await resumedPermission.json()).data.allowed, true);

  const usbPermission = await agentRequest(
    `/usb-monitoring-permission?device_uuid=${encodeURIComponent(deviceUuid)}`,
    credential
  );
  assert.equal(usbPermission.status, 200);
  assert.equal((await usbPermission.json()).data.allowed, true);

  const websitePermission = await agentRequest(
    `/website-monitoring-permission?device_uuid=${encodeURIComponent(deviceUuid)}`,
    credential
  );
  assert.equal(websitePermission.status, 200);
  assert.equal((await websitePermission.json()).data.allowed, true);

  const activity = await agentRequest("/activity", credential, "POST", {
    device_uuid: deviceUuid,
    hostname,
    app_name: "Consent Policy Test",
    window_title: "Approved activity",
    idle_seconds: 5,
    occurred_at: new Date().toISOString(),
  });
  assert.equal(activity.status, 201);

  const usbReference = crypto.randomUUID();
  const usbBatch = await agentRequest("/usb-events/batch", credential, "POST", {
    device_uuid: deviceUuid,
    hostname,
    events: [{
      event_reference: usbReference,
      event_type: "file_written",
      drive_letter: "E:",
      volume_label: "PILOT USB",
      volume_serial: "TEST-USB-001",
      filesystem: "NTFS",
      file_name: "confidential-payroll.sql",
      relative_path: "exports/confidential-payroll.sql",
      extension: ".sql",
      file_size_bytes: 4096,
      file_last_write_at: new Date().toISOString(),
      occurred_at: new Date().toISOString(),
    }],
  });
  assert.equal(usbBatch.status, 201);
  const usbBatchBody = await usbBatch.json();
  assert.equal(usbBatchBody.data.accepted, 1);
  assert.equal(usbBatchBody.data.events[0].risk_level, "Critical");
  assert.equal(usbBatchBody.data.events[0].dlp_action, "alerted");

  const incidentPolicy = await db.query(
    `INSERT INTO endpoint_policies (name,description,priority,is_active,config_json,created_by,branch_id)
     VALUES ('Automated DLP Incident Test','Test-only device policy',999,true,$1::jsonb,$2,$3)
     RETURNING id`,
    [JSON.stringify({ usb_monitoring_enabled: true, auto_incident_enabled: true }), actorId, branchId]
  );
  policyIds.push(incidentPolicy.rows[0].id);
  await db.query(
    `INSERT INTO endpoint_policy_assignments (policy_id,target_type,target_id) VALUES ($1,'Device',$2)`,
    [incidentPolicy.rows[0].id, deviceUuid]
  );

  const incidentReference = crypto.randomUUID();
  const incidentBatch = await agentRequest("/usb-events/batch", credential, "POST", {
    device_uuid: deviceUuid,
    hostname,
    events: [{
      event_reference: incidentReference,
      event_type: "file_written",
      drive_letter: "E:",
      volume_label: "PILOT USB",
      volume_serial: "TEST-USB-001",
      filesystem: "NTFS",
      file_name: "restricted-employee-data.pfx",
      relative_path: "exports/restricted-employee-data.pfx",
      extension: ".pfx",
      file_size_bytes: 4096,
      file_last_write_at: new Date().toISOString(),
      occurred_at: new Date().toISOString(),
    }],
  });
  assert.equal(incidentBatch.status, 201);
  const incidentEvent = (await incidentBatch.json()).data.events[0];
  assert.equal(incidentEvent.risk_level, "Critical");
  assert.equal(incidentEvent.dlp_action, "incident_created");
  assert.ok(incidentEvent.ticket_id);
  ticketIds.push(incidentEvent.ticket_id);
  const incidentTicket = await db.query(
    `SELECT ticket_number,priority,source,title FROM tickets WHERE id=$1`,
    [incidentEvent.ticket_id]
  );
  assert.match(incidentTicket.rows[0].ticket_number, /^DLP-/);
  assert.equal(incidentTicket.rows[0].priority, "P1-Critical");
  assert.equal(incidentTicket.rows[0].source, "endpoint_monitoring");
  assert.match(incidentTicket.rows[0].title, /DLP Alert/i);

  const usbList = await adminRequest("/usb-events?risk_level=Critical");
  assert.equal(usbList.status, 200);
  assert.equal((await usbList.json()).data.some((event) => event.event_reference === usbReference), true);

  const filteredUsbList = await adminRequest("/usb-events?page=1&page_size=10&event_type=file_written&search=confidential");
  assert.equal(filteredUsbList.status, 200);
  const filteredUsbBody = await filteredUsbList.json();
  assert.equal(filteredUsbBody.pagination.page, 1);
  assert.equal(filteredUsbBody.pagination.page_size, 10);
  assert.equal(filteredUsbBody.data.some((event) => event.event_reference === usbReference), true);

  const usbOptions = await adminRequest("/usb-events/options");
  assert.equal(usbOptions.status, 200);
  const usbOptionsBody = await usbOptions.json();
  assert.equal(usbOptionsBody.data.event_types.includes("file_written"), true);
  assert.equal(usbOptionsBody.data.devices.some((device) => device.device_uuid === deviceUuid), true);

  const dlpRules = await adminRequest("/dlp-rules");
  assert.equal(dlpRules.status, 200);
  const dlpRulesBody = await dlpRules.json();
  assert.equal(dlpRulesBody.data.collection_mode, "metadata_only");
  assert.equal(dlpRulesBody.data.enforcement_mode, "detect_and_alert");
  assert.equal(dlpRulesBody.data.thresholds.critical, 70);

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

  const websiteAwaitingApproval = await agentRequest(
    `/website-monitoring-permission?device_uuid=${encodeURIComponent(deviceUuid)}`,
    credential
  );
  assert.equal(websiteAwaitingApproval.status, 200);
  assert.equal((await websiteAwaitingApproval.json()).data.allowed, false);

  await db.query(`UPDATE consent_documents SET status='withdrawn',active=false WHERE consent_id=$1`, [consentId]);
  const withdrawnUsb = await agentRequest(
    `/usb-monitoring-permission?device_uuid=${encodeURIComponent(deviceUuid)}`,
    credential
  );
  assert.equal(withdrawnUsb.status, 200);
  assert.equal((await withdrawnUsb.json()).data.allowed, false);
});
