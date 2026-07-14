import { API_URL } from "../config/api";
import { authHeaders, getAuthToken } from "./authHeaders";

export const CHANGE_RELEASE_API = `${API_URL}/api/v1/change-release`;
async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${CHANGE_RELEASE_API}${path}`, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) },
    });
  } catch (networkError) {
    if (networkError?.name === "TypeError" && networkError?.message?.includes("fetch")) {
      throw new Error("Unable to connect to the server. Please verify that the backend service is running.");
    }
    throw networkError;
  }
  let body;
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  if (!response.ok) throw new Error(body.message || `Request failed (${response.status}).`);
  return body;
}

export const changeReleaseApi = {
  get: (path) => request(path),
  post: (path, data) => request(path, { method: "POST", body: JSON.stringify(data) }),
  patch: (path, data) => request(path, { method: "PATCH", body: JSON.stringify(data) }),
  put: (path, data) => request(path, { method: "PUT", body: JSON.stringify(data) }),
  del: (path) => request(path, { method: "DELETE" }),

  async upload(path, files) {
    const data = new FormData();
    [...files].forEach((file) => data.append("attachments", file));
    const token = getAuthToken();
    let response;
    try {
      response = await fetch(`${CHANGE_RELEASE_API}${path}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: data,
      });
    } catch (networkError) {
      if (networkError.name === "TypeError" && networkError.message?.includes("fetch")) {
        throw new Error("Unable to connect to the server. Please verify that the backend service is running.");
      }
      throw networkError;
    }
    let body;
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    if (!response.ok) throw new Error(body.message || "Upload failed.");
    return body;
  },

  // --- Summary ---
  getSummary: () => request("/summary").then((r) => r.data),

  // --- Change requests ---
  listChanges: (params = {}) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") p.set(k, v); });
    return request(`/changes?${p}`);
  },

  getChange: (id) => request(`/changes/${id}`).then((r) => r.data),

  createChange: (data) => request("/changes", { method: "POST", body: JSON.stringify(data) }).then((r) => r.data),

  updateChange: (id, data) => request(`/changes/${id}`, { method: "PUT", body: JSON.stringify(data) }).then((r) => r.data),

  // --- Workflow ---
  getActions: (id) => request(`/changes/${id}/actions`).then((r) => (r.data && r.data.actions) || []),

  transitionStatus: (id, status, payload = {}) =>
    request(`/changes/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, ...payload }) }).then((r) => r.data),

  // --- Approvals (legacy) ---
  addApproval: (id, decision, comments) =>
    request(`/changes/${id}/approvals`, { method: "POST", body: JSON.stringify({ decision, comments }) }).then((r) => r.data),

  // --- CAB members ---
  getCabMembers: (id) => request(`/changes/${id}/cab-members`).then((r) => r.data || []),
  addCabMember: (id, userId, role = "Member") =>
    request(`/changes/${id}/cab-members`, { method: "POST", body: JSON.stringify({ user_id: userId, role }) }).then((r) => r.data),
  removeCabMember: (id, memberId) => request(`/changes/${id}/cab-members/${memberId}`, { method: "DELETE" }),

  // --- CAB review ---
  getCabReview: (id) => request(`/changes/${id}/cab-review`).then((r) => r.data),
  submitCabReview: (id, data) =>
    request(`/changes/${id}/cab-review`, { method: "POST", body: JSON.stringify(data) }).then((r) => r.data),

  // --- Implementation ---
  getImplementationUpdates: (id) => request(`/changes/${id}/implementation`).then((r) => r.data || []),
  addImplementationUpdate: (id, data) =>
    request(`/changes/${id}/implementation`, { method: "POST", body: JSON.stringify(data) }).then((r) => r.data),

  // --- Schedule ---
  getScheduleHistory: (id) => request(`/changes/${id}/schedule`).then((r) => r.data || []),
  updateSchedule: (id, data) =>
    request(`/changes/${id}/schedule`, { method: "POST", body: JSON.stringify(data) }).then((r) => r.data),

  // --- Comments ---
  addComment: (id, message) =>
    request(`/changes/${id}/comments`, { method: "POST", body: JSON.stringify({ message }) }).then((r) => r.data),

  // --- Attachments ---
  uploadAttachments: (id, files) => changeReleaseApi.upload(`/changes/${id}/attachments`, files),

  // --- Audit ---
  getAuditLog: (id) => request(`/changes/${id}/audit`).then((r) => r.data || []),
};
