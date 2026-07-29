const MODULES = [
  {
    key: "service_desk",
    aliases: ["service desk", "incident management", "service request", "ticketing"],
    purpose: "Records, prioritizes, assigns, tracks, resolves, and audits incidents and service requests.",
    flow: "A requester files a ticket, authorized staff triage it, a permitted technician accepts or is assigned, work is recorded, SLA results are calculated, and the ticket is resolved or closed.",
  },
  {
    key: "knowledge_base",
    aliases: ["knowledge base", "kb article", "kb"],
    purpose: "Stores reusable troubleshooting and service guidance visible under the reader's role and branch.",
    flow: "Authorized staff create and publish guidance; users and the assistant search only articles they are permitted to read.",
  },
  {
    key: "ticket_calendar",
    aliases: ["ticket calendar", "schedule calendar", "ticket schedule"],
    purpose: "Displays ticket dates and scheduled work in a calendar view.",
    flow: "Authorized ticket records are converted into calendar events and remain restricted by ticket RBAC.",
  },
  {
    key: "sla",
    aliases: ["sla", "service level agreement", "first response", "resolution target"],
    purpose: "Measures first-response and resolution performance against configured priority targets.",
    flow: "A ticket receives SLA deadlines, response and completion events are recorded, and each target becomes Pending, Met, Breached, or Cancelled.",
  },
  {
    key: "hardware_assets",
    aliases: ["hardware asset", "asset management", "hardware inventory"],
    purpose: "Tracks company hardware, ownership, assignment, condition, lifecycle status, and financial details.",
    flow: "An asset is registered, assigned, verified against endpoint inventory when applicable, maintained or repaired, then redeployed, retired, or disposed.",
  },
  {
    key: "software_licenses",
    aliases: ["software license", "software licence", "subscription", "license management"],
    purpose: "Tracks purchased seats, used seats, available seats, expiry dates, renewal history, branches, and annual costs.",
    flow: "A license subscription is registered, usage is updated, availability is calculated as total seats minus used seats, reminders identify upcoming expiry, and renewals preserve history.",
  },
  {
    key: "asset_discovery",
    aliases: ["asset discovery", "discovery inventory", "reconciliation"],
    purpose: "Compares agent-detected devices with managed hardware records.",
    flow: "An observation is received, linked to an asset, identity fields are compared, and the result becomes Matched, Mismatched, Pending Verification, or Unmanaged.",
  },
  {
    key: "asset_finance",
    aliases: ["depreciation", "asset finance", "financial analysis"],
    purpose: "Calculates asset value, depreciation, lifecycle cost, and replacement forecasting.",
    flow: "Purchase and lifecycle data feed financial calculations and reporting without changing operational assignment.",
  },
  {
    key: "cmdb",
    aliases: ["configuration item", "configuration management", "cmdb"],
    purpose: "Stores services, applications, databases, servers, devices, and other configuration items.",
    flow: "Configuration items are registered, categorized, related through dependencies, and analyzed before operational changes.",
  },
  {
    key: "dependency_map",
    aliases: ["dependency map", "dependency mapping", "ci dependency"],
    purpose: "Shows how configuration items depend on, connect to, use, host, run on, contain, or link to one another.",
    flow: "Relationships connect source and target CIs; upstream and downstream traversal reveals potentially affected components.",
  },
  {
    key: "change_impact",
    aliases: ["change impact", "impact analysis"],
    purpose: "Estimates the operational reach and risk of changing a configuration item.",
    flow: "The selected CI and its dependency graph determine affected items, branches, applications, impact score, risk label, and recommended action.",
  },
  {
    key: "replacement",
    aliases: ["replacement request", "replacement management", "repair request"],
    purpose: "Controls assessment, repair, replacement, verification, and asset-status transitions for damaged equipment.",
    flow: "An employee submits a request, an authorized reviewer assesses it, the asset enters repair or replacement, completion is verified, and the asset returns to its appropriate lifecycle state.",
  },
  {
    key: "reporting",
    aliases: ["executive dashboard", "operational analytics", "reporting analytics", "custom report", "project forecasting"],
    purpose: "Provides authorized operational, SLA, asset, endpoint, governance, project, and custom reporting.",
    flow: "Read-only summaries aggregate permitted records and apply the selected period, branch, and report filters.",
  },
  {
    key: "endpoint_monitoring",
    aliases: ["endpoint monitoring", "endpoint management", "device monitoring", "windows agent"],
    purpose: "Manages enrolled Windows agents, heartbeats, policy synchronization, inventory, activity, screenshots, and USB/DLP telemetry.",
    flow: "A device enrolls once, receives unique credentials, downloads its consent-aware policy, reports authorized telemetry, and is marked online or offline from heartbeat freshness.",
  },
  {
    key: "consent",
    aliases: ["consent", "ra 10173", "privacy record", "monitoring consent"],
    purpose: "Records and enforces employee authorization for privacy-sensitive endpoint monitoring.",
    flow: "The employee reviews and signs, an authorized reviewer approves it, an effective device policy is generated, and the agent enables only approved categories.",
  },
  {
    key: "employee_lifecycle",
    aliases: ["employee lifecycle", "onboarding", "offboarding"],
    purpose: "Coordinates account, access, asset, license, data-handover, verification, and ticket tasks for joining and departing employees.",
    flow: "A lifecycle case creates its linked internal ticket and checklist; required evidence and automated checks must complete before final review and closure.",
  },
  {
    key: "integrations",
    aliases: ["integration hub", "external ticket", "centralized ticketing", "api integration"],
    purpose: "Allows registered external systems to create centrally tracked AstreaBlue tickets through scoped API credentials.",
    flow: "A SuperAdmin registers a system and key; its backend posts an authenticated ticket request; AstreaBlue validates, logs, labels, stores, and exposes the ticket under internal RBAC.",
  },
  {
    key: "administration",
    aliases: ["system administration", "user management", "branch management", "role management"],
    purpose: "Controls users, roles, branches, invitations, integration credentials, and platform configuration.",
    flow: "Authorized administrators maintain scoped configuration while SuperAdmin retains system-wide control.",
  },
];

function normalize(value) {
  return String(value || "").toLowerCase();
}

function findModuleKnowledge(message) {
  const text = normalize(message);
  const asksForExplanation =
    /\b(what is|what does|purpose|explain|how does|how do|workflow|flow|works?)\b/.test(text);
  if (!asksForExplanation) return null;

  return MODULES.find((module) =>
    module.aliases.some((alias) => text.includes(alias))
  ) || null;
}

function formatModuleKnowledge(module) {
  return [
    module.purpose,
    `Workflow: ${module.flow}`,
  ].join("\n");
}

module.exports = {
  MODULES,
  findModuleKnowledge,
  formatModuleKnowledge,
};
