const db = require("../../config/db");
const { createNotification } = require("../services/notificationService");

function registerEndpointPolicyRoutes(router, {
  requireAdmin,
  requireAgent,
  normalizePolicyConfig,
  policyForClient,
  logPolicyAudit,
  generateEffectivePolicy,
}) {
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

      const where = scope.length ? `WHERE ${scope.join(" AND ")}` : "";
      const result = await db.query(
        `SELECT * FROM endpoint_policies ${where} ORDER BY priority DESC, created_at DESC`,
        params
      );
      return res.json({ success: true, data: result.rows.map(policyForClient) });
    } catch (error) {
      console.error("[laptop-monitoring] fetch policies error:", error.message);
      return res.status(500).json({ success: false, message: "Failed to fetch policies." });
    }
  });

  router.post("/policies", requireAdmin, async (req, res) => {
    try {
      if (req.monitoringIsEmployee) return res.status(403).json({ success: false, message: "Unauthorized." });
      const { description, priority, is_active, branch_id } = req.body;
      const name = String(req.body.name || req.body.policy_name || "").trim();
      if (!name) return res.status(400).json({ success: false, message: "Policy name is required." });
      const configJson = normalizePolicyConfig(req.body);
      const targetBranch = req.monitoringIsSuperAdmin ? (branch_id || null) : req.monitoringBranchId;
      const result = await db.query(
        `INSERT INTO endpoint_policies (name, description, priority, is_active, config_json, created_by, branch_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [name, description, priority || 0, is_active ?? true, JSON.stringify(configJson), req.monitoringUserId, targetBranch]
      );

      const policy = result.rows[0];
      await logPolicyAudit(req.monitoringUserId, "policy_created", policy.id, { policy });
      return res.status(201).json({ success: true, data: policyForClient(policy) });
    } catch (error) {
      console.error("[laptop-monitoring] create policy error:", error.message);
      return res.status(500).json({ success: false, message: "Failed to create policy." });
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
      return res.json({ success: true, data: policy });
    } catch (error) {
      console.error("[laptop-monitoring] fetch policy error:", error.message);
      return res.status(500).json({ success: false, message: "Failed to fetch policy." });
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
      await logPolicyAudit(
        req.monitoringUserId,
        is_active === false && check.rows[0].is_active ? "policy_disabled" : "policy_updated",
        req.params.id,
        { changes: req.body }
      );
      return res.json({ success: true, data: policyForClient(result.rows[0]) });
    } catch (error) {
      console.error("[laptop-monitoring] update policy error:", error.message);
      return res.status(500).json({ success: false, message: "Failed to update policy." });
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
      await logPolicyAudit(req.monitoringUserId, "policy_deleted", req.params.id, { policy: check.rows[0] });
      return res.json({ success: true, message: "Policy deleted." });
    } catch (error) {
      console.error("[laptop-monitoring] delete policy error:", error.message);
      return res.status(500).json({ success: false, message: "Failed to delete policy." });
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
      await logPolicyAudit(req.monitoringUserId, "policy_assigned", req.params.id, { target_type: targetType, target_id: targetId });
      return res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[laptop-monitoring] assign policy error:", error.message);
      return res.status(500).json({ success: false, message: "Failed to assign policy." });
    }
  });

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
      return res.json({ success: true, data: policy });
    } catch (error) {
      console.error("[laptop-monitoring] generate effective policy error:", error.message);
      return res.status(500).json({ success: false, message: "Failed to generate effective policy." });
    }
  });

  router.get("/policy/latest", requireAgent, async (req, res) => {
    try {
      const deviceUuid = String(req.query.device_uuid || "").trim();
      if (!deviceUuid) return res.status(400).json({ success: false, message: "device_uuid required" });
      const policyJson = await generateEffectivePolicy(deviceUuid, null);
      if (!policyJson) return res.status(404).json({ success: false, message: "Device not found." });

      await db.query(`UPDATE monitored_devices SET last_policy_sync_at=CURRENT_TIMESTAMP WHERE device_uuid=$1::uuid`, [deviceUuid]);
      await logPolicyAudit(null, "policy_downloaded", deviceUuid, { agent: true });
      return res.json({ success: true, data: policyJson });
    } catch (error) {
      console.error("[laptop-monitoring] fetch latest policy error:", error.message);
      return res.status(500).json({ success: false, message: "Failed to fetch policy." });
    }
  });

  router.get("/audit", requireAdmin, async (req, res) => {
    try {
      if (req.monitoringIsEmployee) return res.status(403).json({ success: false, message: "Unauthorized." });
      const result = await db.query(
        `SELECT a.*, u.full_name as user_name FROM endpoint_policy_audit_logs a
         LEFT JOIN users u ON u.user_id = a.user_id
         ORDER BY a.created_at DESC LIMIT $1`,
        [100]
      );
      return res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("[laptop-monitoring] fetch audit error:", error.message);
      return res.status(500).json({ success: false, message: "Failed to fetch audit logs." });
    }
  });
}

module.exports = { registerEndpointPolicyRoutes };
