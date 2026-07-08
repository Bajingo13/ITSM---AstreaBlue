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

-- Audit trail for all consent lifecycle events
CREATE TABLE IF NOT EXISTS consent_audit_logs (
  log_id       BIGSERIAL PRIMARY KEY,
  consent_id   BIGINT REFERENCES consent_documents(consent_id) ON DELETE SET NULL,
  employee_id  INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  actor_id     INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  actor_role   VARCHAR(50),
  event_type   VARCHAR(80) NOT NULL,
  -- e.g. created | signed | printed | downloaded | change_requested
  --       withdrawn | superseded | admin_approved | admin_rejected
  details      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS consent_audit_employee_idx ON consent_audit_logs(employee_id);
CREATE INDEX IF NOT EXISTS consent_audit_consent_idx  ON consent_audit_logs(consent_id);
