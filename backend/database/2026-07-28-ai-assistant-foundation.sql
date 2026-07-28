CREATE TABLE IF NOT EXISTS ai_assistant_audit (
  audit_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  role_name VARCHAR(80),
  branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
  question_preview VARCHAR(240),
  outcome VARCHAR(40) NOT NULL,
  source_count INTEGER NOT NULL DEFAULT 0,
  provider_status INTEGER,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ai_assistant_audit_user_created_idx
  ON ai_assistant_audit (user_id,created_at DESC);

CREATE INDEX IF NOT EXISTS ai_assistant_audit_branch_created_idx
  ON ai_assistant_audit (branch_id,created_at DESC);
