ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP NULL;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_failed_login_attempts_nonnegative;

ALTER TABLE users
  ADD CONSTRAINT users_failed_login_attempts_nonnegative
  CHECK (failed_login_attempts >= 0);

CREATE INDEX IF NOT EXISTS users_locked_until_idx
  ON users (locked_until)
  WHERE locked_until IS NOT NULL;
