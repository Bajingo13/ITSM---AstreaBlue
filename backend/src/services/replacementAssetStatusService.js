const ASSIGNED_STATUSES = new Map([
  ["in use", "In Use"],
  ["borrowed", "Borrowed"],
]);

const AVAILABLE_STATUSES = new Map([
  ["active", "Active"],
  ["available", "Available"],
  ["in stock", "In Stock"],
]);

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function resolvePostRepairAssetStatus(previousStatus, assigned) {
  const normalized = normalizeStatus(previousStatus);

  if (assigned) {
    return ASSIGNED_STATUSES.get(normalized) || "In Use";
  }

  return AVAILABLE_STATUSES.get(normalized) || "Available";
}

module.exports = { resolvePostRepairAssetStatus };
