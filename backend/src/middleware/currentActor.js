const db = require("../../config/db");
const { getAuthFromRequest } = require("./legacyJwtAuth");

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]/g, "");
}

async function loadCurrentActor(req) {
  const claim = getAuthFromRequest(req);
  const actorId = Number(claim?.userId || claim?.user_id);
  if (!Number.isInteger(actorId) || actorId <= 0) return null;

  const result = await db.query(
    `SELECT u.user_id,u.full_name,u.employee_number,u.branch_id,u.is_active,u.status,r.role_name
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
  if (!actor || actor.is_active === false || inactiveStatus) return null;

  return {
    userId: Number(actor.user_id),
    fullName: actor.full_name,
    employeeNumber: actor.employee_number || null,
    role: normalizeRole(actor.role_name),
    branchId: actor.branch_id == null ? null : Number(actor.branch_id),
  };
}

function requireCurrentRoles(...allowedRoles) {
  const allowed = new Set(allowedRoles.map(normalizeRole));
  return async (req, res, next) => {
    try {
      const actor = await loadCurrentActor(req);
      if (!actor) {
        return res.status(401).json({ success: false, error: "Authentication required." });
      }
      if (allowed.size && !allowed.has(actor.role)) {
        return res.status(403).json({ success: false, error: "Access denied for your role." });
      }
      req.currentActor = actor;
      return next();
    } catch (error) {
      console.error("[current-actor] Failed to resolve authenticated account:", error.message);
      return res.status(503).json({ success: false, error: "Authorization service is temporarily unavailable." });
    }
  };
}

module.exports = { loadCurrentActor, normalizeRole, requireCurrentRoles };
