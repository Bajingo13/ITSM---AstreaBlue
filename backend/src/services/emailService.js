const nodemailer = require("nodemailer");
const { generateEmailHtml } = require("./emailTemplates");

function cleanEnv(value) {
  return String(value || "").trim();
}

function smtpCredentials() {
  const user = cleanEnv(process.env.SMTP_USER);
  const pass = cleanEnv(process.env.SMTP_PASS).replace(/\s+/g, "");

  if (!user || !pass) {
    const missing = [!user && "SMTP_USER", !pass && "SMTP_PASS"].filter(Boolean);
    throw new Error(`SMTP configuration is incomplete. Missing: ${missing.join(", ")}.`);
  }

  return { user, pass };
}

function smtpConfig() {
  const auth = smtpCredentials();
  const configuredPort = Number.parseInt(cleanEnv(process.env.SMTP_PORT), 10);
  const port = Number.isInteger(configuredPort) ? configuredPort : 587;
  
  let secure = port === 465;
  const secureStr = cleanEnv(process.env.SMTP_SECURE).toLowerCase();
  if (secureStr === "true") secure = true;
  else if (secureStr === "false") secure = false;

  return {
    host: cleanEnv(process.env.SMTP_HOST),
    port,
    secure,
    requireTLS: port === 587,
    auth,
    tls: {
      rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
    },
    family: 4,
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  };
}

async function sendMail(message) {
  const startedAt = Date.now();
  const config = smtpConfig();
  const diagnostics = {
    provider: "smtp",
    host: config.host,
    port: config.port,
    secure: config.secure,
    sender: message.from,
    receiver: message.to,
  };

  console.info("Email delivery started", diagnostics);
  try {
    const transporter = nodemailer.createTransport(config);
    await transporter.verify();
    const info = await transporter.sendMail(message);
    
    const result = {
      success: true,
      provider: "smtp",
      host: config.host,
      port: config.port,
      messageId: info.messageId || null,
    };
    
    console.info("Email delivery succeeded", { ...diagnostics, responseTimeMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    console.error("Email delivery failed", {
      ...diagnostics,
      responseTimeMs: Date.now() - startedAt,
      error: exactEmailError(error),
    });
    throw error;
  }
}

function exactEmailError(error) {
  if (error?.code === "ETIMEDOUT") {
    return "SMTP connection timed out. Check Railway network access, SMTP_HOST, SMTP_PORT, and Google App Password.";
  }
  return [error?.code, error?.command, error?.response, error?.message]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(": ") || "Unknown email provider error.";
}

function getMissingSmtpConfig() {
  return [
    "SMTP_HOST",
    "SMTP_USER",
    "SMTP_PASS",
  ].filter((key) => !cleanEnv(process.env[key])).concat(
    cleanEnv(process.env.EMAIL_FROM) || cleanEnv(process.env.SMTP_FROM_EMAIL)
      ? []
      : ["EMAIL_FROM or SMTP_FROM_EMAIL"]
  );
}

function fromAddress() {
  const fromName = process.env.SMTP_FROM_NAME || "AstreaBlue ITSM";
  const fromEmail = process.env.EMAIL_FROM || process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
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

  try {
    const bodyContent = `
      <p style="font-size: 17px; font-weight: 600; margin-bottom: 16px;">Hello ${safeName},</p>
      <p>You have been invited to join <strong>AstreaBlue ITSM</strong> as a:</p>
      <div class="info-block" style="background:#F8FAFC;border-radius:12px;padding:18px 22px;margin-bottom:24px;border:1px solid #E2E8F0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:6px 0;font-size:13px;color:#64748B;width:80px;vertical-align:top;">Role:</td>
            <td style="padding:6px 0;font-size:14px;font-weight:700;color:#2563EB;">${safeRole}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:13px;color:#64748B;width:80px;vertical-align:top;">Branch:</td>
            <td style="padding:6px 0;font-size:14px;font-weight:700;color:#0F172A;">${safeBranch}</td>
          </tr>
        </table>
      </div>
      <p>Complete your registration to activate your account. This invitation is valid for <strong>24 hours</strong>.</p>
      <div class="button-wrapper" style="text-align:center;margin:28px 0;">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${inviteLink}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="25%" strokecolor="#2563EB" fillcolor="#2563EB">
          <w:anchorlock/>
          <center style="color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:700;">Complete Registration</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-- -->
        <a href="${inviteLink}" style="display:inline-block;background:linear-gradient(135deg,#2563EB 0%,#38BDF8 100%);color:#ffffff !important;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;text-align:center;box-shadow:0 4px 10px rgba(37,99,235,0.2);">Complete Registration</a>
        <!--<![endif]-->
      </div>
      <div class="fallback-link" style="text-align:center;margin:18px 0 0;font-size:13px;color:#64748B;">
        Or copy and paste this link into your browser:<br/>
        <a href="${inviteLink}" style="color:#2563EB;word-break:break-all;">${inviteLink}</a>
      </div>
    `;

    return await sendMail({
      from: fromAddress(),
      to,
      subject: `Welcome to AstreaBlue ITSM, ${safeName}`,
      text: [
      `Hello ${safeName},`,
      "",
      `You have been invited to join AstreaBlue ITSM as a ${safeRole} at ${safeBranch}.`,
      "Complete your registration to activate your account:",
      "",
      inviteLink,
      "",
      "This invitation expires in 24 hours.",
      "Regards,",
      "AstreaBlue ITSM Team",
      ].join("\n"),
      html: generateEmailHtml("Welcome to AstreaBlue ITSM", bodyContent),
    });
  } catch (error) {
    return {
      success: false,
      provider: "smtp",
      error: exactEmailError(error),
    };
  }
}

async function sendWelcomeEmail() {
  throw new Error("sendWelcomeEmail is not implemented yet.");
}

async function sendTestEmail(to) {
  try {
    const timestamp = new Date().toLocaleString();
    const providerName = "SMTP";

    const textContent = [
      "Hello,",
      "",
      "This is a test email from AstreaBlue ITSM.",
      "",
      "Your email provider is configured correctly.",
      "",
      "If you received this email, production email delivery is working successfully.",
      "",
      `Provider: ${providerName}`,
      "Time:",
      timestamp,
      "",
      "Regards,",
      "AstreaBlue ITSM"
    ].join("\n");

    const bodyContent = `
      <p>Hello,</p>
      <p>This is a test email from <strong>AstreaBlue ITSM</strong>.</p>
      <p>Your email provider is configured correctly.</p>
      <p>If you received this email, production email delivery is working successfully.</p>
      
      <div style="background-color: #f8fafc; border-left: 4px solid #38BDF8; padding: 20px; margin: 32px 0; border-radius: 0 8px 8px 0;">
        <p style="margin: 0 0 12px 0;"><strong>Provider:</strong> ${providerName}</p>
        <p style="margin: 0 0 4px 0;"><strong>Time:</strong></p>
        <p style="margin: 0; color: #64748b;">${timestamp}</p>
      </div>
    `;

    return await sendMail({
      from: fromAddress(),
      to,
      subject: "AstreaBlue ITSM - Email Test",
      text: textContent,
      html: generateEmailHtml("AstreaBlue ITSM - Email Test", bodyContent),
    });
  } catch (error) {
    const config = smtpConfig();
    return {
      success: false,
      provider: "smtp",
      host: config.host,
      port: config.port,
      error: exactEmailError(error),
    };
  }
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
  return `${origin}/ticket/${ticket?.id || ""}`;
}

function ticketFields(ticket) {
  return {
    number: ticket?.ticket_number || `TKT-${ticket?.id || ""}`,
    title: ticket?.title || "Untitled ticket",
    status: ticket?.status || "Open Queue",
    priority: ticket?.priority || "P3-Medium",
    branch: ticket?.branch_name || "Unassigned Branch",
    technician: ticket?.assigned_name || "Not assigned",
    category: ticket?.category_name || "General",
    created_at: ticket?.created_at ? new Date(ticket.created_at).toLocaleString() : null,
    closed_at: ticket?.closed_at ? new Date(ticket.closed_at).toLocaleString() : null,
    cancelled_at: ticket?.cancelled_at ? new Date(ticket.cancelled_at).toLocaleString() : null,
    resolution_notes: ticket?.resolution_notes || null,
    cancellation_reason: ticket?.cancellation_reason || null,
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

  const rowsHtml = [];
  rowsHtml.push(`<tr><th>Ticket Number</th><td>${escapeHtml(fields.number)}</td></tr>`);
  rowsHtml.push(`<tr><th>Title</th><td>${escapeHtml(fields.title)}</td></tr>`);
  rowsHtml.push(`<tr><th>Status</th><td>${escapeHtml(fields.status)}</td></tr>`);
  
  if (message === "Your ticket was successfully filed.") {
    rowsHtml.push(`<tr><th>Category</th><td>${escapeHtml(fields.category)}</td></tr>`);
    rowsHtml.push(`<tr><th>Priority</th><td>${escapeHtml(fields.priority)}</td></tr>`);
    rowsHtml.push(`<tr><th>Branch</th><td>${escapeHtml(fields.branch)}</td></tr>`);
    if (fields.created_at) rowsHtml.push(`<tr><th>Created Date</th><td>${escapeHtml(fields.created_at)}</td></tr>`);
  } else if (message === "Your ticket has been closed.") {
    if (fields.closed_at) rowsHtml.push(`<tr><th>Closed Date</th><td>${escapeHtml(fields.closed_at)}</td></tr>`);
    if (fields.resolution_notes) rowsHtml.push(`<tr><th>Resolution Remarks</th><td>${escapeHtml(fields.resolution_notes)}</td></tr>`);
  } else if (message === "Your ticket has been cancelled.") {
    if (fields.cancelled_at) rowsHtml.push(`<tr><th>Cancelled Date</th><td>${escapeHtml(fields.cancelled_at)}</td></tr>`);
    if (fields.cancellation_reason) rowsHtml.push(`<tr><th>Cancellation Reason</th><td>${escapeHtml(fields.cancellation_reason)}</td></tr>`);
  } else {
    // Default fallback
    rowsHtml.push(`<tr><th>Priority</th><td>${escapeHtml(fields.priority)}</td></tr>`);
    rowsHtml.push(`<tr><th>Branch</th><td>${escapeHtml(fields.branch)}</td></tr>`);
    rowsHtml.push(`<tr><th>Assigned Technician</th><td>${escapeHtml(fields.technician)}</td></tr>`);
  }

  const bodyContent = `
    <p>${safeMessage}</p>
    <table class="data-table">
      ${rowsHtml.join("")}
    </table>
    ${safeLink ? `<a href="${safeLink}" class="button">View Ticket</a><p style="font-size: 0.9em; margin-top: 24px; color: #64748b;">Or copy and paste this link into your browser:<br/><a href="${safeLink}" style="color: #2563EB; word-break: break-all;">${safeLink}</a></p>` : ""}
  `;

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
      ...(link ? ["", `View ticket: ${link}`] : []),
    ].join("\n"),
    html: generateEmailHtml(escapeHtml(subject), bodyContent),
  });

  return { sent: true };
}

async function sendTicketCreatedEmail(ticket) {
  return sendTicketEmail(ticket, {
    subject: `Ticket Created: ${ticket?.ticket_number || ""}`.trim(),
    message: "Your ticket was successfully filed.",
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

async function sendSlaBreachEmail(ticket) {
  const to = ticket?.assigned_email;
  if (!to) {
    return { success: false, warning: "SLA breach email skipped because the assigned technician has no email address." };
  }

  const fields = ticketFields(ticket);
  const dueAt = ticket.resolution_due_at || ticket.response_due_at || ticket.sla_due_date;
  const dueLabel = dueAt ? new Date(dueAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "Not set";
  const link = ticketLink(ticket);
  const rows = [
    ["Ticket Number", fields.number],
    ["Title", fields.title],
    ["Priority", fields.priority],
    ["Current Status", fields.status],
    ["Branch", fields.branch],
    ["SLA Due Date/Time", dueLabel],
    ["Assigned Technician", fields.technician],
  ];
  const rowsHtml = rows
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");

  try {
    return await sendMail({
      from: fromAddress(),
      to,
      subject: `SLA Breached: ${fields.number}`,
      text: [
        `SLA breached for ticket ${fields.number}: ${fields.title}`,
        ...rows.map(([label, value]) => `${label}: ${value}`),
        ...(link ? [`View Ticket: ${link}`] : []),
      ].join("\n"),
      html: generateEmailHtml(
        `SLA Breached: ${escapeHtml(fields.number)}`,
        `<p>This assigned ticket has breached its SLA.</p><table class="data-table">${rowsHtml}</table>${link ? `<a href="${escapeHtml(link)}" class="button">View Ticket</a>` : ""}`
      ),
    });
  } catch (error) {
    return { success: false, error: exactEmailError(error) };
  }
}

async function sendPasswordResetEmail(to, resetLink) {
  try {
    const bodyContent = `
      <p>Hello,</p>
      <p>We received a request to reset your AstreaBlue ITSM password.</p>
      <p>Click the button below to create a new password.</p>
      <a href="${resetLink}" class="button">Reset Password</a>
      <p style="font-size: 0.9em; margin-top: 24px; color: #64748b;">Or copy and paste this link into your browser:<br/>
      <a href="${resetLink}" style="color: #2563EB; word-break: break-all;">${resetLink}</a></p>
      <p style="font-size: 0.85em; margin-top: 32px; color: #64748b;">This link will expire in 30 minutes.<br/>If you did not request this, you can safely ignore this email.</p>
    `;

    return await sendMail({
      from: fromAddress(),
      to,
      subject: "AstreaBlue ITSM - Password Reset Request",
      text: [
        "Hello,",
        "",
        "We received a request to reset your AstreaBlue ITSM password.",
        "Please click the link below to set a new password:",
        "",
        resetLink,
        "",
        "This link will expire in 30 minutes.",
        "If you did not request this, you can safely ignore this email.",
      ].join("\n"),
      html: generateEmailHtml("Password Reset Request", bodyContent),
    });
  } catch (error) {
    return {
      success: false,
      provider: "smtp",
      error: exactEmailError(error),
    };
  }
}

module.exports = {
  getMissingSmtpConfig,
  sendMail,
  sendTestEmail,
  sendInvitationEmail,
  sendWelcomeEmail,
  sendTicketCreatedEmail,
  sendTicketAssignedEmail,
  sendTicketStatusEmail,
  sendTicketResolvedEmail,
  sendTicketClosedEmail,
  sendTicketCancelledEmail,
  sendSlaBreachEmail,
  sendPasswordResetEmail,
};
