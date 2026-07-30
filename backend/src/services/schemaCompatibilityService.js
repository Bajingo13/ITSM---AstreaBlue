const bcrypt = require("bcryptjs");
const db = require("../../config/db");
const softwareLicenseRepository = require("../repositories/softwareLicenseRepository");

async function ensureKnowledgeBaseTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS knowledge_base (
        kb_id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        tags TEXT,
        symptoms TEXT,
        resolution TEXT,
        branch_id INTEGER REFERENCES branches(branch_id),
        created_by INTEGER REFERENCES users(user_id),
        related_ticket_id INTEGER REFERENCES tickets(id),
        views INTEGER DEFAULT 0,
        helpful_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      ALTER TABLE knowledge_base
      ADD COLUMN IF NOT EXISTS tags TEXT,
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id),
      ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS helpful_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS publication_status VARCHAR(20) NOT NULL DEFAULT 'Published',
      ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ
    `);
  } catch (err) {
    console.error("Knowledge base table setup error:", err.message);
  }
}

async function ensureUserStatusColumn() {
  try {
    await db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active'
    `);
  } catch (err) {
    console.error("User status column setup error:", err.message);
  }
}

async function ensureTicketWorkflowColumns() {
  try {
    await db.query(`
      ALTER TABLE tickets
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id),
      ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS cancelled_by INTEGER REFERENCES users(user_id),
      ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
      ADD COLUMN IF NOT EXISTS sla_due_soon_notified_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS sla_breach_notification_sent_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS sla_breach_email_sent_at TIMESTAMP
    `);
  } catch (err) {
    console.error("Ticket workflow column setup error:", err.message);
  }
}

async function ensureRoleBranchManagement() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS branches (
        branch_id SERIAL PRIMARY KEY,
        branch_name VARCHAR(150) NOT NULL,
        branch_location VARCHAR(255),
        is_headquarters BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      ALTER TABLE branches
      ADD COLUMN IF NOT EXISTS is_headquarters BOOLEAN DEFAULT FALSE
    `);

    await db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id),
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS mobile_number VARCHAR(20)
    `);

    await db.query(`
      INSERT INTO system_roles (role_name, clearance_level, description)
      SELECT role_name, clearance_level, description
      FROM (VALUES
        ('SuperAdmin', 100, 'Full system administrator with cross-branch privileges'),
        ('Admin', 80, 'Branch administrator with branch-scoped visibility'),
        ('HR', 70, 'Human Resources lifecycle coordinator with branch-scoped onboarding and offboarding oversight'),
        ('Technician', 60, 'Support technician for handling asset and ticket operations'),
        ('Employee', 40, 'Regular employee with branch-level access')
      ) AS required_roles(role_name, clearance_level, description)
      WHERE NOT EXISTS (
        SELECT 1
        FROM system_roles sr
        WHERE LOWER(sr.role_name) = LOWER(required_roles.role_name)
      )
    `);

    const bootstrapPassword = String(process.env.BOOTSTRAP_SUPERADMIN_PASSWORD || "").trim();
    if (bootstrapPassword) {
      await db.query(`
        INSERT INTO users
        (full_name, email, password_hash, role_id, company_name, status, is_active)
        SELECT
          'Super Administrator',
          'superadmin@astreablue.com',
          $1,
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
        LIMIT 1
      `, [bcrypt.hashSync(bootstrapPassword, 12)]);
    }
  } catch (err) {
    console.error("Role/branch setup error:", err.message);
  }
}

async function ensureAttachmentsAndInvites() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ticket_attachments (
        attachment_id SERIAL PRIMARY KEY,
        ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
        file_name VARCHAR(255),
        file_path TEXT,
        file_size INTEGER,
        mime_type VARCHAR(100),
        uploaded_by INTEGER REFERENCES users(user_id),
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      ALTER TABLE ticket_attachments
      ADD COLUMN IF NOT EXISTS file_path TEXT,
      ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100),
      ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    await db.query(`
      ALTER TABLE ticket_attachments
      ALTER COLUMN file_data DROP NOT NULL
    `).catch(() => {});

    await db.query(`
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
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        reset_id SERIAL PRIMARY KEY,
        token VARCHAR(120) UNIQUE NOT NULL,
        user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(50) DEFAULT 'info',
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      ALTER TABLE notifications
      ADD COLUMN IF NOT EXISTS related_ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS related_entity_type VARCHAR(80),
      ADD COLUMN IF NOT EXISTS related_entity_id VARCHAR(120),
      ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    `);
  } catch (err) {
    console.error("Attachments/invites setup error:", err.message);
  }
}

async function ensureHardwareAssetTables() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS hardware_assets (
        asset_id SERIAL PRIMARY KEY,
        asset_name VARCHAR(255) NOT NULL,
        asset_type VARCHAR(100) NOT NULL,
        brand VARCHAR(100),
        manufacturer VARCHAR(100),
        model VARCHAR(150),
        serial_number VARCHAR(150) NOT NULL UNIQUE,
        asset_tag VARCHAR(150) UNIQUE,
        color VARCHAR(100),
        purchase_price NUMERIC(12,2),
        supplier VARCHAR(150),
        assigned_name VARCHAR(255),
        returned_name VARCHAR(255),
        warranty VARCHAR(100),
        condition_notes TEXT,
        team_department VARCHAR(100),
        assigned_date DATE,
        returned_date DATE,
        accessories TEXT,
        processor VARCHAR(150),
        ram VARCHAR(100),
        storage VARCHAR(150),
        signature_link TEXT,
        returned_name_forms VARCHAR(255),
        attachments JSONB,
        image_url TEXT,
        branch_id INTEGER REFERENCES branches(branch_id),
        status VARCHAR(50) NOT NULL DEFAULT 'Active',
        purchase_date DATE,
        warranty_expiration DATE,
        borrower_name VARCHAR(150),
        borrower_email VARCHAR(255),
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
      )
    `);

    await db.query(`
      ALTER TABLE hardware_assets
      ADD COLUMN IF NOT EXISTS asset_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS asset_type VARCHAR(100),
      ADD COLUMN IF NOT EXISTS model_name VARCHAR(100),
      ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(100),
      ADD COLUMN IF NOT EXISTS model VARCHAR(150),
      ADD COLUMN IF NOT EXISTS asset_tag VARCHAR(150),
      ADD COLUMN IF NOT EXISTS color VARCHAR(100),
      ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS supplier VARCHAR(150),
      ADD COLUMN IF NOT EXISTS assigned_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS returned_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS warranty VARCHAR(100),
      ADD COLUMN IF NOT EXISTS condition_notes TEXT,
      ADD COLUMN IF NOT EXISTS team_department VARCHAR(100),
      ADD COLUMN IF NOT EXISTS assigned_date DATE,
      ADD COLUMN IF NOT EXISTS returned_date DATE,
      ADD COLUMN IF NOT EXISTS accessories TEXT,
      ADD COLUMN IF NOT EXISTS processor VARCHAR(150),
      ADD COLUMN IF NOT EXISTS ram VARCHAR(100),
      ADD COLUMN IF NOT EXISTS storage VARCHAR(150),
      ADD COLUMN IF NOT EXISTS signature_link TEXT,
      ADD COLUMN IF NOT EXISTS returned_name_forms VARCHAR(255),
      ADD COLUMN IF NOT EXISTS attachments JSONB,
      ADD COLUMN IF NOT EXISTS image_url TEXT,
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id),
      ADD COLUMN IF NOT EXISTS location VARCHAR(255),
      ADD COLUMN IF NOT EXISTS department VARCHAR(100),
      ADD COLUMN IF NOT EXISTS warranty_expiration DATE,
      ADD COLUMN IF NOT EXISTS borrower_name VARCHAR(150),
      ADD COLUMN IF NOT EXISTS borrower_email VARCHAR(255),
      ADD COLUMN IF NOT EXISTS employee_id VARCHAR(100),
      ADD COLUMN IF NOT EXISTS borrower_department VARCHAR(100),
      ADD COLUMN IF NOT EXISTS borrow_date DATE,
      ADD COLUMN IF NOT EXISTS expected_return_date DATE,
      ADD COLUMN IF NOT EXISTS actual_return_date DATE,
      ADD COLUMN IF NOT EXISTS condition_before TEXT,
      ADD COLUMN IF NOT EXISTS condition_after TEXT,
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS vendor VARCHAR(150),
      ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(150),
      ADD COLUMN IF NOT EXISTS useful_life_months INTEGER,
      ADD COLUMN IF NOT EXISTS useful_life_years NUMERIC(6,2) DEFAULT 5,
      ADD COLUMN IF NOT EXISTS salvage_value NUMERIC(12,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS depreciation_method VARCHAR(50) DEFAULT 'Straight-Line',
      ADD COLUMN IF NOT EXISTS hostname VARCHAR(255),
      ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64),
      ADD COLUMN IF NOT EXISTS mac_address VARCHAR(32),
      ADD COLUMN IF NOT EXISTS operating_system VARCHAR(150),
      ADD COLUMN IF NOT EXISTS device_type VARCHAR(100),
      ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP,
      ADD COLUMN IF NOT EXISTS discovery_status VARCHAR(20),
      ADD COLUMN IF NOT EXISTS discovery_source VARCHAR(100),
      ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    await db.query(`
      UPDATE hardware_assets
      SET
        asset_name = COALESCE(asset_name, model, model_name, brand || ' Asset'),
        asset_type = COALESCE(asset_type, 'Other'),
        manufacturer = COALESCE(manufacturer, brand),
        model = COALESCE(model, model_name)
    `);

    await db.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'hardware_assets'
            AND column_name = 'model_name'
        ) THEN
          ALTER TABLE hardware_assets ALTER COLUMN model_name DROP NOT NULL;
        END IF;
      END $$;
    `);

    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS hardware_assets_asset_tag_unique
      ON hardware_assets (asset_tag)
      WHERE asset_tag IS NOT NULL
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS asset_borrow_records (
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
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS asset_history (
        history_id SERIAL PRIMARY KEY,
        asset_id INTEGER REFERENCES hardware_assets(asset_id) ON DELETE CASCADE,
        event_type VARCHAR(100) NOT NULL,
        event_data JSONB,
        branch_id INTEGER REFERENCES branches(branch_id),
        created_by INTEGER REFERENCES users(user_id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS asset_discovery_scans (
        scan_id BIGSERIAL PRIMARY KEY,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        duration_ms INTEGER,
        devices_found INTEGER NOT NULL DEFAULT 0,
        new_assets INTEGER NOT NULL DEFAULT 0,
        updated_assets INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(30) NOT NULL DEFAULT 'Running',
        branch_id INTEGER REFERENCES branches(branch_id),
        initiated_by INTEGER REFERENCES users(user_id),
        error_message TEXT
      )
    `);
    await db.query(`ALTER TABLE asset_discovery_scans ADD COLUMN IF NOT EXISTS source VARCHAR(100) DEFAULT 'Manual Import'`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS asset_financials (
        financial_id BIGSERIAL PRIMARY KEY,
        asset_id INTEGER NOT NULL UNIQUE REFERENCES hardware_assets(asset_id) ON DELETE CASCADE,
        useful_life_months INTEGER DEFAULT 36,
        useful_life_years NUMERIC(6,2) NOT NULL DEFAULT 3 CHECK (useful_life_years > 0),
        salvage_value NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
        depreciation_method VARCHAR(50) NOT NULL DEFAULT 'Straight-Line',
        depreciation_start_date DATE,
        disposal_value NUMERIC(12,2),
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`ALTER TABLE asset_financials ADD COLUMN IF NOT EXISTS useful_life_months INTEGER`);
    await db.query(`
      UPDATE asset_financials SET useful_life_months = GREATEST(1, ROUND(useful_life_years * 12)::INTEGER)
      WHERE useful_life_months IS NULL OR useful_life_months <= 0
    `);
    await db.query(`
      UPDATE hardware_assets SET useful_life_months = CASE
        WHEN useful_life_years IS NOT NULL AND useful_life_years > 0 THEN GREATEST(1, ROUND(useful_life_years * 12)::INTEGER)
        ELSE 36 END
      WHERE useful_life_months IS NULL OR useful_life_months <= 0
    `);
    await db.query(`ALTER TABLE asset_financials ALTER COLUMN useful_life_months SET DEFAULT 36`);
    await db.query(`ALTER TABLE hardware_assets ALTER COLUMN useful_life_months SET DEFAULT 36`);
    await db.query(`
      INSERT INTO asset_financials (asset_id,useful_life_months,useful_life_years,salvage_value,depreciation_method,depreciation_start_date)
      SELECT asset_id,COALESCE(useful_life_months,ROUND(useful_life_years * 12)::INTEGER,36),COALESCE(useful_life_years,3),COALESCE(salvage_value,0),COALESCE(depreciation_method,'Straight-Line'),purchase_date
      FROM hardware_assets ON CONFLICT (asset_id) DO NOTHING
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS asset_discoveries (
        discovery_id BIGSERIAL PRIMARY KEY,
        hostname VARCHAR(255) NOT NULL,
        ip_address VARCHAR(64), mac_address VARCHAR(32), serial_number VARCHAR(150), asset_tag VARCHAR(150),
        os_name VARCHAR(150), manufacturer VARCHAR(150), device_type VARCHAR(100),
        source VARCHAR(100) NOT NULL DEFAULT 'Manual',
        first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(30) NOT NULL DEFAULT 'Online',
        reconciliation_status VARCHAR(30) NOT NULL DEFAULT 'Unmanaged',
        matched_asset_id INTEGER REFERENCES hardware_assets(asset_id) ON DELETE SET NULL,
        branch_id INTEGER REFERENCES branches(branch_id), raw_data JSONB,
        created_by INTEGER REFERENCES users(user_id), updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS asset_types (
        asset_type_id SERIAL PRIMARY KEY,
        type_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS asset_types_type_name_ci_unique ON asset_types (LOWER(type_name))`);
    await db.query(`
      INSERT INTO asset_types (type_name)
      SELECT seed.type_name FROM (VALUES ('Laptop'),('Desktop'),('Printer'),('Phone'),('Monitor'),('Server'),('Network Device'),('Other')) seed(type_name)
      WHERE NOT EXISTS (SELECT 1 FROM asset_types existing WHERE LOWER(existing.type_name)=LOWER(seed.type_name))
    `);
    await db.query(`
      INSERT INTO asset_types (type_name)
      SELECT MIN(TRIM(asset_type)) FROM hardware_assets source
      WHERE NULLIF(TRIM(asset_type),'') IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM asset_types existing WHERE LOWER(existing.type_name)=LOWER(TRIM(source.asset_type)))
      GROUP BY LOWER(TRIM(asset_type))
    `);
    return true;
  } catch (err) {
    console.error("Hardware asset table setup error:", err.message);
    return false;
  }
}

async function ensureCmdbTables() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ci_categories (
        ci_category_id SERIAL PRIMARY KEY,
        category_name VARCHAR(100) NOT NULL UNIQUE,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS config_items (
        ci_id SERIAL PRIMARY KEY,
        ci_name VARCHAR(255) NOT NULL,
        ci_type VARCHAR(100) NOT NULL DEFAULT 'Server',
        category_id INTEGER REFERENCES ci_categories(ci_category_id) ON DELETE SET NULL,
        description TEXT,
        branch_id INTEGER REFERENCES branches(branch_id) ON DELETE CASCADE,
        environment VARCHAR(50) DEFAULT 'Production',
        ip_address VARCHAR(45),
        operating_system VARCHAR(100),
        owner VARCHAR(255),
        status VARCHAR(50) DEFAULT 'Active',
        version VARCHAR(100),
        location VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`CREATE INDEX IF NOT EXISTS idx_config_items_branch ON config_items(branch_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_config_items_type ON config_items(ci_type)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_config_items_status ON config_items(status)`);

    await db.query(`
      CREATE TABLE IF NOT EXISTS ci_dependencies (
        dependency_id SERIAL PRIMARY KEY,
        source_ci_id INTEGER NOT NULL REFERENCES config_items(ci_id) ON DELETE CASCADE,
        target_ci_id INTEGER NOT NULL REFERENCES config_items(ci_id) ON DELETE CASCADE,
        relationship_type VARCHAR(100) DEFAULT 'depends_on',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_ci_id, target_ci_id, relationship_type)
      )
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_ci_dependencies_source ON ci_dependencies(source_ci_id)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_ci_dependencies_target ON ci_dependencies(target_ci_id)
    `);

    // Ensure CI relationship columns (migration)
    await db.query(`ALTER TABLE ci_dependencies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
    await db.query(`ALTER TABLE ci_dependencies ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL`);
    await db.query(`ALTER TABLE ci_dependencies ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id) ON DELETE CASCADE`);

    await db.query(`
      CREATE TABLE IF NOT EXISTS ci_audit_logs (
        log_id SERIAL PRIMARY KEY,
        action_type VARCHAR(50) NOT NULL,
        entity_type VARCHAR(50) NOT NULL DEFAULT 'relationship',
        entity_id INTEGER,
        user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        user_name VARCHAR(255),
        branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
        branch_name VARCHAR(255),
        old_values JSONB,
        new_values JSONB,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_ci_audit_logs_entity ON ci_audit_logs(entity_type, entity_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_ci_audit_logs_user ON ci_audit_logs(user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_ci_audit_logs_created ON ci_audit_logs(created_at DESC)`);

    // Seed CI categories
    await db.query(`
      INSERT INTO ci_categories (category_name, description)
      SELECT seed.category_name, seed.description
      FROM (VALUES
        ('Server', 'Physical or virtual servers'),
        ('Application', 'Software applications and services'),
        ('Network Device', 'Routers, switches, firewalls, load balancers'),
        ('Database', 'Database instances and clusters'),
        ('Storage', 'Storage arrays, SAN, NAS devices'),
        ('Middleware', 'Message queues, ESBs, API gateways'),
        ('Security Appliance', 'Firewalls, IDS/IPS, VPN concentrators'),
        ('Virtualization', 'Hypervisors, VMs, containers'),
        ('Workstation', 'Desktops, laptops, thin clients'),
        ('Peripheral', 'Printers, scanners, UPS devices')
      ) AS seed(category_name, description)
      WHERE NOT EXISTS (
        SELECT 1 FROM ci_categories existing
        WHERE LOWER(existing.category_name) = LOWER(seed.category_name)
      )
    `);
  } catch (err) {
    console.error("CMDB table setup error:", err.message);
  }
}

async function ensureRa10173Tables() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS laptop_activity_monitoring (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        branch_id INTEGER REFERENCES branches(branch_id),
        application_monitoring BOOLEAN NOT NULL DEFAULT FALSE,
        web_monitoring BOOLEAN NOT NULL DEFAULT FALSE,
        location_tracking BOOLEAN NOT NULL DEFAULT FALSE,
        device_telemetry BOOLEAN NOT NULL DEFAULT TRUE,
        email_header_monitoring BOOLEAN NOT NULL DEFAULT FALSE,
        signature_image TEXT,
        consent_status VARCHAR(30) NOT NULL DEFAULT 'Pending',
        submitted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS laptop_monitoring_user_id_idx ON laptop_activity_monitoring (user_id)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS laptop_monitoring_branch_id_idx ON laptop_activity_monitoring (branch_id)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS laptop_monitoring_consent_status_idx ON laptop_activity_monitoring (consent_status)
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS consent_audit_logs (
        log_id BIGSERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        action VARCHAR(50) NOT NULL,
        details JSONB,
        ip_address VARCHAR(45),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS consent_audit_employee_idx ON consent_audit_logs (employee_id)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS consent_audit_action_idx ON consent_audit_logs (action)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS consent_audit_created_idx ON consent_audit_logs (created_at DESC)
    `);

    return true;
  } catch (err) {
    console.error("RA 10173 table setup error:", err.message);
    return false;
  }
}

async function ensureSoftwareLicensesTable() {
  try {
    await softwareLicenseRepository.ensureSchema();
  } catch (error) {
    // Preserve the legacy startup behavior: a license schema issue is logged,
    // but it does not take unrelated API modules offline.
    console.error("Software licenses table setup error:", error.message);
  }
}

// Legacy inline routes still depend on these compatibility checks. Run them in
// one sequence to avoid concurrent ALTER TABLE locks during application boot.
// Normal schema evolution is handled by init-db.js migrations.
const legacySchemaReady = (async () => {
  await ensureUserStatusColumn();
  await ensureRoleBranchManagement();
  await ensureKnowledgeBaseTable();
  await ensureTicketWorkflowColumns();
  await ensureAttachmentsAndInvites();
  const hardwareReady = await ensureHardwareAssetTables();
  await ensureRa10173Tables();
  await ensureCmdbTables();
  await ensureSoftwareLicensesTable();
  return hardwareReady !== false;
})().catch((error) => {
  console.error("Legacy schema compatibility setup failed:", error.message);
  return false;
});

const hardwareAssetTablesReady = legacySchemaReady;

module.exports = {
  legacySchemaReady,
  hardwareAssetTablesReady,
};
