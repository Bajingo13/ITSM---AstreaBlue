const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../../config/db");
const {
  auditIntegrationRequest,
  ensureIntegrationGatewaySchema,
  generateApiKey,
  hashApiKey,
  parseAllowedBranches,
} = require("../services/integrationService");

const router = express.Router();
const JWT_FALLBACK_SECRET = "astreablue_dev_secret_change_in_prod";
const JWT_SECRET = process.env.JWT_SECRET || JWT_FALLBACK_SECRET;

function normalizeRole(role) {
  return String(role || "").toLowerCase().replace(/[\s_-]+/g, "");
}

function decodeUser(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    if (JWT_SECRET === JWT_FALLBACK_SECRET) return null;
    try {
      return jwt.verify(token, JWT_FALLBACK_SECRET);
    } catch {
      return null;
    }
  }
}

function requireIntegrationHubRead(req, res, next) {
  const user = decodeUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: "Authentication required.", data: null });
  }

  const role = normalizeRole(user.role);
  if (!["superadmin", "admin"].includes(role)) {
    return res.status(403).json({ success: false, message: "Integration Hub access denied.", data: null });
  }

  req.user = user;
  req.userRole = role;
  return next();
}

function requireSuperAdmin(req, res, next) {
  if (req.userRole !== "superadmin") {
    return res.status(403).json({ success: false, message: "Only SuperAdmin can manage integrations.", data: null });
  }
  return next();
}

router.use(async (_req, res, next) => {
  try {
    await ensureIntegrationGatewaySchema();
    next();
  } catch (err) {
    console.error("Integration schema setup error:", err.message);
    res.status(500).json({ success: false, message: "Integration storage is unavailable.", data: null });
  }
});

router.use(requireIntegrationHubRead);

router.get("/dashboard", async (_req, res) => {
  try {
    const result = await db.query(`
      WITH today_logs AS (
        SELECT *
        FROM integration_audit_logs
        WHERE request_timestamp::date = CURRENT_DATE
      ),
      today_tickets AS (
        SELECT *
        FROM tickets
        WHERE integration_id IS NOT NULL
          AND created_at::date = CURRENT_DATE
      ),
      most_active AS (
        SELECT i.system_name, COUNT(a.audit_id)::int AS request_count
        FROM integration_registry i
        JOIN integration_audit_logs a ON a.integration_id = i.integration_id
        GROUP BY i.integration_id
        ORDER BY request_count DESC, i.system_name ASC
        LIMIT 1
      )
      SELECT
        (SELECT COUNT(*)::int FROM integration_registry) AS registered_systems,
        (SELECT COUNT(*)::int FROM integration_registry WHERE status = 'Active') AS active_integrations,
        (SELECT COUNT(*)::int FROM today_logs) AS api_calls_today,
        (SELECT COUNT(*)::int FROM today_tickets) AS tickets_created_today,
        (SELECT COUNT(*)::int FROM today_logs WHERE success = false) AS failed_requests,
        COALESCE((SELECT system_name FROM most_active), 'None') AS most_active_system
    `);

    res.json({ success: true, message: "Integration dashboard loaded.", data: result.rows[0] });
  } catch (err) {
    console.error("Integration dashboard error:", err.message);
    res.status(500).json({ success: false, message: "Failed to load integration dashboard.", data: null });
  }
});

router.get("/logs", async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT
        a.audit_id,
        a.request_timestamp,
        i.system_name,
        i.system_code,
        a.request_path AS endpoint,
        a.request_method AS method,
        a.status_code,
        a.duration_ms,
        a.branch_id,
        b.branch_name,
        a.employee_id,
        u.full_name AS employee_name,
        a.source_ip,
        a.success,
        a.event_type,
        a.metadata
      FROM integration_audit_logs a
      LEFT JOIN integration_registry i ON i.integration_id = a.integration_id
      LEFT JOIN branches b ON b.branch_id = a.branch_id
      LEFT JOIN users u ON u.user_id = a.employee_id
      ORDER BY a.request_timestamp DESC
      LIMIT 250
    `);

    res.json({ success: true, message: "API logs loaded.", data: result.rows });
  } catch (err) {
    console.error("Integration logs error:", err.message);
    res.status(500).json({ success: false, message: "Failed to load API logs.", data: null });
  }
});

router.get("/", async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT
        i.integration_id,
        i.system_name,
        i.system_code,
        i.description,
        i.status,
        i.allowed_branches,
        i.created_by,
        creator.full_name AS created_by_name,
        i.created_at,
        i.updated_at,
        i.last_used_at,
        COUNT(a.audit_id)::int AS request_count
      FROM integration_registry i
      LEFT JOIN users creator ON creator.user_id = i.created_by
      LEFT JOIN integration_audit_logs a ON a.integration_id = i.integration_id
      GROUP BY i.integration_id, creator.full_name
      ORDER BY i.created_at DESC
    `);

    res.json({ success: true, message: "Registered systems loaded.", data: result.rows });
  } catch (err) {
    console.error("Fetch integrations error:", err.message);
    res.status(500).json({ success: false, message: "Failed to load integrations.", data: null });
  }
});

router.post("/", requireSuperAdmin, async (req, res) => {
  try {
    const systemName = String(req.body.system_name || "").trim();
    const systemCode = String(req.body.system_code || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");

    if (!systemName || !systemCode) {
      return res.status(400).json({ success: false, message: "System name and system code are required.", data: null });
    }

    const result = await db.query(
      `
      INSERT INTO integration_registry
      (system_name, system_code, description, api_key_hash, status, allowed_branches, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING integration_id, system_name, system_code, description, status, allowed_branches, created_by, created_at, updated_at, last_used_at
      `,
      [
        systemName,
        systemCode,
        req.body.description || null,
        hashApiKey(generateApiKey(systemCode)),
        req.body.status || "Active",
        JSON.stringify(parseAllowedBranches(req.body.allowed_branches)),
        req.user.userId || null,
      ]
    );

    await auditIntegrationRequest(req, "system_registered", {
      statusCode: 201,
      metadata: { integration_id: result.rows[0].integration_id, system_code: systemCode },
    });

    res.status(201).json({ success: true, message: "System registered.", data: result.rows[0] });
  } catch (err) {
    const duplicate = err.code === "23505";
    console.error("Create integration error:", err.message);
    res.status(duplicate ? 409 : 500).json({
      success: false,
      message: duplicate ? "System code already exists." : "Failed to register integration.",
      data: null,
    });
  }
});

router.patch("/:id", requireSuperAdmin, async (req, res) => {
  try {
    const allowedBranches = req.body.allowed_branches === undefined
      ? null
      : JSON.stringify(parseAllowedBranches(req.body.allowed_branches));

    const before = await db.query(`SELECT status FROM integration_registry WHERE integration_id = $1`, [req.params.id]);
    const result = await db.query(
      `
      UPDATE integration_registry
      SET
        system_name = COALESCE($1, system_name),
        description = COALESCE($2, description),
        status = COALESCE($3, status),
        allowed_branches = COALESCE($4::jsonb, allowed_branches),
        updated_at = CURRENT_TIMESTAMP
      WHERE integration_id = $5
      RETURNING integration_id, system_name, system_code, description, status, allowed_branches, created_by, created_at, updated_at, last_used_at
      `,
      [req.body.system_name || null, req.body.description || null, req.body.status || null, allowedBranches, req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "Integration not found.", data: null });
    }

    const oldStatus = before.rows[0]?.status;
    if (req.body.status && req.body.status !== oldStatus) {
      await auditIntegrationRequest(req, req.body.status === "Active" ? "integration_enabled" : "integration_disabled", {
        integrationId: result.rows[0].integration_id,
        statusCode: 200,
        metadata: { old_status: oldStatus, new_status: req.body.status },
      });
    }

    res.json({ success: true, message: "Integration updated.", data: result.rows[0] });
  } catch (err) {
    console.error("Update integration error:", err.message);
    res.status(500).json({ success: false, message: "Failed to update integration.", data: null });
  }
});

router.get("/:id/api-keys", async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT key_id, integration_id, key_name, status, created_by, created_at, updated_at, last_used_at, revoked_at
      FROM integration_api_keys
      WHERE integration_id = $1
      ORDER BY created_at DESC
      `,
      [req.params.id]
    );
    res.json({ success: true, message: "API keys loaded.", data: result.rows });
  } catch (err) {
    console.error("Fetch integration keys error:", err.message);
    res.status(500).json({ success: false, message: "Failed to load API keys.", data: null });
  }
});

router.post("/:id/api-keys", requireSuperAdmin, async (req, res) => {
  try {
    const integration = await db.query(
      `SELECT integration_id, system_code FROM integration_registry WHERE integration_id = $1`,
      [req.params.id]
    );
    if (!integration.rows.length) {
      return res.status(404).json({ success: false, message: "Integration not found.", data: null });
    }

    const apiKey = generateApiKey(integration.rows[0].system_code);
    const result = await db.query(
      `
      INSERT INTO integration_api_keys (integration_id, key_name, api_key_hash, status, created_by)
      VALUES ($1,$2,$3,'Active',$4)
      RETURNING key_id, integration_id, key_name, status, created_by, created_at, updated_at, last_used_at, revoked_at
      `,
      [
        integration.rows[0].integration_id,
        String(req.body.key_name || "Default API Key").trim(),
        hashApiKey(apiKey),
        req.user.userId || null,
      ]
    );

    await auditIntegrationRequest(req, "api_key_generated", {
      integrationId: integration.rows[0].integration_id,
      statusCode: 201,
      metadata: { key_id: result.rows[0].key_id, key_name: result.rows[0].key_name },
    });

    res.status(201).json({
      success: true,
      message: "API key generated. Store it now; it will not be shown again.",
      data: { ...result.rows[0], api_key: apiKey },
    });
  } catch (err) {
    console.error("Create integration key error:", err.message);
    res.status(500).json({ success: false, message: "Failed to generate API key.", data: null });
  }
});

router.patch("/api-keys/:keyId", requireSuperAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `
      UPDATE integration_api_keys
      SET status = COALESCE($1, status), updated_at = CURRENT_TIMESTAMP
      WHERE key_id = $2
      RETURNING key_id, integration_id, key_name, status, created_by, created_at, updated_at, last_used_at, revoked_at
      `,
      [req.body.status || null, req.params.keyId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "API key not found.", data: null });
    }

    res.json({ success: true, message: "API key updated.", data: result.rows[0] });
  } catch (err) {
    console.error("Update integration key error:", err.message);
    res.status(500).json({ success: false, message: "Failed to update API key.", data: null });
  }
});

router.post("/api-keys/:keyId/revoke", requireSuperAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `
      UPDATE integration_api_keys
      SET status = 'Revoked', revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE key_id = $1
      RETURNING key_id, integration_id, key_name, status, created_by, created_at, updated_at, last_used_at, revoked_at
      `,
      [req.params.keyId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "API key not found.", data: null });
    }

    await auditIntegrationRequest(req, "api_key_revoked", {
      integrationId: result.rows[0].integration_id,
      statusCode: 200,
      metadata: { key_id: result.rows[0].key_id },
    });

    res.json({ success: true, message: "API key revoked.", data: result.rows[0] });
  } catch (err) {
    console.error("Revoke integration key error:", err.message);
    res.status(500).json({ success: false, message: "Failed to revoke API key.", data: null });
  }
});

router.post("/api-keys/:keyId/regenerate", requireSuperAdmin, async (req, res) => {
  try {
    const existing = await db.query(
      `
      SELECT k.key_id, k.integration_id, k.key_name, i.system_code
      FROM integration_api_keys k
      JOIN integration_registry i ON i.integration_id = k.integration_id
      WHERE k.key_id = $1
      `,
      [req.params.keyId]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: "API key not found.", data: null });
    }

    const apiKey = generateApiKey(existing.rows[0].system_code);
    const result = await db.query(
      `
      UPDATE integration_api_keys
      SET api_key_hash = $1, status = 'Active', revoked_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE key_id = $2
      RETURNING key_id, integration_id, key_name, status, created_by, created_at, updated_at, last_used_at, revoked_at
      `,
      [hashApiKey(apiKey), req.params.keyId]
    );

    await auditIntegrationRequest(req, "api_key_generated", {
      integrationId: result.rows[0].integration_id,
      statusCode: 200,
      metadata: { key_id: result.rows[0].key_id, regenerated: true },
    });

    res.json({
      success: true,
      message: "API key regenerated. Store it now; it will not be shown again.",
      data: { ...result.rows[0], api_key: apiKey },
    });
  } catch (err) {
    console.error("Regenerate integration key error:", err.message);
    res.status(500).json({ success: false, message: "Failed to regenerate API key.", data: null });
  }
});

module.exports = router;
