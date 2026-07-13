import { API_URL } from "../config/api";
import { authHeaders, getAuthToken } from "./authHeaders";

export const CHANGE_RELEASE_API = `${API_URL}/api/v1/change-release`;

async function request(path, options = {}) {
  const response = await fetch(`${CHANGE_RELEASE_API}${path}`, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || "Request failed.");
  return body;
}

export const changeReleaseApi = {
  get: (path) => request(path),
  post: (path, data) => request(path, { method: "POST", body: JSON.stringify(data) }),
  patch: (path, data) => request(path, { method: "PATCH", body: JSON.stringify(data) }),
  async upload(path, files) {
    const data = new FormData();
    [...files].forEach((file) => data.append("attachments", file));
    const token = getAuthToken();
    const response = await fetch(`${CHANGE_RELEASE_API}${path}`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: data });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || "Upload failed.");
    return body;
  },
};
