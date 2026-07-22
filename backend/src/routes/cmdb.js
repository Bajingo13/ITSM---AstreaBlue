const express = require("express");
const db = require("../../config/db");

const router = express.Router();

/* ─────────────────────────────────────────────
   Helper: get user info from request
   ───────────────────────────────────────────── */
function getUser(req) {
  const userId = parseInt(req.query.current_user_id, 10) || req.user?.user_id || null;
  const roleName = req.query.role_name || req.user?.role_name || "Employee";
  const branchId = parseInt(req.query.branch_id, 10) || req.user?.branch_id || null;
  const userName = req.query.user_name || req.user?.full_name || "";
  return { userId, roleName, branchId, userName };
}

/* ─────────────────────────────────────────────
   GET /api/v1/cmdb/filter-options
   ───────────────────────────────────────────── */
router.get("/filter-options", async (req, res) => {
  try {
    const { roleName, branchId } = getUser(req);
    const isSuperAdmin = roleName === "SuperAdmin";

    const [typesRes, statusesRes, branchesRes, envsRes] = await Promise.all([
      db.query(`SELECT DISTINCT ci_type FROM config_items ORDER BY ci_type`),
      db.query(`SELECT DISTINCT status FROM config_items ORDER BY status`),
      db.query(`SELECT branch_id, branch_name FROM branches WHERE is_active = true ORDER BY branch_name`),
      db.query(`SELECT DISTINCT environment FROM config_items WHERE environment IS NOT NULL ORDER BY environment`),
    ]);

    const filteredBranches = isSuperAdmin
      ? branchesRes.rows
      : branchesRes.rows.filter((b) => Number(b.branch_id) === Number(branchId));

    return res.json({
      types: typesRes.rows.map((r) => r.ci_type),
      statuses: statusesRes.rows.map((r) => r.status),
      branches: filteredBranches,
      environments: envsRes.rows.map((r) => r.environment),
    });
  } catch (err) {
    console.error("GET /filter-options error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch filter options." });
  }
});

/* ─────────────────────────────────────────────
   GET /api/v1/cmdb/config-items
   ───────────────────────────────────────────── */
router.get("/config-items", async (req, res) => {
  try {
    const { roleName, branchId } = getUser(req);
    const isSuperAdmin = roleName === "SuperAdmin";

    let query = `
      SELECT ci.*, b.branch_name, cc.category_name
      FROM config_items ci
      LEFT JOIN branches b ON ci.branch_id = b.branch_id
      LEFT JOIN ci_categories cc ON ci.category_id = cc.ci_category_id
    `;
    const conditions = [];
    const params = [];
    let paramIndex = 0;

    // Role-based branch restriction
    if (!isSuperAdmin && branchId) {
      paramIndex++;
      conditions.push(`ci.branch_id = $${paramIndex}`);
      params.push(branchId);
    }

    // Query param filters (SuperAdmin can use these)
    const { branch, ci_type, status, environment, search: searchQuery } = req.query;

    if (branch && branch !== "All" && isSuperAdmin) {
      paramIndex++;
      conditions.push(`ci.branch_id = $${paramIndex}`);
      params.push(parseInt(branch, 10));
    }

    if (ci_type && ci_type !== "All") {
      paramIndex++;
      conditions.push(`ci.ci_type = $${paramIndex}`);
      params.push(ci_type);
    }

    if (status && status !== "All") {
      paramIndex++;
      conditions.push(`ci.status = $${paramIndex}`);
      params.push(status);
    }

    if (environment && environment !== "All") {
      paramIndex++;
      conditions.push(`ci.environment = $${paramIndex}`);
      params.push(environment);
    }

    if (searchQuery && searchQuery.trim()) {
      paramIndex++;
      conditions.push(`(
        ci.ci_name ILIKE $${paramIndex}
        OR ci.ci_type ILIKE $${paramIndex}
        OR ci.ip_address ILIKE $${paramIndex}
        OR ci.owner ILIKE $${paramIndex}
        OR ci.operating_system ILIKE $${paramIndex}
        OR b.branch_name ILIKE $${paramIndex}
      )`);
      params.push(`%${searchQuery.trim()}%`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    query += ` ORDER BY ci.created_at DESC`;

    const result = await db.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("GET /config-items error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch configuration items." });
  }
});

/* ─────────────────────────────────────────────
   GET /api/v1/cmdb/statistics
   ───────────────────────────────────────────── */
router.get("/statistics", async (req, res) => {
  try {
    const { roleName, branchId } = getUser(req);
    const isSuperAdmin = roleName === "SuperAdmin";

    const conditions = [];
    const params = [];

    if (!isSuperAdmin && branchId) {
      conditions.push(`branch_id = $1`);
      params.push(branchId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await db.query(`
      SELECT
        COUNT(*)::int AS total_cis,
        COUNT(*) FILTER (WHERE ci_type = 'Server')::int AS total_servers,
        COUNT(*) FILTER (WHERE ci_type = 'Application')::int AS total_applications,
        COUNT(*) FILTER (WHERE ci_type = 'Network Device')::int AS total_network_devices,
        COUNT(*) FILTER (WHERE status = 'Active')::int AS total_active
      FROM config_items
      ${whereClause}
    `, params);

    return res.json(result.rows[0] || {
      total_cis: 0, total_servers: 0, total_applications: 0,
      total_network_devices: 0, total_active: 0
    });
  } catch (err) {
    console.error("GET /statistics error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch CMDB statistics." });
  }
});

/* ─────────────────────────────────────────────
   GET /api/v1/cmdb/dependencies
   ───────────────────────────────────────────── */
router.get("/dependencies", async (req, res) => {
  try {
    const { roleName, branchId } = getUser(req);
    const isSuperAdmin = roleName === "SuperAdmin";

    let query = `
      SELECT
        d.dependency_id,
        d.source_ci_id,
        d.target_ci_id,
        d.relationship_type,
        d.description AS dep_description,
        src.ci_name AS source_name,
        src.ci_type AS source_type,
        src.branch_id AS source_branch_id,
        src_b.branch_name AS source_branch_name,
        tgt.ci_name AS target_name,
        tgt.ci_type AS target_type,
        tgt.branch_id AS target_branch_id,
        tgt_b.branch_name AS target_branch_name
      FROM ci_dependencies d
      JOIN config_items src ON d.source_ci_id = src.ci_id
      JOIN config_items tgt ON d.target_ci_id = tgt.ci_id
      LEFT JOIN branches src_b ON src.branch_id = src_b.branch_id
      LEFT JOIN branches tgt_b ON tgt.branch_id = tgt_b.branch_id
    `;
    const params = [];

    if (!isSuperAdmin && branchId) {
      query += ` WHERE src.branch_id = $1 OR tgt.branch_id = $1`;
      params.push(branchId);
    }

    query += ` ORDER BY d.dependency_id`;

    const result = await db.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("GET /dependencies error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch dependencies." });
  }
});

/* ─────────────────────────────────────────────
   POST /api/v1/cmdb/dependencies
   ───────────────────────────────────────────── */
router.post("/dependencies", async (req, res) => {
  try {
    const { roleName, branchId, userId, userName } = getUser(req);
    const isAdmin = roleName === "SuperAdmin" || roleName === "Admin";
    const isSuperAdmin = roleName === "SuperAdmin";
    const { source_ci_id, target_ci_id, relationship_type, description } = req.body;
    if (!source_ci_id || !target_ci_id || !relationship_type) {
      return res.status(400).json({ success: false, message: "Source CI, destination CI, and relationship type are required." });
    }
    if (Number(source_ci_id) === Number(target_ci_id)) {
      return res.status(400).json({ success: false, message: "Source and destination CI cannot be the same." });
    }

    // Check branch permission
    if (!isSuperAdmin && roleName === "Admin") {
      const ciCheck = await db.query(
        `SELECT branch_id FROM config_items WHERE ci_id IN ($1, $2)`,
        [source_ci_id, target_ci_id]
      );
      const branches = ciCheck.rows.map(r => r.branch_id);
      if (branches.some(b => Number(b) !== Number(branchId))) {
        return res.status(403).json({ success: false, message: "CIs must belong to your assigned branch." });
      }
    }

    // Check duplicate
    const existCheck = await db.query(
      `SELECT dependency_id FROM ci_dependencies WHERE source_ci_id = $1 AND target_ci_id = $2 AND relationship_type = $3`,
      [source_ci_id, target_ci_id, relationship_type]
    );
    if (existCheck.rows.length > 0) {
      return res.status(409).json({ success: false, message: "This relationship already exists." });
    }

    // Get branch_id from source CI
    const srcResult = await db.query(`SELECT branch_id, ci_name FROM config_items WHERE ci_id = $1`, [source_ci_id]);
    const relBranchId = srcResult.rows[0]?.branch_id || branchId;

    const result = await db.query(
      `INSERT INTO ci_dependencies (source_ci_id, target_ci_id, relationship_type, description, created_by, branch_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) RETURNING *`,
      [source_ci_id, target_ci_id, relationship_type, description || null, userId, relBranchId]
    );

    // Audit log
    const userRes = await db.query(`SELECT full_name FROM users WHERE user_id = $1`, [userId]);
    const auditUser = userRes.rows[0]?.full_name || '';
    await db.query(
      `INSERT INTO ci_audit_logs (action_type, entity_type, entity_id, user_id, user_name, branch_id, new_values, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ['create', 'relationship', result.rows[0].dependency_id, userId, auditUser, relBranchId,
        JSON.stringify({ source_ci_id, target_ci_id, relationship_type }),
        `Relationship created: ${relationship_type} between CI #${source_ci_id} and CI #${target_ci_id}`
      ]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("POST /dependencies error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to create dependency." });
  }
});

/* ─────────────────────────────────────────────
   PUT /api/v1/cmdb/dependencies/:id
   ───────────────────────────────────────────── */
router.put("/dependencies/:id", async (req, res) => {
  try {
    const { roleName, userId } = getUser(req);
    if (roleName !== "SuperAdmin" && roleName !== "Admin") {
      return res.status(403).json({ success: false, message: "Insufficient permissions." });
    }

    const depId = parseInt(req.params.id, 10);
    if (!depId) return res.status(400).json({ success: false, message: "Invalid dependency ID." });

    const { relationship_type, description } = req.body;
    if (!relationship_type) return res.status(400).json({ success: false, message: "Relationship type is required." });

    // Get existing
    const existing = await db.query(`SELECT * FROM ci_dependencies WHERE dependency_id = $1`, [depId]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: "Dependency not found." });

    const oldData = existing.rows[0];

    const result = await db.query(
      `UPDATE ci_dependencies SET relationship_type = $1, description = $2, updated_at = NOW() WHERE dependency_id = $3 RETURNING *`,
      [relationship_type, description || null, depId]
    );

    // Audit log
    const userRes = await db.query(`SELECT full_name FROM users WHERE user_id = $1`, [userId]);
    const auditUser = userRes.rows[0]?.full_name || '';
    await db.query(
      `INSERT INTO ci_audit_logs (action_type, entity_type, entity_id, user_id, user_name, branch_id, old_values, new_values, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      ['update', 'relationship', depId, userId, auditUser, oldData.branch_id,
        JSON.stringify({ relationship_type: oldData.relationship_type }),
        JSON.stringify({ relationship_type }),
        `Relationship #${depId} updated: ${oldData.relationship_type} → ${relationship_type}`
      ]
    );

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("PUT /dependencies/:id error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to update dependency." });
  }
});

/* ─────────────────────────────────────────────
   DELETE /api/v1/cmdb/dependencies/:id
   ───────────────────────────────────────────── */
router.delete("/dependencies/:id", async (req, res) => {
  try {
    const { roleName, userId, branchId } = getUser(req);
    if (roleName !== "SuperAdmin" && roleName !== "Admin") {
      return res.status(403).json({ success: false, message: "Insufficient permissions." });
    }

    const depId = parseInt(req.params.id, 10);
    if (!depId) return res.status(400).json({ success: false, message: "Invalid dependency ID." });

    const existing = await db.query(`SELECT * FROM ci_dependencies WHERE dependency_id = $1`, [depId]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: "Dependency not found." });

    const rel = existing.rows[0];

    // Branch check for Admin
    if (roleName === "Admin" && rel.branch_id && Number(rel.branch_id) !== Number(branchId)) {
      return res.status(403).json({ success: false, message: "Cannot delete relationships outside your branch." });
    }

    await db.query(`DELETE FROM ci_dependencies WHERE dependency_id = $1`, [depId]);

    // Audit log
    const userRes = await db.query(`SELECT full_name FROM users WHERE user_id = $1`, [userId]);
    const auditUser = userRes.rows[0]?.full_name || '';
    await db.query(
      `INSERT INTO ci_audit_logs (action_type, entity_type, entity_id, user_id, user_name, branch_id, old_values, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ['delete', 'relationship', depId, userId, auditUser, rel.branch_id || branchId,
        JSON.stringify({ source_ci_id: rel.source_ci_id, target_ci_id: rel.target_ci_id, relationship_type: rel.relationship_type }),
        `Relationship #${depId} deleted: ${rel.relationship_type} between CI #${rel.source_ci_id} and CI #${rel.target_ci_id}`
      ]
    );

    return res.json({ success: true, message: "Dependency deleted." });
  } catch (err) {
    console.error("DELETE /dependencies/:id error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to delete dependency." });
  }
});

/* ─────────────────────────────────────────────
   GET /api/v1/cmdb/dependencies/statistics
   ───────────────────────────────────────────── */
router.get("/dependencies/statistics", async (req, res) => {
  try {
    const { roleName, branchId } = getUser(req);
    const isSuperAdmin = roleName === "SuperAdmin";

    let ciWhere = "";
    let depWhere = "";
    const params = [];

    if (!isSuperAdmin && branchId) {
      params.push(branchId);
      ciWhere = ` WHERE branch_id = $1`;
      depWhere = ` WHERE d.branch_id = $1`;
    }

    const ciResult = await db.query(`SELECT COUNT(*)::int AS total FROM config_items${ciWhere}`, params);
    const depResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM ci_dependencies d${depWhere}`,
      params
    );
    const connectedResult = await db.query(
      `SELECT COUNT(DISTINCT ci_id)::int AS total FROM (
        SELECT source_ci_id AS ci_id FROM ci_dependencies d${depWhere.replace('d.', '')}
        UNION
        SELECT target_ci_id AS ci_id FROM ci_dependencies d${depWhere.replace('d.', '')}
      ) sub`,
      params
    );

    const totalCIs = ciResult.rows[0]?.total || 0;
    const totalRelationships = depResult.rows[0]?.total || 0;
    const connectedCIs = connectedResult.rows[0]?.total || 0;
    const isolatedCIs = totalCIs - connectedCIs;

    return res.json({
      total_ci: totalCIs,
      total_relationships: totalRelationships,
      connected_ci: connectedCIs,
      isolated_ci: Math.max(isolatedCIs, 0),
      last_updated: new Date().toISOString(),
    });
  } catch (err) {
    console.error("GET /dependencies/statistics error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch dependency statistics." });
  }
});

/* ─────────────────────────────────────────────
   GET /api/v1/cmdb/change-impact/:id
   ───────────────────────────────────────────── */
router.get("/change-impact/:id", async (req, res) => {
  try {
    const ciId = parseInt(req.params.id, 10);
    if (!ciId) {
      return res.status(400).json({ success: false, message: "Invalid CI ID." });
    }

    // Get the CI
    const ciResult = await db.query(`
      SELECT ci.*, b.branch_name, cc.category_name
      FROM config_items ci
      LEFT JOIN branches b ON ci.branch_id = b.branch_id
      LEFT JOIN ci_categories cc ON ci.category_id = cc.ci_category_id
      WHERE ci.ci_id = $1
    `, [ciId]);

    if (ciResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Configuration item not found." });
    }

    const ci = ciResult.rows[0];

    // A relationship is stored as a readable statement:
    //   source CI --relationship--> target CI
    // Example: Employee Portal --Uses--> Payroll API.
    // When the target changes, the source is affected. Walk the graph in
    // reverse to find every directly and indirectly affected CI.
    const downstreamResult = await db.query(`
      WITH RECURSIVE affected AS (
        SELECT
          src.ci_id, src.ci_name, src.ci_type, src.environment, src.status,
          src.branch_id, d.relationship_type, d.description,
          1 AS depth, ARRAY[$1::int, src.ci_id] AS path
        FROM ci_dependencies d
        JOIN config_items src ON d.source_ci_id = src.ci_id
        WHERE d.target_ci_id = $1

        UNION ALL

        SELECT
          src.ci_id, src.ci_name, src.ci_type, src.environment, src.status,
          src.branch_id, d.relationship_type, d.description,
          affected.depth + 1, affected.path || src.ci_id
        FROM affected
        JOIN ci_dependencies d ON d.target_ci_id = affected.ci_id
        JOIN config_items src ON d.source_ci_id = src.ci_id
        WHERE NOT src.ci_id = ANY(affected.path)
      )
      SELECT DISTINCT ON (affected.ci_id)
        affected.ci_id, affected.ci_name, affected.ci_type,
        affected.environment, affected.status, b.branch_name,
        affected.relationship_type, affected.description, affected.depth
      FROM affected
      LEFT JOIN branches b ON affected.branch_id = b.branch_id
      ORDER BY affected.ci_id, affected.depth
    `, [ciId]);

    // Follow the statement forward to find the services/infrastructure the
    // selected CI relies on (its direct and indirect prerequisites).
    const upstreamResult = await db.query(`
      WITH RECURSIVE prerequisites AS (
        SELECT
          tgt.ci_id, tgt.ci_name, tgt.ci_type, tgt.environment, tgt.status,
          tgt.branch_id, d.relationship_type, d.description,
          1 AS depth, ARRAY[$1::int, tgt.ci_id] AS path
        FROM ci_dependencies d
        JOIN config_items tgt ON d.target_ci_id = tgt.ci_id
        WHERE d.source_ci_id = $1

        UNION ALL

        SELECT
          tgt.ci_id, tgt.ci_name, tgt.ci_type, tgt.environment, tgt.status,
          tgt.branch_id, d.relationship_type, d.description,
          prerequisites.depth + 1, prerequisites.path || tgt.ci_id
        FROM prerequisites
        JOIN ci_dependencies d ON d.source_ci_id = prerequisites.ci_id
        JOIN config_items tgt ON d.target_ci_id = tgt.ci_id
        WHERE NOT tgt.ci_id = ANY(prerequisites.path)
      )
      SELECT DISTINCT ON (prerequisites.ci_id)
        prerequisites.ci_id, prerequisites.ci_name, prerequisites.ci_type,
        prerequisites.environment, prerequisites.status, b.branch_name,
        prerequisites.relationship_type, prerequisites.description,
        prerequisites.depth
      FROM prerequisites
      LEFT JOIN branches b ON prerequisites.branch_id = b.branch_id
      ORDER BY prerequisites.ci_id, prerequisites.depth
    `, [ciId]);

    // Calculate risk level and impact score
    const affectedCis = downstreamResult.rows;
    const dependentApps = affectedCis.filter((c) => c.ci_type === "Application");
    const productionAffected = affectedCis.filter((c) => c.environment === "Production");

    let riskLevel = "Low";
    let impactScore = 0;

    if (affectedCis.length >= 10 || productionAffected.length >= 5) {
      riskLevel = "Critical";
      impactScore = 90 + Math.min(affectedCis.length, 10);
    } else if (affectedCis.length >= 5 || productionAffected.length >= 2) {
      riskLevel = "High";
      impactScore = Math.min(89, 60 + affectedCis.length * 5);
    } else if (affectedCis.length >= 2 || productionAffected.length >= 1) {
      riskLevel = "Medium";
      impactScore = Math.min(59, 25 + affectedCis.length * 10);
    } else {
      impactScore = affectedCis.length > 0 ? 10 : 0;
    }

    // Collect unique related branch names
    const relatedBranchSet = new Set();
    [ci, ...affectedCis, ...upstreamResult.rows].forEach((item) => {
      if (item.branch_name) relatedBranchSet.add(item.branch_name);
    });

    // Determine recommended action
    let recommendedAction = "No action required.";
    if (riskLevel === "Critical") {
      recommendedAction = "Schedule change freeze. Notify all stakeholders. Prepare rollback plan. Consider off-peak implementation with extended maintenance window.";
    } else if (riskLevel === "High") {
      recommendedAction = "Notify application owners. Schedule change during maintenance window. Prepare rollback plan.";
    } else if (riskLevel === "Medium") {
      recommendedAction = "Notify affected application owners. Schedule change during regular maintenance hours.";
    } else {
      recommendedAction = "Standard change procedure applies. No special approvals required.";
    }

    return res.json({
      ci: {
        ci_id: ci.ci_id,
        ci_name: ci.ci_name,
        ci_type: ci.ci_type,
        branch_name: ci.branch_name,
        environment: ci.environment,
        status: ci.status,
      },
      risk_level: riskLevel,
      impact_score: impactScore,
      affected_cis: affectedCis,
      upstream_dependencies: upstreamResult.rows,
      dependent_applications: dependentApps,
      related_branches: [...relatedBranchSet],
      recommended_action: recommendedAction,
      impact_source: "Live CMDB dependency relationships and CI environment data",
      impact_basis: {
        affected_ci_count: affectedCis.length,
        production_ci_count: productionAffected.length,
        dependent_application_count: dependentApps.length,
        thresholds: {
          critical: "10+ affected CIs or 5+ production CIs",
          high: "5+ affected CIs or 2+ production CIs",
          medium: "2+ affected CIs or 1+ production CI",
          low: "Below the medium threshold",
        },
      },
    });
  } catch (err) {
    console.error("GET /change-impact/:id error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to analyze change impact." });
  }
});

/* ─────────────────────────────────────────────
   GET /api/v1/cmdb/config-items/:id
   ───────────────────────────────────────────── */
router.get("/config-items/:id", async (req, res) => {
  try {
    const ciId = parseInt(req.params.id, 10);
    if (!ciId) {
      return res.status(400).json({ success: false, message: "Invalid CI ID." });
    }

    const result = await db.query(`
      SELECT ci.*, b.branch_name, cc.category_name
      FROM config_items ci
      LEFT JOIN branches b ON ci.branch_id = b.branch_id
      LEFT JOIN ci_categories cc ON ci.category_id = cc.ci_category_id
      WHERE ci.ci_id = $1
    `, [ciId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Configuration item not found." });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("GET /config-items/:id error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch configuration item." });
  }
});

/* ─────────────────────────────────────────────
   POST /api/v1/cmdb/config-items
   ───────────────────────────────────────────── */
router.post("/config-items", async (req, res) => {
  try {
    const {
      ci_name, ci_type, category_id, description, branch_id,
      environment, ip_address, operating_system, owner, status,
      version, location,
    } = req.body;

    if (!ci_name || !ci_type) {
      return res.status(400).json({ success: false, message: "CI name and type are required." });
    }

    if (!branch_id) {
      return res.status(400).json({ success: false, message: "Branch is required." });
    }

    const result = await db.query(`
      INSERT INTO config_items
        (ci_name, ci_type, category_id, description, branch_id,
         environment, ip_address, operating_system, owner, status,
         version, location)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      ci_name.trim(), ci_type.trim(),
      category_id ? parseInt(category_id, 10) : null,
      description || null, parseInt(branch_id, 10),
      environment || "Production", ip_address || null,
      operating_system || null, owner || null,
      status || "Active", version || null, location || null,
    ]);

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("POST /config-items error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to create configuration item." });
  }
});

/* ─────────────────────────────────────────────
   PUT /api/v1/cmdb/config-items/:id
   ───────────────────────────────────────────── */
router.put("/config-items/:id", async (req, res) => {
  try {
    const ciId = parseInt(req.params.id, 10);
    if (!ciId) {
      return res.status(400).json({ success: false, message: "Invalid CI ID." });
    }

    const {
      ci_name, ci_type, category_id, description, branch_id,
      environment, ip_address, operating_system, owner, status,
      version, location,
    } = req.body;

    const result = await db.query(`
      UPDATE config_items SET
        ci_name = COALESCE(NULLIF($1, ''), ci_name),
        ci_type = COALESCE(NULLIF($2, ''), ci_type),
        category_id = COALESCE($3, category_id),
        description = $4,
        branch_id = COALESCE($5, branch_id),
        environment = COALESCE(NULLIF($6, ''), environment),
        ip_address = $7,
        operating_system = $8,
        owner = $9,
        status = COALESCE(NULLIF($10, ''), status),
        version = $11,
        location = $12,
        updated_at = CURRENT_TIMESTAMP
      WHERE ci_id = $13
      RETURNING *
    `, [
      ci_name, ci_type,
      category_id ? parseInt(category_id, 10) : null,
      description ?? null, branch_id ? parseInt(branch_id, 10) : null,
      environment || null, ip_address || null,
      operating_system || null, owner || null,
      status || null, version || null, location || null,
      ciId,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Configuration item not found." });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("PUT /config-items/:id error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to update configuration item." });
  }
});

/* ─────────────────────────────────────────────
   DELETE /api/v1/cmdb/config-items/:id
   ───────────────────────────────────────────── */
router.delete("/config-items/:id", async (req, res) => {
  try {
    const ciId = parseInt(req.params.id, 10);
    if (!ciId) {
      return res.status(400).json({ success: false, message: "Invalid CI ID." });
    }

    // Delete related dependencies first
    await db.query(`DELETE FROM ci_dependencies WHERE source_ci_id = $1 OR target_ci_id = $1`, [ciId]);

    const result = await db.query(
      `DELETE FROM config_items WHERE ci_id = $1 RETURNING ci_id`,
      [ciId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Configuration item not found." });
    }

    return res.json({ success: true, message: "Configuration item deleted." });
  } catch (err) {
    console.error("DELETE /config-items/:id error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to delete configuration item." });
  }
});

/* ─────────────────────────────────────────────
   GET /api/v1/cmdb/ci-categories
   ───────────────────────────────────────────── */
router.get("/ci-categories", async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM ci_categories ORDER BY category_name`);
    return res.json(result.rows);
  } catch (err) {
    console.error("GET /ci-categories error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch CI categories." });
  }
});

module.exports = router;
