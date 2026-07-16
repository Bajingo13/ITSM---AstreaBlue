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
    // Ensure ticket_history table exists (safe for Railway cold-start)
    await db.query(`
      CREATE TABLE IF NOT EXISTS ticket_history (
        history_id SERIAL PRIMARY KEY,
        ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
        changed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        action VARCHAR(255) NOT NULL,
        old_value TEXT,
        new_value TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).catch((tableErr) => {
      console.warn('[SLA /history] ticket_history table check skipped:', tableErr.message);
    });

    const params = [];
    const accessClauses = addTicketAccessFilter(req, params, "t");
    const accessSql = accessClauses.length ? `AND ${accessClauses.join(" AND ")}` : "";

    const query = `
      SELECT 
        th.history_id,
        th.ticket_id,
        COALESCE(t.ticket_number, 'TKT-' || th.ticket_id::text) AS ticket_number,
        t.title AS ticket_title,
        th.action,
        th.old_value  AS old_status,
        th.new_value  AS new_status,
        th.created_at,
        u.full_name   AS changed_by
      FROM ticket_history th
      LEFT JOIN tickets t ON th.ticket_id = t.id
      LEFT JOIN users   u ON th.changed_by = u.user_id
      WHERE (th.action = 'Response SLA' OR th.action = 'Resolution SLA')
      ${accessSql}
      ORDER BY th.created_at DESC
      LIMIT 50
    `;

    const { rows } = await db.query(query, params);
    return res.json({ success: true, data: rows, history: rows });
  } catch (err) {
    console.error('[SLA /history] Unexpected error:', {
      route: 'GET /api/v1/sla/history',
      message: err.message,
      code: err.code,
    });
    // Never expose raw stack to frontend
    return res.status(500).json({
      success: false,
      error: 'Failed to load SLA history. Please try again.',
    });
  }
});

router.get('/migrate', async (req, res) => {
  try {
    // 1. Add Knowledge Base updated_at
    await db.query(`ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`).catch(e => console.log('KB migration skipped:', e.message));
    
    // 2. Add SLA columns to tickets
    await db.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS response_due_at TIMESTAMP, ADD COLUMN IF NOT EXISTS resolution_due_at TIMESTAMP, ADD COLUMN IF NOT EXISTS response_sla_status VARCHAR(50) DEFAULT 'Pending', ADD COLUMN IF NOT EXISTS resolution_sla_status VARCHAR(50) DEFAULT 'Pending', ADD COLUMN IF NOT EXISTS sla_policy_id INTEGER;`).catch(e => console.log('Tickets SLA migration skipped:', e.message));

    // 3. Fix SLA Policies category_id type (using raw text UUID cast if needed)
    await db.query(`ALTER TABLE sla_policies ALTER COLUMN category_id TYPE UUID USING category_id::text::uuid;`).catch(e => console.log('SLA Policies category cast skipped:', e.message));

    // 4. Robust Attachments Migration
    await db.query(`
      CREATE TABLE IF NOT EXISTS ticket_attachments (
        attachment_id SERIAL PRIMARY KEY,
        ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
        file_name VARCHAR(255),
        file_path TEXT,
        file_size INTEGER,
        mime_type VARCHAR(100),
        uploaded_by INTEGER REFERENCES users(user_id),
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).catch(e => console.log('Attachments create skipped:', e.message));

    await db.query(`
      ALTER TABLE ticket_attachments
      ADD COLUMN IF NOT EXISTS file_path TEXT,
      ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100),
      ADD COLUMN IF NOT EXISTS uploaded_by INTEGER REFERENCES users(user_id),
      ADD COLUMN IF NOT EXISTS file_size INTEGER,
      ADD COLUMN IF NOT EXISTS file_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `).catch(e => console.log('Attachments columns skipped:', e.message));

    await db.query(`
      ALTER TABLE ticket_attachments ALTER COLUMN file_data DROP NOT NULL
    `).catch(e => console.log('Attachments drop not null skipped:', e.message));

    res.json({ success: true, message: "Database Migrations completed successfully on production!" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// GET /sla/tickets/:id/timeline — Returns SLA lifecycle timeline for a ticket
router.get('/tickets/:id/timeline', async (req, res) => {
  try {
    const { id } = req.params;
    const params = [id];
    const accessClauses = addTicketAccessFilter(req, params, "t");
    const accessSql = accessClauses.length ? `AND ${accessClauses.join(" AND ")}` : "";

    const ticketResult = await db.query(
      `
      SELECT
        t.id,
        t.ticket_number,
        t.title,
        t.status,
        t.created_at,
        t.assigned_at,
        t.in_progress_started_at,
        t.resolved_at,
        t.first_response_at,
        COALESCE(assignee.full_name, 'Unassigned') AS assigned_name,
        t.response_sla_status,
        t.resolution_sla_status
      FROM tickets t
      LEFT JOIN users assignee
        ON t.assigned_to = assignee.user_id
      WHERE t.id = $1
        ${accessSql}
      LIMIT 1
      `,
      params
    );

    if (ticketResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    const ticket = ticketResult.rows[0];

    // Calculate resolution duration if resolved
    let resolutionDuration = null;
    if (ticket.resolved_at && ticket.in_progress_started_at) {
      const diffMs = new Date(ticket.resolved_at) - new Date(ticket.in_progress_started_at);
      const diffHrs = Math.floor(diffMs / 3600000);
      const diffMins = Math.floor((diffMs % 3600000) / 60000);
      resolutionDuration = { hours: diffHrs, minutes: diffMins, totalMs: diffMs };
    }

    res.json({
      success: true,
      timeline: {
        created_at: ticket.created_at,
        assigned_at: ticket.assigned_at,
        assigned_name: ticket.assigned_name,
        in_progress_started_at: ticket.in_progress_started_at,
        resolved_at: ticket.resolved_at,
        resolution_duration: resolutionDuration,
        status: ticket.status,
      },
    });
  } catch (err) {
    console.error('[SLA /tickets/:id/timeline] error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load SLA timeline' });
  }
});
// GET /sla/tickets/:id/technician — Returns assigned technician for a ticket
router.get('/tickets/:id/technician', async (req, res) => {
  try {
    const { id } = req.params;
    const params = [id];
    const accessClauses = addTicketAccessFilter(req, params, "t");
    const accessSql = accessClauses.length ? `AND ${accessClauses.join(" AND ")}` : "";

    const result = await db.query(
      `
      SELECT
        u.user_id AS assigned_to,
        u.full_name AS assigned_name,
        u.email AS assigned_email
      FROM tickets t
      LEFT JOIN users u ON t.assigned_to = u.user_id
      WHERE t.id = $1
        ${accessSql}
      LIMIT 1
      `,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    const tech = result.rows[0];
    if (!tech.assigned_to) {
      return res.json({ success: true, technician: null, message: 'Unassigned' });
    }

    res.json({ success: true, technician: tech });
  } catch (err) {
    console.error('[SLA /tickets/:id/technician] error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load technician info' });
  }
});
// GET /sla/reports/export/:id — Generate PDF SLA report for a ticket
router.get('/reports/export/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const params = [id];
    const accessClauses = addTicketAccessFilter(req, params, "t");
    const accessSql = accessClauses.length ? `AND ${accessClauses.join(" AND ")}` : "";
    const PDFDocument = require('pdfkit');

    const ticketResult = await db.query(
      `
      SELECT
        t.id,
        t.ticket_number,
        t.title,
        t.description,
        t.priority,
        t.status,
        t.created_at,
        t.assigned_at,
        t.in_progress_started_at,
        t.resolved_at,
        t.first_response_at,
        t.response_due_at,
        t.resolution_due_at,
        t.response_sla_status,
        t.resolution_sla_status,
        t.sla_due_date,
        t.created_via,
        COALESCE(assignee.full_name, 'Unassigned') AS assigned_name,
        COALESCE(requester.full_name, 'Unknown') AS requester_name,
        COALESCE(b.branch_name, 'N/A') AS branch_name
      FROM tickets t
      LEFT JOIN users assignee ON t.assigned_to = assignee.user_id
      LEFT JOIN users requester ON t.requester_id = requester.user_id
      LEFT JOIN branches b ON t.branch_id = b.branch_id
      WHERE t.id = $1
        ${accessSql}
      LIMIT 1
      `,
      params
    );

    if (ticketResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    const ticket = ticketResult.rows[0];

    // Format date helper
    const fmtDate = (val) => {
      if (!val) return 'N/A';
      const d = new Date(val);
      return Number.isNaN(d.getTime())
        ? 'N/A'
        : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    };

    // Calculate resolution duration
    let resolutionDuration = 'N/A';
    if (ticket.resolved_at && ticket.in_progress_started_at) {
      const diffMs = new Date(ticket.resolved_at) - new Date(ticket.in_progress_started_at);
      const hours = Math.floor(diffMs / 3600000);
      const minutes = Math.floor((diffMs % 3600000) / 60000);
      resolutionDuration = `${hours} Hours ${minutes} Minutes`;
    }

    const slaStatus = ticket.resolution_sla_status === 'Breached' || ticket.response_sla_status === 'Breached'
      ? 'Breached'
      : ticket.resolution_sla_status === 'Met' || ticket.response_sla_status === 'Met'
        ? 'Met'
        : 'Active';

    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sla-report-${ticket.ticket_number || id}.pdf"`);
    doc.pipe(res);

    // Header
    doc.fontSize(24).font('Helvetica-Bold').fillColor('#1e3a5f').text('AstreaBlue SLA Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').fillColor('#64748b').text(`Generated: ${fmtDate(new Date())}`, { align: 'center' });
    doc.moveDown(1);

    // Separator
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cbd5e1').stroke();
    doc.moveDown(1);

    // Ticket Details
    const detailColor = '#334155';
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#1e3a5f');
    doc.text('Ticket:', { continued: false });
    doc.font('Helvetica').fillColor(detailColor).text(ticket.ticket_number || `TKT-${ticket.id}`);
    doc.moveDown(0.3);

    doc.font('Helvetica-Bold').fillColor('#1e3a5f').text('Title:', { continued: false });
    doc.font('Helvetica').fillColor(detailColor).text(ticket.title);
    doc.moveDown(0.3);

    doc.font('Helvetica-Bold').fillColor('#1e3a5f').text('Description:', { continued: false });
    doc.font('Helvetica').fillColor(detailColor).text(ticket.description || 'No description');
    doc.moveDown(0.3);

    doc.font('Helvetica-Bold').fillColor('#1e3a5f').text('Priority:', { continued: false });
    doc.font('Helvetica').fillColor(detailColor).text(ticket.priority);
    doc.moveDown(0.3);

    doc.font('Helvetica-Bold').fillColor('#1e3a5f').text('Status:', { continued: false });
    doc.font('Helvetica').fillColor(detailColor).text(ticket.status);
    doc.moveDown(0.3);

    doc.font('Helvetica-Bold').fillColor('#1e3a5f').text('Assigned Technician:', { continued: false });
    doc.font('Helvetica').fillColor(detailColor).text(ticket.assigned_name);
    doc.moveDown(0.3);

    doc.font('Helvetica-Bold').fillColor('#1e3a5f').text('Requester:', { continued: false });
    doc.font('Helvetica').fillColor(detailColor).text(ticket.requester_name);
    doc.moveDown(0.3);

    doc.font('Helvetica-Bold').fillColor('#1e3a5f').text('Branch:', { continued: false });
    doc.font('Helvetica').fillColor(detailColor).text(ticket.branch_name);
    doc.moveDown(0.3);

    doc.font('Helvetica-Bold').fillColor('#1e3a5f').text('SLA Due Date:', { continued: false });
    doc.font('Helvetica').fillColor(detailColor).text(fmtDate(ticket.sla_due_date || ticket.resolution_due_at));
    doc.moveDown(0.3);

    doc.font('Helvetica-Bold').fillColor('#1e3a5f').text('SLA Status:', { continued: false });
    doc.font('Helvetica').fillColor(detailColor).text(slaStatus);
    doc.moveDown(1);

    // Separator
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cbd5e1').stroke();
    doc.moveDown(1);

    // Timeline Section
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1e3a5f').text('SLA Timeline', { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#475569');
    doc.text('Created:');
    doc.font('Helvetica').fillColor(detailColor).text(fmtDate(ticket.created_at));
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fillColor('#475569');
    doc.text('Assigned:');
    doc.font('Helvetica').fillColor(detailColor).text(ticket.assigned_name);
    doc.text(fmtDate(ticket.assigned_at));
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fillColor('#475569');
    doc.text('Work Started:');
    doc.font('Helvetica').fillColor(detailColor).text(fmtDate(ticket.in_progress_started_at));
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fillColor('#475569');
    doc.text('Resolved:');
    doc.font('Helvetica').fillColor(detailColor).text(fmtDate(ticket.resolved_at));
    doc.moveDown(1);

    // Resolution Duration
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cbd5e1').stroke();
    doc.moveDown(1);
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1e3a5f').text('Resolution Duration', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#0f766e').text(resolutionDuration, { align: 'center' });
    doc.moveDown(1);

    // Footer
    doc.fontSize(8).font('Helvetica').fillColor('#94a3b8').text('This report is system-generated and read-only. For audit purposes only.', { align: 'center' });

    doc.end();
  } catch (err) {
    console.error('[SLA /reports/export/:id] error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate SLA report' });
  }
});
module.exports = router;
