CREATE TABLE IF NOT EXISTS monitored_devices (
  device_id BIGSERIAL PRIMARY KEY,
  hostname VARCHAR(255) NOT NULL UNIQUE,
  assigned_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
  agent_version VARCHAR(50),
  last_seen_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'Offline' CHECK (status IN ('Online', 'Offline')),
  consent_status VARCHAR(30) NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS laptop_activity_logs (
  id BIGSERIAL PRIMARY KEY,
  device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL DEFAULT 'activity',
  app_name VARCHAR(255),
  window_title VARCHAR(500),
  idle_seconds INTEGER NOT NULL DEFAULT 0 CHECK (idle_seconds >= 0),
  url_domain VARCHAR(255),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS laptop_screenshots (
  id BIGSERIAL PRIMARY KEY,
  device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
  file_url TEXT,
  file_path TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS laptop_alerts (
  id BIGSERIAL PRIMARY KEY,
  device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
  severity VARCHAR(20) NOT NULL DEFAULT 'Medium',
  alert_type VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS monitoring_consents (
  id BIGSERIAL PRIMARY KEY,
  device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  consent_type VARCHAR(50) NOT NULL,
  consent_status VARCHAR(30) NOT NULL DEFAULT 'Pending',
  consented_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (device_id, user_id, consent_type)
);

CREATE INDEX IF NOT EXISTS laptop_activity_device_occurred_idx ON laptop_activity_logs (device_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS laptop_alerts_device_created_idx ON laptop_alerts (device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS laptop_screenshots_device_captured_idx ON laptop_screenshots (device_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS monitoring_consents_device_type_idx ON monitoring_consents (device_id, consent_type, consent_status);
