-- Remove endpoint references to hardware assets that no longer exist.
UPDATE monitored_devices d
SET asset_id = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE d.asset_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM hardware_assets a WHERE a.asset_id = d.asset_id
  );

-- Keep future hardware-asset deletion safe without deleting the endpoint,
-- device credential, consent, inventory, or monitoring history.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE t.relname = 'monitored_devices'
      AND c.contype = 'f'
      AND a.attname = 'asset_id'
  ) THEN
    ALTER TABLE monitored_devices
      ADD CONSTRAINT monitored_devices_asset_id_fkey
      FOREIGN KEY (asset_id)
      REFERENCES hardware_assets(asset_id)
      ON DELETE SET NULL;
  END IF;
END $$;
