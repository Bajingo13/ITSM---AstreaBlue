function normalizeRole(role) {
  return String(role || "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
}

function getHardwareAssetAccessFilter({
  role,
  userId,
  branchId,
  filterBranchId = null,
  alias = "a",
} = {}) {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === "superadmin") {
    return filterBranchId
      ? { whereSql: `WHERE ${alias}.branch_id = $1`, params: [filterBranchId] }
      : { whereSql: "", params: [] };
  }

  if (normalizedRole === "admin" || normalizedRole === "technician") {
    return branchId
      ? { whereSql: `WHERE ${alias}.branch_id = $1`, params: [branchId] }
      : { whereSql: "WHERE 1=0", params: [] };
  }

  if (normalizedRole === "employee") {
    return userId
      ? { whereSql: `WHERE ${alias}.employee_id = $1`, params: [userId] }
      : { whereSql: "WHERE 1=0", params: [] };
  }

  return { whereSql: "WHERE 1=0", params: [] };
}

module.exports = {
  getHardwareAssetAccessFilter,
  normalizeRole,
};
