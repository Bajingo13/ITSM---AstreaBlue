function normalizeApiUrl(url) {
  const normalized = String(url || "").replace(/\/$/, "");

  if (!import.meta.env.DEV) return normalized;

  try {
    const parsed = new URL(normalized);
    if (parsed.hostname === "localhost") {
      parsed.hostname = "127.0.0.1";
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {
    return normalized;
  }

  return normalized;
}

export const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL || "http://localhost:5000");

if (import.meta.env.DEV) {
  console.info("[AstreaBlue] API_URL:", API_URL);
}
