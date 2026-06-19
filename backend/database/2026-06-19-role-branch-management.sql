CREATE TABLE IF NOT EXISTS branches (
  branch_id SERIAL PRIMARY KEY,
  branch_name VARCHAR(150) NOT NULL,
  branch_location VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS mobile_number VARCHAR(20);

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
