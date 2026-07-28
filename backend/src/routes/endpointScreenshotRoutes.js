const crypto = require("crypto");
const db = require("../../config/db");
const { getPrivateObject } = require("../services/r2StorageService");
const { decryptScreenshot } = require("../services/screenshotCryptoService");

function registerEndpointScreenshotRoutes(router, { requireAdmin }) {
  router.get("/screenshots", requireAdmin, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(48, Math.max(1, parseInt(req.query.limit) || 12));
      const offset = (page - 1) * limit;
      const employeeId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;

      const [result, countResult] = await Promise.all([
        db.query(
          `SELECT s.id, s.device_id, s.captured_at, s.reason, s.file_size_bytes, s.expires_at,
                  d.hostname, d.device_name, d.device_uuid,
                  u.full_name AS assigned_user, b.branch_name, s.department
           FROM laptop_screenshots s
           JOIN monitored_devices d ON s.device_id=d.device_id
           LEFT JOIN users u ON s.assigned_user_id=u.user_id
           LEFT JOIN branches b ON s.branch_id=b.branch_id
           WHERE ($1::int IS NULL OR d.branch_id=$1)
             AND ($4::int IS NULL OR d.assigned_user_id=$4)
           ORDER BY s.captured_at DESC
           LIMIT $2 OFFSET $3`,
          [req.monitoringBranchId, limit, offset, employeeId]
        ),
        db.query(
          `SELECT COUNT(*)::int AS total
           FROM laptop_screenshots s
           JOIN monitored_devices d ON s.device_id=d.device_id
           WHERE ($1::int IS NULL OR d.branch_id=$1)
             AND ($2::int IS NULL OR d.assigned_user_id=$2)`,
          [req.monitoringBranchId, employeeId]
        ),
      ]);

      const items = result.rows.map((row) => ({
        ...row,
        content_url: `${req.baseUrl}/screenshots/${row.id}/content`,
      }));
      const total = countResult.rows[0]?.total || 0;

      return res.json({
        success: true,
        data: items,
        pagination: {
          page,
          limit,
          total,
          total_pages: Math.max(1, Math.ceil(total / limit)),
        },
      });
    } catch (error) {
      console.error("[laptop-monitoring:screenshots]", error.message);
      return res.status(500).json({ success: false, message: "Failed to load screenshots." });
    }
  });

  router.get("/screenshots/stats", requireAdmin, async (req, res) => {
    try {
      const employeeId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;
      const scope = [req.monitoringBranchId, employeeId];
      const [today, devices, last, storage] = await Promise.all([
        db.query(
          `SELECT COUNT(*)::int AS count
           FROM laptop_screenshots s
           JOIN monitored_devices d ON s.device_id=d.device_id
           WHERE ($1::int IS NULL OR d.branch_id=$1)
             AND ($2::int IS NULL OR d.assigned_user_id=$2)
             AND s.captured_at >= CURRENT_DATE`,
          scope
        ),
        db.query(
          `SELECT COUNT(DISTINCT s.device_id)::int AS count
           FROM laptop_screenshots s
           JOIN monitored_devices d ON s.device_id=d.device_id
           WHERE ($1::int IS NULL OR d.branch_id=$1)
             AND ($2::int IS NULL OR d.assigned_user_id=$2)
             AND s.captured_at >= CURRENT_DATE`,
          scope
        ),
        db.query(
          `SELECT captured_at
           FROM laptop_screenshots s
           JOIN monitored_devices d ON s.device_id=d.device_id
           WHERE ($1::int IS NULL OR d.branch_id=$1)
             AND ($2::int IS NULL OR d.assigned_user_id=$2)
           ORDER BY captured_at DESC
           LIMIT 1`,
          scope
        ),
        db.query(
          `SELECT COALESCE(SUM(s.file_size_bytes),0)::bigint AS bytes
           FROM laptop_screenshots s
           JOIN monitored_devices d ON s.device_id=d.device_id
           WHERE ($1::int IS NULL OR d.branch_id=$1)
             AND ($2::int IS NULL OR d.assigned_user_id=$2)`,
          scope
        ),
      ]);

      return res.json({
        success: true,
        data: {
          todays_screenshots: today.rows[0].count,
          devices_reporting: devices.rows[0].count,
          last_screenshot: last.rows[0]?.captured_at || null,
          storage_used_mb: (Number(storage.rows[0].bytes || 0) / (1024 * 1024)).toFixed(1),
        },
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
      if (!result.rows.length) {
        return res.status(404).json({ success: false, message: "Screenshot not found." });
      }

      const screenshot = result.rows[0];
      if (!screenshot.object_key || screenshot.encryption_algorithm !== "AES-256-GCM") {
        return res.status(410).json({
          success: false,
          message: "This legacy screenshot has no secure private image object.",
        });
      }
      if (screenshot.expires_at && new Date(screenshot.expires_at) <= new Date()) {
        return res.status(410).json({ success: false, message: "Screenshot retention period has expired." });
      }

      const stored = await getPrivateObject(screenshot.object_key);
      const plaintext = decryptScreenshot(
        stored.body,
        screenshot.encryption_iv,
        screenshot.encryption_auth_tag
      );
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

  const registerAuditRoute = (path, actionName, detail) => {
    router.post(path, requireAdmin, async (req, res) => {
      try {
        const employeeId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;
        const screenshot = await db.query(
          `SELECT s.device_id
           FROM laptop_screenshots s
           JOIN monitored_devices d ON d.device_id=s.device_id
           WHERE s.id=$1
             AND ($2::int IS NULL OR d.branch_id=$2)
             AND ($3::int IS NULL OR d.assigned_user_id=$3)`,
          [req.params.id, req.monitoringBranchId, employeeId]
        );
        if (!screenshot.rows.length) {
          return res.status(404).json({ success: false, message: "Screenshot not found." });
        }

        await db.query(
          `INSERT INTO laptop_activity_logs (device_id, event_type, app_name, window_title)
           VALUES ($1, 'system_audit', $2, $3)`,
          [screenshot.rows[0].device_id, actionName, detail]
        );
        return res.json({ success: true });
      } catch (error) {
        console.error(`[laptop-monitoring:${actionName.toLowerCase().replaceAll(" ", "-")}]`, error.message);
        return res.status(500).json({ success: false });
      }
    });
  };

  registerAuditRoute(
    "/screenshots/:id/audit-view",
    "Screenshot viewed",
    "Admin viewed full-resolution screenshot."
  );
  registerAuditRoute(
    "/screenshots/:id/audit-download",
    "Screenshot downloaded",
    "Admin downloaded a decrypted screenshot copy."
  );
}

module.exports = { registerEndpointScreenshotRoutes };
