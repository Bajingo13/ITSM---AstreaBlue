const db = require("../../config/db");

async function insertEnrollmentAudit({
  eventType,
  codeId = null,
  deviceId = null,
  actorId = null,
  sourceIp = null,
  details = {},
  client = db,
}) {
  return client.query(
    `INSERT INTO endpoint_enrollment_audit_logs
       (event_type,enrollment_code_id,device_id,actor_user_id,source_ip,details)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [eventType, codeId, deviceId, actorId, sourceIp, JSON.stringify(details)]
  );
}

async function findActiveDeviceCredential(credentialHash) {
  const result = await db.query(
    `SELECT dc.device_credential_id,dc.device_id,dc.expires_at,
            d.device_uuid,d.hostname,d.branch_id,d.enrollment_status,d.last_seen_at,d.status
     FROM endpoint_device_credentials dc
     JOIN monitored_devices d ON d.device_id=dc.device_id
     WHERE dc.credential_hash=$1 AND dc.status='Active'
       AND (dc.expires_at IS NULL OR dc.expires_at>CURRENT_TIMESTAMP)
     LIMIT 1`,
    [credentialHash]
  );
  return result.rows[0] || null;
}

async function touchDeviceCredential(deviceCredentialId, deviceId) {
  await db.query(
    `UPDATE endpoint_device_credentials SET last_used_at=CURRENT_TIMESTAMP WHERE device_credential_id=$1`,
    [deviceCredentialId]
  );
  await db.query(
    `UPDATE monitored_devices SET credential_last_seen_at=CURRENT_TIMESTAMP WHERE device_id=$1`,
    [deviceId]
  );
}

async function findCurrentConsentRequest(employeeId, deviceUuid) {
  const result = await db.query(
    `SELECT consent_id, status FROM consent_documents
     WHERE employee_id=$1 AND (device_uuid=$2::uuid OR device_uuid IS NULL)
       AND status IN ('pending_employee','pending_approval','revision_requested','approved','signed')
     ORDER BY (device_uuid IS NOT NULL) DESC, created_at DESC LIMIT 1`,
    [employeeId, deviceUuid]
  );
  return result.rows[0] || null;
}

async function findEmployeeProfile(userId) {
  const result = await db.query(
    `SELECT u.user_id, u.full_name, u.email, u.employee_number, u.department, b.branch_name
     FROM users u
     LEFT JOIN branches b ON b.branch_id = u.branch_id
     WHERE u.user_id=$1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function createGeneralConsentRequest(device, employee, actorId) {
  const result = await db.query(
    `INSERT INTO consent_documents (
       employee_id, assigned_user_id, employee_full_name, employee_email, employee_number,
       branch_id, branch_name, department, requested_at,
       requested_by, created_by, status, consent_version, form_title
     ) VALUES ($1,$1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP,$8,$8,'pending_employee','1.0',
       'RA 10173 Data Privacy Consent - Employee Monitoring')
     RETURNING consent_id, status`,
    [
      device.assigned_user_id,
      employee.full_name || "Unknown",
      employee.email || "",
      employee.employee_number || null,
      device.branch_id || null,
      employee.branch_name || null,
      device.department || employee.department || null,
      actorId || null,
    ]
  );
  return result.rows[0];
}

async function createConsentRequestAudit(consentId, employeeId, actorId) {
  return db.query(
    `INSERT INTO consent_audit_logs (consent_id, employee_id, actor_id, actor_role, event_type, details)
     VALUES ($1,$2,$3,'system','consent_request_created',$4)`,
    [
      consentId,
      employeeId,
      actorId || null,
      "General consent request created for all devices assigned to the employee.",
    ]
  );
}

async function findApprovedConsentPreferences(employeeId, deviceUuid) {
  const result = await db.query(
    `SELECT monitoring_preferences
     FROM consent_documents
     WHERE employee_id=$1 AND (device_uuid=$2::uuid OR device_uuid IS NULL) AND status IN ('approved','signed') AND active IS NOT FALSE
     ORDER BY approved_at DESC NULLS LAST, signed_at DESC NULLS LAST LIMIT 1`,
    [employeeId, deviceUuid]
  );
  return result.rows[0]?.monitoring_preferences || null;
}

async function findLegacyConsentPreferences(userId) {
  const result = await db.query(
    `SELECT application_monitoring, web_monitoring, device_telemetry, email_header_monitoring
     FROM laptop_activity_monitoring
     WHERE user_id=$1 AND consent_status='Consented'
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function findDeviceByUuid(deviceUuid) {
  const result = await db.query(
    `SELECT * FROM monitored_devices WHERE device_uuid=$1::uuid LIMIT 1`,
    [deviceUuid]
  );
  return result.rows[0] || null;
}

async function insertPolicyAudit(userId, action, targetId, details) {
  return db.query(
    `INSERT INTO endpoint_policy_audit_logs (user_id, action, target_id, details) VALUES ($1, $2, $3, $4)`,
    [userId, action, targetId, JSON.stringify(details)]
  );
}

async function findPolicyDevice(deviceUuid) {
  const result = await db.query(
    `SELECT d.*, u.department as employee_department FROM monitored_devices d
     LEFT JOIN users u ON u.user_id = d.assigned_user_id
     WHERE d.device_uuid=$1::uuid LIMIT 1`,
    [deviceUuid]
  );
  return result.rows[0] || null;
}

async function listActivePolicyAssignments() {
  const result = await db.query(
    `SELECT a.*, p.priority, p.config_json FROM endpoint_policy_assignments a
     JOIN endpoint_policies p ON p.id = a.policy_id
     WHERE p.is_active=true`
  );
  return result.rows;
}

async function findApprovedPolicyConsent(employeeId, deviceUuid) {
  const result = await db.query(
    `SELECT consent_id, consent_version, monitoring_preferences
     FROM consent_documents
     WHERE employee_id=$1
       AND (device_uuid=$2::uuid OR device_uuid IS NULL)
       AND status='approved' AND active=true
     ORDER BY (device_uuid IS NOT NULL) DESC, approved_at DESC NULLS LAST, consent_id DESC
     LIMIT 1`,
    [employeeId, deviceUuid]
  );
  return result.rows[0] || null;
}

async function findScreenshotOverride(employeeId) {
  const result = await db.query(
    `SELECT suspended,reason,updated_by,updated_at
     FROM endpoint_monitoring_overrides
     WHERE employee_id=$1 AND feature_key='screenshot_monitoring_enabled'
     LIMIT 1`,
    [employeeId]
  );
  return result.rows[0] || null;
}

async function saveEffectivePolicy(deviceUuid, policyJson) {
  return db.query(
    `INSERT INTO endpoint_effective_policies (device_uuid, policy_json, generated_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (device_uuid) DO UPDATE SET policy_json=EXCLUDED.policy_json, generated_at=CURRENT_TIMESTAMP`,
    [deviceUuid, JSON.stringify(policyJson)]
  );
}

module.exports = {
  createConsentRequestAudit,
  createGeneralConsentRequest,
  findActiveDeviceCredential,
  findApprovedConsentPreferences,
  findApprovedPolicyConsent,
  findCurrentConsentRequest,
  findDeviceByUuid,
  findEmployeeProfile,
  findLegacyConsentPreferences,
  findPolicyDevice,
  findScreenshotOverride,
  insertEnrollmentAudit,
  insertPolicyAudit,
  listActivePolicyAssignments,
  saveEffectivePolicy,
  touchDeviceCredential,
};
