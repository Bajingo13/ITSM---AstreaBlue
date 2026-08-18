-- Keep onboarding task ownership aligned with the RBAC enforced by the API.
UPDATE employee_lifecycle_tasks
SET assigned_role = 'Admin',
    updated_at = CURRENT_TIMESTAMP
WHERE task_key = 'assign_licenses'
  AND assigned_role = 'IT';
