ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS asset_id INTEGER REFERENCES hardware_assets(asset_id) ON DELETE SET NULL;
ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS department VARCHAR(255);
