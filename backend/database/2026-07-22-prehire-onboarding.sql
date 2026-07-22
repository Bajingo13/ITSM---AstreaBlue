-- Phase 2: true pre-hire onboarding.
-- This migration only extends employee lifecycle and user-linking metadata.
-- It intentionally does not alter monitored devices, credentials, consent, or policies.

ALTER TABLE employee_lifecycle_cases
  ALTER COLUMN employee_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS subject_full_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS subject_contact_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS subject_employee_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS subject_department VARCHAR(255),
  ADD COLUMN IF NOT EXISTS subject_job_title VARCHAR(255),
  ADD COLUMN IF NOT EXISTS subject_start_date DATE,
  ADD COLUMN IF NOT EXISTS account_provisioned_at TIMESTAMPTZ;

UPDATE employee_lifecycle_cases lc
   SET subject_full_name = COALESCE(lc.subject_full_name, u.full_name),
       subject_contact_email = COALESCE(lc.subject_contact_email, u.personal_email, u.email),
       subject_employee_number = COALESCE(lc.subject_employee_number, u.employee_number),
       subject_department = COALESCE(lc.subject_department, u.department)
  FROM users u
 WHERE u.user_id = lc.employee_id;

ALTER TABLE employee_lifecycle_cases
  DROP CONSTRAINT IF EXISTS employee_lifecycle_subject_required_chk;

ALTER TABLE employee_lifecycle_cases
  ADD CONSTRAINT employee_lifecycle_subject_required_chk CHECK (
    employee_id IS NOT NULL
    OR (
      lifecycle_type = 'Onboarding'
      AND NULLIF(BTRIM(subject_full_name), '') IS NOT NULL
    )
  );

CREATE INDEX IF NOT EXISTS employee_lifecycle_pre_hire_lookup_idx
  ON employee_lifecycle_cases(branch_id, LOWER(subject_full_name), subject_start_date)
  WHERE employee_id IS NULL AND status NOT IN ('Completed', 'Cancelled');
