function normalizeRole(role) {
  return String(role || "").toLowerCase().replace(/[\s_-]+/g, "");
}

function getSoftwareLicenseScope({ role, branchId }) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "superadmin") {
    return { authorized: true, branchId: null };
  }
  if (normalizedRole === "admin" && branchId) {
    return { authorized: true, branchId: Number(branchId) };
  }
  return { authorized: false, branchId: null };
}

module.exports = {
  getSoftwareLicenseScope,
  normalizeRole,
};
