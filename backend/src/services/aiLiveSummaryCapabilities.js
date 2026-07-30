function normalize(value) {
  return String(value || "").toLowerCase();
}

function asksForLiveSummary(message) {
  return /\b(how many|count|total|summary|breakdown|currently|right now|status)\b/.test(
    normalize(message)
  );
}

function assetDiscoveryMetric(message) {
  const text = normalize(message);
  if (/\bmismatched?\b/.test(text)) return ["mismatched", "mismatched"];
  if (/\bpending verification\b/.test(text)) return ["pending_verification", "pending verification"];
  if (/\bunmanaged\b/.test(text)) return ["unmanaged", "unmanaged"];
  if (/\bduplicates?\b/.test(text)) return ["duplicates", "duplicate"];
  if (/\boffline\b/.test(text)) return ["offline", "offline"];
  if (/\bunlinked\b/.test(text)) return ["unlinked", "unlinked"];
  if (/\blinked\b/.test(text)) return ["linked", "linked"];
  if (/\bmatched?\b/.test(text)) return ["matched", "matched"];
  return null;
}

const CAPABILITIES = [
  {
    key: "asset discovery",
    matches: (text) =>
      /\b(asset discovery|discovery inventory|discovered (?:assets?|devices?)|reconciliation|reconciled|mismatched?|unmanaged|pending verification|duplicates?)\b/
        .test(text),
    repositoryMethod: "getAuthorizedAssetDiscoverySummary",
    outcome: "live_asset_discovery_summary",
    notice: "Asset Discovery role, branch scope, and identity-verification logic were applied.",
    format: (data, message) => {
      const metric = assetDiscoveryMetric(message);
      if (metric) {
        const [key, label] = metric;
        const count = Number(data[key] || 0);
        return `You currently have ${count} ${label} discovery record${count === 1 ? "" : "s"} visible under your role and branch access.`;
      }
      return [
        `You have ${Number(data.total || 0)} Asset Discovery record${Number(data.total || 0) === 1 ? "" : "s"} visible under your access.`,
        `Verification: Matched: ${Number(data.matched || 0)}, Mismatched: ${Number(data.mismatched || 0)}, Pending Verification: ${Number(data.pending_verification || 0)}, Unmanaged: ${Number(data.unmanaged || 0)}, Duplicates: ${Number(data.duplicates || 0)}.`,
        `Operational status: Offline: ${Number(data.offline || 0)}. Asset linkage: Linked: ${Number(data.linked || 0)}, Unlinked: ${Number(data.unlinked || 0)}.`,
      ].join("\n");
    },
  },
  {
    key: "sla",
    matches: (text) => /\b(sla|service level|first response|resolution target)\b/.test(text),
    repositoryMethod: "getAuthorizedSlaSummary",
    outcome: "live_sla_summary",
    notice: "Existing ticket RBAC was applied to the SLA summary.",
    format: (data) => [
      `You have ${Number(data.total || 0)} SLA-tracked ticket${Number(data.total || 0) === 1 ? "" : "s"} visible under your access.`,
      `Active: ${Number(data.active || 0)}, Met: ${Number(data.met || 0)}, Breached: ${Number(data.breached || 0)}.`,
    ].join("\n"),
  },
  {
    key: "replacement",
    matches: (text) => /\b(replacement requests?|replacement management|repair requests?)\b/.test(text),
    repositoryMethod: "getAuthorizedReplacementSummary",
    outcome: "live_replacement_summary",
    notice: "Replacement Management role, ownership, and branch access rules were applied.",
    format: (data) => [
      `You have ${Number(data.total || 0)} replacement request${Number(data.total || 0) === 1 ? "" : "s"} visible under your access.`,
      `Active: ${Number(data.active || 0)}, Awaiting approval: ${Number(data.awaiting_approval || 0)}, Repair recommended: ${Number(data.repair_recommended || 0)}, In repair: ${Number(data.in_repair || 0)}, Repaired: ${Number(data.repaired || 0)}, Completed replacement: ${Number(data.completed || 0)}.`,
    ].join("\n"),
  },
  {
    key: "lifecycle",
    matches: (text) => /\b(employee lifecycle|onboarding|offboarding|lifecycle cases?)\b/.test(text),
    repositoryMethod: "getAuthorizedLifecycleSummary",
    outcome: "live_lifecycle_summary",
    notice: "Employee Lifecycle role and branch access rules were applied.",
    format: (data) => [
      `You have ${Number(data.total || 0)} employee lifecycle case${Number(data.total || 0) === 1 ? "" : "s"} visible under your access.`,
      `Active onboarding: ${Number(data.active_onboarding || 0)}, Active offboarding: ${Number(data.active_offboarding || 0)}, Ready for final review: ${Number(data.ready_for_verification || 0)}, Completed: ${Number(data.completed || 0)}.`,
    ].join("\n"),
  },
  {
    key: "cmdb",
    matches: (text) => /\b(configuration items?|cmdb|config items?)\b/.test(text),
    repositoryMethod: "getAuthorizedCmdbSummary",
    outcome: "live_cmdb_summary",
    notice: "Configuration Management role and branch access rules were applied.",
    format: (data) => [
      `You have ${Number(data.total || 0)} configuration item${Number(data.total || 0) === 1 ? "" : "s"} visible under your access.`,
      `Active: ${Number(data.active || 0)}, Production: ${Number(data.production || 0)}, Distinct CI types: ${Number(data.types || 0)}.`,
    ].join("\n"),
  },
  {
    key: "projects",
    matches: (text) => /\b(projects?|project forecasting|project portfolio)\b/.test(text),
    repositoryMethod: "getAuthorizedProjectSummary",
    outcome: "live_project_summary",
    notice: "Project Analytics role and branch access rules were applied.",
    format: (data) => [
      `You have ${Number(data.total || 0)} active project record${Number(data.total || 0) === 1 ? "" : "s"} visible under your access.`,
      `On track: ${Number(data.on_track || 0)}, At risk: ${Number(data.at_risk || 0)}, Delayed: ${Number(data.delayed || 0)}, Completed: ${Number(data.completed || 0)}.`,
    ].join("\n"),
  },
];

function findLiveSummaryCapability(message) {
  const text = normalize(message);
  if (!asksForLiveSummary(text)) return null;
  return CAPABILITIES.find((capability) => capability.matches(text)) || null;
}

function formatCapabilityResult(capability, data, message = "") {
  if (data?.authorized === false) {
    return `You do not have access to ${capability.key} live data under your current role or branch.`;
  }
  return capability.format(data || {}, message);
}

module.exports = {
  CAPABILITIES,
  assetDiscoveryMetric,
  findLiveSummaryCapability,
  formatCapabilityResult,
};
