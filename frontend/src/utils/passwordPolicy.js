export const STRONG_PASSWORD_MESSAGE =
  "Use at least 8 characters with at least one uppercase letter.";

export function isStrongPassword(password) {
  const value = String(password || "");
  return (
    value.length >= 8 &&
    /[A-Z]/.test(value)
  );
}
