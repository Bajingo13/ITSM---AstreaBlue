-- Forward-only upgrade for installations that already applied the original
-- replacement request migration before the repair lifecycle was introduced.

ALTER TABLE replacement_requests
    ADD COLUMN IF NOT EXISTS repair_started_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE replacement_requests
    ADD COLUMN IF NOT EXISTS repair_started_at TIMESTAMPTZ;
ALTER TABLE replacement_requests
    ADD COLUMN IF NOT EXISTS repaired_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE replacement_requests
    ADD COLUMN IF NOT EXISTS repaired_at TIMESTAMPTZ;
ALTER TABLE replacement_requests
    ADD COLUMN IF NOT EXISTS repair_resolution TEXT;

ALTER TABLE replacement_requests
    DROP CONSTRAINT IF EXISTS replacement_requests_status_check;
ALTER TABLE replacement_requests
    ADD CONSTRAINT replacement_requests_status_check
    CHECK (status IN (
        'Submitted','Under Assessment','Awaiting Approval','Approved',
        'Replacement Reserved','Issued','Completed','Repair Recommended',
        'In Repair','Repaired','Rejected','Cancelled'
    ));

DROP INDEX IF EXISTS uq_replacement_active_current_asset;
CREATE UNIQUE INDEX uq_replacement_active_current_asset
    ON replacement_requests(current_asset_id)
    WHERE status NOT IN ('Completed','Repaired','Rejected','Cancelled');
