-- 2026-07-07: Add employee_number and department to users table for RA 10173 consent

ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_number VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(255);
