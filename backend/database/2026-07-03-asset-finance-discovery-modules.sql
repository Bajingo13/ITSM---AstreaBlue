CREATE TABLE IF NOT EXISTS asset_financials (
  financial_id BIGSERIAL PRIMARY KEY,
  asset_id INTEGER NOT NULL UNIQUE REFERENCES hardware_assets(asset_id) ON DELETE CASCADE,
  useful_life_years NUMERIC(6,2) NOT NULL DEFAULT 5 CHECK (useful_life_years > 0),
  salvage_value NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
  depreciation_method VARCHAR(50) NOT NULL DEFAULT 'Straight-Line',
  depreciation_start_date DATE,
  disposal_value NUMERIC(12,2),
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO asset_financials
  (asset_id, useful_life_years, salvage_value, depreciation_method, depreciation_start_date)
SELECT asset_id,
       COALESCE(useful_life_years, 5),
       COALESCE(salvage_value, 0),
       COALESCE(depreciation_method, 'Straight-Line'),
       purchase_date
FROM hardware_assets
ON CONFLICT (asset_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS asset_discoveries (
  discovery_id BIGSERIAL PRIMARY KEY,
  hostname VARCHAR(255) NOT NULL,
  ip_address VARCHAR(64),
  mac_address VARCHAR(32),
  serial_number VARCHAR(150),
  asset_tag VARCHAR(150),
  os_name VARCHAR(150),
  manufacturer VARCHAR(150),
  device_type VARCHAR(100),
  source VARCHAR(100) NOT NULL DEFAULT 'Manual',
  first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(30) NOT NULL DEFAULT 'Online',
  reconciliation_status VARCHAR(30) NOT NULL DEFAULT 'Unmanaged',
  matched_asset_id INTEGER REFERENCES hardware_assets(asset_id) ON DELETE SET NULL,
  branch_id INTEGER REFERENCES branches(branch_id),
  raw_data JSONB,
  created_by INTEGER REFERENCES users(user_id),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS asset_discoveries_mac_idx ON asset_discoveries (LOWER(mac_address));
CREATE INDEX IF NOT EXISTS asset_discoveries_serial_idx ON asset_discoveries (LOWER(serial_number));
CREATE INDEX IF NOT EXISTS asset_discoveries_asset_tag_idx ON asset_discoveries (LOWER(asset_tag));
CREATE INDEX IF NOT EXISTS asset_discoveries_matched_asset_idx ON asset_discoveries (matched_asset_id);

ALTER TABLE asset_discovery_scans
  ADD COLUMN IF NOT EXISTS source VARCHAR(100) DEFAULT 'Manual Import';
