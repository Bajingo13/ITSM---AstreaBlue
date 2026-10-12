const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");

const { EMAIL_LOGO_CID, EMAIL_LOGO_PATH, generateEmailHtml, getEmailBrandName } = require("../src/services/emailTemplates");

function withBrandEnvironment(values, callback) {
  const previous = {
    COMPANY_NAME: process.env.COMPANY_NAME,
    EMAIL_BRAND_NAME: process.env.EMAIL_BRAND_NAME,
  };
  Object.assign(process.env, values);
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("AOC email branding is derived from its deployment company", () => {
  withBrandEnvironment({ COMPANY_NAME: "AOC", EMAIL_BRAND_NAME: "" }, () => {
    assert.equal(getEmailBrandName(), "AOC ITSM");
    const html = generateEmailHtml("Account activated", "<p>Ready</p>");
    assert.match(html, /<h1>AOC ITSM<\/h1>/);
    assert.match(html, /<strong>AOC ITSM System<\/strong>/);
    // Only the product logo carries the AstreaBlue name; all text is AOC's.
    assert.doesNotMatch(html.replace(/<img [^>]*>/g, ""), /AstreaBlue/);
  });
});

test("every deployment's emails embed the AstreaBlue logo inline", () => {
  withBrandEnvironment({ COMPANY_NAME: "AOC", EMAIL_BRAND_NAME: "AOC ITSM" }, () => {
    const html = generateEmailHtml("Email Test", "<p>Hi</p>");
    assert.match(html, new RegExp(`<img src="cid:${EMAIL_LOGO_CID}" alt="AstreaBlue"`));
  });
  assert.ok(fs.existsSync(EMAIL_LOGO_PATH), "email logo asset must ship with the backend");
});

test("Main can explicitly retain AstreaBlue email branding", () => {
  withBrandEnvironment({ COMPANY_NAME: "AstreaBlue Enterprise ITSM", EMAIL_BRAND_NAME: "AstreaBlue ITSM" }, () => {
    assert.equal(getEmailBrandName(), "AstreaBlue ITSM");
  });
});

test("configured email branding is escaped in the shared template", () => {
  withBrandEnvironment({ COMPANY_NAME: "<AOC>", EMAIL_BRAND_NAME: "" }, () => {
    const html = generateEmailHtml("<Account>", "<p>Safe body</p>");
    assert.match(html, /&lt;AOC&gt; ITSM/);
    assert.match(html, /<title>&lt;Account&gt;<\/title>/);
  });
});

test("sendMail attaches the inline logo once and keeps existing attachments", async () => {
  const nodemailer = require("nodemailer");
  const sent = [];
  const originalCreateTransport = nodemailer.createTransport;
  const previous = { SMTP_HOST: process.env.SMTP_HOST, SMTP_USER: process.env.SMTP_USER, SMTP_PASS: process.env.SMTP_PASS };
  nodemailer.createTransport = () => ({ sendMail: async (message) => { sent.push(message); return { messageId: "test" }; } });
  Object.assign(process.env, { SMTP_HOST: "smtp.logo-test.invalid", SMTP_USER: "logo-test@example.com", SMTP_PASS: "unused" });
  try {
    const { sendMail } = require("../src/services/emailService");
    await sendMail({
      to: "someone@example.com",
      html: generateEmailHtml("Test", "<p>Hi</p>"),
      attachments: [{ filename: "Consent-Summary.pdf", content: Buffer.from("pdf") }],
    });
    await sendMail({ to: "someone@example.com", html: "<p>No template</p>" });
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const logos = sent[0].attachments.filter((attachment) => attachment.cid === EMAIL_LOGO_CID);
  assert.equal(logos.length, 1);
  assert.equal(logos[0].path, EMAIL_LOGO_PATH);
  assert.ok(sent[0].attachments.some((attachment) => attachment.filename === "Consent-Summary.pdf"));
  assert.equal(sent[1].attachments, undefined);
});
