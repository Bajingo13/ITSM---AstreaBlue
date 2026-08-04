const repository = require("../repositories/aiAssistantRepository");
const { getRoleAwareSuggestions } = require("./aiAssistantSuggestions");
const {
  findModuleKnowledge,
  formatModuleKnowledge,
} = require("./aiModuleKnowledgeService");
const {
  findLiveSummaryCapability,
  formatCapabilityResult,
} = require("./aiLiveSummaryCapabilities");

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_ITEMS = 8;
const MAX_HISTORY_ITEM_LENGTH = 1200;

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => ["user", "assistant"].includes(item?.role))
    .slice(-MAX_HISTORY_ITEMS)
    .map((item) => ({
      role: item.role,
      content: String(item.content || "").trim().slice(0, MAX_HISTORY_ITEM_LENGTH),
    }))
    .filter((item) => item.content);
}

function sourceLabel(article) {
  return `[KB-${article.kb_id}]`;
}

function liveDataContext(source, lastUpdatedAt = null) {
  return {
    source,
    as_of: new Date().toISOString(),
    last_updated_at: lastUpdatedAt,
  };
}

function formatKnowledgeContext(articles) {
  if (!articles.length) return "No Knowledge Base articles matched.";
  return articles.map((article) => [
    `${sourceLabel(article)} ${article.title}`,
    `Category: ${article.category || "Uncategorized"}`,
    `Branch: ${article.branch_name || "Not specified"}`,
    `Symptoms: ${article.symptoms || "Not recorded"}`,
    `Resolution: ${article.resolution || "Not recorded"}`,
  ].join("\n")).join("\n\n");
}

function buildInput({ actor, message, history, articles }) {
  const conversation = sanitizeHistory(history)
    .map((item) => `${item.role === "user" ? "User" : "Assistant"}: ${item.content}`)
    .join("\n");
  return [
    `Current user: ${actor.full_name || "AstreaBlue user"}`,
    `Current role: ${actor.role_name}`,
    `Authorized branch: ${actor.branch_name || "All authorized branches"}`,
    conversation ? `Recent conversation:\n${conversation}` : "",
    `Authorized Knowledge Base context:\n${formatKnowledgeContext(articles)}`,
    `Question: ${message}`,
  ].filter(Boolean).join("\n\n");
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  const pieces = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content.text) pieces.push(content.text);
    }
  }
  return pieces.join("\n").trim();
}

function createKnowledgeSearchFallback(articles) {
  if (!articles.length) {
    return "I could not find a relevant Knowledge Base article for that question. Try using a device name, error message, module, or issue category.";
  }
  const lead = articles[0];
  return [
    `The closest matching article is ${sourceLabel(lead)} ${lead.title}.`,
    lead.symptoms ? `Symptoms: ${lead.symptoms}` : "",
    lead.resolution ? `Recommended resolution: ${lead.resolution}` : "",
  ].filter(Boolean).join("\n\n");
}

function normalizeRole(role) {
  return String(role || "").toLowerCase().replace(/[\s_-]+/g, "");
}

function isCountQuestion(message) {
  return /\b(how many|count|total|number of)\b/.test(
    String(message || "").toLowerCase()
  );
}

function normalizeIntentText(message) {
  return String(message || "")
    .toLowerCase()
    .replace(/\bhowmany\b/g, "how many")
    .replace(/\bdowe\b/g, "do we")
    .replace(/\biy\s+yes\b/g, "if yes")
    .replace(/\b(repear|repeair|repir|repaire)\b/g, "repair")
    .replace(/\b(aset|assset)\b/g, "asset")
    .replace(/\b(tiket|tickt)\b/g, "ticket")
    .replace(/\b(endpont|endpiont)\b/g, "endpoint")
    .replace(/\b(linceses|lisences|licences)\b/g, "licenses")
    .replace(/\b(lincese|lisence|licence)\b/g, "license");
}

function inferConversationSubject(history) {
  const recent = sanitizeHistory(history).slice().reverse();
  for (const item of recent) {
    const content = item.content.toLowerCase();
    if (/\b(branches|branch offices?|office branches?)\b/.test(content)) {
      return "branches";
    }
    if (
      /\b(users?|user accounts?|system accounts?|employees?)\b/.test(content)
      && !/\b(employee lifecycle|onboarding|offboarding)\b/.test(content)
    ) {
      return "users";
    }
    if (/\b(knowledge base|kb articles?|knowledge articles?)\b/.test(content)) {
      return "knowledge_base";
    }
    if (/\b(screenshots?|screen captures?|screenshot monitoring|screenshot gallery)\b/.test(content)) {
      return "screenshots";
    }
    if (/\b(usb|dlp|data loss prevention|removable (?:device|media)|file transfer)\b/.test(content)) {
      return "usb_dlp";
    }
    if (
      /\b(reporting analytics|operational analytics|executive dashboard|custom reports?|service desk reports?)\b/.test(content)
    ) {
      return "reporting";
    }
    if (/\b(projects?|project forecasting|project portfolio|milestones?|project risks?|project budget)\b/.test(content)) {
      return "projects";
    }
    if (
      /\b(configuration items?|cmdb|config items?|dependency map|dependencies|ci relationships?|change impact)\b/.test(content)
    ) {
      return "cmdb";
    }
    if (
      /\b(endpoint health|device health|endpoint diagnostics?|monitoring health)\b/.test(content)
    ) {
      return "endpoint_health";
    }
    if (
      /\b(sla|service level|first response|resolution target|sla compliance)\b/.test(content)
    ) {
      return "sla";
    }
    if (
      /\b(replacement requests?|replacement management|repair requests?)\b/.test(content)
    ) {
      return "replacement";
    }
    if (
      /\b(employee lifecycle|onboarding|offboarding|lifecycle cases?)\b/.test(content)
    ) {
      return "lifecycle";
    }
    if (
      /\b(endpoint polic(?:y|ies)|effective polic(?:y|ies)|policy sync|policy download|monitoring polic(?:y|ies))\b/.test(content)
    ) {
      return "endpoint_policy";
    }
    if (
      /\b(consent records?|consent documents?|privacy consent|monitoring consent|general consent|device[- ]specific consent)\b/.test(content)
    ) {
      return "consent";
    }
    if (
      /\b(asset finance|asset financials?|depreciat(?:ion|ed|ing)?|book value|asset value|end of life|warrant(?:y|ies))\b/.test(content)
    ) {
      return "asset_finance";
    }
    if (
      /\b(endpoint monitoring|monitored endpoints?|monitored devices?|endpoints?|heartbeat)\b/.test(content)
    ) {
      return "endpoints";
    }
    if (
      /\b(hardware assets?|assets?|laptops?|desktops?|computers?)\b/.test(content)
      && !/\b(software|licen[cs]es?)\b/.test(content)
    ) {
      return "hardware_assets";
    }
    if (/\b(software licenses?|subscriptions?|license seats?)\b/.test(content)) {
      return "software_licenses";
    }
    if (/\btickets?\b/.test(content)) return "tickets";
  }
  return null;
}

function resolveContextualCountMessage(message, history) {
  const trimmed = String(message || "").trim();
  const normalized = normalizeIntentText(trimmed);

  const hasExplicitSubject =
    /\b(branches|branch offices?|office branches?|users?|user accounts?|system accounts?|employees?|tickets?|hardware assets?|assets?|laptops?|desktops?|computers?|software|licen[cs]es?|subscriptions?|endpoints?|devices?|screenshots?|screen captures?|usb|dlp|data loss prevention|removable media|file transfers?|endpoint health|device health|endpoint diagnostics?|sla|service level|replacement requests?|replacement management|onboarding|offboarding|employee lifecycle|lifecycle|lifecycle cases?|configuration items?|cmdb|config items?|dependency map|dependencies|ci relationships?|change impact|projects?|project forecasting|project portfolio|milestones?|project risks?|project budget|reporting analytics|operational analytics|executive dashboard|custom reports?|service desk reports?|knowledge base|kb articles?|knowledge articles?|articles?|finance|financial|depreciat(?:ion|ed|ing)?|book value|end of life|warrant(?:y|ies)|consent records?|consent documents?|privacy consent|monitoring consent|endpoint polic(?:y|ies)|effective polic(?:y|ies)|policy sync|policy download)\b/i
      .test(normalized);
  if (hasExplicitSubject) {
    const recent = sanitizeHistory(history).slice().reverse();
    const pendingCount = recent.find(
      (item) => item.role === "user" && isCountQuestion(item.content)
    );
    const wasClarifying = recent.some(
      (item) =>
        item.role === "assistant"
        && /what would you like me to count/i.test(item.content)
    );
    if (!isCountQuestion(normalized) && pendingCount && wasClarifying) {
      return {
        message: `${pendingCount.content} ${normalized}`,
        ambiguous: false,
      };
    }
    return { message: normalized, ambiguous: false };
  }

  const subject = inferConversationSubject(history);
  const isNaturalFollowUp =
    /\b(whats|what(?:'s| is| are)|which|where|list|show|give me|tell me)\b/.test(normalized)
    && (
      /\b(it|its|them|they|those|these|one|ones)\b/.test(normalized)
      || /\b(names?|details?|status|statuses|locations?|located|addresses?|available|used|expired|expiring|vendor|vendors|cost|costs)\b/.test(normalized)
    );
  if (!isCountQuestion(trimmed) && !isNaturalFollowUp) {
    return { message: normalized, ambiguous: false };
  }

  if (subject === "hardware_assets") {
    return { message: `${trimmed} hardware assets`, ambiguous: false };
  }
  if (subject === "branches") {
    return { message: `${trimmed} branches`, ambiguous: false };
  }
  if (subject === "users") {
    return { message: `${trimmed} user accounts`, ambiguous: false };
  }
  if (subject === "tickets") {
    return { message: `${trimmed} tickets`, ambiguous: false };
  }
  if (subject === "endpoints") {
    return { message: `${trimmed} monitored endpoints`, ambiguous: false };
  }
  if (subject === "software_licenses") {
    return { message: `${trimmed} software licenses`, ambiguous: false };
  }
  if (subject === "knowledge_base") {
    return { message: `${trimmed} Knowledge Base articles`, ambiguous: false };
  }
  if (subject === "asset_finance") {
    return { message: `${trimmed} asset finance`, ambiguous: false };
  }
  if (subject === "consent") {
    return { message: `${trimmed} consent records`, ambiguous: false };
  }
  if (subject === "endpoint_policy") {
    return { message: `${trimmed} endpoint policies`, ambiguous: false };
  }
  if (subject === "endpoint_health") {
    return { message: `${trimmed} endpoint health`, ambiguous: false };
  }
  if (subject === "sla") {
    return { message: `${trimmed} SLA tickets`, ambiguous: false };
  }
  if (subject === "replacement") {
    return { message: `${trimmed} replacement requests`, ambiguous: false };
  }
  if (subject === "lifecycle") {
    return { message: `${trimmed} employee lifecycle cases`, ambiguous: false };
  }
  if (subject === "cmdb") {
    return { message: `${trimmed} configuration items and change impact`, ambiguous: false };
  }
  if (subject === "projects") {
    const followUp = trimmed.replace(/[?.!]+$/, "");
    return { message: `${followUp} project milestones and projects`, ambiguous: false };
  }
  if (subject === "reporting") {
    return { message: `${trimmed} operational analytics report`, ambiguous: false };
  }
  if (subject === "screenshots") {
    return { message: `${trimmed} screenshot monitoring`, ambiguous: false };
  }
  if (subject === "usb_dlp") {
    return { message: `${trimmed} USB and DLP activity`, ambiguous: false };
  }
  return {
    message: normalized,
    ambiguous: isCountQuestion(trimmed),
  };
}

function detectTicketCountIntent(message) {
  const normalized = String(message || "").toLowerCase();
  const asksForCount = /\b(how many|count|total|number of)\b/.test(normalized);
  if (!asksForCount || !/\btickets?\b/.test(normalized)) return null;

  if (/\bopen queue\b/.test(normalized)) return { statusKey: "open_queue", label: "Open Queue" };
  if (/\bin progress\b/.test(normalized)) return { statusKey: "in_progress", label: "In Progress" };
  if (/\bresolved\b/.test(normalized)) return { statusKey: "resolved", label: "Resolved" };
  if (/\bclosed\b/.test(normalized)) return { statusKey: "closed", label: "Closed" };
  if (/\bcancel(?:led|ed)\b/.test(normalized)) return { statusKey: "cancelled", label: "Cancelled" };
  if (/\bactive\b/.test(normalized)) return { statusKey: "active", label: "active" };
  return { statusKey: "all", label: "total" };
}

function detectTicketStatusSummaryIntent(message) {
  const normalized = normalizeIntentText(message);
  if (!/\btickets?\b/.test(normalized)) return false;
  return /\b(status|statuses|status breakdown|breakdown by status)\b/.test(normalized)
    && !/\b(how many|count|number of)\b/.test(normalized);
}

function formatTicketStatusSummary(summary) {
  const byStatus = summary?.byStatus || {};
  const preferredOrder = [
    "Open Queue",
    "In Progress",
    "Resolved",
    "Closed",
    "Cancelled",
    "Canceled",
  ];
  const orderedStatuses = [
    ...preferredOrder.filter((status) => Object.prototype.hasOwnProperty.call(byStatus, status)),
    ...Object.keys(byStatus)
      .filter((status) => !preferredOrder.includes(status))
      .sort((left, right) => left.localeCompare(right)),
  ];
  if (!orderedStatuses.length) return "There are currently no tickets.";

  const breakdown = orderedStatuses
    .map((status) => `${status}: ${Number(byStatus[status] || 0)}`)
    .join(", ");
  return `You currently have ${Number(summary.total || 0)} total tickets. By status: ${breakdown}.`;
}

function detectHardwareAssetSummaryIntent(message) {
  const normalized = normalizeIntentText(message);
  const asksForSummary = /\b(how many|count|total|number of|summary|breakdown)\b/.test(normalized);
  const mentionsAssets = /\b(hardware assets?|assets?|laptops?|desktops?|computers?)\b/.test(normalized);
  const isSoftwareQuestion = /\b(software|licen[cs]es?)\b/.test(normalized);
  const isFinancialQuestion = /\b(value|cost|price|depreciation|financial)\b/.test(normalized);
  if (!asksForSummary || !mentionsAssets || isSoftwareQuestion || isFinancialQuestion) return null;

  const statusMatchers = [
    { key: "in repair", label: "In Repair", pattern: /\b(in|under)\s+repair\b/ },
    { key: "in use", label: "In Use", pattern: /\bin use\b/ },
    { key: "available", label: "Available", pattern: /\bavailable\b/ },
    { key: "borrowed", label: "Borrowed", pattern: /\bborrowed\b/ },
    { key: "active", label: "Active", pattern: /\bactive\b/ },
    { key: "retired", label: "Retired", pattern: /\bretired\b/ },
    { key: "disposed", label: "Disposed", pattern: /\bdisposed\b/ },
  ];
  const status = statusMatchers.find(({ pattern }) => pattern.test(normalized));
  const asksExistence = /\b(do we have|are there|is there|if yes)\b/.test(normalized);
  return status ? { ...status, asksExistence } : { key: null, label: null, asksExistence };
}

function detectEndpointSummaryIntent(message) {
  const normalized = String(message || "").toLowerCase();
  const asksForSummary = /\b(how many|count|total|number of|summary|breakdown)\b/.test(normalized);
  const explicitEndpoint =
    /\b(endpoint monitoring|monitored endpoints?|monitored devices?|endpoints?|heartbeat)\b/.test(normalized);
  const reportingDevice =
    /\b(laptops?|computers?|devices?)\b/.test(normalized)
    && /\b(detect(?:ed|ing)?|report(?:ed|ing)?|monitor(?:ed|ing)?|online|offline)\b/.test(normalized);
  if (!asksForSummary || (!explicitEndpoint && !reportingDevice)) return null;

  if (/\boffline\b/.test(normalized)) return { key: "offline", label: "offline" };
  if (/\bonline\b/.test(normalized)) return { key: "online", label: "online" };
  if (/\bunassigned\b/.test(normalized)) return { key: "unassigned", label: "unassigned" };
  if (/\bassigned\b/.test(normalized)) return { key: "assigned", label: "assigned" };
  if (/\bunlinked\b/.test(normalized)) return { key: "unlinked", label: "unlinked" };
  if (/\blinked\b/.test(normalized)) return { key: "linked_to_asset", label: "linked to an asset" };
  return { key: null, label: null };
}

function detectSoftwareLicenseIntent(message) {
  const normalized = normalizeIntentText(message);
  const mentionsLicenses =
    /\b(software(?: products?)?|licensed (?:software|applications?|programs?)|software licenses?|licenses?|subscriptions?|seats?)\b/.test(normalized);
  const asksForData =
    /\b(how many|count|total|number of|summary|breakdown|available|used|assigned|expiry|expires?|expired|expiring|status|cost|renewal|names?|list|which|what software|what are|do we have|show|tell me|about|details?|vendors?)\b/.test(normalized);
  if (!mentionsLicenses || !asksForData) return null;

  let metric = "summary";
  if (
    /\b(names?|list|which|what software|what are)\b/.test(normalized)
    || (
      /\bshow\b/.test(normalized)
      && !/\b(available|used|assigned|expiry|expires?|expired|expiring|status|cost|renewal)\b/.test(normalized)
    )
  ) metric = "names";
  else if (/\b(vendor|vendors)\b/.test(normalized)) metric = "vendors";
  else if (/\b(status|statuses)\b/.test(normalized)) metric = "status";
  else if (/\b(details?|tell me|about)\b/.test(normalized)) metric = "names";
  else if (/\bavailable\b/.test(normalized)) metric = "available";
  else if (/\b(used|assigned|in use)\b/.test(normalized)) metric = "used";
  else if (/\b(expired)\b/.test(normalized)) metric = "expired";
  else if (/\b(next|nearest|soonest).*(?:expir|renew)|\bnext visible expiry\b/.test(normalized)) {
    metric = "next_expiry";
  }
  else if (/\b(expiring|expires?|expiry|expiration)\b/.test(normalized)) metric = "expiry";
  else if (/\b(cost|price|annual)\b/.test(normalized)) metric = "cost";
  else if (/\b(total|how many|count|number of)\b/.test(normalized)) metric = "total";
  return { metric, message: normalized };
}

function normalizeComparable(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findMentionedLicenses(licenses, message) {
  const normalizedMessage = ` ${normalizeComparable(message)} `;
  return (licenses || []).filter((license) => {
    const name = normalizeComparable(license.license_name);
    return name && normalizedMessage.includes(` ${name} `);
  });
}

function softwareProductHint(message) {
  const normalized = normalizeComparable(message);
  const marker = normalized.lastIndexOf(" in ");
  if (marker < 0) return null;
  const hint = normalized.slice(marker + 4).trim();
  return hint && !["use", "stock", "total"].includes(hint) ? hint : null;
}

function formatSoftwareLicenseAnswer(result, intent) {
  if (!result.authorized) {
    return "Software License Management data is restricted to SuperAdmin and branch-scoped Admin accounts.";
  }
  const licenses = result.licenses || [];
  if (!licenses.length) {
    return "There are no software-license records.";
  }

  const mentioned = findMentionedLicenses(licenses, intent.message);
  const hint = softwareProductHint(intent.message);
  if (hint && !mentioned.length) {
    return `I could not find a software-license record matching “${hint}”.`;
  }
  const selected = mentioned.length ? mentioned : licenses;
  const product = mentioned.length
    ? [...new Set(mentioned.map((item) => item.license_name))].join(", ")
    : "Your software licenses";
  const total = selected.reduce((sum, item) => sum + Number(item.total_licenses || 0), 0);
  const used = selected.reduce((sum, item) => sum + Number(item.used_licenses || 0), 0);
  const available = selected.reduce(
    (sum, item) => sum + Math.max(Number(item.total_licenses || 0) - Number(item.used_licenses || 0), 0),
    0
  );

  if (intent.metric === "names") {
    const grouped = new Map();
    selected.forEach((item) => {
      const name = String(item.license_name || "Unnamed software").trim();
      const current = grouped.get(name) || {
        records: 0,
        total: 0,
        used: 0,
        available: 0,
        vendors: new Set(),
      };
      current.records += 1;
      current.total += Number(item.total_licenses || 0);
      current.used += Number(item.used_licenses || 0);
      current.available += Math.max(
        Number(item.total_licenses || 0) - Number(item.used_licenses || 0),
        0
      );
      if (item.vendor) current.vendors.add(String(item.vendor).trim());
      grouped.set(name, current);
    });
    const lines = [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, details]) => {
        const vendor = details.vendors.size
          ? ` · ${[...details.vendors].sort().join(", ")}`
          : "";
        return `- ${name}${vendor}: ${details.total} total, ${details.used} used, ${details.available} available`;
      });
    return [
      `There ${grouped.size === 1 ? "is" : "are"} ${grouped.size} software product${grouped.size === 1 ? "" : "s"} across ${selected.length} license record${selected.length === 1 ? "" : "s"}:`,
      ...lines,
    ].join("\n");
  }
  if (intent.metric === "vendors") {
    const vendors = [...new Set(
      selected
        .map((item) => String(item.vendor || "").trim())
        .filter(Boolean)
    )].sort();
    return vendors.length
      ? `The software-license vendors are: ${vendors.join(", ")}.`
      : "The software-license records do not have vendor names recorded.";
  }
  if (intent.metric === "status") {
    const statuses = selected.reduce((summary, item) => {
      const status = String(item.status || "Unknown").trim() || "Unknown";
      summary[status] = (summary[status] || 0) + 1;
      return summary;
    }, {});
    return `Software-license records by status: ${formatBreakdown(statuses)}.`;
  }

  if (intent.metric === "available") {
    return `${product} currently ${mentioned.length === 1 ? "has" : "have"} ${available} available license seat${available === 1 ? "" : "s"} (${used} used out of ${total} total).`;
  }
  if (intent.metric === "used") {
    return `${product} currently ${mentioned.length === 1 ? "has" : "have"} ${used} used license seat${used === 1 ? "" : "s"} out of ${total} total, leaving ${available} available.`;
  }
  if (intent.metric === "expired") {
    const expired = selected.filter((item) => String(item.status).toLowerCase() === "expired").length;
    return `${product} ${mentioned.length === 1 ? "has" : "have"} ${expired} expired subscription record${expired === 1 ? "" : "s"}.`;
  }
  if (intent.metric === "next_expiry") {
    const dated = selected
      .filter((item) => item.expiry_date)
      .sort((left, right) => new Date(left.expiry_date) - new Date(right.expiry_date));
    if (!dated.length) return `${product} has no recorded expiry date.`;
    const next = dated[0];
    return `${next.license_name}'s next visible expiry date is ${new Date(next.expiry_date).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric" })}. Its current status is ${next.status}.`;
  }
  if (intent.metric === "expiry") {
    const expiring = selected
      .filter((item) => String(item.status || "").toLowerCase() === "expiring soon")
      .sort((left, right) => new Date(left.expiry_date) - new Date(right.expiry_date));
    if (!expiring.length) {
      return "There are no software-license records currently marked Expiring Soon.";
    }
    const lines = expiring.map((item) => {
      const expiry = item.expiry_date
        ? new Date(item.expiry_date).toLocaleDateString("en-PH", {
          timeZone: "Asia/Manila",
          year: "numeric",
          month: "long",
          day: "numeric",
        })
        : "No expiry date recorded";
      const availableSeats = Math.max(
        Number(item.total_licenses || 0) - Number(item.used_licenses || 0),
        0
      );
      return `- ${item.license_name}: ${expiry} · ${availableSeats} available seat${availableSeats === 1 ? "" : "s"}`;
    });
    return [
      `${expiring.length} software-license record${expiring.length === 1 ? " is" : "s are"} expiring soon:`,
      ...lines,
    ].join("\n");
  }
  if (intent.metric === "cost") {
    const cost = selected.reduce((sum, item) => sum + Number(item.annual_cost || 0), 0);
    return `${product} ${mentioned.length === 1 ? "has" : "have"} a combined recorded annual cost of PHP ${cost.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`;
  }
  return `There are ${selected.length} software-license subscription record${selected.length === 1 ? "" : "s"}, with ${total} total seats, ${used} used, and ${available} available.`;
}

function findSummaryCount(group, key) {
  if (!key) return null;
  const entry = Object.entries(group || {}).find(
    ([label]) => label.toLowerCase() === key.toLowerCase()
  );
  return Number(entry?.[1] || 0);
}

function formatBreakdown(group) {
  const entries = Object.entries(group || {})
    .map(([label, count]) => [label, Number(count || 0)])
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return entries.length
    ? entries.map(([label, count]) => `${label}: ${count}`).join(", ")
    : "none";
}

function formatHardwareAssetSummary(summary, intent) {
  if (intent.key) {
    const count = findSummaryCount(summary.byStatus, intent.key);
    if (intent.asksExistence) {
      if (count > 0) {
        return `Yes. You currently have ${count} ${intent.label} hardware asset${count === 1 ? "" : "s"}.`;
      }
      return `No. You currently have no ${intent.label} hardware assets.`;
    }
    return `You currently have ${count} ${intent.label} hardware asset${count === 1 ? "" : "s"}.`;
  }
  return [
    `You currently have ${summary.total} hardware asset${summary.total === 1 ? "" : "s"}.`,
    `By status: ${formatBreakdown(summary.byStatus)}.`,
    `By type: ${formatBreakdown(summary.byType)}.`,
  ].join("\n");
}

function formatEndpointSummary(summary, intent) {
  if (intent.key) {
    const count = Number(summary[intent.key] || 0);
    return `You currently have ${count} ${intent.label} monitored endpoint${count === 1 ? "" : "s"}.`;
  }
  return [
    `AstreaBlue is currently monitoring ${summary.total} registered endpoint${summary.total === 1 ? "" : "s"}.`,
    `Heartbeat status: Online: ${summary.online}, Offline: ${summary.offline}.`,
    `Assignment: Assigned: ${summary.assigned}, Unassigned: ${summary.unassigned}.`,
    `Asset linkage: Linked: ${summary.linked_to_asset}, Unlinked: ${summary.unlinked}.`,
  ].join("\n");
}

function isOfflineEndpointQuestion(message) {
  const normalized = String(message || "").toLowerCase();
  return (
    /\b(endpoint|device|laptop|computer|agent)\b/.test(normalized)
    && /\b(offline|stale|heartbeat|not reporting|not connecting)\b/.test(normalized)
  );
}

function offlineEndpointGuide(actor) {
  const role = normalizeRole(actor.role_name);
  if (["employee", "hr"].includes(role)) {
    return [
      "To troubleshoot an offline endpoint:",
      "1. Confirm the laptop is powered on and connected to the internet.",
      "2. Restart the laptop once, then allow about two minutes for its next heartbeat.",
      "3. Open Endpoint Management and check whether Last Heartbeat updates.",
      "4. If it remains offline, submit a Service Desk ticket with the device name and the time it was last online.",
      "An authorized administrator or technician can then run the agent diagnostics. Do not reinstall the agent unless diagnostics show that repair or re-enrollment is required.",
    ].join("\n");
  }

  return [
    "Use this AstreaBlue endpoint checklist:",
    "1. In Endpoint Management > Devices, confirm the device name, Last Heartbeat, policy state, and credential status.",
    "2. On the affected Windows laptop, run `sc.exe query AstreaBlueMonitoringAgent` in an Administrator Command Prompt. The service should show RUNNING.",
    "3. Run `\"C:\\Program Files\\AstreaBlue\\Monitoring Agent\\AstreaBlue.Agent.Service.exe\" --diagnostics` and check heartbeat, backend URL, device UUID, and credential health.",
    "4. Review the newest log under `C:\\ProgramData\\AstreaBlue\\MonitoringAgent\\logs` for authentication, network, or policy errors.",
    "5. If the credential is invalid or revoked, create a new one-time enrollment code and run the current package's repair script with that code.",
    "6. If the service is stopped, repair/start it and wait about two minutes for a new heartbeat.",
    "Do not uninstall first. Reinstall only when repair fails or the installed agent files are missing.",
  ].join("\n");
}

function createAiAssistantService({
  repo = repository,
  fetchImpl = global.fetch,
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_MODEL || "gpt-5.6",
} = {}) {
  async function getSuggestions({ tokenUser }) {
    const actor = await repo.getActorContext(tokenUser.userId || tokenUser.user_id);
    if (!actor || actor.is_active === false) {
      const error = new Error("Your account is inactive or no longer available.");
      error.status = 403;
      throw error;
    }

    return {
      suggestions: getRoleAwareSuggestions(actor),
    };
  }

  async function getInsights({ tokenUser }) {
    const actor = await repo.getActorContext(tokenUser.userId || tokenUser.user_id);
    if (!actor || actor.is_active === false) {
      const error = new Error("Your account is inactive or no longer available.");
      error.status = 403;
      throw error;
    }
    const insights = await repo.getAssistantInsights({ actor });
    if (insights?.authorized === false) {
      const error = new Error("Assistant quality insights require administrator access.");
      error.status = 403;
      throw error;
    }
    return insights;
  }

  async function submitFeedback({
    tokenUser,
    question,
    responseMode,
    helpful,
  }) {
    const normalizedQuestion = String(question || "").trim();
    if (!normalizedQuestion || normalizedQuestion.length > MAX_MESSAGE_LENGTH) {
      const error = new Error(`Question must be between 1 and ${MAX_MESSAGE_LENGTH} characters.`);
      error.status = 400;
      throw error;
    }
    if (typeof helpful !== "boolean") {
      const error = new Error("Helpful must be true or false.");
      error.status = 400;
      throw error;
    }

    const actor = await repo.getActorContext(tokenUser.userId || tokenUser.user_id);
    if (!actor || actor.is_active === false) {
      const error = new Error("Your account is inactive or no longer available.");
      error.status = 403;
      throw error;
    }

    return repo.writeFeedback({
      actor,
      question: normalizedQuestion,
      responseMode,
      helpful,
    });
  }

  async function ask({ tokenUser, message, history, ipAddress }) {
    const trimmedMessage = String(message || "").trim();
    if (!trimmedMessage || trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      const error = new Error(`Question must be between 1 and ${MAX_MESSAGE_LENGTH} characters.`);
      error.status = 400;
      throw error;
    }

    const actor = await repo.getActorContext(tokenUser.userId || tokenUser.user_id);
    if (!actor || actor.is_active === false) {
      const error = new Error("Your account is inactive or no longer available.");
      error.status = 403;
      throw error;
    }
    const markCoverageResolved = async () => {
      if (typeof repo.resolveUnansweredQuestion !== "function") return;
      await repo.resolveUnansweredQuestion({
        actor,
        question: trimmedMessage,
      }).catch(() => null);
    };

    const contextualQuestion = resolveContextualCountMessage(trimmedMessage, history);
    if (contextualQuestion.ambiguous) {
      if (typeof repo.recordUnansweredQuestion === "function") {
        await repo.recordUnansweredQuestion({
          actor,
          question: trimmedMessage,
          reason: "clarification_required",
        }).catch(() => null);
      }
      await repo.writeAudit({
        actor, question: trimmedMessage, outcome: "clarification_required",
        sourceCount: 0, ipAddress,
      });
      return {
        answer: [
          "What would you like me to count?",
        "I can check tickets, assets, monitored endpoints, screenshots, USB and DLP activity, licenses, SLA performance, replacements, lifecycle cases, consent, and endpoint policies.",
          "For example: “How many SLA tickets are breached?”, “How many replacement requests are awaiting approval?”, or “How many endpoints require attention?”",
        ].join("\n"),
        sources: [],
        mode: "clarification",
        notice: "Please include the module or record type. I will keep the same subject for follow-up questions in this conversation.",
      };
    }

    const liveSummaryCapability = findLiveSummaryCapability(contextualQuestion.message);
    if (liveSummaryCapability) {
      const repositoryArgs = liveSummaryCapability.repositoryArgs
        ? liveSummaryCapability.repositoryArgs(contextualQuestion.message)
        : {};
      const data = await repo[liveSummaryCapability.repositoryMethod]({
        actor,
        ...repositoryArgs,
      });
      await repo.writeAudit({
        actor, question: trimmedMessage, outcome: liveSummaryCapability.outcome,
        sourceCount: 0, ipAddress,
      });
      await markCoverageResolved();
      return {
        answer: formatCapabilityResult(
          liveSummaryCapability,
          data,
          contextualQuestion.message,
          actor
        ),
        sources: [],
        mode: "system-data",
        notice: `Live read-only AstreaBlue data. ${liveSummaryCapability.notice}`,
        data_context: {
          source: liveSummaryCapability.sourceLabel || liveSummaryCapability.key,
          as_of: data?.as_of || new Date().toISOString(),
          last_updated_at:
            data?.last_screenshot_at ||
            data?.last_event_at ||
            data?.latest?.captured_at ||
            data?.latest?.occurred_at ||
            null,
        },
      };
    }

    const ticketStatusSummaryIntent = detectTicketStatusSummaryIntent(
      contextualQuestion.message
    );
    if (ticketStatusSummaryIntent) {
      const summary = await repo.getAuthorizedTicketStatusSummary({ actor });
      await repo.writeAudit({
        actor, question: trimmedMessage, outcome: "live_ticket_status_summary",
        sourceCount: 0, ipAddress,
      });
      await markCoverageResolved();
      return {
        answer: formatTicketStatusSummary(summary),
        sources: [],
        mode: "system-data",
        notice: "Live read-only AstreaBlue data. Existing ticket RBAC was applied.",
        data_context: liveDataContext("Service Desk - Tickets"),
      };
    }

    const ticketCountIntent = detectTicketCountIntent(contextualQuestion.message);
    if (ticketCountIntent) {
      const ticketCount = await repo.countAuthorizedTickets({
        actor,
        statusKey: ticketCountIntent.statusKey,
      });
      await repo.writeAudit({
        actor, question: trimmedMessage, outcome: "live_ticket_count",
        sourceCount: 0, ipAddress,
      });
      await markCoverageResolved();
      return {
        answer: `You currently have ${ticketCount} ${ticketCountIntent.label} ticket${ticketCount === 1 ? "" : "s"}.`,
        sources: [],
        mode: "system-data",
        notice: "Live read-only AstreaBlue data. Existing ticket RBAC was applied.",
        data_context: liveDataContext("Service Desk - Tickets"),
      };
    }

    const endpointSummaryIntent = detectEndpointSummaryIntent(contextualQuestion.message);
    if (endpointSummaryIntent) {
      const summary = await repo.getAuthorizedEndpointSummary({ actor });
      await repo.writeAudit({
        actor, question: trimmedMessage, outcome: "live_endpoint_summary",
        sourceCount: 0, ipAddress,
      });
      await markCoverageResolved();
      return {
        answer: formatEndpointSummary(summary, endpointSummaryIntent),
        sources: [],
        mode: "system-data",
        notice: "Live read-only AstreaBlue data. Endpoint monitoring RBAC and the 120-second heartbeat threshold were applied.",
        data_context: liveDataContext("Endpoint Monitoring - Devices"),
      };
    }

    const softwareLicenseIntent = detectSoftwareLicenseIntent(contextualQuestion.message);
    if (softwareLicenseIntent) {
      const result = await repo.getAuthorizedSoftwareLicenses({ actor });
      await repo.writeAudit({
        actor, question: trimmedMessage, outcome: "live_software_license_summary",
        sourceCount: 0, ipAddress,
      });
      await markCoverageResolved();
      return {
        answer: formatSoftwareLicenseAnswer(result, softwareLicenseIntent),
        sources: [],
        mode: "system-data",
        notice: "Live read-only AstreaBlue data. Software License Management access controls were applied.",
        data_context: liveDataContext("Asset Management - Software Licenses"),
      };
    }

    const hardwareAssetIntent = detectHardwareAssetSummaryIntent(contextualQuestion.message);
    if (hardwareAssetIntent) {
      const summary = await repo.getAuthorizedHardwareAssetSummary({ actor });
      await repo.writeAudit({
        actor, question: trimmedMessage, outcome: "live_hardware_asset_summary",
        sourceCount: 0, ipAddress,
      });
      await markCoverageResolved();
      return {
        answer: formatHardwareAssetSummary(summary, hardwareAssetIntent),
        sources: [],
        mode: "system-data",
        notice: "Live read-only AstreaBlue data. Existing hardware asset RBAC was applied.",
        data_context: liveDataContext("Asset Management - Hardware Assets"),
      };
    }

    if (isOfflineEndpointQuestion(trimmedMessage)) {
      await repo.writeAudit({
        actor, question: trimmedMessage, outcome: "system_guide",
        sourceCount: 0, ipAddress,
      });
      await markCoverageResolved();
      return {
        answer: offlineEndpointGuide(actor),
        sources: [],
        mode: "system-guide",
        notice: "Built-in AstreaBlue troubleshooting guidance. No AI billing is required.",
      };
    }

    const moduleKnowledge = findModuleKnowledge(trimmedMessage);
    if (moduleKnowledge) {
      await repo.writeAudit({
        actor, question: trimmedMessage, outcome: "module_knowledge",
        sourceCount: 0, ipAddress,
      });
      await markCoverageResolved();
      return {
        answer: formatModuleKnowledge(moduleKnowledge),
        sources: [],
        mode: "system-guide",
        notice: "Built-in AstreaBlue module guidance. Live record totals are returned only by authorized read-only capabilities.",
      };
    }

    const articles = await repo.searchAuthorizedKnowledge({ actor, message: trimmedMessage });
    const sources = articles.map((article) => ({
      id: article.kb_id,
      label: sourceLabel(article),
      title: article.title,
      category: article.category,
      branch: article.branch_name,
    }));

    if (!articles.length && typeof repo.recordUnansweredQuestion === "function") {
      await repo.recordUnansweredQuestion({
        actor,
        question: trimmedMessage,
        reason: "no_authorized_answer",
      }).catch(() => null);
    }

    if (!apiKey) {
      await repo.writeAudit({
        actor, question: trimmedMessage, outcome: "knowledge_search",
        sourceCount: sources.length, ipAddress,
      });
      if (articles.length) await markCoverageResolved();
      return {
        answer: createKnowledgeSearchFallback(articles),
        sources,
        mode: "knowledge-search",
        notice: "OpenAI is not configured. Showing authorized Knowledge Base results only.",
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    let providerStatus = null;
    try {
      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          store: false,
          max_output_tokens: 700,
          instructions: [
        "You are Odysseus, a read-only AstreaBlue enterprise ITSM assistant.",
            "Use only the authorized Knowledge Base context supplied in the request.",
            "Never claim that you changed a ticket, asset, user, policy, or endpoint.",
            "Do not reveal credentials, API keys, private screenshots, or hidden data.",
            "If context is insufficient, say so and recommend the appropriate AstreaBlue module.",
            "Cite supporting articles with their exact [KB-number] label.",
            "Keep the answer practical and concise.",
          ].join(" "),
          input: buildInput({ actor, message: trimmedMessage, history, articles }),
        }),
        signal: controller.signal,
      });
      providerStatus = response.status;
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error("The AI provider is temporarily unavailable.");
        error.status = 502;
        throw error;
      }
      const answer = extractResponseText(payload);
      if (!answer) {
        const error = new Error("The AI provider returned an empty answer.");
        error.status = 502;
        throw error;
      }
      await repo.writeAudit({
        actor, question: trimmedMessage, outcome: "answered",
        sourceCount: sources.length, providerStatus, ipAddress,
      });
      await markCoverageResolved();
      return { answer, sources, mode: "ai" };
    } catch (error) {
      await repo.writeAudit({
        actor, question: trimmedMessage,
        outcome: error.name === "AbortError" ? "timeout" : "provider_error",
        sourceCount: sources.length, providerStatus, ipAddress,
      }).catch(() => {});
      if (error.name === "AbortError") {
        const timeoutError = new Error("The AI request timed out. Please try again.");
        timeoutError.status = 504;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  return { ask, getInsights, getSuggestions, submitFeedback };
}

module.exports = {
  MAX_MESSAGE_LENGTH,
  buildInput,
  createAiAssistantService,
  detectEndpointSummaryIntent,
  detectHardwareAssetSummaryIntent,
  detectSoftwareLicenseIntent,
  detectTicketCountIntent,
  detectTicketStatusSummaryIntent,
  formatTicketStatusSummary,
  extractResponseText,
  formatKnowledgeContext,
  formatHardwareAssetSummary,
  formatEndpointSummary,
  formatSoftwareLicenseAnswer,
  inferConversationSubject,
  isOfflineEndpointQuestion,
  normalizeIntentText,
  offlineEndpointGuide,
  resolveContextualCountMessage,
  sanitizeHistory,
};
