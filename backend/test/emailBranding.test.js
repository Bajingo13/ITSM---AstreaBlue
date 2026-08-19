const test = require("node:test");
const assert = require("node:assert/strict");

const { generateEmailHtml, getEmailBrandName } = require("../src/services/emailTemplates");

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
    assert.doesNotMatch(html, /AstreaBlue/);
  });
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
