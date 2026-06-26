export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

if (import.meta.env.DEV) {
  console.info("[AstreaBlue] API_URL:", API_URL);
}
