ALTER TABLE software_license_assignments
  DROP CONSTRAINT IF EXISTS software_license_assignments_source_check;

ALTER TABLE software_license_assignments
  ADD CONSTRAINT software_license_assignments_source_check
  CHECK (assignment_source IN ('Lifecycle', 'Direct', 'Reconciliation', 'Restored'));
