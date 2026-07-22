-- Normalize legacy availability labels for hardware assets that are actively
-- assigned through Endpoint Management. Operational states such as repair,
-- retired, disposed, and lost/damaged are intentionally left unchanged.
UPDATE hardware_assets AS asset
SET status = 'In Use',
    updated_at = CURRENT_TIMESTAMP
WHERE asset.status IN ('Active', 'Available', 'In Stock')
  AND EXISTS (
    SELECT 1
    FROM monitored_devices AS device
    WHERE device.asset_id = asset.asset_id
      AND device.assigned_user_id IS NOT NULL
  );
