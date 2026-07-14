ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_status VARCHAR(40) NOT NULL DEFAULT 'Completed',
  ADD COLUMN IF NOT EXISTS onboarding_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS invitation_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS privacy_notice_viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_consent_id BIGINT,
  ADD COLUMN IF NOT EXISTS onboarding_version VARCHAR(40) NOT NULL DEFAULT '1.0';

CREATE TABLE IF NOT EXISTS user_onboarding_history (
  onboarding_history_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  previous_status VARCHAR(40),
  new_status VARCHAR(40) NOT NULL,
  consent_id BIGINT,
  changed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS user_onboarding_history_user_idx
  ON user_onboarding_history(user_id, created_at DESC);

ALTER TABLE consent_documents
  ADD COLUMN IF NOT EXISTS document_object_key TEXT,
  ADD COLUMN IF NOT EXISTS signature_object_key TEXT,
  ADD COLUMN IF NOT EXISTS document_file_hash VARCHAR(128),
  ADD COLUMN IF NOT EXISTS document_file_size BIGINT,
  ADD COLUMN IF NOT EXISTS document_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS storage_status VARCHAR(30) NOT NULL DEFAULT 'not_generated',
  ADD COLUMN IF NOT EXISTS storage_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_onboarding_consent_fk'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_onboarding_consent_fk
      FOREIGN KEY (onboarding_consent_id)
      REFERENCES consent_documents(consent_id)
      ON DELETE SET NULL;
  END IF;
END $$;

