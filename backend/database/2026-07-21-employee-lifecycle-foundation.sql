-- Employee lifecycle foundation (Onboarding and Offboarding)
-- This migration intentionally does not alter monitored_devices, device credentials,
-- consent_documents, or endpoint policy tables.

INSERT INTO system_roles (role_name, clearance_level, description)
SELECT 'HR', 70, 'Human Resources lifecycle coordinator with branch-scoped onboarding and offboarding oversight'
WHERE NOT EXISTS (
  SELECT 1 FROM system_roles WHERE LOWER(role_name) = 'hr'
);

CREATE TABLE IF NOT EXISTS employee_lifecycle_cases (
  lifecycle_case_id BIGSERIAL PRIMARY KEY,
  case_number VARCHAR(40) NOT NULL UNIQUE,
  lifecycle_type VARCHAR(20) NOT NULL CHECK (lifecycle_type IN ('Onboarding', 'Offboarding')),
  employee_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE RESTRICT,
  related_ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'Draft',
  target_date DATE,
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  verified_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN (
    'Draft', 'In Progress', 'Awaiting Employee', 'Awaiting IT',
    'Ready for Verification', 'Completed', 'Cancelled'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS employee_lifecycle_one_open_type_idx
  ON employee_lifecycle_cases(employee_id, lifecycle_type)
  WHERE status NOT IN ('Completed', 'Cancelled');

CREATE INDEX IF NOT EXISTS employee_lifecycle_branch_status_idx
  ON employee_lifecycle_cases(branch_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS employee_lifecycle_employee_idx
  ON employee_lifecycle_cases(employee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS employee_lifecycle_tasks (
  lifecycle_task_id BIGSERIAL PRIMARY KEY,
  lifecycle_case_id BIGINT NOT NULL REFERENCES employee_lifecycle_cases(lifecycle_case_id) ON DELETE CASCADE,
  task_key VARCHAR(80) NOT NULL,
  task_label VARCHAR(255) NOT NULL,
  task_description TEXT,
  assigned_role VARCHAR(30) NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed', 'Not Applicable')),
  completed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  completion_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (lifecycle_case_id, task_key)
);

CREATE INDEX IF NOT EXISTS employee_lifecycle_tasks_case_idx
  ON employee_lifecycle_tasks(lifecycle_case_id, sort_order);

CREATE TABLE IF NOT EXISTS employee_lifecycle_history (
  lifecycle_history_id BIGSERIAL PRIMARY KEY,
  lifecycle_case_id BIGINT NOT NULL REFERENCES employee_lifecycle_cases(lifecycle_case_id) ON DELETE CASCADE,
  event_type VARCHAR(60) NOT NULL,
  previous_status VARCHAR(40),
  new_status VARCHAR(40),
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS employee_lifecycle_history_case_idx
  ON employee_lifecycle_history(lifecycle_case_id, created_at DESC);
