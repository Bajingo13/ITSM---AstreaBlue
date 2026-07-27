export const STRONG_PASSWORD_MESSAGE =
  "Use at least 8 characters with uppercase, lowercase, number, and special character.";

export function isStrongPassword(password) {
  const value = String(password || "");
  return (
    value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}
