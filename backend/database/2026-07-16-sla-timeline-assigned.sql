-- Adds tracking columns for SLA activity timeline
-- 1. assigned_at — timestamp when a technician was assigned
-- 2. in_progress_started_at — timestamp when work began (status → 'In Progress')

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS in_progress_started_at TIMESTAMP;

-- Index for timeline/lifecycle lookups
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_at ON tickets(assigned_at);
CREATE INDEX IF NOT EXISTS idx_tickets_in_progress_started_at ON tickets(in_progress_started_at);
