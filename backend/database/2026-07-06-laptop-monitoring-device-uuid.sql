ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS device_uuid UUID;
ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS device_name VARCHAR(255);
ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS logged_in_user VARCHAR(255);

ALTER TABLE monitored_devices DROP CONSTRAINT IF EXISTS monitored_devices_hostname_key;

CREATE UNIQUE INDEX IF NOT EXISTS monitored_devices_device_uuid_uidx
  ON monitored_devices (device_uuid)
  WHERE device_uuid IS NOT NULL;

CREATE INDEX IF NOT EXISTS monitored_devices_hostname_idx
  ON monitored_devices (LOWER(hostname));
