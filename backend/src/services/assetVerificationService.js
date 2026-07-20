const DEFAULT_ONLINE_THRESHOLD_SECONDS = 120;
const REQUIRED_IDENTITY_MATCH_COUNT = 3;

function normalizeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function getAssetVerificationStatus(asset = {}) {
  if (!asset.monitoring_device_id) return "Not Monitored";
  if (!asset.inventory_scanned_at) return "Pending";

  const mismatchCount = normalizeCount(asset.reconciliation_mismatch_count);
  const unknownCount = normalizeCount(asset.reconciliation_unknown_count);
  const matchCount = normalizeCount(asset.reconciliation_match_count);

  if (mismatchCount > 0) return "Mismatched";
  if (matchCount >= REQUIRED_IDENTITY_MATCH_COUNT && unknownCount === 0) return "Verified";
  return "Pending";
}

function getCurrentMonitoringStatus(lastSeenAt, options = {}) {
  if (!lastSeenAt) return "Offline";

  const lastSeenMs = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(lastSeenMs)) return "Offline";

  const nowMs = options.now instanceof Date
    ? options.now.getTime()
    : Number.isFinite(Number(options.now))
      ? Number(options.now)
      : Date.now();
  const configuredThreshold = Number(options.thresholdSeconds);
  const thresholdSeconds = Number.isFinite(configuredThreshold) && configuredThreshold > 0
    ? configuredThreshold
    : DEFAULT_ONLINE_THRESHOLD_SECONDS;

  return nowMs - lastSeenMs <= thresholdSeconds * 1000 ? "Online" : "Offline";
}

module.exports = {
  DEFAULT_ONLINE_THRESHOLD_SECONDS,
  getAssetVerificationStatus,
  getCurrentMonitoringStatus,
};
