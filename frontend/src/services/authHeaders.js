export const getAuthToken = () =>
  localStorage.getItem("token") || sessionStorage.getItem("token") || "";

export const authHeaders = (extra = {}) => ({
  ...extra,
  Authorization: `Bearer ${getAuthToken()}`,
});
