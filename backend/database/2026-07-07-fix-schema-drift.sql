-- Fix hardware_assets: ensure type_name column exists on asset_types
ALTER TABLE asset_types ADD COLUMN IF NOT EXISTS type_name VARCHAR(100);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'asset_types' AND column_name = 'name') THEN
    EXECUTE 'UPDATE asset_types SET type_name = name WHERE type_name IS NULL AND name IS NOT NULL';
  END IF;
END $$;

-- Fix tickets: add missing SLA columns
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS response_due_at TIMESTAMP;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS response_sla_status VARCHAR(30) DEFAULT 'ok';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolution_sla_status VARCHAR(30) DEFAULT 'ok';
