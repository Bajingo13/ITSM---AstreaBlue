-- External ticket integrations are company-wide gateway identities.
-- Ticket visibility is controlled by the existing Service Desk RBAC, not by
-- integration-specific branch lists. Internal/manual tickets remain unchanged.
UPDATE integration_registry
SET allowed_branches = '[]'::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE allowed_branches IS DISTINCT FROM '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_integration_audit_request_timestamp
  ON integration_audit_logs(request_timestamp);

CREATE INDEX IF NOT EXISTS idx_tickets_integration_created_at
  ON tickets(integration_id, created_at)
  WHERE integration_id IS NOT NULL;
