const crypto = require("crypto");
const multer = require("multer");
const db = require("../../config/db");
const { createNotification } = require("../services/notificationService");
const { deletePrivateObject, putPrivateObject } = require("../services/r2StorageService");
const { emitEndpointStatusChanged } = require("../services/socketService");
const { encryptScreenshot } = require("../services/screenshotCryptoService");

const ONLINE_THRESHOLD_SECONDS = 120;
const excessiveIdleSeconds = Math.max(60, Number(process.env.MONITORING_IDLE_ALERT_SECONDS) || 3600);
const normalizeList = (value) => String(value || "")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const prohibitedApps = normalizeList(process.env.MONITORING_PROHIBITED_APPS);
const prohibitedDomains = normalizeList(process.env.MONITORING_PROHIBITED_DOMAINS);

const uploadScreenshot = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(
    null,
    ["image/png", "image/jpeg"].includes(file.mimetype)
  ),
}).single("screenshot");

function registerEndpointTelemetryRoutes(router, {
  requireAgent,
  findDevice,
  getApprovedConsentPreferences,
  hasPreference,
  generateEffectivePolicy,
  logPolicyAudit,
  resolveConsentGatedFeature,
}) {
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
      const previousLastSeenAt = req.agentDevice?.last_seen_at
        ? new Date(req.agentDevice.last_seen_at).getTime()
        : null;
      const wasOffline = Boolean(req.agentDevice) && (
        String(req.agentDevice.status || "").toLowerCase() !== "online"
        || !Number.isFinite(previousLastSeenAt)
        || Date.now() - previousLastSeenAt > ONLINE_THRESHOLD_SECONDS * 1000
      );

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
        [
          deviceUuid,
          hostname,
          deviceName,
          loggedInUser,
          req.body?.assigned_user_id || null,
          req.body?.branch_id || null,
          String(req.body?.agent_version || "MVP-1.0").slice(0, 50),
        ]
      );
      const device = result.rows[0];
      console.info("[laptop-monitoring:heartbeat]", {
        hostname: device.hostname,
        device_id: device.device_id,
        last_seen_at: device.last_seen_at instanceof Date
          ? device.last_seen_at.toISOString()
          : device.last_seen_at,
        status: device.status,
      });
      if (wasOffline) emitEndpointStatusChanged({ action: "online" });
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
      const activityAllowed = hasPreference(
        prefs,
        "application_monitoring",
        "applications",
        "activity_monitoring",
        "app_usage",
        "window_title",
        "idle_time"
      );
      if (!activityAllowed) {
        return res.status(403).json({
          success: false,
          message: "Application and window activity consent is not approved.",
        });
      }
      if (urlDomain) {
        const webAllowed = hasPreference(
          prefs,
          "web_monitoring",
          "website_monitoring",
          "network_domains",
          "browser"
        );
        if (!webAllowed) return res.status(403).json({ success: false, message: "Consent not approved." });
      }

      const activity = await db.query(
        `INSERT INTO laptop_activity_logs (device_id,device_uuid,asset_id,assigned_user_id,current_logged_in_user,branch_id,department,event_type,app_name,window_title,idle_seconds,url_domain,occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13::timestamptz,CURRENT_TIMESTAMP)) RETURNING *`,
        [
          device.device_id, device.device_uuid, device.asset_id, device.assigned_user_id,
          device.logged_in_user, device.branch_id, device.department,
          String(req.body?.event_type || "activity").slice(0, 50), appName, windowTitle,
          idleSeconds, urlDomain, req.body?.occurred_at || null,
        ]
      );

      const alerts = [];
      if (idleSeconds >= excessiveIdleSeconds) {
        alerts.push(["Low", "Excessive Idle Time", `Device idle for ${idleSeconds} seconds.`]);
      }
      if (appName && prohibitedApps.some((item) => appName.toLowerCase().includes(item))) {
        alerts.push(["High", "Prohibited Application", `Configured prohibited application detected: ${appName}.`]);
      }
      if (urlDomain && prohibitedDomains.some((item) => urlDomain === item || urlDomain.endsWith(`.${item}`))) {
        alerts.push(["High", "Prohibited Domain", `Configured prohibited domain detected: ${urlDomain}.`]);
      }

      for (const [severity, type, message] of alerts) {
        const alertRes = await db.query(
          `INSERT INTO laptop_alerts (device_id,severity,alert_type,message) VALUES ($1,$2,$3,$4) RETURNING id`,
          [device.device_id, severity, type, message]
        );
        const alertId = alertRes.rows[0].id;

        if (severity === "High" && device.assigned_user_id) {
          const ticketRes = await db.query(
            `INSERT INTO tickets (ticket_number, requester_id, branch_id, title, description, category, priority, status, related_device_uuid, related_asset_id, alert_id)
             VALUES (
               'INC-' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYYMMDDHH24MISS') || '-' || LPAD((FLOOR(RANDOM() * 9999) + 1)::TEXT, 4, '0'),
               $1, $2, $3, $4, 'Security', 'High', 'Open', $5, $6, $7
             ) RETURNING id`,
            [
              device.assigned_user_id,
              device.branch_id,
              `Security Alert: ${type} on ${device.hostname}`,
              `Automated endpoint monitoring alert triggered.\n\nType: ${type}\nMessage: ${message}\nDevice: ${device.hostname}\nLogged in user: ${device.logged_in_user}`,
              device.device_uuid,
              device.asset_id,
              alertId,
            ]
          );

          const admins = await db.query(
            `SELECT user_id FROM users WHERE role='SuperAdmin' OR (role='Admin' AND branch_id=$1)`,
            [device.branch_id]
          );
          for (const admin of admins.rows) {
            if (typeof createNotification === "function") {
              await createNotification({
                user_id: admin.user_id,
                title: "Endpoint Security Alert",
                message: `High severity alert on ${device.hostname}: ${type}`,
                type: "security_alert",
                related_id: ticketRes.rows[0].id,
              }).catch((notificationError) => {
                console.error("Notification failed", notificationError);
              });
            }
          }
        }
      }
      return res.status(201).json({
        success: true,
        message: "Activity recorded.",
        data: activity.rows[0],
        alerts_created: alerts.length,
      });
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
      if (uploadError) {
        return res.status(400).json({
          success: false,
          message: uploadError.message || "Invalid screenshot upload.",
        });
      }
      let uploadedObjectKey = null;
      try {
        if (!req.file?.buffer?.length) {
          return res.status(400).json({
            success: false,
            message: "A PNG or JPEG screenshot file is required.",
          });
        }
        const device = await findDevice(req.body || {});
        if (!device) return res.status(404).json({ success: false, message: "Device is not registered. Send a heartbeat first." });
        if (req.agentDevice && String(req.agentDevice.device_id) !== String(device.device_id)) {
          return res.status(403).json({ success: false, message: "Device credential does not match the screenshot device." });
        }
        if (!device.assigned_user_id) {
          return res.status(403).json({
            success: false,
            message: "Device must be assigned to an employee before monitoring.",
          });
        }

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

        const retentionDays = Math.min(
          365,
          Math.max(1, Number(permission.policy?.screenshot_retention_days) || 30)
        );
        const result = await db.query(
          `INSERT INTO laptop_screenshots (
             device_id,file_url,file_path,thumbnail_path,assigned_user_id,branch_id,department,captured_at,reason,
             object_key,encryption_algorithm,encryption_iv,encryption_auth_tag,plaintext_sha256,content_type,file_size_bytes,expires_at
           )
           VALUES ($1,NULL,NULL,NULL,$2,$3,$4,COALESCE($5::timestamptz,CURRENT_TIMESTAMP),$6,
                   $7,'AES-256-GCM',$8,$9,$10,$11,$12,CURRENT_TIMESTAMP + ($13 * INTERVAL '1 day')) RETURNING *`,
          [
            device.device_id,
            device.assigned_user_id,
            device.branch_id,
            department,
            req.body?.captured_at || null,
            String(req.body?.reason || "Consent-enabled agent capture").slice(0, 255),
            uploadedObjectKey,
            encrypted.iv,
            encrypted.authTag,
            encrypted.sha256,
            req.file.mimetype,
            req.file.size,
            retentionDays,
          ]
        );
        return res.status(201).json({
          success: true,
          message: "Screenshot encrypted and stored privately.",
          data: result.rows[0],
        });
      } catch (error) {
        if (uploadedObjectKey) deletePrivateObject(uploadedObjectKey).catch(() => {});
        console.error("[laptop-monitoring:screenshot]", error.message);
        const configurationError = [
          "R2_NOT_CONFIGURED",
          "SCREENSHOT_ENCRYPTION_NOT_CONFIGURED",
        ].includes(error.code);
        return res.status(configurationError ? 503 : 500).json({
          success: false,
          message: configurationError
            ? "Secure screenshot storage is not configured."
            : "Failed to record screenshot.",
        });
      }
    });
  });
}

module.exports = {
  registerEndpointTelemetryRoutes,
};
