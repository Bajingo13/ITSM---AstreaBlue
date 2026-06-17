-- 1. SEED SYSTEM ROLES (For access tier management)
INSERT INTO system_roles (role_name, clearance_level, description) VALUES
('Company Admin', 100, 'Full infrastructure and privacy control visibility'),
('Client Admin', 80, 'Manages specific client corporate asset groups'),
('Company User', 40, 'Standard employee view with privacy control toggles'),
('Client User', 20, 'Restricted contractor or vendor view access');

-- 2. SEED A SYSTEM USER (Let's create a test account)
-- Note: Using a placeholder hash for development testing
INSERT INTO users (full_name, email, password_hash, role_id, company_name) VALUES
('Ken Patrick Gaa', 'ken.gaa@astrea.blue', '$2b$10$xyzPlaceholderHashForDevTestingOnly', 1, 'Astrea Blue HQ');

-- 3. SEED HARDWARE ASSETS (For your Module 2 Brand Showcase)
INSERT INTO hardware_assets (serial_number, brand, model_name, assigned_to, status, purchase_date, specs) VALUES
('APL99281X', 'Apple', 'MacBook Pro M3', 1, 'Active', '2025-01-15', '{"processor": "M3 Pro", "ram": "18GB", "storage": "512GB SSD"}'),
('DLL55120M', 'Dell', 'XPS 15 9530', 1, 'Active', '2025-03-10', '{"processor": "Intel i7", "ram": "32GB", "storage": "1TB SSD"}'),
('LNV33491L', 'Lenovo', 'ThinkPad X1 Carbon', NULL, 'Maintenance', '2024-11-01', '{"processor": "Intel i5", "ram": "16GB", "storage": "256GB SSD"}');

-- 4. SEED OPERATIONAL INCIDENTS (For your Module 1 & 5 3-Column Service Desk)
INSERT INTO hardware_tickets (title, description, priority, status, asset_id, raised_by) VALUES
('Swollen Battery Warning', 'The lower chassis cover is warping and expanding due to battery degradation.', 'Critical', 'Open', 2, 1),
('OS Profile Sync Failure', 'User cannot authenticate profile credentials with network share paths.', 'Medium', 'In Progress', 1, 1);

-- 5. SEED PRIVACY SETTINGS (For your Module 8 RA 10173 Compliance Portal)
INSERT INTO employee_consent (user_id, app_tracking_allowed, web_logging_allowed, screenshot_capture_allowed, usb_dlp_allowed, signature_base64) VALUES
(1, true, false, false, true, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...');