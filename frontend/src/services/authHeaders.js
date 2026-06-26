import { getAuthToken } from "../context/AuthService";

export { getAuthToken };

export const authHeaders = (extra = {}) => {
  const token = getAuthToken();

  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};
