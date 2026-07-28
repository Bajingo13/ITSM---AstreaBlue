const crypto = require("crypto");
const db = require("../../config/db");
const { reconcileDevice } = require("../services/reconciliationService");
const { upsertAgentInventoryDiscovery } = require("../services/assetDiscoveryInventoryService");

const DEVICE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    try {
      const { deviceId } = req.params;
      await db.query("BEGIN");

      const deviceQuery = await db.query(`SELECT * FROM monitored_devices WHERE device_id=$1 FOR UPDATE`, [deviceId]);
      if (!deviceQuery.rows.length) {
        await db.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "Device not found." });
      }
      const device = deviceQuery.rows[0];

      if (!req.monitoringIsSuperAdmin && req.monitoringBranchId && device.branch_id !== req.monitoringBranchId) {
        await db.query("ROLLBACK");
        return res.status(403).json({ success: false, error: "Access denied" });
      }
      if (device.asset_id) {
        await db.query("ROLLBACK");
        return res.status(400).json({ success: false, error: "Device is already linked to an asset." });
      }

      const inventoryQuery = await db.query(`SELECT * FROM endpoint_hardware_inventory WHERE device_id=$1 ORDER BY scanned_at DESC LIMIT 1`, [deviceId]);
      if (!inventoryQuery.rows.length) {
        await db.query("ROLLBACK");
        return res.status(400).json({ success: false, error: "Device has not sent any hardware inventory yet. Wait for the agent to complete a scan." });
      }
      const inv = inventoryQuery.rows[0];
      const formatSize = (value) => {
        const number = parseFloat(String(value || "").replace(/[^0-9.]/g, ""));
        return Number.isNaN(number) ? null : `${Math.ceil(number)} GB`;
      };
      const assetName = inv.model || device.hostname || device.device_name || "Unknown Endpoint";
      const assetTag = `AUTO-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 100)}`;
      const operatingSystem = [inv.os_name, inv.os_version].filter(Boolean).join(" ");

      const insertAsset = await db.query(`
        INSERT INTO hardware_assets (
          asset_name, asset_type, brand, manufacturer, model, serial_number, asset_tag,
          processor, ram, storage, operating_system, branch_id, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING asset_id
      `, [
        assetName, "Computer", inv.manufacturer || "Unknown", inv.manufacturer || "Unknown", inv.model || "Unknown", inv.serial_number || "UNKNOWN-SN", assetTag,
        inv.cpu_name, formatSize(inv.total_ram_gb), formatSize(inv.disk_total_gb), operatingSystem || null,
        device.branch_id || null, "In Use",
      ]);

      const newAssetId = insertAsset.rows[0].asset_id;
      await db.query(`UPDATE monitored_devices SET asset_id = $1 WHERE device_id = $2`, [newAssetId, deviceId]);
      await db.query("COMMIT");
      await reconcileDevice(deviceId);
      return res.json({ success: true, message: "Asset successfully generated from agent specs!" });
    } catch (error) {
      await db.query("ROLLBACK");
      console.error("Convert to asset error:", error);
      return res.status(500).json({ success: false, error: "Failed to create asset." });
    }
  });
}

module.exports = {
  registerEndpointInventoryRoutes,
  resolveDeviceUuid,
};
