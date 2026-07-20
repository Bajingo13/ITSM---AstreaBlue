const db = require("../../config/db");

async function reconcileDevice(deviceId) {
  try {
    // Get device and asset
    const deviceQuery = await db.query(
      `SELECT d.device_uuid, d.asset_id as device_asset_id, i.* 
       FROM monitored_devices d
       LEFT JOIN endpoint_hardware_inventory i ON d.device_id = i.device_id
       WHERE d.device_id = $1
       ORDER BY i.scanned_at DESC LIMIT 1`,
      [deviceId]
    );

    if (!deviceQuery.rows.length || !deviceQuery.rows[0].device_asset_id) {
      return null;
    }

    const inventory = deviceQuery.rows[0];
    const assetId = inventory.device_asset_id;
    const deviceUuid = inventory.device_uuid;

    const assetQuery = await db.query(
      `SELECT * FROM hardware_assets WHERE asset_id = $1`,
      [assetId]
    );

    if (!assetQuery.rows.length) {
      return null;
    }

    const asset = assetQuery.rows[0];

    const comparisons = [
      { field: 'serial_number', assetVal: asset.serial_number, invVal: inventory.serial_number, critical: true },
      { field: 'manufacturer', assetVal: asset.manufacturer || asset.brand, invVal: inventory.manufacturer, critical: true },
      { field: 'model', assetVal: asset.model, invVal: inventory.model, critical: true },
      { field: 'cpu_name', assetVal: asset.processor, invVal: inventory.cpu_name, critical: false },
      { field: 'os_name', assetVal: asset.operating_system, invVal: inventory.os_name, critical: false },
      { field: 'os_version', assetVal: asset.operating_system, invVal: inventory.os_version, critical: false },
      { field: 'disk_total_gb', assetVal: asset.storage, invVal: inventory.disk_total_gb, critical: false },
      { field: 'total_ram_gb', assetVal: asset.ram, invVal: inventory.total_ram_gb, critical: false }
    ];

    const results = [];

    const normalize = (val) => String(val || "").trim().toLowerCase();

    for (const comp of comparisons) {
      let aVal = String(comp.assetVal || "").trim();
      let iVal = String(comp.invVal || "").trim();
      
      if (iVal && ['total_ram_gb', 'disk_total_gb'].includes(comp.field)) {
        const num = parseFloat(iVal.replace(/[^0-9.]/g, ''));
        if (!isNaN(num)) {
          iVal = Math.ceil(num).toString();
        }
      }
      
      let status = 'Match';
      let severity = 'None';
      
      if (!aVal || !iVal) {
        status = 'Unknown';
      } else {
        const normA = normalize(aVal);
        const normI = normalize(iVal);
        
        // For OS, RAM, Storage, they might just be substrings (e.g. "Windows 11" vs "Windows 11 Pro", "16GB" vs "15.8")
        if (['total_ram_gb', 'disk_total_gb'].includes(comp.field)) {
           // Basic number extraction if possible
           const numA = parseFloat(normA.replace(/[^0-9.]/g, ''));
           const numI = parseFloat(normI.replace(/[^0-9.]/g, ''));
           if (!isNaN(numA) && !isNaN(numI)) {
             // within 20% diff
             if (Math.abs(numA - numI) / Math.max(numA, numI) > 0.2) {
               status = 'Mismatch';
             }
           } else {
             if (normA !== normI) status = 'Mismatch';
           }
        } else if (['os_name', 'os_version', 'cpu_name'].includes(comp.field)) {
           if (!normA.includes(normI) && !normI.includes(normA)) {
             status = 'Mismatch';
           }
        } else {
           if (normA !== normI) {
             status = 'Mismatch';
           }
        }
      }

      if (status === 'Mismatch') {
        severity = comp.critical ? 'Critical' : 'Warning';
      }

      results.push({
        asset_id: assetId,
        device_uuid: deviceUuid,
        device_id: deviceId,
        field_name: comp.field,
        asset_value: aVal,
        detected_value: iVal,
        status,
        severity
      });
    }

    // Save to database
    // Start transaction
    await db.query('BEGIN');
    
    for (const r of results) {
      // Check history
      const existing = await db.query(
        `SELECT * FROM asset_inventory_reconciliation WHERE device_id = $1 AND field_name = $2`,
        [deviceId, r.field_name]
      );
      
      if (existing.rows.length > 0) {
        const old = existing.rows[0];
        if (old.detected_value !== r.detected_value || old.asset_value !== r.asset_value) {
          // Log history
          await db.query(
            `INSERT INTO asset_inventory_history (asset_id, device_uuid, field_name, old_value, new_value, source)
             VALUES ($1, $2, $3, $4, $5, 'System')`,
            [assetId, deviceUuid, r.field_name, old.detected_value, r.detected_value]
          );
        }
        await db.query(
          `UPDATE asset_inventory_reconciliation 
           SET asset_value=$1, detected_value=$2, status=$3, severity=$4, checked_at=CURRENT_TIMESTAMP
           WHERE id=$5`,
          [r.asset_value, r.detected_value, r.status, r.severity, old.id]
        );
      } else {
        await db.query(
          `INSERT INTO asset_inventory_reconciliation (asset_id, device_uuid, device_id, field_name, asset_value, detected_value, status, severity, checked_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
          [assetId, deviceUuid, deviceId, r.field_name, r.asset_value, r.detected_value, r.status, r.severity]
        );
        
        await db.query(
          `INSERT INTO asset_inventory_history (asset_id, device_uuid, field_name, old_value, new_value, source)
           VALUES ($1, $2, $3, null, $4, 'System')`,
          [assetId, deviceUuid, r.field_name, r.detected_value]
        );
      }
    }
    
    await db.query('COMMIT');
    
    return results;

  } catch (error) {
    console.error("Reconciliation error:", error);
    await db.query('ROLLBACK');
    return null;
  }
}

module.exports = {
  reconcileDevice
};
