const db = require("../../config/db");
const { addTicketAccessFilter } = require("../routes/_ticketAccess");

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "can", "does", "for",
  "from", "have", "how", "into", "our", "please", "that", "the", "this",
  "what", "when", "where", "which", "why", "with", "would", "your",
]);

function normalizeRole(role) {
  return String(role || "").toLowerCase().replace(/[\s_-]+/g, "");
}

function extractSearchTerms(message) {
  return [...new Set(
    String(message || "").toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || []
  )]
    .filter((word) => !STOP_WORDS.has(word))
    .slice(0, 8);
}

function articleSearchScore(article, terms) {
  const fields = {
    title: String(article.title || "").toLowerCase(),
    category: String(article.category || "").toLowerCase(),
    tags: String(article.tags || "").toLowerCase(),
    symptoms: String(article.symptoms || "").toLowerCase(),
    resolution: String(article.resolution || "").toLowerCase(),
  };
  const words = (value) => new Set(value.match(/[a-z0-9][a-z0-9-]*/g) || []);
  const tokens = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, words(value)])
  );

  return terms.reduce((score, term) => {
    if (tokens.title.has(term)) return score + 4;
    if (tokens.category.has(term) || tokens.tags.has(term)) return score + 3;
    if (tokens.symptoms.has(term) || tokens.resolution.has(term)) return score + 1;
    return score;
  }, 0);
}

async function getActorContext(userId) {
  const result = await db.query(
    `SELECT u.user_id,u.full_name,u.branch_id,u.is_active,
            r.role_name,b.branch_name
     FROM users u
     LEFT JOIN system_roles r ON r.role_id=u.role_id
     LEFT JOIN branches b ON b.branch_id=u.branch_id
     WHERE u.user_id=$1
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function searchAuthorizedKnowledge({ actor, message, limit = 5 }) {
  const terms = extractSearchTerms(message);
  if (!terms.length) return [];

  const isSuperAdmin = normalizeRole(actor.role_name) === "superadmin";
  if (!isSuperAdmin && !actor.branch_id) return [];

  const params = [];
  const searchClauses = terms.map((term) => {
    params.push(`%${term}%`);
    const index = params.length;
    return `(kb.title ILIKE $${index}
      OR COALESCE(kb.category,'') ILIKE $${index}
      OR COALESCE(kb.tags,'') ILIKE $${index}
      OR COALESCE(kb.symptoms,'') ILIKE $${index}
      OR COALESCE(kb.resolution,'') ILIKE $${index})`;
  });

  const where = [`(${searchClauses.join(" OR ")})`];
  if (!isSuperAdmin) {
    params.push(actor.branch_id);
    where.push(`kb.branch_id=$${params.length}`);
  }
  const resultLimit = Math.min(Math.max(Number(limit) || 5, 1), 8);
  params.push(Math.max(resultLimit * 3, 12));

  const result = await db.query(
    `SELECT kb.kb_id,kb.title,kb.category,kb.tags,kb.symptoms,
            kb.resolution,kb.updated_at,b.branch_name
     FROM knowledge_base kb
     LEFT JOIN branches b ON b.branch_id=kb.branch_id
     WHERE ${where.join(" AND ")}
     ORDER BY CASE WHEN kb.title ILIKE $1 THEN 0 ELSE 1 END,
              kb.updated_at DESC,kb.kb_id DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows
    .map((article) => ({
      article,
      score: articleSearchScore(article, terms),
    }))
    .filter(({ score }) => score >= 2)
    .sort((left, right) => right.score - left.score)
    .slice(0, resultLimit)
    .map(({ article }) => article);
}

async function countAuthorizedTickets({ actor, statusKey }) {
  const params = [];
  const request = {
    ticketAccessContext: {
      authenticated: true,
      currentUserId: Number(actor.user_id),
      roleName: actor.role_name,
      branchId: actor.branch_id == null ? null : Number(actor.branch_id),
      filterBranchId: null,
    },
    query: {},
    body: {},
  };
  const clauses = addTicketAccessFilter(request, params, "t");
  const statuses = {
    open_queue: ["Open Queue"],
    in_progress: ["In Progress"],
    resolved: ["Resolved"],
    closed: ["Closed"],
    cancelled: ["Cancelled", "Canceled"],
    active: ["Open Queue", "In Progress"],
  }[statusKey];

  if (statuses) {
    params.push(statuses);
    clauses.push(`t.status = ANY($${params.length}::text[])`);
  }

  const result = await db.query(
    `SELECT COUNT(*)::int AS ticket_count
       FROM tickets t
      WHERE ${clauses.length ? clauses.join(" AND ") : "TRUE"}`,
    params
  );
  return Number(result.rows[0]?.ticket_count || 0);
}

async function writeAudit({
  actor,
  question,
  outcome,
  sourceCount = 0,
  providerStatus = null,
  ipAddress = null,
}) {
  await db.query(
    `INSERT INTO ai_assistant_audit
       (user_id,role_name,branch_id,question_preview,outcome,
        source_count,provider_status,ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      actor?.user_id || null,
      actor?.role_name || null,
      actor?.branch_id || null,
      String(question || "").slice(0, 240),
      String(outcome || "unknown").slice(0, 40),
      Number(sourceCount) || 0,
      providerStatus == null ? null : Number(providerStatus),
      ipAddress || null,
    ]
  );
}

module.exports = {
  articleSearchScore,
  countAuthorizedTickets,
  extractSearchTerms,
  getActorContext,
  normalizeRole,
  searchAuthorizedKnowledge,
  writeAudit,
};
