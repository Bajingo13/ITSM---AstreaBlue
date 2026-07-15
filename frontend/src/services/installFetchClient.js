import { getAuthToken } from "../context/AuthService";

const inFlightGets = new Map();

function redactApiData(value) {
  if (Array.isArray(value)) return value.map(redactApiData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /token|password|secret|jwt/i.test(key) ? "[REDACTED]" : redactApiData(item),
    ])
  );
}

function resourceUrl(resource) {
  return typeof resource === "string" ? resource : resource?.url || String(resource || "");
}

function withSafeJson(response) {
  const readText = response.text.bind(response);
  response.json = async () => {
    const body = await readText();
    if (!body || response.status === 204) return {};
    try {
      return JSON.parse(body);
    } catch {
      return { message: body };
    }
  };
  return response;
}

export function installFetchClient() {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (resource, options = {}) => {
    const url = resourceUrl(resource);
    const method = String(options.method || resource?.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || resource?.headers || {});
    const token = getAuthToken();

    if (url.includes("/api/v1") && token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const config = { ...options, headers };
    const requestKey = method === "GET" ? `${url}|${headers.get("Authorization") || "anonymous"}` : null;
    let request = requestKey ? inFlightGets.get(requestKey) : null;

    if (!request) {
      request = originalFetch(resource, config);
      if (requestKey) inFlightGets.set(requestKey, request);
    }

    try {
      // Every caller receives its own body stream, including callers sharing an
      // in-flight GET request.
      const response = (await request).clone();

      if (import.meta.env.DEV && url.includes("/api/")) {
        const body = await response.clone().text();
        let responseBody = {};
        if (body) {
          try {
            responseBody = JSON.parse(body);
          } catch {
            responseBody = { message: body };
          }
        }
        const apiLog = {
          url,
          method,
          status: response.status,
          response: redactApiData(responseBody),
        };
        if (response.ok) console.debug("[API]", apiLog);
        else console.error("[API]", apiLog);
      }

      return withSafeJson(response);
    } finally {
      if (requestKey && inFlightGets.get(requestKey) === request) {
        inFlightGets.delete(requestKey);
      }
    }
  };
}
