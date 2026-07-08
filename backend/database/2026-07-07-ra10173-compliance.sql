-- RA 10173 Compliance - laptop_activity_monitoring consent and preferences table
CREATE TABLE IF NOT EXISTS laptop_activity_monitoring (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  branch_id INTEGER REFERENCES branches(branch_id),
  application_monitoring BOOLEAN NOT NULL DEFAULT FALSE,
  web_monitoring BOOLEAN NOT NULL DEFAULT FALSE,
  location_tracking BOOLEAN NOT NULL DEFAULT FALSE,
  device_telemetry BOOLEAN NOT NULL DEFAULT TRUE,
  email_header_monitoring BOOLEAN NOT NULL DEFAULT FALSE,
  signature_image TEXT,
  consent_status VARCHAR(30) NOT NULL DEFAULT 'Pending',
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS laptop_monitoring_user_id_idx ON laptop_activity_monitoring (user_id);
CREATE INDEX IF NOT EXISTS laptop_monitoring_branch_id_idx ON laptop_activity_monitoring (branch_id);
CREATE INDEX IF NOT EXISTS laptop_monitoring_consent_status_idx ON laptop_activity_monitoring (consent_status);

-- Audit log for consent actions
CREATE TABLE IF NOT EXISTS consent_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS consent_audit_user_idx ON consent_audit_logs (user_id);
CREATE INDEX IF NOT EXISTS consent_audit_action_idx ON consent_audit_logs (action);
CREATE INDEX IF NOT EXISTS consent_audit_created_idx ON consent_audit_logs (created_at DESC);
