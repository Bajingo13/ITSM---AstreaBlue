-- 1. CLEANUP: Drop existing tables if they exist to avoid conflicts
DROP TABLE IF EXISTS employee_consent CASCADE;
DROP TABLE IF EXISTS hardware_tickets CASCADE;
DROP TABLE IF EXISTS hardware_assets CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS system_roles CASCADE;

-- 2. SYSTEM ROLES TABLE (For your Administrative Tiers)
CREATE TABLE system_roles (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE,
    clearance_level INT NOT NULL,
    description TEXT
);

-- 3. USERS TABLE (Multi-Tenant Management Accounts)
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role_id INT REFERENCES system_roles(role_id) ON DELETE SET NULL,
    company_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. HARDWARE ASSETS TABLE (For your Asset Showcase & Lifecycle)
CREATE TABLE hardware_assets (
    asset_id SERIAL PRIMARY KEY,
    serial_number VARCHAR(100) NOT NULL UNIQUE,
    brand VARCHAR(50) NOT NULL,        -- Apple, Dell, Lenovo
    model_name VARCHAR(100) NOT NULL,
    assigned_to INT REFERENCES users(user_id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'Active', -- Active, Maintenance, Retired
    purchase_date DATE,
    specs JSONB                         -- Holds processor, RAM details dynamically
);

-- 5. HARDWARE TICKETS TABLE (For your 3-Column Service Desk Board)
CREATE TABLE hardware_tickets (
    ticket_id SERIAL PRIMARY KEY,
    title VARCHAR(150) NOT NULL,       -- e.g., "Swollen Battery Warning"
    description TEXT,
    priority VARCHAR(20) DEFAULT 'Medium', -- Low, Medium, High, Critical
    status VARCHAR(20) DEFAULT 'Open',     -- Open, In Progress, Resolved
    asset_id INT REFERENCES hardware_assets(asset_id) ON DELETE CASCADE,
    raised_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. EMPLOYEE PRIVACY CONSENT TABLE (For your RA 10173 Compliance Portal)
CREATE TABLE employee_consent (
    consent_id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
    app_tracking_allowed BOOLEAN DEFAULT FALSE,
    web_logging_allowed BOOLEAN DEFAULT FALSE,
    screenshot_capture_allowed BOOLEAN DEFAULT FALSE,
    usb_dlp_allowed BOOLEAN DEFAULT FALSE,
    signature_base64 TEXT,                -- Stores the electronic signature canvas data
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);