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
const {
  getDiscoveryVerification,
} = require("../services/assetDiscoveryInventoryService");
const {
  calculateStraightLine,
} = require("../services/assetFinancialService");
const { buildEndpointHealth } = require("../services/endpointHealthService");

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

  const params = [terms.map((term) => term.split("-").join(" & ")).join(" | ")];
  const where = [
    "LOWER(COALESCE(kb.publication_status, 'Published')) = 'published'",
    "document.search_vector @@ document.search_query",
  ];
  if (!isSuperAdmin) {
    params.push(actor.branch_id);
    where.push(`kb.branch_id=$${params.length}`);
  }
  const resultLimit = Math.min(Math.max(Number(limit) || 5, 1), 8);
  params.push(Math.max(resultLimit * 2, 10));

  const result = await db.query(
    `SELECT kb.kb_id,kb.title,kb.category,kb.tags,kb.symptoms,
            kb.resolution,kb.updated_at,b.branch_name,
            ts_rank_cd(document.search_vector, document.search_query, 32) AS relevance_score
     FROM knowledge_base kb
     LEFT JOIN branches b ON b.branch_id=kb.branch_id
     CROSS JOIN LATERAL (
       SELECT
         (
           setweight(to_tsvector('english', COALESCE(kb.title, '')), 'A') ||
           setweight(to_tsvector('english', COALESCE(kb.category, '') || ' ' || COALESCE(kb.tags, '')), 'B') ||
           setweight(to_tsvector('english', COALESCE(kb.symptoms, '') || ' ' || COALESCE(kb.resolution, '')), 'C')
         ) AS search_vector,
         to_tsquery('english', $1) AS search_query
     ) document
     WHERE ${where.join(" AND ")}
     ORDER BY relevance_score DESC,kb.updated_at DESC,kb.kb_id DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows
    .map((article) => ({
      article,
      score: articleSearchScore(article, terms),
      rank: Number(article.relevance_score || 0),
    }))
    .filter(({ score, rank }) => score >= 3 && rank > 0)
    .sort((left, right) => right.rank - left.rank || right.score - left.score)
    .slice(0, resultLimit)
    .map(({ article }) => {
      const { relevance_score, ...publicArticle } = article;
      return publicArticle;
    });
}

async function writeFeedback({
  actor,
  question,
  responseMode = null,
  helpful,
}) {
  const result = await db.query(
    `INSERT INTO ai_assistant_feedback
       (user_id,role_name,branch_id,question_preview,response_mode,helpful)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING feedback_id,helpful,created_at`,
    [
      actor?.user_id || null,
      actor?.role_name || null,
      actor?.branch_id || null,
      String(question || "").slice(0, 240),
      responseMode == null ? null : String(responseMode).slice(0, 40),
      Boolean(helpful),
    ]
  );
  return result.rows[0];
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

async function getAuthorizedAssetDiscoverySummary({ actor, queryable = db }) {
  const access = branchScopedAccess(actor, ["superadmin", "admin"]);
  if (!access.authorized) return { authorized: false };

  const where = access.where.replace(/\bbranch_id\b/g, "d.branch_id");
  const result = await queryable.query(
    `SELECT d.reconciliation_status,d.status,d.matched_asset_id,
            d.serial_number,d.manufacturer,d.asset_tag,d.hostname,d.raw_data,
            a.asset_tag matched_asset_tag,
            a.serial_number matched_asset_serial_number,
            COALESCE(NULLIF(a.manufacturer,''),a.brand) matched_asset_manufacturer,
            a.hostname matched_asset_hostname,
            COALESCE(rec.match_count,0) reconciliation_match_count,
            COALESCE(rec.mismatch_count,0) reconciliation_mismatch_count,
            COALESCE(rec.unknown_count,0) reconciliation_unknown_count
       FROM asset_discoveries d
       LEFT JOIN hardware_assets a ON a.asset_id=d.matched_asset_id
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) FILTER (WHERE LOWER(r.status)='match')::INTEGER match_count,
           COUNT(*) FILTER (WHERE LOWER(r.status)='mismatch')::INTEGER mismatch_count,
           COUNT(*) FILTER (WHERE LOWER(r.status) NOT IN ('match','mismatch'))::INTEGER unknown_count
         FROM asset_inventory_reconciliation r
         WHERE r.asset_id=d.matched_asset_id
           AND r.field_name IN ('serial_number','manufacturer','model')
           AND COALESCE(d.raw_data->>'device_id','') ~ '^[0-9]+$'
           AND r.device_id=(d.raw_data->>'device_id')::INTEGER
       ) rec ON TRUE
      WHERE ${where}`,
    access.params
  );

  const summary = {
    authorized: true,
    total: result.rows.length,
    matched: 0,
    mismatched: 0,
    pending_verification: 0,
    unmanaged: 0,
    duplicates: 0,
    offline: 0,
    linked: 0,
    unlinked: 0,
  };

  for (const discovery of result.rows) {
    const verification = getDiscoveryVerification(discovery);
    const statusKey = String(verification.status || "")
      .toLowerCase()
      .replace(/\s+/g, "_");
    if (statusKey === "matched") summary.matched += 1;
    else if (statusKey === "mismatched") summary.mismatched += 1;
    else if (statusKey === "pending_verification") summary.pending_verification += 1;
    else if (statusKey === "duplicate") summary.duplicates += 1;
    else summary.unmanaged += 1;

    if (String(discovery.status || "").toLowerCase() === "offline") {
      summary.offline += 1;
    }
    if (discovery.matched_asset_id) summary.linked += 1;
    else summary.unlinked += 1;
  }

  return summary;
}

function matchesFinanceFilter(asset, filters = {}) {
  const comparable = (value) => String(value || "").trim().toLowerCase();
  if (filters.assetType && comparable(asset.asset_type) !== comparable(filters.assetType)) {
    return false;
  }
  if (filters.status && comparable(asset.status) !== comparable(filters.status)) {
    return false;
  }
  return true;
}

async function getAuthorizedAssetFinanceSummary({
  actor,
  filters = {},
  queryable = db,
  asOf = new Date(),
}) {
  const access = branchScopedAccess(actor, ["superadmin", "admin"]);
  if (!access.authorized) return { authorized: false };

  const where = access.where.replace(/\bbranch_id\b/g, "a.branch_id");
  const result = await queryable.query(
    `SELECT a.asset_id,a.asset_tag,a.asset_name,a.asset_type,a.status,
            a.purchase_date,a.purchase_price,a.warranty_expiration,a.branch_id,
            b.branch_name,
            COALESCE(f.useful_life_months,a.useful_life_months,
                     ROUND(f.useful_life_years * 12),
                     ROUND(a.useful_life_years * 12),36) useful_life_months,
            COALESCE(f.useful_life_years,a.useful_life_years,3) useful_life_years,
            COALESCE(f.salvage_value,a.salvage_value,0) salvage_value,
            COALESCE(f.depreciation_method,a.depreciation_method,'Straight-Line') depreciation_method,
            COALESCE(f.depreciation_start_date,a.purchase_date) depreciation_start_date
       FROM hardware_assets a
       LEFT JOIN asset_financials f ON f.asset_id=a.asset_id
       LEFT JOIN branches b ON b.branch_id=a.branch_id
      WHERE ${where}
      ORDER BY a.asset_id`,
    access.params
  );

  const assets = result.rows
    .filter((asset) => matchesFinanceFilter(asset, filters))
    .map((asset) => ({ ...asset, ...calculateStraightLine(asset, asOf) }));
  const depreciableAssets = assets.filter((asset) => asset.is_depreciable);
  const sum = (field) => depreciableAssets.reduce(
    (total, asset) => total + Number(asset[field] || 0),
    0
  );
  const startOfDay = new Date(asOf);
  startOfDay.setHours(0, 0, 0, 0);
  const warrantyWindowEnd = new Date(startOfDay);
  warrantyWindowEnd.setDate(warrantyWindowEnd.getDate() + 30);
  const warrantyDate = (asset) => {
    if (!asset.warranty_expiration) return null;
    const parsed = new Date(asset.warranty_expiration);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  return {
    authorized: true,
    filters: {
      asset_type: filters.assetType || null,
      status: filters.status || null,
    },
    total_assets: assets.length,
    depreciable_assets: depreciableAssets.length,
    expense_items: assets.filter((asset) => !asset.is_depreciable).length,
    total_asset_value: sum("purchase_cost"),
    current_book_value: sum("current_book_value"),
    accumulated_depreciation: sum("accumulated_depreciation"),
    monthly_depreciation_expense: sum("monthly_depreciation"),
    fully_depreciated_assets: depreciableAssets.filter((asset) => asset.fully_depreciated).length,
    assets_near_end_of_life: depreciableAssets.filter((asset) =>
      ["Near End of Life", "Critical", "End of Life"].includes(asset.lifespan_status)
    ).length,
    end_of_life_assets: depreciableAssets.filter(
      (asset) => asset.lifespan_status === "End of Life"
    ).length,
    warranties_expired: assets.filter((asset) => {
      const date = warrantyDate(asset);
      return date && date < startOfDay;
    }).length,
    warranties_expiring_30_days: assets.filter((asset) => {
      const date = warrantyDate(asset);
      return date && date >= startOfDay && date <= warrantyWindowEnd;
    }).length,
    missing_financial_information: assets.filter(
      (asset) => !asset.purchase_date || asset.purchase_price == null
    ).length,
  };
}

function getConsentAccess(actor) {
  const role = normalizeRole(actor.role_name);
  if (role === "employee") {
    return actor.user_id
      ? { authorized: true, where: "cd.employee_id=$1", params: [Number(actor.user_id)] }
      : { authorized: false, where: "FALSE", params: [] };
  }
  if (role === "admin") {
    return actor.branch_id
      ? { authorized: true, where: "cd.branch_id=$1", params: [Number(actor.branch_id)] }
      : { authorized: false, where: "FALSE", params: [] };
  }
  if (["superadmin", "hr"].includes(role)) {
    return { authorized: true, where: "TRUE", params: [] };
  }
  return { authorized: false, where: "FALSE", params: [] };
}

async function getAuthorizedConsentSummary({ actor, queryable = db }) {
  const access = getConsentAccess(actor);
  if (!access.authorized) return { authorized: false };

  const result = await queryable.query(
    `SELECT
       COUNT(*)::int total,
       COUNT(DISTINCT cd.employee_id)::int employees,
       COUNT(*) FILTER (
         WHERE LOWER(cd.status) IN ('approved','signed')
           AND cd.active IS NOT FALSE
       )::int approved,
       COUNT(*) FILTER (
         WHERE LOWER(cd.status) IN ('draft','pending','pending_employee')
       )::int awaiting_employee,
       COUNT(*) FILTER (
         WHERE LOWER(cd.status) IN ('submitted','pending_approval')
       )::int awaiting_approval,
       COUNT(*) FILTER (WHERE LOWER(cd.status)='revision_requested')::int revision_requested,
       COUNT(*) FILTER (WHERE LOWER(cd.status)='rejected')::int rejected,
       COUNT(*) FILTER (WHERE LOWER(cd.status)='withdrawn')::int withdrawn,
       COUNT(*) FILTER (WHERE LOWER(cd.status)='expired')::int expired,
       COUNT(*) FILTER (WHERE LOWER(cd.status)='superseded')::int superseded,
       COUNT(*) FILTER (WHERE cd.device_uuid IS NULL)::int general,
       COUNT(*) FILTER (WHERE cd.device_uuid IS NOT NULL)::int device_specific
     FROM consent_documents cd
     WHERE ${access.where}`,
    access.params
  );
  return { authorized: true, ...(result.rows[0] || {}) };
}

function getEndpointPolicyAccess(actor) {
  const role = normalizeRole(actor.role_name);
  if (role === "superadmin") {
    return { authorized: true, where: "TRUE", params: [] };
  }
  if (["admin", "technician"].includes(role) && actor.branch_id) {
    return {
      authorized: true,
      where: "d.branch_id=$1",
      params: [Number(actor.branch_id)],
    };
  }
  return { authorized: false, where: "FALSE", params: [] };
}

async function getAuthorizedEndpointPolicySummary({ actor, queryable = db }) {
  const access = getEndpointPolicyAccess(actor);
  if (!access.authorized) return { authorized: false };

  const result = await queryable.query(
    `SELECT
       COUNT(*)::int total_devices,
       COUNT(*) FILTER (WHERE d.assigned_user_id IS NOT NULL)::int assigned_devices,
       COUNT(*) FILTER (WHERE d.assigned_user_id IS NULL)::int unassigned_devices,
       COUNT(*) FILTER (WHERE ep.device_uuid IS NOT NULL)::int generated_policies,
       COUNT(*) FILTER (WHERE ep.device_uuid IS NULL)::int policies_not_generated,
       COUNT(*) FILTER (
         WHERE ep.device_uuid IS NOT NULL
           AND d.last_policy_sync_at IS NOT NULL
           AND d.last_policy_sync_at >= ep.generated_at
       )::int policies_downloaded,
       COUNT(*) FILTER (
         WHERE ep.device_uuid IS NOT NULL
           AND (d.last_policy_sync_at IS NULL OR d.last_policy_sync_at < ep.generated_at)
       )::int policies_pending_download,
       COUNT(*) FILTER (WHERE consent.consent_id IS NOT NULL)::int consent_approved_devices,
       COUNT(*) FILTER (
         WHERE d.assigned_user_id IS NOT NULL AND consent.consent_id IS NULL
       )::int devices_without_approved_consent,
       COUNT(*) FILTER (
         WHERE COALESCE((ep.policy_json->>'activity_monitoring_enabled')::boolean,false)
       )::int activity_enabled,
       COUNT(*) FILTER (
         WHERE COALESCE((ep.policy_json->>'screenshot_monitoring_enabled')::boolean,false)
       )::int screenshot_enabled,
       COUNT(*) FILTER (
         WHERE COALESCE((ep.policy_json->>'usb_monitoring_enabled')::boolean,false)
       )::int usb_enabled,
       COUNT(*) FILTER (
         WHERE COALESCE((ep.policy_json->>'browser_monitoring_enabled')::boolean,false)
       )::int browser_enabled,
       COUNT(*) FILTER (
         WHERE COALESCE((ep.policy_json->>'location_tracking_enabled')::boolean,false)
       )::int location_enabled
     FROM monitored_devices d
     LEFT JOIN endpoint_effective_policies ep ON ep.device_uuid=d.device_uuid
     LEFT JOIN LATERAL (
       SELECT cd.consent_id
       FROM consent_documents cd
       WHERE cd.employee_id=d.assigned_user_id
         AND (cd.device_uuid=d.device_uuid OR cd.device_uuid IS NULL)
         AND LOWER(cd.status) IN ('approved','signed')
         AND cd.active IS NOT FALSE
       ORDER BY (cd.device_uuid IS NOT NULL) DESC,
                cd.approved_at DESC NULLS LAST,
                cd.signed_at DESC NULLS LAST,
                cd.consent_id DESC
       LIMIT 1
     ) consent ON TRUE
     WHERE ${access.where}`,
    access.params
  );
  return { authorized: true, ...(result.rows[0] || {}) };
}

async function getAuthorizedSlaSummary({ actor, queryable = db, now = new Date() }) {
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
  const result = await queryable.query(
    `SELECT t.status,t.created_at,t.first_response_at,t.resolved_at,t.closed_at,
            t.response_due_at,t.resolution_due_at,
            t.response_sla_status,t.resolution_sla_status
       FROM tickets t
      WHERE ${clauses.join(" AND ")}`,
    params
  );

  const summary = {
    authorized: true,
    total: result.rows.length,
    active: 0,
    due_soon: 0,
    met: 0,
    breached: 0,
    pending: 0,
    compliance_percent: 100,
    avg_response_time_minutes: 0,
    avg_resolution_time_minutes: 0,
  };
  let responseMinutes = 0;
  let responseCount = 0;
  let resolutionMinutes = 0;
  let resolutionCount = 0;

  for (const ticket of result.rows) {
    const resolved = ["Resolved", "Closed"].includes(ticket.status);
    const active = !["Resolved", "Closed", "Cancelled", "Canceled"].includes(ticket.status);
    const breached =
      ticket.response_sla_status === "Breached" ||
      ticket.resolution_sla_status === "Breached";
    const met = resolved
      ? ticket.resolution_sla_status === "Met"
      : ticket.response_sla_status === "Met";

    if (active) summary.active += 1;
    if (breached) summary.breached += 1;
    else if (met) summary.met += 1;
    else summary.pending += 1;

    if (active && !breached) {
      const responseRemaining = !ticket.first_response_at && ticket.response_due_at
        ? (new Date(ticket.response_due_at).getTime() - now.getTime()) / 60000
        : null;
      const resolutionRemaining = !ticket.resolved_at && ticket.resolution_due_at
        ? (new Date(ticket.resolution_due_at).getTime() - now.getTime()) / 60000
        : null;
      if (
        (responseRemaining > 0 && responseRemaining <= 240) ||
        (resolutionRemaining > 0 && resolutionRemaining <= 240)
      ) {
        summary.due_soon += 1;
      }
    }

    if (ticket.first_response_at && ticket.created_at) {
      responseMinutes +=
        (new Date(ticket.first_response_at).getTime() -
          new Date(ticket.created_at).getTime()) /
        60000;
      responseCount += 1;
    }
    const completedAt = ticket.resolved_at || ticket.closed_at;
    if (resolved && completedAt && ticket.created_at) {
      resolutionMinutes +=
        (new Date(completedAt).getTime() - new Date(ticket.created_at).getTime()) /
        60000;
      resolutionCount += 1;
    }
  }

  const completedTargets = summary.met + summary.breached;
  summary.compliance_percent = completedTargets
    ? Math.round((summary.met / completedTargets) * 100)
    : 100;
  summary.avg_response_time_minutes = responseCount
    ? Math.round(responseMinutes / responseCount)
    : 0;
  summary.avg_resolution_time_minutes = resolutionCount
    ? Math.round(resolutionMinutes / resolutionCount)
    : 0;
  return summary;
}

async function getAuthorizedReplacementSummary({ actor, queryable = db }) {
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
  const result = await queryable.query(
    `SELECT COUNT(*)::int total,
       COUNT(*) FILTER (WHERE rr.status NOT IN ('Completed','Repaired','Rejected','Cancelled'))::int active,
       COUNT(*) FILTER (WHERE rr.status='Submitted')::int submitted,
       COUNT(*) FILTER (WHERE rr.status='Under Assessment')::int under_assessment,
       COUNT(*) FILTER (WHERE rr.status='Awaiting Approval')::int awaiting_approval,
       COUNT(*) FILTER (WHERE rr.status='Approved')::int approved,
       COUNT(*) FILTER (WHERE rr.status='Replacement Reserved')::int reserved,
       COUNT(*) FILTER (WHERE rr.status='Issued')::int issued,
       COUNT(*) FILTER (WHERE rr.status='Repair Recommended')::int repair_recommended,
       COUNT(*) FILTER (WHERE rr.status='In Repair')::int in_repair,
       COUNT(*) FILTER (WHERE rr.status='Repaired')::int repaired,
       COUNT(*) FILTER (WHERE rr.status='Completed')::int completed,
       COUNT(*) FILTER (WHERE rr.status='Rejected')::int rejected,
       COUNT(*) FILTER (WHERE rr.status='Cancelled')::int cancelled
     FROM replacement_requests rr WHERE ${where}`,
    params
  );
  return { authorized: true, ...result.rows[0] };
}

async function getAuthorizedLifecycleSummary({ actor, queryable = db }) {
  const access = branchScopedAccess(actor, ["superadmin", "admin", "hr"]);
  if (!access.authorized) return { authorized: false };
  const where = access.where.replace(/\bbranch_id\b/g, "lc.branch_id");
  const result = await queryable.query(
    `WITH scoped_cases AS (
       SELECT lc.lifecycle_case_id,lc.lifecycle_type,lc.status
         FROM employee_lifecycle_cases lc
        WHERE lc.deleted_at IS NULL AND ${where}
     ),
     pending_tasks AS (
       SELECT lt.lifecycle_case_id,
              COUNT(*) FILTER (WHERE lt.is_required AND lt.status='Pending')::int required_pending
         FROM employee_lifecycle_tasks lt
         JOIN scoped_cases sc ON sc.lifecycle_case_id=lt.lifecycle_case_id
        GROUP BY lt.lifecycle_case_id
     )
     SELECT
       COUNT(*)::int total,
       COUNT(*) FILTER (WHERE sc.lifecycle_type='Onboarding')::int onboarding_total,
       COUNT(*) FILTER (WHERE sc.lifecycle_type='Offboarding')::int offboarding_total,
       COUNT(*) FILTER (
         WHERE sc.lifecycle_type='Onboarding'
           AND sc.status NOT IN ('Completed','Cancelled')
       )::int active_onboarding,
       COUNT(*) FILTER (
         WHERE sc.lifecycle_type='Offboarding'
           AND sc.status NOT IN ('Completed','Cancelled')
       )::int active_offboarding,
       COUNT(*) FILTER (WHERE sc.status='Draft')::int draft,
       COUNT(*) FILTER (WHERE sc.status='In Progress')::int in_progress,
       COUNT(*) FILTER (WHERE sc.status='Awaiting Employee')::int awaiting_employee,
       COUNT(*) FILTER (WHERE sc.status='Awaiting IT')::int awaiting_administrator,
       COUNT(*) FILTER (WHERE sc.status='Ready for Verification')::int ready_for_verification,
       COUNT(*) FILTER (WHERE sc.status='Completed')::int completed,
       COUNT(*) FILTER (WHERE sc.status='Cancelled')::int cancelled,
       COUNT(*) FILTER (WHERE COALESCE(pt.required_pending,0)>0)::int cases_with_pending_tasks,
       COALESCE(SUM(COALESCE(pt.required_pending,0)),0)::int required_pending_tasks
     FROM scoped_cases sc
     LEFT JOIN pending_tasks pt ON pt.lifecycle_case_id=sc.lifecycle_case_id`,
    access.params
  );
  return { authorized: true, ...result.rows[0] };
}

function getEndpointHealthAccess(actor) {
  const role = normalizeRole(actor.role_name);
  if (role === "superadmin") {
    return { authorized: true, whereSql: "", params: [] };
  }
  if (["admin", "technician"].includes(role) && actor.branch_id) {
    return {
      authorized: true,
      whereSql: "WHERE d.branch_id=$1",
      params: [Number(actor.branch_id)],
    };
  }
  return { authorized: false, whereSql: "WHERE 1=0", params: [] };
}

async function getAuthorizedEndpointHealthSummary({ actor, queryable = db }) {
  const access = getEndpointHealthAccess(actor);
  if (!access.authorized) return { authorized: false };

  const result = await queryable.query(
    `SELECT d.*,u.full_name assigned_employee,
            COALESCE(d.department,u.department) department,b.branch_name,
            COALESCE(consent.status,d.consent_status) consent_status,
            consent.consent_id,consent.consent_version,
            EXISTS (
              SELECT 1 FROM consent_documents submitted_consent
               WHERE submitted_consent.employee_id=d.assigned_user_id
                 AND submitted_consent.status IN ('pending_approval','approved','signed')
                 AND submitted_consent.submitted_at IS NOT NULL
            ) consent_submitted,
            EXISTS (
              SELECT 1 FROM consent_documents approved_consent
               WHERE approved_consent.employee_id=d.assigned_user_id
                 AND (
                   d.device_uuid IS NULL
                   OR approved_consent.device_uuid=d.device_uuid
                   OR approved_consent.device_uuid IS NULL
                 )
                 AND approved_consent.status IN ('approved','signed')
                 AND approved_consent.active IS NOT FALSE
            ) consent_approved,
            activity.last_activity_at,activity.last_idle_detection_at,
            hardware.last_hardware_inventory_at,hardware.os_build,hardware.windows_version,
            software.last_software_inventory_at,
            ep.generated_at policy_generated_at,
            ep.policy_json->>'policy_version' current_policy_version,
            ep.policy_json,
            NULL::text last_api_response,NULL::text last_error
       FROM monitored_devices d
       LEFT JOIN users u ON u.user_id=d.assigned_user_id
       LEFT JOIN branches b ON b.branch_id=d.branch_id
       LEFT JOIN endpoint_effective_policies ep ON ep.device_uuid=d.device_uuid
       LEFT JOIN LATERAL (
         SELECT cd.status,cd.consent_id::text consent_id,cd.consent_version
           FROM consent_documents cd
          WHERE cd.employee_id=d.assigned_user_id
            AND (cd.device_uuid=d.device_uuid OR cd.device_uuid IS NULL)
          ORDER BY (cd.device_uuid IS NOT NULL) DESC,
                   cd.approved_at DESC NULLS LAST,
                   cd.signed_at DESC NULLS LAST,
                   cd.created_at DESC
          LIMIT 1
       ) consent ON TRUE
       LEFT JOIN LATERAL (
         SELECT
           MAX(al.occurred_at) FILTER (
             WHERE al.event_type IS DISTINCT FROM 'system_audit'
           ) last_activity_at,
           MAX(al.occurred_at) FILTER (
             WHERE al.event_type IS DISTINCT FROM 'system_audit'
               AND al.idle_seconds IS NOT NULL
           ) last_idle_detection_at
           FROM laptop_activity_logs al
          WHERE al.device_id=d.device_id
       ) activity ON TRUE
       LEFT JOIN LATERAL (
         SELECT hi.scanned_at last_hardware_inventory_at,hi.os_build,
                CONCAT_WS(' ',hi.os_name,hi.os_version) windows_version
           FROM endpoint_hardware_inventory hi
          WHERE hi.device_id=d.device_id
          ORDER BY hi.scanned_at DESC
          LIMIT 1
       ) hardware ON TRUE
       LEFT JOIN LATERAL (
         SELECT MAX(si.last_seen_at) last_software_inventory_at
           FROM endpoint_software_inventory si
          WHERE si.device_id=d.device_id
       ) software ON TRUE
       ${access.whereSql}`,
    access.params
  );

  const endpoints = result.rows.map(buildEndpointHealth);
  const count = (predicate) => endpoints.filter(predicate).length;
  return {
    authorized: true,
    registered_endpoints: endpoints.length,
    healthy: count((item) => item.overall_health === "Healthy"),
    warning: count((item) => item.overall_health === "Warning"),
    critical: count((item) => item.overall_health === "Critical"),
    offline: count((item) => item.overall_health === "Offline"),
    requiring_attention: count((item) => item.overall_health !== "Healthy"),
    heartbeat_healthy: count((item) => item.heartbeat.status === "Healthy"),
    activity_healthy: count((item) => item.activity.status === "Healthy"),
    hardware_inventory_healthy: count(
      (item) => item.hardware_inventory.status === "Healthy"
    ),
    software_inventory_healthy: count(
      (item) => item.software_inventory.status === "Healthy"
    ),
    policy_sync_healthy: count((item) => item.policy.status === "Healthy"),
    consent_active: count((item) => item.consent.status === "Healthy"),
    monitoring_active: count((item) =>
      item.checklist.some(
        (step) => step.step === "Monitoring Active" && step.status === "Complete"
      )
    ),
  };
}

function classifyChangeImpact(affectedIds, productionIds) {
  const affected = affectedIds.size;
  const production = productionIds.size;
  if (affected >= 10 || production >= 5) return "critical";
  if (affected >= 5 || production >= 2) return "high";
  if (affected >= 2 || production >= 1) return "medium";
  return "low";
}

function summarizeCmdbGraph(items, dependencies) {
  const itemById = new Map(items.map((item) => [Number(item.ci_id), item]));
  const scopedDependencies = dependencies.filter((dependency) =>
    itemById.has(Number(dependency.source_ci_id))
    && itemById.has(Number(dependency.target_ci_id))
  );
  const reverseGraph = new Map();
  const connected = new Set();

  scopedDependencies.forEach((dependency) => {
    const sourceId = Number(dependency.source_ci_id);
    const targetId = Number(dependency.target_ci_id);
    if (!itemById.has(sourceId) || !itemById.has(targetId)) return;
    if (!reverseGraph.has(targetId)) reverseGraph.set(targetId, new Set());
    reverseGraph.get(targetId).add(sourceId);
    connected.add(sourceId);
    connected.add(targetId);
  });

  const impactCounts = { low: 0, medium: 0, high: 0, critical: 0 };
  items.forEach((item) => {
    const affectedIds = new Set();
    const productionIds = new Set();
    const queue = [...(reverseGraph.get(Number(item.ci_id)) || [])];
    while (queue.length) {
      const affectedId = queue.shift();
      if (affectedIds.has(affectedId)) continue;
      affectedIds.add(affectedId);
      const affected = itemById.get(affectedId);
      if (String(affected?.environment || "").toLowerCase() === "production") {
        productionIds.add(affectedId);
      }
      (reverseGraph.get(affectedId) || []).forEach((nextId) => {
        if (!affectedIds.has(nextId)) queue.push(nextId);
      });
    }
    impactCounts[classifyChangeImpact(affectedIds, productionIds)] += 1;
  });

  const typeCounts = {};
  const relationshipCounts = {};
  items.forEach((item) => {
    const type = String(item.ci_type || "Unspecified").trim() || "Unspecified";
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  });
  scopedDependencies.forEach((dependency) => {
    const type = String(dependency.relationship_type || "Linked To").trim() || "Linked To";
    relationshipCounts[type] = (relationshipCounts[type] || 0) + 1;
  });

  return {
    authorized: true,
    total: items.length,
    active: items.filter((item) => String(item.status || "").toLowerCase() === "active").length,
    inactive: items.filter((item) => String(item.status || "").toLowerCase() !== "active").length,
    production: items.filter((item) => String(item.environment || "").toLowerCase() === "production").length,
    non_production: items.filter((item) => String(item.environment || "").toLowerCase() !== "production").length,
    types: Object.keys(typeCounts).length,
    by_type: typeCounts,
    relationships: scopedDependencies.length,
    by_relationship: relationshipCounts,
    connected: connected.size,
    isolated: Math.max(items.length - connected.size, 0),
    impact_low: impactCounts.low,
    impact_medium: impactCounts.medium,
    impact_high: impactCounts.high,
    impact_critical: impactCounts.critical,
  };
}

async function getAuthorizedCmdbSummary({ actor, queryable = db }) {
  const access = branchScopedAccess(actor, ["superadmin", "admin", "technician"]);
  if (!access.authorized) return { authorized: false };
  const itemWhere = access.where.replace(/\bbranch_id\b/g, "ci.branch_id");
  const dependencyWhere = normalizeRole(actor.role_name) === "superadmin"
    ? "TRUE"
    : "(src.branch_id=$1 OR tgt.branch_id=$1)";
  const [itemResult, dependencyResult] = await Promise.all([
    queryable.query(
      `SELECT ci.ci_id,ci.ci_name,ci.ci_type,ci.status,ci.environment,ci.branch_id
         FROM config_items ci
        WHERE ${itemWhere}`,
      access.params
    ),
    queryable.query(
      `SELECT d.source_ci_id,d.target_ci_id,d.relationship_type
         FROM ci_dependencies d
         JOIN config_items src ON src.ci_id=d.source_ci_id
         JOIN config_items tgt ON tgt.ci_id=d.target_ci_id
        WHERE ${dependencyWhere}`,
      access.params
    ),
  ]);
  return summarizeCmdbGraph(itemResult.rows, dependencyResult.rows);
}

async function getAuthorizedProjectSummary({ actor, queryable = db }) {
  const access = branchScopedAccess(actor, ["superadmin", "admin"]);
  if (!access.authorized) return { authorized: false };
  const where = access.where.replace(/\bbranch_id\b/g, "p.branch_id");
  const [projectResult, milestoneResult, riskResult, resourceResult] = await Promise.all([
    queryable.query(
      `SELECT p.project_id,p.status,p.planned_finish_date,p.projected_finish_date,
              p.planned_completion_pct,p.actual_completion_pct,p.health_score,
              p.forecast_confidence,p.budget,p.planned_value,p.earned_value,p.actual_cost
         FROM it_projects p
        WHERE p.is_active=true AND ${where}`,
      access.params
    ),
    queryable.query(
      `SELECT m.status,m.due_date,m.completed_at
         FROM it_project_milestones m
         JOIN it_projects p ON p.project_id=m.project_id
        WHERE p.is_active=true AND ${where}`,
      access.params
    ),
    queryable.query(
      `SELECT r.severity,r.status
         FROM it_project_risks r
         JOIN it_projects p ON p.project_id=r.project_id
        WHERE p.is_active=true AND ${where}`,
      access.params
    ),
    queryable.query(
      `SELECT COALESCE(SUM(r.allocation_pct),0) allocated,
              COALESCE(SUM(GREATEST(r.capacity_pct-r.allocation_pct,0)),0) available,
              COUNT(*)::int resource_count
         FROM it_project_resources r
         JOIN it_projects p ON p.project_id=r.project_id
        WHERE p.is_active=true AND ${where}`,
      access.params
    ),
  ]);

  const projects = projectResult.rows;
  const milestones = milestoneResult.rows;
  const openRisks = riskResult.rows.filter(
    (risk) => String(risk.status || "").toLowerCase() !== "resolved"
  );
  const countStatus = (status) => projects.filter(
    (project) => String(project.status || "").toLowerCase() === status
  ).length;
  const completedMilestones = milestones.filter(
    (milestone) => milestone.completed_at
      || String(milestone.status || "").toLowerCase() === "completed"
  ).length;
  const overdueMilestones = milestones.filter((milestone) =>
    !milestone.completed_at
    && milestone.due_date
    && new Date(milestone.due_date).getTime() < Date.now()
  ).length;
  const allocated = Number(resourceResult.rows[0]?.allocated || 0);
  const available = Number(resourceResult.rows[0]?.available || 0);
  const totalBudget = projects.reduce((sum, project) => sum + Number(project.budget || 0), 0);
  const totalActualCost = projects.reduce((sum, project) => sum + Number(project.actual_cost || 0), 0);

  return {
    authorized: true,
    total: projects.length,
    on_track: countStatus("on track"),
    at_risk: countStatus("at risk"),
    delayed: countStatus("delayed"),
    completed: countStatus("completed"),
    average_completion_percent: projects.length
      ? Math.round(projects.reduce(
        (sum, project) => sum + Number(project.actual_completion_pct || 0),
        0
      ) / projects.length)
      : 0,
    average_health_score: projects.length
      ? Number((projects.reduce(
        (sum, project) => sum + Number(project.health_score || 0),
        0
      ) / projects.length).toFixed(1))
      : 0,
    total_budget: totalBudget,
    actual_cost: totalActualCost,
    budget_variance: totalBudget - totalActualCost,
    over_budget: projects.filter(
      (project) => Number(project.actual_cost || 0) > Number(project.budget || 0)
    ).length,
    milestones_total: milestones.length,
    milestones_completed: completedMilestones,
    milestones_remaining: Math.max(milestones.length - completedMilestones, 0),
    milestones_overdue: overdueMilestones,
    open_risks: openRisks.length,
    high_risks: openRisks.filter((risk) =>
      ["high", "critical"].includes(String(risk.severity || "").toLowerCase())
    ).length,
    resource_count: Number(resourceResult.rows[0]?.resource_count || 0),
    resource_utilization_percent: allocated + available
      ? Math.round((allocated / (allocated + available)) * 100)
      : 0,
  };
}

async function getAuthorizedReportingSummary({
  actor,
  days = 30,
  queryable = db,
}) {
  const access = branchScopedAccess(actor, ["superadmin", "admin"]);
  if (!access.authorized) return { authorized: false };
  const periodDays = [30, 90, 180, 365].includes(Number(days)) ? Number(days) : 30;
  const params = [...access.params, periodDays];
  const where = access.where.replace(/\bbranch_id\b/g, "t.branch_id");
  const result = await queryable.query(
    `SELECT COUNT(*)::int total_tickets,
            COUNT(*) FILTER (WHERE t.status IN ('Open Queue','In Progress'))::int active_tickets,
            COUNT(*) FILTER (WHERE t.status IN ('Resolved','Closed'))::int completed_tickets,
            COUNT(*) FILTER (WHERE t.priority='P1-Critical'
              AND t.status NOT IN ('Resolved','Closed','Cancelled','Canceled'))::int critical_active,
            COUNT(*) FILTER (WHERE t.assigned_to IS NOT NULL)::int assigned_tickets,
            COUNT(*) FILTER (WHERE t.category_id IS NULL)::int uncategorized_tickets,
            COUNT(*) FILTER (WHERE NULLIF(TRIM(t.root_cause),'') IS NOT NULL)::int root_causes_recorded,
            COUNT(DISTINCT t.branch_id)::int represented_branches
       FROM tickets t
      WHERE ${where}
        AND t.created_at>=CURRENT_DATE-($${params.length}::int*INTERVAL '1 day')`,
    params
  );
  return {
    authorized: true,
    days: periodDays,
    ...result.rows[0],
  };
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
  getAuthorizedAssetDiscoverySummary,
  getAuthorizedAssetFinanceSummary,
  getAuthorizedConsentSummary,
  getAuthorizedEndpointPolicySummary,
  getAuthorizedEndpointHealthSummary,
  getAuthorizedSlaSummary,
  getAuthorizedReplacementSummary,
  getAuthorizedLifecycleSummary,
  getAuthorizedCmdbSummary,
  getAuthorizedProjectSummary,
  getAuthorizedReportingSummary,
  getEndpointHealthAccess,
  getActorContext,
  normalizeRole,
  searchAuthorizedKnowledge,
  writeAudit,
  writeFeedback,
};
