CREATE TABLE IF NOT EXISTS it_projects (
  project_id BIGSERIAL PRIMARY KEY,
  project_name VARCHAR(200) NOT NULL,
  project_code VARCHAR(80) NOT NULL UNIQUE,
  description TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'On Track',
  branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
  manager_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  start_date DATE,
  planned_finish_date DATE,
  projected_finish_date DATE,
  planned_completion_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  actual_completion_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  health_score NUMERIC(4,2),
  budget NUMERIC(14,2) NOT NULL DEFAULT 0,
  planned_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  earned_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  actual_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  forecast_confidence NUMERIC(5,2),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS it_project_milestones (
  milestone_id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES it_projects(project_id) ON DELETE CASCADE,
  milestone_name VARCHAR(200) NOT NULL,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  status VARCHAR(30) NOT NULL DEFAULT 'Upcoming',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS it_project_resources (
  resource_id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES it_projects(project_id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  resource_name VARCHAR(200),
  allocation_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  capacity_pct NUMERIC(5,2) NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS it_project_cost_snapshots (
  snapshot_id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES it_projects(project_id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  planned_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  earned_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  actual_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  UNIQUE(project_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS it_project_risks (
  risk_id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES it_projects(project_id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'Medium',
  status VARCHAR(30) NOT NULL DEFAULT 'Open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_it_projects_active ON it_projects(is_active, status);
CREATE INDEX IF NOT EXISTS idx_it_projects_branch ON it_projects(branch_id);
CREATE INDEX IF NOT EXISTS idx_it_milestones_project ON it_project_milestones(project_id, due_date);
CREATE INDEX IF NOT EXISTS idx_it_resources_project ON it_project_resources(project_id);
CREATE INDEX IF NOT EXISTS idx_it_costs_project_date ON it_project_cost_snapshots(project_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_it_risks_project_status ON it_project_risks(project_id, status);
