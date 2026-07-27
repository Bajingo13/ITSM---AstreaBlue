const PASSWORD_POLICY_MESSAGE =
  "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.";

function validateStrongPassword(password) {
  const value = String(password || "");
  const valid =
    value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value);

  return {
    valid,
    message: valid ? null : PASSWORD_POLICY_MESSAGE,
  };
}

module.exports = {
  PASSWORD_POLICY_MESSAGE,
  validateStrongPassword,
};
