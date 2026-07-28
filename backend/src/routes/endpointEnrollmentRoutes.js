const db = require("../../config/db");

function registerEndpointEnrollmentRoutes(router, {
  requireEnrollmentAdmin,
  randomCredential,
  secretHash,
  recordEnrollmentAudit,
}) {
  function enrollmentScope(req, alias = "ec") {
    if (req.monitoringIsSuperAdmin) return { clause: "", params: [] };
    return { clause: `WHERE ${alias}.branch_id=$1`, params: [req.monitoringBranchId] };
  }

  async function loadManagedDevice(req, deviceId) {
    const result = await db.query(`SELECT * FROM monitored_devices WHERE device_id=$1`, [deviceId]);
    const device = result.rows[0];
    if (!device) return { error: { status: 404, message: "Device not found." } };
    if (!req.monitoringIsSuperAdmin && String(device.branch_id || "") !== String(req.monitoringBranchId || "")) {
      return { error: { status: 403, message: "Device belongs to another branch." } };
    }
    return { device };
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
    } catch (_error) {
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
    } catch (_error) {
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
    } catch (_error) {
      return res.status(500).json({ success: false, message: "Failed to revoke device credential." });
    }
  });
}

module.exports = { registerEndpointEnrollmentRoutes };
