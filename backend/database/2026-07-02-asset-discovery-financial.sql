ALTER TABLE hardware_assets
  ADD COLUMN IF NOT EXISTS vendor VARCHAR(150),
  ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(150),
  ADD COLUMN IF NOT EXISTS useful_life_years NUMERIC(6,2) DEFAULT 5,
  ADD COLUMN IF NOT EXISTS salvage_value NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS depreciation_method VARCHAR(50) DEFAULT 'Straight-Line',
  ADD COLUMN IF NOT EXISTS hostname VARCHAR(255),
  ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64),
  ADD COLUMN IF NOT EXISTS mac_address VARCHAR(32),
  ADD COLUMN IF NOT EXISTS operating_system VARCHAR(150),
  ADD COLUMN IF NOT EXISTS device_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP,
  ADD COLUMN IF NOT EXISTS discovery_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS discovery_source VARCHAR(100),
  ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS hardware_assets_mac_unique
  ON hardware_assets (LOWER(mac_address)) WHERE mac_address IS NOT NULL;

CREATE TABLE IF NOT EXISTS asset_discovery_scans (
  scan_id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  devices_found INTEGER NOT NULL DEFAULT 0,
  new_assets INTEGER NOT NULL DEFAULT 0,
  updated_assets INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'Running',
  branch_id INTEGER REFERENCES branches(branch_id),
  initiated_by INTEGER REFERENCES users(user_id),
  error_message TEXT
);
