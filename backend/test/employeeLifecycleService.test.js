const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  getDefaultTasks,
  canTransition,
  canCompleteCase,
  deriveOffboardingStatusAfterTask,
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

test("offboarding progresses automatically but keeps final completion as a human verification gate", () => {
  assert.equal(deriveOffboardingStatusAfterTask({
    lifecycleType: "Offboarding", currentStatus: "Draft", taskStatus: "Completed", requiredPending: 7,
  }), "In Progress");
  assert.equal(deriveOffboardingStatusAfterTask({
    lifecycleType: "Offboarding", currentStatus: "In Progress", taskStatus: "Completed", requiredPending: 0,
  }), "Ready for Verification");
  assert.equal(deriveOffboardingStatusAfterTask({
    lifecycleType: "Onboarding", currentStatus: "Draft", taskStatus: "Completed", requiredPending: 0,
  }), "Draft");
  assert.equal(deriveOffboardingStatusAfterTask({
    lifecycleType: "Offboarding", currentStatus: "Completed", taskStatus: "Completed", requiredPending: 0,
  }), "Completed");
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

test("internal offboarding has no cross-system integration and preserves monitoring credentials", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "services", "internalOffboardingService.js"), "utf8");
  assert.doesNotMatch(source, /axios|fetch\s*\(|nodemailer|resend|hris|vpn|cloud service/i);
  assert.doesNotMatch(source, /(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+(?:device_credentials|consent_documents|endpoint_effective_policies)/i);
  assert.match(source, /UPDATE monitored_devices SET assigned_user_id=NULL/i);
});
