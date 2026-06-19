CREATE TABLE IF NOT EXISTS branches (
  branch_id SERIAL PRIMARY KEY,
  branch_name VARCHAR(150) NOT NULL,
  branch_location VARCHAR(255),
  is_headquarters BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS is_headquarters BOOLEAN DEFAULT FALSE;

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

CREATE TABLE IF NOT EXISTS ticket_attachments (
  attachment_id SERIAL PRIMARY KEY,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  uploaded_by INTEGER REFERENCES users(user_id),
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(100),
  file_size INTEGER,
  file_data TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
