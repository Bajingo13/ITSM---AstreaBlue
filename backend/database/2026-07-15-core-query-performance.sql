-- Common Service Desk list and RBAC access paths.
CREATE INDEX IF NOT EXISTS tickets_created_at_desc_idx
  ON tickets(created_at DESC);

CREATE INDEX IF NOT EXISTS tickets_branch_created_idx
  ON tickets(branch_id, created_at DESC)
  WHERE branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tickets_requester_created_idx
  ON tickets(requester_id, created_at DESC)
  WHERE requester_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tickets_assignee_status_created_idx
  ON tickets(assigned_to, status, created_at DESC)
  WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS tickets_unassigned_branch_created_idx
  ON tickets(branch_id, created_at DESC)
  WHERE assigned_to IS NULL;

CREATE INDEX IF NOT EXISTS tickets_status_created_idx
  ON tickets(status, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_unread_created_idx
  ON notifications(user_id, created_at DESC)
  WHERE read = FALSE;
