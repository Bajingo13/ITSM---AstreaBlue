const jwt = require("jsonwebtoken");

function getRequestContext(req) {
  const body = req.body || {};
  const authHeader = req.headers.authorization || "";
  let authenticatedUser = null;

  if (authHeader.startsWith("Bearer ")) {
    try {
      authenticatedUser = jwt.verify(
        authHeader.slice(7),
        process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod"
      );
    } catch {
      authenticatedUser = null;
    }
  }

  return {
    authenticated: Boolean(authenticatedUser?.userId),
    currentUserId: authenticatedUser?.userId || null,
    roleName: authenticatedUser?.role || null,
    branchId: authenticatedUser?.branchId || null,
    filterBranchId: req.query.filter_branch_id || body.filter_branch_id || null, // Validated against role below
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
      clauses.push(`${branchExpression} = $${params.length}`);
    }
    return clauses;
  }

  // Centralized external-system tickets are enterprise records. They remain
  // exclusive to SuperAdmin; branch and assignment rules below apply only to
  // the existing internal Service Desk workflow.
  clauses.push(`${alias}.integration_id IS NULL`);
  clauses.push(`${alias}.origin_system IS NULL`);
  clauses.push(`COALESCE(${alias}.created_via, '') <> 'External API'`);

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
      clauses.push(`${branchExpression} = $${branchParam}`);
      clauses.push(`(${alias}.assigned_to = $${technicianParam} OR ${alias}.assigned_to IS NULL)`);
    } else {
      // Fail closed when a technician token has no branch. They may retain
      // access to work already assigned to them, but never the open queue.
      clauses.push(`${alias}.assigned_to = $${technicianParam}`);
    }
    return clauses;
  }

  return ["1 = 0"];
}

module.exports = {
  getRequestContext,
  addTicketAccessFilter,
};
