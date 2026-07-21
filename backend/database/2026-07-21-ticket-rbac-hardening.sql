-- Durable ticket sensitivity classification used by server-side RBAC.
-- External API ticket isolation remains based on integration ownership and is
-- intentionally independent from this internal category classification.

ALTER TABLE ticket_categories
  ADD COLUMN IF NOT EXISTS visibility_scope VARCHAR(30) NOT NULL DEFAULT 'standard';

UPDATE ticket_categories
SET visibility_scope = 'sensitive'
WHERE LOWER(REGEXP_REPLACE(TRIM(category_name), '[[:space:]_/\\-]+', ' ', 'g')) IN (
  'consent privacy request',
  'privacy request',
  'role change request'
);

CREATE INDEX IF NOT EXISTS ticket_categories_visibility_scope_idx
  ON ticket_categories(visibility_scope);
