-- 1. CLEANUP: Drop existing tables if they exist to avoid conflicts
DROP TABLE IF EXISTS asset_history CASCADE;
DROP TABLE IF EXISTS asset_borrow_records CASCADE;
DROP TABLE IF EXISTS hardware_assets CASCADE;
DROP TABLE IF EXISTS hardware_tickets CASCADE;
DROP TABLE IF EXISTS employee_consent CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS branches CASCADE;
DROP TABLE IF EXISTS system_roles CASCADE;

-- 2. SYSTEM ROLES TABLE (For your Administrative Tiers)
CREATE TABLE system_roles (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE,
    clearance_level INT NOT NULL,
    description TEXT
);

-- 3. BRANCHES TABLE (For branch-aware asset and user access)
CREATE TABLE branches (
    branch_id SERIAL PRIMARY KEY,
    branch_name VARCHAR(150) NOT NULL,
    branch_location VARCHAR(255),
    is_headquarters BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. USERS TABLE (Multi-Tenant Management Accounts)
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role_id INT REFERENCES system_roles(role_id) ON DELETE SET NULL,
    company_name VARCHAR(100) NOT NULL,
    branch_id INTEGER REFERENCES branches(branch_id),
    mobile_number VARCHAR(20),
    status VARCHAR(20) DEFAULT 'Active',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. HARDWARE ASSETS TABLE (For your Asset Showcase & Lifecycle)
CREATE TABLE hardware_assets (
    asset_id SERIAL PRIMARY KEY,
    asset_name VARCHAR(255) NOT NULL,
    asset_type VARCHAR(100) NOT NULL,
    brand VARCHAR(100),
    model VARCHAR(150),
    serial_number VARCHAR(150) NOT NULL UNIQUE,
    asset_tag VARCHAR(150) UNIQUE,
    branch_id INTEGER REFERENCES branches(branch_id),
    status VARCHAR(50) NOT NULL DEFAULT 'Active',
    purchase_date DATE,
    warranty_expiration DATE,
    borrower_name VARCHAR(150),
    employee_id VARCHAR(100),
    borrower_department VARCHAR(100),
    borrow_date DATE,
    expected_return_date DATE,
    actual_return_date DATE,
    condition_before TEXT,
    condition_after TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. ASSET BORROW RECORDS TABLE (To capture borrower lifecycle history)
CREATE TABLE asset_borrow_records (
    record_id SERIAL PRIMARY KEY,
    asset_id INTEGER REFERENCES hardware_assets(asset_id) ON DELETE CASCADE,
    borrower_name VARCHAR(150),
    employee_id VARCHAR(100),
    borrower_department VARCHAR(100),
    borrow_date DATE,
    expected_return_date DATE,
    actual_return_date DATE,
    condition_before TEXT,
    condition_after TEXT,
    notes TEXT,
    status_from VARCHAR(50),
    status_to VARCHAR(50),
    branch_id INTEGER REFERENCES branches(branch_id),
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. ASSET HISTORY TABLE (For audit and lifecycle events)
CREATE TABLE asset_history (
    history_id SERIAL PRIMARY KEY,
    asset_id INTEGER REFERENCES hardware_assets(asset_id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    event_data JSONB,
    branch_id INTEGER REFERENCES branches(branch_id),
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. HARDWARE TICKETS TABLE (Legacy service desk incidents)
CREATE TABLE hardware_tickets (
    ticket_id SERIAL PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    description TEXT,
    priority VARCHAR(20) DEFAULT 'Medium',
    status VARCHAR(20) DEFAULT 'Open',
    asset_id INT REFERENCES hardware_assets(asset_id) ON DELETE CASCADE,
    raised_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. EMPLOYEE PRIVACY CONSENT TABLE (For your RA 10173 Compliance Portal)
CREATE TABLE employee_consent (
    consent_id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
    app_tracking_allowed BOOLEAN DEFAULT FALSE,
    web_logging_allowed BOOLEAN DEFAULT FALSE,
    screenshot_capture_allowed BOOLEAN DEFAULT FALSE,
    usb_dlp_allowed BOOLEAN DEFAULT FALSE,
    signature_base64 TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);