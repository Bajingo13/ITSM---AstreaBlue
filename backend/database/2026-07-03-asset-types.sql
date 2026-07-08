CREATE TABLE IF NOT EXISTS asset_types (
  asset_type_id SERIAL PRIMARY KEY,
  type_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS asset_types_type_name_ci_unique
  ON asset_types (LOWER(type_name));

INSERT INTO asset_types (type_name)
SELECT seed.type_name
FROM (VALUES
  ('Laptop'), ('Desktop'), ('Printer'), ('Phone'), ('Monitor'),
  ('Server'), ('Network Device'), ('Other')
) AS seed(type_name)
WHERE NOT EXISTS (
  SELECT 1 FROM asset_types existing
  WHERE LOWER(existing.type_name) = LOWER(seed.type_name)
);

INSERT INTO asset_types (type_name)
SELECT MIN(TRIM(asset_type))
FROM hardware_assets source
WHERE NULLIF(TRIM(asset_type), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM asset_types existing
    WHERE LOWER(existing.type_name) = LOWER(TRIM(source.asset_type))
  )
GROUP BY LOWER(TRIM(asset_type));
