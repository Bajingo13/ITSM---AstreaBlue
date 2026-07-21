const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  getDefaultTasks,
  canTransition,
  canCompleteCase,
  canUpdateLifecycleTask,
} = require("../src/services/employeeLifecycleService");

test("onboarding and offboarding templates contain the required operational gates", () => {
  const onboarding = getDefaultTasks("Onboarding");
  const offboarding = getDefaultTasks("Offboarding");
  assert.ok(onboarding.some((task) => task.taskKey === "general_consent"));
  assert.ok(onboarding.some((task) => task.taskKey === "verify_endpoint"));
  assert.ok(offboarding.some((task) => task.taskKey === "recover_assets"));
  assert.ok(offboarding.some((task) => task.taskKey === "audit_licenses"));
  assert.ok(offboarding.some((task) => task.taskKey === "close_linked_ticket"));
  assert.ok([...onboarding, ...offboarding].every((task) => task.required));
});

test("completion is gated and terminal cases cannot be reopened implicitly", () => {
  assert.equal(canCompleteCase({ requiredPending: 1 }), false);
  assert.equal(canCompleteCase({ requiredPending: 0 }), true);
  assert.equal(canTransition("Ready for Verification", "Completed"), true);
  assert.equal(canTransition("In Progress", "Completed"), false);
  assert.equal(canTransition("Completed", "In Progress"), false);
});

test("HR is limited to HR checklist work while Admin and SuperAdmin retain IT authority", () => {
  assert.equal(canUpdateLifecycleTask("HR", "HR"), true);
  assert.equal(canUpdateLifecycleTask("HR", "IT"), false);
  assert.equal(canUpdateLifecycleTask("Admin", "IT"), true);
  assert.equal(canUpdateLifecycleTask("SuperAdmin", "IT"), true);
  assert.equal(canUpdateLifecycleTask("Employee", "HR"), false);
});

test("Phase 0 lifecycle files do not mutate endpoint identity, consent, or policy storage", () => {
  const files = [
    path.join(__dirname, "..", "database", "2026-07-21-employee-lifecycle-foundation.sql"),
    path.join(__dirname, "..", "src", "routes", "employeeLifecycle.js"),
  ];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+(?:monitored_devices|device_credentials|consent_documents|endpoint_effective_policies)/i);
  }
});
