-- License assignment remains available in the onboarding technology panel, but
-- it is not a required checklist gate. Preserve closed cases as audit records.
DELETE FROM employee_lifecycle_tasks task
USING employee_lifecycle_cases lifecycle_case
WHERE task.lifecycle_case_id = lifecycle_case.lifecycle_case_id
  AND task.task_key = 'assign_licenses'
  AND lifecycle_case.lifecycle_type = 'Onboarding'
  AND lifecycle_case.status NOT IN ('Completed', 'Cancelled');
