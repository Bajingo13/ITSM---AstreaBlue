const crypto = require("crypto");
const { rawPool } = require("../../config/db");
const { applySlaToNewTicket } = require("./slaService");
const { createNotification } = require("./notificationService");
const { emitTicketChanged } = require("./socketService");

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function integerOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function fingerprint(payload) {
  return crypto.createHash("sha256").update(JSON.stringify({
    branch_id: payload.branchId,
    requester_id: payload.requesterId,
    title: payload.title,
    description: payload.description,
    category_id: payload.categoryId,
    category_name: payload.categoryName,
    external_employee_id: payload.metadata.external_employee_id || null,
    requester_name: payload.metadata.requester_name || null,
    requester_email: payload.metadata.requester_email || null,
    priority: payload.priority,
    origin_module: payload.metadata.origin_module || null,
    origin_feature: payload.metadata.origin_feature || null,
  })).digest("hex");
}

async function nextTicketNumber(client, prefix = "TKT", compact = false) {
  const safePrefix = String(prefix || "TKT").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 30) || "TKT";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const base = `${safePrefix}-${date}${compact ? "" : "-"}`;
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`astreablue_ticket_number:${base}`]);
  const result = await client.query(`
    SELECT COALESCE(MAX((regexp_match(ticket_number, $2))[1]::int), 0) + 1 AS next_number
    FROM tickets
    WHERE ticket_number LIKE $1
      AND ticket_number ~ $2
  `, [`${base}%`, `^${base}([0-9]+)$`]);
  return `${base}${String(result.rows[0].next_number).padStart(compact ? 3 : 4, "0")}`;
}

async function findIdempotentTicket(client, originSystem, externalReference) {
  if (!originSystem || !externalReference) return null;
  const result = await client.query(
    `SELECT * FROM tickets WHERE origin_system = $1 AND external_reference = $2 LIMIT 1 FOR UPDATE`,
    [originSystem, externalReference]
  );
  return result.rows[0] || null;
}

async function createServiceDeskTicket(input) {
  const title = String(input.title || "").trim();
  const description = String(input.description || "").trim();
  if (!title || !description) throw httpError(400, "Title and description are required.");

  const branchId = integerOrNull(input.branchId);
  const requesterId = integerOrNull(input.requesterId);
  let categoryId = integerOrNull(input.categoryId);
  const categoryName = String(input.categoryName || "").trim() || null;
  const assignedTo = integerOrNull(input.assignedTo);
  const priority = input.priority || "P3-Medium";
  const status = input.status || "Open Queue";
  const metadata = input.metadata || {};
  const externalReference = String(metadata.external_reference || "").trim() || null;
  const originSystem = String(metadata.origin_system || "").trim() || null;
  const normalized = { branchId, requesterId, categoryId, categoryName, title, description, priority, metadata };
  const requestFingerprint = fingerprint(normalized);
  // Internal workflows may supply their existing transaction so the ticket and
  // its owning business record commit or roll back together.
  const ownsClient = !input.client;
  const client = input.client || await rawPool.connect();

  try {
    if (ownsClient) await client.query("BEGIN");

    if (branchId) {
      const branch = await client.query("SELECT branch_id, branch_name FROM branches WHERE branch_id = $1", [branchId]);
      if (!branch.rows[0]) throw httpError(400, "Selected branch does not exist.");
    }

    if (!categoryId && categoryName) {
      const category = await client.query(
        "SELECT category_id FROM ticket_categories WHERE LOWER(category_name) = LOWER($1) LIMIT 1",
        [categoryName]
      );
      if (!category.rows[0]) throw httpError(400, "Unknown ticket category.");
      categoryId = category.rows[0].category_id;
    }

    if (input.requireBranch && !branchId) throw httpError(403, "An authorized branch is required.");

    if (requesterId && input.enforceRequesterBranch) {
      const requester = await client.query(
        `SELECT u.user_id,u.branch_id,r.role_name
           FROM users u
           JOIN system_roles r ON r.role_id=u.role_id
          WHERE u.user_id=$1 AND COALESCE(u.is_active,true)=true`,
        [requesterId]
      );
      if (!requester.rows[0] || Number(requester.rows[0].branch_id) !== branchId) {
        throw httpError(400, "employee_id does not exist in the selected branch.");
      }
      if (
        input.requiredRequesterRole
        && String(requester.rows[0].role_name || "").trim().toLowerCase() !== String(input.requiredRequesterRole).trim().toLowerCase()
      ) {
        throw httpError(400, `The selected requester must have the ${input.requiredRequesterRole} role.`);
      }
    }
    if (requesterId && input.enforceRequesterExists && !input.enforceRequesterBranch) {
      const requester = await client.query("SELECT user_id FROM users WHERE user_id = $1", [requesterId]);
      if (!requester.rows[0]) throw httpError(400, "employee_id does not exist in AstreaBlue.");
    }

    if (originSystem && externalReference) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${originSystem}:${externalReference}`]);
    }
    const existing = await findIdempotentTicket(client, originSystem, externalReference);
    if (existing) {
      if (existing.external_request_fingerprint !== requestFingerprint) {
        throw httpError(409, "external_reference already exists with conflicting ticket data.");
      }
      if (ownsClient) await client.query("COMMIT");
      return { ticket: existing, idempotentReplay: true };
    }

    const ticketNumber = await nextTicketNumber(client, input.ticketNumberPrefix, input.compactTicketNumber);
    const sla = await applySlaToNewTicket({ priority, category_id: categoryId }, client);
    const slaDueDate = sla?.resolution_due_at || new Date(Date.now() + 86400000);
    const result = await client.query(`
      INSERT INTO tickets (
        ticket_number, title, description, priority, status, category_id, requester_id,
        assigned_to, branch_id, source, impact, urgency, sla_due_date, sla_policy_id,
        response_due_at, resolution_due_at, response_sla_status, resolution_sla_status,
        origin_system, origin_module, origin_feature, external_reference,
        external_attachment_metadata, external_request_fingerprint, integration_id,
        employee_id, created_via, external_requester_name, external_requester_email,
        external_employee_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23::jsonb,$24,$25,$26,$27,$28,$29,$30
      ) RETURNING *, description AS desc
    `, [
      ticketNumber, title, description, priority, status, categoryId, requesterId,
      assignedTo, branchId, input.source || "portal", input.impact || null, input.urgency || null,
      slaDueDate, sla?.sla_policy_id || null, sla?.response_due_at || null,
      sla?.resolution_due_at || null, sla?.response_sla_status || "Pending",
      sla?.resolution_sla_status || "Pending", originSystem, metadata.origin_module || null,
      metadata.origin_feature || null, externalReference,
      JSON.stringify(metadata.attachment_metadata || []), requestFingerprint,
      integerOrNull(metadata.integration_id), requesterId, metadata.created_via || null,
      metadata.requester_name || null, metadata.requester_email || null,
      metadata.external_employee_id || null,
    ]);
    const ticket = result.rows[0];

    const branchResult = branchId
      ? await client.query("SELECT branch_name FROM branches WHERE branch_id = $1", [branchId])
      : { rows: [] };
    await client.query(`
      INSERT INTO ticket_history (ticket_id, changed_by, action, old_value, new_value)
      VALUES ($1,$2,'Ticket Created',NULL,$3)
    `, [ticket.id, input.actorId || requesterId, `Ticket filed from ${branchResult.rows[0]?.branch_name || "Unassigned Branch"}`]);

    let notificationUserIds = requesterId ? [requesterId] : [];
    if (!requesterId && input.notifyServiceDesk) {
      const recipients = await client.query(`
        SELECT u.user_id
        FROM users u
        JOIN system_roles r ON r.role_id = u.role_id
        WHERE COALESCE(u.is_active, true) = true
          AND LOWER(r.role_name) = 'superadmin'
      `);
      notificationUserIds = recipients.rows.map((row) => row.user_id);
    }
    for (const notificationUserId of notificationUserIds) {
      await createNotification({
        userId: notificationUserId,
        title: "Ticket Created",
        message: `Ticket ${ticketNumber} was created successfully.`,
        type: "success",
        ticketId: ticket.id,
        metadata: { event: "ticket_created", source: input.source || "portal" },
        queryable: client,
      });
    }

    await client.query(`
      INSERT INTO integration_audit_logs
        (integration_id,event_type,source_ip,request_method,request_path,success,status_code,branch_id,employee_id,metadata)
      VALUES ($1,$2,$3,$4,$5,true,201,$6,$7,$8::jsonb)
    `, [integerOrNull(metadata.integration_id), input.auditEvent || "Ticket Created", input.sourceIp || null,
      input.requestMethod || null, input.requestPath || null, branchId, requesterId,
      JSON.stringify({ ticket_id: ticket.id, ticket_number: ticketNumber, origin_system: originSystem })]);

    if (input.failBeforeCommit) throw new Error("Injected ticket creation failure");
    if (ownsClient) await client.query("COMMIT");
    if (input.emitAfterCreate !== false) {
      emitTicketChanged({
        action: "created",
        ticket_id: ticket.id,
        ticket_number: ticket.ticket_number,
        branch_id: ticket.branch_id,
        requester_id: ticket.requester_id,
        assigned_to: ticket.assigned_to,
        status: ticket.status,
      });
    }
    return { ticket, idempotentReplay: false };
  } catch (error) {
    if (ownsClient) await client.query("ROLLBACK").catch(() => {});
    console.error(JSON.stringify({ event: "ticket_creation_rollback", message: error.message, source: input.source || "portal" }));
    throw error;
  } finally {
    if (ownsClient) client.release();
  }
}

module.exports = { createServiceDeskTicket };
