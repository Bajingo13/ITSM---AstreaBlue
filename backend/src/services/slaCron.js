const cron = require("node-cron");
const db = require("../../config/db");
const { sendSlaBreachEmail } = require("./emailService");
const { createNotification } = require("./notificationService");
const { emitSlaUpdated } = require("./socketService");

const DUE_SOON_MINUTES = 240;
const ACTIVE_STATUSES = ["Resolved", "Closed", "Cancelled"];

async function notifyDueSoon() {
  const result = await db.query(
    `
    UPDATE tickets t
    SET sla_due_soon_notified_at = CURRENT_TIMESTAMP
    WHERE t.status <> ALL($1::text[])
      AND t.assigned_to IS NOT NULL
      AND t.sla_due_soon_notified_at IS NULL
      AND COALESCE(t.response_sla_status, 'Pending') <> 'Breached'
      AND COALESCE(t.resolution_sla_status, 'Pending') <> 'Breached'
      AND (
        (t.first_response_at IS NULL AND t.response_due_at > NOW()
          AND t.response_due_at <= NOW() + ($2 * INTERVAL '1 minute'))
        OR
        (t.resolved_at IS NULL AND t.resolution_due_at > NOW()
          AND t.resolution_due_at <= NOW() + ($2 * INTERVAL '1 minute'))
      )
    RETURNING t.id, t.ticket_number, t.title, t.assigned_to
    `,
    [ACTIVE_STATUSES, DUE_SOON_MINUTES]
  );

  for (const ticket of result.rows) {
    await createNotification({
      userId: ticket.assigned_to,
      title: "Ticket SLA Due Soon",
      message: `SLA is due within 4 hours for ticket ${ticket.ticket_number}: ${ticket.title}`,
      type: "warning",
      ticketId: ticket.id,
      metadata: { event: "sla_due_soon" },
      dedupeKey: `sla-due-soon:${ticket.id}`,
    });
  }
}

async function markBreaches() {
  const result = await db.query(
    `
    UPDATE tickets
    SET
      response_sla_status = CASE
        WHEN first_response_at IS NULL AND response_due_at <= NOW() THEN 'Breached'
        ELSE response_sla_status
      END,
      resolution_sla_status = CASE
        WHEN resolved_at IS NULL AND resolution_due_at <= NOW() THEN 'Breached'
        ELSE resolution_sla_status
      END
    WHERE status <> ALL($1::text[])
      AND (
        (first_response_at IS NULL AND response_due_at <= NOW()
          AND response_sla_status IS DISTINCT FROM 'Breached')
        OR
        (resolved_at IS NULL AND resolution_due_at <= NOW()
          AND resolution_sla_status IS DISTINCT FROM 'Breached')
      )
    RETURNING id, ticket_number
    `,
    [ACTIVE_STATUSES]
  );

  for (const ticket of result.rows) {
    emitSlaUpdated({
      type: "breach",
      ticket_id: ticket.id,
      ticket_no: ticket.ticket_number || `TKT-${ticket.id}`,
      timestamp: new Date().toISOString(),
    });
  }
}

async function deliverBreachAlerts() {
  const result = await db.query(
    `
    SELECT
      t.id, t.ticket_number, t.title, t.priority, t.status,
      t.response_due_at, t.resolution_due_at, t.sla_due_date,
      t.assigned_to, t.sla_breach_notification_sent_at, t.sla_breach_email_sent_at,
      COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,
      technician.full_name AS assigned_name,
      technician.email AS assigned_email
    FROM tickets t
    LEFT JOIN branches b ON b.branch_id = t.branch_id
    LEFT JOIN users technician ON technician.user_id = t.assigned_to
    WHERE t.status <> ALL($1::text[])
      AND t.assigned_to IS NOT NULL
      AND (t.response_sla_status = 'Breached' OR t.resolution_sla_status = 'Breached')
      AND (t.sla_breach_notification_sent_at IS NULL OR t.sla_breach_email_sent_at IS NULL)
    `,
    [ACTIVE_STATUSES]
  );

  for (const ticket of result.rows) {
    if (!ticket.sla_breach_notification_sent_at) {
      await createNotification({
        userId: ticket.assigned_to,
        title: "SLA Breached",
        message: `SLA breached for ticket ${ticket.ticket_number}: ${ticket.title}`,
        type: "error",
        ticketId: ticket.id,
        metadata: { event: "sla_breached" },
        dedupeKey: `sla-breached:${ticket.id}`,
      });
      await db.query(
        "UPDATE tickets SET sla_breach_notification_sent_at = CURRENT_TIMESTAMP WHERE id = $1",
        [ticket.id]
      );
    }

    if (!ticket.sla_breach_email_sent_at) {
      const emailResult = await sendSlaBreachEmail(ticket);
      if (emailResult?.success) {
        await db.query(
          "UPDATE tickets SET sla_breach_email_sent_at = CURRENT_TIMESTAMP WHERE id = $1",
          [ticket.id]
        );
      } else {
        console.warn(`SLA breach email not sent for ticket ${ticket.ticket_number}: ${emailResult?.error || emailResult?.warning || "Unknown email error"}`);
      }
    }
  }
}

async function runSlaChecks() {
  try {
    await notifyDueSoon();
    await markBreaches();
    await deliverBreachAlerts();
  } catch (error) {
    console.error("Error in SLA cron:", error.message);
  }
}

cron.schedule("*/5 * * * *", runSlaChecks);
console.info("SLA Cron initialized.");

module.exports = { runSlaChecks };
