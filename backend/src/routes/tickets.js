const express = require("express");
const db = require("../../config/db");
const { addTicketAccessFilter, getRequestContext } = require("./_ticketAccess");
const {
  sendTicketAssignedEmail,
  sendTicketCancelledEmail,
  sendTicketClosedEmail,
  sendTicketCreatedEmail,
  sendTicketResolvedEmail,
  sendTicketStatusEmail,
} = require("../services/emailService");
const { createNotification } = require("../services/notificationService");
const { createServiceDeskTicket } = require("../services/serviceDeskTicketService");
const { emitSlaUpdated, emitTicketChanged } = require("../services/socketService");

function normalizeOptionalInteger(value, fallback = null) {
  if (value === undefined || value === "") return fallback;
  if (value === null) return null;

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

// Initialize DB changes for integration
const setupTickets = async () => {
  try {
    await db.query(`
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS related_device_uuid UUID;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS related_asset_id INTEGER;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS alert_id BIGINT;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'Web';
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS impact VARCHAR(20) DEFAULT 'Medium';
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS urgency VARCHAR(20) DEFAULT 'Medium';
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_policy_id INTEGER;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_due_date TIMESTAMP;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS response_due_at TIMESTAMP;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolution_due_at TIMESTAMP;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS response_sla_status VARCHAR(30) DEFAULT 'Pending';
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolution_sla_status VARCHAR(30) DEFAULT 'Pending';
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMP;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS root_cause TEXT;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS time_spent_minutes INTEGER;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS parts_used TEXT;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS in_progress_started_at TIMESTAMP;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS satisfaction_rating INTEGER;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS origin_system VARCHAR(150);
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS origin_module VARCHAR(150);
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS origin_feature VARCHAR(150);
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS external_reference VARCHAR(150);
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS external_attachment_metadata JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS external_request_fingerprint VARCHAR(64);
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS integration_id INTEGER;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS employee_id INTEGER;
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS created_via VARCHAR(100);
    `);
  } catch (err) {
    console.error("Failed to alter tickets table:", err.message);
  }
};

const router = express.Router();

async function ensureTicketBranchColumn() {
  try {
    await db.query(`
      ALTER TABLE tickets
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id),
      ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS cancelled_by INTEGER REFERENCES users(user_id),
      ADD COLUMN IF NOT EXISTS cancellation_reason TEXT
    `);
  } catch (err) {
    console.error("Ticket branch setup error:", err.message);
  }
}

const ticketSchemaReady = (async () => {
  await setupTickets();
  await ensureTicketBranchColumn();
})();

router.use(async (req, res, next) => {
  try {
    await ticketSchemaReady;
    next();
  } catch (err) {
    console.error("Ticket schema setup error:", err.message);
    res.status(500).json({ success: false, error: "Ticket schema setup failed" });
  }
});

async function getTicketNotificationDetails(ticketId) {
  const result = await db.query(
    `
    SELECT
      t.id,
      t.ticket_number,
      t.title,
      t.priority,
      t.status,
      t.branch_id,
      t.created_at,
      t.closed_at,
      t.cancelled_at,
      t.resolution_notes,
      t.cancellation_reason,
      c.category_name,
      COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,
      requester.full_name AS requester_name,
      requester.email AS requester_email,
      requester.personal_email AS requester_personal_email,
      requester.company_email AS requester_company_email,
      assignee.full_name AS assigned_name,
      assignee.email AS assigned_email
    FROM tickets t
    LEFT JOIN branches b
      ON t.branch_id = b.branch_id
    LEFT JOIN ticket_categories c
      ON t.category_id = c.category_id
    LEFT JOIN users requester
      ON t.requester_id = requester.user_id
    LEFT JOIN users assignee
      ON t.assigned_to = assignee.user_id
    WHERE t.id = $1
    LIMIT 1
    `,
    [ticketId]
  );

  return result.rows[0] || null;
}

async function sendTicketNotification(ticketId, sendEmail) {
  try {
    const ticket = await getTicketNotificationDetails(ticketId);

    if (!ticket) {
      return "Ticket email skipped because ticket details were not found.";
    }

    const result = await sendEmail(ticket);

    if (result?.warning) {
      console.warn(`Ticket email warning for ticket ${ticket.ticket_number}: ${result.warning}`);
      return result.warning;
    }

    return null;
  } catch (err) {
    console.warn("Ticket email notification failed:", err.message);
    return "Ticket updated, but email notification failed.";
  }
}

async function createInAppNotification(userId, title, message, type = "info", ticketId = null, metadata = {}) {
  try {
    await createNotification({ userId, title, message, type, ticketId, metadata });
  } catch (err) {
    console.error("Failed to create in-app notification:", err.message);
  }
}

router.get("/", async (req, res) => {
  try {
    const params = [];

    const accessClauses = addTicketAccessFilter(req, params, "t");

    // --- SLA Filter Params ---
    const { priority, status, slaStatus, dateFrom, dateTo, dateRange, sort, branch, technician, category, department } = req.query;

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

    if (slaStatus) {
      const slaStatuses = slaStatus.split(",");
      const slaConditions = slaStatuses.map((ss) => {
        switch (ss.toLowerCase()) {
          case "breached":
            return "(t.response_sla_status = 'Breached' OR t.resolution_sla_status = 'Breached')";
          case "met":
            return "(t.response_sla_status = 'Met' OR t.resolution_sla_status = 'Met')";
          case "warning":
            return `(t.response_sla_status NOT IN ('Breached','Met','Cancelled') AND t.resolution_sla_status NOT IN ('Breached','Met','Cancelled') AND t.resolution_due_at IS NOT NULL AND t.resolution_due_at <= NOW() + INTERVAL '240 minutes')`;
          case "active":
            return `(t.response_sla_status NOT IN ('Breached','Met','Cancelled') AND t.resolution_sla_status NOT IN ('Breached','Met','Cancelled') AND (t.resolution_due_at IS NULL OR t.resolution_due_at > NOW() + INTERVAL '240 minutes'))`;
          default:
            return "1=0";
        }
      });
      accessClauses.push(`(${slaConditions.join(" OR ")})`);
    }

    if (dateRange === "30days") {
      accessClauses.push(`t.created_at >= NOW() - INTERVAL '30 days'`);
    } else if (dateRange === "6months") {
      accessClauses.push(`t.created_at >= NOW() - INTERVAL '6 months'`);
    }

    if (dateFrom) {
      params.push(dateFrom);
      accessClauses.push(`t.created_at >= $${params.length}::timestamp`);
    }
    if (dateTo) {
      params.push(dateTo);
      accessClauses.push(`t.created_at <= $${params.length}::timestamp`);
    }

    if (branch && branch !== "all") {
      params.push(branch);
      const branchParam = params.length;
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

    if (category && category !== "all") {
      params.push(category);
      accessClauses.push(`c.category_name ILIKE $${params.length}`);
    }

    if (department && department !== "all") {
      params.push(department);
      accessClauses.push(`b.branch_name ILIKE $${params.length}`);
    }

    // Sorting
    let orderBy = "ORDER BY t.created_at DESC";
    if (sort === "oldest") orderBy = "ORDER BY t.created_at ASC";
    else if (sort === "updated") orderBy = "ORDER BY t.updated_at DESC";
    else if (sort === "priority") orderBy = `ORDER BY CASE t.priority WHEN 'P1-Critical' THEN 1 WHEN 'P2-High' THEN 2 WHEN 'P3-Medium' THEN 3 WHEN 'P4-Low' THEN 4 ELSE 5 END ASC`;

    const whereSql = accessClauses.length
      ? `WHERE ${accessClauses.join(" AND ")}`
      : "";

    const result = await db.query(`
      SELECT
        t.id,
        t.ticket_number,
        t.title,
        t.description AS desc,
        t.description,
        t.priority,
        t.status,
        t.source,
        t.impact,
        t.urgency,
        t.sla_due_date,
        t.response_due_at,
        t.resolution_due_at,
        t.response_sla_status,
        t.resolution_sla_status,
        t.first_response_at,
        t.resolved_at,
        t.closed_at,
        t.cancelled_at,
        t.cancelled_by,
        t.cancellation_reason,
        t.resolution_notes,
        t.root_cause,
        t.time_spent_minutes,
        t.parts_used,
        t.satisfaction_rating,
        t.branch_id,
        t.origin_system,
        t.origin_module,
        t.origin_feature,
        t.external_reference,
        t.integration_id,
        t.employee_id,
        t.external_employee_id,
        t.created_via,
        t.created_at,
        t.updated_at,
        t.assigned_at,
        t.in_progress_started_at,

        c.category_id,
        c.category_name AS category,

        b.branch_code,
        COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,
        b.region,
        b.province,
        b.city_municipality,

        requester.user_id AS requester_id,
        COALESCE(requester.full_name, t.external_requester_name) AS requester_name,
        COALESCE(requester.email, t.external_requester_email) AS requester_email,

        assignee.user_id AS assigned_to,
        assignee.full_name AS assigned_name,
        assignee.email AS assigned_email

      FROM tickets t
      LEFT JOIN ticket_categories c
        ON t.category_id = c.category_id
      LEFT JOIN branches b
        ON t.branch_id = b.branch_id
      LEFT JOIN users requester
        ON t.requester_id = requester.user_id
      LEFT JOIN users assignee
        ON t.assigned_to = assignee.user_id
      ${whereSql}
      ${orderBy}
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch tickets error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch tickets",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    if (!getRequestContext(req).authenticated) {
      return res.status(401).json({ success: false, message: "Session expired. Please sign in again." });
    }
    const { id } = req.params;
    const params = [id];
    const accessClauses = addTicketAccessFilter(req, params, "t");
    const accessSql = accessClauses.length
      ? `AND ${accessClauses.join(" AND ")}`
      : "";

    const ticketResult = await db.query(
      `
      SELECT
        t.id,
        t.ticket_number,
        t.title,
        t.description AS desc,
        t.description,
        t.priority,
        t.status,
        t.source,
        t.impact,
        t.urgency,
        t.sla_due_date,
        t.response_due_at,
        t.resolution_due_at,
        t.response_sla_status,
        t.resolution_sla_status,
        t.first_response_at,
        t.resolved_at,
        t.closed_at,
        t.cancelled_at,
        t.cancelled_by,
        t.cancellation_reason,
        t.resolution_notes,
        t.root_cause,
        t.time_spent_minutes,
        t.parts_used,
        t.satisfaction_rating,
        t.branch_id,
        t.origin_system,
        t.origin_module,
        t.origin_feature,
        t.external_reference,
        t.integration_id,
        t.employee_id,
        t.external_employee_id,
        t.created_via,
        t.created_at,
        t.assigned_at,
        t.in_progress_started_at,
        t.updated_at,

        c.category_id,
        c.category_name AS category,

        b.branch_code,
        COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,
        b.region,
        b.province,
        b.city_municipality,

        requester.user_id AS requester_id,
        COALESCE(requester.full_name, t.external_requester_name) AS requester_name,
        COALESCE(requester.email, t.external_requester_email) AS requester_email,

        assignee.user_id AS assigned_to,
        assignee.full_name AS assigned_name,
        assignee.email AS assigned_email

      FROM tickets t
      LEFT JOIN ticket_categories c
        ON t.category_id = c.category_id
      LEFT JOIN branches b
        ON t.branch_id = b.branch_id
      LEFT JOIN users requester
        ON t.requester_id = requester.user_id
      LEFT JOIN users assignee
        ON t.assigned_to = assignee.user_id
      WHERE t.id = $1
        ${accessSql}
      `,
      params
    );

    if (ticketResult.rows.length === 0) {
      const exists = await db.query("SELECT 1 FROM tickets WHERE id = $1", [id]);
      if (exists.rows.length) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view this ticket.",
        });
      }
      return res.status(404).json({
        success: false,
        message: "Ticket not found or no longer available.",
      });
    }

    let commentsResult = { rows: [] };
    try {
      commentsResult = await db.query(
        `
        SELECT
          tc.comment_id,
          tc.comment_text,
          tc.is_internal,
          tc.created_at,
          u.user_id,
          u.full_name,
          u.email
        FROM ticket_comments tc
        LEFT JOIN users u
          ON tc.user_id = u.user_id
        WHERE tc.ticket_id = $1
        ORDER BY tc.created_at ASC
        `,
        [id]
      );
    } catch (err) { console.warn("Comments skipped:", err.message); }

    let historyResult = { rows: [] };
    try {
      historyResult = await db.query(
        `
        SELECT
          th.history_id,
          th.action,
          th.old_value,
          th.new_value,
          th.created_at,
          COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,
          u.user_id,
          u.full_name,
          u.email
        FROM ticket_history th
        LEFT JOIN tickets ht
          ON th.ticket_id = ht.id
        LEFT JOIN branches b
          ON ht.branch_id = b.branch_id
        LEFT JOIN users u
          ON th.changed_by = u.user_id
        WHERE th.ticket_id = $1
        ORDER BY th.created_at ASC
        `,
        [id]
      );
    } catch (err) { console.warn("History skipped:", err.message); }

    let attachmentsResult = { rows: [] };
    try {
      attachmentsResult = await db.query(
        `
        SELECT
          ta.attachment_id,
          ta.ticket_id,
          ta.uploaded_by,
          ta.file_name,
          ta.file_path,
          ta.mime_type,
          ta.file_size,
          ta.uploaded_at,
          u.full_name AS uploaded_by_name
        FROM ticket_attachments ta
        LEFT JOIN users u
          ON ta.uploaded_by = u.user_id
        WHERE ta.ticket_id = $1
        ORDER BY ta.uploaded_at ASC
        `,
        [id]
      );
    } catch (err) { console.warn("Attachments skipped:", err.message); }

    res.json({
      ...ticketResult.rows[0],
      comments: commentsResult.rows,
      history: historyResult.rows,
      attachments: attachmentsResult.rows,
    });
  } catch (err) {
    console.error("Fetch single ticket error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch ticket",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      title,
      description,
      desc,
      priority = "P3-Medium",
      status = "Open Queue",
      category_id = null,
      requester_id = null,
      assigned_to = null,
      branch_id = null,
      source = "portal",
      impact = null,
      urgency = null,
    } = req.body;

    const finalDescription = description || desc || "";
    const context = getRequestContext(req);
    if (!context.authenticated) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }

    const normalizedRole = String(context.roleName || "").toLowerCase();
    const isSuperAdmin = normalizedRole === "superadmin";
    const finalBranchId = isSuperAdmin ? branch_id || null : context.branchId;
    if (!isSuperAdmin && !finalBranchId) {
      return res.status(403).json({ success: false, error: "An authorized branch is required." });
    }
    if (!isSuperAdmin && branch_id && Number(branch_id) !== Number(context.branchId)) {
      return res.status(403).json({ success: false, error: "You cannot create tickets for another branch." });
    }
    if (normalizedRole === "employee" && requester_id && Number(requester_id) !== Number(context.currentUserId)) {
      return res.status(403).json({ success: false, error: "Employees can only create their own tickets." });
    }

    const finalRequesterId = normalizedRole === "employee" ? context.currentUserId : requester_id;

    const { ticket: createdTicket } = await createServiceDeskTicket({
      title,
      description: finalDescription,
      priority,
      status,
      categoryId: category_id,
      requesterId: finalRequesterId,
      assignedTo: assigned_to,
      branchId: finalBranchId,
      source,
      impact,
      urgency,
      actorId: context.currentUserId,
      // SuperAdmin has enterprise-wide authority and may file a ticket for any
      // valid requester/branch combination. Branch-bound roles retain the
      // existing same-branch validation.
      enforceRequesterBranch: Boolean(!isSuperAdmin && finalRequesterId && finalBranchId),
      enforceRequesterExists: Boolean(isSuperAdmin && finalRequesterId),
      auditEvent: "Internal Ticket Created",
      requestMethod: req.method,
      requestPath: req.originalUrl,
      sourceIp: req.ip,
    });

    if (process.env.NODE_ENV !== "test") {
      sendTicketNotification(createdTicket.id, sendTicketCreatedEmail).catch((emailError) => {
        console.warn("Ticket creation email failed:", emailError.message);
      });
    }

    return res.status(201).json({
      success: true,
      message: "Ticket created successfully",
      data: createdTicket,
    });
  } catch (err) {
    console.error("Create ticket error:", err.message);

    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const requestContext = getRequestContext(req);

    const {
      title,
      description,
      desc,
      priority,
      status,
      category_id,
      requester_id,
      assigned_to,
      source,
      impact,
      urgency,
      resolution_notes,
      root_cause,
      time_spent_minutes,
      parts_used,
      satisfaction_rating,
      changed_by = null,
    } = req.body;

    const existingParams = [id];
    const accessClauses = addTicketAccessFilter(req, existingParams, "t");
    const accessSql = accessClauses.length
      ? `AND ${accessClauses.join(" AND ")}`
      : "";

    const existingResult = await db.query(
      `SELECT * FROM tickets t WHERE t.id = $1 ${accessSql}`,
      existingParams
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found",
      });
    }

    const existing = existingResult.rows[0];

    const finalDescription =
      description !== undefined
        ? description
        : desc !== undefined
        ? desc
        : existing.description;

    const finalStatus = status ?? existing.status;
    const finalCategoryId = normalizeOptionalInteger(category_id, existing.category_id);
    const finalRequesterId = normalizeOptionalInteger(requester_id, existing.requester_id);
    const finalAssignedTo = normalizeOptionalInteger(assigned_to, existing.assigned_to);
    const finalTimeSpentMinutes = normalizeOptionalInteger(
      time_spent_minutes,
      existing.time_spent_minutes
    );
    const finalSatisfactionRating = normalizeOptionalInteger(
      satisfaction_rating,
      existing.satisfaction_rating
    );
    // Actor attribution must come from the authenticated JWT. Keep the body
    // value only as a backwards-compatible fallback for legacy/internal calls.
    const changedById = normalizeOptionalInteger(
      requestContext.currentUserId ?? changed_by,
      null
    );

    const resolvedAt =
      finalStatus === "Resolved" && !existing.resolved_at
        ? new Date()
        : existing.resolved_at;

    const firstResponseAt =
      finalStatus === "In Progress" && !existing.first_response_at
        ? new Date()
        : existing.first_response_at;

    const inProgressStartedAt =
      finalStatus === "In Progress" && !existing.in_progress_started_at
        ? new Date()
        : existing.in_progress_started_at;

    const closedAt =
      finalStatus === "Closed" && !existing.closed_at
        ? new Date()
        : existing.closed_at;

    const cancelledAt =
      finalStatus === "Cancelled" && !existing.cancelled_at
        ? new Date()
        : existing.cancelled_at;

    // SLA Calculations on Update
    const isNowResolvedOrClosed = (finalStatus === "Resolved" || finalStatus === "Closed");
    const now = new Date();

    let resSlaStat = existing.response_sla_status;
    let resolSlaStat = existing.resolution_sla_status;

    if (finalStatus === "Cancelled") {
      resSlaStat = "Cancelled";
      resolSlaStat = "Cancelled";
    } else {
      if (firstResponseAt && !existing.first_response_at) {
        if (existing.response_due_at && firstResponseAt <= existing.response_due_at) resSlaStat = "Met";
        else resSlaStat = "Breached";
      }
      if (isNowResolvedOrClosed && !existing.resolved_at && !existing.closed_at) {
        const endTime = resolvedAt || closedAt || now;
        if (existing.resolution_due_at && endTime <= existing.resolution_due_at) resolSlaStat = "Met";
        else resolSlaStat = "Breached";
      }
    }

    const result = await db.query(
      `
      UPDATE tickets
      SET
        title = $1,
        description = $2,
        priority = $3,
        status = $4,
        category_id = $5,
        requester_id = $6,
        assigned_to = $7,
        source = $8,
        impact = $9,
        urgency = $10,
        resolution_notes = $11,
        root_cause = $12,
        time_spent_minutes = $13,
        parts_used = $14,
        satisfaction_rating = $15,
        resolved_at = $16,
        closed_at = $17,
        first_response_at = $18,
        cancelled_at = $22,
        in_progress_started_at = $23,
        response_sla_status = $20,
        resolution_sla_status = $21,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $19
      RETURNING
        id,
        ticket_number,
        title,
        description AS desc,
        description,
        priority,
        status,
        source,
        impact,
        urgency,
        sla_due_date,
        first_response_at,
        resolved_at,
        closed_at,
        cancelled_at,

        resolution_notes,
        root_cause,
        time_spent_minutes,
        parts_used,
        satisfaction_rating,
        created_at,
        updated_at,
        resolution_due_at,
        response_sla_status,
        resolution_sla_status,
        in_progress_started_at
      `,
      [
        title ?? existing.title,
        finalDescription,
        priority ?? existing.priority,
        finalStatus,
        finalCategoryId,
        finalRequesterId,
        finalAssignedTo,
        source ?? existing.source,
        impact ?? existing.impact,
        urgency ?? existing.urgency,
        resolution_notes ?? existing.resolution_notes,
        root_cause ?? existing.root_cause,
        finalTimeSpentMinutes,
        parts_used ?? existing.parts_used,
        finalSatisfactionRating,
        resolvedAt,
        closedAt,
        firstResponseAt,
        id,
        resSlaStat,
        resolSlaStat,
        cancelledAt,
        inProgressStartedAt
      ]
    );

    let emailWarning = null;

      if (status && status !== existing.status) {
        try {
          await db.query(
            `
            INSERT INTO ticket_history
            (ticket_id, changed_by, action, old_value, new_value)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [id, changedById, "Status Updated", existing.status, status]
          );
        } catch(e) { console.warn("History insert failed:", e.message); }
      }

      if (resSlaStat !== existing.response_sla_status) {
        try {
          await db.query(
            `
            INSERT INTO ticket_history
            (ticket_id, changed_by, action, old_value, new_value)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [id, changedById, "Response SLA", existing.response_sla_status || 'Pending', resSlaStat]
          );
        } catch(e) {}
      }

      if (resolSlaStat !== existing.resolution_sla_status) {
        try {
          await db.query(
            `
            INSERT INTO ticket_history
            (ticket_id, changed_by, action, old_value, new_value)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [id, changedById, "Resolution SLA", existing.resolution_sla_status || 'Pending', resolSlaStat]
          );
        } catch(e) {}
      }

      if (resSlaStat !== existing.response_sla_status || resolSlaStat !== existing.resolution_sla_status) {
        const breached = resSlaStat === "Breached" || resolSlaStat === "Breached";
        emitSlaUpdated({
          type: breached ? "breach" : finalStatus === "In Progress" ? "response_met" : "resolution_met",
          ticket_id: Number(id),
          ticket_no: existing.ticket_number || `TKT-${id}`,
          timestamp: new Date().toISOString(),
        });
      }

      if (status && status !== existing.status && (finalStatus === "Closed" || finalStatus === "Cancelled")) {
        try {
          const statusEmail =
            finalStatus === "Closed"
              ? sendTicketClosedEmail
              : sendTicketCancelledEmail;
          emailWarning = await sendTicketNotification(id, statusEmail);
        } catch(e) { console.warn("Email failed:", e.message); }
      }
      
      if (status && status !== existing.status) try {
        const notifType = finalStatus === "Closed" ? "success" : finalStatus === "Resolved" ? "success" : "info";
        const statusLabel = finalStatus || status;
        await createInAppNotification(
          existing.requester_id,
          statusLabel === "In Progress" ? "Ticket In Progress" : `Ticket ${statusLabel}`,
          `Ticket ${existing.ticket_number} status changed to ${statusLabel}.`,
          notifType,
          id,
          { event: "status_changed", status: statusLabel }
        );
      } catch(e) { console.warn("Notification failed:", e.message); }

    emitTicketChanged({
      action: "updated",
      ticket_id: Number(id),
      ticket_number: existing.ticket_number,
      branch_id: existing.branch_id,
      requester_id: existing.requester_id,
      assigned_to: finalAssignedTo,
      status: finalStatus,
    });

    res.json({
      success: true,
      message: "Ticket updated successfully.",
      data: result.rows[0],
      ...(emailWarning ? { email_warning: emailWarning } : {}),
    });
  } catch (err) {
    console.error("Update ticket error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to update ticket",
    });
  }
});

router.patch("/:id/assign", async (req, res) => {
  try {
    const { id } = req.params;
    const { assigned_to, changed_by = null } = req.body;
    const requestContext = getRequestContext(req);
    const currentUserId = requestContext.currentUserId;
    const currentRole = String(requestContext.roleName || "").toLowerCase();
    const currentBranchId = requestContext.branchId;

    if (!["superadmin", "admin", "technician"].includes(currentRole)) {
      return res.status(403).json({
        success: false,
        error: "You are not allowed to assign tickets.",
      });
    }

    if (
      currentRole === "technician" &&
      (!currentUserId || !assigned_to || Number(assigned_to) !== Number(currentUserId))
    ) {
      return res.status(403).json({
        success: false,
        error: "Technicians can only accept tickets for themselves.",
      });
    }

    if (currentRole === "technician" && !currentBranchId) {
      return res.status(403).json({
        success: false,
        error: "Your technician account has no assigned branch. Contact an administrator.",
      });
    }

    const existingParams = [id];
    const accessClauses = addTicketAccessFilter(req, existingParams, "t");
    const accessSql = accessClauses.length
      ? `AND ${accessClauses.join(" AND ")}`
      : "";

    const existingResult = await db.query(
      `
      SELECT
        t.id,
        t.ticket_number,
        t.assigned_to,
        t.branch_id,
        t.status,
        COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name
      FROM tickets t
      LEFT JOIN branches b
        ON t.branch_id = b.branch_id
      WHERE t.id = $1 ${accessSql}
      `,
      existingParams
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found",
      });
    }

    const ticket = existingResult.rows[0];

    if (currentRole === "admin") {
      if (!currentBranchId || Number(ticket.branch_id) !== Number(currentBranchId)) {
        return res.status(403).json({
          success: false,
          error: "Admin can only assign technicians from the same branch.",
        });
      }
    }

    if (
      currentRole === "technician" &&
      ticket.assigned_to &&
      Number(ticket.assigned_to) !== Number(currentUserId)
    ) {
      return res.status(403).json({
        success: false,
        error: "Technicians can only accept unassigned tickets.",
      });
    }


    if (
      currentRole === "technician" &&
      (!ticket.branch_id || Number(ticket.branch_id) !== Number(currentBranchId))
    ) {
      return res.status(403).json({
        success: false,
        error: "Technicians can only accept tickets from their assigned branch.",
      });
    }

    if (assigned_to) {
      const technicianResult = await db.query(
        `
        SELECT
          u.user_id,
          u.full_name,
          u.branch_id,
          COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name
        FROM users u
        JOIN system_roles sr
          ON u.role_id = sr.role_id
        LEFT JOIN branches b
          ON u.branch_id = b.branch_id
        WHERE u.user_id = $1
          AND LOWER(sr.role_name) = 'technician'
          AND COALESCE(u.is_active, TRUE) = TRUE
        `,
        [assigned_to]
      );

      if (technicianResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Selected user is not an active technician",
        });
      }

      const technician = technicianResult.rows[0];

      if (!technician.branch_id) {
        return res.status(400).json({
          success: false,
          error: "Technician has no assigned branch",
        });
      }

      if (
        currentRole === "admin" &&
        (Number(technician.branch_id) !== Number(currentBranchId) ||
          Number(technician.branch_id) !== Number(ticket.branch_id))
      ) {
        return res.status(403).json({
          success: false,
          error: "Admin can only assign technicians from the same branch.",
        });
      }

      if (!ticket.branch_id || Number(ticket.branch_id) !== Number(technician.branch_id)) {
        return res.status(403).json({
          success: false,
          error: `Technician must belong to the same branch as the ticket. Ticket branch: ${ticket.branch_name}, Technician branch: ${technician.branch_name}`,
        });
      }
    }

    const result = await db.query(
      `
      UPDATE tickets
      SET assigned_to = $1::integer,
          assigned_at = CASE WHEN $1::integer IS NOT NULL AND assigned_at IS NULL THEN CURRENT_TIMESTAMP ELSE assigned_at END
      WHERE id = $2
      RETURNING
        id,
        ticket_number,
        title,
        description AS desc,
        priority,
        status,
        assigned_to,
        assigned_at,
        branch_id,
        updated_at
      `,
      [assigned_to || null, id]
    );

    try {
      await db.query(
        `
        INSERT INTO ticket_history
        (ticket_id, changed_by, action, old_value, new_value)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          id,
          currentUserId || changed_by,
          "Ticket Assigned",
          ticket.assigned_to,
          assigned_to || null,
        ]
      );
    } catch(e) { console.warn("History insert failed:", e.message); }

    let emailWarning = null;
    if (assigned_to && process.env.NODE_ENV !== "test") {
      emailWarning = await sendTicketNotification(id, async (ticketDetails) => {
        const assignedTicket = {
          ...ticketDetails,
          requester_email: ticketDetails.assigned_email,
          requester_company_email: null,
          requester_personal_email: null,
        };
        return sendTicketAssignedEmail(assignedTicket);
      });
    }
    
    if (assigned_to) {
      try {
        await createInAppNotification(assigned_to, "Ticket Assigned", `Ticket ${ticket.ticket_number || id} has been assigned to you.`, "warning", id, { event: "assigned" });
      } catch(e) { console.warn("Notification failed:", e.message); }
    }

    emitTicketChanged({
      action: "assigned",
      ticket_id: Number(id),
      ticket_number: ticket.ticket_number,
      branch_id: ticket.branch_id,
      assigned_to: assigned_to || null,
      status: ticket.status,
    });

    res.json({
      success: true,
      message: "Ticket assigned successfully.",
      data: result.rows[0],
      ticket: result.rows[0],
      ...(emailWarning ? { email_warning: emailWarning } : {}),
    });
  } catch (err) {
    console.error("Assign ticket error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to assign ticket",
    });
  }
});

router.post("/:id/comments", async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id = null, comment_text, is_internal = false } = req.body;

    if (!comment_text) {
      return res.status(400).json({
        success: false,
        error: "Comment text is required",
      });
    }

    const result = await db.query(
      `
      INSERT INTO ticket_comments
      (ticket_id, user_id, comment_text, is_internal)
      VALUES ($1,$2,$3,$4)
      RETURNING *
      `,
      [id, user_id, comment_text, is_internal]
    );

    await db.query(
      `
      INSERT INTO ticket_history
      (ticket_id, changed_by, action, old_value, new_value)
      VALUES ($1,$2,$3,$4,$5)
      `,
      [id, user_id, "Comment Added", null, comment_text]
    );

    const ticketPeople = await db.query(
      "SELECT ticket_number, requester_id, assigned_to FROM tickets WHERE id = $1",
      [id]
    );
    const ticket = ticketPeople.rows[0];
    const recipients = [...new Set([ticket?.requester_id, ticket?.assigned_to].filter(Boolean))]
      .filter((recipientId) => String(recipientId) !== String(user_id));
    for (const recipientId of recipients) {
      await createInAppNotification(
        recipientId,
        "Ticket Comment Added",
        `A new comment was added to ticket ${ticket.ticket_number || id}.`,
        "info",
        id,
        { event: "comment_added" }
      );
    }

    emitTicketChanged({
      action: "commented",
      ticket_id: Number(id),
      ticket_number: ticket?.ticket_number,
      requester_id: ticket?.requester_id,
      assigned_to: ticket?.assigned_to,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Add comment error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to add comment",
    });
  }
});

router.patch("/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;

    const roleName = String(
      req.query.role_name || req.body?.role_name || ""
    )
      .toLowerCase()
      .replace(/[\s_-]+/g, "");

    const cancelledBy =
      req.query.current_user_id || req.body?.current_user_id || null;

    const reason = req.body?.cancellation_reason || req.body?.reason || "";

    if (roleName !== "superadmin") {
      return res.status(403).json({
        success: false,
        error: "Only superadmins can cancel tickets.",
      });
    }

    if (!reason.trim()) {
      return res.status(400).json({
        success: false,
        error: "Cancellation reason is required.",
      });
    }

    const ticketCheck = await db.query(
      `SELECT status, requester_id, ticket_number FROM tickets WHERE id = $1`,
      [id]
    );

    if (ticketCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found.",
      });
    }

    const existing = ticketCheck.rows[0];

    if (
      ["Cancelled", "Resolved", "Closed"].includes(existing.status)
    ) {
      return res.status(400).json({
        success: false,
        error: `Ticket cannot be cancelled because it is already ${existing.status}.`,
      });
    }

    const result = await db.query(
      `
      UPDATE tickets
      SET
        status = 'Cancelled',
        cancelled_at = NOW(),
        cancelled_by = $1,
        cancellation_reason = $2
      WHERE id = $3
      RETURNING *
      `,
      [cancelledBy, reason.trim(), id]
    );

    try {
      await db.query(
        `
        INSERT INTO ticket_history
        (ticket_id, changed_by, action, old_value, new_value)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [id, cancelledBy, "Ticket Cancelled", null, reason.trim()]
      );
    } catch(e) { console.warn("History insert failed:", e.message); }

    let emailWarning = null;
    try {
      emailWarning = await sendTicketNotification(
        id,
        sendTicketCancelledEmail
      );
    } catch(e) { console.warn("Email failed:", e.message); }
    
    try {
      await createInAppNotification(existing.requester_id, "Ticket Cancelled", `Your ticket ${existing.ticket_number || id} was cancelled.`, "error", id, { event: "cancelled" });
    } catch(e) { console.warn("Notification failed:", e.message); }

    emitTicketChanged({
      action: "cancelled",
      ticket_id: Number(id),
      ticket_number: existing.ticket_number,
      requester_id: existing.requester_id,
      status: "Cancelled",
    });

    res.json({
      success: true,
      message: "Ticket cancelled successfully.",
      data: result.rows[0],
      ticket: result.rows[0],
      ...(emailWarning ? { email_warning: emailWarning } : {}),
    });
  } catch (err) {
    console.error("Cancel ticket error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to cancel ticket",
    });
  }
});

module.exports = router;
module.exports.ticketSchemaReady = ticketSchemaReady;
