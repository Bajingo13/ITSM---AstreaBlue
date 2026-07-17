const express = require('express');
const db = require('../../config/db');
const router = express.Router();
const { addTicketAccessFilter } = require('./_ticketAccess');

// GET /api/v1/calendar/events — Returns ticket events for calendar display
router.get('/events', async (req, res) => {
  try {
    const params = [];
    const accessClauses = addTicketAccessFilter(req, params, "t");

    // Status filter — exclude cancelled unless requested
    accessClauses.push("t.status != 'Cancelled'");

    // Optional filters
    const { branch, technician, priority, status, dateFrom, dateTo, assigned_to } = req.query;

    if (branch && branch !== "all") {
      params.push(branch);
      const branchParam = params.length;
      // Calendar filters historically sent the branch name while some clients
      // send its numeric id. Support both without trying to cast names to int.
      if (/^\d+$/.test(String(branch))) {
        accessClauses.push(`t.branch_id = $${branchParam}::int`);
      } else {
        accessClauses.push(`b.branch_name = $${branchParam}`);
      }
    }

    if (technician === "assigned") {
      accessClauses.push(`t.assigned_to IS NOT NULL`);
    } else if (technician === "unassigned") {
      accessClauses.push(`t.assigned_to IS NULL`);
    }

    if (assigned_to) {
      params.push(assigned_to);
      accessClauses.push(`t.assigned_to = $${params.length}::int`);
    }

    if (priority) {
      const priorities = priority.split(",");
      const placeholders = priorities.map((_, i) => `$${params.length + i + 1}`);
      accessClauses.push(`t.priority IN (${placeholders.join(", ")})`);
      params.push(...priorities);
    }

    if (status) {
      const statuses = status.split(",");
      const placeholders = statuses.map((_, i) => `$${params.length + i + 1}`);
      accessClauses.push(`t.status IN (${placeholders.join(", ")})`);
      params.push(...statuses);
    }

    if (dateFrom) {
      params.push(dateFrom);
      accessClauses.push(`t.created_at >= $${params.length}::timestamp`);
    }
    if (dateTo) {
      params.push(dateTo);
      accessClauses.push(`t.created_at <= $${params.length}::timestamp`);
    }

    const whereSql = accessClauses.length ? `WHERE ${accessClauses.join(" AND ")}` : "";

    const result = await db.query(
      `
      SELECT
        t.id,
        t.ticket_number,
        t.title,
        t.description,
        t.priority,
        t.status,
        t.created_at,
        t.updated_at,
        t.resolution_due_at,
        t.response_due_at,
        t.sla_due_date,
        t.assigned_at,
        t.in_progress_started_at,
        t.resolved_at,
        t.first_response_at,
        t.response_sla_status,
        t.resolution_sla_status,

        c.category_name AS category,

        b.branch_id,
        COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,

        assignee.user_id AS assigned_to,
        assignee.full_name AS assigned_name,
        assignee.email AS assigned_email,

        requester.user_id AS requester_id,
        requester.full_name AS requester_name

      FROM tickets t
      LEFT JOIN ticket_categories c ON t.category_id = c.category_id
      LEFT JOIN branches b ON t.branch_id = b.branch_id
      LEFT JOIN users assignee ON t.assigned_to = assignee.user_id
      LEFT JOIN users requester ON t.requester_id = requester.user_id
      ${whereSql}
      ORDER BY t.created_at DESC
      `,
      params
    );

    const events = result.rows.map((ticket) => ({
      ticket_id: ticket.id,
      ticket_number: ticket.ticket_number || `TKT-${ticket.id}`,
      title: ticket.title,
      description: ticket.description,
      priority: ticket.priority,
      status: ticket.status,
      branch_id: ticket.branch_id,
      branch_name: ticket.branch_name,
      assigned_to: ticket.assigned_to,
      assigned_name: ticket.assigned_name || 'Unassigned',
      assigned_email: ticket.assigned_email,
      requester_name: ticket.requester_name,
      category: ticket.category,
      created_at: ticket.created_at,
      updated_at: ticket.updated_at,
      start_time: ticket.in_progress_started_at || ticket.assigned_at || ticket.created_at,
      end_time: ticket.resolution_due_at || ticket.sla_due_date || ticket.resolved_at,
      sla_status: ticket.resolution_sla_status || ticket.response_sla_status || 'Pending',
    }));

    res.json({ success: true, events, total: events.length });
  } catch (err) {
    console.error('[Calendar /events] error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load calendar events' });
  }
});

module.exports = router;
