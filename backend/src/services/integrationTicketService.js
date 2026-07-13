const db = require("../../config/db");
const { createNotification } = require("./notificationService");
const { createServiceDeskTicket } = require("./serviceDeskTicketService");

function normalizeOptionalInteger(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

const PRIORITIES = new Map([
  ["critical", "P1-Critical"], ["p1-critical", "P1-Critical"],
  ["high", "P2-High"], ["p2-high", "P2-High"],
  ["medium", "P3-Medium"], ["p3-medium", "P3-Medium"],
  ["low", "P4-Low"], ["p4-low", "P4-Low"],
]);

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function requireText(payload, field, maxLength) {
  const value = String(payload[field] || "").trim();
  if (!value) throw validationError(`${field} is required.`);
  if (value.length > maxLength) throw validationError(`${field} must be ${maxLength} characters or fewer.`);
  return value;
}

async function createIntegrationTicket(payload, integration, requestContext = {}) {
  const title = requireText(payload, "title", 255);
  const description = String(payload.description || payload.desc || "").trim();
  if (!description) throw validationError("description is required.");
  if (description.length > 10000) throw validationError("description must be 10000 characters or fewer.");
  const branchId = null;
  const employeeId = normalizeOptionalInteger(payload.employee_id || payload.requester_id);
  const requestedOriginSystem = requireText(payload, "origin_system", 150);
  const originModule = requireText(payload, "origin_module", 150);
  const externalReference = requireText(payload, "external_reference", 150);
  const originFeature = String(payload.origin_feature || "").trim() || null;
  if (originFeature && originFeature.length > 150) throw validationError("origin_feature must be 150 characters or fewer.");
  if ((payload.employee_id !== undefined || payload.requester_id !== undefined) && !employeeId) {
    throw validationError("employee_id must be a valid integer when provided.");
  }
  if (payload.category_id !== undefined && payload.category_id !== null && payload.category_id !== "" && !normalizeOptionalInteger(payload.category_id)) {
    throw validationError("category_id must be a valid integer.");
  }

  const priorityInput = String(payload.priority || "Medium").trim().toLowerCase();
  const priority = PRIORITIES.get(priorityInput);
  if (!priority) throw validationError("priority must be Critical, High, Medium, Low, or its P1-P4 canonical value.");

  const externalEmployeeId = requireText(payload, "external_employee_id", 150);
  const requesterName = requireText(payload, "requester_name", 200);
  const requesterEmail = requireText(payload, "requester_email", 320);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail)) {
    throw validationError("requester_email must be a valid email address.");
  }

  if (requestedOriginSystem && requestedOriginSystem.toLowerCase() !== String(integration.system_name).toLowerCase()) {
    const error = new Error("origin_system must match the authenticated external system.");
    error.statusCode = 400;
    throw error;
  }

  if (payload.attachment_metadata !== undefined && !Array.isArray(payload.attachment_metadata)) {
    const error = new Error("attachment_metadata must be an array.");
    error.statusCode = 400;
    throw error;
  }

  return createServiceDeskTicket({
    title,
    description,
    branchId,
    requesterId: employeeId,
    categoryId: payload.category_id,
    categoryName: payload.category,
    priority,
    status: "Open Queue",
    source: "external_api",
    impact: payload.impact,
    urgency: payload.urgency,
    requireBranch: false,
    enforceRequesterExists: Boolean(employeeId),
    notifyServiceDesk: true,
    ticketNumberPrefix: integration.system_code,
    compactTicketNumber: true,
    auditEvent: "External Ticket Created",
    sourceIp: requestContext.sourceIp,
    requestMethod: requestContext.method,
    requestPath: requestContext.path,
    metadata: {
      origin_system: integration.system_name,
      origin_module: originModule,
      origin_feature: originFeature,
      external_reference: externalReference,
      attachment_metadata: payload.attachment_metadata || [],
      integration_id: integration.integration_id,
      created_via: "External API",
      requester_name: requesterName,
      requester_email: requesterEmail,
      external_employee_id: externalEmployeeId,
    },
    failBeforeCommit: requestContext.failBeforeCommit,
  });
}

async function getIntegrationTicketByNumber(ticketNumber, integration) {
  const result = await db.query(
    `
    SELECT
      t.id,
      t.ticket_number,
      t.title,
      t.description,
      t.priority,
      t.status,
      c.category_name,
      assignee.full_name AS assigned_technician_name,
      t.branch_id,
      t.origin_system,
      t.origin_module,
      t.origin_feature,
      t.external_reference,
      t.created_at,
      t.updated_at,
      t.updated_at AS latest_update,
      t.resolution_notes AS resolution,
      COALESCE(public_comments.comments, '[]'::json) AS comments
    FROM tickets t
    LEFT JOIN ticket_categories c ON t.category_id = c.category_id
    LEFT JOIN users assignee ON t.assigned_to = assignee.user_id
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
        'comment', tc.comment_text,
        'created_at', tc.created_at,
        'external_comment_reference', tc.external_comment_reference
      ) ORDER BY tc.created_at, tc.comment_id) AS comments
      FROM ticket_comments tc
      WHERE tc.ticket_id = t.id AND tc.is_internal = false
    ) public_comments ON true
    WHERE t.ticket_number = $1
      AND t.integration_id = $2
    LIMIT 1
    `,
    [ticketNumber, integration.integration_id]
  );
  return result.rows[0] || null;
}

async function addIntegrationTicketComment(ticketId, commentText, externalCommentReference, integration) {
  const client = await db.rawPool.connect();
  try {
    await client.query("BEGIN");
    if (externalCommentReference) {
      const existing = await client.query(
        `SELECT comment_id, comment_text, created_at, external_comment_reference
         FROM ticket_comments WHERE ticket_id=$1 AND integration_id=$2 AND external_comment_reference=$3`,
        [ticketId, integration.integration_id, externalCommentReference]
      );
      if (existing.rows[0]) {
        if (existing.rows[0].comment_text !== commentText) {
          const error = new Error("external_comment_reference already exists with conflicting comment data.");
          error.statusCode = 409;
          throw error;
        }
        await client.query("COMMIT");
        return { comment: existing.rows[0], idempotentReplay: true };
      }
    }
    const result = await client.query(
    `
    INSERT INTO ticket_comments (ticket_id, user_id, comment_text, is_internal, integration_id, external_comment_reference)
    VALUES ($1, NULL, $2, false, $3, $4)
    RETURNING comment_id, comment_text, created_at, external_comment_reference
    `,
    [ticketId, commentText, integration.integration_id, externalCommentReference]
  );

  await client.query(
    `
    INSERT INTO ticket_history (ticket_id, changed_by, action, old_value, new_value)
    VALUES ($1, NULL, $2, $3, $4)
    `,
    [ticketId, "Integration Comment Added", integration.system_name, commentText]
  );

  const recipientsResult = await client.query(
    `SELECT ticket_number, requester_id, assigned_to FROM tickets WHERE id = $1`,
    [ticketId]
  );
  const ticket = recipientsResult.rows[0];
  const recipients = [...new Set([ticket?.requester_id, ticket?.assigned_to].filter(Boolean))];
  for (const userId of recipients) {
    await createNotification({
      userId,
      title: "Ticket Comment Added",
      message: `A new comment was added to ticket ${ticket.ticket_number}.`,
      type: "info",
      ticketId,
      metadata: { event: "external_comment_added", integration_id: integration.integration_id },
      queryable: client,
    });
  }
    await client.query("COMMIT");
    return { comment: result.rows[0], idempotentReplay: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  addIntegrationTicketComment,
  createIntegrationTicket,
  getIntegrationTicketByNumber,
  normalizeOptionalInteger,
};
