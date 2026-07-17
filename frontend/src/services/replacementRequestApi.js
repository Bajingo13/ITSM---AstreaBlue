import { API_URL } from "../config/api";
import { authHeaders, getAuthToken } from "./authHeaders";

const BASE = `${API_URL}/api/v1/replacement-requests`;

async function request(path = "", options = {}) {
  const sendsJson = options.body !== undefined && !(options.body instanceof FormData);
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(sendsJson ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
    cache: options.method && options.method !== "GET" ? options.cache : "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `Request failed (${response.status}).`);
  return body;
}

function query(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  });
  return search.toString() ? `?${search}` : "";
}

export const replacementRequestApi = {
  summary: () => request("/summary").then((body) => body.data),
  list: (params) => request(query(params)).then((body) => body.data || []),
  detail: (id) => request(`/${id}`).then((body) => body.data),
  currentAssets: (employeeId) => request(`/assets/current${query({ employee_id: employeeId })}`).then((body) => body.data || []),
  availableAssets: () => request("/assets/available").then((body) => body.data || []),
  create: (data) => request("", { method: "POST", body: JSON.stringify(data) }).then((body) => body.data),
  assess: (id, data) => request(`/${id}/assessment`, { method: "PATCH", body: JSON.stringify(data) }).then((body) => body.data),
  transition: (id, status, data = {}) => request(`/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, ...data }) }).then((body) => body.data),
  async upload(id, files) {
    const data = new FormData();
    [...files].forEach((file) => data.append("attachments", file));
    const token = getAuthToken();
    const response = await fetch(`${BASE}/${id}/attachments`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: data,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || "Upload failed.");
    return body.data || [];
  },
};
