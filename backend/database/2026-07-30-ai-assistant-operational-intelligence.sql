CREATE TABLE IF NOT EXISTS ai_assistant_unanswered_questions (
  unanswered_id BIGSERIAL PRIMARY KEY,
  question_fingerprint VARCHAR(64) NOT NULL,
  question_preview VARCHAR(240) NOT NULL,
  role_name VARCHAR(80) NOT NULL DEFAULT '',
  branch_scope INTEGER NOT NULL DEFAULT 0,
  branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
  last_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  reason VARCHAR(40) NOT NULL DEFAULT 'no_authorized_answer',
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  resolution_status VARCHAR(20) NOT NULL DEFAULT 'Open',
  first_asked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_asked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (question_fingerprint, role_name, branch_scope)
);

CREATE INDEX IF NOT EXISTS ai_assistant_unanswered_status_last_idx
  ON ai_assistant_unanswered_questions (resolution_status, last_asked_at DESC);

CREATE INDEX IF NOT EXISTS ai_assistant_unanswered_branch_last_idx
  ON ai_assistant_unanswered_questions (branch_id, last_asked_at DESC);
