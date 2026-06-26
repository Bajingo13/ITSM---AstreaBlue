const express = require("express");
const db = require("../../config/db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const {
      branch_id,
      current_branch_id,
      current_role,
      role_name,
      current_user_id,
      ticket_id,
    } = req.query;
    const actorRole = String(current_role || role_name || "").toLowerCase();

    const params = [];
    const filters = [];

    if (actorRole === "employee") {
      return res.status(403).json({
        success: false,
        error: "Employees cannot view technician assignment options.",
      });
    }

    if (ticket_id) {
      const ticketResult = await db.query(
        `SELECT branch_id FROM tickets WHERE id = $1 LIMIT 1`,
        [ticket_id]
      );

      if (ticketResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Ticket not found.",
        });
      }

      const ticketBranchId = ticketResult.rows[0]?.branch_id;

      if (ticketBranchId) {
        params.push(ticketBranchId);
        filters.push(`u.branch_id = $${params.length}`);
      } else {
        return res.json([]);
      }
    }

    if (actorRole === "admin") {
      const adminBranchId = current_branch_id || branch_id;

      if (!adminBranchId) {
        return res.json([]);
      }

      params.push(adminBranchId);
      filters.push(`u.branch_id = $${params.length}`);
    } else if (actorRole === "technician") {
      if (current_user_id) {
        params.push(current_user_id);
        filters.push(`u.user_id = $${params.length}`);
      } else if (current_branch_id || branch_id) {
        params.push(current_branch_id || branch_id);
        filters.push(`u.branch_id = $${params.length}`);
      } else {
        return res.json([]);
      }
    } else if (!actorRole && branch_id) {
      params.push(branch_id);
      filters.push(`u.branch_id = $${params.length}`);
    }

    const result = await db.query(
      `
      SELECT
        u.user_id,
        u.full_name,
        u.email,
        u.branch_id,
        COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,
        sr.role_name
      FROM users u
      JOIN system_roles sr
        ON u.role_id = sr.role_id
      LEFT JOIN branches b
        ON u.branch_id = b.branch_id
      WHERE LOWER(sr.role_name) = 'technician'
        AND COALESCE(u.is_active, TRUE) = TRUE
        ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
      ORDER BY u.full_name ASC
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch technicians error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch technicians",
    });
  }
});

module.exports = router;
