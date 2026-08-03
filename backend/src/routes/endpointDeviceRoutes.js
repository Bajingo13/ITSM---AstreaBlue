const db = require("../../config/db");
const { reconcileDevice } = require("../services/reconciliationService");
const { buildEndpointHealth } = require("../services/endpointHealthService");
const {
  canAssignEmployeeDuringOnboarding,
} = require("../services/onboardingStateService");

const ONLINE_THRESHOLD_SECONDS = 120;

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

async function loadEndpointHealthRows(req, deviceLookup = null) {
  const params = [];
  const conditions = [];
  if (deviceLookup) {
    params.push(deviceLookup);
    conditions.push(/^\d+$/.test(String(deviceLookup))
      ? `d.device_id=$${params.length}`
      : `d.device_uuid::text=$${params.length}`);
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

async function refreshDeviceStatuses() {
  await db.query(
    `UPDATE monitored_devices
     SET status=CASE WHEN last_seen_at IS NOT NULL AND last_seen_at >= CURRENT_TIMESTAMP - ($1 * INTERVAL '1 second') THEN 'Online' ELSE 'Offline' END,
     updated_at=CURRENT_TIMESTAMP
     WHERE status IS DISTINCT FROM CASE WHEN last_seen_at IS NOT NULL AND last_seen_at >= CURRENT_TIMESTAMP - ($1 * INTERVAL '1 second') THEN 'Online' ELSE 'Offline' END`,
    [ONLINE_THRESHOLD_SECONDS]
  );
}

function registerEndpointDeviceRoutes(router, { requireAdmin, ensureConsentRequestForDevice }) {
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
         a.asset_id AS linked_asset_id,
         a.asset_tag, a.asset_name, a.serial_number, a.model,
         a.employee_id AS asset_employee_id,
         a.assigned_name AS asset_assigned_name,
         CASE
           WHEN a.asset_id IS NULL THEN NULL
           WHEN d.assigned_user_id IS NULL AND a.employee_id IS NULL AND NULLIF(TRIM(a.assigned_name), '') IS NULL THEN TRUE
           WHEN a.employee_id::text = d.assigned_user_id::text THEN TRUE
           WHEN NULLIF(TRIM(a.assigned_name), '') IS NOT NULL
             AND LOWER(TRIM(a.assigned_name)) = LOWER(TRIM(u.full_name)) THEN TRUE
           ELSE FALSE
         END AS asset_assignment_matches
         FROM monitored_devices d
         LEFT JOIN users u ON u.user_id=d.assigned_user_id
         LEFT JOIN branches b ON b.branch_id=d.branch_id
         LEFT JOIN hardware_assets a ON a.asset_id=d.asset_id
         WHERE ($1::int IS NULL OR d.branch_id=$1)
         AND ($2::int IS NULL OR d.assigned_user_id=$2)
         ORDER BY d.last_seen_at DESC NULLS LAST`,
        [req.monitoringBranchId, req.monitoringIsEmployee ? req.monitoringUser.userId : null]
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
      params.push(Math.min(500, Math.max(1, Number(req.query.limit) || 200)));
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
      const endpoints = (await loadEndpointHealthRows(req)).map(buildEndpointHealth);
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
      const employeeId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;
      const allowed = await db.query(
        `SELECT device_id,device_uuid,assigned_user_id FROM monitored_devices
         WHERE device_id=$1 AND ($2::int IS NULL OR branch_id=$2) AND ($3::int IS NULL OR assigned_user_id=$3)`,
        [req.params.id, req.monitoringBranchId, employeeId]
      );
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
        db.query(`SELECT policy_json, generated_at FROM endpoint_effective_policies WHERE device_uuid=$1::uuid LIMIT 1`, [device.device_uuid]),
      ]);
      const effectivePolicy = policy.rows[0]
        ? { ...(policy.rows[0].policy_json || {}), generated_at: policy.rows[0].generated_at || policy.rows[0].policy_json?.generated_at || null }
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
      if (!req.monitoringIsSuperAdmin && check.rows[0].branch_id && check.rows[0].branch_id !== req.monitoringBranchId) {
        return res.status(403).json({ success: false, message: "Cannot reassign device from another branch." });
      }
      if (req.monitoringIsEmployee) {
        return res.status(403).json({ success: false, message: "Employees cannot reassign devices." });
      }

      const { assigned_user_id, branch_id, asset_id, department, reason } = req.body;
      let finalDepartment = department || null;
      let assignedName = null;
      let assignedEmail = null;
      let assignedBranchId = null;
      if (assigned_user_id) {
        const user = await db.query(
          `SELECT u.full_name,u.email,u.department,u.branch_id,u.onboarding_status,u.onboarding_required,u.is_active,r.role_name
             FROM users u
             LEFT JOIN system_roles r ON r.role_id=u.role_id
            WHERE u.user_id=$1`,
          [assigned_user_id]
        );
        if (!user.rows.length) return res.status(404).json({ success: false, message: "Employee not found." });
        const employee = user.rows[0];
        if (String(employee.role_name || "").toLowerCase() !== "employee") {
          return res.status(409).json({ success: false, message: "Only an Employee account can be assigned to a managed company device." });
        }
        if (employee.is_active === false) {
          return res.status(409).json({
            success: false,
            message: "The employee must activate the AstreaBlue account before device assignment.",
          });
        }
        const onboardingIncomplete = employee.onboarding_required || employee.onboarding_status !== "Completed";
        const activeLifecycleOnboarding = onboardingIncomplete
          ? await canAssignEmployeeDuringOnboarding(db, assigned_user_id)
          : false;
        if (onboardingIncomplete && !activeLifecycleOnboarding) {
          return res.status(409).json({
            success: false,
            message: "Asset and device assignment requires completed onboarding or an active lifecycle onboarding case.",
            onboarding_status: employee.onboarding_status,
          });
        }
        const approvedConsent = await db.query(
          `SELECT consent_id FROM consent_documents
           WHERE employee_id=$1 AND status='approved' AND active=true
             AND (device_uuid IS NULL OR device_uuid=$2::uuid)
           ORDER BY (device_uuid IS NOT NULL) DESC, approved_at DESC NULLS LAST LIMIT 1`,
          [assigned_user_id, check.rows[0].device_uuid]
        );
        // Asset custody must be assignable before consent is completed. When
        // consent is missing, ensureConsentRequestForDevice() creates the
        // agreement request after the ownership transaction. The effective
        // endpoint policy remains on its safe baseline until approval.
        req.assignmentHasApprovedConsent = approvedConsent.rows.length > 0;
        if (!finalDepartment) finalDepartment = employee.department || null;
        assignedName = employee.full_name;
        assignedEmail = employee.email || null;
        assignedBranchId = employee.branch_id || null;
      } else {
        // Ownership metadata belongs to the assigned employee. Keep the asset
        // link and branch, but clear employee-derived department information.
        finalDepartment = null;
      }

      const oldDevice = check.rows[0];
      const targetAssetId = asset_id === undefined ? oldDevice.asset_id : (asset_id || null);
      const client = await db.connect();
      let updatedDevice;
      try {
        await client.query("BEGIN");
        let targetAsset = null;
        if (targetAssetId) {
          const targetAssetResult = await client.query(
            `SELECT asset_id,branch_id,employee_id,assigned_name,borrower_name,status
               FROM hardware_assets WHERE asset_id=$1 FOR UPDATE`,
            [targetAssetId]
          );
          targetAsset = targetAssetResult.rows[0] || null;
          if (!targetAsset) {
            throw Object.assign(new Error("The linked hardware asset no longer exists."), { status: 409 });
          }
          if (!req.monitoringIsSuperAdmin && Number(targetAsset.branch_id) !== Number(req.monitoringBranchId)) {
            throw Object.assign(new Error("The hardware asset belongs to a different branch."), { status: 403 });
          }
          if (assigned_user_id && Number(assignedBranchId) !== Number(targetAsset.branch_id)) {
            throw Object.assign(new Error("The employee and linked hardware asset must belong to the same branch."), { status: 409 });
          }
        }

        const canonicalBranchId = targetAsset?.branch_id || assignedBranchId || branch_id || oldDevice.branch_id || null;
        const updated = await client.query(
          `UPDATE monitored_devices
           SET assigned_user_id=$1, branch_id=$2, asset_id=$3, department=$4, updated_at=CURRENT_TIMESTAMP
           WHERE device_id=$5 RETURNING *`,
          [assigned_user_id || null, canonicalBranchId, targetAssetId, finalDepartment, req.params.id]
        );
        updatedDevice = updated.rows[0];

        if (targetAssetId) {
          await client.query(
          `UPDATE hardware_assets
           SET employee_id=$1,
               assigned_name=$2,
               borrower_name=$2,
               borrower_email=$3,
               borrower_department=CASE WHEN $1::varchar IS NULL THEN NULL ELSE $4 END,
               department=$4,
               team_department=$4,
               assigned_date=CASE WHEN $1::varchar IS NOT NULL THEN CURRENT_DATE ELSE NULL END,
               actual_return_date=CASE WHEN $1::varchar IS NULL THEN CURRENT_DATE ELSE NULL END,
               returned_date=CASE WHEN $1::varchar IS NULL THEN CURRENT_DATE ELSE NULL END,
               status=CASE
                 WHEN $1::varchar IS NOT NULL AND status IN ('Active', 'Available', 'In Stock') THEN 'In Use'
                 WHEN $1::varchar IS NULL AND status IN ('In Use', 'Borrowed') THEN 'Available'
                 ELSE status
               END,
               updated_at=CURRENT_TIMESTAMP
           WHERE asset_id=$5`,
            [assigned_user_id || null, assignedName, assignedEmail, finalDepartment, targetAssetId]
          );
        }

        await client.query(
          `INSERT INTO monitored_device_assignments (
             device_id, device_uuid, asset_id, old_user_id, new_user_id, old_branch_id, new_branch_id, old_department, new_department, reason, changed_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            req.params.id, oldDevice.device_uuid, oldDevice.asset_id, oldDevice.assigned_user_id, assigned_user_id || null,
            oldDevice.branch_id, canonicalBranchId, oldDevice.department, finalDepartment, reason || "Manual assignment", req.monitoringUserId,
          ]
        );
        const eventName = assigned_user_id ? "Device assigned" : "Device unassigned";
        await client.query(
          `INSERT INTO laptop_activity_logs (device_id, event_type, app_name, window_title)
           VALUES ($1, 'system_audit', $2, $3)`,
          [req.params.id, eventName, `Assigned User ID: ${assigned_user_id || "None"}, Branch: ${canonicalBranchId || "None"}`]
        );
        await client.query("COMMIT");
      } catch (transactionError) {
        await client.query("ROLLBACK");
        throw transactionError;
      } finally {
        client.release();
      }

      if (targetAssetId) await reconcileDevice(req.params.id);
      let consentRequest = null;
      if (assigned_user_id) {
        consentRequest = await ensureConsentRequestForDevice(updatedDevice, req.monitoringUserId);
      }
      const consentPending = Boolean(assigned_user_id) && !req.assignmentHasApprovedConsent;
      return res.json({
        success: true,
        message: consentPending
          ? "Ownership updated. Consent was requested; privacy-sensitive monitoring remains disabled until approval."
          : "Device and hardware asset ownership updated.",
        data: updatedDevice,
        consent: {
          approved: Boolean(assigned_user_id) && !consentPending,
          pending: consentPending,
          consent_id: consentRequest?.consent_id || null,
        },
      });
    } catch (error) {
      console.error("[laptop-monitoring:assign]", error.message);
      return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to assign device." });
    }
  });

  router.delete("/devices/:id/asset-link", requireAdmin, async (req, res) => {
    if (req.monitoringIsEmployee) {
      return res.status(403).json({ success: false, message: "Employees cannot change endpoint asset links." });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const deviceResult = await client.query(
        `SELECT device_id, device_uuid, hostname, asset_id, branch_id
         FROM monitored_devices
         WHERE device_id=$1
         FOR UPDATE`,
        [req.params.id]
      );
      if (!deviceResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, message: "Device not found." });
      }

      const device = deviceResult.rows[0];
      if (!req.monitoringIsSuperAdmin && device.branch_id && device.branch_id !== req.monitoringBranchId) {
        await client.query("ROLLBACK");
        return res.status(403).json({ success: false, message: "Cannot change a device from another branch." });
      }

      await client.query(
        `UPDATE monitored_devices SET asset_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE device_id=$1`,
        [device.device_id]
      );
      await client.query(`UPDATE endpoint_hardware_inventory SET asset_id=NULL WHERE device_id=$1`, [device.device_id]);
      await client.query(`UPDATE endpoint_software_inventory SET asset_id=NULL WHERE device_id=$1`, [device.device_id]);
      await client.query(
        `UPDATE asset_discoveries
         SET matched_asset_id=NULL, reconciliation_status='Unmanaged', updated_at=CURRENT_TIMESTAMP
         WHERE raw_data->>'device_uuid'=$1`,
        [String(device.device_uuid || "")]
      );
      await client.query(
        `INSERT INTO laptop_activity_logs (device_id, event_type, app_name, window_title)
         VALUES ($1, 'system_audit', 'Endpoint asset link removed', $2)`,
        [device.device_id, `Previous Asset ID: ${device.asset_id || "None"}`]
      );
      await client.query("COMMIT");
      return res.json({
        success: true,
        message: "The stale hardware-asset link was removed. Endpoint monitoring remains active.",
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[laptop-monitoring:remove-asset-link]", error.message);
      return res.status(500).json({ success: false, message: "Failed to remove the endpoint asset link." });
    } finally {
      client.release();
    }
  });

  router.get("/summary", requireAdmin, async (req, res) => {
    try {
      await refreshDeviceStatuses();
      const employeeId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;
      const result = await db.query(
        `SELECT COUNT(*)::int total_monitored_devices,
         COUNT(*) FILTER (WHERE status='Online')::int online_devices,
         COUNT(*) FILTER (WHERE status='Offline')::int offline_devices,
         COUNT(DISTINCT assigned_user_id) FILTER (WHERE last_seen_at::date=CURRENT_DATE)::int active_users_today
         FROM monitored_devices WHERE ($1::int IS NULL OR branch_id=$1) AND ($2::int IS NULL OR assigned_user_id=$2)`,
        [req.monitoringBranchId, employeeId]
      );
      const idle = await db.query(
        `SELECT COALESCE(AVG(l.idle_seconds),0)::numeric(12,2) average_idle_seconds,COALESCE(SUM(l.idle_seconds),0)::bigint total_idle_seconds
         FROM laptop_activity_logs l JOIN monitored_devices d ON d.device_id=l.device_id
         WHERE l.occurred_at::date=CURRENT_DATE AND ($1::int IS NULL OR d.branch_id=$1) AND ($2::int IS NULL OR d.assigned_user_id=$2)`,
        [req.monitoringBranchId, employeeId]
      );
      const alerts = await db.query(
        `SELECT a.*,d.hostname FROM laptop_alerts a JOIN monitored_devices d ON d.device_id=a.device_id
         WHERE ($1::int IS NULL OR d.branch_id=$1) AND ($2::int IS NULL OR d.assigned_user_id=$2)
         ORDER BY a.created_at DESC LIMIT 20`,
        [req.monitoringBranchId, employeeId]
      );
      return res.json({ success: true, data: { ...result.rows[0], ...idle.rows[0], recent_alerts: alerts.rows } });
    } catch (error) {
      console.error("[laptop-monitoring:summary]", error.message);
      return res.status(500).json({ success: false, message: "Failed to load monitoring summary." });
    }
  });
}

module.exports = { registerEndpointDeviceRoutes };
