const db = require("../../config/db");

function clean(value) {
  const text = String(value || "").trim();
  return text || null;
}

async function findMatchingAsset(inventory, branchId, queryable = db) {
  const result = await queryable.query(
    `SELECT asset_id
       FROM hardware_assets
      WHERE (($1::text IS NOT NULL AND LOWER(serial_number)=LOWER($1))
         OR ($2::text IS NOT NULL AND LOWER(mac_address)=LOWER($2)))
        AND ($3::int IS NULL OR branch_id=$3)
      ORDER BY CASE WHEN branch_id IS NOT DISTINCT FROM $3 THEN 0 ELSE 1 END
      LIMIT 2`,
    [clean(inventory.serial_number), clean(inventory.mac_address), branchId]
  );
  return {
    assetId: result.rows.length === 1 ? result.rows[0].asset_id : null,
    duplicate: result.rows.length > 1,
  };
}

async function upsertAgentInventoryDiscovery(device, inventory, queryable = db) {
  if (!device?.device_uuid || !device?.hostname) return null;

  const branchId = device.branch_id || null;
  const match = device.asset_id
    ? { assetId: device.asset_id, duplicate: false }
    : await findMatchingAsset(inventory, branchId, queryable);
  const reconciliation = match.duplicate ? "Duplicate" : match.assetId ? "Matched" : "Unmanaged";
  const rawData = JSON.stringify({
    device_uuid: device.device_uuid,
    device_id: device.device_id,
    agent_version: device.agent_version || null,
    inventory,
  });

  const existing = await queryable.query(
    `SELECT discovery_id, matched_asset_id
       FROM asset_discoveries
      WHERE (($1::text IS NOT NULL AND LOWER(mac_address)=LOWER($1))
         OR ($2::text IS NOT NULL AND LOWER(serial_number)=LOWER($2))
         OR (LOWER(hostname)=LOWER($3) AND source='Endpoint Agent'))
        AND ($4::int IS NULL OR branch_id=$4)
      ORDER BY updated_at DESC
      LIMIT 1`,
    [clean(inventory.mac_address), clean(inventory.serial_number), device.hostname, branchId]
  );

  const matchedAssetId = match.assetId || existing.rows[0]?.matched_asset_id || null;
  const finalReconciliation = match.duplicate ? "Duplicate" : matchedAssetId ? "Matched" : reconciliation;
  const values = [
    device.hostname,
    clean(inventory.ip_address),
    clean(inventory.mac_address),
    clean(inventory.serial_number),
    clean(inventory.os_name),
    clean(inventory.manufacturer),
    "Managed Endpoint",
    device.status || "Online",
    finalReconciliation,
    matchedAssetId,
    branchId,
    rawData,
  ];

  if (existing.rows.length) {
    const result = await queryable.query(
      `UPDATE asset_discoveries
          SET hostname=$1, ip_address=COALESCE($2,ip_address), mac_address=COALESCE($3,mac_address),
              serial_number=COALESCE($4,serial_number), os_name=COALESCE($5,os_name),
              manufacturer=COALESCE($6,manufacturer), device_type=$7, source='Endpoint Agent',
              last_seen=CURRENT_TIMESTAMP, status=$8, reconciliation_status=$9,
              matched_asset_id=$10, branch_id=$11, raw_data=$12::jsonb, updated_at=CURRENT_TIMESTAMP
        WHERE discovery_id=$13
        RETURNING *`,
      [...values, existing.rows[0].discovery_id]
    );
    return result.rows[0];
  }

  const result = await queryable.query(
    `INSERT INTO asset_discoveries
       (hostname,ip_address,mac_address,serial_number,os_name,manufacturer,device_type,source,
        status,reconciliation_status,matched_asset_id,branch_id,raw_data,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'Endpoint Agent',$8,$9,$10,$11,$12::jsonb,NULL)
     RETURNING *`,
    values
  );
  return result.rows[0];
}

module.exports = { upsertAgentInventoryDiscovery };
