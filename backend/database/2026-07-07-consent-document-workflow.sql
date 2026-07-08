-- RA 10173 Consent Document Workflow Migration
-- 2026-07-07

-- Formal consent document record (one per employee signing event)
CREATE TABLE IF NOT EXISTS consent_documents (
  consent_id        BIGSERIAL PRIMARY KEY,
  employee_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  employee_full_name VARCHAR(255) NOT NULL,
  employee_email    VARCHAR(255) NOT NULL,
  employee_number   VARCHAR(100),
  branch_id         INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
  branch_name       VARCHAR(255),
  department        VARCHAR(255),
  form_title        VARCHAR(255) NOT NULL DEFAULT 'RA 10173 Data Privacy Consent — Employee Monitoring',
  consent_version   VARCHAR(50)  NOT NULL DEFAULT '1.0',
  -- monitoring_preferences stored as JSON array of category strings
  monitoring_preferences JSONB    NOT NULL DEFAULT '[]',
  signed_at         TIMESTAMPTZ,
  e_signature_image TEXT,          -- base64 data URI or relative path
  printed_name      VARCHAR(255),
  status            VARCHAR(30)  NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','signed','withdrawn','superseded')),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS consent_documents_employee_idx ON consent_documents(employee_id);
CREATE INDEX IF NOT EXISTS consent_documents_status_idx   ON consent_documents(status);

-- Safely add columns for document workflow since the table might have been created by ra10173-compliance first
CREATE TABLE IF NOT EXISTS consent_audit_logs (
  log_id BIGSERIAL PRIMARY KEY
);

ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS consent_id BIGINT REFERENCES consent_documents(consent_id) ON DELETE SET NULL;
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS actor_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS actor_role VARCHAR(50);
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS event_type VARCHAR(80);
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS action VARCHAR(50);
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS action_by VARCHAR(255);
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS old_status VARCHAR(50);
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS new_status VARCHAR(50);
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);
-- 'details' might already exist as JSONB or TEXT. We won't alter its type here to avoid casting errors.
DO $$ 
BEGIN 
  BEGIN
    ALTER TABLE consent_audit_logs ADD COLUMN details TEXT;
  EXCEPTION
    WHEN duplicate_column THEN NULL;
  END;
END $$;
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS consent_audit_employee_idx ON consent_audit_logs(employee_id);
CREATE INDEX IF NOT EXISTS consent_audit_consent_idx  ON consent_audit_logs(consent_id);
