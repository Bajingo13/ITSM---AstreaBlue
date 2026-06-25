function getRequestContext(req) {
  const body = req.body || {};

  return {
    currentUserId:
      req.query.current_user_id ||
      body.current_user_id ||
      req.query.user_id ||
      body.user_id ||
      null,
    roleName: req.query.role_name || body.role_name || null,
    branchId:
      req.query.branch_id ||
      body.current_branch_id ||
      body.branch_id ||
      null,
    filterBranchId: req.query.filter_branch_id || body.filter_branch_id || null,
  };
}

function addTicketAccessFilter(req, params, alias = "t") {
  const { currentUserId, roleName, branchId, filterBranchId } = getRequestContext(req);
  const normalizedRole = String(roleName || "").toLowerCase();
  const branchExpression = `${alias}.branch_id`;
  const clauses = [];

  if (normalizedRole === "superadmin") {
    if (filterBranchId) {
      params.push(filterBranchId);
      clauses.push(`${alias}.branch_id = $${params.length}`);
    }
    return clauses;
  }

  if (normalizedRole === "employee" && currentUserId) {
    params.push(currentUserId);
    clauses.push(`${alias}.requester_id = $${params.length}`);
    return clauses;
  }

  if (normalizedRole === "admin") {
    if (!branchId) return ["1 = 0"];
    params.push(branchId);
    clauses.push(`${branchExpression} = $${params.length}`);
    return clauses;
  }

  if (normalizedRole === "technician" && currentUserId) {
    params.push(currentUserId);
    const technicianParam = params.length;

    if (branchId) {
      params.push(branchId);
      const branchParam = params.length;
      clauses.push(`(${alias}.assigned_to = $${technicianParam} OR (${alias}.assigned_to IS NULL AND ${branchExpression} = $${branchParam}))`);
    } else {
      clauses.push(`(${alias}.assigned_to = $${technicianParam} OR ${alias}.assigned_to IS NULL)`);
    }
  }

  if (normalizedRole && clauses.length === 0) return ["1 = 0"];

  return clauses.length ? clauses : ["1 = 0"];
}

module.exports = {
  getRequestContext,
  addTicketAccessFilter,
};
