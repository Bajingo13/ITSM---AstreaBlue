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
  extractResponseText,
  formatKnowledgeContext,
  sanitizeHistory,
};
