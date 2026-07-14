ALTER TABLE monitored_devices
  ADD COLUMN IF NOT EXISTS enrollment_status VARCHAR(30) NOT NULL DEFAULT 'Legacy',
  ADD COLUMN IF NOT EXISTS enrolled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS credential_last_seen_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS endpoint_enrollment_codes (
  enrollment_code_id BIGSERIAL PRIMARY KEY,
  code_hash VARCHAR(64) NOT NULL UNIQUE,
  code_prefix VARCHAR(24) NOT NULL,
  branch_id INTEGER REFERENCES branches(branch_id) ON DELETE CASCADE,
  intended_hostname VARCHAR(255),
  status VARCHAR(30) NOT NULL DEFAULT 'Active',
  expires_at TIMESTAMPTZ NOT NULL,
  created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMPTZ,
  used_by_device_id BIGINT REFERENCES monitored_devices(device_id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  revocation_reason TEXT
);

CREATE INDEX IF NOT EXISTS endpoint_enrollment_codes_status_expiry_idx
  ON endpoint_enrollment_codes(status, expires_at);
CREATE INDEX IF NOT EXISTS endpoint_enrollment_codes_branch_idx
  ON endpoint_enrollment_codes(branch_id, created_at DESC);

CREATE TABLE IF NOT EXISTS endpoint_device_credentials (
  device_credential_id BIGSERIAL PRIMARY KEY,
  device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
  credential_hash VARCHAR(64) NOT NULL UNIQUE,
  credential_prefix VARCHAR(24) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Active',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  revocation_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS endpoint_device_credentials_one_active_idx
  ON endpoint_device_credentials(device_id) WHERE status='Active';
CREATE INDEX IF NOT EXISTS endpoint_device_credentials_status_idx
  ON endpoint_device_credentials(status, device_id);

CREATE TABLE IF NOT EXISTS endpoint_enrollment_audit_logs (
  enrollment_audit_id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(80) NOT NULL,
  enrollment_code_id BIGINT REFERENCES endpoint_enrollment_codes(enrollment_code_id) ON DELETE SET NULL,
  device_id BIGINT REFERENCES monitored_devices(device_id) ON DELETE SET NULL,
  actor_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  source_ip VARCHAR(80),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS endpoint_enrollment_audit_device_idx
  ON endpoint_enrollment_audit_logs(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS endpoint_enrollment_audit_code_idx
  ON endpoint_enrollment_audit_logs(enrollment_code_id, created_at DESC);
