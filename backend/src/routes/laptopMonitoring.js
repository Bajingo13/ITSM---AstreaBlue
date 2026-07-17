const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const db = require("../../config/db");
const { createNotification } = require("../services/notificationService");
const { reconcileDevice } = require("../services/reconciliationService");
const { deletePrivateObject, getPrivateObject, putPrivateObject } = require("../services/r2StorageService");
const { evaluateUsbTransfer } = require("../services/dlpRiskService");
const { createServiceDeskTicket } = require("../services/serviceDeskTicketService");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
const ONLINE_THRESHOLD_SECONDS = 120;
const excessiveIdleSeconds = Math.max(60, Number(process.env.MONITORING_IDLE_ALERT_SECONDS) || 3600);

const normalizeList = (value) => String(value || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
const prohibitedApps = normalizeList(process.env.MONITORING_PROHIBITED_APPS);
const prohibitedDomains = normalizeList(process.env.MONITORING_PROHIBITED_DOMAINS);

const uploadScreenshot = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, ["image/png", "image/jpeg"].includes(file.mimetype)),
}).single("screenshot");

function screenshotEncryptionKey() {
  const configured = String(process.env.SCREENSHOT_ENCRYPTION_KEY || "").trim();
  let key = null;
  if (/^[0-9a-f]{64}$/i.test(configured)) key = Buffer.from(configured, "hex");
  else if (configured) {
    try { key = Buffer.from(configured, "base64"); } catch { key = null; }
  }
  if (!key || key.length !== 32) {
    const error = new Error("SCREENSHOT_ENCRYPTION_KEY must be a base64 or hexadecimal 32-byte key.");
    error.code = "SCREENSHOT_ENCRYPTION_NOT_CONFIGURED";
    throw error;
  }
  return key;
}

function encryptScreenshot(bytes) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", screenshotEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return {
    ciphertext,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function decryptScreenshot(bytes, iv, authTag) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", screenshotEncryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([decipher.update(bytes), decipher.final()]);
}

const tablesReady = (async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS monitored_devices (
        device_id BIGSERIAL PRIMARY KEY, hostname VARCHAR(255) NOT NULL UNIQUE,
        device_uuid UUID, device_name VARCHAR(255), logged_in_user VARCHAR(255),
        assigned_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
        asset_id INTEGER, department VARCHAR(255),
        agent_version VARCHAR(50), last_seen_at TIMESTAMPTZ,
        status VARCHAR(20) NOT NULL DEFAULT 'Offline', consent_status VARCHAR(30) NOT NULL DEFAULT 'Pending',
        last_policy_sync_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS laptop_activity_logs (
        id BIGSERIAL PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        event_type VARCHAR(50) NOT NULL DEFAULT 'activity', app_name VARCHAR(255), window_title VARCHAR(500),
        idle_seconds INTEGER NOT NULL DEFAULT 0, url_domain VARCHAR(255),
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS laptop_screenshots (
        id BIGSERIAL PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        file_url TEXT, file_path TEXT, thumbnail_path TEXT,
        assigned_user_id INTEGER, branch_id INTEGER, department VARCHAR(255),
        captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reason VARCHAR(255), created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS laptop_screenshots_captured_idx ON laptop_screenshots(captured_at DESC);
      CREATE INDEX IF NOT EXISTS laptop_screenshots_device_captured_idx ON laptop_screenshots(device_id, captured_at DESC);
      CREATE TABLE IF NOT EXISTS laptop_alerts (
        id BIGSERIAL PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        severity VARCHAR(20) NOT NULL, alert_type VARCHAR(100) NOT NULL, message TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'Open', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS endpoint_usb_events (
        id BIGSERIAL PRIMARY KEY,
        event_reference UUID NOT NULL UNIQUE,
        device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        device_uuid UUID,
        assigned_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
        department VARCHAR(255),
        event_type VARCHAR(50) NOT NULL,
        drive_letter VARCHAR(10), volume_label VARCHAR(255), volume_serial VARCHAR(100), filesystem VARCHAR(50),
        file_name VARCHAR(500), relative_path TEXT, extension VARCHAR(50), file_size_bytes BIGINT,
        file_last_write_at TIMESTAMPTZ,
        risk_score INTEGER NOT NULL DEFAULT 0, risk_level VARCHAR(20) NOT NULL DEFAULT 'Low',
        rule_matches JSONB NOT NULL DEFAULT '[]'::jsonb,
        dlp_action VARCHAR(50) NOT NULL DEFAULT 'logged',
        alert_id BIGINT REFERENCES laptop_alerts(id) ON DELETE SET NULL,
        ticket_id BIGINT,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS endpoint_usb_events_device_time_idx ON endpoint_usb_events(device_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS endpoint_usb_events_branch_risk_idx ON endpoint_usb_events(branch_id, risk_level, occurred_at DESC);
      CREATE TABLE IF NOT EXISTS endpoint_hardware_inventory (
        id BIGSERIAL PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        device_uuid UUID, asset_id INTEGER,
        manufacturer VARCHAR(255), model VARCHAR(255), serial_number VARCHAR(255),
        cpu_name VARCHAR(255), total_ram_gb NUMERIC(8,2),
        os_name VARCHAR(255), os_version VARCHAR(255), os_build VARCHAR(255), architecture VARCHAR(50),
        disk_total_gb NUMERIC(10,2), disk_free_gb NUMERIC(10,2),
        mac_address VARCHAR(255), ip_address VARCHAR(255),
        scanned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS endpoint_software_scan_runs (
        id BIGSERIAL PRIMARY KEY,
        device_uuid UUID,
        device_id BIGINT REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        scan_started_at TIMESTAMPTZ,
        scan_completed_at TIMESTAMPTZ,
        software_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS endpoint_software_inventory (
        id BIGSERIAL PRIMARY KEY,
        device_uuid UUID,
        device_id BIGINT REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        asset_id INTEGER,
        assigned_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
        department_id INTEGER,
        department VARCHAR(255),
        software_name VARCHAR(500) NOT NULL,
        version VARCHAR(255),
        publisher VARCHAR(255),
        install_date VARCHAR(80),
        install_location TEXT,
        source VARCHAR(80),
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(30) NOT NULL DEFAULT 'active',
        compliance_status VARCHAR(50) NOT NULL DEFAULT 'unknown',
        risk_level VARCHAR(50) NOT NULL DEFAULT 'unknown',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      
      ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS asset_id INTEGER;
      ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS department VARCHAR(255);
      ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS last_policy_sync_at TIMESTAMPTZ;
      ALTER TABLE endpoint_software_inventory ADD COLUMN IF NOT EXISTS department_id INTEGER;
      ALTER TABLE endpoint_software_inventory ADD COLUMN IF NOT EXISTS department VARCHAR(255);
      ALTER TABLE endpoint_software_inventory ADD COLUMN IF NOT EXISTS compliance_status VARCHAR(50) NOT NULL DEFAULT 'unknown';
      ALTER TABLE endpoint_software_inventory ADD COLUMN IF NOT EXISTS risk_level VARCHAR(50) NOT NULL DEFAULT 'unknown';
      ALTER TABLE endpoint_software_inventory ADD COLUMN IF NOT EXISTS notes TEXT;
      CREATE INDEX IF NOT EXISTS endpoint_software_device_idx ON endpoint_software_inventory(device_uuid, status);
      CREATE INDEX IF NOT EXISTS endpoint_software_branch_idx ON endpoint_software_inventory(branch_id);
      CREATE INDEX IF NOT EXISTS endpoint_software_name_idx ON endpoint_software_inventory(LOWER(software_name));
      
      CREATE TABLE IF NOT EXISTS monitoring_consents (
        id BIGSERIAL PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, consent_type VARCHAR(50) NOT NULL,
        consent_status VARCHAR(30) NOT NULL DEFAULT 'Pending', consented_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(device_id,user_id,consent_type)
      );
      CREATE TABLE IF NOT EXISTS asset_inventory_reconciliation (
        id BIGSERIAL PRIMARY KEY,
        asset_id INTEGER REFERENCES hardware_assets(asset_id) ON DELETE CASCADE,
        device_uuid UUID,
        device_id BIGINT REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        field_name VARCHAR(100) NOT NULL,
        asset_value TEXT,
        detected_value TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'Unknown',
        severity VARCHAR(50) NOT NULL DEFAULT 'None',
        checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS asset_inventory_history (
        id BIGSERIAL PRIMARY KEY,
        asset_id INTEGER REFERENCES hardware_assets(asset_id) ON DELETE CASCADE,
        device_uuid UUID,
        field_name VARCHAR(100) NOT NULL,
        old_value TEXT,
        new_value TEXT,
        source VARCHAR(100),
        detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`
      ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS device_uuid UUID;
      ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS device_name VARCHAR(255);
      ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS logged_in_user VARCHAR(255);
      ALTER TABLE monitored_devices DROP CONSTRAINT IF EXISTS monitored_devices_hostname_key;
      CREATE UNIQUE INDEX IF NOT EXISTS monitored_devices_device_uuid_uidx ON monitored_devices(device_uuid) WHERE device_uuid IS NOT NULL;
      CREATE INDEX IF NOT EXISTS monitored_devices_hostname_idx ON monitored_devices(LOWER(hostname));
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS branch_id INTEGER;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS department VARCHAR(255);
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS object_key TEXT;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS encryption_algorithm VARCHAR(50);
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS encryption_iv TEXT;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS encryption_auth_tag TEXT;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS plaintext_sha256 VARCHAR(64);
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS content_type VARCHAR(100);
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

      ALTER TABLE laptop_activity_logs ADD COLUMN IF NOT EXISTS device_uuid UUID;
      ALTER TABLE laptop_activity_logs ADD COLUMN IF NOT EXISTS asset_id INTEGER;
      ALTER TABLE laptop_activity_logs ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER;
      ALTER TABLE laptop_activity_logs ADD COLUMN IF NOT EXISTS current_logged_in_user VARCHAR(255);
      ALTER TABLE laptop_activity_logs ADD COLUMN IF NOT EXISTS branch_id INTEGER;
      ALTER TABLE laptop_activity_logs ADD COLUMN IF NOT EXISTS department VARCHAR(255);
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS device_id BIGINT;


      
      CREATE TABLE IF NOT EXISTS monitoring_consents (
        id BIGSERIAL PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, consent_type VARCHAR(50) NOT NULL,
        consent_status VARCHAR(30) NOT NULL DEFAULT 'Pending', consented_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(device_id,user_id,consent_type)
      );
      CREATE TABLE IF NOT EXISTS asset_inventory_reconciliation (
        id BIGSERIAL PRIMARY KEY,
        asset_id INTEGER REFERENCES hardware_assets(asset_id) ON DELETE CASCADE,
        device_uuid UUID,
        device_id BIGINT REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        field_name VARCHAR(100) NOT NULL,
        asset_value TEXT,
        detected_value TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'Unknown',
        severity VARCHAR(50) NOT NULL DEFAULT 'None',
        checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS asset_inventory_history (
        id BIGSERIAL PRIMARY KEY,
        asset_id INTEGER REFERENCES hardware_assets(asset_id) ON DELETE CASCADE,
        device_uuid UUID,
        field_name VARCHAR(100) NOT NULL,
        old_value TEXT,
        new_value TEXT,
        source VARCHAR(100),
        detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`
      ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS device_uuid UUID;
      ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS device_name VARCHAR(255);
      ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS logged_in_user VARCHAR(255);
      ALTER TABLE monitored_devices DROP CONSTRAINT IF EXISTS monitored_devices_hostname_key;
      CREATE UNIQUE INDEX IF NOT EXISTS monitored_devices_device_uuid_uidx ON monitored_devices(device_uuid) WHERE device_uuid IS NOT NULL;
      CREATE INDEX IF NOT EXISTS monitored_devices_hostname_idx ON monitored_devices(LOWER(hostname));
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS branch_id INTEGER;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS department VARCHAR(255);
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS object_key TEXT;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS encryption_algorithm VARCHAR(50);
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS encryption_iv TEXT;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS encryption_auth_tag TEXT;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS plaintext_sha256 VARCHAR(64);
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS content_type VARCHAR(100);
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

      ALTER TABLE laptop_activity_logs ADD COLUMN IF NOT EXISTS device_uuid UUID;
      ALTER TABLE laptop_activity_logs ADD COLUMN IF NOT EXISTS asset_id INTEGER;
      ALTER TABLE laptop_activity_logs ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER;
      ALTER TABLE laptop_activity_logs ADD COLUMN IF NOT EXISTS current_logged_in_user VARCHAR(255);
      ALTER TABLE laptop_activity_logs ADD COLUMN IF NOT EXISTS branch_id INTEGER;
      ALTER TABLE laptop_activity_logs ADD COLUMN IF NOT EXISTS department VARCHAR(255);

      CREATE TABLE IF NOT EXISTS monitored_device_assignments (
        id BIGSERIAL PRIMARY KEY,
        device_id BIGINT REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        device_uuid UUID,
        asset_id INTEGER,
        old_user_id INTEGER,
        new_user_id INTEGER,
        old_branch_id INTEGER,
        new_branch_id INTEGER,
        old_department VARCHAR(255),
        new_department VARCHAR(255),
        reason TEXT,
        changed_by INTEGER,
        changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS endpoint_policies (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT true,
        config_json JSONB NOT NULL DEFAULT '{}',
        created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        branch_id INTEGER REFERENCES branches(branch_id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS endpoint_policy_assignments (
        id BIGSERIAL PRIMARY KEY,
        policy_id BIGINT REFERENCES endpoint_policies(id) ON DELETE CASCADE,
        target_type VARCHAR(50) NOT NULL,
        target_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS endpoint_effective_policies (
        device_uuid UUID PRIMARY KEY,
        policy_json JSONB NOT NULL,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS endpoint_policy_audit_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER,
        action VARCHAR(100) NOT NULL,
        target_id VARCHAR(255),
        details JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS endpoint_monitoring_overrides (
        id BIGSERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        feature_key VARCHAR(100) NOT NULL,
        suspended BOOLEAN NOT NULL DEFAULT true,
        reason TEXT,
        updated_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, feature_key)
      );
      CREATE INDEX IF NOT EXISTS endpoint_monitoring_overrides_employee_idx
        ON endpoint_monitoring_overrides(employee_id, feature_key);
    `);
    return true;
  } catch (error) {
    console.error("[laptop-monitoring] table initialization failed:", error.message);
    return false;
  }
})();

router.use(async (_req, res, next) => {
  if (await tablesReady) return next();
  return res.status(503).json({ success: false, message: "Laptop monitoring storage is unavailable." });
});

function safeEqual(value, expected) {
  const left = Buffer.from(String(value || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function secretHash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function randomCredential(prefix, bytes = 32) {
  return `${prefix}-${crypto.randomBytes(bytes).toString("base64url")}`;
}

function requestIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0].trim().slice(0, 80) || null;
}

async function recordEnrollmentAudit(eventType, { codeId = null, deviceId = null, actorId = null, req = null, details = {} } = {}, client = db) {
  await client.query(
    `INSERT INTO endpoint_enrollment_audit_logs
       (event_type,enrollment_code_id,device_id,actor_user_id,source_ip,details)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [eventType, codeId, deviceId, actorId, req ? requestIp(req) : null, JSON.stringify(details)]
  );
}

async function requireAgent(req, res, next) {
  const expected = process.env.MONITORING_AGENT_TOKEN;
  const supplied = String(req.headers["x-agent-token"] || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "")).trim();
  if (!supplied) return res.status(401).json({ success: false, message: "Monitoring agent authentication is required." });

  try {
    if (supplied.startsWith("ABDEV-")) {
      const credential = await db.query(
        `SELECT dc.device_credential_id,dc.device_id,dc.expires_at,
                d.device_uuid,d.hostname,d.branch_id,d.enrollment_status
         FROM endpoint_device_credentials dc
         JOIN monitored_devices d ON d.device_id=dc.device_id
         WHERE dc.credential_hash=$1 AND dc.status='Active'
           AND (dc.expires_at IS NULL OR dc.expires_at>CURRENT_TIMESTAMP)
         LIMIT 1`,
        [secretHash(supplied)]
      );
      if (!credential.rows.length) {
        return res.status(401).json({ success: false, message: "Invalid or revoked device credential." });
      }
      const device = credential.rows[0];
      const claimedUuid = String(req.body?.device_uuid || req.query?.device_uuid || "").trim().toLowerCase();
      const isMultipartUpload = String(req.headers["content-type"] || "").toLowerCase().startsWith("multipart/form-data");
      if (!claimedUuid && !isMultipartUpload) {
        return res.status(400).json({ success: false, message: "device_uuid is required with a device credential." });
      }
      if (claimedUuid && claimedUuid !== String(device.device_uuid || "").toLowerCase()) {
        await recordEnrollmentAudit("credential_device_mismatch", {
          deviceId: device.device_id,
          req,
          details: { claimed_device_uuid: claimedUuid },
        }).catch(() => null);
        return res.status(403).json({ success: false, message: "Device credential does not match the requested device." });
      }
      await db.query(
        `UPDATE endpoint_device_credentials SET last_used_at=CURRENT_TIMESTAMP WHERE device_credential_id=$1`,
        [device.device_credential_id]
      );
      await db.query(
        `UPDATE monitored_devices SET credential_last_seen_at=CURRENT_TIMESTAMP WHERE device_id=$1`,
        [device.device_id]
      );
      req.agentDevice = device;
      req.agentAuthentication = "device_credential";
      return next();
    }

    if (expected && safeEqual(supplied, expected)) {
      req.agentAuthentication = "legacy_global_token";
      return next();
    }
    if (!expected) {
      return res.status(503).json({ success: false, message: "Legacy monitoring-agent authentication is not configured." });
    }
    return res.status(401).json({ success: false, message: "Invalid monitoring agent token." });
  } catch (error) {
    console.error("[laptop-monitoring:agent-auth]", error.message);
    return res.status(503).json({ success: false, message: "Monitoring agent authentication is temporarily unavailable." });
  }
}

function requireAdmin(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";
    if (!authorization.startsWith("Bearer ")) throw new Error("Authentication required.");
    const user = jwt.verify(authorization.slice(7), JWT_SECRET);
    const role = String(user.role || "").toLowerCase().replace(/[\s_-]/g, "");
    if (!["superadmin", "admin", "technician", "employee"].includes(role)) return res.status(403).json({ success: false, message: "Monitoring access required." });
    req.monitoringUser = user;
    req.monitoringRole = role;
    req.monitoringUserId = user.userId || user.user_id || null;
    req.monitoringIsSuperAdmin = role === "superadmin";
    req.monitoringIsEmployee = role === "employee";
    req.monitoringBranchId = (role === "admin" || role === "technician") ? user.branchId : null;
    return next();
  } catch (_error) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
}

function requireSuperAdmin(req, res, next) {
  return requireAdmin(req, res, () => {
    if (!req.monitoringIsSuperAdmin) {
      return res.status(403).json({ success: false, error: "SuperAdmin access required." });
    }
    return next();
  });
}

function requireEnrollmentAdmin(req, res, next) {
  return requireAdmin(req, res, () => {
    if (!req.monitoringIsSuperAdmin && req.monitoringRole !== "admin") {
      return res.status(403).json({ success: false, message: "Administrator access is required." });
    }
    if (req.monitoringRole === "admin" && !req.monitoringBranchId) {
      return res.status(403).json({ success: false, message: "Administrator branch assignment is required." });
    }
    return next();
  });
}

function enrollmentScope(req, alias = "ec") {
  if (req.monitoringIsSuperAdmin) return { clause: "", params: [] };
  return { clause: `WHERE ${alias}.branch_id=$1`, params: [req.monitoringBranchId] };
}

router.post("/enrollment-codes", requireEnrollmentAdmin, async (req, res) => {
  try {
    const requestedBranch = Number(req.body?.branch_id) || null;
    const branchId = req.monitoringIsSuperAdmin ? requestedBranch : req.monitoringBranchId;
    if (branchId) {
      const branch = await db.query(`SELECT branch_id FROM branches WHERE branch_id=$1`, [branchId]);
      if (!branch.rows.length) return res.status(400).json({ success: false, message: "Branch not found." });
    }
    const lifetimeMinutes = Math.min(1440, Math.max(5, Number(req.body?.expires_in_minutes) || 15));
    const intendedHostname = String(req.body?.intended_hostname || "").trim().slice(0, 255) || null;
    const code = randomCredential("ABENR", 24);
    const created = await db.query(
      `INSERT INTO endpoint_enrollment_codes
         (code_hash,code_prefix,branch_id,intended_hostname,expires_at,created_by)
       VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP+($5::text || ' minutes')::interval,$6)
       RETURNING enrollment_code_id,code_prefix,branch_id,intended_hostname,status,expires_at,created_at`,
      [secretHash(code), code.slice(0, 18), branchId, intendedHostname, lifetimeMinutes, req.monitoringUserId]
    );
    await recordEnrollmentAudit("enrollment_code_created", {
      codeId: created.rows[0].enrollment_code_id,
      actorId: req.monitoringUserId,
      req,
      details: { branch_id: branchId, intended_hostname: intendedHostname, lifetime_minutes: lifetimeMinutes },
    });
    return res.status(201).json({
      success: true,
      message: "Enrollment code created. It is shown only once.",
      data: { ...created.rows[0], enrollment_code: code },
    });
  } catch (error) {
    console.error("[laptop-monitoring:enrollment-code-create]", error.message);
    return res.status(500).json({ success: false, message: "Failed to create enrollment code." });
  }
});

router.get("/enrollment-codes", requireEnrollmentAdmin, async (req, res) => {
  try {
    await db.query(`UPDATE endpoint_enrollment_codes SET status='Expired' WHERE status='Active' AND expires_at<=CURRENT_TIMESTAMP`);
    const scope = enrollmentScope(req);
    const result = await db.query(
      `SELECT ec.enrollment_code_id,ec.code_prefix,ec.branch_id,b.branch_name,
              ec.intended_hostname,ec.status,ec.expires_at,ec.created_by,
              creator.full_name AS created_by_name,ec.created_at,ec.used_at,
              ec.used_by_device_id,ec.revoked_at,ec.revocation_reason
       FROM endpoint_enrollment_codes ec
       LEFT JOIN branches b ON b.branch_id=ec.branch_id
       LEFT JOIN users creator ON creator.user_id=ec.created_by
       ${scope.clause}
       ORDER BY ec.created_at DESC LIMIT 200`,
      scope.params
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("[laptop-monitoring:enrollment-code-list]", error.message);
    return res.status(500).json({ success: false, message: "Failed to list enrollment codes." });
  }
});

router.post("/enrollment-codes/:id/revoke", requireEnrollmentAdmin, async (req, res) => {
  try {
    const params = [req.params.id];
    let branchClause = "";
    if (!req.monitoringIsSuperAdmin) {
      params.push(req.monitoringBranchId);
      branchClause = ` AND branch_id=$${params.length}`;
    }
    params.push(req.monitoringUserId, String(req.body?.reason || "Revoked by administrator.").trim().slice(0, 1000));
    const result = await db.query(
      `UPDATE endpoint_enrollment_codes
       SET status='Revoked',revoked_at=CURRENT_TIMESTAMP,revoked_by=$${params.length - 1},revocation_reason=$${params.length}
       WHERE enrollment_code_id=$1 AND status='Active'${branchClause}
       RETURNING enrollment_code_id,status,revoked_at`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Active enrollment code not found." });
    await recordEnrollmentAudit("enrollment_code_revoked", {
      codeId: result.rows[0].enrollment_code_id,
      actorId: req.monitoringUserId,
      req,
      details: { reason: params[params.length - 1] },
    });
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("[laptop-monitoring:enrollment-code-revoke]", error.message);
    return res.status(500).json({ success: false, message: "Failed to revoke enrollment code." });
  }
});

router.post("/enroll", async (req, res) => {
  const enrollmentCode = String(req.body?.enrollment_code || "").trim();
  const deviceUuid = String(req.body?.device_uuid || "").trim().toLowerCase();
  const hostname = String(req.body?.hostname || req.body?.device_name || "").trim().slice(0, 255);
  const deviceName = String(req.body?.device_name || hostname).trim().slice(0, 255);
  const agentVersion = String(req.body?.agent_version || "unknown").trim().slice(0, 50);
  if (!enrollmentCode || !hostname || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceUuid)) {
    return res.status(400).json({ success: false, message: "Enrollment code, hostname, and valid device_uuid are required." });
  }

  const client = await db.rawPool.connect();
  try {
    await client.query("BEGIN");
    const codeResult = await client.query(
      `SELECT * FROM endpoint_enrollment_codes WHERE code_hash=$1 FOR UPDATE`,
      [secretHash(enrollmentCode)]
    );
    const code = codeResult.rows[0];
    if (!code || code.status !== "Active" || new Date(code.expires_at).getTime() <= Date.now()) {
      if (code?.status === "Active") await client.query(`UPDATE endpoint_enrollment_codes SET status='Expired' WHERE enrollment_code_id=$1`, [code.enrollment_code_id]);
      await client.query("COMMIT");
      return res.status(401).json({ success: false, message: "Enrollment code is invalid, expired, used, or revoked." });
    }
    if (code.intended_hostname && code.intended_hostname.toLowerCase() !== hostname.toLowerCase()) {
      await recordEnrollmentAudit("enrollment_hostname_mismatch", {
        codeId: code.enrollment_code_id,
        req,
        details: { expected_hostname: code.intended_hostname, supplied_hostname: hostname },
      }, client);
      await client.query("COMMIT");
      return res.status(403).json({ success: false, message: "Enrollment code is restricted to another hostname." });
    }

    let deviceResult = await client.query(`SELECT * FROM monitored_devices WHERE device_uuid=$1::uuid FOR UPDATE`, [deviceUuid]);
    if (deviceResult.rows.length) {
      deviceResult = await client.query(
        `UPDATE monitored_devices SET hostname=$1,device_name=$2,agent_version=$3,
           branch_id=COALESCE(branch_id,$4),enrollment_status='Enrolled',enrolled_at=CURRENT_TIMESTAMP,
           updated_at=CURRENT_TIMESTAMP WHERE device_id=$5 RETURNING *`,
        [hostname, deviceName, agentVersion, code.branch_id, deviceResult.rows[0].device_id]
      );
    } else {
      deviceResult = await client.query(
        `INSERT INTO monitored_devices
           (device_uuid,hostname,device_name,agent_version,branch_id,status,enrollment_status,enrolled_at)
         VALUES ($1::uuid,$2,$3,$4,$5,'Offline','Enrolled',CURRENT_TIMESTAMP) RETURNING *`,
        [deviceUuid, hostname, deviceName, agentVersion, code.branch_id]
      );
    }
    const device = deviceResult.rows[0];
    await client.query(
      `UPDATE endpoint_device_credentials SET status='Rotated',rotated_at=CURRENT_TIMESTAMP
       WHERE device_id=$1 AND status='Active'`,
      [device.device_id]
    );
    const deviceCredential = randomCredential("ABDEV", 32);
    const credential = await client.query(
      `INSERT INTO endpoint_device_credentials
         (device_id,credential_hash,credential_prefix,status)
       VALUES ($1,$2,$3,'Active')
       RETURNING device_credential_id,credential_prefix,status,issued_at`,
      [device.device_id, secretHash(deviceCredential), deviceCredential.slice(0, 18)]
    );
    await client.query(
      `UPDATE endpoint_enrollment_codes SET status='Used',used_at=CURRENT_TIMESTAMP,used_by_device_id=$1
       WHERE enrollment_code_id=$2`,
      [device.device_id, code.enrollment_code_id]
    );
    await recordEnrollmentAudit("device_enrolled", {
      codeId: code.enrollment_code_id,
      deviceId: device.device_id,
      req,
      details: { device_uuid: deviceUuid, hostname, agent_version: agentVersion },
    }, client);
    await client.query("COMMIT");
    return res.status(201).json({
      success: true,
      message: "Device enrolled. The device credential is shown only once.",
      data: {
        device_id: device.device_id,
        device_uuid: device.device_uuid,
        hostname: device.hostname,
        branch_id: device.branch_id,
        enrollment_status: device.enrollment_status,
        device_credential: deviceCredential,
        credential: credential.rows[0],
      },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    console.error("[laptop-monitoring:device-enroll]", error.message);
    return res.status(500).json({ success: false, message: "Failed to enroll device." });
  } finally {
    client.release();
  }
});

async function loadManagedDevice(req, deviceId) {
  const result = await db.query(`SELECT * FROM monitored_devices WHERE device_id=$1`, [deviceId]);
  const device = result.rows[0];
  if (!device) return { error: { status: 404, message: "Device not found." } };
  if (!req.monitoringIsSuperAdmin && String(device.branch_id || "") !== String(req.monitoringBranchId || "")) {
    return { error: { status: 403, message: "Device belongs to another branch." } };
  }
  return { device };
}

router.get("/devices/:id/credentials", requireEnrollmentAdmin, async (req, res) => {
  try {
    const managed = await loadManagedDevice(req, req.params.id);
    if (managed.error) return res.status(managed.error.status).json({ success: false, message: managed.error.message });
    const result = await db.query(
      `SELECT device_credential_id,credential_prefix,status,issued_at,expires_at,last_used_at,rotated_at,revoked_at,revocation_reason
       FROM endpoint_device_credentials WHERE device_id=$1 ORDER BY issued_at DESC`,
      [req.params.id]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load device credentials." });
  }
});

router.post("/devices/:id/credentials/rotate", requireEnrollmentAdmin, async (req, res) => {
  const client = await db.rawPool.connect();
  try {
    const managed = await loadManagedDevice(req, req.params.id);
    if (managed.error) return res.status(managed.error.status).json({ success: false, message: managed.error.message });
    await client.query("BEGIN");
    await client.query(`UPDATE endpoint_device_credentials SET status='Rotated',rotated_at=CURRENT_TIMESTAMP WHERE device_id=$1 AND status='Active'`, [req.params.id]);
    const deviceCredential = randomCredential("ABDEV", 32);
    const created = await client.query(
      `INSERT INTO endpoint_device_credentials (device_id,credential_hash,credential_prefix,status)
       VALUES ($1,$2,$3,'Active') RETURNING device_credential_id,credential_prefix,status,issued_at`,
      [req.params.id, secretHash(deviceCredential), deviceCredential.slice(0, 18)]
    );
    await client.query(`UPDATE monitored_devices SET enrollment_status='Enrolled' WHERE device_id=$1`, [req.params.id]);
    await recordEnrollmentAudit("device_credential_rotated", { deviceId: req.params.id, actorId: req.monitoringUserId, req }, client);
    await client.query("COMMIT");
    return res.json({ success: true, message: "Credential rotated. The new value is shown only once.", data: { ...created.rows[0], device_credential: deviceCredential } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    return res.status(500).json({ success: false, message: "Failed to rotate device credential." });
  } finally {
    client.release();
  }
});

router.post("/devices/:id/credentials/revoke", requireEnrollmentAdmin, async (req, res) => {
  try {
    const managed = await loadManagedDevice(req, req.params.id);
    if (managed.error) return res.status(managed.error.status).json({ success: false, message: managed.error.message });
    const reason = String(req.body?.reason || "Revoked by administrator.").trim().slice(0, 1000);
    const result = await db.query(
      `UPDATE endpoint_device_credentials SET status='Revoked',revoked_at=CURRENT_TIMESTAMP,
         revoked_by=$2,revocation_reason=$3 WHERE device_id=$1 AND status='Active'
       RETURNING device_credential_id,status,revoked_at`,
      [req.params.id, req.monitoringUserId, reason]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Active device credential not found." });
    await db.query(`UPDATE monitored_devices SET enrollment_status='Revoked' WHERE device_id=$1`, [req.params.id]);
    await recordEnrollmentAudit("device_credential_revoked", { deviceId: req.params.id, actorId: req.monitoringUserId, req, details: { reason } });
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to revoke device credential." });
  }
});

function hasPreference(prefs, ...names) {
  return Array.isArray(prefs) && names.some((name) => prefs.includes(name));
}

async function ensureConsentRequestForDevice(device, actorId) {
  if (!device?.assigned_user_id || !device?.device_uuid || !device?.asset_id) return null;

  const existing = await db.query(
    `SELECT consent_id, status FROM consent_documents
     WHERE employee_id=$1 AND (device_uuid=$2::uuid OR device_uuid IS NULL)
       AND status IN ('pending_employee','pending_approval','revision_requested','approved','signed')
     ORDER BY created_at DESC LIMIT 1`,
    [device.assigned_user_id, device.device_uuid]
  );
  if (existing.rows.length) return existing.rows[0];

  const profile = await db.query(
    `SELECT u.user_id, u.full_name, u.email, u.employee_number, u.department, b.branch_name
     FROM users u
     LEFT JOIN branches b ON b.branch_id = u.branch_id
     WHERE u.user_id=$1`,
    [device.assigned_user_id]
  );
  if (!profile.rows.length) return null;
  const employee = profile.rows[0];

  const created = await db.query(
    `INSERT INTO consent_documents (
       employee_id, assigned_user_id, employee_full_name, employee_email, employee_number,
       branch_id, branch_name, department, device_uuid, device_id, asset_id, requested_at,
       requested_by, created_by, status, consent_version, form_title, hostname
     ) VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_TIMESTAMP,$11,$11,'pending_employee','1.0',
       'RA 10173 Data Privacy Consent - Employee Monitoring',$12)
     RETURNING consent_id, status`,
    [
      device.assigned_user_id,
      employee.full_name || "Unknown",
      employee.email || "",
      employee.employee_number || null,
      device.branch_id || null,
      employee.branch_name || null,
      device.department || employee.department || null,
      device.device_uuid,
      device.device_id,
      device.asset_id,
      actorId || null,
      device.hostname || null,
    ]
  );

  await db.query(
    `INSERT INTO consent_audit_logs (consent_id, employee_id, actor_id, actor_role, event_type, details)
     VALUES ($1,$2,$3,'system','consent_request_created',$4)`,
    [
      created.rows[0].consent_id,
      device.assigned_user_id,
      actorId || null,
      `Consent request created for device ${device.hostname || device.device_uuid}.`,
    ]
  ).catch((error) => console.error("[laptop-monitoring:consent-audit]", error.message));

  if (typeof createNotification === "function") {
    await createNotification({
      userId: device.assigned_user_id,
      title: "Monitoring agreement required",
      message: "Your assigned company device requires a monitoring agreement before advanced monitoring can begin.",
      type: "privacy_consent",
      metadata: { consentId: created.rows[0].consent_id, deviceUuid: device.device_uuid, assetId: device.asset_id },
      dedupeKey: `consent-request-${device.device_uuid}-${device.assigned_user_id}`,
    }).catch((error) => console.error("[laptop-monitoring:consent-notification]", error.message));
  }

  return created.rows[0];
}

async function getApprovedConsentPreferences(device) {
  if (!device?.assigned_user_id || !device?.device_uuid) return [];
  const result = await db.query(
    `SELECT monitoring_preferences
     FROM consent_documents
     WHERE employee_id=$1 AND (device_uuid=$2::uuid OR device_uuid IS NULL) AND status IN ('approved','signed') AND active IS NOT FALSE
     ORDER BY approved_at DESC NULLS LAST, signed_at DESC NULLS LAST LIMIT 1`,
    [device.assigned_user_id, device.device_uuid]
  );
  if (result.rows.length) {
    return result.rows[0]?.monitoring_preferences || [];
  }
  
  const legacy = await db.query(
    `SELECT application_monitoring, web_monitoring, device_telemetry, email_header_monitoring
     FROM laptop_activity_monitoring 
     WHERE user_id=$1 AND consent_status='Consented' 
     ORDER BY created_at DESC LIMIT 1`,
    [device.assigned_user_id]
  );
  
  if (legacy.rows.length) {
    const l = legacy.rows[0];
    const prefs = [];
    if (l.application_monitoring) prefs.push("application_monitoring");
    if (l.web_monitoring) prefs.push("website_monitoring");
    if (l.device_telemetry) prefs.push("device_telemetry");
    if (l.email_header_monitoring) prefs.push("email_header_monitoring");
    return prefs;
  }
  
  return [];
}

function softwareScope(req, alias = "si") {
  const conditions = [];
  const params = [];
  if (!req.monitoringIsSuperAdmin && req.monitoringBranchId) {
    params.push(req.monitoringBranchId);
    conditions.push(`${alias}.branch_id=$${params.length}`);
  }
  if (req.monitoringIsEmployee) {
    params.push(req.monitoringUserId);
    conditions.push(`${alias}.assigned_user_id=$${params.length}`);
  }
  return { conditions, params };
}

function minutesSince(value) {
  if (!value) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
}

function healthItem(label, timestamp, warningMinutes, criticalMinutes, missingStatus = "Warning") {
  const ageMinutes = minutesSince(timestamp);
  if (ageMinutes === null) {
    return {
      label,
      status: missingStatus,
      last_seen_at: null,
      age_minutes: null,
      message: `${label} has not reported yet.`,
    };
  }
  if (criticalMinutes && ageMinutes > criticalMinutes) {
    return {
      label,
      status: "Critical",
      last_seen_at: timestamp,
      age_minutes: ageMinutes,
      message: `${label} is stale for ${ageMinutes} minutes.`,
    };
  }
  if (warningMinutes && ageMinutes > warningMinutes) {
    return {
      label,
      status: "Warning",
      last_seen_at: timestamp,
      age_minutes: ageMinutes,
      message: `${label} is stale for ${ageMinutes} minutes.`,
    };
  }
  return {
    label,
    status: "Healthy",
    last_seen_at: timestamp,
    age_minutes: ageMinutes,
    message: `${label} is current.`,
  };
}

function consentHealth(status) {
  const normalized = String(status || "").toLowerCase();
  if (["signed", "approved", "granted", "consented"].includes(normalized)) {
    return { label: "Consent", status: "Healthy", consent_status: status, message: "Consent is active." };
  }
  if (["pending", "pending_employee", "pending_approval", ""].includes(normalized)) {
    return { label: "Consent", status: "Information", consent_status: status || "Pending", message: "Consent is pending." };
  }
  return { label: "Consent", status: "Warning", consent_status: status || "Pending", message: "Consent needs review." };
}

function buildEndpointHealth(row) {
  const policyJson = row.policy_json || {};
  const heartbeat = healthItem("Heartbeat", row.last_seen_at, 2, 5, "Offline");
  if (heartbeat.status === "Critical") heartbeat.status = "Critical";
  const activityFeature = policyJson.features?.activity_monitoring_enabled;
  const activityEnabled = activityFeature?.enabled === true || policyJson.activity_monitoring_enabled === true;
  const disabledActivityReason = activityFeature?.reason || policyJson.reasons?.activity_monitoring_enabled || "Activity monitoring is not enabled by the effective policy.";
  const activity = activityEnabled
    ? healthItem("Activity", row.last_activity_at, 10, null, "Warning")
    : { label: "Activity", status: "Disabled", last_seen_at: row.last_activity_at || null, age_minutes: null, message: disabledActivityReason };
  const idleDetection = activityEnabled
    ? healthItem("Idle Detection", row.last_idle_detection_at || row.last_activity_at, 10, null, "Warning")
    : { label: "Idle Detection", status: "Disabled", last_seen_at: row.last_idle_detection_at || row.last_activity_at || null, age_minutes: null, message: disabledActivityReason };
  const hardwareInventory = healthItem("Hardware Inventory", row.last_hardware_inventory_at, 24 * 60, null, "Warning");
  const softwareInventory = healthItem("Software Inventory", row.last_software_inventory_at, 24 * 60, null, "Warning");
  const policy = healthItem("Policy Sync", row.last_policy_sync_at, 24 * 60, null, "Warning");
  policy.current_policy_version = row.current_policy_version || policyJson.policy_version || "Unknown";
  policy.generated_at = row.policy_generated_at || null;
  policy.policy_name = policyJson.policy_name || "Unknown";
  policy.feature_permissions = policyJson.features || {};
  policy.disabled_reasons = policyJson.reasons || {};
  const consent = consentHealth(row.consent_approved ? "approved" : row.consent_status);

  const components = [heartbeat, activity, idleDetection, hardwareInventory, softwareInventory, policy, consent];
  let overall = "Healthy";
  if (heartbeat.status === "Offline") overall = "Offline";
  else if (components.some((item) => item.status === "Critical")) overall = "Critical";
  else if (components.some((item) => item.status === "Warning")) overall = "Warning";

  const failureReasons = components
    .filter((item) => ["Offline", "Critical", "Warning", "Information"].includes(item.status))
    .map((item) => ({ area: item.label, severity: item.status === "Information" ? "Info" : item.status, message: item.message }));

  const recommendedActions = [];
  if (heartbeat.status === "Offline" || heartbeat.status === "Critical") recommendedActions.push("Verify the endpoint agent is running and can reach the Railway API.");
  if (activity.status === "Warning") recommendedActions.push("Confirm activity telemetry is enabled and the user session is active.");
  if (hardwareInventory.status === "Warning") recommendedActions.push("Wait for the next inventory cycle or restart the agent after local validation.");
  if (softwareInventory.status === "Warning") recommendedActions.push("Confirm the 24-hour software inventory task completed successfully.");
  if (policy.status === "Warning") recommendedActions.push("Regenerate the effective policy and confirm the agent downloads it.");
  if (consent.status === "Information") recommendedActions.push("Complete employee consent before enabling sensitive monitoring.");
  if (!recommendedActions.length) recommendedActions.push("No corrective action required.");

  const timeline = [
    { event_type: "Heartbeat", occurred_at: row.last_seen_at, status: heartbeat.status },
    { event_type: "Activity", occurred_at: row.last_activity_at, status: activity.status },
    { event_type: "Idle Detection", occurred_at: row.last_idle_detection_at || row.last_activity_at, status: idleDetection.status },
    { event_type: "Hardware Inventory", occurred_at: row.last_hardware_inventory_at, status: hardwareInventory.status },
    { event_type: "Software Inventory", occurred_at: row.last_software_inventory_at, status: softwareInventory.status },
    { event_type: "Policy Sync", occurred_at: row.last_policy_sync_at, status: policy.status },
  ];
  // "Monitoring Active" must represent fresh activity telemetry, not merely
  // another enabled consent-gated feature such as screenshots or USB.
  const monitoringActive = !!(
    activityEnabled &&
    heartbeat.status === "Healthy" &&
    policy.status === "Healthy" &&
    activity.status === "Healthy" &&
    idleDetection.status === "Healthy"
  );
  const checklist = [
    { step: "Asset Linked", status: row.asset_id ? "Complete" : "Pending" },
    { step: "Employee Assigned", status: row.assigned_user_id ? "Complete" : "Pending" },
    { step: "Consent Requested", status: row.consent_id ? "Complete" : "Pending" },
    { step: "Consent Submitted", status: row.consent_submitted ? "Complete" : "Pending" },
    { step: "Consent Approved", status: row.consent_approved ? "Complete" : "Pending" },
    { step: "Effective Policy Generated", status: row.policy_generated_at ? "Complete" : "Pending" },
    { step: "Agent Policy Downloaded", status: row.last_policy_sync_at ? "Complete" : "Pending" },
    { step: "Monitoring Active", status: monitoringActive ? "Complete" : (activityEnabled ? "Pending" : "Not Applicable") },
  ];

  return {
    device_uuid: row.device_uuid,
    device_id: row.device_id,
    hostname: row.hostname,
    device_name: row.device_name,
    assigned_employee: row.assigned_employee,
    branch_name: row.branch_name,
    department: row.department,
    overall_health: overall,
    endpoint_status: overall,
    heartbeat,
    activity,
    idle_detection: idleDetection,
    hardware_inventory: hardwareInventory,
    software_inventory: softwareInventory,
    policy,
    consent,
    checklist,
    agent_sync: {
      last_communication_at: row.last_seen_at,
      last_api_response: row.last_api_response || null,
      last_error: row.last_error || null,
      last_sync_time: row.last_policy_sync_at || row.last_seen_at || null,
    },
    timeline,
    failure_reasons: failureReasons,
    recommended_actions: recommendedActions,
    debug: {
      device_uuid: row.device_uuid,
      asset_id: row.asset_id,
      employee: row.assigned_employee,
      branch: row.branch_name,
      department: row.department,
      policy_version: row.current_policy_version || policyJson.policy_version || "Unknown",
      consent_version: row.consent_version || "Unknown",
      last_api_response: row.last_api_response || null,
      last_error: row.last_error || null,
      last_sync_time: row.last_policy_sync_at || row.last_seen_at || null,
      agent_version: row.agent_version,
      os_build: row.os_build,
      windows_version: row.windows_version,
      feature_permissions: policyJson.features || {},
      disabled_reasons: policyJson.reasons || {},
    },
  };
}

async function findDevice(body) {
  const deviceUuid = String(body.device_uuid || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceUuid)) return null;
  const result = await db.query(
    `SELECT * FROM monitored_devices WHERE device_uuid=$1::uuid LIMIT 1`,
    [deviceUuid]
  );
  return result.rows[0] || null;
}

async function loadEndpointHealthRows(req, deviceLookup = null) {
  const params = [];
  const conditions = [];
  if (deviceLookup) {
    params.push(deviceLookup);
    if (/^\d+$/.test(String(deviceLookup))) {
      conditions.push(`d.device_id=$${params.length}`);
    } else {
      conditions.push(`d.device_uuid::text=$${params.length}`);
    }
  }
  if (!req.monitoringIsSuperAdmin && req.monitoringBranchId) {
    params.push(req.monitoringBranchId);
    conditions.push(`d.branch_id=$${params.length}`);
  }
  if (req.monitoringIsEmployee) {
    params.push(req.monitoringUserId);
    conditions.push(`d.assigned_user_id=$${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await db.query(
    `SELECT d.*, u.full_name AS assigned_employee, COALESCE(d.department, u.department) AS department, b.branch_name,
       a.asset_tag,
       COALESCE(
         (SELECT cd.status FROM consent_documents cd
          WHERE cd.employee_id=d.assigned_user_id AND (d.device_uuid IS NULL OR cd.device_uuid=d.device_uuid OR cd.device_uuid IS NULL)
          ORDER BY cd.approved_at DESC NULLS LAST, cd.signed_at DESC NULLS LAST, cd.created_at DESC LIMIT 1),
         d.consent_status
       ) AS consent_status,
       (SELECT cd.consent_id::text FROM consent_documents cd
        WHERE cd.employee_id=d.assigned_user_id AND (d.device_uuid IS NULL OR cd.device_uuid=d.device_uuid OR cd.device_uuid IS NULL)
        ORDER BY cd.approved_at DESC NULLS LAST, cd.signed_at DESC NULLS LAST, cd.created_at DESC LIMIT 1) AS consent_id,
       (SELECT cd.consent_version FROM consent_documents cd
        WHERE cd.employee_id=d.assigned_user_id AND (d.device_uuid IS NULL OR cd.device_uuid=d.device_uuid OR cd.device_uuid IS NULL)
        ORDER BY cd.approved_at DESC NULLS LAST, cd.signed_at DESC NULLS LAST, cd.created_at DESC LIMIT 1) AS consent_version,
       EXISTS (
         SELECT 1 FROM consent_documents cd
         WHERE cd.employee_id=d.assigned_user_id
           AND cd.status IN ('pending_approval','approved','signed')
           AND cd.submitted_at IS NOT NULL
       ) AS consent_submitted,
       EXISTS (
         SELECT 1 FROM consent_documents cd
         WHERE cd.employee_id=d.assigned_user_id
           AND (d.device_uuid IS NULL OR cd.device_uuid=d.device_uuid OR cd.device_uuid IS NULL)
           AND cd.status IN ('approved','signed') AND cd.active IS NOT FALSE
       ) AS consent_approved,
       (SELECT al.occurred_at FROM laptop_activity_logs al WHERE al.device_id=d.device_id AND al.event_type IS DISTINCT FROM 'system_audit' ORDER BY al.occurred_at DESC LIMIT 1) AS last_activity_at,
       (SELECT al.occurred_at FROM laptop_activity_logs al WHERE al.device_id=d.device_id AND al.event_type IS DISTINCT FROM 'system_audit' AND al.idle_seconds IS NOT NULL ORDER BY al.occurred_at DESC LIMIT 1) AS last_idle_detection_at,
       (SELECT hi.scanned_at FROM endpoint_hardware_inventory hi WHERE hi.device_id=d.device_id ORDER BY hi.scanned_at DESC LIMIT 1) AS last_hardware_inventory_at,
       (SELECT hi.os_build FROM endpoint_hardware_inventory hi WHERE hi.device_id=d.device_id ORDER BY hi.scanned_at DESC LIMIT 1) AS os_build,
       (SELECT CONCAT_WS(' ', hi.os_name, hi.os_version) FROM endpoint_hardware_inventory hi WHERE hi.device_id=d.device_id ORDER BY hi.scanned_at DESC LIMIT 1) AS windows_version,
       (SELECT MAX(si.last_seen_at) FROM endpoint_software_inventory si WHERE si.device_id=d.device_id) AS last_software_inventory_at,
       ep.generated_at AS policy_generated_at,
       ep.policy_json->>'policy_version' AS current_policy_version,
       ep.policy_json AS policy_json,
       NULL::text AS last_api_response,
       NULL::text AS last_error
     FROM monitored_devices d
     LEFT JOIN users u ON u.user_id=d.assigned_user_id
     LEFT JOIN branches b ON b.branch_id=d.branch_id
     LEFT JOIN hardware_assets a ON a.asset_id=d.asset_id
     LEFT JOIN endpoint_effective_policies ep ON ep.device_uuid=d.device_uuid
     ${where}
     ORDER BY d.last_seen_at DESC NULLS LAST`,
    params
  );
  return result.rows;
}

function normalizeSoftwareItem(item) {
  const name = String(item?.software_name || item?.name || "").replace(/\0/g, '').trim().slice(0, 500);
  if (!name) return null;
  return {
    software_name: name,
    version: String(item?.version || "").replace(/\0/g, '').trim().slice(0, 255) || null,
    publisher: String(item?.publisher || "").replace(/\0/g, '').trim().slice(0, 255) || null,
    install_date: String(item?.install_date || "").replace(/\0/g, '').trim().slice(0, 80) || null,
    install_location: String(item?.install_location || "").replace(/\0/g, '').trim().slice(0, 2000) || null,
    source: String(item?.source || "registry").replace(/\0/g, '').trim().slice(0, 80) || "registry",
  };
}

router.post("/heartbeat", requireAgent, async (req, res) => {
  const deviceUuid = String(req.body?.device_uuid || "").trim().toLowerCase();
  const hostname = String(req.body?.hostname || req.body?.device_name || "").trim();
  const deviceName = String(req.body?.device_name || hostname).trim().slice(0, 255);
  const loggedInUser = String(req.body?.logged_in_user || "").trim().slice(0, 255) || null;

  if (!hostname) return res.status(400).json({ success: false, message: "Hostname is required." });

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceUuid)) {
    return res.status(400).json({ success: false, message: "A valid device_uuid is required." });
  }
  try {
    // One-time adoption preserves activity history for pre-UUID installations.
    await db.query(
      `UPDATE monitored_devices SET device_uuid=$1,device_name=$2,logged_in_user=$3,updated_at=CURRENT_TIMESTAMP
       WHERE device_id=(SELECT device_id FROM monitored_devices WHERE device_uuid IS NULL AND LOWER(hostname)=LOWER($4) ORDER BY last_seen_at DESC NULLS LAST LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM monitored_devices WHERE device_uuid=$1)`,
      [deviceUuid, deviceName, loggedInUser, hostname]
    );
    const result = await db.query(
      `INSERT INTO monitored_devices (device_uuid,hostname,device_name,logged_in_user,assigned_user_id,branch_id,agent_version,last_seen_at,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP,'Online')
       ON CONFLICT (device_uuid) WHERE device_uuid IS NOT NULL DO UPDATE SET
       hostname=EXCLUDED.hostname,device_name=EXCLUDED.device_name,logged_in_user=EXCLUDED.logged_in_user,
       agent_version=EXCLUDED.agent_version,last_seen_at=CURRENT_TIMESTAMP,status='Online',
       assigned_user_id=COALESCE(monitored_devices.assigned_user_id,EXCLUDED.assigned_user_id),
       branch_id=COALESCE(monitored_devices.branch_id,EXCLUDED.branch_id),updated_at=CURRENT_TIMESTAMP RETURNING *`,
      [deviceUuid, hostname, deviceName, loggedInUser, req.body?.assigned_user_id || null, req.body?.branch_id || null, String(req.body?.agent_version || "MVP-1.0").slice(0, 50)]
    );
    const device = result.rows[0];
    console.info("[laptop-monitoring:heartbeat]", {
      hostname: device.hostname,
      device_id: device.device_id,
      last_seen_at: device.last_seen_at instanceof Date ? device.last_seen_at.toISOString() : device.last_seen_at,
      status: device.status,
    });
    return res.json({ success: true, message: "Heartbeat received.", data: device });
  } catch (error) {
    console.error("[laptop-monitoring:heartbeat]", error.message);
    return res.status(500).json({ success: false, message: "Failed to record heartbeat." });
  }
});

router.post("/activity", requireAgent, async (req, res) => {
  try {
    const device = await findDevice(req.body || {});
    if (!device) return res.status(404).json({ success: false, message: "Device is not registered. Send a heartbeat first." });
    const appName = String(req.body?.app_name || "").slice(0, 255) || null;
    const windowTitle = String(req.body?.window_title || "").slice(0, 500) || null;
    const urlDomain = String(req.body?.url_domain || "").slice(0, 255).toLowerCase() || null;
    const idleSeconds = Math.max(0, Math.round(Number(req.body?.idle_seconds) || 0));
    const prefs = await getApprovedConsentPreferences(device);
    const activityAllowed = hasPreference(prefs, "application_monitoring", "applications", "activity_monitoring", "app_usage", "window_title", "idle_time");
    if (!activityAllowed) return res.status(403).json({ success: false, message: "Application and window activity consent is not approved." });
    if (urlDomain) {
      const webAllowed = hasPreference(prefs, "web_monitoring", "website_monitoring", "network_domains", "browser");
      if (!webAllowed) return res.status(403).json({ success: false, message: "Consent not approved." });
    }
    const activity = await db.query(
      `INSERT INTO laptop_activity_logs (device_id,device_uuid,asset_id,assigned_user_id,current_logged_in_user,branch_id,department,event_type,app_name,window_title,idle_seconds,url_domain,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13::timestamptz,CURRENT_TIMESTAMP)) RETURNING *`,
      [device.device_id, device.device_uuid, device.asset_id, device.assigned_user_id, device.logged_in_user, device.branch_id, device.department, String(req.body?.event_type || "activity").slice(0, 50), appName, windowTitle, idleSeconds, urlDomain, req.body?.occurred_at || null]
    );
    const alerts = [];
    if (idleSeconds >= excessiveIdleSeconds) alerts.push(["Low", "Excessive Idle Time", `Device idle for ${idleSeconds} seconds.`]);
    if (appName && prohibitedApps.some((item) => appName.toLowerCase().includes(item))) alerts.push(["High", "Prohibited Application", `Configured prohibited application detected: ${appName}.`]);
    if (urlDomain && prohibitedDomains.some((item) => urlDomain === item || urlDomain.endsWith(`.${item}`))) alerts.push(["High", "Prohibited Domain", `Configured prohibited domain detected: ${urlDomain}.`]);
    for (const [severity, type, message] of alerts) {
      const alertRes = await db.query(`INSERT INTO laptop_alerts (device_id,severity,alert_type,message) VALUES ($1,$2,$3,$4) RETURNING id`, [device.device_id, severity, type, message]);
      const alertId = alertRes.rows[0].id;
      
      if (severity === "High" && device.assigned_user_id) {
        // Create an incident ticket for high severity alerts
        const ticketRes = await db.query(`
          INSERT INTO tickets (ticket_number, requester_id, branch_id, title, description, category, priority, status, related_device_uuid, related_asset_id, alert_id)
          VALUES (
            'INC-' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYYMMDDHH24MISS') || '-' || LPAD((FLOOR(RANDOM() * 9999) + 1)::TEXT, 4, '0'),
            $1, $2, $3, $4, 'Security', 'High', 'Open', $5, $6, $7
          ) RETURNING id
        `, [
          device.assigned_user_id, device.branch_id,
          `Security Alert: ${type} on ${device.hostname}`,
          `Automated endpoint monitoring alert triggered.\n\nType: ${type}\nMessage: ${message}\nDevice: ${device.hostname}\nLogged in user: ${device.logged_in_user}`,
          device.device_uuid, device.asset_id, alertId
        ]);
        
        // Notify SuperAdmins and Branch Admins
        const admins = await db.query(`SELECT user_id FROM users WHERE role='SuperAdmin' OR (role='Admin' AND branch_id=$1)`, [device.branch_id]);
        for (const admin of admins.rows) {
          if (typeof createNotification === 'function') {
            await createNotification({
              user_id: admin.user_id,
              title: "Endpoint Security Alert",
              message: `High severity alert on ${device.hostname}: ${type}`,
              type: "security_alert",
              related_id: ticketRes.rows[0].id
            }).catch(e => console.error("Notification failed", e));
          }
        }
      }
    }
    return res.status(201).json({ success: true, message: "Activity recorded.", data: activity.rows[0], alerts_created: alerts.length });
  } catch (error) {
    console.error("[laptop-monitoring:activity]", error.message);
    return res.status(500).json({ success: false, message: "Failed to record activity." });
  }
});

router.get("/policy", requireAgent, async (req, res) => {
  try {
    const deviceUuid = String(req.query.device_uuid || "").trim();
    if (!deviceUuid) return res.status(400).json({ success: false, message: "device_uuid is required." });

    const policy = await generateEffectivePolicy(deviceUuid, null);
    if (!policy) return res.status(404).json({ success: false, message: "Device not found." });

    await db.query(
      `UPDATE monitored_devices SET last_policy_sync_at=CURRENT_TIMESTAMP WHERE device_uuid=$1::uuid`,
      [deviceUuid]
    );
    await logPolicyAudit(null, "policy_downloaded", deviceUuid, { agent: true, endpoint: "legacy" });

    // Preserve the original camelCase properties for older agents while also
    // returning the canonical effective-policy contract used by native agents.
    return res.json({
      success: true,
      data: {
        ...policy,
        applicationMonitoring: Boolean(policy.activity_monitoring_enabled),
        screenshotMonitoring: Boolean(policy.screenshot_monitoring_enabled),
        usbMonitoring: Boolean(policy.usb_monitoring_enabled),
        browserMonitoring: Boolean(policy.browser_monitoring_enabled),
        deviceTelemetry: Boolean(policy.telemetry_enabled),
      },
    });
  } catch (error) {
    console.error("[laptop-monitoring:policy]", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch policy." });
  }
});

async function resolveConsentGatedFeature(device, featureFlag) {
  if (!device?.assigned_user_id) {
    return {
      allowed: false,
      policy: null,
      reason: "Device must be assigned to an employee before monitoring.",
    };
  }

  const policy = await generateEffectivePolicy(device.device_uuid, null);
  if (!policy) {
    return { allowed: false, policy: null, reason: "Effective endpoint policy is unavailable." };
  }

  const feature = policy.features?.[featureFlag];
  const allowed = Boolean(policy[featureFlag]) && feature?.enabled !== false;
  return {
    allowed,
    policy,
    reason: allowed ? null : (feature?.reason || policy.reasons?.[featureFlag] || "Feature is disabled by the effective endpoint policy."),
  };
}

router.get("/screenshot-permission", requireAgent, async (req, res) => {
  try {
    const device = await findDevice(req.query || {});
    if (!device) return res.status(404).json({ success: false, message: "Device is not registered. Send a heartbeat first." });
    const permission = await resolveConsentGatedFeature(device, "screenshot_monitoring_enabled");
    return res.json({
      success: true,
      data: {
        allowed: permission.allowed,
        feature: "screenshot_monitoring",
        policy_version: permission.policy?.policy_version || null,
        consent_id: permission.policy?.consent_id || null,
        reason: permission.reason,
      },
    });
  } catch (error) {
    console.error("[laptop-monitoring:screenshot-permission]", error.message);
    return res.status(500).json({ success: false, message: "Failed to verify screenshot consent." });
  }
});

router.post("/screenshot", requireAgent, (req, res) => {
  uploadScreenshot(req, res, async (uploadError) => {
    if (uploadError) return res.status(400).json({ success: false, message: uploadError.message || "Invalid screenshot upload." });
    let uploadedObjectKey = null;
    try {
      if (!req.file?.buffer?.length) return res.status(400).json({ success: false, message: "A PNG or JPEG screenshot file is required." });
      const device = await findDevice(req.body || {});
      if (!device) return res.status(404).json({ success: false, message: "Device is not registered. Send a heartbeat first." });
      if (req.agentDevice && String(req.agentDevice.device_id) !== String(device.device_id)) {
        return res.status(403).json({ success: false, message: "Device credential does not match the screenshot device." });
      }
      
      // Enforce Assignment
      if (!device.assigned_user_id) {
        return res.status(403).json({ success: false, message: "Device must be assigned to an employee before monitoring." });
      }

      // The generated policy is the single authority: it combines assignment,
      // active approved consent, the selected category, and policy overrides.
      const permission = await resolveConsentGatedFeature(device, "screenshot_monitoring_enabled");
      if (!permission.allowed) {
        return res.status(403).json({
          success: false,
          message: permission.reason || "Screenshot monitoring is disabled by the effective endpoint policy.",
        });
      }

      let department = device.department || null;
      if (permission.policy?.consent_id) {
        const consentDetails = await db.query(
          `SELECT department FROM consent_documents WHERE consent_id=$1 LIMIT 1`,
          [permission.policy.consent_id]
        );
        department = consentDetails.rows[0]?.department || department;
      }

      const encrypted = encryptScreenshot(req.file.buffer);
      const now = new Date();
      uploadedObjectKey = [
        "endpoint-screenshots",
        String(device.device_uuid || device.device_id),
        String(now.getUTCFullYear()),
        String(now.getUTCMonth() + 1).padStart(2, "0"),
        `${crypto.randomUUID()}.abenc`,
      ].join("/");
      await putPrivateObject({
        key: uploadedObjectKey,
        body: encrypted.ciphertext,
        contentType: "application/octet-stream",
        metadata: {
          algorithm: "AES-256-GCM",
          device: device.device_uuid || device.device_id,
          captured: req.body?.captured_at || now.toISOString(),
        },
      });

      const retentionDays = Math.min(365, Math.max(1, Number(permission.policy?.screenshot_retention_days) || 30));

      const result = await db.query(
        `INSERT INTO laptop_screenshots (
           device_id,file_url,file_path,thumbnail_path,assigned_user_id,branch_id,department,captured_at,reason,
           object_key,encryption_algorithm,encryption_iv,encryption_auth_tag,plaintext_sha256,content_type,file_size_bytes,expires_at
         )
         VALUES ($1,NULL,NULL,NULL,$2,$3,$4,COALESCE($5::timestamptz,CURRENT_TIMESTAMP),$6,
                 $7,'AES-256-GCM',$8,$9,$10,$11,$12,CURRENT_TIMESTAMP + ($13 * INTERVAL '1 day')) RETURNING *`,
        [
          device.device_id, device.assigned_user_id, device.branch_id, department,
          req.body?.captured_at || null, String(req.body?.reason || "Consent-enabled agent capture").slice(0, 255),
          uploadedObjectKey, encrypted.iv, encrypted.authTag, encrypted.sha256,
          req.file.mimetype, req.file.size, retentionDays,
        ]
      );

      return res.status(201).json({ success: true, message: "Screenshot encrypted and stored privately.", data: result.rows[0] });
    } catch (error) {
      if (uploadedObjectKey) deletePrivateObject(uploadedObjectKey).catch(() => {});
      console.error("[laptop-monitoring:screenshot]", error.message);
      const configurationError = ["R2_NOT_CONFIGURED", "SCREENSHOT_ENCRYPTION_NOT_CONFIGURED"].includes(error.code);
      return res.status(configurationError ? 503 : 500).json({
        success: false,
        message: configurationError ? "Secure screenshot storage is not configured." : "Failed to record screenshot.",
      });
    }
  });
});

async function refreshDeviceStatuses() {
  await db.query(
    `UPDATE monitored_devices
     SET status=CASE WHEN last_seen_at IS NOT NULL AND last_seen_at >= CURRENT_TIMESTAMP - ($1 * INTERVAL '1 second') THEN 'Online' ELSE 'Offline' END,
     updated_at=CURRENT_TIMESTAMP
     WHERE status IS DISTINCT FROM CASE WHEN last_seen_at IS NOT NULL AND last_seen_at >= CURRENT_TIMESTAMP - ($1 * INTERVAL '1 second') THEN 'Online' ELSE 'Offline' END`,
    [ONLINE_THRESHOLD_SECONDS]
  );
}

router.get("/devices", requireAdmin, async (req, res) => {
  try {
    await refreshDeviceStatuses();
    const result = await db.query(
      `SELECT d.*, u.full_name assigned_user, COALESCE(d.department, u.department) as department, b.branch_name,
       COALESCE(
         (SELECT status FROM consent_documents cd WHERE cd.employee_id = d.assigned_user_id ORDER BY cd.signed_at DESC NULLS LAST LIMIT 1),
         d.consent_status
       ) as consent_status,
       (SELECT occurred_at FROM laptop_activity_logs al WHERE al.device_id = d.device_id ORDER BY al.occurred_at DESC LIMIT 1) as last_activity,
       (SELECT captured_at FROM laptop_screenshots ls WHERE ls.device_id = d.device_id ORDER BY ls.captured_at DESC LIMIT 1) as last_screenshot,
       d.last_policy_sync_at AS policy_synced_at,
       a.asset_tag, a.serial_number, a.model
       FROM monitored_devices d
       LEFT JOIN users u ON u.user_id=d.assigned_user_id
       LEFT JOIN branches b ON b.branch_id=d.branch_id
       LEFT JOIN hardware_assets a ON a.asset_id=d.asset_id
       WHERE ($1::int IS NULL OR d.branch_id=$1) 
       AND ($2::int IS NULL OR d.assigned_user_id=$2)
       ORDER BY d.last_seen_at DESC NULLS LAST`, [req.monitoringBranchId, req.monitoringIsEmployee ? req.monitoringUser.userId : null]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("[laptop-monitoring:devices]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load monitored devices." });
  }
});

router.get("/debug", requireAdmin, async (req, res) => {
  try {
    await refreshDeviceStatuses();
    const result = await db.query(
      `SELECT COUNT(*)::int total_devices, MAX(last_seen_at) latest_last_seen_at,
       CASE WHEN MAX(last_seen_at) IS NULL THEN NULL ELSE GREATEST(0, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MAX(last_seen_at)))::int) END seconds_since_heartbeat
       FROM monitored_devices`
    );
    const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
    const requestHost = forwardedHost || req.get("host") || "";
    const source = /localhost|127\.0\.0\.1|\[::1\]/i.test(requestHost) ? "local" : "production";
    return res.json({ success: true, data: { ...result.rows[0], online_threshold_seconds: ONLINE_THRESHOLD_SECONDS, backend_source: source } });
  } catch (error) {
    console.error("[laptop-monitoring:debug]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load monitoring debug information." });
  }
});

router.get("/software-inventory/summary", requireAdmin, async (req, res) => {
  try {
    const scope = softwareScope(req, "si");
    const where = scope.conditions.length ? `WHERE ${scope.conditions.join(" AND ")}` : "";
    const result = await db.query(
      `SELECT
         COUNT(*)::int AS total_installed_software_records,
         COUNT(DISTINCT LOWER(si.software_name))::int AS unique_applications,
         COUNT(DISTINCT si.device_uuid) FILTER (WHERE si.status='active')::int AS devices_reporting_software,
         COUNT(*) FILTER (WHERE si.first_seen_at >= CURRENT_TIMESTAMP - INTERVAL '30 days')::int AS recently_installed,
         COUNT(*) FILTER (WHERE si.status='removed')::int AS removed_missing_software
       FROM endpoint_software_inventory si
       ${where}`,
      scope.params
    );
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("[laptop-monitoring:software-summary]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load software inventory summary." });
  }
});

router.get("/software-inventory", requireAdmin, async (req, res) => {
  try {
    const scope = softwareScope(req, "si");
    const params = [...scope.params];
    const conditions = [...scope.conditions];
    const filters = [
      ["device_uuid", "si.device_uuid::text ="],
      ["employee_id", "si.assigned_user_id ="],
      ["branch_id", "si.branch_id ="],
      ["status", "LOWER(si.status) = LOWER"],
    ];
    for (const [key, sql] of filters) {
      if (req.query[key]) {
        params.push(req.query[key]);
        conditions.push(sql.endsWith("LOWER") ? `${sql}($${params.length})` : `${sql} $${params.length}`);
      }
    }
    if (req.query.publisher) {
      params.push(`%${String(req.query.publisher).toLowerCase()}%`);
      conditions.push(`LOWER(COALESCE(si.publisher,'')) LIKE $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).toLowerCase()}%`);
      conditions.push(`LOWER(si.software_name) LIKE $${params.length}`);
    }
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    params.push(limit);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await db.query(
      `SELECT si.*, d.hostname, d.device_name, u.full_name AS assigned_employee, b.branch_name
       FROM endpoint_software_inventory si
       LEFT JOIN monitored_devices d ON d.device_id=si.device_id
       LEFT JOIN users u ON u.user_id=si.assigned_user_id
       LEFT JOIN branches b ON b.branch_id=si.branch_id
       ${where}
       ORDER BY si.last_seen_at DESC NULLS LAST, si.software_name ASC
       LIMIT $${params.length}`,
      params
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("[laptop-monitoring:software-list]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load software inventory." });
  }
});

router.get("/software-inventory-by-asset/:assetId", requireAdmin, async (req, res) => {
  try {
    const scope = softwareScope(req, "si");
    const params = [...scope.params, req.params.assetId];
    const conditions = [...scope.conditions, `si.asset_id=$${params.length}`];
    const result = await db.query(
      `SELECT si.*, d.hostname, d.device_name, u.full_name AS assigned_employee, b.branch_name
       FROM endpoint_software_inventory si
       LEFT JOIN monitored_devices d ON d.device_id=si.device_id
       LEFT JOIN users u ON u.user_id=si.assigned_user_id
       LEFT JOIN branches b ON b.branch_id=si.branch_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY si.status ASC, si.software_name ASC`,
      params
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("[laptop-monitoring:software-by-asset]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load asset software inventory." });
  }
});

router.get("/health", requireAdmin, async (req, res) => {
  try {
    if (req.monitoringIsEmployee) {
      return res.status(403).json({ success: false, message: "Employees cannot view endpoint diagnostics." });
    }
    await refreshDeviceStatuses();
    const rows = await loadEndpointHealthRows(req);
    const endpoints = rows.map(buildEndpointHealth);
    const summary = {
      registered_endpoints: endpoints.length,
      online_endpoints: endpoints.filter((item) => item.heartbeat.status === "Healthy" || item.overall_health === "Healthy" || item.overall_health === "Warning").length,
      offline_endpoints: endpoints.filter((item) => item.overall_health === "Offline").length,
      heartbeat_healthy: endpoints.filter((item) => item.heartbeat.status === "Healthy").length,
      activity_healthy: endpoints.filter((item) => item.activity.status === "Healthy").length,
      hardware_inventory_healthy: endpoints.filter((item) => item.hardware_inventory.status === "Healthy").length,
      software_inventory_healthy: endpoints.filter((item) => item.software_inventory.status === "Healthy").length,
      policy_sync_healthy: endpoints.filter((item) => item.policy.status === "Healthy").length,
      consent_active: endpoints.filter((item) => item.consent.status === "Healthy").length,
      endpoints_requiring_attention: endpoints.filter((item) => item.overall_health !== "Healthy").length,
    };
    return res.json({ success: true, data: { summary, endpoints } });
  } catch (error) {
    console.error("[laptop-monitoring:health]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load endpoint health." });
  }
});

router.get("/devices/:deviceUuid/health", requireAdmin, async (req, res) => {
  try {
    if (req.monitoringIsEmployee) {
      return res.status(403).json({ success: false, message: "Employees cannot view endpoint diagnostics." });
    }
    await refreshDeviceStatuses();
    const rows = await loadEndpointHealthRows(req, req.params.deviceUuid);
    if (!rows.length) return res.status(404).json({ success: false, message: "Device not found or access denied." });
    return res.json({ success: true, data: buildEndpointHealth(rows[0]) });
  } catch (error) {
    console.error("[laptop-monitoring:device-health]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load endpoint diagnostics." });
  }
});

router.get("/devices/:id/activity", requireAdmin, async (req, res) => {
  try {
    const empId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;
    const allowed = await db.query(`SELECT device_id,device_uuid,assigned_user_id FROM monitored_devices WHERE device_id=$1 AND ($2::int IS NULL OR branch_id=$2) AND ($3::int IS NULL OR assigned_user_id=$3)`, [req.params.id, req.monitoringBranchId, empId]);
    if (!allowed.rows.length) return res.status(404).json({ success: false, message: "Device not found or access denied." });
    const device = allowed.rows[0];
    const [activity, screenshots, alerts, consents, assignments, hardware, software, policy] = await Promise.all([
      db.query(`SELECT * FROM laptop_activity_logs WHERE device_id=$1 ORDER BY occurred_at DESC LIMIT 200`, [req.params.id]),
      db.query(
        `SELECT s.id,s.device_id,s.assigned_user_id,s.branch_id,s.department,s.captured_at,s.reason,s.file_size_bytes,s.expires_at,
                d.hostname,u.full_name AS assigned_user,b.branch_name,
                CASE WHEN s.object_key IS NOT NULL THEN $2 || '/screenshots/' || s.id || '/content' ELSE NULL END AS content_url
         FROM laptop_screenshots s
         JOIN monitored_devices d ON d.device_id=s.device_id
         LEFT JOIN users u ON u.user_id=s.assigned_user_id
         LEFT JOIN branches b ON b.branch_id=s.branch_id
         WHERE s.device_id=$1
         ORDER BY s.captured_at DESC LIMIT 4`,
        [req.params.id, req.baseUrl]
      ),
      db.query(`SELECT * FROM laptop_alerts WHERE device_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.params.id]),
      db.query(
        `SELECT consent_id AS id,device_id,employee_id AS user_id,form_title AS consent_type,
                status AS consent_status,COALESCE(approved_at,signed_at,submitted_at) AS consented_at,created_at
         FROM consent_documents
         WHERE (device_uuid=$1::uuid OR (device_uuid IS NULL AND employee_id=$2))
         ORDER BY created_at DESC`,
        [device.device_uuid, device.assigned_user_id]
      ),
      db.query(`SELECT a.*, ou.full_name as old_user_name, nu.full_name as new_user_name FROM monitored_device_assignments a LEFT JOIN users ou ON a.old_user_id=ou.user_id LEFT JOIN users nu ON a.new_user_id=nu.user_id WHERE device_id=$1 ORDER BY changed_at DESC`, [req.params.id]),
      db.query(`SELECT * FROM endpoint_hardware_inventory WHERE device_id=$1 ORDER BY scanned_at DESC LIMIT 1`, [req.params.id]),
      db.query(`SELECT * FROM endpoint_software_inventory WHERE device_id=$1 ORDER BY last_seen_at DESC,software_name ASC LIMIT 200`, [req.params.id]),
      db.query(
        `SELECT policy_json, generated_at
         FROM endpoint_effective_policies
         WHERE device_uuid=$1::uuid
         LIMIT 1`,
        [device.device_uuid]
      )
    ]);
    const effectivePolicy = policy.rows[0]
      ? {
          ...(policy.rows[0].policy_json || {}),
          generated_at: policy.rows[0].generated_at || policy.rows[0].policy_json?.generated_at || null,
        }
      : null;
    return res.json({
      success: true,
      data: {
        activity: activity.rows,
        screenshots: screenshots.rows,
        alerts: alerts.rows,
        consents: consents.rows,
        assignments: assignments.rows,
        hardware: hardware.rows[0] || null,
        software: software.rows,
        policy: effectivePolicy,
      },
    });
  } catch (error) {
    console.error("[laptop-monitoring:device-activity]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load device activity." });
  }
});

router.put("/devices/:id/assign", requireAdmin, async (req, res) => {
  try {
    const check = await db.query(`SELECT * FROM monitored_devices WHERE device_id=$1`, [req.params.id]);
    if (!check.rows.length) return res.status(404).json({ success: false, message: "Device not found." });
    
    // Only allow updating devices within the admin's branch, unless SuperAdmin
    if (!req.monitoringIsSuperAdmin && check.rows[0].branch_id && check.rows[0].branch_id !== req.monitoringBranchId) {
      return res.status(403).json({ success: false, message: "Cannot reassign device from another branch." });
    }
    if (req.monitoringIsEmployee) {
      return res.status(403).json({ success: false, message: "Employees cannot reassign devices." });
    }

    const { assigned_user_id, branch_id, asset_id, department, reason } = req.body;
    let finalDepartment = department || null;
    let assignedName = null;
    
    if (assigned_user_id) {
      const u = await db.query(
        `SELECT full_name, department, onboarding_status, onboarding_required
         FROM users WHERE user_id=$1`,
        [assigned_user_id]
      );
      if (!u.rows.length) {
        return res.status(404).json({ success: false, message: "Employee not found." });
      }

      const employee = u.rows[0];
      if (employee.onboarding_required || employee.onboarding_status !== "Completed") {
        return res.status(409).json({
          success: false,
          message: "Asset and device assignment is locked until the employee's consent is approved and onboarding is complete.",
          onboarding_status: employee.onboarding_status,
        });
      }

      const approvedConsent = await db.query(
        `SELECT consent_id FROM consent_documents
         WHERE employee_id=$1 AND status='approved' AND active=true
         ORDER BY approved_at DESC NULLS LAST LIMIT 1`,
        [assigned_user_id]
      );
      if (!approvedConsent.rows.length) {
        return res.status(409).json({
          success: false,
          message: "Asset and device assignment is locked until an active approved consent record exists.",
        });
      }

      if (!finalDepartment) finalDepartment = employee.department || null;
      assignedName = employee.full_name;
    }

    const oldDevice = check.rows[0];

    const updated = await db.query(
      `UPDATE monitored_devices 
       SET assigned_user_id=$1, branch_id=$2, asset_id=$3, department=$4, updated_at=CURRENT_TIMESTAMP
       WHERE device_id=$5 RETURNING *`,
      [assigned_user_id || null, branch_id || null, asset_id || null, finalDepartment, req.params.id]
    );

    // Sync assignment to hardware asset if linked
    const targetAssetId = asset_id || oldDevice.asset_id;
    if (targetAssetId) {
      await db.query(
        `UPDATE hardware_assets
         SET employee_id=$1, assigned_name=$2, department=$3, branch_id=$4, assigned_date=CURRENT_DATE, updated_at=CURRENT_TIMESTAMP
         WHERE asset_id=$5`,
        [assigned_user_id || null, assignedName, finalDepartment, branch_id || null, targetAssetId]
      );
    }

    // Audit trail for assignment/reassignment
    await db.query(
      `INSERT INTO monitored_device_assignments (
         device_id, device_uuid, asset_id, old_user_id, new_user_id, old_branch_id, new_branch_id, old_department, new_department, reason, changed_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        req.params.id, oldDevice.device_uuid, oldDevice.asset_id, oldDevice.assigned_user_id, assigned_user_id || null,
        oldDevice.branch_id, branch_id || null, oldDevice.department, finalDepartment, reason || "Manual assignment", req.monitoringUserId
      ]
    );

    const eventName = assigned_user_id ? "Device assigned" : "Device unassigned";
    await db.query(
      `INSERT INTO laptop_activity_logs (device_id, event_type, app_name, window_title)
       VALUES ($1, 'system_audit', $2, $3)`,
      [req.params.id, eventName, `Assigned User ID: ${assigned_user_id || 'None'}, Branch: ${branch_id || 'None'}`]
    );
    
    if (targetAssetId) {
      await reconcileDevice(req.params.id);
    }

    const consentRequest = await ensureConsentRequestForDevice(updated.rows[0], req.monitoringUserId);

    return res.json({ success: true, message: "Device assignment updated.", data: updated.rows[0] });
  } catch (error) {
    console.error("[laptop-monitoring:assign]", error.message);
    return res.status(500).json({ success: false, message: "Failed to assign device." });
  }
});

router.get("/summary", requireAdmin, async (req, res) => {
  try {
    await refreshDeviceStatuses();
    const empId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;
    const result = await db.query(
      `SELECT COUNT(*)::int total_monitored_devices,
       COUNT(*) FILTER (WHERE status='Online')::int online_devices,
       COUNT(*) FILTER (WHERE status='Offline')::int offline_devices,
       COUNT(DISTINCT assigned_user_id) FILTER (WHERE last_seen_at::date=CURRENT_DATE)::int active_users_today
       FROM monitored_devices WHERE ($1::int IS NULL OR branch_id=$1) AND ($2::int IS NULL OR assigned_user_id=$2)`, [req.monitoringBranchId, empId]
    );
    const idle = await db.query(
      `SELECT COALESCE(AVG(l.idle_seconds),0)::numeric(12,2) average_idle_seconds,COALESCE(SUM(l.idle_seconds),0)::bigint total_idle_seconds
       FROM laptop_activity_logs l JOIN monitored_devices d ON d.device_id=l.device_id
       WHERE l.occurred_at::date=CURRENT_DATE AND ($1::int IS NULL OR d.branch_id=$1) AND ($2::int IS NULL OR d.assigned_user_id=$2)`, [req.monitoringBranchId, empId]
    );
    const alerts = await db.query(
      `SELECT a.*,d.hostname FROM laptop_alerts a JOIN monitored_devices d ON d.device_id=a.device_id
       WHERE ($1::int IS NULL OR d.branch_id=$1) AND ($2::int IS NULL OR d.assigned_user_id=$2) ORDER BY a.created_at DESC LIMIT 20`, [req.monitoringBranchId, empId]


      );
    return res.json({ success: true, data: { ...result.rows[0], ...idle.rows[0], recent_alerts: alerts.rows } });
  } catch (error) {
    console.error("[laptop-monitoring:summary]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load monitoring summary." });
  }
});


// Consent-aware USB/DLP collection and policy permission endpoints.
router.get("/usb-monitoring-permission", requireAgent, async (req, res) => {
  try {
    const device = await findDevice(req.query || {});
    if (!device) return res.status(404).json({ success: false, message: "Device not registered. Send a heartbeat first." });
    const permission = await resolveConsentGatedFeature(device, "usb_monitoring_enabled");
    return res.json({
      success: true,
      data: {
        allowed: permission.allowed,
        feature: "usb_monitoring",
        policy_version: permission.policy?.policy_version || null,
        consent_id: permission.policy?.consent_id || null,
        reason: permission.reason,
      },
    });
  } catch (error) {
    console.error("[laptop-monitoring:usb-monitoring-permission]", error.message);
    return res.status(500).json({ success: false, message: "Failed to verify USB monitoring consent." });
  }
});

function normalizeUsbEvent(input) {
  const eventType = String(input?.event_type || "").trim().toLowerCase();
  if (!["device_connected", "device_disconnected", "file_written"].includes(eventType)) return null;
  const reference = String(input?.event_reference || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reference)) return null;
  const occurredAt = input?.occurred_at && !Number.isNaN(Date.parse(input.occurred_at)) ? new Date(input.occurred_at).toISOString() : new Date().toISOString();
  const lastWriteAt = input?.file_last_write_at && !Number.isNaN(Date.parse(input.file_last_write_at)) ? new Date(input.file_last_write_at).toISOString() : null;
  return {
    event_reference: reference,
    event_type: eventType,
    drive_letter: String(input?.drive_letter || "").replace(/[^a-z0-9:]/gi, "").slice(0, 10) || null,
    volume_label: String(input?.volume_label || "").replace(/\0/g, "").trim().slice(0, 255) || null,
    volume_serial: String(input?.volume_serial || "").replace(/[^a-z0-9-]/gi, "").slice(0, 100) || null,
    filesystem: String(input?.filesystem || "").replace(/[^a-z0-9]/gi, "").slice(0, 50) || null,
    file_name: eventType === "file_written" ? String(input?.file_name || "").replace(/[\0\r\n]/g, "").trim().slice(0, 500) || null : null,
    relative_path: eventType === "file_written" ? String(input?.relative_path || "").replace(/[\0\r\n]/g, "").trim().slice(0, 2000) || null : null,
    extension: eventType === "file_written" ? String(input?.extension || "").replace(/[^a-z0-9.]/gi, "").toLowerCase().slice(0, 50) || null : null,
    file_size_bytes: eventType === "file_written" ? Math.max(0, Math.round(Number(input?.file_size_bytes) || 0)) : null,
    file_last_write_at: lastWriteAt,
    occurred_at: occurredAt,
  };
}

async function createDlpIncident(device, event, risk, alertId, policy) {
  if (!policy?.auto_incident_enabled || !device.branch_id || !device.assigned_user_id || !["High", "Critical"].includes(risk.riskLevel)) return null;
  const category = await db.query(
    `SELECT category_id FROM ticket_categories
     ORDER BY CASE WHEN LOWER(category_name)='security' THEN 0 WHEN LOWER(category_name) LIKE '%incident%' THEN 1 ELSE 2 END, category_id
     LIMIT 1`
  );
  if (!category.rows[0]) return null;
  const result = await createServiceDeskTicket({
    branchId: device.branch_id,
    requesterId: device.assigned_user_id,
    actorId: device.assigned_user_id,
    categoryId: category.rows[0].category_id,
    requireBranch: true,
    enforceRequesterBranch: true,
    title: `DLP Alert: USB transfer on ${device.hostname}`,
    description: [
      "Automatically created from consent-approved endpoint USB monitoring.",
      `Risk: ${risk.riskLevel} (${risk.score}/100)`,
      `File: ${event.file_name || "Unknown"}`,
      `Size: ${event.file_size_bytes || 0} bytes`,
      `Removable drive: ${event.drive_letter || "Unknown"} ${event.volume_label || ""}`.trim(),
      `Matched rules: ${risk.matches.join(", ") || "None"}`,
      `Endpoint alert ID: ${alertId}`,
    ].join("\n"),
    priority: risk.riskLevel === "Critical" ? "P1-Critical" : "P2-High",
    source: "endpoint_monitoring",
    ticketNumberPrefix: "DLP",
    metadata: {
      origin_system: "AstreaBlue Endpoint Agent",
      origin_module: "Endpoint Monitoring",
      origin_feature: "USB DLP",
      external_reference: `usb-event-${event.event_reference}`,
      created_via: "automatic_dlp_incident",
    },
  });
  return result.ticket;
}

router.post("/usb-events/batch", requireAgent, async (req, res) => {
  try {
    const device = await findDevice(req.body || {});
    if (!device) return res.status(404).json({ success: false, message: "Device is not registered. Send a heartbeat first." });
    if (req.agentDevice && String(req.agentDevice.device_id) !== String(device.device_id)) {
      return res.status(403).json({ success: false, message: "Device credential does not match the USB event device." });
    }
    const permission = await resolveConsentGatedFeature(device, "usb_monitoring_enabled");
    if (!permission.allowed) return res.status(403).json({ success: false, message: permission.reason || "USB monitoring is disabled." });
    const incoming = Array.isArray(req.body?.events) ? req.body.events.slice(0, 100) : [];
    const events = incoming.map(normalizeUsbEvent).filter(Boolean);
    if (!events.length) return res.status(400).json({ success: false, message: "At least one valid USB event is required." });

    const saved = [];
    for (const event of events) {
      const risk = event.event_type === "file_written" ? evaluateUsbTransfer(event, permission.policy) : { score: 0, riskLevel: "Low", matches: [] };
      const inserted = await db.query(
        `INSERT INTO endpoint_usb_events (
           event_reference,device_id,device_uuid,assigned_user_id,branch_id,department,event_type,
           drive_letter,volume_label,volume_serial,filesystem,file_name,relative_path,extension,file_size_bytes,
           file_last_write_at,risk_score,risk_level,rule_matches,occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20)
         ON CONFLICT (event_reference) DO NOTHING RETURNING *`,
        [event.event_reference, device.device_id, device.device_uuid, device.assigned_user_id, device.branch_id, device.department,
          event.event_type, event.drive_letter, event.volume_label, event.volume_serial, event.filesystem,
          event.file_name, event.relative_path, event.extension, event.file_size_bytes, event.file_last_write_at,
          risk.score, risk.riskLevel, JSON.stringify(risk.matches), event.occurred_at]
      );
      if (!inserted.rows.length) continue;
      const record = inserted.rows[0];
      if (event.event_type === "file_written" && ["High", "Critical"].includes(risk.riskLevel)) {
        const alert = await db.query(
          `INSERT INTO laptop_alerts (device_id,severity,alert_type,message)
           VALUES ($1,$2,'USB DLP Risk',$3) RETURNING id`,
          [device.device_id, risk.riskLevel, `${event.file_name || "A file"} was written to removable media. ${risk.matches.join("; ")}.`]
        );
        let ticket = null;
        try { ticket = await createDlpIncident(device, event, risk, alert.rows[0].id, permission.policy); }
        catch (ticketError) { console.error("[laptop-monitoring:usb-dlp-ticket]", ticketError.message); }
        const updated = await db.query(
          `UPDATE endpoint_usb_events SET alert_id=$2,ticket_id=$3,dlp_action=$4 WHERE id=$1 RETURNING *`,
          [record.id, alert.rows[0].id, ticket?.id || null, ticket ? "incident_created" : "alerted"]
        );
        saved.push(updated.rows[0]);
      } else saved.push(record);
    }
    return res.status(201).json({ success: true, message: "USB events processed.", data: { accepted: saved.length, events: saved } });
  } catch (error) {
    console.error("[laptop-monitoring:usb-events]", error.message);
    return res.status(500).json({ success: false, message: "Failed to process USB events." });
  }
});

router.get("/usb-events", requireAdmin, async (req, res) => {
  try {
    const employeeId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const result = await db.query(
      `SELECT e.*,d.hostname,d.device_name,u.full_name AS assigned_user,b.branch_name
       FROM endpoint_usb_events e
       JOIN monitored_devices d ON d.device_id=e.device_id
       LEFT JOIN users u ON u.user_id=e.assigned_user_id
       LEFT JOIN branches b ON b.branch_id=e.branch_id
       WHERE ($1::int IS NULL OR e.branch_id=$1) AND ($2::int IS NULL OR e.assigned_user_id=$2)
         AND ($3::text IS NULL OR e.risk_level=$3)
       ORDER BY e.occurred_at DESC LIMIT $4`,
      [req.monitoringBranchId, employeeId, req.query.risk_level || null, limit]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("[laptop-monitoring:usb-events-list]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load USB events." });
  }
});

router.get("/usb-events/stats", requireAdmin, async (req, res) => {
  try {
    const employeeId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;
    const result = await db.query(
      `SELECT COUNT(*) FILTER (WHERE occurred_at>=CURRENT_DATE)::int AS events_today,
              COUNT(*) FILTER (WHERE event_type='file_written' AND occurred_at>=CURRENT_DATE)::int AS transfers_today,
              COUNT(*) FILTER (WHERE risk_level IN ('High','Critical') AND occurred_at>=CURRENT_DATE)::int AS high_risk_today,
              COUNT(DISTINCT device_id) FILTER (WHERE occurred_at>=CURRENT_DATE)::int AS devices_today,
              COUNT(*) FILTER (WHERE ticket_id IS NOT NULL AND occurred_at>=CURRENT_DATE)::int AS incidents_today
       FROM endpoint_usb_events
       WHERE ($1::int IS NULL OR branch_id=$1) AND ($2::int IS NULL OR assigned_user_id=$2)`,
      [req.monitoringBranchId, employeeId]
    );
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("[laptop-monitoring:usb-events-stats]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load USB statistics." });
  }
});

// Website monitoring permission checks consent_documents for website_monitoring preference
router.get("/website-monitoring-permission", requireAgent, async (req, res) => {
  try {
    const device = await findDevice(req.query || {});
    if (!device) return res.status(404).json({ success: false, message: "Device not registered. Send a heartbeat first." });
    let allowed = false;
    if (device.assigned_user_id) {
      const formalConsent = await db.query(
        `SELECT monitoring_preferences FROM consent_documents
         WHERE employee_id=$1 AND status='signed'
         ORDER BY signed_at DESC NULLS LAST LIMIT 1`,
        [device.assigned_user_id]
      );
      if (formalConsent.rows.length) {
        const prefs = formalConsent.rows[0].monitoring_preferences || [];
        allowed = Array.isArray(prefs) && prefs.includes("website_monitoring");
      }
    }
    return res.json({ success: true, data: { allowed, feature: "website_monitoring" } });
  } catch (error) {
    console.error("[laptop-monitoring:website-monitoring-permission]", error.message);
    return res.status(500).json({ success: false, message: "Failed to verify website monitoring consent." });
  }
});

router.get("/screenshots", requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(48, Math.max(1, parseInt(req.query.limit) || 12));
    const offset = (page - 1) * limit;

    const empId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;
    const [result, countResult] = await Promise.all([db.query(
      `SELECT s.id, s.device_id, s.captured_at, s.reason, s.file_size_bytes, s.expires_at,
              d.hostname, d.device_name, d.device_uuid,
              u.full_name as assigned_user, b.branch_name, s.department
       FROM laptop_screenshots s
       JOIN monitored_devices d ON s.device_id = d.device_id
       LEFT JOIN users u ON s.assigned_user_id = u.user_id
       LEFT JOIN branches b ON s.branch_id = b.branch_id
       WHERE ($1::int IS NULL OR d.branch_id = $1)
       AND ($4::int IS NULL OR d.assigned_user_id = $4)
       ORDER BY s.captured_at DESC
       LIMIT $2 OFFSET $3`,
      [req.monitoringBranchId, limit, offset, empId]
    ), db.query(
      `SELECT COUNT(*)::int AS total
       FROM laptop_screenshots s
       JOIN monitored_devices d ON s.device_id = d.device_id
       WHERE ($1::int IS NULL OR d.branch_id = $1)
       AND ($2::int IS NULL OR d.assigned_user_id = $2)`,
      [req.monitoringBranchId, empId]
    )]);
    
    const items = result.rows.map(row => ({
      ...row,
      content_url: `${req.baseUrl}/screenshots/${row.id}/content`,
    }));

    const total = countResult.rows[0]?.total || 0;
    return res.json({
      success: true,
      data: items,
      pagination: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    console.error("[laptop-monitoring:screenshots]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load screenshots." });
  }
});

router.get("/screenshots/stats", requireAdmin, async (req, res) => {
  try {
    const empId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;
    const today = await db.query(
      `SELECT COUNT(*)::int as count FROM laptop_screenshots s
       JOIN monitored_devices d ON s.device_id = d.device_id
       WHERE ($1::int IS NULL OR d.branch_id = $1) AND ($2::int IS NULL OR d.assigned_user_id = $2) AND s.captured_at >= CURRENT_DATE`,
      [req.monitoringBranchId, empId]
    );
    const devices = await db.query(
      `SELECT COUNT(DISTINCT s.device_id)::int as count FROM laptop_screenshots s
       JOIN monitored_devices d ON s.device_id = d.device_id
       WHERE ($1::int IS NULL OR d.branch_id = $1) AND ($2::int IS NULL OR d.assigned_user_id = $2) AND s.captured_at >= CURRENT_DATE`,
      [req.monitoringBranchId, empId]
    );
    const last = await db.query(
      `SELECT captured_at FROM laptop_screenshots s
       JOIN monitored_devices d ON s.device_id = d.device_id
       WHERE ($1::int IS NULL OR d.branch_id = $1) AND ($2::int IS NULL OR d.assigned_user_id = $2)
       ORDER BY captured_at DESC LIMIT 1`,
      [req.monitoringBranchId, empId]
    );
    const storage = await db.query(
      `SELECT COALESCE(SUM(s.file_size_bytes),0)::bigint as bytes FROM laptop_screenshots s
       JOIN monitored_devices d ON s.device_id = d.device_id
       WHERE ($1::int IS NULL OR d.branch_id = $1) AND ($2::int IS NULL OR d.assigned_user_id = $2)`,
      [req.monitoringBranchId, empId]
    );
    const storageUsedMB = (Number(storage.rows[0].bytes || 0) / (1024 * 1024)).toFixed(1);

    return res.json({
      success: true,
      data: {
        todays_screenshots: today.rows[0].count,
        devices_reporting: devices.rows[0].count,
        last_screenshot: last.rows.length ? last.rows[0].captured_at : null,
        storage_used_mb: storageUsedMB
      }
    });
  } catch (error) {
    console.error("[laptop-monitoring:screenshots-stats]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load screenshot stats." });
  }
});

router.get("/screenshots/:id/content", requireAdmin, async (req, res) => {
  try {
    const employeeId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;
    const result = await db.query(
      `SELECT s.object_key, s.encryption_algorithm, s.encryption_iv, s.encryption_auth_tag,
              s.plaintext_sha256, s.content_type, s.expires_at
       FROM laptop_screenshots s
       JOIN monitored_devices d ON d.device_id=s.device_id
       WHERE s.id=$1
         AND ($2::int IS NULL OR d.branch_id=$2)
         AND ($3::int IS NULL OR d.assigned_user_id=$3)
       LIMIT 1`,
      [req.params.id, req.monitoringBranchId, employeeId]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Screenshot not found." });
    const screenshot = result.rows[0];
    if (!screenshot.object_key || screenshot.encryption_algorithm !== "AES-256-GCM") {
      return res.status(410).json({ success: false, message: "This legacy screenshot has no secure private image object." });
    }
    if (screenshot.expires_at && new Date(screenshot.expires_at) <= new Date()) {
      return res.status(410).json({ success: false, message: "Screenshot retention period has expired." });
    }

    const stored = await getPrivateObject(screenshot.object_key);
    const plaintext = decryptScreenshot(stored.body, screenshot.encryption_iv, screenshot.encryption_auth_tag);
    const digest = crypto.createHash("sha256").update(plaintext).digest("hex");
    if (screenshot.plaintext_sha256 && digest !== screenshot.plaintext_sha256) {
      throw new Error("Screenshot integrity verification failed.");
    }
    res.set({
      "Content-Type": screenshot.content_type || "image/jpeg",
      "Content-Length": plaintext.length,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    });
    return res.send(plaintext);
  } catch (error) {
    console.error("[laptop-monitoring:screenshot-content]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load the protected screenshot." });
  }
});

router.post("/screenshots/:id/audit-view", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const employeeId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;
    const shot = await db.query(
      `SELECT s.device_id FROM laptop_screenshots s
       JOIN monitored_devices d ON d.device_id=s.device_id
       WHERE s.id=$1 AND ($2::int IS NULL OR d.branch_id=$2) AND ($3::int IS NULL OR d.assigned_user_id=$3)`,
      [id, req.monitoringBranchId, employeeId]
    );
    if (!shot.rows.length) return res.status(404).json({ success: false, message: "Screenshot not found." });

    await db.query(
      `INSERT INTO laptop_activity_logs (device_id, event_type, app_name, window_title)
       VALUES ($1, 'system_audit', 'Screenshot viewed', 'Admin viewed full-resolution screenshot.')`,
      [shot.rows[0].device_id]
    );
    return res.json({ success: true });
  } catch (error) {
    console.error("[laptop-monitoring:screenshot-audit]", error.message);
    return res.status(500).json({ success: false });
  }
});

router.post("/screenshots/:id/audit-download", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const employeeId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;
    const shot = await db.query(
      `SELECT s.device_id FROM laptop_screenshots s
       JOIN monitored_devices d ON d.device_id=s.device_id
       WHERE s.id=$1 AND ($2::int IS NULL OR d.branch_id=$2) AND ($3::int IS NULL OR d.assigned_user_id=$3)`,
      [id, req.monitoringBranchId, employeeId]
    );
    if (!shot.rows.length) return res.status(404).json({ success: false, message: "Screenshot not found." });

    await db.query(
      `INSERT INTO laptop_activity_logs (device_id, event_type, app_name, window_title)
       VALUES ($1, 'system_audit', 'Screenshot downloaded', 'Admin downloaded a decrypted screenshot copy.')`,
      [shot.rows[0].device_id]
    );
    return res.json({ success: true });
  } catch (error) {
    console.error("[laptop-monitoring:screenshot-download-audit]", error.message);
    return res.status(500).json({ success: false });
  }
});

router.post("/hardware-inventory", requireAgent, async (req, res) => {
  let deviceUuid = String(req.body?.device_uuid || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceUuid)) {
    const hostname = String(req.body?.hostname || "").trim();
    if (!hostname) return res.status(400).json({ success: false, message: "A valid device_uuid or hostname is required." });
    const hash = crypto.createHash('md5').update(hostname.toLowerCase()).digest('hex');
    deviceUuid = [
      hash.slice(0, 8), hash.slice(8, 12), '3' + hash.slice(13, 16), 'a' + hash.slice(17, 20), hash.slice(20, 32)
    ].join('-');
  }

  try {
    const deviceResult = await db.query(`SELECT device_id, asset_id FROM monitored_devices WHERE device_uuid=$1 LIMIT 1`, [deviceUuid]);
    if (!deviceResult.rows.length) {
      return res.status(404).json({ success: false, message: "Device not found." });
    }
    const { device_id, asset_id } = deviceResult.rows[0];

    const {
      manufacturer, model, serial_number, cpu_name, total_ram_gb,
      os_name, os_version, os_build, architecture,
      disk_total_gb, disk_free_gb, mac_address, ip_address, scanned_at
    } = req.body;

    await db.query(`
      INSERT INTO endpoint_hardware_inventory (
        device_id, device_uuid, asset_id, manufacturer, model, serial_number,
        cpu_name, total_ram_gb, os_name, os_version, os_build, architecture,
        disk_total_gb, disk_free_gb, mac_address, ip_address, scanned_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, COALESCE($17::timestamptz, CURRENT_TIMESTAMP))
    `, [
      device_id, deviceUuid, asset_id, manufacturer, model, serial_number,
      cpu_name, total_ram_gb, os_name, os_version, os_build, architecture,
      disk_total_gb, disk_free_gb, mac_address, ip_address, scanned_at
    ]);
    
    await reconcileDevice(device_id);

    return res.json({ success: true, message: "Hardware inventory updated." });
  } catch (error) {
    console.error("Hardware inventory error:", error.message);
    return res.status(500).json({ success: false, error: "Database error." });
  }
});

router.post("/software-inventory", requireAgent, async (req, res) => {
  let deviceUuid = String(req.body?.device_uuid || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceUuid)) {
    const hostname = String(req.body?.hostname || "").trim();
    if (!hostname) return res.status(400).json({ success: false, message: "A valid device_uuid or hostname is required." });
    const hash = crypto.createHash('md5').update(hostname.toLowerCase()).digest('hex');
    deviceUuid = [
      hash.slice(0, 8), hash.slice(8, 12), '3' + hash.slice(13, 16), 'a' + hash.slice(17, 20), hash.slice(20, 32)
    ].join('-');
  }
  const items = Array.isArray(req.body?.software) ? req.body.software.map(normalizeSoftwareItem).filter(Boolean).slice(0, 2000) : [];
  const scanStartedAt = req.body?.scan_started_at || req.body?.scanned_at || null;
  const scanCompletedAt = req.body?.scan_completed_at || new Date().toISOString();

  try {
    const deviceResult = await db.query(`SELECT * FROM monitored_devices WHERE device_uuid=$1::uuid LIMIT 1`, [deviceUuid]);
    if (!deviceResult.rows.length) {
      return res.status(404).json({ success: false, message: "Device not found. Send a heartbeat first." });
    }
    const device = deviceResult.rows[0];

    await db.query("BEGIN");
    const run = await db.query(
      `INSERT INTO endpoint_software_scan_runs (device_uuid, device_id, scan_started_at, scan_completed_at, software_count)
       VALUES ($1,$2,COALESCE($3::timestamptz,CURRENT_TIMESTAMP),COALESCE($4::timestamptz,CURRENT_TIMESTAMP),$5)
       RETURNING id`,
      [deviceUuid, device.device_id, scanStartedAt, scanCompletedAt, items.length]
    );

    const activeIds = [];
    for (const item of items) {
      const existing = await db.query(
        `SELECT id FROM endpoint_software_inventory
         WHERE device_uuid=$1::uuid AND LOWER(software_name)=LOWER($2)
           AND LOWER(COALESCE(publisher,''))=LOWER(COALESCE($3,''))
         LIMIT 1`,
        [deviceUuid, item.software_name, item.publisher]
      );
      let saved;
      if (existing.rows.length) {
        saved = await db.query(
          `UPDATE endpoint_software_inventory SET
             device_id=$1, asset_id=$2, assigned_user_id=$3, branch_id=$4, department=$5,
             version=$6, publisher=$7, install_date=$8, install_location=$9, source=$10,
             last_seen_at=COALESCE($11::timestamptz,CURRENT_TIMESTAMP), status='active', updated_at=CURRENT_TIMESTAMP
           WHERE id=$12 RETURNING id`,
          [
            device.device_id, device.asset_id || null, device.assigned_user_id || null, device.branch_id || null, device.department || null,
            item.version, item.publisher, item.install_date, item.install_location, item.source,
            scanCompletedAt, existing.rows[0].id,
          ]
        );
      } else {
        saved = await db.query(
          `INSERT INTO endpoint_software_inventory (
             device_uuid, device_id, asset_id, assigned_user_id, branch_id, department,
             software_name, version, publisher, install_date, install_location, source,
             first_seen_at, last_seen_at, status
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13::timestamptz,CURRENT_TIMESTAMP),COALESCE($13::timestamptz,CURRENT_TIMESTAMP),'active')
           RETURNING id`,
          [
            deviceUuid, device.device_id, device.asset_id || null, device.assigned_user_id || null, device.branch_id || null, device.department || null,
            item.software_name, item.version, item.publisher, item.install_date, item.install_location, item.source,
            scanCompletedAt,
          ]
        );
      }
      activeIds.push(saved.rows[0].id);
    }

    if (activeIds.length) {
      await db.query(
        `UPDATE endpoint_software_inventory
         SET status='removed', updated_at=CURRENT_TIMESTAMP
         WHERE device_uuid=$1::uuid AND status='active' AND NOT (id = ANY($2::bigint[]))`,
        [deviceUuid, activeIds]
      );
    } else {
      await db.query(
        `UPDATE endpoint_software_inventory SET status='removed', updated_at=CURRENT_TIMESTAMP
         WHERE device_uuid=$1::uuid AND status='active'`,
        [deviceUuid]
      );
    }

    await db.query("COMMIT");
    return res.status(201).json({
      success: true,
      message: "Software inventory synchronized.",
      data: { scan_run_id: run.rows[0].id, software_count: items.length, active_records: activeIds.length },
    });
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    console.error("[laptop-monitoring:software-inventory]", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/hardware-inventory/:deviceId", requireAdmin, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const deviceResult = await db.query(`SELECT branch_id, assigned_user_id FROM monitored_devices WHERE device_id=$1`, [deviceId]);
    if (!deviceResult.rows.length) return res.status(404).json({ success: false });
    
    const device = deviceResult.rows[0];
    if (!req.monitoringIsSuperAdmin) {
      if (req.monitoringIsEmployee && String(device.assigned_user_id) !== String(req.monitoringUser.userId)) {
        return res.status(403).json({ success: false, error: "Access denied." });
      }
      if (req.monitoringBranchId && String(device.branch_id) !== String(req.monitoringBranchId)) {
        return res.status(403).json({ success: false, error: "Access denied." });
      }
    }

    const result = await db.query(
      `SELECT * FROM endpoint_hardware_inventory WHERE device_id=$1 ORDER BY scanned_at DESC LIMIT 1`,
      [deviceId]
    );
    res.json({ success: true, data: result.rows[0] || null });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: "Failed to fetch hardware inventory" });
  }
});

router.get("/hardware-inventory-by-asset/:assetId", requireAdmin, async (req, res) => {
  try {
    const { assetId } = req.params;
    const deviceResult = await db.query(`SELECT device_id FROM monitored_devices WHERE asset_id=$1`, [assetId]);
    if (!deviceResult.rows.length) return res.json({ success: true, data: null });
    
    const deviceId = deviceResult.rows[0].device_id;
    const result = await db.query(
      `SELECT * FROM endpoint_hardware_inventory WHERE device_id=$1 ORDER BY scanned_at DESC LIMIT 1`,
      [deviceId]
    );
    res.json({ success: true, data: result.rows[0] || null });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch hardware inventory" });
  }
});

router.delete("/devices/:id", requireAdmin, async (req, res) => {
  if (!req.monitoringIsSuperAdmin) return res.status(403).json({ success: false, error: "Superadmin required." });
  try {
    const result = await db.query(`DELETE FROM monitored_devices WHERE device_id=$1 RETURNING *`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, error: "Device not found." });
    res.json({ success: true, message: "Device deleted successfully." });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to delete device." });
  }
});

router.get("/assets/:assetId/reconciliation", requireAdmin, async (req, res) => {
  try {
    const { assetId } = req.params;
    const result = await db.query(
      `SELECT * FROM asset_inventory_reconciliation WHERE asset_id=$1 ORDER BY checked_at DESC`,
      [assetId]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: "Failed to fetch reconciliation data." });
  }
});

router.get("/devices/:deviceId/reconciliation", requireAdmin, async (req, res) => {
  if (req.monitoringIsEmployee) return res.status(403).json({ success: false, error: "Access denied." });
  try {
    const { deviceId } = req.params;
    if (!req.monitoringIsSuperAdmin && req.monitoringBranchId) {
      const dev = await db.query(`SELECT branch_id FROM monitored_devices WHERE device_id=$1`, [deviceId]);
      if (!dev.rows.length || dev.rows[0].branch_id !== req.monitoringBranchId) {
        return res.status(403).json({ success: false, error: "Access denied" });
      }
    }
    const result = await db.query(
      `SELECT * FROM asset_inventory_reconciliation WHERE device_id=$1 ORDER BY checked_at DESC`,
      [deviceId]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: "Failed to fetch reconciliation data." });
  }
});

router.post("/devices/:deviceId/reconcile", requireAdmin, async (req, res) => {
  if (req.monitoringIsEmployee) return res.status(403).json({ success: false, error: "Access denied." });
  try {
    const { deviceId } = req.params;
    if (!req.monitoringIsSuperAdmin && req.monitoringBranchId) {
      const dev = await db.query(`SELECT branch_id FROM monitored_devices WHERE device_id=$1`, [deviceId]);
      if (!dev.rows.length || dev.rows[0].branch_id !== req.monitoringBranchId) {
        return res.status(403).json({ success: false, error: "Access denied" });
      }
    }
    const result = await reconcileDevice(deviceId);
    if (!result) {
      return res.status(400).json({ success: false, error: "Could not reconcile device. Missing asset or inventory." });
    }
    res.json({ success: true, data: result, message: "Reconciliation successful." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: "Failed to reconcile device." });
  }
});

router.post("/devices/:deviceId/convert-to-asset", requireAdmin, async (req, res) => {
  if (req.monitoringIsEmployee) return res.status(403).json({ success: false, error: "Access denied." });
  try {
    const { deviceId } = req.params;

    await db.query('BEGIN');
    
    // Use FOR UPDATE to lock the row and prevent race conditions if the user double clicks
    const deviceQuery = await db.query(`SELECT * FROM monitored_devices WHERE device_id=$1 FOR UPDATE`, [deviceId]);
    if (!deviceQuery.rows.length) {
      await db.query('ROLLBACK');
      return res.status(404).json({ success: false, error: "Device not found." });
    }
    const device = deviceQuery.rows[0];

    if (!req.monitoringIsSuperAdmin && req.monitoringBranchId) {
      if (device.branch_id !== req.monitoringBranchId) {
        await db.query('ROLLBACK');
        return res.status(403).json({ success: false, error: "Access denied" });
      }
    }

    if (device.asset_id) {
      await db.query('ROLLBACK');
      return res.status(400).json({ success: false, error: "Device is already linked to an asset." });
    }

    const inventoryQuery = await db.query(`SELECT * FROM endpoint_hardware_inventory WHERE device_id=$1 ORDER BY scanned_at DESC LIMIT 1`, [deviceId]);
    if (!inventoryQuery.rows.length) {
      await db.query('ROLLBACK');
      return res.status(400).json({ success: false, error: "Device has not sent any hardware inventory yet. Wait for the agent to complete a scan." });
    }
    const inv = inventoryQuery.rows[0];

    const formatSize = (val) => {
      const num = parseFloat(String(val || "").replace(/[^0-9.]/g, ''));
      return isNaN(num) ? null : Math.ceil(num).toString() + " GB";
    };

    const assetName = inv.model || device.hostname || device.device_name || "Unknown Endpoint";
    const assetTag = "AUTO-" + Date.now().toString().slice(-6) + "-" + Math.floor(Math.random()*100);
    const os = [inv.os_name, inv.os_version].filter(Boolean).join(" ");
    
    const insertAsset = await db.query(`
      INSERT INTO hardware_assets (
        asset_name, asset_type, brand, manufacturer, model, serial_number, asset_tag, 
        processor, ram, storage, operating_system, branch_id, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING asset_id
    `, [
      assetName, "Computer", inv.manufacturer || "Unknown", inv.manufacturer || "Unknown", inv.model || "Unknown", inv.serial_number || "UNKNOWN-SN", assetTag,
      inv.cpu_name, formatSize(inv.total_ram_gb), formatSize(inv.disk_total_gb), os || null,
      device.branch_id || null, "In Use"
    ]);

    const newAssetId = insertAsset.rows[0].asset_id;
    await db.query(`UPDATE monitored_devices SET asset_id = $1 WHERE device_id = $2`, [newAssetId, deviceId]);
    await db.query('COMMIT');

    await reconcileDevice(deviceId);

    res.json({ success: true, message: "Asset successfully generated from agent specs!" });
  } catch (error) {
    await db.query('ROLLBACK');
    console.error("Convert to asset error:", error);
    res.status(500).json({ success: false, error: "Failed to create asset." });
  }
});

// Endpoint Policy Engine APIs

async function logPolicyAudit(userId, action, targetId, details) {
  try {
    await db.query(
      `INSERT INTO endpoint_policy_audit_logs (user_id, action, target_id, details) VALUES ($1, $2, $3, $4)`,
      [userId, action, targetId, JSON.stringify(details)]
    );
  } catch (err) {
    console.error("[laptop-monitoring] policy audit error:", err.message);
  }
}

router.get("/employees/:id/screenshot-control", requireSuperAdmin, async (req, res) => {
  try {
    const employeeId = Number(req.params.id);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      return res.status(400).json({ success: false, message: "A valid employee ID is required." });
    }
    const employee = await db.query(`SELECT user_id,full_name FROM users WHERE user_id=$1 LIMIT 1`, [employeeId]);
    if (!employee.rows.length) return res.status(404).json({ success: false, message: "Employee not found." });
    const [override, deviceCount] = await Promise.all([
      db.query(
        `SELECT o.suspended,o.reason,o.updated_by,o.updated_at,u.full_name AS updated_by_name
         FROM endpoint_monitoring_overrides o
         LEFT JOIN users u ON u.user_id=o.updated_by
         WHERE o.employee_id=$1 AND o.feature_key='screenshot_monitoring_enabled'
         LIMIT 1`,
        [employeeId]
      ),
      db.query(`SELECT COUNT(*)::int AS count FROM monitored_devices WHERE assigned_user_id=$1`, [employeeId]),
    ]);
    const control = override.rows[0] || null;
    return res.json({
      success: true,
      data: {
        employee_id: employeeId,
        employee_name: employee.rows[0].full_name,
        suspended: control?.suspended === true,
        reason: control?.reason || null,
        updated_by: control?.updated_by || null,
        updated_by_name: control?.updated_by_name || null,
        updated_at: control?.updated_at || null,
        affected_devices: deviceCount.rows[0]?.count || 0,
      },
    });
  } catch (error) {
    console.error("[laptop-monitoring:screenshot-control-status]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load screenshot control status." });
  }
});

router.post("/employees/:id/screenshot-control", requireSuperAdmin, async (req, res) => {
  try {
    const employeeId = Number(req.params.id);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      return res.status(400).json({ success: false, message: "A valid employee ID is required." });
    }
    if (typeof req.body?.suspended !== "boolean") {
      return res.status(400).json({ success: false, message: "suspended must be true or false." });
    }
    const employee = await db.query(`SELECT user_id,full_name FROM users WHERE user_id=$1 LIMIT 1`, [employeeId]);
    if (!employee.rows.length) return res.status(404).json({ success: false, message: "Employee not found." });

    const suspended = req.body.suspended;
    const reason = String(req.body?.reason || (suspended ? "Paused by SuperAdmin." : "Resumed by SuperAdmin."))
      .replace(/[\0\r\n]/g, " ").trim().slice(0, 1000);
    if (suspended) {
      await db.query(
        `INSERT INTO endpoint_monitoring_overrides
           (employee_id,feature_key,suspended,reason,updated_by,updated_at)
         VALUES ($1,'screenshot_monitoring_enabled',true,$2,$3,CURRENT_TIMESTAMP)
         ON CONFLICT (employee_id,feature_key) DO UPDATE SET
           suspended=true,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP`,
        [employeeId, reason, req.monitoringUserId]
      );
    } else {
      await db.query(
        `DELETE FROM endpoint_monitoring_overrides
         WHERE employee_id=$1 AND feature_key='screenshot_monitoring_enabled'`,
        [employeeId]
      );
    }

    const devices = await db.query(`SELECT device_uuid FROM monitored_devices WHERE assigned_user_id=$1 AND device_uuid IS NOT NULL`, [employeeId]);
    for (const device of devices.rows) await generateEffectivePolicy(device.device_uuid, null);
    await logPolicyAudit(
      req.monitoringUserId,
      suspended ? "screenshot_monitoring_suspended" : "screenshot_monitoring_resumed",
      `employee:${employeeId}`,
      { employee_id: employeeId, employee_name: employee.rows[0].full_name, reason, affected_devices: devices.rows.length }
    );
    return res.json({
      success: true,
      message: suspended ? "Screenshot capture paused for this employee." : "Screenshot capture resumed for this employee.",
      data: { employee_id: employeeId, employee_name: employee.rows[0].full_name, suspended, reason, affected_devices: devices.rows.length },
    });
  } catch (error) {
    console.error("[laptop-monitoring:screenshot-control-update]", error.message);
    return res.status(500).json({ success: false, message: "Failed to update screenshot control." });
  }
});

const policyFeatureMap = {
  heartbeat: "heartbeat_enabled",
  activity: "activity_monitoring_enabled",
  screenshots: "screenshot_monitoring_enabled",
  hardware_inventory: "hardware_inventory_enabled",
  software_inventory: "software_inventory_enabled",
  browser: "browser_monitoring_enabled",
  usb: "usb_monitoring_enabled",
  location: "location_tracking_enabled",
  auto_incident: "auto_incident_enabled",
};

function normalizePolicyConfig(body = {}) {
  const suppliedConfig = body.config_json && typeof body.config_json === "object" && !Array.isArray(body.config_json)
    ? body.config_json
    : {};
  const config = { ...suppliedConfig };
  if (body.features_enabled && typeof body.features_enabled === "object") {
    for (const [clientKey, enabled] of Object.entries(body.features_enabled)) {
      const policyKey = policyFeatureMap[clientKey] || clientKey;
      config[policyKey] = !!enabled;
    }
  }
  if (body.collection_interval_seconds && typeof body.collection_interval_seconds === "object") {
    config.intervals = { ...(config.intervals || {}), ...body.collection_interval_seconds };
  }
  return config;
}

function policyForClient(row) {
  const config = row.config_json && typeof row.config_json === "object" ? row.config_json : {};
  const features = {};
  for (const [clientKey, policyKey] of Object.entries(policyFeatureMap)) features[clientKey] = !!config[policyKey];
  return {
    ...row,
    policy_name: row.name,
    features_enabled: features,
    collection_interval_seconds: config.intervals || {},
    version: `${row.priority || 0}.${row.id}`,
  };
}

router.get("/policies", requireAdmin, async (req, res) => {
  try {
    const scope = [];
    const params = [];
    if (!req.monitoringIsSuperAdmin && req.monitoringBranchId) {
      params.push(req.monitoringBranchId);
      scope.push(`(branch_id IS NULL OR branch_id=$${params.length})`);
    } else if (req.monitoringIsEmployee) {
      return res.status(403).json({ success: false, message: "Employees cannot view policies." });
    }
    
    const where = scope.length ? `WHERE ${scope.join(' AND ')}` : "";
    const result = await db.query(
      `SELECT * FROM endpoint_policies ${where} ORDER BY priority DESC, created_at DESC`,
      params
    );
    res.json({ success: true, data: result.rows.map(policyForClient) });
  } catch (error) {
    console.error("[laptop-monitoring] fetch policies error:", error.message);
    res.status(500).json({ success: false, message: "Failed to fetch policies." });
  }
});

router.post("/policies", requireAdmin, async (req, res) => {
  try {
    if (req.monitoringIsEmployee) return res.status(403).json({ success: false, message: "Unauthorized." });
    const { description, priority, is_active, branch_id } = req.body;
    const name = String(req.body.name || req.body.policy_name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Policy name is required." });
    const configJson = normalizePolicyConfig(req.body);
    
    let targetBranch = req.monitoringIsSuperAdmin ? (branch_id || null) : req.monitoringBranchId;
    
    const result = await db.query(
      `INSERT INTO endpoint_policies (name, description, priority, is_active, config_json, created_by, branch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, description, priority || 0, is_active ?? true, JSON.stringify(configJson), req.monitoringUserId, targetBranch]
    );
    
    const policy = result.rows[0];
    await logPolicyAudit(req.monitoringUserId, 'policy_created', policy.id, { policy });
    res.status(201).json({ success: true, data: policyForClient(policy) });
  } catch (error) {
    console.error("[laptop-monitoring] create policy error:", error.message);
    res.status(500).json({ success: false, message: "Failed to create policy." });
  }
});

router.get("/policies/:id", requireAdmin, async (req, res) => {
  try {
    if (req.monitoringIsEmployee) return res.status(403).json({ success: false, message: "Unauthorized." });
    const result = await db.query(`SELECT * FROM endpoint_policies WHERE id=$1`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Policy not found." });
    
    const policy = result.rows[0];
    if (!req.monitoringIsSuperAdmin && policy.branch_id && policy.branch_id !== req.monitoringBranchId) {
      return res.status(403).json({ success: false, message: "Unauthorized." });
    }
    
    const assignments = await db.query(`SELECT * FROM endpoint_policy_assignments WHERE policy_id=$1`, [policy.id]);
    policy.assignments = assignments.rows;
    
    res.json({ success: true, data: policy });
  } catch (error) {
    console.error("[laptop-monitoring] fetch policy error:", error.message);
    res.status(500).json({ success: false, message: "Failed to fetch policy." });
  }
});

router.put("/policies/:id", requireAdmin, async (req, res) => {
  try {
    if (req.monitoringIsEmployee) return res.status(403).json({ success: false, message: "Unauthorized." });
    const check = await db.query(`SELECT * FROM endpoint_policies WHERE id=$1`, [req.params.id]);
    if (!check.rows.length) return res.status(404).json({ success: false, message: "Policy not found." });
    
    if (!req.monitoringIsSuperAdmin && check.rows[0].branch_id !== req.monitoringBranchId) {
      return res.status(403).json({ success: false, message: "Unauthorized." });
    }
    
    const name = String(req.body.name || req.body.policy_name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Policy name is required." });
    const { description, priority, is_active } = req.body;
    const configJson = normalizePolicyConfig(req.body);
    const result = await db.query(
      `UPDATE endpoint_policies SET name=$1, description=$2, priority=$3, is_active=$4, config_json=$5, updated_at=CURRENT_TIMESTAMP WHERE id=$6 RETURNING *`,
      [name, description, priority, is_active, JSON.stringify(configJson), req.params.id]
    );
    
    await logPolicyAudit(req.monitoringUserId, is_active === false && check.rows[0].is_active ? 'policy_disabled' : 'policy_updated', req.params.id, { changes: req.body });
    res.json({ success: true, data: policyForClient(result.rows[0]) });
  } catch (error) {
    console.error("[laptop-monitoring] update policy error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update policy." });
  }
});

router.delete("/policies/:id", requireAdmin, async (req, res) => {
  try {
    if (req.monitoringIsEmployee) return res.status(403).json({ success: false, message: "Unauthorized." });
    const check = await db.query(`SELECT * FROM endpoint_policies WHERE id=$1`, [req.params.id]);
    if (!check.rows.length) return res.status(404).json({ success: false, message: "Policy not found." });
    
    if (!req.monitoringIsSuperAdmin && check.rows[0].branch_id !== req.monitoringBranchId) {
      return res.status(403).json({ success: false, message: "Unauthorized." });
    }
    
    await db.query(`DELETE FROM endpoint_policies WHERE id=$1`, [req.params.id]);
    await logPolicyAudit(req.monitoringUserId, 'policy_deleted', req.params.id, { policy: check.rows[0] });
    res.json({ success: true, message: "Policy deleted." });
  } catch (error) {
    console.error("[laptop-monitoring] delete policy error:", error.message);
    res.status(500).json({ success: false, message: "Failed to delete policy." });
  }
});

router.post("/policies/:id/assign", requireAdmin, async (req, res) => {
  try {
    if (req.monitoringIsEmployee) return res.status(403).json({ success: false, message: "Unauthorized." });
    const targetType = String(req.body.target_type || "").trim();
    const targetId = targetType.toLowerCase() === "global" ? "*" : String(req.body.target_id || "").trim();
    if (!targetType || !targetId) return res.status(400).json({ success: false, message: "Policy target is required." });
    const check = await db.query(`SELECT * FROM endpoint_policies WHERE id=$1`, [req.params.id]);
    if (!check.rows.length) return res.status(404).json({ success: false, message: "Policy not found." });
    
    if (!req.monitoringIsSuperAdmin && check.rows[0].branch_id !== req.monitoringBranchId) {
      return res.status(403).json({ success: false, message: "Unauthorized." });
    }
    
    const result = await db.query(
      `INSERT INTO endpoint_policy_assignments (policy_id, target_type, target_id) VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, targetType, targetId]
    );
    await logPolicyAudit(req.monitoringUserId, 'policy_assigned', req.params.id, { target_type: targetType, target_id: targetId });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("[laptop-monitoring] assign policy error:", error.message);
    res.status(500).json({ success: false, message: "Failed to assign policy." });
  }
});

// Device calculation
async function generateEffectivePolicy(deviceUuid, actorId) {
  const deviceResult = await db.query(
    `SELECT d.*, u.department as employee_department FROM monitored_devices d
     LEFT JOIN users u ON u.user_id = d.assigned_user_id
     WHERE d.device_uuid=$1::uuid LIMIT 1`, [deviceUuid]
  );
  if (!deviceResult.rows.length) return null;
  const device = deviceResult.rows[0];

  const assignments = await db.query(
    `SELECT a.*, p.priority, p.config_json FROM endpoint_policy_assignments a
     JOIN endpoint_policies p ON p.id = a.policy_id
     WHERE p.is_active=true`
  );

  let highestPriority = -9999;
  let effectiveConfig = {
    heartbeat_enabled: true,
    telemetry_enabled: true,
    hardware_inventory_enabled: true,
    software_inventory_enabled: true,
    policy_sync_enabled: true,
    activity_monitoring_enabled: false,
    screenshot_monitoring_enabled: false,
    usb_monitoring_enabled: false,
    browser_monitoring_enabled: false,
    location_tracking_enabled: false,
    auto_incident_enabled: false,
    screenshot_interval_minutes: 15,
    screenshot_retention_days: 30,
    usb_scan_interval_seconds: 15,
    dlp_large_transfer_mb: 100,
    intervals: { heartbeat: 60, activity: 60 },
    retention: { logs_days: 30 }
  };
  let effectivePolicyName = "Default (Safe)";
  let effectivePolicyVersion = "1.0";
  const featureSources = {};
  let consentDoc = null;
  let screenshotOverride = null;

  // The approved consent document is the canonical source of employee choices.
  // endpoint_monitoring_policies is a materialized audit record and can be stale
  // after a preference change, so it must not decide the effective flags.
  if (device.assigned_user_id) {
    const consentResult = await db.query(
      `SELECT consent_id, consent_version, monitoring_preferences
       FROM consent_documents
       WHERE employee_id=$1
         AND (device_uuid=$2::uuid OR device_uuid IS NULL)
         AND status='approved' AND active=true
       ORDER BY (device_uuid IS NOT NULL) DESC, approved_at DESC NULLS LAST, consent_id DESC
       LIMIT 1`,
      [device.assigned_user_id, device.device_uuid]
    );
    consentDoc = consentResult.rows[0] || null;
    if (consentDoc) {
      const prefs = consentDoc.monitoring_preferences || [];
      const consentBaseline = {
        telemetry_enabled: true,
        activity_monitoring_enabled: hasPreference(prefs, "application_monitoring", "applications", "activity_monitoring", "app_usage", "window_title", "idle_time"),
        screenshot_monitoring_enabled: hasPreference(prefs, "screenshot_monitoring", "screenshot"),
        usb_monitoring_enabled: hasPreference(prefs, "usb_monitoring", "usb"),
        browser_monitoring_enabled: hasPreference(prefs, "web_monitoring", "website_monitoring", "network_domains", "browser"),
        location_tracking_enabled: hasPreference(prefs, "location_tracking"),
      };
      effectiveConfig = { ...effectiveConfig, ...consentBaseline };
      effectivePolicyName = "Approved Consent Policy";
      effectivePolicyVersion = `consent-${consentDoc.consent_version || consentDoc.consent_id}`;
      for (const key of Object.keys(consentBaseline)) featureSources[key] = "Approved Consent";
    }
  }

  const targetPriorities = { 'Employee': 6, 'Device': 5, 'Asset': 4, 'Department': 3, 'Branch': 2, 'Global': 1 };
  
  for (const row of assignments.rows) {
    let matches = false;
    const targetType = String(row.target_type || '').toLowerCase();
    if (targetType === 'device' && row.target_id === String(device.device_uuid)) matches = true;
    else if (targetType === 'asset' && row.target_id === String(device.asset_id)) matches = true;
    else if (targetType === 'employee' && row.target_id === String(device.assigned_user_id)) matches = true;
    else if (targetType === 'department' && (row.target_id === String(device.department) || row.target_id === String(device.employee_department))) matches = true;
    else if (targetType === 'branch' && row.target_id === String(device.branch_id)) matches = true;
    else if (targetType === 'global') matches = true;

    if (matches) {
      const canonicalTargetType = targetType.charAt(0).toUpperCase() + targetType.slice(1);
      const typePriority = targetPriorities[canonicalTargetType] || 0;
      const totalPriority = row.priority * 100 + typePriority;
      if (totalPriority > highestPriority) {
        highestPriority = totalPriority;
        effectiveConfig = { ...effectiveConfig, ...row.config_json };
        effectivePolicyName = `Policy ID ${row.policy_id}`;
        effectivePolicyVersion = `${row.priority}.${row.id}`;
        for (const key of Object.keys(row.config_json || {})) featureSources[key] = canonicalTargetType;
      }
    }
  }

  const reasons = {};
  const hasConsent = !!consentDoc;
  if (consentDoc) {
      const prefs = consentDoc.monitoring_preferences || [];
      if (!hasPreference(prefs, "application_monitoring", "applications", "activity_monitoring", "app_usage", "window_title", "idle_time")) {
        effectiveConfig.activity_monitoring_enabled = false;
        reasons.activity_monitoring_enabled = "Employee consent excludes Application/window activity.";
      } else if (!effectiveConfig.activity_monitoring_enabled) {
        reasons.activity_monitoring_enabled = `Disabled by ${featureSources.activity_monitoring_enabled || "endpoint"} policy.`;
      }
      if (!hasPreference(prefs, "screenshot_monitoring", "screenshot")) {
        effectiveConfig.screenshot_monitoring_enabled = false;
        reasons.screenshot_monitoring_enabled = "Employee consent excludes Screenshot Monitoring.";
      }
      if (!hasPreference(prefs, "web_monitoring", "website_monitoring", "browser")) {
        effectiveConfig.browser_monitoring_enabled = false;
        reasons.browser_monitoring_enabled = "Employee consent excludes Browser/domain monitoring.";
      }
      if (!hasPreference(prefs, "usb_monitoring", "usb")) {
        effectiveConfig.usb_monitoring_enabled = false;
        reasons.usb_monitoring_enabled = "Employee consent excludes USB activity monitoring.";
      }
  }

  if (!hasConsent) {
    effectiveConfig.activity_monitoring_enabled = false;
    effectiveConfig.screenshot_monitoring_enabled = false;
    effectiveConfig.browser_monitoring_enabled = false;
    effectiveConfig.usb_monitoring_enabled = false;
    effectiveConfig.location_tracking_enabled = false;
    reasons.activity_monitoring_enabled = device.assigned_user_id ? "No active approved consent." : "Device is not assigned to an employee.";
    reasons.screenshot_monitoring_enabled = device.assigned_user_id ? "No active approved consent." : "Device is not assigned to an employee.";
    reasons.browser_monitoring_enabled = device.assigned_user_id ? "No active approved consent." : "Device is not assigned to an employee.";
    reasons.usb_monitoring_enabled = device.assigned_user_id ? "No active approved consent." : "Device is not assigned to an employee.";
    reasons.location_tracking_enabled = device.assigned_user_id ? "No active approved consent." : "Device is not assigned to an employee.";
  }

  if (device.assigned_user_id) {
    const overrideResult = await db.query(
      `SELECT suspended,reason,updated_by,updated_at
       FROM endpoint_monitoring_overrides
       WHERE employee_id=$1 AND feature_key='screenshot_monitoring_enabled'
       LIMIT 1`,
      [device.assigned_user_id]
    );
    screenshotOverride = overrideResult.rows[0] || null;
    if (screenshotOverride?.suspended) {
      effectiveConfig.screenshot_monitoring_enabled = false;
      featureSources.screenshot_monitoring_enabled = "SuperAdmin Override";
      reasons.screenshot_monitoring_enabled = screenshotOverride.reason || "Screenshot capture paused by SuperAdmin.";
      const overrideVersion = new Date(screenshotOverride.updated_at || Date.now()).getTime();
      effectivePolicyVersion = `${effectivePolicyVersion}-screenshot-paused-${overrideVersion}`;
    }
  }

  const features = {};
  for (const key of [
    "heartbeat_enabled", "telemetry_enabled", "hardware_inventory_enabled", "software_inventory_enabled", "policy_sync_enabled",
    "activity_monitoring_enabled", "screenshot_monitoring_enabled", "browser_monitoring_enabled", "usb_monitoring_enabled",
    "location_tracking_enabled", "auto_incident_enabled",
  ]) {
    const consentRequired = ["activity_monitoring_enabled", "screenshot_monitoring_enabled", "browser_monitoring_enabled", "usb_monitoring_enabled", "location_tracking_enabled"].includes(key);
    features[key] = {
      enabled: !!effectiveConfig[key],
      source_policy: featureSources[key] || effectivePolicyName,
      consent_required: consentRequired,
      reason: effectiveConfig[key] ? null : (reasons[key] || "No endpoint policy assigned."),
    };
  }

  const policyJson = {
    device_uuid: device.device_uuid,
    policy_version: effectivePolicyVersion,
    policy_name: effectivePolicyName,
    consent_id: consentDoc?.consent_id || null,
    superadmin_overrides: screenshotOverride?.suspended ? {
      screenshot_monitoring_enabled: {
        suspended: true,
        reason: screenshotOverride.reason || "Screenshot capture paused by SuperAdmin.",
        updated_by: screenshotOverride.updated_by || null,
        updated_at: screenshotOverride.updated_at || null,
      },
    } : {},
    consent_version: consentDoc?.consent_version || null,
    ...effectiveConfig,
    features,
    reasons,
    generated_at: new Date().toISOString()
  };

  await db.query(
    `INSERT INTO endpoint_effective_policies (device_uuid, policy_json, generated_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (device_uuid) DO UPDATE SET policy_json=EXCLUDED.policy_json, generated_at=CURRENT_TIMESTAMP`,
    [deviceUuid, JSON.stringify(policyJson)]
  );

  if (actorId) {
    await logPolicyAudit(actorId, 'effective_policy_generated', deviceUuid, { policy_name: effectivePolicyName });
  }

  return policyJson;
}

router.post("/devices/:deviceUuid/generate-policy", requireAdmin, async (req, res) => {
  try {
    const policy = await generateEffectivePolicy(req.params.deviceUuid, req.monitoringUserId);
    if (!policy) return res.status(404).json({ success: false, message: "Device not found." });
    await createNotification({
      userId: req.monitoringUserId,
      title: "Endpoint policy regenerated",
      message: `Policy regenerated for endpoint ${req.params.deviceUuid}. Version ${policy.policy_version || "unknown"} is ready for synchronization.`,
      type: "endpoint_policy",
      relatedEntityType: "endpoint_policy",
      relatedEntityId: req.params.deviceUuid,
      metadata: { deviceUuid: req.params.deviceUuid, policyVersion: policy.policy_version },
      dedupeKey: `policy-regenerated-${req.params.deviceUuid}-${policy.generated_at || Date.now()}`,
    }).catch(() => null);
    res.json({ success: true, data: policy });
  } catch (error) {
    console.error("[laptop-monitoring] generate effective policy error:", error.message);
    res.status(500).json({ success: false, message: "Failed to generate effective policy." });
  }
});

router.get("/policy/latest", requireAgent, async (req, res) => {
  try {
    const deviceUuid = String(req.query.device_uuid || "").trim();
    if (!deviceUuid) return res.status(400).json({ success: false, message: "device_uuid required" });

    // Recalculate on every agent sync so consent, assignment, and policy changes
    // cannot leave a stale cached policy active on an endpoint.
    const policyJson = await generateEffectivePolicy(deviceUuid, null);

    if (!policyJson) {
      return res.status(404).json({ success: false, message: "Device not found." });
    }

    await db.query(`UPDATE monitored_devices SET last_policy_sync_at=CURRENT_TIMESTAMP WHERE device_uuid=$1::uuid`, [deviceUuid]);
    await logPolicyAudit(null, 'policy_downloaded', deviceUuid, { agent: true });

    res.json({ success: true, data: policyJson });
  } catch (error) {
    console.error("[laptop-monitoring] fetch latest policy error:", error.message);
    res.status(500).json({ success: false, message: "Failed to fetch policy." });
  }
});

router.get("/audit", requireAdmin, async (req, res) => {
  try {
    if (req.monitoringIsEmployee) return res.status(403).json({ success: false, message: "Unauthorized." });
    
    // Admin checking limited to their branch devices, handled dynamically, but for simplicity allow all to superadmin
    let limit = 100;
    const result = await db.query(
      `SELECT a.*, u.full_name as user_name FROM endpoint_policy_audit_logs a
       LEFT JOIN users u ON u.user_id = a.user_id
       ORDER BY a.created_at DESC LIMIT $1`, [limit]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("[laptop-monitoring] fetch audit error:", error.message);
    res.status(500).json({ success: false, message: "Failed to fetch audit logs." });
  }
});

router._test = { buildEndpointHealth };
module.exports = router;
