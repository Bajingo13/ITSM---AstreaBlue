const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PASSWORD_POLICY_MESSAGE,
  validateStrongPassword,
} = require("../src/services/passwordPolicyService");

test("strong password policy requires eight characters and an uppercase letter", () => {
  assert.equal(validateStrongPassword("AstreaBlue").valid, true);
  assert.equal(validateStrongPassword("PASSWORD").valid, true);
  assert.equal(validateStrongPassword("Password").valid, true);
  assert.equal(validateStrongPassword("ShortA").valid, false);
  assert.equal(validateStrongPassword("password").valid, false);
  assert.match(PASSWORD_POLICY_MESSAGE, /at least 8 characters/i);
  assert.match(PASSWORD_POLICY_MESSAGE, /uppercase letter/i);
});

test("password validation does not participate in legacy login matching", () => {
  assert.equal(validateStrongPassword("old").valid, false);
  assert.equal(
    PASSWORD_POLICY_MESSAGE,
    "Password must be at least 8 characters and include at least one uppercase letter."
  );
});
