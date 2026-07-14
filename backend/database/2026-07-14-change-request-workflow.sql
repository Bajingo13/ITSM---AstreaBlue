-- Change Request Workflow — extended fields, statuses, CAB integration

-- Extend the status CHECK to include comprehensive workflow statuses
ALTER TABLE change_requests DROP CONSTRAINT IF EXISTS change_requests_status_check;
ALTER TABLE change_requests ADD CONSTRAINT change_requests_status_check
  CHECK (status IN (
    'Draft','Submitted','Under Assessment','Pending Manager Approval','Pending CAB Review',
    'Approved','Rejected','Scheduled','In Progress','Implemented',
    'Validation Pending','Completed','Failed','Rolled Back','Cancelled'
  ));

-- Add extended fields
ALTER TABLE change_requests
  ADD COLUMN IF NOT EXISTS business_justification TEXT,
  ADD COLUMN IF NOT EXISTS testing_plan TEXT,
  ADD COLUMN IF NOT EXISTS post_implementation_verification TEXT,
  ADD COLUMN IF NOT EXISTS risk_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS security_impact VARCHAR(20) DEFAULT 'None',
  ADD COLUMN IF NOT EXISTS compliance_impact VARCHAR(20) DEFAULT 'None',
  ADD COLUMN IF NOT EXISTS data_loss_risk VARCHAR(20) DEFAULT 'None',
  ADD COLUMN IF NOT EXISTS operational_risk VARCHAR(20) DEFAULT 'None',
  ADD COLUMN IF NOT EXISTS assigned_technician_id INTEGER REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS scheduled_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS implementation_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS implemented_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS rollback_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS implementation_notes TEXT,
  ADD COLUMN IF NOT EXISTS review_notes TEXT;

-- CAB members assignment table
CREATE TABLE IF NOT EXISTS change_cab_members (
  id BIGSERIAL PRIMARY KEY,
  change_id BIGINT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(user_id),
  role VARCHAR(40) NOT NULL DEFAULT 'Member',
  status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  comments TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(change_id, user_id)
);

-- CAB review sessions
CREATE TABLE IF NOT EXISTS change_cab_reviews (
  id BIGSERIAL PRIMARY KEY,
  change_id BIGINT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  meeting_ref VARCHAR(80),
  review_status VARCHAR(30) NOT NULL DEFAULT 'Pending' CHECK (review_status IN ('Pending','Approved','Rejected','Request Changes')),
  decision_notes TEXT,
  quorum_met BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by INTEGER REFERENCES users(user_id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Implementation updates log
CREATE TABLE IF NOT EXISTS change_implementation_updates (
  id BIGSERIAL PRIMARY KEY,
  change_id BIGINT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  action VARCHAR(40) NOT NULL,
  notes TEXT,
  performed_by INTEGER REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Change schedule history
CREATE TABLE IF NOT EXISTS change_schedule_history (
  id BIGSERIAL PRIMARY KEY,
  change_id BIGINT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  previous_start TIMESTAMPTZ,
  previous_end TIMESTAMPTZ,
  new_start TIMESTAMPTZ,
  new_end TIMESTAMPTZ,
  reason TEXT,
  changed_by INTEGER REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS change_cab_members_change_idx ON change_cab_members(change_id, status);
CREATE INDEX IF NOT EXISTS change_cab_reviews_change_idx ON change_cab_reviews(change_id);
CREATE INDEX IF NOT EXISTS change_impl_updates_change_idx ON change_implementation_updates(change_id, created_at DESC);
CREATE INDEX IF NOT EXISTS change_schedule_history_change_idx ON change_schedule_history(change_id, created_at DESC);
