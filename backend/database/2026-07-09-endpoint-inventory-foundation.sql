-- Inventory indexes and reconciliation migrations require this table.
CREATE TABLE IF NOT EXISTS endpoint_hardware_inventory (
  id BIGSERIAL PRIMARY KEY,
  device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
  device_uuid UUID,
  asset_id INTEGER,
  manufacturer VARCHAR(255),
  model VARCHAR(255),
  serial_number VARCHAR(255),
  cpu_name VARCHAR(255),
  total_ram_gb NUMERIC(8,2),
  os_name VARCHAR(255),
  os_version VARCHAR(255),
  os_build VARCHAR(255),
  architecture VARCHAR(50),
  disk_total_gb NUMERIC(10,2),
  disk_free_gb NUMERIC(10,2),
  mac_address VARCHAR(255),
  ip_address VARCHAR(255),
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
