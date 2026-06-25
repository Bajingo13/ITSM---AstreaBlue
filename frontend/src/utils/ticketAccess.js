export function buildTicketQuery(user, extra = {}) {
  const params = new URLSearchParams();
  const roleName = user?.role_name || user?.role;

  if (user?.user_id) params.set("current_user_id", user.user_id);
  if (roleName) params.set("role_name", roleName);
  if (user?.branch_id) params.set("branch_id", user.branch_id);

  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  });

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function buildTicketPayload(user, payload = {}) {
  const roleName = user?.role_name || user?.role;

  return {
    ...payload,
    current_user_id: user?.user_id || null,
    role_name: roleName || null,
    current_branch_id: user?.branch_id || null,
  };
}
