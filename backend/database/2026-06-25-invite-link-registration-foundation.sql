ALTER TABLE users
ADD COLUMN IF NOT EXISTS personal_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS company_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS invite_token VARCHAR(120),
ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS invite_used_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS invite_status VARCHAR(20);

CREATE TABLE IF NOT EXISTS user_invites (
  invite_id SERIAL PRIMARY KEY,
  token VARCHAR(120) UNIQUE NOT NULL,
  email VARCHAR(255),
  personal_email VARCHAR(255),
  company_email VARCHAR(255),
  full_name VARCHAR(255),
  role_id INTEGER REFERENCES system_roles(role_id),
  branch_id INTEGER REFERENCES branches(branch_id),
  company_name VARCHAR(255),
  mobile_number VARCHAR(20),
  invited_by INTEGER REFERENCES users(user_id),
  accepted_at TIMESTAMP,
  expires_at TIMESTAMP,
  invite_used_at TIMESTAMP,
  invite_status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE user_invites
ADD COLUMN IF NOT EXISTS email VARCHAR(255),
ADD COLUMN IF NOT EXISTS personal_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS company_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS invite_used_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS invite_status VARCHAR(20) DEFAULT 'pending';
