CREATE TABLE IF NOT EXISTS branches (
  branch_id SERIAL PRIMARY KEY,
  branch_code VARCHAR(50),
  branch_name VARCHAR(150) NOT NULL,
  region VARCHAR(100),
  province VARCHAR(100),
  city_municipality VARCHAR(150),
  branch_location VARCHAR(255),
  is_headquarters BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS branch_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS region VARCHAR(100),
  ADD COLUMN IF NOT EXISTS province VARCHAR(100),
  ADD COLUMN IF NOT EXISTS city_municipality VARCHAR(150),
  ADD COLUMN IF NOT EXISTS is_headquarters BOOLEAN DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS mobile_number VARCHAR(20);

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id);

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

INSERT INTO users
(full_name, email, password_hash, role_id, company_name, status, is_active)
SELECT
  'Super Administrator',
  'superadmin@astreablue.com',
  'superadmin123',
  sr.role_id,
  'AstreaBlue',
  'Active',
  TRUE
FROM system_roles sr
WHERE LOWER(sr.role_name) = 'superadmin'
  AND NOT EXISTS (
    SELECT 1
    FROM users u
    WHERE LOWER(u.email) = 'superadmin@astreablue.com'
  )
LIMIT 1;

CREATE TABLE IF NOT EXISTS ticket_attachments (
  attachment_id SERIAL PRIMARY KEY,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  file_name VARCHAR(255),
  file_path TEXT,
  file_size INTEGER,
  mime_type VARCHAR(100),
  uploaded_by INTEGER REFERENCES users(user_id),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE ticket_attachments
  ADD COLUMN IF NOT EXISTS file_path TEXT,
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'ticket_attachments'
      AND column_name = 'file_data'
  ) THEN
    ALTER TABLE ticket_attachments ALTER COLUMN file_data DROP NOT NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_invites (
  invite_id SERIAL PRIMARY KEY,
  token VARCHAR(120) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  role_id INTEGER REFERENCES system_roles(role_id),
  branch_id INTEGER REFERENCES branches(branch_id),
  company_name VARCHAR(255),
  mobile_number VARCHAR(20),
  invited_by INTEGER REFERENCES users(user_id),
  accepted_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
