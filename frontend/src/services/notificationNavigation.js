function normalizeRole(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]/g, "");
}

function normalizeEntityType(notification) {
  return String(
    notification?.related_entity_type
      || notification?.metadata?.relatedEntityType
      || ""
  ).trim().toLowerCase().replace(/[\s-]/g, "_");
}

function safeInternalPath(value) {
  const path = String(value || "").trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) return null;
  return path;
}

function roleAllowsPath(path, role) {
  const normalizedRole = normalizeRole(role);
  if (path === "/replacement-requests" || path === "/knowledge-base") return true;
  if (path === "/employee/consent" || path === "/employee/my-tickets" || path === "/employee/dashboard") {
    return normalizedRole === "employee";
  }
  if (path === "/hr/lifecycle" || path === "/hr/create-ticket") return normalizedRole === "hr";
  if (path.startsWith("/technician/")) return normalizedRole === "technician";
  if (
    [
      "/assets",
      "/software-licenses",
      "/endpoint-management",
      "/screenshot-capture",
      "/usb-dlp-monitoring",
      "/consent-management",
      "/employee-lifecycle",
      "/tickets",
    ].some((allowed) => path === allowed || path.startsWith(`${allowed}?`))
  ) {
    return ["superadmin", "admin"].includes(normalizedRole);
  }
  return false;
}

function dashboardForRole(role) {
  switch (normalizeRole(role)) {
    case "superadmin":
      return "/superadmin/dashboard";
    case "admin":
      return "/admin/dashboard";
    case "hr":
      return "/hr/lifecycle";
    case "technician":
      return "/technician/dashboard";
    default:
      return "/employee/dashboard";
  }
}

function isManager(role) {
  return ["superadmin", "admin"].includes(normalizeRole(role));
}

function lifecyclePath(role) {
  return normalizeRole(role) === "hr" ? "/hr/lifecycle" : "/employee-lifecycle";
}

function consentPath(role) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "employee") return "/employee/consent";
  if (["superadmin", "admin"].includes(normalizedRole)) return "/consent-management";
  return dashboardForRole(role);
}

function ticketFallbackPath(role) {
  switch (normalizeRole(role)) {
    case "employee":
      return "/employee/my-tickets";
    case "technician":
      return "/technician/my-assigned-tickets";
    case "hr":
      return "/hr/create-ticket";
    default:
      return "/tickets";
  }
}

function destination(path, label) {
  return { path, label };
}

export function resolveNotificationDestination(notification, role) {
  const normalizedRole = normalizeRole(role);
  const metadata = notification?.metadata && typeof notification.metadata === "object"
    ? notification.metadata
    : {};
  const ticketId = notification?.related_ticket_id || metadata.ticketId;
  if (ticketId) return destination(`/ticket/${encodeURIComponent(ticketId)}`, "View ticket");

  const explicitPath = safeInternalPath(metadata.path);
  if (explicitPath && roleAllowsPath(explicitPath, role)) {
    return destination(explicitPath, "Open update");
  }

  const entityType = normalizeEntityType(notification);
  const entityId = notification?.related_entity_id
    || metadata.relatedEntityId
    || metadata.deviceUuid
    || null;

  if (entityType === "software_license" && isManager(role)) {
    return destination("/software-licenses", "View licenses");
  }
  if (entityType === "endpoint_policy" && isManager(role)) {
    const deviceUuid = metadata.deviceUuid || entityId;
    const query = deviceUuid ? `?tab=devices&device_uuid=${encodeURIComponent(deviceUuid)}` : "";
    return destination(`/endpoint-management${query}`, "View endpoint");
  }
  if (["endpoint", "endpoint_device", "device"].includes(entityType) && isManager(role)) {
    const query = entityId ? `?tab=devices&deviceId=${encodeURIComponent(entityId)}` : "";
    return destination(`/endpoint-management${query}`, "View endpoint");
  }
  if (["consent", "privacy_consent"].includes(entityType)) {
    return destination(consentPath(role), "View consent");
  }
  if (entityType === "replacement_request") {
    return destination("/replacement-requests", "View request");
  }
  if (["employee_lifecycle_case", "lifecycle_case"].includes(entityType)) {
    if (["superadmin", "admin", "hr"].includes(normalizedRole)) {
      return destination(lifecyclePath(role), "View lifecycle");
    }
    return destination(dashboardForRole(role), "View update");
  }
  if (["screenshot", "endpoint_screenshot"].includes(entityType) && isManager(role)) {
    return destination("/screenshot-capture", "View screenshots");
  }
  if (["usb", "usb_dlp", "dlp_event"].includes(entityType) && isManager(role)) {
    return destination("/usb-dlp-monitoring", "View USB & DLP");
  }
  if (["hardware_asset", "asset"].includes(entityType) && isManager(role)) {
    return destination("/assets", "View assets");
  }
  if (["knowledge_article", "knowledge_base"].includes(entityType)) {
    return destination("/knowledge-base", "View article");
  }

  const searchable = `${notification?.title || ""} ${notification?.type || ""} ${metadata.event || ""}`.toLowerCase();
  if (searchable.includes("software license") && isManager(role)) {
    return destination("/software-licenses", "View licenses");
  }
  if ((searchable.includes("endpoint") || searchable.includes("policy")) && isManager(role)) {
    const deviceUuid = metadata.deviceUuid;
    const query = deviceUuid ? `?tab=devices&device_uuid=${encodeURIComponent(deviceUuid)}` : "";
    return destination(`/endpoint-management${query}`, "View endpoint");
  }
  if (searchable.includes("consent") || searchable.includes("privacy")) {
    return destination(consentPath(role), "View consent");
  }
  if (searchable.includes("replacement")) {
    return destination("/replacement-requests", "View request");
  }
  if (searchable.includes("onboarding") || searchable.includes("offboarding") || searchable.includes("lifecycle")) {
    if (["superadmin", "admin", "hr"].includes(normalizedRole)) {
      return destination(lifecyclePath(role), "View lifecycle");
    }
    return destination(dashboardForRole(role), "View update");
  }
  if (searchable.includes("screenshot") && isManager(role)) {
    return destination("/screenshot-capture", "View screenshots");
  }
  if ((searchable.includes("usb") || searchable.includes("dlp")) && isManager(role)) {
    return destination("/usb-dlp-monitoring", "View USB & DLP");
  }
  if (searchable.includes("asset") && isManager(role)) {
    return destination("/assets", "View assets");
  }
  if (searchable.includes("knowledge") || searchable.includes("article")) {
    return destination("/knowledge-base", "View article");
  }
  if (searchable.includes("ticket") || searchable.includes("sla")) {
    return destination(ticketFallbackPath(role), "View tickets");
  }

  return destination(dashboardForRole(role), "View workspace");
}
