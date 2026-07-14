-- Repair partially-created Change & Release schemas from older deployments.
-- CREATE TABLE IF NOT EXISTS does not add columns to tables that already exist,
-- so every column used by the current API is reconciled explicitly here.

ALTER TABLE change_requests
  ADD COLUMN IF NOT EXISTS change_number VARCHAR(40),
  ADD COLUMN IF NOT EXISTS title VARCHAR(255),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS change_type VARCHAR(20) DEFAULT 'Normal',
  ADD COLUMN IF NOT EXISTS category VARCHAR(80) DEFAULT 'Infrastructure',
  ADD COLUMN IF NOT EXISTS priority VARCHAR(30) DEFAULT 'Medium',
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'Draft',
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id),
  ADD COLUMN IF NOT EXISTS requester_id INTEGER REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS planned_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS planned_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS impact_level VARCHAR(20) DEFAULT 'Medium',
  ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20) DEFAULT 'Medium',
  ADD COLUMN IF NOT EXISTS implementation_plan TEXT,
  ADD COLUMN IF NOT EXISTS backout_plan TEXT,
  ADD COLUMN IF NOT EXISTS communication_plan TEXT,
  ADD COLUMN IF NOT EXISTS linked_assets JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_services JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_cis JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_incidents JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_problems JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE change_approvals
  ADD COLUMN IF NOT EXISTS change_id BIGINT REFERENCES change_requests(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS stage VARCHAR(40) DEFAULT 'CAB Review',
  ADD COLUMN IF NOT EXISTS approver_id INTEGER REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS decision VARCHAR(20),
  ADD COLUMN IF NOT EXISTS comments TEXT,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE change_activities
  ADD COLUMN IF NOT EXISTS change_id BIGINT REFERENCES change_requests(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS actor_id INTEGER REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS event_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE change_attachments
  ADD COLUMN IF NOT EXISTS change_id BIGINT REFERENCES change_requests(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS file_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS file_path TEXT,
  ADD COLUMN IF NOT EXISTS file_size INTEGER,
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS uploaded_by INTEGER REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE release_plans
  ADD COLUMN IF NOT EXISTS release_number VARCHAR(40),
  ADD COLUMN IF NOT EXISTS title VARCHAR(255),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS environment VARCHAR(20) DEFAULT 'Development',
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Planned',
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id),
  ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS package_details JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dependencies JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS checklist JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS release_notes TEXT,
  ADD COLUMN IF NOT EXISTS validation_notes TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE change_release_links
  ADD COLUMN IF NOT EXISTS change_id BIGINT REFERENCES change_requests(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS release_id BIGINT REFERENCES release_plans(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE rollback_procedures
  ADD COLUMN IF NOT EXISTS rollback_number VARCHAR(40),
  ADD COLUMN IF NOT EXISTS title VARCHAR(255),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Draft',
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id),
  ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS linked_change_id BIGINT REFERENCES change_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_release_id BIGINT REFERENCES release_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recovery_plan TEXT,
  ADD COLUMN IF NOT EXISTS checklist JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE rollback_versions
  ADD COLUMN IF NOT EXISTS rollback_id BIGINT REFERENCES rollback_procedures(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS recovery_plan TEXT,
  ADD COLUMN IF NOT EXISTS checklist JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS changed_by INTEGER REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE rollback_execution_logs
  ADD COLUMN IF NOT EXISTS rollback_id BIGINT REFERENCES rollback_procedures(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS actor_id INTEGER REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS action VARCHAR(80),
  ADD COLUMN IF NOT EXISTS details TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

UPDATE change_requests SET linked_assets='[]'::jsonb WHERE linked_assets IS NULL;
UPDATE change_requests SET linked_services='[]'::jsonb WHERE linked_services IS NULL;
UPDATE change_requests SET linked_cis='[]'::jsonb WHERE linked_cis IS NULL;
UPDATE change_requests SET linked_incidents='[]'::jsonb WHERE linked_incidents IS NULL;
UPDATE change_requests SET linked_problems='[]'::jsonb WHERE linked_problems IS NULL;
UPDATE change_activities SET metadata='{}'::jsonb WHERE metadata IS NULL;
UPDATE release_plans SET package_details='[]'::jsonb WHERE package_details IS NULL;
UPDATE release_plans SET dependencies='[]'::jsonb WHERE dependencies IS NULL;
UPDATE release_plans SET checklist='[]'::jsonb WHERE checklist IS NULL;
UPDATE release_plans SET progress=0 WHERE progress IS NULL;
UPDATE rollback_procedures SET checklist='[]'::jsonb WHERE checklist IS NULL;
UPDATE rollback_procedures SET version=1 WHERE version IS NULL;
UPDATE rollback_versions SET checklist='[]'::jsonb WHERE checklist IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS change_requests_number_uidx ON change_requests(change_number) WHERE change_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS release_plans_number_uidx ON release_plans(release_number) WHERE release_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rollback_procedures_number_uidx ON rollback_procedures(rollback_number) WHERE rollback_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS change_release_links_uidx ON change_release_links(change_id,release_id) WHERE change_id IS NOT NULL AND release_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rollback_versions_uidx ON rollback_versions(rollback_id,version) WHERE rollback_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS change_requests_branch_status_idx ON change_requests(branch_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS change_activities_change_idx ON change_activities(change_id,created_at DESC);
CREATE INDEX IF NOT EXISTS release_plans_branch_status_idx ON release_plans(branch_id,status,scheduled_start);
CREATE INDEX IF NOT EXISTS rollback_procedures_branch_status_idx ON rollback_procedures(branch_id,status,updated_at DESC);
