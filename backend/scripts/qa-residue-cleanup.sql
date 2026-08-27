-- Removes QA lifecycle test residue tagged "QA-DELETEME-".
-- Run once per deployment DB (psql "$DATABASE_URL" -f qa-residue-cleanup.sql).
-- Safe to run repeatedly. Review the SELECTs first if you want to confirm scope.

BEGIN;

-- 1. lifecycle history + tasks + cases for QA branches / QA subjects
WITH qa_cases AS (
  SELECT lc.lifecycle_case_id
  FROM employee_lifecycle_cases lc
  LEFT JOIN branches b ON b.branch_id = lc.branch_id
  WHERE lc.subject_full_name ILIKE 'QA-DELETEME-%'
     OR b.branch_name ILIKE 'QA-DELETEME-%'
)
DELETE FROM employee_lifecycle_history WHERE lifecycle_case_id IN (SELECT lifecycle_case_id FROM qa_cases);

WITH qa_cases AS (
  SELECT lc.lifecycle_case_id
  FROM employee_lifecycle_cases lc
  LEFT JOIN branches b ON b.branch_id = lc.branch_id
  WHERE lc.subject_full_name ILIKE 'QA-DELETEME-%'
     OR b.branch_name ILIKE 'QA-DELETEME-%'
)
DELETE FROM employee_lifecycle_tasks WHERE lifecycle_case_id IN (SELECT lifecycle_case_id FROM qa_cases);

-- 2. software-license assignments + history for QA licenses / QA branches, then the licenses
WITH qa_lic AS (
  SELECT license_id FROM software_licenses
  WHERE license_name ILIKE 'QA-DELETEME-%'
     OR branch_id IN (SELECT branch_id FROM branches WHERE branch_name ILIKE 'QA-DELETEME-%')
)
DELETE FROM software_license_assignments WHERE license_id IN (SELECT license_id FROM qa_lic);
DELETE FROM software_licenses
 WHERE license_name ILIKE 'QA-DELETEME-%'
    OR branch_id IN (SELECT branch_id FROM branches WHERE branch_name ILIKE 'QA-DELETEME-%');

-- 3. hardware assets in QA branches (and their history/borrow records)
WITH qa_assets AS (
  SELECT asset_id FROM hardware_assets
  WHERE asset_tag ILIKE 'QA-DELETEME-%'
     OR branch_id IN (SELECT branch_id FROM branches WHERE branch_name ILIKE 'QA-DELETEME-%')
)
DELETE FROM asset_history WHERE asset_id IN (SELECT asset_id FROM qa_assets);
WITH qa_assets AS (
  SELECT asset_id FROM hardware_assets
  WHERE asset_tag ILIKE 'QA-DELETEME-%'
     OR branch_id IN (SELECT branch_id FROM branches WHERE branch_name ILIKE 'QA-DELETEME-%')
)
DELETE FROM asset_borrow_records WHERE asset_id IN (SELECT asset_id FROM qa_assets);
DELETE FROM hardware_assets
 WHERE asset_tag ILIKE 'QA-DELETEME-%'
    OR branch_id IN (SELECT branch_id FROM branches WHERE branch_name ILIKE 'QA-DELETEME-%');

-- 4. QA lifecycle tickets (Onboarding/Offboarding Request) + their history/comments/notifications
WITH qa_tickets AS (
  SELECT id FROM tickets
  WHERE branch_id IN (SELECT branch_id FROM branches WHERE branch_name ILIKE 'QA-DELETEME-%')
     OR title ILIKE '%QA-DELETEME-%'
)
DELETE FROM ticket_history WHERE ticket_id IN (SELECT id FROM qa_tickets);
WITH qa_tickets AS (
  SELECT id FROM tickets
  WHERE branch_id IN (SELECT branch_id FROM branches WHERE branch_name ILIKE 'QA-DELETEME-%')
     OR title ILIKE '%QA-DELETEME-%'
)
DELETE FROM ticket_comments WHERE ticket_id IN (SELECT id FROM qa_tickets);
WITH qa_tickets AS (
  SELECT id FROM tickets
  WHERE branch_id IN (SELECT branch_id FROM branches WHERE branch_name ILIKE 'QA-DELETEME-%')
     OR title ILIKE '%QA-DELETEME-%'
)
DELETE FROM notifications WHERE related_ticket_id IN (SELECT id FROM qa_tickets);
DELETE FROM tickets
 WHERE branch_id IN (SELECT branch_id FROM branches WHERE branch_name ILIKE 'QA-DELETEME-%')
    OR title ILIKE '%QA-DELETEME-%';

-- 5. now the lifecycle cases themselves
DELETE FROM employee_lifecycle_cases
 WHERE subject_full_name ILIKE 'QA-DELETEME-%'
    OR branch_id IN (SELECT branch_id FROM branches WHERE branch_name ILIKE 'QA-DELETEME-%');

-- 6. QA employee accounts (created by account-invitation; email was scrambled on soft-delete)
DELETE FROM user_onboarding_history WHERE user_id IN (
  SELECT user_id FROM users
  WHERE company_name = 'AstreaBlue' AND (full_name ILIKE 'QA-DELETEME-%' OR email ILIKE '%example.invalid%' OR employee_number ILIKE 'QA-%')
);
DELETE FROM users
 WHERE full_name ILIKE 'QA-DELETEME-%'
    OR email ILIKE '%example.invalid%'
    OR employee_number ILIKE 'QA-%'
    OR branch_id IN (SELECT branch_id FROM branches WHERE branch_name ILIKE 'QA-DELETEME-%');

-- 7. QA branches
DELETE FROM branches WHERE branch_name ILIKE 'QA-DELETEME-%';

COMMIT;
