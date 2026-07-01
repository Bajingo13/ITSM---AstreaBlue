import { API_URL } from "../config/api";
const AUTH_API_URL = `${API_URL}/api/auth`;

export async function loginUser(email, password) {
  let response;

  try {
    response = await fetch(`${AUTH_API_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new Error(`Unable to reach backend at ${API_URL}. Please confirm the API server is running.`);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Login failed");
  }

  return data;
}

export function saveUser(user, token, rememberMe) {
  const storage = rememberMe ? localStorage : sessionStorage;
  storage.setItem("user", JSON.stringify(user));
  if (token) storage.setItem("token", token);
}

function readSavedSession(storage) {
  const rawUser = storage.getItem("user");
  if (!rawUser) return null;

  try {
    const user = JSON.parse(rawUser);
    const token =
      storage.getItem("token") ||
      user?.token ||
      user?.accessToken ||
      "";

    if (!token || tokenIsExpired(token)) return null;
    return { user, token };
  } catch {
    return null;
  }
}

function tokenIsExpired(token) {
  try {
    if (typeof atob !== "function") return false;

    const payload = token.split(".")[1];
    if (!payload) return false;

    const paddedPayload = payload.padEnd(
      payload.length + ((4 - (payload.length % 4)) % 4),
      "="
    );
    const decoded = atob(paddedPayload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = JSON.parse(decoded)?.exp;

    return Number.isFinite(exp) && exp * 1000 <= Date.now();
  } catch {
    return false;
  }
}

export function getSavedUser() {
  return (
    readSavedSession(localStorage)?.user ||
    readSavedSession(sessionStorage)?.user ||
    null
  );
}

export function getAuthToken() {
  return (
    readSavedSession(localStorage)?.token ||
    readSavedSession(sessionStorage)?.token ||
    ""
  );
}

export function hasStaleSavedUser() {
  return Boolean(
    (localStorage.getItem("user") && !readSavedSession(localStorage)) ||
      (sessionStorage.getItem("user") && !readSavedSession(sessionStorage))
  );
}

export function logoutUser() {
  localStorage.removeItem("user");
  localStorage.removeItem("token");
  sessionStorage.removeItem("user");
  sessionStorage.removeItem("token");
}

export async function forgotPassword(email) {
  let response;
  try {
    response = await fetch(`${AUTH_API_URL}/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch {
    throw new Error(`Unable to reach backend at ${API_URL}.`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "Failed to process request");
  }
  return data;
}

export async function resetPassword(token, password) {
  let response;
  try {
    response = await fetch(`${AUTH_API_URL}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
  } catch {
    throw new Error(`Unable to reach backend at ${API_URL}.`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "Failed to reset password");
  }
  return data;
}
