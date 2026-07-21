-- AstreaBlue-only offboarding automation.
-- No external HRIS, mail provider, VPN, cloud, or identity-provider calls are made.

ALTER TABLE employee_lifecycle_tasks
  ADD COLUMN IF NOT EXISTS automation_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS automation_completed_at TIMESTAMPTZ;

ALTER TABLE hardware_assets
  ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES users(user_id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS software_licenses (
  license_id SERIAL PRIMARY KEY,
  license_name VARCHAR(255) NOT NULL,
  vendor VARCHAR(255) NOT NULL,
  license_type VARCHAR(50) NOT NULL CHECK (license_type IN ('Subscription', 'Annual', 'Perpetual')),
  total_licenses INTEGER NOT NULL DEFAULT 0,
  used_licenses INTEGER NOT NULL DEFAULT 0,
  expiry_date DATE,
  annual_cost NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Expiring Soon', 'Expired', 'Available')),
  branch_id INTEGER REFERENCES branches(branch_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS software_license_assignments (
  assignment_id BIGSERIAL PRIMARY KEY,
  license_id INTEGER NOT NULL REFERENCES software_licenses(license_id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Released')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMPTZ,
  released_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  release_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS software_license_assignments_user_status_idx
  ON software_license_assignments(user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS software_license_one_active_user_idx
  ON software_license_assignments(license_id, user_id)
  WHERE status = 'Active';
