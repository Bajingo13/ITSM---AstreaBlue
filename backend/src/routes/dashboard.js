const express = require("express");
const db = require("../../config/db");

const router = express.Router();

function getAccessFilter(req) {
  const role = String(req.query.role_name || "").toLowerCase();
  const branchId = req.query.current_branch_id || req.query.branch_id;
  const userId = req.query.current_user_id || req.query.user_id;

  const params = [];

  if (role === "superadmin") {
    return { whereSql: "", params };
  }

  if ((role === "admin" || role === "technician") && branchId) {
    params.push(branchId);
    return {
      whereSql: `WHERE COALESCE(t.branch_id, requester.branch_id) = $${params.length}`,
      params,
    };
  }

  if (role === "employee" && userId) {
    params.push(userId);
    return {
      whereSql: `WHERE t.requester_id = $${params.length}`,
      params,
    };
  }

  return { whereSql: "", params };
}

router.get("/summary", async (req, res) => {
  try {
    const { whereSql, params } = getAccessFilter(req);

    const statsResult = await db.query(
      `
      SELECT
        COUNT(*)::int AS total_tickets,
        COUNT(*) FILTER (WHERE t.status = 'Open Queue')::int AS open_tickets,
        COUNT(*) FILTER (WHERE t.status = 'In Progress')::int AS in_progress_tickets,
        COUNT(*) FILTER (
          WHERE t.priority = 'P1-Critical'
            AND t.status IN ('Open Queue', 'In Progress')
        )::int AS critical_tickets,
        COUNT(*) FILTER (WHERE t.status = 'Resolved')::int AS resolved_tickets,
        COUNT(*) FILTER (WHERE t.status = 'Closed')::int AS closed_tickets
      FROM tickets t
      LEFT JOIN users requester
        ON t.requester_id = requester.user_id
      ${whereSql}
      `,
      params
    );

    const recentResult = await db.query(
      `
      SELECT
        t.id,
        t.ticket_number,
        t.title,
        t.priority,
        t.status,
        COALESCE(t.branch_id, requester.branch_id) AS branch_id,
        COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,
        t.created_at
      FROM tickets t
      LEFT JOIN users requester
        ON t.requester_id = requester.user_id
      LEFT JOIN branches b
        ON COALESCE(t.branch_id, requester.branch_id) = b.branch_id
      ${whereSql}
      ORDER BY t.created_at DESC
      LIMIT 10
      `,
      params
    );

    const stats = statsResult.rows[0] || {};

    res.json({
      success: true,
      stats: {
        openTickets: stats.open_tickets || 0,
        inProgressTickets: stats.in_progress_tickets || 0,
        criticalTickets: stats.critical_tickets || 0,
        resolvedTickets: stats.resolved_tickets || 0,
        closedTickets: stats.closed_tickets || 0,
        totalTickets: stats.total_tickets || 0,
      },
      recentTickets: recentResult.rows,
    });
  } catch (err) {
    console.error("Dashboard summary error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch dashboard summary",
    });
  }
});

module.exports = router;
