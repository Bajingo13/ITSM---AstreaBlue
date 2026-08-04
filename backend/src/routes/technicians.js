const express = require("express");
const db = require("../../config/db");
const {
  getRequestContext,
  requireAuthenticatedTicketUser,
} = require("./_ticketAccess");

const router = express.Router();

router.use(requireAuthenticatedTicketUser);

router.get("/", async (req, res) => {
  try {
    const actor = getRequestContext(req);
    if (!["superadmin", "admin", "technician"].includes(actor.roleName)) {
      return res.status(403).json({
        success: false,
        error: "Technician assignment options are limited to Service Desk roles.",
      });
    }

    let effectiveBranchId = null;
    const requestedBranchId = Number(req.query.branch_id || req.query.current_branch_id);
    const ticketId = Number(req.query.ticket_id);

    if (Number.isInteger(ticketId) && ticketId > 0) {
      const ticketResult = await db.query(
        `SELECT branch_id FROM tickets WHERE id = $1 LIMIT 1`,
        [ticketId]
      );
      if (!ticketResult.rows.length) {
        return res.status(404).json({ success: false, error: "Ticket not found." });
      }
      effectiveBranchId = Number(ticketResult.rows[0].branch_id) || null;
      if (
        actor.roleName !== "superadmin" &&
        Number(effectiveBranchId) !== Number(actor.branchId)
      ) {
        return res.status(403).json({
          success: false,
          error: "Ticket access is limited to your assigned branch.",
        });
      }
    } else if (actor.roleName === "superadmin") {
      effectiveBranchId = Number.isInteger(requestedBranchId) && requestedBranchId > 0
        ? requestedBranchId
        : null;
    } else {
      effectiveBranchId = Number(actor.branchId) || null;
    }

    if (actor.roleName !== "superadmin" && !effectiveBranchId) {
      return res.json([]);
    }

    const params = [];
    const filters = [];
    if (effectiveBranchId) {
      params.push(effectiveBranchId);
      filters.push(`u.branch_id = $${params.length}`);
    }
    if (actor.roleName === "technician") {
      params.push(actor.currentUserId);
      filters.push(`u.user_id = $${params.length}`);
    }

    const result = await db.query(
      `SELECT u.user_id,u.full_name,u.email,u.branch_id,
              COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,
              sr.role_name
         FROM users u
         JOIN system_roles sr ON u.role_id = sr.role_id
         LEFT JOIN branches b ON u.branch_id = b.branch_id
        WHERE LOWER(sr.role_name) = 'technician'
          AND COALESCE(u.is_active, TRUE) = TRUE
          AND LOWER(COALESCE(u.status, 'Active')) NOT IN ('inactive','disabled','deactivated')
          ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
        ORDER BY u.full_name ASC`,
      params
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("Fetch technicians error:", err.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch technicians",
    });
  }
});

module.exports = router;
