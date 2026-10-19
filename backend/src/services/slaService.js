const db = require("../../config/db");

const SLA_SCOPES = Object.freeze({
  INTERNAL: "internal",
  CONNECTED_SYSTEM: "connected_system",
});

// "Due Soon" starts when 25% of the target remains, but never earlier than
// 4 hours before the due time.
const DUE_SOON_MAX_MINUTES = 240;
const DUE_SOON_FRACTION = 0.25;

// Business Hours: Monday to Friday, 08:00-17:00 Asia/Manila (UTC+8, no DST),
// excluding dates in sla_business_holidays.
const MINUTE_MS = 60000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MANILA_OFFSET_MS = 8 * HOUR_MS;
const BUSINESS_OPEN_MS = 8 * HOUR_MS;
const BUSINESS_CLOSE_MS = 17 * HOUR_MS;

function addBusinessMinutes(start, minutes, holidays = new Set()) {
  let cursor = new Date(start).getTime();
  let remaining = Math.max(0, Number(minutes) || 0) * MINUTE_MS;

  // Guard: ~10 years of calendar days.
  for (let step = 0; step < 4000; step++) {
    const local = cursor + MANILA_OFFSET_MS;
    const msOfDay = ((local % DAY_MS) + DAY_MS) % DAY_MS;
    const dayStart = cursor - msOfDay;
    const localDate = new Date(local);
    const dateKey = localDate.toISOString().slice(0, 10);
    const weekday = localDate.getUTCDay();
    const open = dayStart + BUSINESS_OPEN_MS;
    const close = dayStart + BUSINESS_CLOSE_MS;
    const nextOpen = dayStart + DAY_MS + BUSINESS_OPEN_MS;

    if (weekday === 0 || weekday === 6 || holidays.has(dateKey) || cursor >= close) {
      cursor = nextOpen;
      continue;
    }
    if (cursor < open) cursor = open;

    const available = close - cursor;
    if (remaining <= available) return new Date(cursor + remaining);
    remaining -= available;
    cursor = nextOpen;
  }
  throw new Error("Business-hours calculation exceeded its range.");
}

function addTargetMinutes(start, minutes, calendar, holidays) {
  if (calendar === "business_hours") return addBusinessMinutes(start, minutes, holidays);
  return new Date(new Date(start).getTime() + Number(minutes) * MINUTE_MS);
}

function warningLeadMinutes(targetMinutes) {
  return Math.min(DUE_SOON_MAX_MINUTES, Math.round(Number(targetMinutes) * DUE_SOON_FRACTION));
}

function computeSlaTimes(policy, start = new Date(), holidays = new Set()) {
  const responseMins = Number(policy.response_target_mins);
  const resolutionMins = Number(policy.resolution_target_mins);
  const responseCalendar = policy.response_calendar || "24x7";
  const resolutionCalendar = policy.resolution_calendar || "24x7";

  return {
    response_due_at: addTargetMinutes(start, responseMins, responseCalendar, holidays),
    resolution_due_at: addTargetMinutes(start, resolutionMins, resolutionCalendar, holidays),
    response_warning_at: addTargetMinutes(start, responseMins - warningLeadMinutes(responseMins), responseCalendar, holidays),
    resolution_warning_at: addTargetMinutes(start, resolutionMins - warningLeadMinutes(resolutionMins), resolutionCalendar, holidays),
  };
}

async function loadBusinessHolidays(queryable, from) {
  const result = await queryable.query(
    `SELECT to_char(holiday_date, 'YYYY-MM-DD') AS holiday_date
       FROM sla_business_holidays
      WHERE holiday_date >= ($1::timestamptz AT TIME ZONE 'Asia/Manila')::date`,
    [new Date(from).toISOString()]
  );
  return new Set(result.rows.map((row) => row.holiday_date));
}

async function resolveSlaPolicy({ priority, categoryId = null, originSystem = null, connectedSystem = false }, queryable = db) {
  if (connectedSystem) {
    // A system-specific policy wins over the connected-system standard.
    const connected = await queryable.query(
      `SELECT * FROM sla_policies
        WHERE is_active = true
          AND scope = $1
          AND priority = $2
          AND (origin_system IS NULL OR LOWER(origin_system) = LOWER($3))
        ORDER BY (origin_system IS NOT NULL) DESC, policy_id ASC
        LIMIT 1`,
      [SLA_SCOPES.CONNECTED_SYSTEM, priority, originSystem || ""]
    );
    if (connected.rows[0]) return connected.rows[0];
  }

  // Try priority + category match first, then fallback to priority only
  const internal = await queryable.query(
    `SELECT * FROM sla_policies
      WHERE is_active = true
        AND COALESCE(scope, $1) = $1
        AND priority = $2
      ORDER BY
        CASE WHEN category_id::text = $3::text THEN 0 ELSE 1 END,
        policy_id ASC
      LIMIT 1`,
    [SLA_SCOPES.INTERNAL, priority, categoryId || null]
  );
  return internal.rows[0] || null;
}

async function applySlaToNewTicket(ticketPayload, queryable = db) {
  const { priority, category_id, origin_system, integration_id } = ticketPayload;
  const policy = await resolveSlaPolicy({
    priority,
    categoryId: category_id,
    originSystem: origin_system,
    connectedSystem: integration_id !== null && integration_id !== undefined && integration_id !== "",
  }, queryable);

  if (!policy) return null;

  const start = ticketPayload.created_at ? new Date(ticketPayload.created_at) : new Date();
  const usesBusinessHours = policy.response_calendar === "business_hours" || policy.resolution_calendar === "business_hours";
  const holidays = usesBusinessHours ? await loadBusinessHolidays(queryable, start) : new Set();

  return {
    sla_policy_id: policy.policy_id,
    sla_scope: policy.scope || SLA_SCOPES.INTERNAL,
    ...computeSlaTimes(policy, start, holidays),
    response_sla_status: 'Pending',
    resolution_sla_status: 'Pending'
  };
}

// SQL condition for one SLA state. Shared by ticket lists, SLA dashboard and cron
// so every screen counts the same tickets. Rows created before warning times were
// stored fall back to "4 hours before due".
function slaStateCondition(state, alias = "t") {
  const col = (name) => `${alias}.${name}`;
  const status = (name) => `COALESCE(${col(name)}, 'Pending')`;
  const breached = `(${status("response_sla_status")} = 'Breached' OR ${status("resolution_sla_status")} = 'Breached')`;
  const cancelled = `(${status("response_sla_status")} = 'Cancelled' OR ${status("resolution_sla_status")} = 'Cancelled')`;
  const open = `(NOT ${breached} AND NOT ${cancelled} AND ${status("resolution_sla_status")} <> 'Met')`;
  const fallback = `INTERVAL '${DUE_SOON_MAX_MINUTES} minutes'`;
  const dueSoon = `(${open} AND (
    (${col("first_response_at")} IS NULL AND COALESCE(${col("response_warning_at")}, ${col("response_due_at")} - ${fallback}) <= NOW())
    OR (${col("resolved_at")} IS NULL AND COALESCE(${col("resolution_warning_at")}, ${col("resolution_due_at")} - ${fallback}) <= NOW())
  ))`;

  switch (String(state || "").toLowerCase()) {
    case "breached": return breached;
    case "met": return `(${status("resolution_sla_status")} = 'Met' AND NOT ${breached})`;
    case "warning":
    case "due_soon": return dueSoon;
    case "active":
    case "on_track": return `(${open} AND NOT ${dueSoon})`;
    default: return "1=0";
  }
}

// Label for a ticket row joined with its policy as
// sp.scope, sp.severity_label, sp.origin_system AS policy_origin_system.
function describeSlaPolicy(row) {
  if (!row) return null;
  if ((row.scope || row.sla_scope) !== SLA_SCOPES.CONNECTED_SYSTEM) return "Internal ITSM SLA";
  const policy = row.policy_origin_system ? `${row.policy_origin_system} SLA` : "Connected-System Standard SLA";
  const severity = row.severity_label ? ` (${row.severity_label})` : "";
  return row.origin_system ? `${row.origin_system} · ${policy}${severity}` : `${policy}${severity}`;
}

module.exports = {
  SLA_SCOPES,
  DUE_SOON_MAX_MINUTES,
  addBusinessMinutes,
  computeSlaTimes,
  resolveSlaPolicy,
  applySlaToNewTicket,
  slaStateCondition,
  describeSlaPolicy,
};
