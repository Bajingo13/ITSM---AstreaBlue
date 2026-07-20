const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getAssetVerificationStatus,
  getCurrentMonitoringStatus,
} = require("../src/services/assetVerificationService");

test("unlinked assets are not included in endpoint verification", () => {
  assert.equal(getAssetVerificationStatus({}), "Not Monitored");
});

test("linked assets remain pending until inventory and reconciliation are complete", () => {
  assert.equal(getAssetVerificationStatus({ monitoring_device_id: 7 }), "Pending");
  assert.equal(getAssetVerificationStatus({
    monitoring_device_id: 7,
    inventory_scanned_at: "2026-07-20T00:00:00.000Z",
    reconciliation_match_count: 2,
    reconciliation_unknown_count: 1,
  }), "Pending");
});

test("any reconciliation mismatch makes the asset mismatched", () => {
  assert.equal(getAssetVerificationStatus({
    monitoring_device_id: 7,
    inventory_scanned_at: "2026-07-20T00:00:00.000Z",
    reconciliation_match_count: 2,
    reconciliation_mismatch_count: 1,
  }), "Mismatched");
});

test("fully reconciled inventory is verified", () => {
  assert.equal(getAssetVerificationStatus({
    monitoring_device_id: 7,
    inventory_scanned_at: "2026-07-20T00:00:00.000Z",
    reconciliation_match_count: 3,
    reconciliation_unknown_count: 0,
    reconciliation_mismatch_count: 0,
  }), "Verified");
});

test("monitoring status is calculated from heartbeat freshness", () => {
  const now = new Date("2026-07-20T10:00:00.000Z");
  assert.equal(getCurrentMonitoringStatus("2026-07-20T09:59:00.000Z", { now, thresholdSeconds: 120 }), "Online");
  assert.equal(getCurrentMonitoringStatus("2026-07-20T09:57:59.000Z", { now, thresholdSeconds: 120 }), "Offline");
  assert.equal(getCurrentMonitoringStatus(null, { now, thresholdSeconds: 120 }), "Offline");
});
