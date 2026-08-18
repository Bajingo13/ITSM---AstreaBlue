function normalizeRole(role) {
  return String(role || "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
}

function getHardwareAssetAccessFilter({
  role,
  userId,
  employeeNumber,
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
    if (!userId) return { whereSql: "WHERE 1=0", params: [] };
    const params = [userId];
    let legacyOwnership = `${alias}.employee_id = $1::text`;
    if (employeeNumber) {
      params.push(employeeNumber);
      legacyOwnership += ` OR ${alias}.employee_id = $2`;
    }
    return {
      whereSql: `WHERE (${alias}.assigned_to = $1 OR (${alias}.assigned_to IS NULL AND (${legacyOwnership})))`,
      params,
    };
  }

  return { whereSql: "WHERE 1=0", params: [] };
}

module.exports = {
  getHardwareAssetAccessFilter,
  normalizeRole,
};
