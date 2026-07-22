const jwt = require("jsonwebtoken");
const db = require("../../config/db");

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]/g, "");
}

function decodeRequestToken(req) {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(
      authHeader.slice(7),
      process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod"
    );
  } catch {
    return null;
  }
}

function getRequestContext(req) {
  if (req.ticketAccessContext?.authenticated) return req.ticketAccessContext;
  const body = req.body || {};
  const authenticatedUser = decodeRequestToken(req);

  return {
    authenticated: Boolean(authenticatedUser?.userId),
    currentUserId: authenticatedUser?.userId || null,
    roleName: normalizeRole(authenticatedUser?.role) || null,
    branchId: authenticatedUser?.branchId || null,
    filterBranchId: req.query.filter_branch_id || body.filter_branch_id || null, // Validated against role below
  };
}

function addTicketAccessFilter(req, params, alias = "t") {
  const { currentUserId, roleName, branchId, filterBranchId } = getRequestContext(req);
  const normalizedRole = normalizeRole(roleName);
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

  if (normalizedRole === "hr" && currentUserId) {
    if (!branchId) return ["1 = 0"];
    params.push(branchId);
    const branchParam = params.length;
    params.push(currentUserId);
    const actorParam = params.length;
    clauses.push(`${branchExpression} = $${branchParam}`);
    clauses.push(`(
      EXISTS (
        SELECT 1 FROM employee_lifecycle_cases lifecycle_case
        WHERE lifecycle_case.related_ticket_id = ${alias}.id
          AND lifecycle_case.branch_id = $${branchParam}
      )
      OR EXISTS (
        SELECT 1 FROM ticket_history creation_history
        WHERE creation_history.ticket_id = ${alias}.id
          AND creation_history.action = 'Ticket Created'
          AND creation_history.changed_by = $${actorParam}
      )
    )`);
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

    clauses.push(`COALESCE((
      SELECT category.visibility_scope
      FROM ticket_categories category
      WHERE category.category_id = ${alias}.category_id
    ), 'standard') = 'standard'`);

    // Onboarding is coordinated in the HR/Admin lifecycle workspace. Its
    // generated Service Desk record is not actionable technician queue work.
    clauses.push(`NOT EXISTS (
      SELECT 1
      FROM employee_lifecycle_cases onboarding_case
      WHERE onboarding_case.related_ticket_id = ${alias}.id
        AND LOWER(onboarding_case.lifecycle_type) = 'onboarding'
    )`);

    return clauses;
  }

  return ["1 = 0"];
}

async function requireAuthenticatedTicketUser(req, res, next) {
  const claim = decodeRequestToken(req);
  const actorId = Number(claim?.userId || claim?.user_id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
  try {
    const result = await db.query(
      `SELECT u.user_id,u.branch_id,u.is_active,u.status,r.role_name
         FROM users u
         JOIN system_roles r ON r.role_id=u.role_id
        WHERE u.user_id=$1
        LIMIT 1`,
      [actorId]
    );
    const actor = result.rows[0];
    const inactiveStatus = ["inactive", "disabled", "deactivated"].includes(
      String(actor?.status || "").trim().toLowerCase()
    );
    if (!actor || actor.is_active === false || inactiveStatus) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    req.ticketAccessContext = {
      authenticated: true,
      currentUserId: Number(actor.user_id),
      roleName: normalizeRole(actor.role_name),
      branchId: actor.branch_id == null ? null : Number(actor.branch_id),
      filterBranchId: req.query.filter_branch_id || req.body?.filter_branch_id || null,
    };
    return next();
  } catch (error) {
    console.error("[ticket-access] Failed to resolve authenticated actor:", error.message);
    return res.status(503).json({ success: false, message: "Authorization service is temporarily unavailable." });
  }
}

module.exports = {
  getRequestContext,
  addTicketAccessFilter,
  requireAuthenticatedTicketUser,
};
