function normalizeRole(role) {
  return String(role || "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
}

function getEndpointMonitoringAccessFilter({
  role,
  userId,
  branchId,
  alias = "d",
} = {}) {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === "superadmin") {
    return { whereSql: "", params: [] };
  }

  if (normalizedRole === "admin" || normalizedRole === "technician") {
    return branchId
      ? { whereSql: `WHERE ${alias}.branch_id = $1`, params: [branchId] }
      : { whereSql: "WHERE 1=0", params: [] };
  }

  if (normalizedRole === "employee") {
    return userId
      ? { whereSql: `WHERE ${alias}.assigned_user_id = $1`, params: [userId] }
      : { whereSql: "WHERE 1=0", params: [] };
  }

  return { whereSql: "WHERE 1=0", params: [] };
}

module.exports = {
  getEndpointMonitoringAccessFilter,
  normalizeRole,
};
