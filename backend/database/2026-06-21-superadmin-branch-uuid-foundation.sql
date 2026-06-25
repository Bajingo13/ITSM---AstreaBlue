-- SuperAdmin + Branch Visibility Foundation
-- Safe, non-destructive migration notes for deployments that are ready to move
-- branch identifiers to UUIDs. The current application may already use integer
-- branch_id values, so do not run the UUID conversion section blindly on a
-- database with existing branch/user/ticket data.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS branches (
  branch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_code VARCHAR(10) UNIQUE NOT NULL,
  branch_name VARCHAR(200) NOT NULL,
  region VARCHAR(50),
  province VARCHAR(100),
  city_municipality VARCHAR(100),
  barangay VARCHAR(100),
  zip_code VARCHAR(4),
  address_line TEXT,
  contact_number VARCHAR(20),
  is_headquarters BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS branch_code VARCHAR(10),
  ADD COLUMN IF NOT EXISTS region VARCHAR(50),
  ADD COLUMN IF NOT EXISTS province VARCHAR(100),
  ADD COLUMN IF NOT EXISTS city_municipality VARCHAR(100),
  ADD COLUMN IF NOT EXISTS barangay VARCHAR(100),
  ADD COLUMN IF NOT EXISTS zip_code VARCHAR(4),
  ADD COLUMN IF NOT EXISTS address_line TEXT,
  ADD COLUMN IF NOT EXISTS contact_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS is_headquarters BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- If your existing branches.branch_id is already UUID, these are safe:
-- ALTER TABLE users
--   ADD COLUMN IF NOT EXISTS branch_id UUID NULL REFERENCES branches(branch_id);
--
-- ALTER TABLE tickets
--   ADD COLUMN IF NOT EXISTS branch_id UUID NULL REFERENCES branches(branch_id);
--
-- If your existing branches.branch_id is INTEGER, create a planned data
-- migration first instead of altering users/tickets directly, because foreign
-- keys and existing ticket ownership must be remapped carefully.

INSERT INTO system_roles (role_name)
SELECT role_name
FROM (VALUES
  ('SuperAdmin'),
  ('Admin'),
  ('Technician'),
  ('Employee')
) AS required_roles(role_name)
WHERE NOT EXISTS (
  SELECT 1
  FROM system_roles sr
  WHERE LOWER(sr.role_name) = LOWER(required_roles.role_name)
);
