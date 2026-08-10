const { upsertAgentInventoryDiscovery } = require("./assetDiscoveryInventoryService");

async function syncEndpointAssetReferences(queryable, {
  device,
  inventory,
  assetId,
  branchId,
  actorUserId = null,
  created = false,
  discoveryUpsert = upsertAgentInventoryDiscovery,
}) {
  const effectiveBranchId = branchId || device.branch_id || null;

  await queryable.query(
    `UPDATE monitored_devices
        SET asset_id=$1,
            branch_id=COALESCE($2, branch_id),
            updated_at=CURRENT_TIMESTAMP
      WHERE device_id=$3`,
    [assetId, effectiveBranchId, device.device_id]
  );

  await queryable.query(
    `UPDATE endpoint_hardware_inventory
        SET asset_id=$1
      WHERE device_id=$2 OR device_uuid=$3::uuid`,
    [assetId, device.device_id, device.device_uuid]
  );

  await queryable.query(
    `UPDATE endpoint_software_inventory
        SET asset_id=$1,
            branch_id=COALESCE($2, branch_id),
            updated_at=CURRENT_TIMESTAMP
      WHERE device_id=$3 OR device_uuid=$4::uuid`,
    [assetId, effectiveBranchId, device.device_id, device.device_uuid]
  );

  await discoveryUpsert(
    {
      ...device,
      asset_id: assetId,
      branch_id: effectiveBranchId,
    },
    inventory,
    queryable
  );

  await queryable.query(
    `INSERT INTO asset_history
       (asset_id, event_type, event_data, branch_id, created_by)
     VALUES ($1,$2,$3::jsonb,$4,$5)`,
    [
      assetId,
      created ? "Asset Created from Endpoint" : "Endpoint Linked",
      JSON.stringify({
        source: "Endpoint Monitoring",
        device_id: device.device_id,
        device_uuid: device.device_uuid,
        hostname: device.hostname || device.device_name || null,
      }),
      effectiveBranchId,
      actorUserId || null,
    ]
  );
}

module.exports = { syncEndpointAssetReferences };
