function normalize(value) {
  return String(value || "").toLowerCase();
}

function asksForLiveSummary(message) {
  return /\b(how many|count|total|summary|breakdown|currently|right now|status|value|cost|depreciat(?:ion|ed|ing)?|warrant(?:y|ies)|end of life)\b/.test(
    normalize(message)
  );
}

function assetFinanceMetric(message) {
  const text = normalize(message);
  if (/\b(current )?book value\b|\bcurrent value\b/.test(text)) {
    return ["current_book_value", "currency", "current book value"];
  }
  if (/\baccumulated depreciation\b/.test(text)) {
    return ["accumulated_depreciation", "currency", "accumulated depreciation"];
  }
  if (/\bmonthly depreciation\b/.test(text)) {
    return ["monthly_depreciation_expense", "currency", "monthly depreciation expense"];
  }
  if (/\b(purchase|acquisition|original)\s+(cost|value)\b|\btotal asset value\b/.test(text)) {
    return ["total_asset_value", "currency", "capitalized purchase value"];
  }
  if (/\bfully depreciated\b/.test(text)) {
    return ["fully_depreciated_assets", "count", "fully depreciated asset"];
  }
  if (/\bnear(?:ing)? end of life\b|\bnear eol\b/.test(text)) {
    return ["assets_near_end_of_life", "count", "asset near or at end of life"];
  }
  if (/\bend of life\b|\beol\b/.test(text)) {
    return ["end_of_life_assets", "count", "end-of-life asset"];
  }
  if (/\bexpired warrant(?:y|ies)\b|\bwarrant(?:y|ies).*(?:expired|overdue)\b/.test(text)) {
    return ["warranties_expired", "count", "asset with an expired warranty"];
  }
  if (/\bwarrant(?:y|ies).*(?:expir|soon|next 30 days)\b|\bexpiring warrant(?:y|ies)\b/.test(text)) {
    return ["warranties_expiring_30_days", "count", "asset with a warranty expiring in the next 30 days"];
  }
  if (/\bmissing\b.*\b(financial|purchase|finance)\b|\bincomplete financial\b/.test(text)) {
    return ["missing_financial_information", "count", "asset with missing financial information"];
  }
  if (/\bexpense items?\b/.test(text)) {
    return ["expense_items", "count", "expense item"];
  }
  if (/\bdepreciable assets?\b/.test(text)) {
    return ["depreciable_assets", "count", "depreciable asset"];
  }
  if (/\bhow many\b|\bcount\b|\bnumber of\b/.test(text)) {
    return ["total_assets", "count", "asset financial record"];
  }
  return null;
}

function assetFinanceFilters(message) {
  const text = normalize(message);
  let assetType = null;
  if (/\blaptops?\b/.test(text)) assetType = "Laptop";
  else if (/\bdesktops?\b/.test(text)) assetType = "Desktop";
  else if (/\bcomputers?\b/.test(text)) assetType = "Computer";

  const statuses = [
    ["In Repair", /\b(?:in|under) repair\b/],
    ["In Use", /\bin use\b/],
    ["Available", /\bavailable\b/],
    ["Borrowed", /\bborrowed\b/],
    ["Retired", /\bretired\b/],
    ["Disposed", /\bdisposed\b/],
  ];
  const status = statuses.find(([, pattern]) => pattern.test(text))?.[0] || null;
  return { assetType, status };
}

function formatCurrency(value) {
  return `PHP ${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function financeScopeLabel(data) {
  const parts = [];
  if (data.filters?.asset_type) parts.push(data.filters.asset_type);
  if (data.filters?.status) parts.push(data.filters.status);
  return parts.length ? ` for ${parts.join(", ")}` : "";
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
    key: "asset finance",
    matches: (text) =>
      /\b(asset finance|asset financials?|financial tracking|depreciat(?:ion|ed|ing)?|book value|purchase cost|asset value|capitalized|expense items?|end of life|eol|warrant(?:y|ies))\b/
        .test(text)
      && !/\bsoftware licen[cs]es?\b/.test(text),
    repositoryMethod: "getAuthorizedAssetFinanceSummary",
    repositoryArgs: (message) => ({ filters: assetFinanceFilters(message) }),
    outcome: "live_asset_finance_summary",
    notice: "Asset Finance role and branch scope, straight-line depreciation, and the PHP 5,000 capitalization threshold were applied.",
    format: (data, message) => {
      const metric = assetFinanceMetric(message);
      const scope = financeScopeLabel(data);
      if (metric) {
        const [key, type, label] = metric;
        const value = Number(data[key] || 0);
        if (type === "currency") {
          return `The ${label}${scope} is ${formatCurrency(value)} under your role and branch access.`;
        }
        return `You currently have ${value} ${label}${value === 1 ? "" : "s"}${scope} under your role and branch access.`;
      }
      return [
        `Asset Finance${scope}: ${Number(data.total_assets || 0)} record${Number(data.total_assets || 0) === 1 ? "" : "s"}, including ${Number(data.depreciable_assets || 0)} depreciable asset${Number(data.depreciable_assets || 0) === 1 ? "" : "s"} and ${Number(data.expense_items || 0)} expense item${Number(data.expense_items || 0) === 1 ? "" : "s"}.`,
        `Capitalized purchase value: ${formatCurrency(data.total_asset_value)}. Current book value: ${formatCurrency(data.current_book_value)}. Accumulated depreciation: ${formatCurrency(data.accumulated_depreciation)}.`,
        `Monthly depreciation: ${formatCurrency(data.monthly_depreciation_expense)}. Fully depreciated: ${Number(data.fully_depreciated_assets || 0)}. Near or at end of life: ${Number(data.assets_near_end_of_life || 0)}.`,
        `Warranty: ${Number(data.warranties_expired || 0)} expired, ${Number(data.warranties_expiring_30_days || 0)} expiring in 30 days. Missing financial information: ${Number(data.missing_financial_information || 0)}.`,
      ].join("\n");
    },
  },
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
  assetFinanceFilters,
  assetFinanceMetric,
  assetDiscoveryMetric,
  findLiveSummaryCapability,
  formatCapabilityResult,
};
