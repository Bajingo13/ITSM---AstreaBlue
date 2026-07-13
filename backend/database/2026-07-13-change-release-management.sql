CREATE TABLE IF NOT EXISTS change_requests (
  id BIGSERIAL PRIMARY KEY,
  change_number VARCHAR(40) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  change_type VARCHAR(20) NOT NULL DEFAULT 'Normal' CHECK (change_type IN ('Standard','Normal','Emergency')),
  category VARCHAR(80) NOT NULL DEFAULT 'Infrastructure',
  priority VARCHAR(30) NOT NULL DEFAULT 'Medium',
  status VARCHAR(30) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Submitted','Risk Assessment','CAB Review','Approved','Scheduled','In Progress','Completed','Closed')),
  branch_id INTEGER NOT NULL REFERENCES branches(branch_id),
  requester_id INTEGER REFERENCES users(user_id),
  owner_id INTEGER REFERENCES users(user_id),
  planned_start TIMESTAMPTZ,
  planned_end TIMESTAMPTZ,
  impact_level VARCHAR(20) NOT NULL DEFAULT 'Medium',
  risk_level VARCHAR(20) NOT NULL DEFAULT 'Medium',
  implementation_plan TEXT,
  backout_plan TEXT,
  communication_plan TEXT,
  linked_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_services JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_cis JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_incidents JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_problems JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS change_approvals (
  id BIGSERIAL PRIMARY KEY,
  change_id BIGINT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  stage VARCHAR(40) NOT NULL DEFAULT 'CAB Review',
  approver_id INTEGER REFERENCES users(user_id),
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('Pending','Approved','Rejected')),
  comments TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS change_activities (
  id BIGSERIAL PRIMARY KEY,
  change_id BIGINT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(user_id),
  event_type VARCHAR(40) NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS change_attachments (
  id BIGSERIAL PRIMARY KEY,
  change_id BIGINT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type VARCHAR(100),
  uploaded_by INTEGER REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS release_plans (
  id BIGSERIAL PRIMARY KEY,
  release_number VARCHAR(40) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  environment VARCHAR(20) NOT NULL DEFAULT 'Development' CHECK (environment IN ('Development','Testing','Staging','Production')),
  status VARCHAR(20) NOT NULL DEFAULT 'Planned' CHECK (status IN ('Planned','Scheduled','Deploying','Verifying','Completed','Closed')),
  branch_id INTEGER NOT NULL REFERENCES branches(branch_id),
  owner_id INTEGER REFERENCES users(user_id),
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  package_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  release_notes TEXT,
  validation_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS change_release_links (
  change_id BIGINT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  release_id BIGINT NOT NULL REFERENCES release_plans(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(change_id, release_id)
);

CREATE TABLE IF NOT EXISTS rollback_procedures (
  id BIGSERIAL PRIMARY KEY,
  rollback_number VARCHAR(40) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Approved','Available','Executed','Verified')),
  branch_id INTEGER NOT NULL REFERENCES branches(branch_id),
  owner_id INTEGER REFERENCES users(user_id),
  linked_change_id BIGINT REFERENCES change_requests(id) ON DELETE SET NULL,
  linked_release_id BIGINT REFERENCES release_plans(id) ON DELETE SET NULL,
  recovery_plan TEXT NOT NULL,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  approved_by INTEGER REFERENCES users(user_id),
  approved_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rollback_versions (
  id BIGSERIAL PRIMARY KEY,
  rollback_id BIGINT NOT NULL REFERENCES rollback_procedures(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  recovery_plan TEXT NOT NULL,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  changed_by INTEGER REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(rollback_id, version)
);

CREATE TABLE IF NOT EXISTS rollback_execution_logs (
  id BIGSERIAL PRIMARY KEY,
  rollback_id BIGINT NOT NULL REFERENCES rollback_procedures(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(user_id),
  action VARCHAR(80) NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS change_requests_branch_status_idx ON change_requests(branch_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS change_requests_schedule_idx ON change_requests(planned_start,planned_end);
CREATE INDEX IF NOT EXISTS change_activities_change_idx ON change_activities(change_id,created_at DESC);
CREATE INDEX IF NOT EXISTS release_plans_branch_status_idx ON release_plans(branch_id,status,scheduled_start);
CREATE INDEX IF NOT EXISTS rollback_procedures_branch_status_idx ON rollback_procedures(branch_id,status,updated_at DESC);
