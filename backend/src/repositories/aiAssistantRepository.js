const db = require("../../config/db");
const { addTicketAccessFilter } = require("../routes/_ticketAccess");
const {
  getHardwareAssetAccessFilter,
} = require("../services/hardwareAssetAccessService");
const {
  getEndpointMonitoringAccessFilter,
} = require("../services/endpointMonitoringAccessService");
const softwareLicenseRepository = require("./softwareLicenseRepository");
const {
  getSoftwareLicenseScope,
} = require("../services/softwareLicenseAccessService");

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

async function getAuthorizedHardwareAssetSummary({ actor }) {
  const access = getHardwareAssetAccessFilter({
    role: actor.role_name,
    userId: actor.user_id,
    branchId: actor.branch_id,
  });
  const result = await db.query(
    `WITH scoped_assets AS (
       SELECT
         COALESCE(NULLIF(TRIM(a.status), ''), 'Unspecified') AS status,
         COALESCE(NULLIF(TRIM(a.asset_type), ''), 'Unspecified') AS asset_type
       FROM hardware_assets a
       ${access.whereSql}
     ),
     status_counts AS (
       SELECT status, COUNT(*)::int AS count
       FROM scoped_assets
       GROUP BY status
     ),
     type_counts AS (
       SELECT asset_type, COUNT(*)::int AS count
       FROM scoped_assets
       GROUP BY asset_type
     )
     SELECT
       (SELECT COUNT(*)::int FROM scoped_assets) AS total,
       COALESCE(
         (SELECT jsonb_object_agg(status, count ORDER BY status) FROM status_counts),
         '{}'::jsonb
       ) AS by_status,
       COALESCE(
         (SELECT jsonb_object_agg(asset_type, count ORDER BY asset_type) FROM type_counts),
         '{}'::jsonb
       ) AS by_type`,
    access.params
  );
  const summary = result.rows[0] || {};
  return {
    total: Number(summary.total || 0),
    byStatus: summary.by_status || {},
    byType: summary.by_type || {},
  };
}

async function getAuthorizedEndpointSummary({ actor }) {
  const access = getEndpointMonitoringAccessFilter({
    role: actor.role_name,
    userId: actor.user_id,
    branchId: actor.branch_id,
  });
  const result = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (
         WHERE d.last_seen_at IS NOT NULL
           AND d.last_seen_at >= CURRENT_TIMESTAMP - INTERVAL '120 seconds'
       )::int AS online,
       COUNT(*) FILTER (
         WHERE d.last_seen_at IS NULL
            OR d.last_seen_at < CURRENT_TIMESTAMP - INTERVAL '120 seconds'
       )::int AS offline,
       COUNT(*) FILTER (WHERE d.assigned_user_id IS NOT NULL)::int AS assigned,
       COUNT(*) FILTER (WHERE d.assigned_user_id IS NULL)::int AS unassigned,
       COUNT(*) FILTER (WHERE d.asset_id IS NOT NULL)::int AS linked_to_asset,
       COUNT(*) FILTER (WHERE d.asset_id IS NULL)::int AS unlinked
     FROM monitored_devices d
     ${access.whereSql}`,
    access.params
  );
  const summary = result.rows[0] || {};
  return Object.fromEntries(
    Object.entries(summary).map(([key, value]) => [key, Number(value || 0)])
  );
}

async function getAuthorizedSoftwareLicenses({ actor }) {
  const scope = getSoftwareLicenseScope({
    role: actor.role_name,
    branchId: actor.branch_id,
  });
  if (!scope.authorized) {
    return { authorized: false, licenses: [] };
  }
  const result = await softwareLicenseRepository.list(scope.branchId);
  return { authorized: true, licenses: result.rows };
}

function branchScopedAccess(actor, allowedRoles) {
  const role = normalizeRole(actor.role_name);
  if (!allowedRoles.includes(role)) return { authorized: false, where: "FALSE", params: [] };
  if (role === "superadmin") return { authorized: true, where: "TRUE", params: [] };
  if (!actor.branch_id) return { authorized: false, where: "FALSE", params: [] };
  return { authorized: true, where: "branch_id=$1", params: [Number(actor.branch_id)] };
}

async function getAuthorizedSlaSummary({ actor }) {
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
  clauses.push("t.status NOT IN ('Cancelled','Canceled')");
  const result = await db.query(
    `SELECT COUNT(*)::int total,
       COUNT(*) FILTER (WHERE t.status NOT IN ('Resolved','Closed','Cancelled','Canceled'))::int active,
       COUNT(*) FILTER (WHERE t.response_sla_status='Breached' OR t.resolution_sla_status='Breached')::int breached,
       COUNT(*) FILTER (
         WHERE (t.status IN ('Resolved','Closed') AND t.resolution_sla_status='Met')
            OR (t.status NOT IN ('Resolved','Closed') AND t.response_sla_status='Met')
       )::int met
     FROM tickets t
     WHERE ${clauses.join(" AND ")}`,
    params
  );
  const row = result.rows[0] || {};
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value || 0)])
  );
}

async function getAuthorizedReplacementSummary({ actor }) {
  const role = normalizeRole(actor.role_name);
  const params = [];
  let where = "TRUE";
  if (role === "employee") {
    params.push(Number(actor.user_id));
    where = `rr.employee_id=$${params.length}`;
  } else if (["admin", "technician"].includes(role) && actor.branch_id) {
    params.push(Number(actor.branch_id));
    where = `rr.branch_id=$${params.length}`;
  } else if (role !== "superadmin") {
    return { authorized: false };
  }
  const result = await db.query(
    `SELECT COUNT(*)::int total,
       COUNT(*) FILTER (WHERE rr.status NOT IN ('Completed','Repaired','Rejected','Cancelled'))::int active,
       COUNT(*) FILTER (WHERE rr.status='Awaiting Approval')::int awaiting_approval,
       COUNT(*) FILTER (WHERE rr.status='Repair Recommended')::int repair_recommended,
       COUNT(*) FILTER (WHERE rr.status='In Repair')::int in_repair,
       COUNT(*) FILTER (WHERE rr.status='Repaired')::int repaired,
       COUNT(*) FILTER (WHERE rr.status='Completed')::int completed
     FROM replacement_requests rr WHERE ${where}`,
    params
  );
  return { authorized: true, ...result.rows[0] };
}

async function getAuthorizedLifecycleSummary({ actor }) {
  const access = branchScopedAccess(actor, ["superadmin", "admin", "hr"]);
  if (!access.authorized) return { authorized: false };
  const where = access.where.replace(/\bbranch_id\b/g, "lc.branch_id");
  const result = await db.query(
    `SELECT COUNT(*)::int total,
       COUNT(*) FILTER (WHERE lc.lifecycle_type='Onboarding' AND lc.status NOT IN ('Completed','Cancelled'))::int active_onboarding,
       COUNT(*) FILTER (WHERE lc.lifecycle_type='Offboarding' AND lc.status NOT IN ('Completed','Cancelled'))::int active_offboarding,
       COUNT(*) FILTER (WHERE lc.status='Ready for Verification')::int ready_for_verification,
       COUNT(*) FILTER (WHERE lc.status='Completed')::int completed
     FROM employee_lifecycle_cases lc
     WHERE lc.deleted_at IS NULL AND ${where}`,
    access.params
  );
  return { authorized: true, ...result.rows[0] };
}

async function getAuthorizedCmdbSummary({ actor }) {
  const access = branchScopedAccess(actor, ["superadmin", "admin", "technician"]);
  if (!access.authorized) return { authorized: false };
  const where = access.where.replace(/\bbranch_id\b/g, "ci.branch_id");
  const result = await db.query(
    `SELECT COUNT(*)::int total,
       COUNT(*) FILTER (WHERE LOWER(COALESCE(ci.status,''))='active')::int active,
       COUNT(DISTINCT ci.ci_type)::int types,
       COUNT(*) FILTER (WHERE LOWER(COALESCE(ci.environment,''))='production')::int production
     FROM config_items ci WHERE ${where}`,
    access.params
  );
  return { authorized: true, ...result.rows[0] };
}

async function getAuthorizedProjectSummary({ actor }) {
  const access = branchScopedAccess(actor, ["superadmin", "admin"]);
  if (!access.authorized) return { authorized: false };
  const where = access.where.replace(/\bbranch_id\b/g, "p.branch_id");
  const result = await db.query(
    `SELECT COUNT(*)::int total,
       COUNT(*) FILTER (WHERE LOWER(p.status)='on track')::int on_track,
       COUNT(*) FILTER (WHERE LOWER(p.status)='at risk')::int at_risk,
       COUNT(*) FILTER (WHERE LOWER(p.status)='delayed')::int delayed,
       COUNT(*) FILTER (WHERE LOWER(p.status)='completed')::int completed
     FROM it_projects p WHERE p.is_active=true AND ${where}`,
    access.params
  );
  return { authorized: true, ...result.rows[0] };
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
  getAuthorizedHardwareAssetSummary,
  getAuthorizedEndpointSummary,
  getAuthorizedSoftwareLicenses,
  getAuthorizedSlaSummary,
  getAuthorizedReplacementSummary,
  getAuthorizedLifecycleSummary,
  getAuthorizedCmdbSummary,
  getAuthorizedProjectSummary,
  getActorContext,
  normalizeRole,
  searchAuthorizedKnowledge,
  writeAudit,
};
