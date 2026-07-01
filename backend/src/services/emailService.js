const nodemailer = require("nodemailer");
const { Resend } = require("resend");

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
  const secureStr = cleanEnv(process.env.SMTP_SECURE).toLowerCase();
  const secure = secureStr === "true" ? true : (secureStr === "false" ? false : port === 465);

  return {
    host: cleanEnv(process.env.SMTP_HOST),
    port,
    secure,
    requireTLS: port === 587,
    auth,
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  };
}

function getTransporter() {
  return nodemailer.createTransport(smtpConfig());
}

function emailProvider() {
  return cleanEnv(process.env.EMAIL_PROVIDER).toLowerCase() === "resend" &&
    cleanEnv(process.env.RESEND_API_KEY)
    ? "resend"
    : "smtp";
}

async function sendSmtpMail(message) {
  const config = smtpConfig();
  const transporter = getTransporter();
  await transporter.verify();
  const info = await transporter.sendMail(message);
  return {
    success: true,
    provider: "smtp",
    host: config.host,
    port: config.port,
    messageId: info.messageId || null,
  };
}

async function sendResendMail(message) {
  const apiKey = cleanEnv(process.env.RESEND_API_KEY);
  if (!apiKey) throw new Error("Resend configuration is incomplete: RESEND_API_KEY is missing.");

  const { data, error } = await new Resend(apiKey).emails.send(message);
  if (error) {
    const sendError = new Error(error.message || "Resend email delivery failed.");
    sendError.code = error.name || "RESEND_ERROR";
    throw sendError;
  }

  return { success: true, provider: "resend", messageId: data?.id || null };
}

async function sendMail(message) {
  const provider = emailProvider();
  const startedAt = Date.now();
  const config = provider === "smtp" ? smtpConfig() : null;
  const diagnostics = {
    provider,
    host: config?.host || "api.resend.com",
    port: config?.port || 443,
    secure: config?.secure ?? true,
    sender: message.from,
    receiver: message.to,
  };

  console.info("Email delivery started", diagnostics);
  try {
    const result = provider === "resend"
      ? await sendResendMail(message)
      : await sendSmtpMail(message);
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
  return [error?.code, error?.command, error?.response, error?.message]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(": ") || "Unknown email provider error.";
}

function getMissingSmtpConfig() {
  if (emailProvider() === "resend") {
    return ["RESEND_API_KEY", "EMAIL_FROM or SMTP_FROM_EMAIL"].filter((key) => {
      if (key === "EMAIL_FROM or SMTP_FROM_EMAIL") {
        return !cleanEnv(process.env.EMAIL_FROM) && !cleanEnv(process.env.SMTP_FROM_EMAIL);
      }
      return !cleanEnv(process.env.RESEND_API_KEY);
    });
  }

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
    return await sendMail({
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
  } catch (error) {
    return {
      success: false,
      provider: emailProvider(),
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
    const provider = emailProvider();
    const providerName = provider === "smtp" ? "SMTP" : "Resend";

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

    const htmlContent = `
      <div style="font-family: 'Inter', Roboto, Arial, sans-serif; color: #0F172A; line-height: 1.6; background-color: #E0F2FE; padding: 40px 20px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);">
          <div style="background: linear-gradient(135deg, #2563EB 0%, #38BDF8 100%); padding: 32px 24px; text-align: center;">
            <h1 style="color: #FFFFFF; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">AstreaBlue ITSM</h1>
          </div>
          <div style="padding: 40px 32px;">
            <p style="font-size: 16px; margin-top: 0;">Hello,</p>
            <p style="font-size: 16px;">This is a test email from <strong>AstreaBlue ITSM</strong>.</p>
            <p style="font-size: 16px;">Your email provider is configured correctly.</p>
            <p style="font-size: 16px;">If you received this email, production email delivery is working successfully.</p>
            
            <div style="background-color: #F8FAFC; border-left: 4px solid #38BDF8; padding: 20px; margin: 32px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0 0 12px 0; font-size: 15px;"><strong>Provider:</strong> ${providerName}</p>
              <p style="margin: 0 0 4px 0; font-size: 15px;"><strong>Time:</strong></p>
              <p style="margin: 0; font-size: 15px; color: #475569;">${timestamp}</p>
            </div>
            
            <p style="font-size: 16px; margin-bottom: 0;">Regards,<br><strong style="color: #2563EB;">AstreaBlue ITSM</strong></p>
          </div>
          <div style="background-color: #F1F5F9; padding: 20px 32px; text-align: center; border-top: 1px solid #E2E8F0;">
            <p style="margin: 0; color: #64748B; font-size: 13px;">This is an automated system message. Please do not reply.</p>
          </div>
        </div>
      </div>
    `;

    return await sendMail({
      from: fromAddress(),
      to,
      subject: "AstreaBlue ITSM - Email Test",
      text: textContent,
      html: htmlContent,
    });
  } catch (error) {
    const provider = emailProvider();
    const config = provider === "smtp" ? smtpConfig() : null;
    return {
      success: false,
      provider,
      ...(config ? { host: config.host, port: config.port } : {}),
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
  sendTestEmail,
  sendInvitationEmail,
  sendWelcomeEmail,
  sendTicketCreatedEmail,
  sendTicketAssignedEmail,
  sendTicketStatusEmail,
  sendTicketResolvedEmail,
  sendTicketClosedEmail,
  sendTicketCancelledEmail,
};
