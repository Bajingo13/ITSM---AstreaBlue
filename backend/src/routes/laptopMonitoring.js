const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const sharp = require("sharp");
const db = require("../../config/db");
const { createNotification } = require("../services/notificationService");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
const screenshotDirectory = String(process.env.MONITORING_SCREENSHOT_DIR || "").trim();
const ONLINE_THRESHOLD_SECONDS = 120;
const excessiveIdleSeconds = Math.max(60, Number(process.env.MONITORING_IDLE_ALERT_SECONDS) || 3600);

const normalizeList = (value) => String(value || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
const prohibitedApps = normalizeList(process.env.MONITORING_PROHIBITED_APPS);
const prohibitedDomains = normalizeList(process.env.MONITORING_PROHIBITED_DOMAINS);

if (screenshotDirectory) fs.mkdirSync(screenshotDirectory, { recursive: true });
const screenshotStorage = screenshotDirectory
  ? multer.diskStorage({
      destination: (_req, _file, callback) => callback(null, screenshotDirectory),
      filename: (_req, file, callback) => {
        const extension = file.mimetype === "image/png" ? ".png" : ".jpg";
        callback(null, `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${extension}`);
      },
    })
  : multer.memoryStorage();
const uploadScreenshot = multer({
  storage: screenshotStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, ["image/png", "image/jpeg"].includes(file.mimetype)),
}).single("screenshot");

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
      CREATE TABLE IF NOT EXISTS laptop_alerts (
        id BIGSERIAL PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        severity VARCHAR(20) NOT NULL, alert_type VARCHAR(100) NOT NULL, message TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'Open', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
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
      
      ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS asset_id INTEGER;
      ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS department VARCHAR(255);
      ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS last_policy_sync_at TIMESTAMPTZ;
      
      CREATE TABLE IF NOT EXISTS monitoring_consents (
        id BIGSERIAL PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, consent_type VARCHAR(50) NOT NULL,
        consent_status VARCHAR(30) NOT NULL DEFAULT 'Pending', consented_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(device_id,user_id,consent_type)
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

function requireAgent(req, res, next) {
  const expected = process.env.MONITORING_AGENT_TOKEN || "dev-monitoring-token";
  const supplied = req.headers["x-agent-token"] || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expected) return res.status(503).json({ success: false, message: "Monitoring agent authentication is not configured." });
  if (!safeEqual(supplied, expected)) return res.status(401).json({ success: false, message: "Invalid monitoring agent token." });
  return next();
}

function requireAdmin(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";
    if (!authorization.startsWith("Bearer ")) throw new Error("Authentication required.");
    const user = jwt.verify(authorization.slice(7), JWT_SECRET);
    const role = String(user.role || "").toLowerCase().replace(/[\s_-]/g, "");
    if (!["superadmin", "admin", "technician", "employee"].includes(role)) return res.status(403).json({ success: false, message: "Monitoring access required." });
    req.monitoringUser = user;
    req.monitoringIsSuperAdmin = role === "superadmin";
    req.monitoringIsEmployee = role === "employee";
    req.monitoringBranchId = (role === "admin" || role === "technician") ? user.branchId : null;
    return next();
  } catch (_error) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
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

router.post("/heartbeat", requireAgent, async (req, res) => {
  const deviceUuid = String(req.body?.device_uuid || "").trim().toLowerCase();
  const hostname = String(req.body?.hostname || req.body?.device_name || "").trim();
  const deviceName = String(req.body?.device_name || hostname).trim().slice(0, 255);
  const loggedInUser = String(req.body?.logged_in_user || "").trim().slice(0, 255) || null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceUuid)) {
    return res.status(400).json({ success: false, message: "A valid device_uuid is required." });
  }
  if (!hostname) return res.status(400).json({ success: false, message: "Hostname is required." });
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

    const deviceResult = await db.query(
      `SELECT d.*, u.full_name as assigned_employee_name 
       FROM monitored_devices d
       LEFT JOIN users u ON u.user_id = d.assigned_user_id
       WHERE d.device_uuid=$1::uuid LIMIT 1`,
      [deviceUuid]
    );

    if (!deviceResult.rows.length) {
      return res.status(404).json({ success: false, message: "Device not found." });
    }
    const device = deviceResult.rows[0];

    const policy = {
      device_uuid: device.device_uuid,
      assigned_user_id: device.assigned_user_id,
      assigned_employee_name: device.assigned_employee_name,
      branch_id: device.branch_id,
      department_id: device.department,
      asset_id: device.asset_id,
      consent_status: "Missing",
      consent_version: null,
      applicationMonitoring: false,
      screenshotMonitoring: false,
      usbMonitoring: false,
      browserMonitoring: false,
      deviceTelemetry: true,
      emailHeaderMonitoring: false,
      policy_reason: "Device is not linked to a hardware asset.",
      last_policy_sync_at: new Date()
    };

    if (device.asset_id) {
      if (!device.assigned_user_id) {
        policy.policy_reason = "Device is not assigned to an employee.";
      } else {
        policy.policy_reason = "Employee consent is pending.";
        const formalConsent = await db.query(
          `SELECT status, monitoring_preferences, consent_version, signed_at
           FROM consent_documents
           WHERE employee_id=$1 AND status='signed'
           ORDER BY signed_at DESC NULLS LAST LIMIT 1`,
          [device.assigned_user_id]
        );

        if (formalConsent.rows.length) {
          const consent = formalConsent.rows[0];
          const prefs = consent.monitoring_preferences || [];
          
          policy.consent_status = consent.status;
          policy.consent_version = consent.consent_version;
          
          policy.policy_reason = "Active consent applied.";
          policy.applicationMonitoring = true;
          policy.screenshotMonitoring = Array.isArray(prefs) && prefs.includes("screenshot");
          policy.usbMonitoring = Array.isArray(prefs) && prefs.includes("usb");
          policy.browserMonitoring = Array.isArray(prefs) && prefs.includes("browser");
          policy.emailHeaderMonitoring = Array.isArray(prefs) && prefs.includes("email");
        }
      }
    }

    await db.query(`UPDATE monitored_devices SET last_policy_sync_at=CURRENT_TIMESTAMP WHERE device_id=$1`, [device.device_id]);
    
    // Log policy sync audit
    await db.query(`
      INSERT INTO consent_audit_logs (employee_id, action_by, event_type, old_status, new_status, metadata)
      VALUES ($1, $1, 'policy_synced', null, $2, $3)
    `, [device.assigned_user_id, policy.consent_status, JSON.stringify({ device_uuid: policy.device_uuid, policy_reason: policy.policy_reason })]);

    return res.json({ success: true, data: policy });
  } catch (error) {
    console.error("[laptop-monitoring:policy]", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch policy." });
  }
});

router.get("/screenshot-permission", requireAgent, async (req, res) => {
  try {
    const device = await findDevice(req.query || {});
    if (!device) return res.status(404).json({ success: false, message: "Device is not registered. Send a heartbeat first." });

    // Check formal RA 10173 consent document first (authoritative source)
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
        allowed = Array.isArray(prefs) && prefs.includes("screenshot");
      }
    }

    // Fall back to legacy monitoring_consents for devices not yet migrated
    if (!allowed) {
      const legacyConsent = await db.query(
        `SELECT id FROM monitoring_consents WHERE device_id=$1 AND LOWER(consent_type)='screenshot'
         AND LOWER(consent_status) IN ('granted','approved','consented') ORDER BY consented_at DESC NULLS LAST LIMIT 1`,
        [device.device_id]
      );
      allowed = legacyConsent.rows.length > 0;
    }

    return res.json({ success: true, data: { allowed } });
  } catch (error) {
    console.error("[laptop-monitoring:screenshot-permission]", error.message);
    return res.status(500).json({ success: false, message: "Failed to verify screenshot consent." });
  }
});

router.post("/screenshot", requireAgent, (req, res) => {
  uploadScreenshot(req, res, async (uploadError) => {
    if (uploadError) return res.status(400).json({ success: false, message: uploadError.message || "Invalid screenshot upload." });
    try {
      const device = await findDevice(req.body || {});
      if (!device) return res.status(404).json({ success: false, message: "Device is not registered. Send a heartbeat first." });
      
      // Enforce Assignment
      if (!device.assigned_user_id) {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
        return res.status(403).json({ success: false, message: "Device must be assigned to an employee before monitoring." });
      }

      // Enforce formal Consent
      const formalConsent = await db.query(
        `SELECT monitoring_preferences, department FROM consent_documents
         WHERE employee_id=$1 AND status='signed'
         ORDER BY signed_at DESC NULLS LAST LIMIT 1`,
        [device.assigned_user_id]
      );

      let allowed = false;
      let department = null;
      if (formalConsent.rows.length) {
        const prefs = formalConsent.rows[0].monitoring_preferences || [];
        allowed = Array.isArray(prefs) && prefs.includes("screenshot");
        department = formalConsent.rows[0].department;
      } else {
        // Fallback to legacy
        const legacy = await db.query(
          `SELECT id FROM monitoring_consents WHERE device_id=$1 AND LOWER(consent_type)='screenshot'
           AND LOWER(consent_status) IN ('granted','approved','consented') ORDER BY consented_at DESC NULLS LAST LIMIT 1`,
          [device.device_id]
        );
        allowed = legacy.rows.length > 0;
      }

      if (!allowed) {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
        return res.status(403).json({ success: false, message: "Explicit screenshot consent is required." });
      }

      let filePath = req.file?.path || null;
      let thumbnailPath = null;
      const requestedUrl = String(req.body?.file_url || "").trim();
      const fileUrl = /^https?:\/\//i.test(requestedUrl) ? requestedUrl : null;
      
      // Generate thumbnail
      if (filePath && screenshotDirectory) {
        try {
          const thumbName = path.basename(filePath, path.extname(filePath)) + "-thumb.jpg";
          thumbnailPath = path.join(screenshotDirectory, thumbName);
          await sharp(filePath)
            .resize(320, 180, { fit: 'cover' })
            .jpeg({ quality: 80 })
            .toFile(thumbnailPath);
        } catch (thumbErr) {
          console.error("Thumbnail generation failed:", thumbErr.message);
          thumbnailPath = null;
        }
      }

      const result = await db.query(
        `INSERT INTO laptop_screenshots (device_id,file_url,file_path,thumbnail_path,assigned_user_id,branch_id,department,captured_at,reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz,CURRENT_TIMESTAMP),$9) RETURNING *`,
        [
          device.device_id, fileUrl, filePath, thumbnailPath,
          device.assigned_user_id, device.branch_id, department,
          req.body?.captured_at || null, String(req.body?.reason || "Consent-enabled agent capture").slice(0, 255)
        ]
      );
      
      const warning = !screenshotDirectory ? "File storage is not configured; screenshot bytes were not retained. Metadata was saved." : null;
      return res.status(201).json({ success: true, message: warning || "Screenshot metadata recorded.", warning, data: result.rows[0] });
    } catch (error) {
      console.error("[laptop-monitoring:screenshot]", error.message);
      return res.status(500).json({ success: false, message: "Failed to record screenshot." });
    }
  });
});

async function refreshDeviceStatuses() {
  await db.query(
    `UPDATE monitored_devices
     SET status=CASE WHEN last_seen_at IS NOT NULL AND last_seen_at >= CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 second') THEN 'Online' ELSE 'Offline' END,
     updated_at=CURRENT_TIMESTAMP
     WHERE status IS DISTINCT FROM CASE WHEN last_seen_at IS NOT NULL AND last_seen_at >= CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 second') THEN 'Online' ELSE 'Offline' END`,
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
       (SELECT created_at FROM consent_audit_logs cal WHERE cal.employee_id = d.assigned_user_id AND event_type='policy_synced' ORDER BY created_at DESC LIMIT 1) as policy_synced_at,
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

router.get("/devices/:id/activity", requireAdmin, async (req, res) => {
  try {
    const empId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;
    const allowed = await db.query(`SELECT device_id FROM monitored_devices WHERE device_id=$1 AND ($2::int IS NULL OR branch_id=$2) AND ($3::int IS NULL OR assigned_user_id=$3)`, [req.params.id, req.monitoringBranchId, empId]);
    if (!allowed.rows.length) return res.status(404).json({ success: false, message: "Device not found or access denied." });
    const [activity, screenshots, alerts, consents, assignments, hardware] = await Promise.all([
      db.query(`SELECT * FROM laptop_activity_logs WHERE device_id=$1 ORDER BY occurred_at DESC LIMIT 200`, [req.params.id]),
      db.query(`SELECT * FROM laptop_screenshots WHERE device_id=$1 ORDER BY captured_at DESC LIMIT 50`, [req.params.id]),
      db.query(`SELECT * FROM laptop_alerts WHERE device_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.params.id]),
      db.query(`SELECT id,device_id,user_id,consent_type,consent_status,consented_at,created_at FROM monitoring_consents WHERE device_id=$1 ORDER BY created_at DESC`, [req.params.id]),
      db.query(`SELECT a.*, ou.full_name as old_user_name, nu.full_name as new_user_name FROM monitored_device_assignments a LEFT JOIN users ou ON a.old_user_id=ou.user_id LEFT JOIN users nu ON a.new_user_id=nu.user_id WHERE device_id=$1 ORDER BY changed_at DESC`, [req.params.id]),
      db.query(`SELECT * FROM endpoint_hardware_inventory WHERE device_id=$1 ORDER BY scanned_at DESC LIMIT 1`, [req.params.id])
    ]);
    return res.json({ success: true, data: { activity: activity.rows, screenshots: screenshots.rows, alerts: alerts.rows, consents: consents.rows, assignments: assignments.rows, hardware: hardware.rows[0] || null } });
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
      const u = await db.query(`SELECT full_name, department FROM users WHERE user_id=$1`, [assigned_user_id]);
      if (u.rows.length) {
        if (!finalDepartment) finalDepartment = u.rows[0].department || null;
        assignedName = u.rows[0].full_name;
      }
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


// ─── Policy plumbing: USB & Website monitoring (architecture ready, agent implementation pending) ─
// USB monitoring permission — checks consent_documents for usb_monitoring preference
router.get("/usb-monitoring-permission", requireAgent, async (req, res) => {
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
        allowed = Array.isArray(prefs) && prefs.includes("usb_monitoring");
      }
    }
    return res.json({ success: true, data: { allowed, feature: "usb_monitoring" } });
  } catch (error) {
    console.error("[laptop-monitoring:usb-monitoring-permission]", error.message);
    return res.status(500).json({ success: false, message: "Failed to verify USB monitoring consent." });
  }
});

// Website monitoring permission — checks consent_documents for website_monitoring preference
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
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const empId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;
    const result = await db.query(
      `SELECT s.id, s.device_id, s.file_url, s.thumbnail_path, s.captured_at, s.reason,
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
    );
    
    // Add thumbnail URL to response
    const frontendUrl = process.env.API_URL || "";
    const items = result.rows.map(row => ({
      ...row,
      thumbnail_url: row.thumbnail_path ? `${frontendUrl}/uploads/screenshots/${path.basename(row.thumbnail_path)}` : row.file_url
    }));

    return res.json({ success: true, data: items });
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
    const totalCount = await db.query(
      `SELECT COUNT(*)::int as count FROM laptop_screenshots s
       JOIN monitored_devices d ON s.device_id = d.device_id
       WHERE ($1::int IS NULL OR d.branch_id = $1) AND ($2::int IS NULL OR d.assigned_user_id = $2)`,
      [req.monitoringBranchId, empId]
    );
    
    const storageUsedMB = (totalCount.rows[0].count * 320 / 1024).toFixed(1);

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

router.post("/screenshots/:id/audit-view", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const shot = await db.query(`SELECT device_id FROM laptop_screenshots WHERE id=$1`, [id]);
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

router.post("/hardware-inventory", requireAgent, async (req, res) => {
  const deviceUuid = String(req.body?.device_uuid || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceUuid)) {
    return res.status(400).json({ success: false, message: "A valid device_uuid is required." });
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

    return res.json({ success: true, message: "Hardware inventory updated." });
  } catch (error) {
    console.error("Hardware inventory error:", error.message);
    return res.status(500).json({ success: false, error: "Database error." });
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

module.exports = router;
