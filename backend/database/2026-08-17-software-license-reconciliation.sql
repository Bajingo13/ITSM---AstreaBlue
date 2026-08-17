ALTER TABLE software_license_assignments
  ADD COLUMN IF NOT EXISTS assignment_source VARCHAR(30) NOT NULL DEFAULT 'Restored';

ALTER TABLE software_license_assignments
  DROP CONSTRAINT IF EXISTS software_license_assignments_source_check;

ALTER TABLE software_license_assignments
  ADD CONSTRAINT software_license_assignments_source_check
  CHECK (assignment_source IN ('Lifecycle', 'Reconciliation', 'Restored'));

CREATE INDEX IF NOT EXISTS software_license_assignments_license_status_idx
  ON software_license_assignments(license_id, status);

-- Keep this migration self-sufficient when the preceding migration was
-- applied before its historical cost-snapshot backfill was introduced.
UPDATE software_license_assignments assignment
SET annual_cost_snapshot = license.annual_cost,
    seat_annual_cost_snapshot = CASE
      WHEN license.total_licenses > 0 THEN ROUND(license.annual_cost / license.total_licenses, 2)
      ELSE 0
    END
FROM software_licenses license
WHERE license.license_id = assignment.license_id
  AND assignment.annual_cost_snapshot = 0
  AND assignment.seat_annual_cost_snapshot = 0;

UPDATE software_licenses license
SET used_licenses = active_usage.tracked_assignments,
    updated_at = CURRENT_TIMESTAMP
FROM (
  SELECT license_id,COUNT(*)::int tracked_assignments
    FROM software_license_assignments
   WHERE status='Active'
   GROUP BY license_id
) active_usage
WHERE active_usage.license_id=license.license_id
  AND license.used_licenses<active_usage.tracked_assignments;
