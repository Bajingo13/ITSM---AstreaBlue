const express = require("express");
const db = require("../../config/db");
const { addTicketAccessFilter } = require("./_ticketAccess");
const {
  sendTicketAssignedEmail,
  sendTicketCancelledEmail,
  sendTicketClosedEmail,
  sendTicketCreatedEmail,
  sendTicketResolvedEmail,
  sendTicketStatusEmail,
} = require("../services/emailService");
const { calculateSlaDueDate } = require("../services/slaService");

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

ensureTicketBranchColumn();

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

async function runTicketCreatedSideEffects({ ticketId, requesterId, branchId }) {
  try {
    let branchName = "Unassigned Branch";

    if (branchId) {
      try {
        const branchResult = await db.query(
          "SELECT branch_name FROM branches WHERE branch_id = $1",
          [branchId]
        );
        branchName = branchResult.rows[0]?.branch_name || branchName;
      } catch (branchError) {
        console.warn("Ticket branch lookup failed:", branchError.message);
      }
    }

    try {
      await db.query(
        `
        INSERT INTO ticket_history
        (ticket_id, changed_by, action, old_value, new_value)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          ticketId,
          requesterId,
          "Ticket Created",
          null,
          `Ticket filed from ${branchName}`,
        ]
      );
    } catch (historyError) {
      console.warn("Ticket history creation failed:", historyError.message);
    }

    try {
      await sendTicketNotification(ticketId, sendTicketCreatedEmail);
    } catch (notificationError) {
      console.warn("Ticket creation notification failed:", notificationError.message);
    }
  } catch (error) {
    console.error("Ticket post-save processing failed:", error.message);
  }
}

router.get("/", async (req, res) => {
  try {
    const params = [];
    const accessClauses = addTicketAccessFilter(req, params, "t");
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
        t.created_at,
        t.updated_at,

        c.category_id,
        c.category_name AS category,

        b.branch_code,
        COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,
        b.region,
        b.province,
        b.city_municipality,

        requester.user_id AS requester_id,
        requester.full_name AS requester_name,
        requester.email AS requester_email,

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
      ORDER BY t.created_at DESC
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
        t.created_at,
        t.updated_at,

        c.category_id,
        c.category_name AS category,

        b.branch_code,
        COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,
        b.region,
        b.province,
        b.city_municipality,

        requester.user_id AS requester_id,
        requester.full_name AS requester_name,
        requester.email AS requester_email,

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
      return res.status(404).json({
        success: false,
        error: "Ticket not found",
      });
    }

    const commentsResult = await db.query(
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

    const historyResult = await db.query(
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

    const attachmentsResult = await db.query(
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
      role_name = null,
      current_branch_id = null,
      current_user_id = null,
    } = req.body;

    const finalDescription = description || desc || "";
    const normalizedRole = String(role_name || "").toLowerCase();
    let finalBranchId =
      normalizedRole === "superadmin"
        ? branch_id || null
        : current_branch_id || branch_id || null;

    if (!finalBranchId && normalizedRole !== "superadmin") {
      const branchUserId = current_user_id || requester_id || assigned_to;

      if (branchUserId) {
        const branchResult = await db.query(
          `SELECT branch_id FROM users WHERE user_id = $1`,
          [branchUserId]
        );
        finalBranchId = branchResult.rows[0]?.branch_id || null;
      }
    }

    if (!title || !finalDescription) {
      return res.status(400).json({
        success: false,
        error: "Title and description are required",
      });
    }

    const countResult = await db.query(`
      SELECT COUNT(*)::int AS count
      FROM tickets
      WHERE DATE(created_at) = CURRENT_DATE
    `);

    const nextNumber = countResult.rows[0].count + 1;

    const ticketNumber = `TKT-${new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "")}-${String(nextNumber).padStart(4, "0")}`;

    const slaDueDate = await calculateSlaDueDate(priority || "P3-Medium");

    const result = await db.query(
      `
      INSERT INTO tickets
      (
        ticket_number,
        title,
        description,
        priority,
        status,
        category_id,
        requester_id,
        assigned_to,
        branch_id,
        source,
        impact,
        urgency,
        sla_due_date
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
        branch_id,
        created_at,
        updated_at
      `,
      [
        ticketNumber,
        title,
        finalDescription,
        priority,
        status,
        category_id,
        requester_id,
        assigned_to,
        finalBranchId,
        source,
        impact,
        urgency,
        slaDueDate,
      ]
    );

    const createdTicket = result.rows[0];

    runTicketCreatedSideEffects({
      ticketId: createdTicket.id,
      requesterId: requester_id,
      branchId: finalBranchId,
    }).catch((sideEffectError) => {
      console.error("Ticket post-save processing failed:", sideEffectError.message);
    });

    return res.status(201).json({
      success: true,
      message: "Ticket created successfully",
      data: createdTicket,
    });
  } catch (err) {
    console.error("Create ticket error:", err.message);

    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

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

    const resolvedAt =
      finalStatus === "Resolved" && !existing.resolved_at
        ? new Date()
        : existing.resolved_at;

    const firstResponseAt =
      finalStatus === "In Progress" && !existing.first_response_at
        ? new Date()
        : existing.first_response_at;

    const closedAt =
      finalStatus === "Closed" && !existing.closed_at
        ? new Date()
        : existing.closed_at;

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
        first_response_at = $18
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
        resolution_notes,
        root_cause,
        time_spent_minutes,
        parts_used,
        satisfaction_rating,
        created_at,
        updated_at
      `,
      [
        title ?? existing.title,
        finalDescription,
        priority ?? existing.priority,
        finalStatus,
        category_id ?? existing.category_id,
        requester_id ?? existing.requester_id,
        assigned_to ?? existing.assigned_to,
        source ?? existing.source,
        impact ?? existing.impact,
        urgency ?? existing.urgency,
        resolution_notes ?? existing.resolution_notes,
        root_cause ?? existing.root_cause,
        time_spent_minutes ?? existing.time_spent_minutes,
        parts_used ?? existing.parts_used,
        satisfaction_rating ?? existing.satisfaction_rating,
        resolvedAt,
        closedAt,
        firstResponseAt,
        id,
      ]
    );

    let emailWarning = null;

    if (status && status !== existing.status) {
      await db.query(
        `
        INSERT INTO ticket_history
        (ticket_id, changed_by, action, old_value, new_value)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [id, changed_by, "Status Updated", existing.status, status]
      );

      const statusEmail =
        finalStatus === "Resolved"
          ? sendTicketResolvedEmail
          : finalStatus === "Closed"
          ? sendTicketClosedEmail
          : sendTicketStatusEmail;

      emailWarning = await sendTicketNotification(id, statusEmail);
    }

    res.json({
      ...result.rows[0],
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
    const currentUserId =
      req.body?.current_user_id ||
      req.query.current_user_id ||
      req.body?.user_id ||
      req.query.user_id ||
      null;
    const currentRole = String(
      req.body?.role_name || req.query.role_name || req.body?.current_role || ""
    ).toLowerCase();
    const currentBranchId =
      req.body?.current_branch_id ||
      req.query.current_branch_id ||
      req.body?.branch_id ||
      req.query.branch_id ||
      null;

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

    const existingParams = [id];
    const accessClauses = addTicketAccessFilter(req, existingParams, "t");
    const accessSql = accessClauses.length
      ? `AND ${accessClauses.join(" AND ")}`
      : "";

    const existingResult = await db.query(
      `
      SELECT
        t.id,
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

      if (!ticket.branch_id) {
        return res.status(400).json({
          success: false,
          error: "Ticket has no assigned branch",
        });
      }

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

      if (Number(ticket.branch_id) !== Number(technician.branch_id)) {
        return res.status(403).json({
          success: false,
          error: `Technician must belong to the same branch as the ticket. Ticket branch: ${ticket.branch_name}, Technician branch: ${technician.branch_name}`,
        });
      }
    }

    const result = await db.query(
      `
      UPDATE tickets
      SET assigned_to = $1
      WHERE id = $2
      RETURNING
        id,
        ticket_number,
        title,
        description AS desc,
        priority,
        status,
        assigned_to,
        branch_id,
        updated_at
      `,
      [assigned_to || null, id]
    );

    await db.query(
      `
      INSERT INTO ticket_history
      (ticket_id, changed_by, action, old_value, new_value)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        id,
        changed_by || currentUserId,
        "Ticket Assigned",
        ticket.assigned_to,
        assigned_to || null,
      ]
    );

    const emailWarning = assigned_to
      ? await sendTicketNotification(id, sendTicketAssignedEmail)
      : null;

    res.json({
      ...result.rows[0],
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
      `SELECT status FROM tickets WHERE id = $1`,
      [id]
    );

    if (ticketCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found.",
      });
    }

    if (
      ["Cancelled", "Resolved", "Closed"].includes(ticketCheck.rows[0].status)
    ) {
      return res.status(400).json({
        success: false,
        error: `Ticket cannot be cancelled because it is already ${ticketCheck.rows[0].status}.`,
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

    await db.query(
      `
      INSERT INTO ticket_history
      (ticket_id, changed_by, action, old_value, new_value)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [id, cancelledBy, "Ticket Cancelled", null, reason.trim()]
    );

    const emailWarning = await sendTicketNotification(
      id,
      sendTicketCancelledEmail
    );

    res.json({
      success: true,
      message: "Ticket cancelled successfully.",
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
