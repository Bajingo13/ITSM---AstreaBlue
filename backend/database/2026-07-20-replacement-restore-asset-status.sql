-- Preserve the operational state of an asset while it passes through repair.
-- This prevents permanently assigned laptops from being relabelled Borrowed.

ALTER TABLE replacement_requests
    ADD COLUMN IF NOT EXISTS pre_repair_asset_status VARCHAR(50);
