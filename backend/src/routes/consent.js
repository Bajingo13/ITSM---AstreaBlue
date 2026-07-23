/**
 * RA 10173 Consent Document Workflow Route
 * All consent operations: create, sign, withdraw, print, audit, policy.
 */

const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../../config/db");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const sharp = require("sharp");
const { PDFDocument: PDFLibDocument, StandardFonts, rgb } = require("pdf-lib");
const { createNotification } = require("../services/notificationService");
const {
  DEFAULT_HIGH_RISK_EXTENSIONS,
  DEFAULT_SENSITIVE_FILENAME_KEYWORDS,
} = require("../services/dlpRiskService");
const { getPrivateObject, getR2Status, putPrivateObject } = require("../services/r2StorageService");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
const CONSENT_STATUSES = [
  "draft",
  "pending_employee",
  "submitted",
  "pending_approval",
  "approved",
  "rejected",
  "revision_requested",
  "withdrawn",
  "expired",
  "superseded",
  "pending",
  "signed",
];

// ─── Signature image storage ──────────────────────────────────────────────────
// ─── DB bootstrap (idempotent) ────────────────────────────────────────────────
const tablesReady = (async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS consent_documents (
        consent_id        BIGSERIAL PRIMARY KEY,
        employee_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        employee_full_name VARCHAR(255) NOT NULL,
        employee_email    VARCHAR(255) NOT NULL,
        employee_number   VARCHAR(100),
        branch_id         INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
        branch_name       VARCHAR(255),
        department        VARCHAR(255),
        form_title        VARCHAR(255) NOT NULL DEFAULT 'RA 10173 Data Privacy Consent — Employee Monitoring',
        consent_version   VARCHAR(50)  NOT NULL DEFAULT '1.0',
        monitoring_preferences JSONB   NOT NULL DEFAULT '[]',
        signed_at         TIMESTAMPTZ,
        e_signature_image TEXT,
        printed_name      VARCHAR(255),
        status            VARCHAR(30)  NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','signed','withdrawn','superseded')),
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS consent_audit_logs (
        log_id       BIGSERIAL PRIMARY KEY,
        consent_id   BIGINT REFERENCES consent_documents(consent_id) ON DELETE SET NULL,
        employee_id  INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        actor_id     INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        actor_role   VARCHAR(50),
        event_type   VARCHAR(80) NOT NULL,
        details      TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS consent_documents_employee_idx ON consent_documents(employee_id);
      CREATE INDEX IF NOT EXISTS consent_documents_status_idx   ON consent_documents(status);
      CREATE INDEX IF NOT EXISTS consent_audit_employee_idx ON consent_audit_logs(employee_id);
      CREATE INDEX IF NOT EXISTS consent_audit_consent_idx  ON consent_audit_logs(consent_id);
    `);
    await db.query(`
      ALTER TABLE consent_documents DROP CONSTRAINT IF EXISTS consent_documents_status_check;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS device_uuid UUID;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS device_id BIGINT;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS asset_id INTEGER;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS department_id INTEGER;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS requested_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS revision_reason TEXT;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS effective_date DATE;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS reason_for_version TEXT;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS previous_consent_id BIGINT REFERENCES consent_documents(consent_id) ON DELETE SET NULL;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS verification_code VARCHAR(80);
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS hostname VARCHAR(255);
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS document_object_key TEXT;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS signature_object_key TEXT;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS document_file_hash VARCHAR(128);
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS document_file_size BIGINT;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS document_generated_at TIMESTAMPTZ;
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS storage_status VARCHAR(30) NOT NULL DEFAULT 'not_generated';
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS storage_error TEXT;
      UPDATE consent_documents SET status='pending_employee' WHERE status='pending';
      UPDATE consent_documents SET status='approved', active=true, approved_at=COALESCE(approved_at, signed_at), submitted_at=COALESCE(submitted_at, signed_at) WHERE status='signed';
      ALTER TABLE consent_documents ADD CONSTRAINT consent_documents_status_check
        CHECK (status IN ('draft','pending_employee','submitted','pending_approval','approved','rejected','revision_requested','withdrawn','expired','superseded','pending','signed'));

      CREATE UNIQUE INDEX IF NOT EXISTS consent_documents_active_employee_device_uidx
        ON consent_documents(employee_id, device_uuid)
        WHERE active = true AND status = 'approved' AND device_uuid IS NOT NULL;

      CREATE TABLE IF NOT EXISTS endpoint_monitoring_policies (
        policy_id BIGSERIAL PRIMARY KEY,
        consent_id BIGINT NOT NULL REFERENCES consent_documents(consent_id) ON DELETE CASCADE,
        consent_version VARCHAR(50) NOT NULL,
        employee_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        asset_id INTEGER,
        device_uuid UUID,
        branch_id INTEGER,
        department_id INTEGER,
        application_monitoring BOOLEAN NOT NULL DEFAULT false,
        web_monitoring BOOLEAN NOT NULL DEFAULT false,
        screenshot_monitoring BOOLEAN NOT NULL DEFAULT false,
        usb_monitoring BOOLEAN NOT NULL DEFAULT false,
        location_tracking BOOLEAN NOT NULL DEFAULT false,
        device_telemetry BOOLEAN NOT NULL DEFAULT true,
        email_header_monitoring BOOLEAN NOT NULL DEFAULT false,
        retention_days INTEGER NOT NULL DEFAULT 180,
        effective_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(30) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS endpoint_policies_device_status_idx ON endpoint_monitoring_policies(device_uuid, status, effective_at DESC);
      CREATE INDEX IF NOT EXISTS endpoint_policies_employee_status_idx ON endpoint_monitoring_policies(employee_id, status, effective_at DESC);

      CREATE TABLE IF NOT EXISTS monitoring_retention_rules (
        rule_id BIGSERIAL PRIMARY KEY,
        data_type VARCHAR(80) NOT NULL UNIQUE,
        retention_days INTEGER NOT NULL,
        description TEXT,
        updated_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO monitoring_retention_rules (data_type, retention_days, description)
      VALUES
        ('activity_timeline', 180, 'Activity Timeline'),
        ('screenshots', 90, 'Screenshots'),
        ('usb_logs', 365, 'USB Logs'),
        ('alert_logs', 730, 'Alert Logs'),
        ('audit_logs', 2555, 'Audit Logs')
      ON CONFLICT (data_type) DO NOTHING;
    `);
    // Idempotently add optional user fields used by consent documents
    await db.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_number VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(255);
    `);
    return true;
  } catch (err) {
    console.error("[consent] table init failed:", err.message);
    return false;
  }
})();

router.use(async (_req, res, next) => {
  if (await tablesReady) return next();
  return res.status(503).json({ success: false, message: "Consent storage unavailable." });
});

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function parseUser(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  try { return jwt.verify(auth.slice(7), JWT_SECRET); } catch { return null; }
}

function requireAuth(req, res, next) {
  const user = parseUser(req);
  if (!user) return res.status(401).json({ success: false, message: "Authentication required." });
  req.actor = user;
  return next();
}

function requireAdminOrHR(req, res, next) {
  const user = parseUser(req);
  if (!user) return res.status(401).json({ success: false, message: "Authentication required." });
  const r = String(user.role || "").toLowerCase().replace(/[\s_-]/g, "");
  if (!["superadmin", "admin", "hr"].includes(r))
    return res.status(403).json({ success: false, message: "Admin or HR role required." });
  req.actor = user;
  return next();
}

// ─── Audit helper ─────────────────────────────────────────────────────────────
async function audit(consentId, employeeId, actorId, actorRole, eventType, details) {
  try {
    await db.query(
      `INSERT INTO consent_audit_logs (consent_id,employee_id,actor_id,actor_role,event_type,details)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [consentId || null, employeeId || null, actorId || null, actorRole || null, eventType, details || null]
    );
  } catch (err) {
    console.error("[consent:audit] failed:", err.message);
  }
}

function normalizeStatus(value) {
  const status = String(value || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (status === "pending") return "pending_employee";
  if (status === "signed") return "approved";
  return CONSENT_STATUSES.includes(status) ? status : "draft";
}

function actorId(actor) {
  return actor?.userId || actor?.user_id || null;
}

function selectedPrefs(doc) {
  return Array.isArray(doc?.monitoring_preferences) ? doc.monitoring_preferences : [];
}

async function generateEndpointPolicy(doc, actor) {
  const prefs = selectedPrefs(doc);
  await db.query(
    `UPDATE endpoint_monitoring_policies SET status='superseded'
     WHERE status='active' AND employee_id=$1
       AND (($2::uuid IS NULL AND device_uuid IS NULL) OR device_uuid=$2::uuid)`,
    [doc.employee_id, doc.device_uuid || null]
  );
  const policy = await db.query(
    `INSERT INTO endpoint_monitoring_policies (
       consent_id, consent_version, employee_id, asset_id, device_uuid, branch_id, department_id,
       application_monitoring, web_monitoring, screenshot_monitoring, usb_monitoring,
       location_tracking, device_telemetry, email_header_monitoring, retention_days, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,180,'active')
     RETURNING *`,
    [
      doc.consent_id,
      doc.consent_version || "1.0",
      doc.employee_id,
      doc.asset_id || null,
      doc.device_uuid || null,
      doc.branch_id || null,
      doc.department_id || null,
      hasPreference(prefs, "application_monitoring", "applications", "activity_monitoring", "app_usage", "window_title", "idle_time"),
      hasPreference(prefs, "web_monitoring", "website_monitoring", "network_domains", "browser"),
      prefs.includes("screenshot_monitoring") || prefs.includes("screenshot"),
      prefs.includes("usb_monitoring"),
      prefs.includes("location_tracking"),
      prefs.includes("email_header_monitoring"),
    ]
  );
  await audit(doc.consent_id, doc.employee_id, actorId(actor), actor?.role || "system", "policy_generated", `Policy ${policy.rows[0].policy_id} generated.`);
  return policy.rows[0];
}

function hasPreference(prefs, ...names) {
  return Array.isArray(prefs) && names.some((name) => prefs.includes(name));
}

async function regenerateEffectiveEndpointPolicy(deviceUuid, actor) {
  if (!deviceUuid) return null;
  const deviceResult = await db.query(
    `SELECT d.*, u.department as employee_department
     FROM monitored_devices d
     LEFT JOIN users u ON u.user_id=d.assigned_user_id
     WHERE d.device_uuid=$1::uuid LIMIT 1`,
    [deviceUuid]
  );
  if (!deviceResult.rows.length) return null;
  const device = deviceResult.rows[0];

  const assignments = await db.query(
    `SELECT a.*, p.priority, p.config_json, p.name
     FROM endpoint_policy_assignments a
     JOIN endpoint_policies p ON p.id=a.policy_id
     WHERE p.is_active=true`
  );

  const defaultConfig = {
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
    dlp_high_risk_extensions: DEFAULT_HIGH_RISK_EXTENSIONS,
    dlp_sensitive_filename_keywords: DEFAULT_SENSITIVE_FILENAME_KEYWORDS,
    intervals: { heartbeat: 60, activity: 60 },
    retention: { logs_days: 30 },
  };
  let effectiveConfig = { ...defaultConfig };
  let effectivePolicyName = "Company Default Safe Policy";
  let effectivePolicyVersion = "1.0";
  const featureSources = {};
  const consentResult = device.assigned_user_id ? await db.query(
    `SELECT consent_id, consent_version, monitoring_preferences
     FROM consent_documents
     WHERE employee_id=$1
       AND (device_uuid=$2::uuid OR device_uuid IS NULL)
       AND status='approved' AND active=true
     ORDER BY (device_uuid IS NOT NULL) DESC, approved_at DESC NULLS LAST, consent_id DESC
     LIMIT 1`,
    [device.assigned_user_id, device.device_uuid]
  ) : { rows: [] };
  const consent = consentResult.rows[0] || null;
  const prefs = consent?.monitoring_preferences || [];

  if (consent) {
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
      effectivePolicyVersion = `consent-${consent.consent_version || consent.consent_id}`;
      for (const key of Object.keys(consentBaseline)) featureSources[key] = "Approved Consent";
  }

  const targetPriorities = { Employee: 6, Device: 5, Asset: 4, Department: 3, Branch: 2, Global: 1 };
  let highestPriority = 0;

  for (const row of assignments.rows) {
    let matches = false;
    const targetType = String(row.target_type || "").toLowerCase();
    if (targetType === "employee" && row.target_id === String(device.assigned_user_id)) matches = true;
    else if (targetType === "device" && row.target_id === String(device.device_uuid)) matches = true;
    else if (targetType === "asset" && row.target_id === String(device.asset_id)) matches = true;
    else if (targetType === "department" && (row.target_id === String(device.department) || row.target_id === String(device.employee_department))) matches = true;
    else if (targetType === "branch" && row.target_id === String(device.branch_id)) matches = true;
    else if (targetType === "global") matches = true;
    if (!matches) continue;
    const canonicalTargetType = targetType.charAt(0).toUpperCase() + targetType.slice(1);
    const score = (Number(row.priority) || 0) * 100 + (targetPriorities[canonicalTargetType] || 0);
    if (score >= highestPriority) {
      highestPriority = score;
      effectiveConfig = { ...effectiveConfig, ...(row.config_json || {}) };
      effectivePolicyName = row.name || `Policy ID ${row.policy_id}`;
      effectivePolicyVersion = `${row.priority || 0}.${row.id}`;
      for (const key of Object.keys(row.config_json || {})) featureSources[key] = canonicalTargetType;
    }
  }

  const reasons = {};
  const consentGated = [
    ["activity_monitoring_enabled", ["application_monitoring", "applications", "activity_monitoring", "app_usage", "window_title", "idle_time"], "Application/window activity and idle detection"],
    ["screenshot_monitoring_enabled", ["screenshot_monitoring", "screenshot"], "Screenshot Monitoring"],
    ["browser_monitoring_enabled", ["web_monitoring", "website_monitoring", "network_domains", "browser"], "Browser/domain monitoring"],
    ["usb_monitoring_enabled", ["usb_monitoring", "usb"], "USB activity monitoring"],
    ["location_tracking_enabled", ["location_tracking"], "Location tracking"],
  ];
  for (const [flag, names, label] of consentGated) {
    if (!device.assigned_user_id) {
      effectiveConfig[flag] = false;
      reasons[flag] = "Device is not assigned to an employee.";
    } else if (!consent) {
      effectiveConfig[flag] = false;
      reasons[flag] = "No active approved consent.";
    } else if (!hasPreference(prefs, ...names)) {
      effectiveConfig[flag] = false;
      reasons[flag] = `Employee consent excludes ${label}.`;
    } else if (!effectiveConfig[flag]) {
      reasons[flag] = `Disabled by ${featureSources[flag] || "endpoint"} policy.`;
    }
  }

  const features = {};
  for (const key of [
    "heartbeat_enabled", "telemetry_enabled", "hardware_inventory_enabled", "software_inventory_enabled", "policy_sync_enabled",
    "activity_monitoring_enabled", "screenshot_monitoring_enabled", "browser_monitoring_enabled", "usb_monitoring_enabled",
    "location_tracking_enabled", "auto_incident_enabled",
  ]) {
    const needsConsent = consentGated.some(([flag]) => flag === key);
    features[key] = {
      enabled: !!effectiveConfig[key],
      source_policy: featureSources[key] || effectivePolicyName,
      consent_required: needsConsent,
      reason: effectiveConfig[key] ? null : (reasons[key] || "No endpoint policy assigned."),
    };
  }

  const policyJson = {
    device_uuid: device.device_uuid,
    policy_version: effectivePolicyVersion,
    policy_name: effectivePolicyName,
    consent_id: consent?.consent_id || null,
    consent_version: consent?.consent_version || null,
    ...effectiveConfig,
    features,
    reasons,
    generated_at: new Date().toISOString(),
  };
  await db.query(
    `INSERT INTO endpoint_effective_policies (device_uuid, policy_json, generated_at)
     VALUES ($1,$2,CURRENT_TIMESTAMP)
     ON CONFLICT (device_uuid) DO UPDATE SET policy_json=EXCLUDED.policy_json, generated_at=CURRENT_TIMESTAMP`,
    [deviceUuid, JSON.stringify(policyJson)]
  );
  await audit(consent?.consent_id || null, device.assigned_user_id, actorId(actor), actor?.role || "system", "effective_policy_generated", `Effective endpoint policy regenerated for ${deviceUuid}.`);
  return policyJson;
}

async function notifyBranchAdmins(branchId, title, message, metadata = {}) {
  const candidates = [];
  const attempts = [
    {
      sql: `SELECT u.user_id FROM users u LEFT JOIN roles r ON r.role_id=u.role_id
            WHERE LOWER(REPLACE(REPLACE(COALESCE(r.role_name,''),'_',''),' ','')) IN ('superadmin','admin')
              AND ($1::int IS NULL OR u.branch_id=$1 OR LOWER(REPLACE(REPLACE(COALESCE(r.role_name,''),'_',''),' ',''))='superadmin')`,
      params: [branchId || null],
    },
    {
      sql: `SELECT user_id FROM users
            WHERE LOWER(REPLACE(REPLACE(COALESCE(role_name,''),'_',''),' ','')) IN ('superadmin','admin')
              AND ($1::int IS NULL OR branch_id=$1 OR LOWER(REPLACE(REPLACE(COALESCE(role_name,''),'_',''),' ',''))='superadmin')`,
      params: [branchId || null],
    },
    {
      sql: `SELECT user_id FROM users WHERE ($1::int IS NULL OR branch_id=$1)`,
      params: [branchId || null],
    },
  ];
  for (const attempt of attempts) {
    const result = await db.query(attempt.sql, attempt.params).catch(() => ({ rows: [] }));
    if (result.rows.length) {
      candidates.push(...result.rows);
      break;
    }
  }
  const seen = new Set();
  const admins = candidates.filter((admin) => {
    if (seen.has(admin.user_id)) return false;
    seen.add(admin.user_id);
    return true;
  });
  await Promise.all(admins.map((admin) => createNotification({
    userId: admin.user_id,
    title,
    message,
    type: "privacy_consent",
    relatedEntityType: metadata?.relatedEntityType || "consent",
    relatedEntityId: metadata?.consentId || metadata?.relatedEntityId || null,
    metadata,
    dedupeKey: metadata?.dedupeKey ? `${metadata.dedupeKey}-${admin.user_id}` : null,
  }).catch(() => null)));
}

async function notifyConsentEmployee(doc, title, message, dedupeSuffix) {
  await createNotification({
    userId: doc.employee_id,
    title,
    message,
    type: "privacy_consent",
    relatedEntityType: "consent",
    relatedEntityId: doc.consent_id,
    metadata: { consentId: doc.consent_id, deviceUuid: doc.device_uuid, assetId: doc.asset_id },
    dedupeKey: `consent-${doc.consent_id}-${dedupeSuffix}`,
  }).catch(() => null);
}

async function assertConsentAccess(req, consent) {
  const role = String(req.actor?.role || "").toLowerCase().replace(/[\s_-]/g, "");
  if (role === "superadmin" || role === "hr") return true;
  if (role === "admin") return String(consent.branch_id || "") === String(req.actor.branchId || req.actor.branch_id || "");
  return String(consent.employee_id || "") === String(actorId(req.actor) || "");
}

// ─── Manila timestamp helper ──────────────────────────────────────────────────
function manilaTime(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  return d.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: true,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMPLOYEE ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /consent/my — fetch my active/latest consent document
router.get("/my", requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT cd.*, md.hostname, md.device_name, ha.asset_tag, ha.serial_number, ha.model, b.branch_name
       FROM consent_documents cd
       LEFT JOIN monitored_devices md ON md.device_uuid = cd.device_uuid
       LEFT JOIN hardware_assets ha ON ha.asset_id = cd.asset_id
       LEFT JOIN branches b ON b.branch_id = cd.branch_id
       WHERE cd.employee_id=$1
       ORDER BY CASE cd.status WHEN 'pending_employee' THEN 0 WHEN 'revision_requested' THEN 1 WHEN 'pending_approval' THEN 2 WHEN 'approved' THEN 3 ELSE 4 END,
                cd.created_at DESC LIMIT 1`,
      [req.actor.userId || req.actor.user_id]
    );
    return res.json({ success: true, data: result.rows[0] || null });
  } catch (err) {
    console.error("[consent:my]", err.message);
    return res.status(500).json({ success: false, message: "Failed to load consent." });
  }
});

// POST /consent/draft — resume an assigned request, or start a draft when no approved consent exists
router.post("/draft", requireAuth, async (req, res) => {
  const employeeId = req.actor.userId || req.actor.user_id;
  try {
    // Device assignment can legitimately create a new pending request even when
    // the employee already has an approved consent for another device/version.
    // Always resume that explicit request before applying the general duplicate guard.
    const pendingRequest = await db.query(
      `SELECT * FROM consent_documents
       WHERE employee_id=$1 AND status IN ('pending_employee','revision_requested','draft','pending')
       ORDER BY
         CASE WHEN device_uuid IS NOT NULL THEN 0 ELSE 1 END,
         requested_at DESC NULLS LAST,
         created_at DESC
       LIMIT 1`,
      [employeeId]
    );

    if (pendingRequest.rows.length) {
      const resumed = await db.query(
        `UPDATE consent_documents
         SET monitoring_preferences=CASE
               WHEN $1::jsonb = '[]'::jsonb THEN monitoring_preferences
               ELSE $1::jsonb
             END,
             status=CASE WHEN status='draft' THEN 'draft' ELSE status END,
             updated_at=CURRENT_TIMESTAMP
         WHERE consent_id=$2
         RETURNING *`,
        [JSON.stringify(req.body.monitoring_preferences || []), pendingRequest.rows[0].consent_id]
      );
      await audit(
        resumed.rows[0].consent_id,
        employeeId,
        employeeId,
        req.actor.role,
        "consent_resumed",
        resumed.rows[0].device_uuid
          ? "Employee opened the assigned device-monitoring consent request."
          : "Employee resumed the existing consent request."
      );
      return res.json({ success: true, data: resumed.rows[0], resumed: true });
    }

    // Without an explicit pending request, an approved document must be changed
    // through the audited consent-change workflow rather than replaced silently.
    const existing = await db.query(
      `SELECT consent_id, status FROM consent_documents
       WHERE employee_id=$1 AND status IN ('approved','signed') LIMIT 1`,
      [employeeId]
    );
    if (existing.rows.length)
      return res.status(409).json({
        success: false,
        message: "You already have an approved consent document. Use 'Request Consent Change' to modify it.",
        existing: existing.rows[0],
      });

    // Fetch employee profile
    const userRes = await db.query(
      `SELECT u.full_name, u.email, u.employee_number,
              b.branch_name, b.branch_id, u.department
       FROM users u
       LEFT JOIN branches b ON b.branch_id=u.branch_id
       WHERE u.user_id=$1`,
      [employeeId]
    );
    if (!userRes.rows.length)
      return res.status(404).json({ success: false, message: "Employee profile not found." });
    const emp = userRes.rows[0];

    const draft = await db.query(
      `INSERT INTO consent_documents
         (employee_id,employee_full_name,employee_email,employee_number,
          branch_id,branch_name,department,form_title,consent_version,
          monitoring_preferences,status,requested_at,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',CURRENT_TIMESTAMP,$1)
       RETURNING *`,
      [
        employeeId,
        emp.full_name || "Unknown",
        emp.email || "",
        emp.employee_number || null,
        emp.branch_id || null,
        emp.branch_name || null,
        emp.department || null,
        "RA 10173 Data Privacy Consent — Employee Monitoring",
        "1.0",
        JSON.stringify(req.body.monitoring_preferences || []),
      ]
    );
    await audit(draft.rows[0].consent_id, employeeId, employeeId, req.actor.role, "consent_created",
      "Employee opened consent wizard.");
    return res.status(201).json({ success: true, data: draft.rows[0] });
  } catch (err) {
    console.error("[consent:draft]", err.message);
    return res.status(500).json({ success: false, message: "Failed to create consent draft." });
  }
});

// POST /consent/:id/sign — employee signs the consent (locks it)
router.post("/:id/sign", requireAuth, async (req, res) => {
  const employeeId = req.actor.userId || req.actor.user_id;
  try {
    const docRes = await db.query(
      `SELECT * FROM consent_documents WHERE consent_id=$1 AND employee_id=$2 AND status IN ('draft','pending_employee','revision_requested','pending')`,
      [req.params.id, employeeId]
    );
    if (!docRes.rows.length)
      return res.status(404).json({
        success: false,
        message: "Consent document not found or already signed.",
      });

    const { e_signature_image, monitoring_preferences } = req.body;
    if (!e_signature_image)
      return res.status(400).json({ success: false, message: "E-signature is required." });
    const profileName = await db.query(`SELECT full_name FROM users WHERE user_id=$1`, [employeeId]).catch(() => ({ rows: [] }));
    const finalPrintedName = String(profileName.rows[0]?.full_name || docRes.rows[0].employee_full_name || "").trim();
    if (!finalPrintedName)
      return res.status(400).json({ success: false, message: "Printed name is required." });

    // Save signature image as file (base64 → PNG) for durable storage
    const storage = getR2Status();
    if (!storage.configured) {
      return res.status(503).json({ success: false, message: `Private consent storage is not configured. Missing: ${storage.missing.join(", ")}.` });
    }
    if (!/^data:image\/png;base64,/i.test(String(e_signature_image))) {
      return res.status(400).json({ success: false, message: "Signature must be a PNG image generated by the signature pad." });
    }
    const signatureBytes = Buffer.from(String(e_signature_image).replace(/^data:image\/png;base64,/i, ""), "base64");
    if (signatureBytes.length < 100 || signatureBytes.length > 2 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: "Signature image is empty or exceeds the 2 MB limit." });
    }
    const signatureObjectKey = `consents/${employeeId}/${req.params.id}/signature.png`;
    await putPrivateObject({
      key: signatureObjectKey,
      body: signatureBytes,
      contentType: "image/png",
      metadata: { consentId: req.params.id, employeeId },
    });

    const now = new Date();
    let updated = await db.query(
      `UPDATE consent_documents SET
         status='pending_approval',
         signed_at=$1,
         submitted_at=$1,
         e_signature_image=NULL,
         signature_object_key=$2,
         printed_name=$3,
         monitoring_preferences=$4,
         storage_status='signature_stored',storage_error=NULL,
         updated_at=CURRENT_TIMESTAMP
       WHERE consent_id=$5 AND employee_id=$6
       RETURNING *`,
      [
        now,
        signatureObjectKey,
        finalPrintedName.slice(0, 255),
        JSON.stringify(monitoring_preferences || docRes.rows[0].monitoring_preferences || []),
        req.params.id,
        employeeId,
      ]
    );

    await audit(req.params.id, employeeId, employeeId, req.actor.role, "consent_signed",
      `Signed at ${manilaTime(now)}. Printed name: ${finalPrintedName}.`);
    await audit(req.params.id, employeeId, employeeId, req.actor.role, "signature_saved",
      "Employee e-signature saved.");
    await audit(req.params.id, employeeId, employeeId, req.actor.role, "consent_submitted",
      "Employee submitted consent for admin approval.");

    const previousOnboarding = await db.query(`SELECT onboarding_status FROM users WHERE user_id=$1`, [employeeId]);
    await db.query(
      `UPDATE users SET onboarding_status='Consent Submitted',onboarding_required=TRUE,
         consent_submitted_at=$1,onboarding_consent_id=$2 WHERE user_id=$3`,
      [now, req.params.id, employeeId]
    );
    await db.query(
      `INSERT INTO user_onboarding_history (user_id,previous_status,new_status,consent_id,changed_by,reason)
       VALUES ($1,$2,'Consent Submitted',$3,$1,'Employee submitted consent for approval.')`,
      [employeeId, previousOnboarding.rows[0]?.onboarding_status || null, req.params.id]
    );

    const auditResult = await db.query(`SELECT * FROM consent_audit_logs WHERE consent_id=$1 ORDER BY created_at ASC`, [req.params.id]);
    const pdfBuffer = await createConsentPdfBuffer(updated.rows[0], auditResult.rows, signatureBytes);
    const documentObjectKey = `consents/${employeeId}/${req.params.id}/consent.pdf`;
    const documentHash = crypto.createHash("sha256").update(pdfBuffer).digest("hex");
    await putPrivateObject({
      key: documentObjectKey,
      body: pdfBuffer,
      contentType: "application/pdf",
      metadata: { consentId: req.params.id, employeeId, sha256: documentHash },
    });
    updated = await db.query(
      `UPDATE consent_documents SET document_object_key=$1,document_file_hash=$2,
         document_file_size=$3,document_generated_at=CURRENT_TIMESTAMP,
         storage_status='stored',storage_error=NULL,updated_at=CURRENT_TIMESTAMP
       WHERE consent_id=$4 RETURNING *`,
      [documentObjectKey, documentHash, pdfBuffer.length, req.params.id]
    );

    await notifyBranchAdmins(updated.rows[0].branch_id, "Consent pending approval", `${updated.rows[0].employee_full_name} submitted endpoint monitoring consent for approval.`, {
      consentId: updated.rows[0].consent_id,
      deviceUuid: updated.rows[0].device_uuid,
      relatedEntityType: "consent",
      dedupeKey: `consent-submitted-${updated.rows[0].consent_id}`,
    });

    return res.json({ success: true, data: updated.rows[0] });
  } catch (err) {
    console.error("[consent:sign]", err.message);
    return res.status(500).json({ success: false, message: "Failed to sign consent." });
  }
});

// POST /consent/request-change — employee files a change/withdrawal request (creates a service ticket)
router.post("/request-change", requireAuth, async (req, res) => {
  const employeeId = req.actor.userId || req.actor.user_id;
  const { consent_id, change_type, reason, requested_changes, current_preferences } = req.body;
  if (!reason || !reason.trim())
    return res.status(400).json({ success: false, message: "Reason is required." });

  try {
    // Fetch active consent
    const consentRes = await db.query(
      `SELECT * FROM consent_documents WHERE consent_id=$1 AND employee_id=$2`,
      [consent_id, employeeId]
    );
    const consent = consentRes.rows[0];
    if (!consent)
      return res.status(404).json({ success: false, message: "Consent document not found." });

    // Build ticket title and description
    const title = change_type === "withdraw"
      ? "Consent Withdrawal Request — RA 10173"
      : "Consent Change Request — RA 10173";
    const currentPrefs = Array.isArray(current_preferences || consent.monitoring_preferences)
      ? (current_preferences || consent.monitoring_preferences).join(", ") || "None"
      : "None";
    const description = [
      `[Category: Privacy Request | Subtype: Consent Change]`,
      ``,
      `Employee: ${consent.employee_full_name} (${consent.employee_email})`,
      `Branch: ${consent.branch_name || "—"}`,
      `Consent Document ID: ${consent.consent_id}`,
      `Consent Version: ${consent.consent_version}`,
      `Request Type: ${change_type === "withdraw" ? "Full Withdrawal" : "Preference Change"}`,
      ``,
      `Current Monitoring Preferences:`,
      currentPrefs,
      ``,
      `Reason:`,
      reason.trim(),
      requested_changes ? `\nRequested Changes:\n${requested_changes.trim()}` : "",
    ].join("\n");

    // Find or create "Consent / Privacy Request" category
    let categoryId = null;
    try {
      const catUpsert = await db.query(
        `INSERT INTO ticket_categories (category_name) VALUES ($1)
         ON CONFLICT (category_name) DO UPDATE SET category_name=EXCLUDED.category_name
         RETURNING category_id`,
        ["Consent / Privacy Request"]
      );
      categoryId = catUpsert.rows[0]?.category_id || null;
    } catch (_catErr) {
      // If upsert fails (e.g. no ON CONFLICT support), try SELECT
      try {
        const catSel = await db.query(`SELECT category_id FROM ticket_categories WHERE category_name=$1`, ["Consent / Privacy Request"]);
        categoryId = catSel.rows[0]?.category_id || null;
      } catch {}
    }

    // Generate ticket number
    const countRes = await db.query(`SELECT COUNT(*)::int AS count FROM tickets WHERE DATE(created_at)=CURRENT_DATE`);
    const nextNum = (countRes.rows[0]?.count || 0) + 1;
    // Find or create 'Privacy Request' category
    let privCategoryId = null;
    try {
      const privCat = await db.query(
        `INSERT INTO ticket_categories (category_name) VALUES ($1)
         ON CONFLICT (category_name) DO UPDATE SET category_name=EXCLUDED.category_name RETURNING category_id`,
        ["Privacy Request"]
      );
      privCategoryId = privCat.rows[0]?.category_id || null;
    } catch { privCategoryId = null; }
    const ticketNumber = `TKT-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${String(nextNum).padStart(4,"0")}`;

    const ticketRes = await db.query(
      `INSERT INTO tickets (ticket_number, title, description, status, priority, category_id, requester_id, created_at, updated_at)
       VALUES ($1,$2,$3,'Open Queue','P3-Medium',$4,$5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
       RETURNING *`,
      [ticketNumber, title, description, privCategoryId || categoryId, employeeId]
    );
    const ticket = ticketRes.rows[0];

    await audit(consent_id, employeeId, employeeId, req.actor.role,
      "consent_change_requested",
      `Request type: ${change_type || "change"}. Ticket: ${ticket.id} (${ticketNumber}). Reason: ${reason.trim()}`);  

    return res.json({
      success: true,
      message: "Consent change request submitted. An admin or HR officer will review it.",
      ticket_id: ticket.id,
      ticket_number: ticketNumber,
    });
  } catch (err) {
    console.error("[consent:request-change]", err.message);
    return res.status(500).json({ success: false, message: "Failed to submit consent change request." });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN / HR ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /consent/all — list all consent documents
router.get("/all", requireAuth, async (req, res) => {
  try {
    const actor = req.actor;
    const role = String(actor.role || "").toLowerCase().replace(/[\s_-]/g, "");
    
    let queryArgs = [];
    let whereClause = "";

    if (role === "superadmin" || role === "hr") {
      whereClause = "";
    } else if (role === "admin") {
      whereClause = "WHERE cd.branch_id = $1";
      queryArgs.push(actor.branchId || actor.branch_id);
    } else {
      return res.status(403).json({ success: false, message: "Consent Management requires Admin access." });
    }

    const result = await db.query(
      `SELECT cd.consent_id, 
              cd.employee_full_name AS employee, 
              cd.employee_full_name,
              cd.employee_email,
              cd.employee_number,
              cd.employee_id, 
              b.branch_name AS branch, 
              b.branch_name,
              cd.department, 
              cd.monitoring_preferences, 
              cd.e_signature_image AS signature, 
              cd.status AS consent_status, 
              cd.status AS status,
              cd.signed_at,
              cd.submitted_at,
              cd.approved_at,
              cd.created_at AS requested_at,
              cd.device_uuid,
              cd.asset_id,
              COALESCE(cd.hostname, md.hostname) AS hostname,
              md.device_name,
              ha.asset_tag,
              ha.model,
              cd.printed_name,
              cd.e_signature_image,
              cd.signature_object_key,
              cd.document_object_key,
              cd.document_file_hash,
              cd.document_file_size,
              cd.document_generated_at,
              cd.storage_status,
              cd.storage_error,
              cd.form_title,
              cd.consent_version,
              eu.onboarding_status,
              eu.onboarding_required,
              md.last_policy_sync_at,
              ep.generated_at AS effective_policy_generated_at,
              ep.policy_json AS effective_policy,
              cd.updated_at
       FROM consent_documents cd
       LEFT JOIN branches b ON b.branch_id = cd.branch_id
       LEFT JOIN users eu ON eu.user_id = cd.employee_id
       LEFT JOIN monitored_devices md ON md.device_uuid = cd.device_uuid
       LEFT JOIN hardware_assets ha ON ha.asset_id = cd.asset_id
       LEFT JOIN endpoint_effective_policies ep ON ep.device_uuid = cd.device_uuid
       ${whereClause}
       ORDER BY cd.created_at DESC`,
       queryArgs
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("[consent:all]", err.message);
    return res.status(500).json({ success: false, message: "Failed to load consents." });
  }
});

// GET /consent/:id — single consent document
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const actor = req.actor;
    const role = String(actor.role || "").toLowerCase().replace(/[\s_-]/g, "");
    const isAdmin = ["superadmin", "admin", "hr"].includes(role);
    const employeeId = actor.userId || actor.user_id;

    const result = await db.query(
      `SELECT cd.*, md.hostname, md.device_name, ha.asset_tag, ha.serial_number, ha.model
       FROM consent_documents cd
       LEFT JOIN monitored_devices md ON md.device_uuid = cd.device_uuid
       LEFT JOIN hardware_assets ha ON ha.asset_id = cd.asset_id
       WHERE cd.consent_id=$1 ${isAdmin ? "" : "AND cd.employee_id=$2"}`,
      isAdmin ? [req.params.id] : [req.params.id, employeeId]
    );
    if (!result.rows.length)
      return res.status(404).json({ success: false, message: "Consent document not found." });

    if (!(await assertConsentAccess(req, result.rows[0]))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("[consent:get]", err.message);
    return res.status(500).json({ success: false, message: "Failed to load consent." });
  }
});

// POST /consent/:id/log-print — log that admin printed/downloaded the consent
router.post("/:id/log-print", requireAuth, async (req, res) => {
  const actor = req.actor;
  try {
    const docRes = await db.query(
      `SELECT employee_id FROM consent_documents WHERE consent_id=$1`, [req.params.id]
    );
    if (!docRes.rows.length)
      return res.status(404).json({ success: false, message: "Consent not found." });
    const eventType = req.body.action === "download" ? "consent_downloaded" : "consent_printed";
    await audit(req.params.id, docRes.rows[0].employee_id, actor.userId || actor.user_id,
      actor.role, eventType, `Document ${req.body.action === "download" ? "downloaded" : "printed"} by ${actor.role}.`);
    return res.json({ success: true });
  } catch (err) {
    console.error("[consent:log-print]", err.message);
    return res.status(500).json({ success: false, message: "Failed to log print." });
  }
});

// PUT /consent/:id/admin-action — admin approves withdrawal or change
function signatureBuffer(signature) {
  if (!signature) return null;
  try {
    if (String(signature).startsWith("data:image/")) {
      return Buffer.from(String(signature).replace(/^data:image\/\w+;base64,/, ""), "base64");
    }
    if (String(signature).startsWith("/uploads/")) {
      const fullPath = path.join(__dirname, "..", "..", String(signature).replace(/^\//, ""));
      if (fs.existsSync(fullPath)) return fs.readFileSync(fullPath);
    }
  } catch (_error) {}
  return null;
}

async function loadConsentSignature(consent) {
  if (consent.signature_object_key) {
    const stored = await getPrivateObject(consent.signature_object_key);
    return stored.body;
  }
  return signatureBuffer(consent.e_signature_image);
}

const CONSENT_PDF_TEMPLATE = path.join(__dirname, "..", "..", "assets", "data-privacy-consent-form-template.pdf");

function consentSigningDate(consent) {
  const value = consent.signed_at || consent.submitted_at || consent.approved_at || consent.updated_at;
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("month")}/${part("day")}/${part("year")}`;
}

function fittedFontSize(font, text, maxWidth, preferredSize = 9, minimumSize = 6) {
  let size = preferredSize;
  while (size > minimumSize && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.25;
  return size;
}

async function createConsentPdfBuffer(consent, _auditRows = [], storedSignature = null) {
  const templateBytes = await fs.promises.readFile(CONSENT_PDF_TEMPLATE);
  const pdf = await PDFLibDocument.load(templateBytes);
  const page = pdf.getPages()[2];
  if (!page) throw new Error("The consent PDF template must contain three pages.");

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.08, 0.08, 0.08);
  const paper = rgb(1, 1, 1);
  const lineY = 492.25;
  const fields = {
    name: { x: 171.25, width: 116.75 },
    signature: { x: 343.5, width: 76.25 },
    date: { x: 450.75, width: 81.25 },
  };

  for (const field of Object.values(fields)) {
    page.drawRectangle({ x: field.x - 1, y: lineY - 2, width: field.width + 2, height: 18, color: paper });
    page.drawLine({
      start: { x: field.x, y: lineY },
      end: { x: field.x + field.width, y: lineY },
      thickness: 0.45,
      color: ink,
    });
  }

  const employeeName = String(consent.printed_name || consent.employee_full_name || "").trim();
  const nameSize = fittedFontSize(font, employeeName, fields.name.width - 4);
  page.drawText(employeeName, { x: fields.name.x + 2, y: lineY + 2.5, size: nameSize, font, color: ink });

  const dateText = consentSigningDate(consent);
  const dateSize = fittedFontSize(font, dateText, fields.date.width - 4, 8.5, 7);
  page.drawText(dateText, { x: fields.date.x + 2, y: lineY + 2.5, size: dateSize, font, color: ink });

  const signature = storedSignature || signatureBuffer(consent.e_signature_image);
  if (signature) {
    const normalized = await sharp(signature).trim().png().toBuffer();
    const signatureImage = await pdf.embedPng(normalized);
    const dimensions = signatureImage.scaleToFit(fields.signature.width - 4, 25);
    page.drawImage(signatureImage, {
      x: fields.signature.x + (fields.signature.width - dimensions.width) / 2,
      y: lineY + 1,
      width: dimensions.width,
      height: dimensions.height,
    });
  }

  return Buffer.from(await pdf.save());
}

router.get("/:id/pdf", requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT cd.*, md.hostname, md.device_name, ha.asset_tag, ha.serial_number, ha.model, u.full_name AS approver_name
       FROM consent_documents cd
       LEFT JOIN monitored_devices md ON md.device_uuid=cd.device_uuid
       LEFT JOIN hardware_assets ha ON ha.asset_id=cd.asset_id
       LEFT JOIN users u ON u.user_id=cd.approved_by
       WHERE cd.consent_id=$1`,
      [req.params.id]
    );

    const consent = result.rows[0];
    if (!consent) return res.status(404).json({ success: false, message: "Consent document not found." });
    if (!(await assertConsentAccess(req, consent))) return res.status(403).json({ success: false, message: "Access denied." });
    if (!["approved", "signed"].includes(String(consent.status).toLowerCase())) {
      return res.status(400).json({ success: false, message: "PDF download is available after consent approval." });
    }
    const storedSignature = await loadConsentSignature(consent);
    const pdfBuffer = await createConsentPdfBuffer(consent, [], storedSignature);
    await audit(consent.consent_id, consent.employee_id, actorId(req.actor), req.actor.role, "consent_pdf_downloaded", "Consent PDF generated/downloaded.");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="AstreaBlue-Consent-${consent.consent_id}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("[consent:pdf]", err.message);
    return res.status(500).json({ success: false, message: "Could not generate the consent PDF right now. Please try again." });
  }
});

router.get("/:id/signature", requireAuth, async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM consent_documents WHERE consent_id=$1`, [req.params.id]);
    const consent = result.rows[0];
    if (!consent) return res.status(404).json({ success: false, message: "Consent document not found." });
    if (!(await assertConsentAccess(req, consent))) return res.status(403).json({ success: false, message: "Access denied." });
    if (!consent.signature_object_key) return res.status(404).json({ success: false, message: "Stored signature is unavailable." });
    const stored = await getPrivateObject(consent.signature_object_key);
    res.setHeader("Content-Type", stored.contentType || "image/png");
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(stored.body);
  } catch (error) {
    console.error("[consent:signature]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load the protected signature." });
  }
});

router.put("/:id/admin-action", requireAdminOrHR, async (req, res) => {
  const { action, notes } = req.body; // action: 'withdraw' | 'supersede' | 'reject'
  const actor = req.actor;
  try {
    const docRes = await db.query(
      `SELECT * FROM consent_documents WHERE consent_id=$1`, [req.params.id]
    );
    if (!docRes.rows.length)
      return res.status(404).json({ success: false, message: "Consent not found." });

    if (!(await assertConsentAccess(req, docRes.rows[0]))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }
    let newStatus = normalizeStatus(docRes.rows[0].status);
    let eventType = "consent_approved";
    if (action === "withdraw") {
      newStatus = "withdrawn";
      eventType = "consent_withdrawn";
    } else if (action === "supersede") {
      newStatus = "superseded";
      eventType = "consent_superseded";
    } else if (action === "reject") {
      newStatus = "rejected";
      eventType = "consent_rejected";
    }

    await db.query(
      `UPDATE consent_documents SET status=$1, active=false, updated_at=CURRENT_TIMESTAMP WHERE consent_id=$2`,
      [newStatus, req.params.id]
    );
    if (docRes.rows[0].device_uuid) {
      await regenerateEffectiveEndpointPolicy(docRes.rows[0].device_uuid, actor);
    }
    if (newStatus === "withdrawn") {
      await notifyConsentEmployee(docRes.rows[0], "Consent withdrawn", "Your endpoint monitoring consent was withdrawn. Optional monitoring has been disabled.", "withdrawn");
    } else if (newStatus === "rejected") {
      await notifyConsentEmployee(docRes.rows[0], "Consent rejected", notes || "Your endpoint monitoring consent was rejected. Please review the reason and submit again if needed.", "rejected");
    } else if (newStatus === "superseded") {
      await notifyConsentEmployee(docRes.rows[0], "Consent superseded", "A newer endpoint monitoring consent version replaced this record.", "superseded");
    }

    await audit(req.params.id, docRes.rows[0].employee_id,
      actor.userId || actor.user_id, actor.role, eventType,
      notes || `Admin action: ${action}.`);

    return res.json({ success: true, new_status: newStatus });
  } catch (err) {
    console.error("[consent:admin-action]", err.message);
    return res.status(500).json({ success: false, message: "Failed to apply admin action." });
  }
});

// POST /consent/:id/review - approve, reject, or request revision.
router.post("/:id/review", requireAdminOrHR, async (req, res) => {
  const actor = req.actor;
  const action = String(req.body.action || "").toLowerCase().replace(/[\s-]+/g, "_");
  const reason = String(req.body.reason || "").trim();
  if (!["approve", "reject", "request_revision"].includes(action)) {
    return res.status(400).json({ success: false, message: "Action must be approve, reject, or request_revision." });
  }
  if ((action === "reject" || action === "request_revision") && !reason) {
    return res.status(400).json({ success: false, message: "A reason is required." });
  }
  const client = await db.rawPool.connect();
  let doc;
  let updated;
  let policy = null;
  try {
    await client.query("BEGIN");
    const docRes = await client.query(`SELECT * FROM consent_documents WHERE consent_id=$1 FOR UPDATE`, [req.params.id]);
    doc = docRes.rows[0];
    if (!doc) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Consent not found." });
    }
    if (!(await assertConsentAccess(req, doc))) {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    if (action === "approve") {
      const verificationCode = doc.verification_code || `AB-CONSENT-${doc.consent_id}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
      const storedSignature = await loadConsentSignature(doc);
      if (!storedSignature) throw new Error("The protected employee signature is unavailable.");
      const pdfBuffer = await createConsentPdfBuffer({
        ...doc,
        status: "approved",
        approved_by: actorId(actor),
        approver_name: actor.name || actor.role,
        approved_at: new Date(),
        verification_code: verificationCode,
      }, [], storedSignature);
      const documentObjectKey = doc.document_object_key || `consents/${doc.employee_id}/${doc.consent_id}/consent.pdf`;
      await putPrivateObject({
        key: documentObjectKey,
        body: pdfBuffer,
        contentType: "application/pdf",
        metadata: { consentId: doc.consent_id, employeeId: doc.employee_id, verificationCode },
      });
      const documentHash = crypto.createHash("sha256").update(pdfBuffer).digest("hex");
      await client.query(
        `UPDATE consent_documents
         SET status='superseded', active=false, previous_consent_id=COALESCE(previous_consent_id, $1), updated_at=CURRENT_TIMESTAMP
         WHERE employee_id=$2 AND consent_id<>$1 AND status IN ('approved','signed') AND active=true
           AND (($3::uuid IS NULL AND device_uuid IS NULL) OR device_uuid=$3::uuid)`,
        [doc.consent_id, doc.employee_id, doc.device_uuid || null]
      );
      updated = await client.query(
        `UPDATE consent_documents
         SET status='approved', active=true, approved_by=$1, approved_at=CURRENT_TIMESTAMP,
             effective_date=COALESCE(effective_date, CURRENT_DATE),
             verification_code=COALESCE(verification_code, $2),
             document_object_key=$4,document_file_hash=$5,document_file_size=$6,
             document_generated_at=CURRENT_TIMESTAMP,storage_status='stored',storage_error=NULL,
             updated_at=CURRENT_TIMESTAMP
         WHERE consent_id=$3 RETURNING *`,
        [actorId(actor), verificationCode, doc.consent_id, documentObjectKey, documentHash, pdfBuffer.length]
      );
      const onboardingBefore = await client.query(`SELECT onboarding_status FROM users WHERE user_id=$1`, [doc.employee_id]);
      await client.query(
        `UPDATE users SET onboarding_status='Completed',onboarding_required=FALSE,
           onboarding_completed_at=CURRENT_TIMESTAMP,onboarding_consent_id=$1 WHERE user_id=$2`,
        [doc.consent_id, doc.employee_id]
      );
      await client.query(
        `INSERT INTO user_onboarding_history (user_id,previous_status,new_status,consent_id,changed_by,reason)
         VALUES ($1,$2,'Completed',$3,$4,'Consent approved; mandatory onboarding completed.')`,
        [doc.employee_id, onboardingBefore.rows[0]?.onboarding_status || null, doc.consent_id, actorId(actor)]
      );
    } else if (action === "reject") {
      updated = await client.query(
        `UPDATE consent_documents SET status='rejected', active=false, rejection_reason=$1, updated_at=CURRENT_TIMESTAMP
         WHERE consent_id=$2 RETURNING *`,
        [reason, doc.consent_id]
      );
      await client.query(`UPDATE users SET onboarding_status='Blocked',onboarding_required=TRUE WHERE user_id=$1`, [doc.employee_id]);
      await client.query(
        `INSERT INTO user_onboarding_history (user_id,previous_status,new_status,consent_id,changed_by,reason)
         VALUES ($1,'Consent Submitted','Blocked',$2,$3,$4)`,
        [doc.employee_id, doc.consent_id, actorId(actor), reason]
      );
    } else {
      updated = await client.query(
        `UPDATE consent_documents SET status='revision_requested', active=false, revision_reason=$1, updated_at=CURRENT_TIMESTAMP
         WHERE consent_id=$2 RETURNING *`,
        [reason, doc.consent_id]
      );
      await client.query(`UPDATE users SET onboarding_status='Revision Required',onboarding_required=TRUE WHERE user_id=$1`, [doc.employee_id]);
      await client.query(
        `INSERT INTO user_onboarding_history (user_id,previous_status,new_status,consent_id,changed_by,reason)
         VALUES ($1,'Consent Submitted','Revision Required',$2,$3,$4)`,
        [doc.employee_id, doc.consent_id, actorId(actor), reason]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[consent:review]", err.message);
    return res.status(500).json({ success: false, message: "Failed to review consent." });
  } finally {
    client.release();
  }

  // Policy generation, audit logging, and notifications are follow-up work.
  // They must not undo a legally approved consent or leave onboarding stuck.
  let followUpWarning = null;
  try {
    if (action === "approve") {
      policy = await generateEndpointPolicy(updated.rows[0], actor);
      const assignedDevices = updated.rows[0].device_uuid
        ? { rows: [{ device_uuid: updated.rows[0].device_uuid }] }
        : await db.query(
          `SELECT device_uuid FROM monitored_devices
           WHERE assigned_user_id=$1 AND device_uuid IS NOT NULL`,
          [updated.rows[0].employee_id]
        );
      for (const device of assignedDevices.rows) {
        await regenerateEffectiveEndpointPolicy(device.device_uuid, actor);
      }
      await audit(doc.consent_id, doc.employee_id, actorId(actor), actor.role, "consent_approved", "Consent approved; mandatory onboarding completed.");
      await notifyConsentEmployee(updated.rows[0], "Consent approved", "Your endpoint monitoring consent was approved. The endpoint policy is ready for agent synchronization.", "approved");
    } else if (action === "reject") {
      if (doc.device_uuid) await regenerateEffectiveEndpointPolicy(doc.device_uuid, actor);
      await audit(doc.consent_id, doc.employee_id, actorId(actor), actor.role, "consent_rejected", reason);
      await notifyConsentEmployee(updated.rows[0], "Consent rejected", reason, "rejected");
    } else {
      if (doc.device_uuid) await regenerateEffectiveEndpointPolicy(doc.device_uuid, actor);
      await audit(doc.consent_id, doc.employee_id, actorId(actor), actor.role, "revision_requested", reason);
      await notifyConsentEmployee(updated.rows[0], "Consent revision requested", reason, "revision-requested");
    }
  } catch (error) {
    followUpWarning = "Consent decision was saved, but endpoint policy follow-up must be retried.";
    console.error("[consent:review:follow-up]", error.message);
  }

  return res.json({ success: true, data: updated.rows[0], policy, follow_up_warning: followUpWarning });
});

// POST /consent/:id/approve-change — admin approves a change request, creates new consent version
router.post("/:id/approve-change", requireAdminOrHR, async (req, res) => {
  const { new_preferences, notes } = req.body;
  const actor = req.actor;
  try {
    const docRes = await db.query(
      `SELECT * FROM consent_documents WHERE consent_id=$1 AND status IN ('approved','signed')`,
      [req.params.id]
    );
    if (!docRes.rows.length)
      return res.status(404).json({ success: false, message: "Active signed consent not found." });
    const old = docRes.rows[0];

    // Bump major version: "1.0" → "2.0"
    const oldMajor = parseInt(String(old.consent_version || "1").split(".")[0]) || 1;
    const newVersion = `${oldMajor + 1}.0`;

    // Create new consent document inheriting employee identity + original signature
    const newDoc = await db.query(
      `INSERT INTO consent_documents
         (employee_id, employee_full_name, employee_email, employee_number,
          branch_id, branch_name, department, form_title, consent_version,
          monitoring_preferences, signed_at, e_signature_image, printed_name, status,
          submitted_at, approved_at, approved_by, active, previous_consent_id,
          assigned_user_id, device_uuid, device_id, asset_id, hostname)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_TIMESTAMP,$11,$12,'approved',
          CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,$13,true,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        old.employee_id, old.employee_full_name, old.employee_email, old.employee_number,
        old.branch_id, old.branch_name, old.department, old.form_title, newVersion,
        JSON.stringify(new_preferences || old.monitoring_preferences || []),
        old.e_signature_image, old.printed_name, actorId(actor), old.consent_id,
        old.assigned_user_id || old.employee_id,
        old.device_uuid || null,
        old.device_id || null,
        old.asset_id || null,
        old.hostname || null,
      ]
    );

    // Archive old consent
    await db.query(
      `UPDATE consent_documents SET status='superseded', active=false, updated_at=CURRENT_TIMESTAMP WHERE consent_id=$1`,
      [old.consent_id]
    );

    const newId = newDoc.rows[0].consent_id;
    await audit(old.consent_id, old.employee_id, actor.userId || actor.user_id, actor.role,
      "consent_superseded", `Superseded by new version ${newVersion} upon admin approval.`);
    await audit(newId, old.employee_id, actor.userId || actor.user_id, actor.role,
      "consent_approved", notes || `Change approved by ${actor.name || actor.role}. New version: ${newVersion}.`);
    await audit(newId, old.employee_id, actor.userId || actor.user_id, actor.role,
      "policy_updated", `Monitoring policy updated to consent version ${newVersion}.`);
    await generateEndpointPolicy(newDoc.rows[0], actor);
    const assignedDevices = newDoc.rows[0].device_uuid
      ? { rows: [{ device_uuid: newDoc.rows[0].device_uuid }] }
      : await db.query(
        `SELECT device_uuid FROM monitored_devices
         WHERE assigned_user_id=$1 AND device_uuid IS NOT NULL`,
        [newDoc.rows[0].employee_id]
      );
    for (const device of assignedDevices.rows) {
      await regenerateEffectiveEndpointPolicy(device.device_uuid, actor);
    }

    return res.json({
      success: true,
      new_consent: newDoc.rows[0],
      message: `Consent updated to version ${newVersion}.`,
    });
  } catch (err) {
    console.error("[consent:approve-change]", err.message);
    return res.status(500).json({ success: false, message: "Failed to approve consent change." });
  }
});

// GET /consent/:id/audit — audit trail for a consent (admin/HR)
router.get("/:id/audit", requireAdminOrHR, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT cal.*, u.full_name actor_name
       FROM consent_audit_logs cal
       LEFT JOIN users u ON u.user_id=cal.actor_id
       WHERE cal.consent_id=$1
       ORDER BY cal.created_at ASC`,
      [req.params.id]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("[consent:audit]", err.message);
    return res.status(500).json({ success: false, message: "Failed to load audit trail." });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MONITORING POLICY — used by laptop agent / endpoint monitoring
// ═══════════════════════════════════════════════════════════════════════════════

// GET /consent/policy/:userId — return active consent policy for a user
router.get("/policy/:userId", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT consent_id, status, monitoring_preferences, signed_at, approved_at, consent_version
       FROM consent_documents
       WHERE employee_id=$1
       ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'signed' THEN 1 ELSE 2 END, approved_at DESC NULLS LAST, signed_at DESC NULLS LAST
       LIMIT 1`,
      [req.params.userId]
    );
    const doc = result.rows[0];
    // Log policy sync (non-blocking)
    audit(doc?.consent_id || null, Number(req.params.userId) || null, null, "agent",
      "policy_synced", `Agent fetched policy for user ${req.params.userId}.`).catch(() => {});

    if (!doc || !["approved", "signed"].includes(doc.status)) {
      return res.json({
        success: true,
        policy: {
          optional_monitoring_enabled: false,
          reason: "Consent not approved.",
          preferences: [],
          // Policy plumbing: feature flags for agent implementation
          screenshot_allowed: false,
          usb_monitoring_allowed: false,
          website_monitoring_allowed: false,
        },
      });
    }
    const prefs = doc.monitoring_preferences || [];
    return res.json({
      success: true,
      policy: {
        optional_monitoring_enabled: true,
        preferences: prefs,
        signed_at: doc.signed_at,
        consent_version: doc.consent_version,
        consent_id: doc.consent_id,
        // Convenience feature flags for agent consumption
        screenshot_allowed: Array.isArray(prefs) && prefs.includes("screenshot"),
        usb_monitoring_allowed: Array.isArray(prefs) && prefs.includes("usb_monitoring"),
        website_monitoring_allowed: Array.isArray(prefs) && prefs.includes("website_monitoring"),
      },
    });
  } catch (err) {
    console.error("[consent:policy]", err.message);
    return res.status(500).json({ success: false, message: "Failed to load consent policy." });
  }
});

module.exports = router;
