const db = require("../../config/db");

function registerEndpointScreenshotControlRoutes(router, {
  requireSuperAdmin,
  generateEffectivePolicy,
  logPolicyAudit,
}) {
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
}

module.exports = { registerEndpointScreenshotControlRoutes };
