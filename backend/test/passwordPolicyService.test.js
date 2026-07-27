const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PASSWORD_POLICY_MESSAGE,
  validateStrongPassword,
} = require("../src/services/passwordPolicyService");

test("strong password policy requires all five controls", () => {
  assert.equal(validateStrongPassword("Astrea#42").valid, true);
  assert.equal(validateStrongPassword("short1!").valid, false);
  assert.equal(validateStrongPassword("astreablue1!").valid, false);
  assert.equal(validateStrongPassword("ASTREABLUE1!").valid, false);
  assert.equal(validateStrongPassword("AstreaBlue!").valid, false);
  assert.equal(validateStrongPassword("AstreaBlue1").valid, false);
  assert.match(PASSWORD_POLICY_MESSAGE, /at least 8 characters/i);
});

test("password validation does not participate in legacy login matching", () => {
  assert.equal(validateStrongPassword("old").valid, false);
  assert.equal(
    PASSWORD_POLICY_MESSAGE,
    "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character."
  );
});
