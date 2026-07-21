const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeSoftwareLicenseStatus,
  validateLicenseRenewal,
} = require("../src/services/softwareLicenseRenewalService");
const { REMINDER_DAYS, reminderMessage } = require("../src/services/softwareLicenseReminderService");

test("software license status is derived from the expiry date", () => {
  const today = new Date("2026-07-21T08:00:00+08:00");
  assert.equal(computeSoftwareLicenseStatus("2026-07-20", today), "Expired");
  assert.equal(computeSoftwareLicenseStatus("2026-08-01", today), "Expiring Soon");
  assert.equal(computeSoftwareLicenseStatus("2026-09-30", today), "Active");
});

test("renewal requires a later expiry date and a valid cost", () => {
  assert.equal(validateLicenseRenewal({ currentExpiryDate: "2026-08-01", newExpiryDate: "2026-07-31" }).valid, false);
  assert.equal(validateLicenseRenewal({ currentExpiryDate: "2026-08-01", newExpiryDate: "2027-08-01", annualCost: -1 }).valid, false);
  assert.deepEqual(
    validateLicenseRenewal({ currentExpiryDate: "2026-08-01", newExpiryDate: "2027-08-01", annualCost: 12000 }),
    { valid: true, newExpiryDate: "2027-08-01" }
  );
});

test("license reminders use the approved 30/14/7/1-day schedule", () => {
  assert.deepEqual(REMINDER_DAYS, [30, 14, 7, 1, 0]);
  assert.equal(reminderMessage({ license_name: "Microsoft 365" }, 1), "Microsoft 365 expires in 1 day.");
  assert.equal(reminderMessage({ license_name: "Microsoft 365" }, 0), "Microsoft 365 expires today.");
});
