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

  if (normalizedRole === "admin" && branchId) {
    params.push(branchId);
    clauses.push(`(${alias}.branch_id = $${params.length} OR ${alias}.branch_id IS NULL)`);
  }

  if (normalizedRole === "technician" && currentUserId) {
    params.push(currentUserId);
    const technicianParam = params.length;

    if (branchId) {
      params.push(branchId);
      const branchParam = params.length;
      clauses.push(`(${alias}.assigned_to = $${technicianParam} OR (${alias}.assigned_to IS NULL AND (${alias}.branch_id = $${branchParam} OR ${alias}.branch_id IS NULL)))`);
    } else {
      clauses.push(`(${alias}.assigned_to = $${technicianParam} OR ${alias}.assigned_to IS NULL)`);
    }
  }

  return clauses;
}

module.exports = {
  getRequestContext,
  addTicketAccessFilter,
};
