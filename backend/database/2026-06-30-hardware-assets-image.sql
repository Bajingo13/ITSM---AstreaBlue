DO $$
BEGIN
  IF to_regclass('public.hardware_assets') IS NOT NULL THEN
    ALTER TABLE hardware_assets
    ADD COLUMN IF NOT EXISTS image_url TEXT,
    ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id);
  END IF;
END $$;
