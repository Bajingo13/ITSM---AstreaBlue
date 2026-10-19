-- Connected-system SLA: tickets that arrive through the Integration Gateway
-- (tickets.integration_id IS NOT NULL) follow the SLA agreed with the partner
-- system, not the internal ITSM targets.
--
-- scope = 'internal'          -> tickets filed by ITSM users (existing policies)
-- scope = 'connected_system'  -> tickets from connected systems
--   origin_system IS NULL     -> standard for every connected system
--                                (currently the AstreaBlue E-Invoicing System SLA)
--   origin_system = '<name>'  -> override for one system once it signs its own SLA
--
-- response_calendar / resolution_calendar:
--   '24x7'           -> clock hours
--   'business_hours' -> Mon-Fri 08:00-17:00 Asia/Manila, excluding sla_business_holidays

ALTER TABLE sla_policies
  ADD COLUMN IF NOT EXISTS scope VARCHAR(30) NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS origin_system VARCHAR(150),
  ADD COLUMN IF NOT EXISTS severity_label VARCHAR(50),
  ADD COLUMN IF NOT EXISTS response_calendar VARCHAR(20) NOT NULL DEFAULT '24x7',
  ADD COLUMN IF NOT EXISTS resolution_calendar VARCHAR(20) NOT NULL DEFAULT '24x7',
  ADD COLUMN IF NOT EXISTS source_document VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sla_policies_scope_check') THEN
    ALTER TABLE sla_policies
      ADD CONSTRAINT sla_policies_scope_check CHECK (scope IN ('internal', 'connected_system'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sla_policies_calendar_check') THEN
    ALTER TABLE sla_policies
      ADD CONSTRAINT sla_policies_calendar_check CHECK (
        response_calendar IN ('24x7', 'business_hours')
        AND resolution_calendar IN ('24x7', 'business_hours')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sla_policies_lookup
  ON sla_policies (scope, priority, origin_system)
  WHERE is_active = true;

-- Point in time when a ticket enters "Due Soon" (stored so lists, filters,
-- dashboard counts and the cron all agree, including across business hours).
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS response_warning_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS resolution_warning_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS sla_business_holidays (
  holiday_date DATE PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Proclamation No. 1006, s. 2025 (2026 regular and special non-working days).
-- Eid'l Fitr and Eid'l Adha are proclaimed separately; add them when announced.
INSERT INTO sla_business_holidays (holiday_date, name) VALUES
  ('2026-01-01', 'New Year''s Day'),
  ('2026-02-17', 'Chinese New Year'),
  ('2026-04-02', 'Maundy Thursday'),
  ('2026-04-03', 'Good Friday'),
  ('2026-04-04', 'Black Saturday'),
  ('2026-04-09', 'Araw ng Kagitingan'),
  ('2026-05-01', 'Labor Day'),
  ('2026-06-12', 'Independence Day'),
  ('2026-08-21', 'Ninoy Aquino Day'),
  ('2026-08-31', 'National Heroes Day'),
  ('2026-11-01', 'All Saints'' Day'),
  ('2026-11-02', 'All Souls'' Day'),
  ('2026-11-30', 'Bonifacio Day'),
  ('2026-12-08', 'Feast of the Immaculate Conception'),
  ('2026-12-24', 'Christmas Eve'),
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-30', 'Rizal Day'),
  ('2026-12-31', 'Last Day of the Year')
ON CONFLICT (holiday_date) DO NOTHING;

-- Connected-system standard, from "Service Level Agreement - AstreaBlue
-- E-Invoicing System" section 5.2. One Business Day = 9 Business Hours (540 min).
INSERT INTO sla_policies (
  name, priority, response_target_mins, resolution_target_mins, is_active,
  scope, origin_system, severity_label, response_calendar, resolution_calendar, source_document
)
SELECT v.name, v.priority, v.response_mins, v.resolution_mins, true,
       'connected_system', NULL, v.severity_label, v.response_calendar, v.resolution_calendar,
       'AstreaBlue E-Invoicing System SLA, section 5.2'
FROM (VALUES
  ('Connected Systems S1 Critical', 'P1-Critical', 'S1 Critical', 30,   240,   '24x7',           '24x7'),
  ('Connected Systems S2 High',     'P2-High',     'S2 High',     120,  540,   'business_hours', 'business_hours'),
  ('Connected Systems S3 Medium',   'P3-Medium',   'S3 Medium',   540,  2700,  'business_hours', 'business_hours'),
  ('Connected Systems S4 Low',      'P4-Low',      'S4 Low',      1080, 86400, 'business_hours', '24x7')
) AS v(name, priority, severity_label, response_mins, resolution_mins, response_calendar, resolution_calendar)
WHERE NOT EXISTS (
  SELECT 1 FROM sla_policies p
  WHERE p.scope = 'connected_system' AND p.origin_system IS NULL AND p.priority = v.priority
);
