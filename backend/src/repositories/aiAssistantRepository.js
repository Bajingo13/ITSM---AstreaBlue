const db = require("../../config/db");

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
  params.push(Math.min(Math.max(Number(limit) || 5, 1), 8));

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
  return result.rows;
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
  extractSearchTerms,
  getActorContext,
  normalizeRole,
  searchAuthorizedKnowledge,
  writeAudit,
};
