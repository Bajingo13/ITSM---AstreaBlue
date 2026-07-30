ALTER TABLE knowledge_base
  ADD COLUMN IF NOT EXISTS publication_status VARCHAR(20) NOT NULL DEFAULT 'Published',
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

UPDATE knowledge_base
SET published_at = COALESCE(published_at, created_at, CURRENT_TIMESTAMP)
WHERE LOWER(publication_status) = 'published';

CREATE INDEX IF NOT EXISTS knowledge_base_publication_branch_idx
  ON knowledge_base (publication_status, branch_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS knowledge_base_search_idx
  ON knowledge_base USING GIN (
    (
      setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
      setweight(to_tsvector('english', COALESCE(category, '') || ' ' || COALESCE(tags, '')), 'B') ||
      setweight(to_tsvector('english', COALESCE(symptoms, '') || ' ' || COALESCE(resolution, '')), 'C')
    )
  );

CREATE TABLE IF NOT EXISTS ai_assistant_feedback (
  feedback_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  role_name VARCHAR(80),
  branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
  question_preview VARCHAR(240) NOT NULL,
  response_mode VARCHAR(40),
  helpful BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ai_assistant_feedback_created_idx
  ON ai_assistant_feedback (created_at DESC);

CREATE INDEX IF NOT EXISTS ai_assistant_feedback_user_created_idx
  ON ai_assistant_feedback (user_id, created_at DESC);
