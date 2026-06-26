const nodemailer = require("nodemailer");

function getTransporter() {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    SMTP_PASS,
  } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error("SMTP configuration is incomplete.");
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: String(SMTP_SECURE).toLowerCase() === "true",
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
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
  const transporter = getTransporter();
  const safeName = escapeHtml(fullName || "there");
  const safeRole = escapeHtml(roleName || "Employee");
  const safeBranch = escapeHtml(branchName || "Assigned Branch");
  const safeInviteLink = escapeHtml(inviteLink);

  return transporter.sendMail({
    from: fromAddress(),
    to,
    subject: "AstreaBlue ITSM Account Invitation",
    text: [
      `Hello ${fullName || "there"},`,
      "",
      "You have been invited to create your AstreaBlue ITSM account.",
      `Role: ${roleName || "Employee"}`,
      `Branch: ${branchName || "Assigned Branch"}`,
      "",
      `Create your account: ${inviteLink}`,
      "",
      "This one-time link expires in 48 hours.",
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6;">
        <h2 style="margin: 0 0 16px;">AstreaBlue ITSM Account Invitation</h2>
        <p>Hello ${safeName},</p>
        <p>You have been invited to create your AstreaBlue ITSM account.</p>
        <p><strong>Role:</strong> ${safeRole}<br/><strong>Branch:</strong> ${safeBranch}</p>
        <p>
          <a href="${safeInviteLink}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">
            Create Account
          </a>
        </p>
        <p>If the button does not work, open this link:</p>
        <p style="word-break: break-all;">${safeInviteLink}</p>
        <p>This link is one-time use and expires in 48 hours.</p>
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

  const transporter = getTransporter();
  const fields = ticketFields(ticket);
  const link = ticketLink(ticket);
  const safeMessage = escapeHtml(message);
  const safeLink = link ? escapeHtml(link) : null;

  await transporter.sendMail({
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
