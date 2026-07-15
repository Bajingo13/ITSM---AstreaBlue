-- Keep hardware-asset refreshes fast as monitoring inventory grows.
CREATE INDEX IF NOT EXISTS endpoint_hardware_inventory_device_scan_idx
  ON endpoint_hardware_inventory(device_id, scanned_at DESC);

CREATE INDEX IF NOT EXISTS monitored_devices_asset_idx
  ON monitored_devices(asset_id)
  WHERE asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS hardware_assets_branch_created_idx
  ON hardware_assets(branch_id, created_at DESC);
