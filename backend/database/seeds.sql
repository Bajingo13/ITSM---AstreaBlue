-- 1. SEED SYSTEM ROLES (For access tier management)
INSERT INTO system_roles (role_name, clearance_level, description)
SELECT * FROM (VALUES
  ('SuperAdmin', 100, 'Full system administrator with cross-branch privileges'),
  ('Admin', 80, 'Branch administrator with branch-scoped visibility'),
  ('Technician', 60, 'Support technician for handling asset and ticket operations'),
  ('Employee', 40, 'Regular employee with branch-level access')
) AS vals(role_name, clearance_level, description)
WHERE NOT EXISTS (
  SELECT 1 FROM system_roles sr WHERE LOWER(sr.role_name) = LOWER(vals.role_name)
);

-- 2. SEED BRANCHES (For branch-aware asset inventory)
INSERT INTO branches (branch_name, branch_location, is_headquarters, is_active)
SELECT * FROM (VALUES
  ('Manila HQ', 'Metro Manila, Philippines', TRUE, TRUE),
  ('Cebu Branch', 'Cebu City, Philippines', FALSE, TRUE),
  ('Clark Branch', 'Clark Freeport Zone, Philippines', FALSE, TRUE)
) AS vals(branch_name, branch_location, is_headquarters, is_active)
WHERE NOT EXISTS (
  SELECT 1 FROM branches b WHERE LOWER(b.branch_name) = LOWER(vals.branch_name)
);

-- 3. SEED USERS (Build test users across roles and branches)
INSERT INTO users (full_name, email, password_hash, role_id, company_name, branch_id, mobile_number, status, is_active)
SELECT * FROM (VALUES
  ('Super Administrator', 'superadmin@astreablue.com', 'superadmin123', 'SuperAdmin', 'AstreaBlue', NULL, '09170000001', 'Active', TRUE),
  ('Manila Admin', 'manila.admin@astreablue.com', 'admin123', 'Admin', 'AstreaBlue', 'Manila HQ', '09170000002', 'Active', TRUE),
  ('Cebu Technician', 'cebu.tech@astreablue.com', 'tech123', 'Technician', 'AstreaBlue', 'Cebu Branch', '09170000003', 'Active', TRUE),
  ('Office Employee', 'employee@astreablue.com', 'employee123', 'Employee', 'AstreaBlue', 'Manila HQ', '09170000004', 'Active', TRUE)
) AS vals(full_name, email, password_hash, role_name, company_name, branch_name, mobile_number, status, is_active)
WHERE NOT EXISTS (
  SELECT 1 FROM users u WHERE LOWER(u.email) = LOWER(vals.email)
)
RETURNING full_name;

-- 4. SEED HARDWARE ASSETS (Branch-scoped inventory with lifecycle statuses)
WITH branch_ids AS (
  SELECT branch_name, branch_id FROM branches
),
asset_data AS (
  SELECT * FROM (VALUES
    ('MacBook Pro M3', 'Laptop', 'Apple', 'MacBook Pro M3', 'APL99281X', 'ASSET-001', 'Manila HQ', 'Active', '2025-01-15', '2028-01-15', NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::DATE, NULL::DATE, NULL::DATE, NULL::TEXT, NULL::TEXT, 'Primary executive laptop for Manila HQ.'),
    ('XPS 15 9530', 'Laptop', 'Dell', 'XPS 15 9530', 'DLL55120M', 'ASSET-002', 'Manila HQ', 'Borrowed', '2025-03-10', '2028-03-10', 'Maria Santos', 'EMP-0092', 'Finance', '2026-06-01', '2026-06-29', NULL::DATE, 'Good', NULL::TEXT, 'Loaned for temporary remote work.'),
    ('ThinkPad X1 Carbon', 'Laptop', 'Lenovo', 'ThinkPad X1 Carbon', 'LNV33491L', 'ASSET-003', 'Cebu Branch', 'In Repair', '2024-11-01', '2026-11-01', NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::DATE, NULL::DATE, NULL::DATE, NULL::TEXT, NULL::TEXT, 'Under service at Cebu branch.'),
    ('Galaxy S24', 'Phone', 'Samsung', 'Galaxy S24', 'PHN77525P', 'ASSET-004', 'Clark Branch', 'Retired', '2023-08-10', '2024-08-10', NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::DATE, NULL::DATE, NULL::DATE, NULL::TEXT, NULL::TEXT, 'Retired mobile device from Clark Branch.')
  ) AS vals(asset_name, asset_type, brand, model, serial_number, asset_tag, branch_name, status, purchase_date, warranty_expiration, borrower_name, employee_id, borrower_department, borrow_date, expected_return_date, actual_return_date, condition_before, condition_after, notes)
)
INSERT INTO hardware_assets (
  asset_name,
  asset_type,
  brand,
  model,
  serial_number,
  asset_tag,
  branch_id,
  status,
  purchase_date,
  warranty_expiration,
  borrower_name,
  employee_id,
  borrower_department,
  borrow_date,
  expected_return_date,
  actual_return_date,
  condition_before,
  condition_after,
  notes
)
SELECT
  ad.asset_name,
  ad.asset_type,
  ad.brand,
  ad.model,
  ad.serial_number,
  ad.asset_tag,
  bi.branch_id,
  ad.status,
  ad.purchase_date,
  ad.warranty_expiration,
  ad.borrower_name,
  ad.employee_id,
  ad.borrower_department,
  ad.borrow_date,
  ad.expected_return_date,
  ad.actual_return_date,
  ad.condition_before,
  ad.condition_after,
  ad.notes
FROM asset_data ad
JOIN branch_ids bi ON bi.branch_name = ad.branch_name
WHERE NOT EXISTS (
  SELECT 1 FROM hardware_assets ha WHERE ha.serial_number = ad.serial_number
);

-- 5. SEED ASSET BORROW RECORDS (Track borrow lifecycle for borrowed assets)
WITH asset_ref AS (
  SELECT asset_id FROM hardware_assets WHERE serial_number = 'DLL55120M' LIMIT 1
),
branch_ref AS (
  SELECT branch_id FROM branches WHERE branch_name = 'Manila HQ' LIMIT 1
),
user_ref AS (
  SELECT user_id FROM users WHERE LOWER(email) = LOWER('cebu.tech@astreablue.com') LIMIT 1
)
INSERT INTO asset_borrow_records (
  asset_id,
  borrower_name,
  employee_id,
  borrower_department,
  borrow_date,
  expected_return_date,
  actual_return_date,
  condition_before,
  condition_after,
  notes,
  status_from,
  status_to,
  branch_id,
  created_by
)
SELECT
  ar.asset_id,
  'Maria Santos',
  'EMP-0092',
  'Finance',
  '2026-06-01',
  '2026-06-29',
  NULL,
  'Good',
  NULL,
  'Loaned for temporary remote work.',
  'Active',
  'Borrowed',
  br.branch_id,
  ur.user_id
FROM asset_ref ar, branch_ref br, user_ref ur
WHERE NOT EXISTS (
  SELECT 1 FROM asset_borrow_records abr WHERE abr.asset_id = ar.asset_id AND abr.status_to = 'Borrowed'
);

-- 6. SEED ASSET HISTORY (Audit trail for new assets and status changes)
WITH existing_assets AS (
  SELECT asset_id, serial_number FROM hardware_assets WHERE serial_number IN ('APL99281X', 'DLL55120M')
),
created_by_user AS (
  SELECT user_id FROM users WHERE LOWER(email) = LOWER('cebu.tech@astreablue.com') LIMIT 1
),
branch_ref AS (
  SELECT branch_id FROM branches WHERE branch_name = 'Manila HQ' LIMIT 1
)
INSERT INTO asset_history (asset_id, event_type, event_data, branch_id, created_by)
SELECT
  ea.asset_id,
  CASE ea.serial_number
    WHEN 'APL99281X' THEN 'Asset Created'
    WHEN 'DLL55120M' THEN 'Asset Created'
  END,
  CASE ea.serial_number
    WHEN 'APL99281X' THEN '{"status": "Active", "branch_id": 1}'
    WHEN 'DLL55120M' THEN '{"status": "Borrowed", "branch_id": 1}'
  END::jsonb,
  br.branch_id,
  cb.user_id
FROM existing_assets ea, branch_ref br, created_by_user cb
WHERE NOT EXISTS (
  SELECT 1 FROM asset_history ah WHERE ah.asset_id = ea.asset_id AND ah.event_type = 'Asset Created'
);

INSERT INTO asset_history (asset_id, event_type, event_data, branch_id, created_by)
SELECT
  ha.asset_id,
  'Status Change',
  '{"from":"Active","to":"Borrowed","borrower_name":"Maria Santos"}'::jsonb,
  br.branch_id,
  cb.user_id
FROM hardware_assets ha
JOIN branch_ref br ON TRUE
JOIN created_by_user cb ON TRUE
WHERE ha.serial_number = 'DLL55120M'
  AND NOT EXISTS (
    SELECT 1 FROM asset_history ah WHERE ah.asset_id = ha.asset_id AND ah.event_type = 'Status Change' AND ah.event_data->>'to' = 'Borrowed'
);

-- 7. SEED PRIVACY SETTINGS (For your RA 10173 Compliance Portal)
INSERT INTO employee_consent (user_id, app_tracking_allowed, web_logging_allowed, screenshot_capture_allowed, usb_dlp_allowed, signature_base64)
SELECT u.user_id, true, false, false, true, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...'
FROM users u
WHERE LOWER(u.email) = LOWER('superadmin@astreablue.com')
  AND NOT EXISTS (
    SELECT 1 FROM employee_consent ec WHERE ec.user_id = u.user_id
);