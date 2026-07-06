ALTER TABLE asset_financials
  ADD COLUMN IF NOT EXISTS useful_life_months INTEGER;

UPDATE asset_financials
SET useful_life_months = GREATEST(1, ROUND(useful_life_years * 12)::INTEGER)
WHERE useful_life_months IS NULL OR useful_life_months <= 0;

ALTER TABLE asset_financials
  ALTER COLUMN useful_life_months SET DEFAULT 36;

ALTER TABLE hardware_assets
  ADD COLUMN IF NOT EXISTS useful_life_months INTEGER;

UPDATE hardware_assets
SET useful_life_months = GREATEST(1, ROUND(useful_life_years * 12)::INTEGER)
WHERE (useful_life_months IS NULL OR useful_life_months <= 0)
  AND useful_life_years IS NOT NULL
  AND useful_life_years > 0;

UPDATE hardware_assets
SET useful_life_months = 36
WHERE useful_life_months IS NULL OR useful_life_months <= 0;
