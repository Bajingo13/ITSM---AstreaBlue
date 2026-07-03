const express = require('express');
const db = require('../../config/db');
const router = express.Router();

const { addTicketAccessFilter } = require('./_ticketAccess');
const DUE_SOON_MINUTES = 240;

router.get('/dashboard', async (req, res) => {
  try {
    const { assigned_to, priority } = req.query;
    
    // Build filter clauses using shared RBAC logic
    const params = [];
    const accessClauses = addTicketAccessFilter(req, params, "tickets");
    
    // Status filter
    accessClauses.push("status != 'Cancelled'");
    
    if (assigned_to) { params.push(assigned_to); accessClauses.push(`assigned_to = $${params.length}`); }
    if (priority) { params.push(priority); accessClauses.push(`priority = $${params.length}`); }

    const whereSql = accessClauses.length ? `WHERE ${accessClauses.join(" AND ")}` : "";

    // 1. Fetch tickets to calculate stats
    const query = `
      SELECT 
        id, 
        status, 
        response_sla_status, 
        resolution_sla_status, 
        first_response_at, 
        created_at, 
        resolved_at, 
        closed_at,
        response_due_at,
        resolution_due_at
      FROM tickets
      ${whereSql}
    `;
    const { rows: tickets } = await db.query(query, params);

    let activeSLA = 0, dueSoon = 0, breached = 0, met = 0;
    let totalResponseTime = 0, responseCount = 0;
    let totalResolutionTime = 0, resolutionCount = 0;

    const now = new Date();

    for (const t of tickets) {
      const isResolved = t.status === 'Resolved' || t.status === 'Closed';
      const isActive = !['Resolved', 'Closed', 'Cancelled'].includes(t.status);
      
      // Calculate active
      if (isActive) activeSLA++;

      // Calculate Met/Breached
      if (t.resolution_sla_status === 'Met' || t.response_sla_status === 'Met') {
        // If it's already resolved and met
        if (isResolved && t.resolution_sla_status === 'Met') met++;
        else if (!isResolved && t.response_sla_status === 'Met') met++;
      }
      
      if (t.resolution_sla_status === 'Breached' || t.response_sla_status === 'Breached') breached++;
      
      // Count an active ticket once when either outstanding SLA target is due within four hours.
      const isBreached = t.resolution_sla_status === 'Breached' || t.response_sla_status === 'Breached';
      if (isActive && !isBreached) {
        const responseMinutes = !t.first_response_at && t.response_due_at
          ? (new Date(t.response_due_at) - now) / 60000
          : null;
        const resolutionMinutes = !t.resolved_at && t.resolution_due_at
          ? (new Date(t.resolution_due_at) - now) / 60000
          : null;
        const responseDueSoon = responseMinutes !== null && responseMinutes > 0 && responseMinutes <= DUE_SOON_MINUTES;
        const resolutionDueSoon = resolutionMinutes !== null && resolutionMinutes > 0 && resolutionMinutes <= DUE_SOON_MINUTES;
        if (responseDueSoon || resolutionDueSoon) dueSoon++;
      }

      // Calculate avg response time (mins)
      if (t.first_response_at && t.created_at) {
        totalResponseTime += (new Date(t.first_response_at) - new Date(t.created_at)) / 60000;
        responseCount++;
      }
      
      // Calculate avg resolution time (mins)
      if (isResolved && (t.resolved_at || t.closed_at) && t.created_at) {
        const end = t.resolved_at || t.closed_at;
        totalResolutionTime += (new Date(end) - new Date(t.created_at)) / 60000;
        resolutionCount++;
      }
    }

    const totalTracked = met + breached;
    const compliancePercent = totalTracked > 0 ? Math.round((met / totalTracked) * 100) : 100;
    
    res.json({
      success: true,
      stats: {
        activeSLA,
        dueSoon,
        breached,
        met,
        compliancePercent,
        avgResponseTimeMins: responseCount > 0 ? Math.round(totalResponseTime / responseCount) : 0,
        avgResolutionTimeMins: resolutionCount > 0 ? Math.round(totalResolutionTime / resolutionCount) : 0
      }
    });

  } catch (err) {
    console.error("SLA Dashboard error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Policies CRUD
router.get('/policies', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM sla_policies ORDER BY policy_id ASC');
    res.json({ success: true, policies: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/history', async (req, res) => {
  try {
    const params = [];
    const accessClauses = addTicketAccessFilter(req, params, "t");
    const accessSql = accessClauses.length ? `AND ${accessClauses.join(" AND ")}` : "";

    const query = `
      SELECT 
        th.history_id,
        th.ticket_id,
        t.ticket_number,
        t.title as ticket_title,
        th.action,
        th.old_value,
        th.new_value,
        th.created_at,
        u.full_name as changed_by_name
      FROM ticket_history th
      JOIN tickets t ON th.ticket_id = t.id
      LEFT JOIN users u ON th.changed_by = u.user_id
      WHERE (th.action = 'Response SLA' OR th.action = 'Resolution SLA')
      ${accessSql}
      ORDER BY th.created_at DESC
      LIMIT 20
    `;
    const { rows } = await db.query(query, params);
    res.json({ success: true, history: rows });
  } catch (err) {
    console.error("SLA History error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
