#!/usr/bin/env node
"use strict";

/**
 * SMTP smoke test for a deployment's email configuration.
 *
 *   node scripts/smtp-smoke-test.js                 # connect + authenticate only (no mail sent)
 *   node scripts/smtp-smoke-test.js you@example.com # also send one test email to that address
 *
 * Reads the same SMTP_* variables the app uses (from the environment / backend/.env).
 * Exit code 0 means the check passed, non-zero means it failed.
 */

const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const nodemailer = require("nodemailer");
const { getMissingSmtpConfig, sendTestEmail } = require("../src/services/emailService");

function mask(value) {
  const text = String(value || "").replace(/\s+/g, "");
  if (!text) return "(empty)";
  if (text.length <= 4) return "*".repeat(text.length);
  return `${text.slice(0, 2)}${"*".repeat(text.length - 4)}${text.slice(-2)}`;
}

async function main() {
  const recipient = process.argv[2] ? String(process.argv[2]).trim() : null;

  const missing = getMissingSmtpConfig();
  if (missing.length) {
    console.error(`FAIL: SMTP configuration incomplete. Missing: ${missing.join(", ")}.`);
    console.error("Set SMTP_HOST, SMTP_USER, and SMTP_PASS (a Gmail App Password) in backend/.env.");
    process.exit(2);
  }

  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number.parseInt(String(process.env.SMTP_PORT || "").trim(), 10) || 587;
  const secureStr = String(process.env.SMTP_SECURE || "").trim().toLowerCase();
  const secure = secureStr === "true" ? true : secureStr === "false" ? false : port === 465;

  console.log("SMTP configuration:");
  console.log(`  host   : ${host}`);
  console.log(`  port   : ${port}`);
  console.log(`  secure : ${secure}`);
  console.log(`  user   : ${process.env.SMTP_USER}`);
  console.log(`  pass   : ${mask(process.env.SMTP_PASS)}`);
  console.log(`  from   : ${process.env.SMTP_FROM_NAME || "(brand)"} <${process.env.SMTP_FROM_EMAIL || process.env.EMAIL_FROM || process.env.SMTP_USER}>`);
  console.log("");

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: port === 587,
    auth: {
      user: String(process.env.SMTP_USER).trim(),
      pass: String(process.env.SMTP_PASS).replace(/\s+/g, ""),
    },
    tls: { rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false" },
    family: 4,
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
  });

  console.log("Verifying SMTP connection and authentication (no message sent)...");
  try {
    await transporter.verify();
    console.log("OK: SMTP server accepted the connection and credentials.");
  } catch (error) {
    console.error(`FAIL: ${error.code || "ERROR"} - ${error.response || error.message}`);
    if (error.code === "EAUTH") {
      console.error("Gmail rejected the login. Use a Google App Password (16 characters), not the account password,");
      console.error("and make sure 2-Step Verification is enabled on itsm@astreablue.com.");
    }
    process.exit(1);
  } finally {
    transporter.close();
  }

  if (!recipient) {
    console.log("");
    console.log("Connection check passed. Re-run with a recipient address to send a real test email:");
    console.log("  node scripts/smtp-smoke-test.js you@example.com");
    return;
  }

  console.log("");
  console.log(`Sending a test email to ${recipient} ...`);
  const result = await sendTestEmail(recipient);
  if (result.success) {
    console.log(`OK: test email sent (messageId: ${result.messageId || "n/a"}). Check the inbox.`);
  } else {
    console.error(`FAIL: ${result.error}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error.message);
  process.exit(1);
});
