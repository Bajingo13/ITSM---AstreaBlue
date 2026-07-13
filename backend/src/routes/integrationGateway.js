const express = require("express");
const ticketRoutes = require("./tickets");
const { requireIntegrationApiKey } = require("../middleware/integrationAuth");
const {
  auditIntegrationRequest,
  ensureIntegrationGatewaySchema,
} = require("../services/integrationService");
const {
  addIntegrationTicketComment,
  createIntegrationTicket,
  getIntegrationTicketByNumber,
} = require("../services/integrationTicketService");

const router = express.Router();

const gatewaySchemaReady = ticketRoutes.ticketSchemaReady.then(() => ensureIntegrationGatewaySchema());

function externalTicketResponse(ticket, idempotentReplay = false) {
  return {
    ticket_number: ticket.ticket_number,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    origin_system: ticket.origin_system,
    origin_module: ticket.origin_module,
    origin_feature: ticket.origin_feature,
    external_reference: ticket.external_reference,
    category: ticket.category_name || null,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at || ticket.latest_update,
    assigned_technician_name: ticket.assigned_technician_name || null,
    latest_update: ticket.latest_update || ticket.updated_at,
    resolution: ticket.resolution || null,
    comments: ticket.comments || [],
    ...(idempotentReplay ? { idempotent_replay: true } : {}),
  };
}

router.use(async (_req, res, next) => {
  try {
    await gatewaySchemaReady;
    next();
  } catch (err) {
    console.error("Integration gateway schema error:", err.message);
    res.status(500).json({ success: false, message: "Integration gateway is unavailable.", data: null });
  }
});

router.use(requireIntegrationApiKey);

router.post("/tickets", async (req, res) => {
  try {
    const creation = await createIntegrationTicket(
      {
        ...req.body,
        created_via: "External API",
      },
      req.integration,
      { sourceIp: req.ip, method: req.method, path: req.originalUrl }
    );
    const statusCode = creation.idempotentReplay ? 200 : 201;
    console.info(JSON.stringify({
      event: creation.idempotentReplay ? "external_ticket_idempotent_replay" : "external_ticket_created",
      integration_id: req.integration.integration_id,
      ticket_number: creation.ticket.ticket_number,
    }));
    res.status(statusCode).json({
      success: true,
      message: creation.idempotentReplay
        ? "Existing ticket returned for this external reference."
        : "Ticket created successfully.",
      data: externalTicketResponse(creation.ticket, creation.idempotentReplay),
    });
  } catch (err) {
    await auditIntegrationRequest(req, "ticket_create_failed", {
      success: false,
      statusCode: err.statusCode || 500,
      metadata: { error: err.message },
    });
    console.error("Integration ticket create error:", err.message);
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.statusCode ? err.message : "Failed to create integration ticket.",
      data: null,
    });
  }
});

router.get("/tickets/:ticketNumber", async (req, res) => {
  try {
    const ticket = await getIntegrationTicketByNumber(req.params.ticketNumber, req.integration);
    if (!ticket) {
      console.warn(JSON.stringify({ event: "external_lookup_denied", integration_id: req.integration.integration_id, ticket_number: req.params.ticketNumber }));
      await auditIntegrationRequest(req, "ticket_retrieve_denied", {
        success: false,
        statusCode: 404,
        metadata: { ticket_number: req.params.ticketNumber },
      });
      return res.status(404).json({ success: false, message: "Ticket not found.", data: null });
    }

    await auditIntegrationRequest(req, "External Status Requested", {
      statusCode: 200,
      metadata: { ticket_number: ticket.ticket_number, branch_id: ticket.branch_id },
    });
    res.json({ success: true, message: "Ticket retrieved.", data: externalTicketResponse(ticket) });
  } catch (err) {
    await auditIntegrationRequest(req, "External Status Requested", {
      success: false,
      statusCode: 500,
      metadata: { ticket_number: req.params.ticketNumber, error: err.message },
    });
    console.error("External ticket retrieve error:", err.message);
    res.status(500).json({ success: false, message: "Failed to retrieve ticket.", data: null });
  }
});

router.post("/tickets/:ticketNumber/comments", async (req, res) => {
  try {
    const commentText = String(req.body.comment_text || req.body.comment || "").trim();
    if (!commentText) {
      return res.status(400).json({ success: false, message: "comment is required.", data: null });
    }
    if (commentText.length > 5000) {
      return res.status(400).json({ success: false, message: "comment must be 5000 characters or fewer.", data: null });
    }
    const externalCommentReference = String(req.body.external_comment_reference || "").trim() || null;
    if (externalCommentReference && externalCommentReference.length > 150) {
      return res.status(400).json({ success: false, message: "external_comment_reference must be 150 characters or fewer.", data: null });
    }

    const ticket = await getIntegrationTicketByNumber(req.params.ticketNumber, req.integration);
    if (!ticket) {
      console.warn(JSON.stringify({ event: "external_comment_denied", integration_id: req.integration.integration_id, ticket_number: req.params.ticketNumber }));
      await auditIntegrationRequest(req, "comment_add_denied", {
        success: false,
        statusCode: 404,
        metadata: { ticket_number: req.params.ticketNumber },
      });
      return res.status(404).json({ success: false, message: "Ticket not found.", data: null });
    }

    const result = await addIntegrationTicketComment(ticket.id, commentText, externalCommentReference, req.integration);
    await auditIntegrationRequest(req, "External Comment Added", {
      statusCode: result.idempotentReplay ? 200 : 201,
      metadata: { ticket_number: ticket.ticket_number, comment_id: result.comment.comment_id, idempotent_replay: result.idempotentReplay },
    });

    res.status(result.idempotentReplay ? 200 : 201).json({
      success: true,
      message: result.idempotentReplay ? "Existing comment returned." : "Comment added.",
      data: {
        comment: result.comment.comment_text,
        created_at: result.comment.created_at,
        external_comment_reference: result.comment.external_comment_reference,
        ...(result.idempotentReplay ? { idempotent_replay: true } : {}),
      },
    });
  } catch (err) {
    await auditIntegrationRequest(req, "External Comment Added", {
      success: false,
      statusCode: err.statusCode || 500,
      metadata: { ticket_number: req.params.ticketNumber, error: err.message },
    });
    console.error("External comment add error:", err.message);
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.statusCode ? err.message : "Failed to add comment.",
      data: null,
    });
  }
});

module.exports = router;
module.exports.gatewaySchemaReady = gatewaySchemaReady;
