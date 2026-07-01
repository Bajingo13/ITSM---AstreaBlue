const nodemailer = require("nodemailer");

function cleanEnv(value) {
  return String(value || "").trim();
}

function smtpCredentials() {
  const user = cleanEnv(process.env.SMTP_USER);
  const pass = cleanEnv(process.env.SMTP_PASS).replace(/\s+/g, "");

  if (!user || !pass) {
    throw new Error("SMTP configuration is incomplete.");
  }

  return { user, pass };
}

function getTransporter({ fallback = false } = {}) {
  const auth = smtpCredentials();
  const configuredPort = Number.parseInt(cleanEnv(process.env.SMTP_PORT), 10);
  const configuredSecure = cleanEnv(process.env.SMTP_SECURE).toLowerCase();
  const port = fallback ? 587 : Number.isInteger(configuredPort) ? configuredPort : 465;
  const secure = fallback ? false : configuredSecure ? configuredSecure === "true" : port === 465;

  return nodemailer.createTransport({
    host: cleanEnv(process.env.SMTP_HOST) || "smtp.gmail.com",
    port,
    secure,
    requireTLS: fallback || port === 587,
    auth,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

async function sendMail(message) {
  try {
    return await getTransporter().sendMail(message);
  } catch (primaryError) {
    const connectionErrorCodes = new Set([
      "ECONNECTION",
      "ETIMEDOUT",
      "ECONNREFUSED",
      "ECONNRESET",
    ]);

    if (!connectionErrorCodes.has(primaryError.code)) {
      throw primaryError;
    }

    console.warn(`Primary SMTP connection failed (${primaryError.code}); retrying with TLS on port 587.`);
    return getTransporter({ fallback: true }).sendMail(message);
  }
}

function getMissingSmtpConfig() {
  return [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM_EMAIL",
  ].filter((key) => !process.env[key]);
}

function fromAddress() {
  const fromName = process.env.SMTP_FROM_NAME || "AstreaBlue ITSM";
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  return `"${fromName}" <${fromEmail}>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function sendInvitationEmail({
  to,
  fullName,
  roleName,
  branchName,
  inviteLink,
}) {
  const safeName = escapeHtml(fullName || "there");
  const safeRole = escapeHtml(roleName || "Employee");
  const safeBranch = escapeHtml(branchName || "Assigned Branch");

  return sendMail({
    from: fromAddress(),
    to,
    subject: `Welcome to AstreaBlue ITSM, ${safeName}`,
    text: [
      `Hello ${safeName},`,
      "",
      `You've been invited to join the AstreaBlue ITSM system as a ${safeRole} at ${safeBranch}.`,
      "Please complete your registration by visiting the link below:",
      "",
      inviteLink,
      "",
      "This link will expire in 24 hours.",
      "If you didn't expect this invitation, please ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6;">
        <h2 style="margin: 0 0 16px;">Welcome to AstreaBlue ITSM</h2>
        <p>Hello <strong>${safeName}</strong>,</p>
        <p>You've been invited to join the system as a <strong>${safeRole}</strong> at <strong>${safeBranch}</strong>.</p>
        <div style="margin: 32px 0;">
          <a href="${inviteLink}" style="background-color: #3b82f6; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">
            Complete Registration
          </a>
        </div>
        <p style="font-size: 0.9em; color: #64748b;">Or copy and paste this link into your browser:<br/>
        <a href="${inviteLink}">${inviteLink}</a></p>
        <p style="font-size: 0.85em; color: #94a3b8; margin-top: 32px;">This link will expire in 24 hours.</p>
      </div>
    `,
  });
}

async function sendWelcomeEmail() {
  throw new Error("sendWelcomeEmail is not implemented yet.");
}

function ticketRecipient(ticket) {
  return (
    ticket?.requester_company_email ||
    ticket?.company_email ||
    ticket?.requester_personal_email ||
    ticket?.personal_email ||
    ticket?.requester_email ||
    ticket?.email ||
    null
  );
}

function ticketLink(ticket) {
  if (!process.env.FRONTEND_URL) return null;
  const origin = process.env.FRONTEND_URL.replace(/\/$/, "");
  return `${origin}/tickets`;
}

function ticketFields(ticket) {
  return {
    number: ticket?.ticket_number || `TKT-${ticket?.id || ""}`,
    title: ticket?.title || "Untitled ticket",
    status: ticket?.status || "Open Queue",
    priority: ticket?.priority || "P3-Medium",
    branch: ticket?.branch_name || "Unassigned Branch",
    technician: ticket?.assigned_name || "Not assigned",
  };
}

async function sendTicketEmail(ticket, { subject, message }) {
  const to = ticketRecipient(ticket);

  if (!to) {
    return {
      sent: false,
      warning: "Ticket email skipped because requester has no email address.",
    };
  }

  const fields = ticketFields(ticket);
  const link = ticketLink(ticket);
  const safeMessage = escapeHtml(message);
  const safeLink = link ? escapeHtml(link) : null;

  await sendMail({
    from: fromAddress(),
    to,
    subject,
    text: [
      message,
      "",
      `Ticket Number: ${fields.number}`,
      `Title: ${fields.title}`,
      `Status: ${fields.status}`,
      `Priority: ${fields.priority}`,
      `Branch: ${fields.branch}`,
      `Assigned Technician: ${fields.technician}`,
      ...(link ? ["", `View ticket: ${link}`] : []),
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6;">
        <h2 style="margin: 0 0 16px;">${escapeHtml(subject)}</h2>
        <p>${safeMessage}</p>
        <table style="border-collapse: collapse; margin: 18px 0; width: 100%; max-width: 620px;">
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Ticket Number</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${escapeHtml(fields.number)}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Title</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${escapeHtml(fields.title)}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Status</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${escapeHtml(fields.status)}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Priority</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${escapeHtml(fields.priority)}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Branch</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${escapeHtml(fields.branch)}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Assigned Technician</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${escapeHtml(fields.technician)}</td></tr>
        </table>
        ${
          safeLink
            ? `<p><a href="${safeLink}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">View Ticket</a></p><p style="word-break: break-all;">${safeLink}</p>`
            : ""
        }
      </div>
    `,
  });

  return { sent: true };
}

async function sendTicketCreatedEmail(ticket) {
  return sendTicketEmail(ticket, {
    subject: `Ticket Created: ${ticket?.ticket_number || ""}`.trim(),
    message: "Your ticket has been created and logged in AstreaBlue ITSM.",
  });
}

async function sendTicketAssignedEmail(ticket) {
  return sendTicketEmail(ticket, {
    subject: `Ticket Assigned: ${ticket?.ticket_number || ""}`.trim(),
    message: "Your ticket has been assigned to a technician.",
  });
}

async function sendTicketStatusEmail(ticket) {
  return sendTicketEmail(ticket, {
    subject: `Ticket Status Updated: ${ticket?.ticket_number || ""}`.trim(),
    message: `Your ticket status has changed to ${ticket?.status || "Updated"}.`,
  });
}

async function sendTicketResolvedEmail(ticket) {
  return sendTicketEmail(ticket, {
    subject: `Ticket Resolved: ${ticket?.ticket_number || ""}`.trim(),
    message: "Your ticket has been marked as resolved.",
  });
}

async function sendTicketClosedEmail(ticket) {
  return sendTicketEmail(ticket, {
    subject: `Ticket Closed: ${ticket?.ticket_number || ""}`.trim(),
    message: "Your ticket has been closed.",
  });
}

async function sendTicketCancelledEmail(ticket) {
  return sendTicketEmail(ticket, {
    subject: `Ticket Cancelled: ${ticket?.ticket_number || ""}`.trim(),
    message: "Your ticket has been cancelled.",
  });
}

module.exports = {
  getMissingSmtpConfig,
  sendInvitationEmail,
  sendWelcomeEmail,
  sendTicketCreatedEmail,
  sendTicketAssignedEmail,
  sendTicketStatusEmail,
  sendTicketResolvedEmail,
  sendTicketClosedEmail,
  sendTicketCancelledEmail,
};
