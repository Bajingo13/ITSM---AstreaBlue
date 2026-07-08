-- CMDB (Configuration Management Database) Module
-- Config Items, Dependencies, and Change Impact tables

CREATE TABLE IF NOT EXISTS ci_categories (
  ci_category_id SERIAL PRIMARY KEY,
  category_name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
);

CREATE INDEX IF NOT EXISTS idx_config_items_branch ON config_items(branch_id);
CREATE INDEX IF NOT EXISTS idx_config_items_type ON config_items(ci_type);
CREATE INDEX IF NOT EXISTS idx_config_items_status ON config_items(status);

CREATE TABLE IF NOT EXISTS ci_dependencies (
  dependency_id SERIAL PRIMARY KEY,
  source_ci_id INTEGER NOT NULL REFERENCES config_items(ci_id) ON DELETE CASCADE,
  target_ci_id INTEGER NOT NULL REFERENCES config_items(ci_id) ON DELETE CASCADE,
  relationship_type VARCHAR(100) DEFAULT 'depends_on',
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_ci_id, target_ci_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_ci_dependencies_source ON ci_dependencies(source_ci_id);
CREATE INDEX IF NOT EXISTS idx_ci_dependencies_target ON ci_dependencies(target_ci_id);

-- Seed CI categories
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
);
