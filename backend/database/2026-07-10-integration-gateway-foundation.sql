CREATE TABLE IF NOT EXISTS integration_registry (
  integration_id SERIAL PRIMARY KEY,
  system_name VARCHAR(150) NOT NULL,
  system_code VARCHAR(80) NOT NULL UNIQUE,
  description TEXT,
  api_key_hash VARCHAR(128) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Active',
  allowed_branches JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS integration_audit_logs (
  audit_id BIGSERIAL PRIMARY KEY,
  integration_id INTEGER REFERENCES integration_registry(integration_id) ON DELETE SET NULL,
  event_type VARCHAR(80) NOT NULL,
  source_ip VARCHAR(64),
  request_method VARCHAR(10),
  request_path TEXT,
  request_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  success BOOLEAN NOT NULL DEFAULT true,
  status_code INTEGER,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_integration_registry_system_code ON integration_registry(system_code);
CREATE INDEX IF NOT EXISTS idx_integration_registry_status ON integration_registry(status);
CREATE INDEX IF NOT EXISTS idx_integration_audit_integration ON integration_audit_logs(integration_id);
CREATE INDEX IF NOT EXISTS idx_integration_audit_created ON integration_audit_logs(request_timestamp DESC);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS origin_system VARCHAR(150);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS origin_module VARCHAR(150);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS origin_feature VARCHAR(150);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS external_reference VARCHAR(150);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS external_attachment_metadata JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS external_request_fingerprint VARCHAR(64);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS integration_id INTEGER REFERENCES integration_registry(integration_id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS created_via VARCHAR(100);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS external_requester_name VARCHAR(200);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS external_requester_email VARCHAR(320);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS external_employee_id VARCHAR(150);

ALTER TABLE integration_registry ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE integration_audit_logs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE integration_audit_logs ADD COLUMN IF NOT EXISTS branch_id INTEGER;
ALTER TABLE integration_audit_logs ADD COLUMN IF NOT EXISTS employee_id INTEGER;

CREATE TABLE IF NOT EXISTS integration_api_keys (
  key_id BIGSERIAL PRIMARY KEY,
  integration_id INTEGER NOT NULL REFERENCES integration_registry(integration_id) ON DELETE CASCADE,
  key_name VARCHAR(150) NOT NULL,
  api_key_hash VARCHAR(128) NOT NULL UNIQUE,
  status VARCHAR(30) NOT NULL DEFAULT 'Active',
  created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tickets_integration_id ON tickets(integration_id);
CREATE INDEX IF NOT EXISTS idx_tickets_external_reference ON tickets(external_reference);
CREATE INDEX IF NOT EXISTS idx_tickets_origin_system ON tickets(origin_system);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_external_idempotency
  ON tickets(origin_system, external_reference)
  WHERE origin_system IS NOT NULL AND external_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_integration_api_keys_integration ON integration_api_keys(integration_id);
CREATE INDEX IF NOT EXISTS idx_integration_api_keys_status ON integration_api_keys(status);

ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS integration_id INTEGER REFERENCES integration_registry(integration_id) ON DELETE SET NULL;
ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS external_comment_reference VARCHAR(150);
CREATE UNIQUE INDEX IF NOT EXISTS uq_external_comment_reference
  ON ticket_comments(ticket_id, integration_id, external_comment_reference)
  WHERE integration_id IS NOT NULL AND external_comment_reference IS NOT NULL;
