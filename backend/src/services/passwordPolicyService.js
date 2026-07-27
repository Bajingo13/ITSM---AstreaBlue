const PASSWORD_POLICY_MESSAGE =
  "Password must be at least 8 characters and include at least one uppercase letter.";

function validateStrongPassword(password) {
  const value = String(password || "");
  const valid =
    value.length >= 8 &&
    /[A-Z]/.test(value);

  return {
    valid,
    message: valid ? null : PASSWORD_POLICY_MESSAGE,
  };
}

module.exports = {
  PASSWORD_POLICY_MESSAGE,
  validateStrongPassword,
};
