import { API_URL } from "../config/api";
import { getAuthToken } from "./authHeaders";

const API_BASE = `${API_URL}/api/v1`;

function authHeaders(extra = {}) {
  const token = getAuthToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function handleResponse(res) {
  let payload;
  try {
    payload = await res.json();
  } catch {
    payload = {};
  }
  if (!res.ok) {
    throw new Error(payload?.message || payload?.error || `HTTP ${res.status}`);
  }
  return payload;
}

export const apiService = {
  /** GET /api/v1/requests?category=X&search=Y */
  async fetchRequests({ category = "All Services", search = "" } = {}) {
    const q = new URLSearchParams();
    if (category && category !== "All Services") q.set("category", category);
    if (search && search.trim()) q.set("search", search.trim());
    const qs = q.toString() ? `?${q.toString()}` : "";
    const res = await fetch(`${API_BASE}/requests${qs}`, {
      method: "GET",
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  /** GET /api/v1/requests/popular */
  async fetchPopularServices() {
    const res = await fetch(`${API_BASE}/requests/popular`, {
      method: "GET",
      headers: authHeaders(),
    });
    return handleResponse(res);
  },

  /** GET /api/v1/requests/:id */
  async fetchRequestById(id) {
    const res = await fetch(`${API_BASE}/requests/${id}`, {
      method: "GET",
      headers: authHeaders(),
    });
    return handleResponse(res);
  },
};

export default apiService;

