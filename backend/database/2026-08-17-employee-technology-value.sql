-- Connect software entitlements to employees, assigned assets, and lifecycle cases.
ALTER TABLE software_license_assignments
  ADD COLUMN IF NOT EXISTS asset_id INTEGER REFERENCES hardware_assets(asset_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_case_id BIGINT REFERENCES employee_lifecycle_cases(lifecycle_case_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS annual_cost_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seat_annual_cost_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0;

UPDATE software_license_assignments assignment
SET annual_cost_snapshot = license.annual_cost,
    seat_annual_cost_snapshot = CASE
      WHEN license.total_licenses > 0 THEN ROUND(license.annual_cost / license.total_licenses, 2)
      ELSE 0
    END
FROM software_licenses license
WHERE license.license_id = assignment.license_id
  AND assignment.annual_cost_snapshot = 0
  AND assignment.seat_annual_cost_snapshot = 0;

CREATE INDEX IF NOT EXISTS software_license_assignments_asset_status_idx
  ON software_license_assignments(asset_id, status);

CREATE INDEX IF NOT EXISTS software_license_assignments_case_idx
  ON software_license_assignments(lifecycle_case_id, created_at DESC);

-- Add the structured license-assignment step to active onboarding cases created
-- before this migration. Completed historical cases remain unchanged.
UPDATE employee_lifecycle_tasks task
SET sort_order = CASE task.task_key
  WHEN 'verify_endpoint' THEN 90
  WHEN 'final_verification' THEN 100
  ELSE task.sort_order
END
FROM employee_lifecycle_cases lifecycle_case
WHERE lifecycle_case.lifecycle_case_id = task.lifecycle_case_id
  AND lifecycle_case.lifecycle_type = 'Onboarding'
  AND lifecycle_case.status NOT IN ('Completed', 'Cancelled')
  AND task.task_key IN ('verify_endpoint', 'final_verification');

INSERT INTO employee_lifecycle_tasks
  (lifecycle_case_id, task_key, task_label, task_description, assigned_role, is_required, sort_order)
SELECT lifecycle_case_id,
       'assign_licenses',
       'Assign software licenses',
       'Assign branch-authorized software seats to the employee and their managed asset.',
       'IT',
       TRUE,
       80
FROM employee_lifecycle_cases lifecycle_case
WHERE lifecycle_case.lifecycle_type = 'Onboarding'
  AND lifecycle_case.status NOT IN ('Completed', 'Cancelled')
  AND lifecycle_case.deleted_at IS NULL
ON CONFLICT (lifecycle_case_id, task_key) DO NOTHING;
