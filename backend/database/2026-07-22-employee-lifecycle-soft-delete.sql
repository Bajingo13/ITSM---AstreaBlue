-- Preserve lifecycle audit records while allowing SuperAdmin to remove erroneous
-- non-completed cases from the active workspace.
ALTER TABLE employee_lifecycle_cases
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

CREATE INDEX IF NOT EXISTS employee_lifecycle_visible_cases_idx
  ON employee_lifecycle_cases(branch_id, updated_at DESC)
  WHERE deleted_at IS NULL;
