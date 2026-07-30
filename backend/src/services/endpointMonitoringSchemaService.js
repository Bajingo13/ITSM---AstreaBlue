const db = require("../../config/db");

async function initializeEndpointMonitoringSchema() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS monitored_devices (
        device_id BIGSERIAL PRIMARY KEY, hostname VARCHAR(255) NOT NULL UNIQUE,
        device_uuid UUID, device_name VARCHAR(255), logged_in_user VARCHAR(255),
        assigned_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
        asset_id INTEGER, department VARCHAR(255),
        agent_version VARCHAR(50), last_seen_at TIMESTAMPTZ,
        status VARCHAR(20) NOT NULL DEFAULT 'Offline', consent_status VARCHAR(30) NOT NULL DEFAULT 'Pending',
        last_policy_sync_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS laptop_activity_logs (
        id BIGSERIAL PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        event_type VARCHAR(50) NOT NULL DEFAULT 'activity', app_name VARCHAR(255), window_title VARCHAR(500),
        idle_seconds INTEGER NOT NULL DEFAULT 0, url_domain VARCHAR(255),
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS laptop_screenshots (
        id BIGSERIAL PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        file_url TEXT, file_path TEXT, thumbnail_path TEXT,
        assigned_user_id INTEGER, branch_id INTEGER, department VARCHAR(255),
        captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reason VARCHAR(255), created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS laptop_screenshots_captured_idx ON laptop_screenshots(captured_at DESC);
      CREATE INDEX IF NOT EXISTS laptop_screenshots_device_captured_idx ON laptop_screenshots(device_id, captured_at DESC);
      CREATE TABLE IF NOT EXISTS laptop_alerts (
        id BIGSERIAL PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        severity VARCHAR(20) NOT NULL, alert_type VARCHAR(100) NOT NULL, message TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'Open', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS endpoint_usb_events (
        id BIGSERIAL PRIMARY KEY,
        event_reference UUID NOT NULL UNIQUE,
        device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        device_uuid UUID,
        assigned_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
        department VARCHAR(255),
        event_type VARCHAR(50) NOT NULL,
        drive_letter VARCHAR(10), volume_label VARCHAR(255), volume_serial VARCHAR(100), filesystem VARCHAR(50),
        file_name VARCHAR(500), relative_path TEXT, extension VARCHAR(50), file_size_bytes BIGINT,
        file_last_write_at TIMESTAMPTZ,
        risk_score INTEGER NOT NULL DEFAULT 0, risk_level VARCHAR(20) NOT NULL DEFAULT 'Low',
        rule_matches JSONB NOT NULL DEFAULT '[]'::jsonb,
        dlp_action VARCHAR(50) NOT NULL DEFAULT 'logged',
        alert_id BIGINT REFERENCES laptop_alerts(id) ON DELETE SET NULL,
        ticket_id BIGINT,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS endpoint_usb_events_device_time_idx ON endpoint_usb_events(device_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS endpoint_usb_events_branch_risk_idx ON endpoint_usb_events(branch_id, risk_level, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS endpoint_usb_events_user_time_idx ON endpoint_usb_events(assigned_user_id, occurred_at DESC);
      CREATE TABLE IF NOT EXISTS endpoint_hardware_inventory (
        id BIGSERIAL PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        device_uuid UUID, asset_id INTEGER,
        manufacturer VARCHAR(255), model VARCHAR(255), serial_number VARCHAR(255),
        cpu_name VARCHAR(255), total_ram_gb NUMERIC(8,2),
        os_name VARCHAR(255), os_version VARCHAR(255), os_build VARCHAR(255), architecture VARCHAR(50),
        disk_total_gb NUMERIC(10,2), disk_free_gb NUMERIC(10,2),
        mac_address VARCHAR(255), ip_address VARCHAR(255),
        scanned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS endpoint_software_scan_runs (
        id BIGSERIAL PRIMARY KEY,
        device_uuid UUID,
        device_id BIGINT REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        scan_started_at TIMESTAMPTZ,
        scan_completed_at TIMESTAMPTZ,
        software_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS endpoint_software_inventory (
        id BIGSERIAL PRIMARY KEY,
        device_uuid UUID,
        device_id BIGINT REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        asset_id INTEGER,
        assigned_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
        department_id INTEGER,
        department VARCHAR(255),
        software_name VARCHAR(500) NOT NULL,
        version VARCHAR(255),
        publisher VARCHAR(255),
        install_date VARCHAR(80),
        install_location TEXT,
        source VARCHAR(80),
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(30) NOT NULL DEFAULT 'active',
        compliance_status VARCHAR(50) NOT NULL DEFAULT 'unknown',
        risk_level VARCHAR(50) NOT NULL DEFAULT 'unknown',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS asset_id INTEGER;
      ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS department VARCHAR(255);
      ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS last_policy_sync_at TIMESTAMPTZ;
      ALTER TABLE endpoint_software_inventory ADD COLUMN IF NOT EXISTS department_id INTEGER;
      ALTER TABLE endpoint_software_inventory ADD COLUMN IF NOT EXISTS department VARCHAR(255);
      ALTER TABLE endpoint_software_inventory ADD COLUMN IF NOT EXISTS compliance_status VARCHAR(50) NOT NULL DEFAULT 'unknown';
      ALTER TABLE endpoint_software_inventory ADD COLUMN IF NOT EXISTS risk_level VARCHAR(50) NOT NULL DEFAULT 'unknown';
      ALTER TABLE endpoint_software_inventory ADD COLUMN IF NOT EXISTS notes TEXT;
      CREATE INDEX IF NOT EXISTS endpoint_software_device_idx ON endpoint_software_inventory(device_uuid, status);
      CREATE INDEX IF NOT EXISTS endpoint_software_branch_idx ON endpoint_software_inventory(branch_id);
      CREATE INDEX IF NOT EXISTS endpoint_software_name_idx ON endpoint_software_inventory(LOWER(software_name));
      CREATE TABLE IF NOT EXISTS monitoring_consents (
        id BIGSERIAL PRIMARY KEY, device_id BIGINT NOT NULL REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, consent_type VARCHAR(50) NOT NULL,
        consent_status VARCHAR(30) NOT NULL DEFAULT 'Pending', consented_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(device_id,user_id,consent_type)
      );
      CREATE TABLE IF NOT EXISTS asset_inventory_reconciliation (
        id BIGSERIAL PRIMARY KEY,
        asset_id INTEGER REFERENCES hardware_assets(asset_id) ON DELETE CASCADE,
        device_uuid UUID,
        device_id BIGINT REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        field_name VARCHAR(100) NOT NULL,
        asset_value TEXT,
        detected_value TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'Unknown',
        severity VARCHAR(50) NOT NULL DEFAULT 'None',
        checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS asset_inventory_history (
        id BIGSERIAL PRIMARY KEY,
        asset_id INTEGER REFERENCES hardware_assets(asset_id) ON DELETE CASCADE,
        device_uuid UUID,
        field_name VARCHAR(100) NOT NULL,
        old_value TEXT,
        new_value TEXT,
        source VARCHAR(100),
        detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS device_uuid UUID;
      ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS device_name VARCHAR(255);
      ALTER TABLE monitored_devices ADD COLUMN IF NOT EXISTS logged_in_user VARCHAR(255);
      ALTER TABLE monitored_devices DROP CONSTRAINT IF EXISTS monitored_devices_hostname_key;
      CREATE UNIQUE INDEX IF NOT EXISTS monitored_devices_device_uuid_uidx ON monitored_devices(device_uuid) WHERE device_uuid IS NOT NULL;
      CREATE INDEX IF NOT EXISTS monitored_devices_hostname_idx ON monitored_devices(LOWER(hostname));
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS branch_id INTEGER;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS department VARCHAR(255);
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS object_key TEXT;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS encryption_algorithm VARCHAR(50);
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS encryption_iv TEXT;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS encryption_auth_tag TEXT;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS plaintext_sha256 VARCHAR(64);
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS content_type VARCHAR(100);
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;
      ALTER TABLE laptop_screenshots ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS laptop_screenshots_branch_capture_idx ON laptop_screenshots(branch_id, captured_at DESC);
      ALTER TABLE laptop_activity_logs ADD COLUMN IF NOT EXISTS device_uuid UUID;
      ALTER TABLE laptop_activity_logs ADD COLUMN IF NOT EXISTS asset_id INTEGER;
      ALTER TABLE laptop_activity_logs ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER;
      ALTER TABLE laptop_activity_logs ADD COLUMN IF NOT EXISTS current_logged_in_user VARCHAR(255);
      ALTER TABLE laptop_activity_logs ADD COLUMN IF NOT EXISTS branch_id INTEGER;
      ALTER TABLE laptop_activity_logs ADD COLUMN IF NOT EXISTS department VARCHAR(255);
      ALTER TABLE consent_documents ADD COLUMN IF NOT EXISTS device_id BIGINT;
      CREATE TABLE IF NOT EXISTS monitored_device_assignments (
        id BIGSERIAL PRIMARY KEY,
        device_id BIGINT REFERENCES monitored_devices(device_id) ON DELETE CASCADE,
        device_uuid UUID,
        asset_id INTEGER,
        old_user_id INTEGER,
        new_user_id INTEGER,
        old_branch_id INTEGER,
        new_branch_id INTEGER,
        old_department VARCHAR(255),
        new_department VARCHAR(255),
        reason TEXT,
        changed_by INTEGER,
        changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS endpoint_policies (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT true,
        config_json JSONB NOT NULL DEFAULT '{}',
        created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        branch_id INTEGER REFERENCES branches(branch_id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS endpoint_policy_assignments (
        id BIGSERIAL PRIMARY KEY,
        policy_id BIGINT REFERENCES endpoint_policies(id) ON DELETE CASCADE,
        target_type VARCHAR(50) NOT NULL,
        target_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS endpoint_effective_policies (
        device_uuid UUID PRIMARY KEY,
        policy_json JSONB NOT NULL,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS endpoint_policy_audit_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER,
        action VARCHAR(100) NOT NULL,
        target_id VARCHAR(255),
        details JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS endpoint_monitoring_overrides (
        id BIGSERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        feature_key VARCHAR(100) NOT NULL,
        suspended BOOLEAN NOT NULL DEFAULT true,
        reason TEXT,
        updated_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, feature_key)
      );
      CREATE INDEX IF NOT EXISTS endpoint_monitoring_overrides_employee_idx
        ON endpoint_monitoring_overrides(employee_id, feature_key);
    `);
    return true;
  } catch (error) {
    console.error("[laptop-monitoring] table initialization failed:", error.message);
    return false;
  }
}

const endpointMonitoringTablesReady = initializeEndpointMonitoringSchema();

module.exports = {
  endpointMonitoringTablesReady,
  initializeEndpointMonitoringSchema,
};
