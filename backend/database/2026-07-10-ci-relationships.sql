-- CI Relationships Module
-- Adds updated_at to ci_dependencies, creates audit_logs table

ALTER TABLE ci_dependencies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE ci_dependencies ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE ci_dependencies ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id) ON DELETE CASCADE;

-- Audit logs for CI relationship actions
CREATE TABLE IF NOT EXISTS ci_audit_logs (
  log_id SERIAL PRIMARY KEY,
  action_type VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL DEFAULT 'relationship',
  entity_id INTEGER,
  user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  user_name VARCHAR(255),
  branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
  branch_name VARCHAR(255),
  old_values JSONB,
  new_values JSONB,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ci_audit_logs_entity ON ci_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ci_audit_logs_user ON ci_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ci_audit_logs_created ON ci_audit_logs(created_at DESC);
