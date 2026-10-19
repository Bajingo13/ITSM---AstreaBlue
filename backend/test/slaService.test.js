process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../config/db");
const {
  addBusinessMinutes,
  computeSlaTimes,
  resolveSlaPolicy,
  slaStateCondition,
  describeSlaPolicy,
} = require("../src/services/slaService");

// Asia/Manila is UTC+8, so "10:00 Manila" is "02:00Z".
const manila = (local) => new Date(`${local}+08:00`);

test.after(async () => {
  await db.rawPool.end();
});

test("business minutes inside one business day", () => {
  assert.deepEqual(addBusinessMinutes(manila("2026-10-19T10:00:00"), 120), manila("2026-10-19T12:00:00"));
});

test("business minutes carry over the weekend", () => {
  // Friday 16:00 + 2h = 1h Friday + 1h Monday.
  assert.deepEqual(addBusinessMinutes(manila("2026-10-16T16:00:00"), 120), manila("2026-10-19T09:00:00"));
});

test("tickets filed on a weekend start at Monday 08:00", () => {
  assert.deepEqual(addBusinessMinutes(manila("2026-10-17T10:00:00"), 120), manila("2026-10-19T10:00:00"));
});

test("tickets filed after 17:00 or before 08:00 start at the next opening", () => {
  assert.deepEqual(addBusinessMinutes(manila("2026-10-15T18:30:00"), 30), manila("2026-10-16T08:30:00"));
  assert.deepEqual(addBusinessMinutes(manila("2026-10-19T07:00:00"), 60), manila("2026-10-19T09:00:00"));
});

test("business holidays are skipped", () => {
  // 1 Business Day (540 min) from Friday 16:00; Monday Nov 2 is All Souls' Day.
  const due = addBusinessMinutes(manila("2026-10-30T16:00:00"), 540, new Set(["2026-11-02"]));
  assert.deepEqual(due, manila("2026-11-03T16:00:00"));
});

test("connected-system S1 runs on clock hours with a proportional warning", () => {
  const start = manila("2026-10-17T23:00:00"); // Saturday night: S1 is 24x7.
  const times = computeSlaTimes({
    response_target_mins: 30, resolution_target_mins: 240,
    response_calendar: "24x7", resolution_calendar: "24x7",
  }, start);
  assert.deepEqual(times.response_due_at, manila("2026-10-17T23:30:00"));
  assert.deepEqual(times.resolution_due_at, manila("2026-10-18T03:00:00"));
  // Warning when 25% of the target remains: 8 min before response, 60 min before restoration.
  assert.deepEqual(times.response_warning_at, manila("2026-10-17T23:22:00"));
  assert.deepEqual(times.resolution_warning_at, manila("2026-10-18T02:00:00"));
});

test("connected-system S2 counts business hours", () => {
  const times = computeSlaTimes({
    response_target_mins: 120, resolution_target_mins: 540,
    response_calendar: "business_hours", resolution_calendar: "business_hours",
  }, manila("2026-10-16T15:00:00"));
  assert.deepEqual(times.response_due_at, manila("2026-10-16T17:00:00"));
  assert.deepEqual(times.resolution_due_at, manila("2026-10-19T15:00:00"));
  // 25% of 540 = 135 min, capped at 240: warn 135 business minutes before due.
  assert.deepEqual(times.resolution_warning_at, manila("2026-10-19T12:45:00"));
});

test("long internal targets warn at most 4 hours ahead", () => {
  const start = manila("2026-10-19T10:00:00");
  const times = computeSlaTimes({ response_target_mins: 240, resolution_target_mins: 1440 }, start);
  assert.deepEqual(times.resolution_due_at, manila("2026-10-20T10:00:00"));
  assert.deepEqual(times.resolution_warning_at, manila("2026-10-20T06:00:00"));
});

test("SLA state filters share one definition", () => {
  assert.equal(slaStateCondition("unknown"), "1=0");
  assert.match(slaStateCondition("warning", "tickets"), /tickets\.resolution_warning_at/);
  assert.match(slaStateCondition("active", "t"), /NOT/);
});

test("policy labels name the SLA a connected-system ticket follows", () => {
  assert.equal(describeSlaPolicy({ scope: "internal" }), "Internal ITSM SLA");
  assert.equal(
    describeSlaPolicy({ scope: "connected_system", severity_label: "S1 Critical", origin_system: "EIS" }),
    "EIS · Connected-System Standard SLA (S1 Critical)"
  );
});

test("connected-system tickets use the standard unless the system has its own SLA", async () => {
  const internal = await resolveSlaPolicy({ priority: "P1-Critical" });
  assert.equal(internal.scope, "internal");

  const standard = await resolveSlaPolicy({ priority: "P1-Critical", originSystem: "EIS", connectedSystem: true });
  assert.equal(standard.scope, "connected_system");
  assert.equal(standard.origin_system, null);
  assert.equal(standard.response_target_mins, 30);

  const systemName = `SLA_TEST_${process.pid}`;
  const own = await db.query(
    `INSERT INTO sla_policies (name, priority, response_target_mins, resolution_target_mins, scope, origin_system)
     VALUES ($1, 'P1-Critical', 10, 60, 'connected_system', $2) RETURNING policy_id`,
    [`${systemName} S1`, systemName]
  );
  try {
    const override = await resolveSlaPolicy({ priority: "P1-Critical", originSystem: systemName, connectedSystem: true });
    assert.equal(override.policy_id, own.rows[0].policy_id);
    const other = await resolveSlaPolicy({ priority: "P1-Critical", originSystem: "HRIS", connectedSystem: true });
    assert.equal(other.policy_id, standard.policy_id);
  } finally {
    await db.query("DELETE FROM sla_policies WHERE policy_id = $1", [own.rows[0].policy_id]);
  }
});
