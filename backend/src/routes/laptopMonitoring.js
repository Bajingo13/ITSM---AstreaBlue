const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const db = require("../../config/db");

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
        agent_version VARCHAR(50), last_seen_at TIMESTAMPTZ,
        status VARCHAR(20) NOT NULL DEFAULT 'Offline', consent_status VARCHAR(30) NOT NULL DEFAULT 'Pending',
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
        file_url TEXT, file_path TEXT, captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reason VARCHAR(255), created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS laptop_alerts (
        id BIGSERIAL PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        severity VARCHAR(20) NOT NULL DEFAULT 'Medium', alert_type VARCHAR(100) NOT NULL, message TEXT NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'Open', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
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
  const expected = process.env.MONITORING_AGENT_TOKEN;
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
    if (!["superadmin", "admin"].includes(role)) return res.status(403).json({ success: false, message: "Monitoring administrator access required." });
    req.monitoringUser = user;
    req.monitoringIsSuperAdmin = role === "superadmin";
    req.monitoringBranchId = role === "admin" ? user.branchId : null;
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
      `INSERT INTO laptop_activity_logs (device_id,event_type,app_name,window_title,idle_seconds,url_domain,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz,CURRENT_TIMESTAMP)) RETURNING *`,
      [device.device_id, String(req.body?.event_type || "activity").slice(0, 50), appName, windowTitle, idleSeconds, urlDomain, req.body?.occurred_at || null]
    );
    const alerts = [];
    if (idleSeconds >= excessiveIdleSeconds) alerts.push(["Low", "Excessive Idle Time", `Device idle for ${idleSeconds} seconds.`]);
    if (appName && prohibitedApps.some((item) => appName.toLowerCase().includes(item))) alerts.push(["High", "Prohibited Application", `Configured prohibited application detected: ${appName}.`]);
    if (urlDomain && prohibitedDomains.some((item) => urlDomain === item || urlDomain.endsWith(`.${item}`))) alerts.push(["High", "Prohibited Domain", `Configured prohibited domain detected: ${urlDomain}.`]);
    for (const [severity, type, message] of alerts) {
      await db.query(`INSERT INTO laptop_alerts (device_id,severity,alert_type,message) VALUES ($1,$2,$3,$4)`, [device.device_id, severity, type, message]);
    }
    return res.status(201).json({ success: true, message: "Activity recorded.", data: activity.rows[0], alerts_created: alerts.length });
  } catch (error) {
    console.error("[laptop-monitoring:activity]", error.message);
    return res.status(500).json({ success: false, message: "Failed to record activity." });
  }
});

router.get("/screenshot-permission", requireAgent, async (req, res) => {
  try {
    const device = await findDevice(req.query || {});
    if (!device) return res.status(404).json({ success: false, message: "Device is not registered. Send a heartbeat first." });
    const consent = await db.query(
      `SELECT id FROM monitoring_consents WHERE device_id=$1 AND LOWER(consent_type)='screenshot'
       AND LOWER(consent_status) IN ('granted','approved','consented') ORDER BY consented_at DESC NULLS LAST LIMIT 1`,
      [device.device_id]
    );
    return res.json({ success: true, data: { allowed: consent.rows.length > 0 } });
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
      const consent = await db.query(
        `SELECT id FROM monitoring_consents WHERE device_id=$1 AND LOWER(consent_type)='screenshot'
         AND LOWER(consent_status) IN ('granted','approved','consented') ORDER BY consented_at DESC NULLS LAST LIMIT 1`,
        [device.device_id]
      );
      if (!consent.rows.length) {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
        return res.status(403).json({ success: false, message: "Explicit screenshot consent is required." });
      }
      const filePath = req.file?.path || null;
      const requestedUrl = String(req.body?.file_url || "").trim();
      const fileUrl = /^https?:\/\//i.test(requestedUrl) ? requestedUrl : null;
      const result = await db.query(
        `INSERT INTO laptop_screenshots (device_id,file_url,file_path,captured_at,reason)
         VALUES ($1,$2,$3,COALESCE($4::timestamptz,CURRENT_TIMESTAMP),$5) RETURNING *`,
        [device.device_id, fileUrl, filePath, req.body?.captured_at || null, String(req.body?.reason || "Consent-enabled agent capture").slice(0, 255)]
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
      `SELECT d.*,u.full_name assigned_user,b.branch_name,
       COALESCE((SELECT mc.consent_status FROM monitoring_consents mc WHERE mc.device_id=d.device_id ORDER BY mc.consented_at DESC NULLS LAST,mc.created_at DESC LIMIT 1),d.consent_status) consent_status
       FROM monitored_devices d LEFT JOIN users u ON u.user_id=d.assigned_user_id LEFT JOIN branches b ON b.branch_id=d.branch_id
       WHERE ($1::int IS NULL OR d.branch_id=$1) ORDER BY d.last_seen_at DESC NULLS LAST`, [req.monitoringBranchId]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("[laptop-monitoring:devices]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load monitored devices." });
  }
});

router.get("/debug", requireAdmin, async (req, res) => {
  if (!req.monitoringIsSuperAdmin) return res.status(403).json({ success: false, message: "SuperAdmin access required." });
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
    const allowed = await db.query(`SELECT device_id FROM monitored_devices WHERE device_id=$1 AND ($2::int IS NULL OR branch_id=$2)`, [req.params.id, req.monitoringBranchId]);
    if (!allowed.rows.length) return res.status(404).json({ success: false, message: "Device not found." });
    const [activity, screenshots, alerts, consents] = await Promise.all([
      db.query(`SELECT * FROM laptop_activity_logs WHERE device_id=$1 ORDER BY occurred_at DESC LIMIT 200`, [req.params.id]),
      db.query(`SELECT * FROM laptop_screenshots WHERE device_id=$1 ORDER BY captured_at DESC LIMIT 50`, [req.params.id]),
      db.query(`SELECT * FROM laptop_alerts WHERE device_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.params.id]),
      db.query(`SELECT id,device_id,user_id,consent_type,consent_status,consented_at,created_at FROM monitoring_consents WHERE device_id=$1 ORDER BY created_at DESC`, [req.params.id]),
    ]);
    return res.json({ success: true, data: { activity: activity.rows, screenshots: screenshots.rows, alerts: alerts.rows, consents: consents.rows } });
  } catch (error) {
    console.error("[laptop-monitoring:device-activity]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load device activity." });
  }
});

router.get("/summary", requireAdmin, async (req, res) => {
  try {
    await refreshDeviceStatuses();
    const result = await db.query(
      `SELECT COUNT(*)::int total_monitored_devices,
       COUNT(*) FILTER (WHERE status='Online')::int online_devices,
       COUNT(*) FILTER (WHERE status='Offline')::int offline_devices,
       COUNT(DISTINCT assigned_user_id) FILTER (WHERE last_seen_at::date=CURRENT_DATE)::int active_users_today
       FROM monitored_devices WHERE ($1::int IS NULL OR branch_id=$1)`, [req.monitoringBranchId]
    );
    const idle = await db.query(
      `SELECT COALESCE(AVG(l.idle_seconds),0)::numeric(12,2) average_idle_seconds,COALESCE(SUM(l.idle_seconds),0)::bigint total_idle_seconds
       FROM laptop_activity_logs l JOIN monitored_devices d ON d.device_id=l.device_id
       WHERE l.occurred_at::date=CURRENT_DATE AND ($1::int IS NULL OR d.branch_id=$1)`, [req.monitoringBranchId]
    );
    const alerts = await db.query(
      `SELECT a.*,d.hostname FROM laptop_alerts a JOIN monitored_devices d ON d.device_id=a.device_id
       WHERE ($1::int IS NULL OR d.branch_id=$1) ORDER BY a.created_at DESC LIMIT 20`, [req.monitoringBranchId]
    );
    return res.json({ success: true, data: { ...result.rows[0], ...idle.rows[0], recent_alerts: alerts.rows } });
  } catch (error) {
    console.error("[laptop-monitoring:summary]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load monitoring summary." });
  }
});

module.exports = router;
