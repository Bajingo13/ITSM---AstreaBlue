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

async function sendTicketCreatedEmail() {
  throw new Error("Ticket email notifications are not implemented yet.");
}

async function sendTicketAssignedEmail() {
  throw new Error("Ticket email notifications are not implemented yet.");
}

async function sendTicketStatusEmail() {
  throw new Error("Ticket email notifications are not implemented yet.");
}

module.exports = {
  getMissingSmtpConfig,
  sendInvitationEmail,
  sendWelcomeEmail,
  sendTicketCreatedEmail,
  sendTicketAssignedEmail,
  sendTicketStatusEmail,
};
