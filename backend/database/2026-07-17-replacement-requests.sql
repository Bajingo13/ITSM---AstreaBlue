CREATE TABLE IF NOT EXISTS replacement_requests (
    id BIGSERIAL PRIMARY KEY,
    request_number VARCHAR(40) NOT NULL UNIQUE,
    requester_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    employee_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    branch_id INTEGER NOT NULL REFERENCES branches(branch_id) ON DELETE RESTRICT,
    current_asset_id INTEGER NOT NULL REFERENCES hardware_assets(asset_id) ON DELETE RESTRICT,
    replacement_asset_id INTEGER REFERENCES hardware_assets(asset_id) ON DELETE RESTRICT,
    source_ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
    title VARCHAR(220) NOT NULL,
    description TEXT NOT NULL,
    damage_type VARCHAR(80),
    urgency VARCHAR(20) NOT NULL DEFAULT 'Medium'
        CHECK (urgency IN ('Low','Medium','High','Critical')),
    status VARCHAR(40) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN (
            'Submitted','Under Assessment','Awaiting Approval','Approved',
            'Replacement Reserved','Issued','Completed','Repair Recommended',
            'In Repair','Repaired','Rejected','Cancelled'
        )),
    diagnosis TEXT,
    assessment_notes TEXT,
    recommendation TEXT,
    approval_notes TEXT,
    rejection_reason TEXT,
    assessed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    assessed_at TIMESTAMPTZ,
    approved_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    reserved_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    reserved_at TIMESTAMPTZ,
    issued_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    issued_at TIMESTAMPTZ,
    completed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    completed_at TIMESTAMPTZ,
    cancelled_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    repair_started_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    repair_started_at TIMESTAMPTZ,
    repaired_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    repaired_at TIMESTAMPTZ,
    repair_resolution TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT replacement_assets_must_differ
        CHECK (replacement_asset_id IS NULL OR replacement_asset_id <> current_asset_id)
);

ALTER TABLE replacement_requests ADD COLUMN IF NOT EXISTS repair_started_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE replacement_requests ADD COLUMN IF NOT EXISTS repair_started_at TIMESTAMPTZ;
ALTER TABLE replacement_requests ADD COLUMN IF NOT EXISTS repaired_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE replacement_requests ADD COLUMN IF NOT EXISTS repaired_at TIMESTAMPTZ;
ALTER TABLE replacement_requests ADD COLUMN IF NOT EXISTS repair_resolution TEXT;

ALTER TABLE replacement_requests DROP CONSTRAINT IF EXISTS replacement_requests_status_check;
ALTER TABLE replacement_requests ADD CONSTRAINT replacement_requests_status_check
    CHECK (status IN (
        'Submitted','Under Assessment','Awaiting Approval','Approved',
        'Replacement Reserved','Issued','Completed','Repair Recommended',
        'In Repair','Repaired','Rejected','Cancelled'
    ));

CREATE TABLE IF NOT EXISTS replacement_request_history (
    id BIGSERIAL PRIMARY KEY,
    replacement_request_id BIGINT NOT NULL REFERENCES replacement_requests(id) ON DELETE CASCADE,
    event_type VARCHAR(80) NOT NULL,
    old_status VARCHAR(40),
    new_status VARCHAR(40),
    message TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    changed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS replacement_request_attachments (
    id BIGSERIAL PRIMARY KEY,
    replacement_request_id BIGINT NOT NULL REFERENCES replacement_requests(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    mime_type VARCHAR(120),
    file_size BIGINT,
    uploaded_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_replacement_requests_branch_status
    ON replacement_requests(branch_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_replacement_requests_employee
    ON replacement_requests(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_replacement_requests_current_asset
    ON replacement_requests(current_asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_replacement_request_history_request
    ON replacement_request_history(replacement_request_id, created_at DESC);

DROP INDEX IF EXISTS uq_replacement_active_current_asset;
CREATE UNIQUE INDEX uq_replacement_active_current_asset
    ON replacement_requests(current_asset_id)
    WHERE status NOT IN ('Completed','Repaired','Rejected','Cancelled');

CREATE UNIQUE INDEX IF NOT EXISTS uq_replacement_reserved_asset
    ON replacement_requests(replacement_asset_id)
    WHERE replacement_asset_id IS NOT NULL AND status IN ('Replacement Reserved','Issued');
