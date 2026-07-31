const crypto = require("crypto");
const db = require("../../config/db");
const { reconcileDevice } = require("../services/reconciliationService");
const { upsertAgentInventoryDiscovery } = require("../services/assetDiscoveryInventoryService");

const DEVICE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLACEHOLDER_SERIALS = new Set([
  "",
  "0",
  "00000000",
  "default string",
  "none",
  "not applicable",
  "system serial number",
  "to be filled by o.e.m.",
  "unknown",
  "unknown-sn",
]);

function normalizeDetectedSerial(value) {
  const serial = String(value || "").trim();
  return PLACEHOLDER_SERIALS.has(serial.toLowerCase()) ? null : serial.slice(0, 100);
}

function cleanInventoryText(value, maxLength, fallback = null) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : fallback;
}

function buildAgentAssetIdentity(device, inventory) {
  const stableSource = String(
    device.device_uuid || device.device_id || device.hostname || device.device_name
  ).trim();
  const suffix = crypto
    .createHash("sha256")
    .update(stableSource)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();

  return {
    assetTag: `AUTO-${suffix}`,
    serialNumber: normalizeDetectedSerial(inventory.serial_number) || `AGENT-${suffix}`,
  };
}

function resolveDeviceUuid(body) {
  const suppliedUuid = String(body?.device_uuid || "").trim().toLowerCase();
  if (DEVICE_UUID_PATTERN.test(suppliedUuid)) return suppliedUuid;

  const hostname = String(body?.hostname || "").trim();
  if (!hostname) return null;
  const hash = crypto.createHash("md5").update(hostname.toLowerCase()).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `3${hash.slice(13, 16)}`,
    `a${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

function registerEndpointInventoryRoutes(router, {
  requireAgent,
  requireAdmin,
  normalizeSoftwareItem,
}) {
  router.post("/hardware-inventory", requireAgent, async (req, res) => {
    const deviceUuid = resolveDeviceUuid(req.body);
    if (!deviceUuid) {
      return res.status(400).json({ success: false, message: "A valid device_uuid or hostname is required." });
    }

    try {
      const deviceResult = await db.query(
        `SELECT device_id, device_uuid, hostname, agent_version, status, asset_id, branch_id
           FROM monitored_devices WHERE device_uuid=$1 LIMIT 1`,
        [deviceUuid]
      );
      if (!deviceResult.rows.length) {
        return res.status(404).json({ success: false, message: "Device not found." });
      }
      const device = deviceResult.rows[0];
      const { device_id, asset_id } = device;
      const {
        manufacturer, model, serial_number, cpu_name, total_ram_gb,
        os_name, os_version, os_build, architecture,
        disk_total_gb, disk_free_gb, mac_address, ip_address, scanned_at,
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
        disk_total_gb, disk_free_gb, mac_address, ip_address, scanned_at,
      ]);

      await upsertAgentInventoryDiscovery(device, {
        manufacturer, model, serial_number, cpu_name, total_ram_gb,
        os_name, os_version, os_build, architecture,
        disk_total_gb, disk_free_gb, mac_address, ip_address, scanned_at,
      });
      await reconcileDevice(device_id);

      return res.json({ success: true, message: "Hardware inventory updated." });
    } catch (error) {
      console.error("Hardware inventory error:", error.message);
      return res.status(500).json({ success: false, error: "Database error." });
    }
  });

  router.post("/software-inventory", requireAgent, async (req, res) => {
    const deviceUuid = resolveDeviceUuid(req.body);
    if (!deviceUuid) {
      return res.status(400).json({ success: false, message: "A valid device_uuid or hostname is required." });
    }
    const items = Array.isArray(req.body?.software)
      ? req.body.software.map(normalizeSoftwareItem).filter(Boolean).slice(0, 2000)
      : [];
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
      return res.json({ success: true, data: result.rows[0] || null });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ success: false, error: "Failed to fetch hardware inventory" });
    }
  });

  router.get("/hardware-inventory-by-asset/:assetId", requireAdmin, async (req, res) => {
    try {
      const { assetId } = req.params;
      const deviceResult = await db.query(`SELECT device_id FROM monitored_devices WHERE asset_id=$1`, [assetId]);
      if (!deviceResult.rows.length) return res.json({ success: true, data: null });

      const result = await db.query(
        `SELECT * FROM endpoint_hardware_inventory WHERE device_id=$1 ORDER BY scanned_at DESC LIMIT 1`,
        [deviceResult.rows[0].device_id]
      );
      return res.json({ success: true, data: result.rows[0] || null });
    } catch (_error) {
      return res.status(500).json({ success: false, error: "Failed to fetch hardware inventory" });
    }
  });

  router.delete("/devices/:id", requireAdmin, async (req, res) => {
    if (!req.monitoringIsSuperAdmin) return res.status(403).json({ success: false, error: "Superadmin required." });
    try {
      const result = await db.query(`DELETE FROM monitored_devices WHERE device_id=$1 RETURNING *`, [req.params.id]);
      if (!result.rows.length) return res.status(404).json({ success: false, error: "Device not found." });
      return res.json({ success: true, message: "Device deleted successfully." });
    } catch (_error) {
      return res.status(500).json({ success: false, error: "Failed to delete device." });
    }
  });

  router.get("/assets/:assetId/reconciliation", requireAdmin, async (req, res) => {
    try {
      const result = await db.query(
        `SELECT * FROM asset_inventory_reconciliation WHERE asset_id=$1 ORDER BY checked_at DESC`,
        [req.params.assetId]
      );
      return res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ success: false, error: "Failed to fetch reconciliation data." });
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
      return res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ success: false, error: "Failed to fetch reconciliation data." });
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
      return res.json({ success: true, data: result, message: "Reconciliation successful." });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ success: false, error: "Failed to reconcile device." });
    }
  });

  router.post("/devices/:deviceId/convert-to-asset", requireAdmin, async (req, res) => {
    if (req.monitoringIsEmployee) return res.status(403).json({ success: false, error: "Access denied." });
    let client;
    try {
      const { deviceId } = req.params;
      const branchResolution = String(req.body?.branch_resolution || "").trim().toLowerCase();
      client = await db.connect();
      await client.query("BEGIN");

      const deviceQuery = await client.query(
        `SELECT device.*, branch.branch_name
           FROM monitored_devices device
           LEFT JOIN branches branch ON branch.branch_id=device.branch_id
          WHERE device.device_id=$1
          FOR UPDATE OF device`,
        [deviceId]
      );
      if (!deviceQuery.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "Device not found." });
      }
      const device = deviceQuery.rows[0];

      if (!req.monitoringIsSuperAdmin && req.monitoringBranchId && device.branch_id !== req.monitoringBranchId) {
        await client.query("ROLLBACK");
        return res.status(403).json({ success: false, error: "Access denied" });
      }
      if (device.asset_id) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, error: "Device is already linked to an asset." });
      }

      const inventoryQuery = await client.query(
        `SELECT * FROM endpoint_hardware_inventory
         WHERE device_id=$1
         ORDER BY scanned_at DESC
         LIMIT 1`,
        [deviceId]
      );
      if (!inventoryQuery.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, error: "Device has not sent any hardware inventory yet. Wait for the agent to complete a scan." });
      }
      const inv = inventoryQuery.rows[0];
      const realSerialNumber = normalizeDetectedSerial(inv.serial_number);
      const { assetTag, serialNumber } = buildAgentAssetIdentity(device, inv);
      const existingAssetQuery = await client.query(
        `SELECT asset.asset_id, asset.asset_tag, asset.asset_name,
                asset.serial_number, asset.branch_id, branch.branch_name
           FROM hardware_assets asset
           LEFT JOIN branches branch ON branch.branch_id=asset.branch_id
          WHERE LOWER(TRIM(asset.serial_number)) = LOWER(TRIM($1))
             OR LOWER(TRIM(asset.asset_tag)) = LOWER(TRIM($2))
          ORDER BY
            CASE
              WHEN $3::text IS NOT NULL
               AND LOWER(TRIM(asset.serial_number)) = LOWER(TRIM($3))
              THEN 0
              ELSE 1
            END,
            asset.asset_id
          LIMIT 1
          FOR UPDATE OF asset`,
        [serialNumber, assetTag, realSerialNumber]
      );

      if (existingAssetQuery.rows.length) {
        const existingAsset = existingAssetQuery.rows[0];
        let endpointBranchAligned = false;
        const existingAssetLabel = [
          existingAsset.asset_name || "Unnamed hardware asset",
          existingAsset.asset_tag ? `Tag: ${existingAsset.asset_tag}` : null,
          existingAsset.serial_number ? `Serial: ${existingAsset.serial_number}` : null,
        ].filter(Boolean).join(" · ");
        const linkedDeviceQuery = await client.query(
          `SELECT device_id, device_uuid, hostname, status, last_seen_at
             FROM monitored_devices
            WHERE asset_id=$1 AND device_id<>$2
            ORDER BY last_seen_at DESC NULLS LAST, device_id
            LIMIT 1`,
          [existingAsset.asset_id, deviceId]
        );

        if (linkedDeviceQuery.rows.length) {
          const linkedDevice = linkedDeviceQuery.rows[0];
          await client.query("ROLLBACK");
          return res.status(409).json({
            success: false,
            error: `Existing hardware asset "${existingAssetLabel}" is already linked to endpoint ${linkedDevice.hostname || linkedDevice.device_uuid || linkedDevice.device_id}. Open that endpoint and remove its stale asset link before linking this device.`,
            data: {
              matching_asset_id: existingAsset.asset_id,
              matching_asset_tag: existingAsset.asset_tag,
              matching_asset_name: existingAsset.asset_name,
              matching_asset_serial_number: existingAsset.serial_number,
              matching_asset_branch_id: existingAsset.branch_id,
              matching_asset_branch_name: existingAsset.branch_name,
              linked_device_id: linkedDevice.device_id,
              linked_device_uuid: linkedDevice.device_uuid,
              linked_device_hostname: linkedDevice.hostname,
              linked_device_status: linkedDevice.status,
              linked_device_last_seen_at: linkedDevice.last_seen_at,
            },
          });
        }

        if (
          device.branch_id
          && existingAsset.branch_id
          && device.branch_id !== existingAsset.branch_id
        ) {
          if (!req.monitoringIsSuperAdmin || branchResolution !== "use_asset_branch") {
            await client.query("ROLLBACK");
            return res.status(req.monitoringIsSuperAdmin ? 409 : 403).json({
              success: false,
              error: req.monitoringIsSuperAdmin
                ? `Existing hardware asset "${existingAssetLabel}" belongs to ${existingAsset.branch_name || `branch ${existingAsset.branch_id}`}, while endpoint ${device.hostname || device.device_uuid || device.device_id} belongs to ${device.branch_name || `branch ${device.branch_id}`}. Confirm that the endpoint should use the asset's branch before linking them.`
                : "Access denied.",
              data: req.monitoringIsSuperAdmin ? {
                conflict_type: "branch_mismatch",
                matching_asset_id: existingAsset.asset_id,
                matching_asset_tag: existingAsset.asset_tag,
                matching_asset_name: existingAsset.asset_name,
                matching_asset_serial_number: existingAsset.serial_number,
                matching_asset_branch_id: existingAsset.branch_id,
                matching_asset_branch_name: existingAsset.branch_name,
                endpoint_branch_id: device.branch_id,
                endpoint_branch_name: device.branch_name,
                endpoint_hostname: device.hostname,
              } : undefined,
            });
          }
          endpointBranchAligned = true;
        }

        await client.query(
          `UPDATE monitored_devices
              SET asset_id=$1,
                  branch_id=COALESCE($2, branch_id),
                  updated_at=CURRENT_TIMESTAMP
            WHERE device_id=$3`,
          [existingAsset.asset_id, existingAsset.branch_id, deviceId]
        );
        if (endpointBranchAligned) {
          await client.query(
            `INSERT INTO monitored_device_assignments (
               device_id, device_uuid, asset_id, old_user_id, new_user_id,
               old_branch_id, new_branch_id, old_department, new_department,
               reason, changed_by
             ) VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$7,$8,$9)`,
            [
              device.device_id,
              device.device_uuid,
              existingAsset.asset_id,
              device.assigned_user_id || null,
              device.branch_id,
              existingAsset.branch_id,
              device.department || null,
              `Endpoint branch aligned to existing asset ${existingAsset.asset_tag || existingAsset.asset_id}`,
              req.monitoringUserId,
            ]
          );
          await client.query(
            `INSERT INTO laptop_activity_logs (device_id, event_type, app_name, window_title)
             VALUES ($1,'system_audit','Endpoint asset link',$2)`,
            [
              device.device_id,
              `Branch changed from ${device.branch_name || device.branch_id} to ${existingAsset.branch_name || existingAsset.branch_id}; linked to ${existingAsset.asset_tag || existingAsset.asset_id}.`,
            ]
          );
        }
        await client.query("COMMIT");
        client.release();
        client = null;
        await reconcileDevice(deviceId);
        return res.json({
          success: true,
          data: {
            asset_id: existingAsset.asset_id,
            created: false,
            matched_by:
              realSerialNumber
              && String(existingAsset.serial_number || "").trim().toLowerCase()
                === realSerialNumber.toLowerCase()
                ? "serial_number"
                : "asset_tag",
            branch_aligned: endpointBranchAligned,
            message: endpointBranchAligned
              ? "The endpoint branch was aligned to the existing asset and the records were linked."
              : "The endpoint was linked to its existing hardware asset.",
          },
          message: endpointBranchAligned
            ? "The endpoint branch was aligned to the existing asset and linked successfully. No duplicate was created."
            : "The endpoint was linked to its existing hardware asset. No duplicate was created.",
        });
      }

      if (!device.branch_id) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          error: "Assign the endpoint to a branch before creating its hardware asset.",
        });
      }

      const formatSize = (value) => {
        const number = parseFloat(String(value || "").replace(/[^0-9.]/g, ""));
        return Number.isNaN(number) ? null : `${Math.ceil(number)} GB`;
      };
      const model = cleanInventoryText(inv.model, 100, "Unknown");
      const manufacturer = cleanInventoryText(inv.manufacturer, 100, "Unknown");
      const assetName = cleanInventoryText(
        inv.model || device.hostname || device.device_name,
        255,
        "Unknown Endpoint"
      );
      const operatingSystem = cleanInventoryText(
        [inv.os_name, inv.os_version].filter(Boolean).join(" "),
        150
      );

      const insertAsset = await client.query(`
        INSERT INTO hardware_assets (
          asset_name, asset_type, brand, manufacturer, model, model_name, serial_number, asset_tag,
          processor, ram, storage, operating_system, branch_id, status
        ) VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING asset_id
      `, [
        assetName, "Computer", manufacturer, manufacturer, model, serialNumber, assetTag,
        cleanInventoryText(inv.cpu_name, 150), formatSize(inv.total_ram_gb), formatSize(inv.disk_total_gb), operatingSystem,
        device.branch_id, "In Use",
      ]);

      const newAssetId = insertAsset.rows[0].asset_id;
      await client.query(
        `UPDATE monitored_devices
            SET asset_id=$1, updated_at=CURRENT_TIMESTAMP
          WHERE device_id=$2`,
        [newAssetId, deviceId]
      );
      await client.query("COMMIT");
      client.release();
      client = null;
      await reconcileDevice(deviceId);
      return res.json({
        success: true,
        data: {
          asset_id: newAssetId,
          created: true,
          message: "Hardware asset created and linked from endpoint specifications.",
        },
        message: "Hardware asset created and linked from endpoint specifications.",
      });
    } catch (error) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error("Convert to asset rollback error:", rollbackError);
        }
      }
      console.error("Convert to asset error:", error);
      if (error.code === "23505") {
        return res.status(409).json({
          success: false,
          error: "An asset with the same serial number or asset tag already exists. Link the endpoint to that existing asset instead.",
        });
      }
      if (["23502", "23503", "23514"].includes(error.code)) {
        return res.status(400).json({
          success: false,
          error: "The endpoint inventory is incomplete or does not satisfy the hardware asset requirements. Verify its branch and latest hardware scan.",
        });
      }
      return res.status(500).json({ success: false, error: "Failed to create asset." });
    } finally {
      client?.release();
    }
  });
}

module.exports = {
  buildAgentAssetIdentity,
  cleanInventoryText,
  normalizeDetectedSerial,
  registerEndpointInventoryRoutes,
  resolveDeviceUuid,
};
