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
  return { userId, roleName, branchId };
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

    // Find all downstream dependencies (CIs that depend on this one)
    const downstreamResult = await db.query(`
      SELECT
        tgt.ci_id, tgt.ci_name, tgt.ci_type, tgt.environment, tgt.status,
        b.branch_name, d.relationship_type, d.description
      FROM ci_dependencies d
      JOIN config_items tgt ON d.target_ci_id = tgt.ci_id
      LEFT JOIN branches b ON tgt.branch_id = b.branch_id
      WHERE d.source_ci_id = $1
      ORDER BY tgt.ci_name
    `, [ciId]);

    // Find all upstream dependencies (CIs this one depends on)
    const upstreamResult = await db.query(`
      SELECT
        src.ci_id, src.ci_name, src.ci_type, src.environment, src.status,
        b.branch_name, d.relationship_type, d.description
      FROM ci_dependencies d
      JOIN config_items src ON d.source_ci_id = src.ci_id
      LEFT JOIN branches b ON src.branch_id = b.branch_id
      WHERE d.target_ci_id = $1
      ORDER BY src.ci_name
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
      impactScore = 60 + affectedCis.length * 5;
    } else if (affectedCis.length >= 2 || productionAffected.length >= 1) {
      riskLevel = "Medium";
      impactScore = 25 + affectedCis.length * 10;
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
