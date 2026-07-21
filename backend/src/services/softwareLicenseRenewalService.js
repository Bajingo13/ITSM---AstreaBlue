function toDateOnly(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function computeSoftwareLicenseStatus(expiryDate, todayValue = new Date()) {
  if (!expiryDate) return "Active";
  const today = new Date(todayValue);
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${String(expiryDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return "Active";
  if (expiry < today) return "Expired";
  const daysRemaining = Math.ceil((expiry - today) / 86400000);
  return daysRemaining <= 30 ? "Expiring Soon" : "Active";
}

function validateLicenseRenewal({ currentExpiryDate, newExpiryDate, annualCost }) {
  const currentExpiry = toDateOnly(currentExpiryDate);
  const nextExpiry = toDateOnly(newExpiryDate);
  if (!nextExpiry) return { valid: false, message: "A valid new expiry date is required." };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = new Date(`${nextExpiry}T00:00:00`);
  if (next < today) return { valid: false, message: "The renewed expiry date cannot be in the past." };
  if (currentExpiry && nextExpiry <= currentExpiry) {
    return { valid: false, message: "The renewed expiry date must be later than the current expiry date." };
  }

  if (annualCost !== undefined && annualCost !== null && annualCost !== "") {
    const parsedCost = Number(annualCost);
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      return { valid: false, message: "Renewal cost must be a valid non-negative number." };
    }
  }

  return { valid: true, newExpiryDate: nextExpiry };
}

module.exports = {
  computeSoftwareLicenseStatus,
  validateLicenseRenewal,
};
