const repository = require("../repositories/aiAssistantRepository");

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

function formatKnowledgeContext(articles) {
  if (!articles.length) return "No authorized Knowledge Base articles matched.";
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
    return "I could not find an authorized Knowledge Base article for that question. Try using a device name, error message, module, or issue category.";
  }
  const lead = articles[0];
  return [
    `The closest authorized article is ${sourceLabel(lead)} ${lead.title}.`,
    lead.symptoms ? `Symptoms: ${lead.symptoms}` : "",
    lead.resolution ? `Recommended resolution: ${lead.resolution}` : "",
    "AI-generated answers are not enabled yet, so this is a direct Knowledge Base result.",
  ].filter(Boolean).join("\n\n");
}

function normalizeRole(role) {
  return String(role || "").toLowerCase().replace(/[\s_-]+/g, "");
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

function detectHardwareAssetSummaryIntent(message) {
  const normalized = String(message || "").toLowerCase();
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
  return status || { key: null, label: null };
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
    return `You currently have ${count} ${intent.label} hardware asset${count === 1 ? "" : "s"} visible under your role and branch access.`;
  }
  return [
    `You currently have ${summary.total} hardware asset${summary.total === 1 ? "" : "s"} visible under your role and branch access.`,
    `By status: ${formatBreakdown(summary.byStatus)}.`,
    `By type: ${formatBreakdown(summary.byType)}.`,
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

    const ticketCountIntent = detectTicketCountIntent(trimmedMessage);
    if (ticketCountIntent) {
      const ticketCount = await repo.countAuthorizedTickets({
        actor,
        statusKey: ticketCountIntent.statusKey,
      });
      await repo.writeAudit({
        actor, question: trimmedMessage, outcome: "live_ticket_count",
        sourceCount: 0, ipAddress,
      });
      return {
        answer: `You currently have ${ticketCount} ${ticketCountIntent.label} ticket${ticketCount === 1 ? "" : "s"} visible under your role and branch access.`,
        sources: [],
        mode: "system-data",
        notice: "Live read-only AstreaBlue data. Existing ticket RBAC was applied.",
      };
    }

    const hardwareAssetIntent = detectHardwareAssetSummaryIntent(trimmedMessage);
    if (hardwareAssetIntent) {
      const summary = await repo.getAuthorizedHardwareAssetSummary({ actor });
      await repo.writeAudit({
        actor, question: trimmedMessage, outcome: "live_hardware_asset_summary",
        sourceCount: 0, ipAddress,
      });
      return {
        answer: formatHardwareAssetSummary(summary, hardwareAssetIntent),
        sources: [],
        mode: "system-data",
        notice: "Live read-only AstreaBlue data. Existing hardware asset RBAC was applied.",
      };
    }

    if (isOfflineEndpointQuestion(trimmedMessage)) {
      await repo.writeAudit({
        actor, question: trimmedMessage, outcome: "system_guide",
        sourceCount: 0, ipAddress,
      });
      return {
        answer: offlineEndpointGuide(actor),
        sources: [],
        mode: "system-guide",
        notice: "Built-in AstreaBlue troubleshooting guidance. No AI billing is required.",
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

    if (!apiKey) {
      await repo.writeAudit({
        actor, question: trimmedMessage, outcome: "knowledge_search",
        sourceCount: sources.length, ipAddress,
      });
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
            "You are AstreaBlue AI, a read-only enterprise ITSM assistant.",
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

  return { ask };
}

module.exports = {
  MAX_MESSAGE_LENGTH,
  buildInput,
  createAiAssistantService,
  detectHardwareAssetSummaryIntent,
  detectTicketCountIntent,
  extractResponseText,
  formatKnowledgeContext,
  formatHardwareAssetSummary,
  isOfflineEndpointQuestion,
  offlineEndpointGuide,
  sanitizeHistory,
};
