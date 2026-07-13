const crypto = require("crypto");
const db = require("../../config/db");

function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(String(apiKey || "")).digest("hex");
}

function generateApiKey(systemCode) {
  const code = String(systemCode || "integration")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return `ab_int_${code}_${crypto.randomBytes(24).toString("hex")}`;
}

function getSourceIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    req.ip ||
    null
  );
}

function parseAllowedBranches(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function integrationAllowsBranch(integration, branchId) {
  const allowed = parseAllowedBranches(integration?.allowed_branches || []);
  if (allowed.length === 0) return false;
  return allowed.includes(Number.parseInt(branchId, 10));
}

async function ensureIntegrationGatewaySchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS integration_registry (
      integration_id SERIAL PRIMARY KEY,
      system_name VARCHAR(150) NOT NULL,
      system_code VARCHAR(80) NOT NULL UNIQUE,
      description TEXT,
      api_key_hash VARCHAR(128) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'Active',
      allowed_branches JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TIMESTAMPTZ
    );
    ALTER TABLE integration_registry ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL;

    CREATE TABLE IF NOT EXISTS integration_audit_logs (
      audit_id BIGSERIAL PRIMARY KEY,
      integration_id INTEGER REFERENCES integration_registry(integration_id) ON DELETE SET NULL,
      event_type VARCHAR(80) NOT NULL,
      source_ip VARCHAR(64),
      request_method VARCHAR(10),
      request_path TEXT,
      request_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      success BOOLEAN NOT NULL DEFAULT true,
      status_code INTEGER,
      metadata JSONB
    );
    ALTER TABLE integration_audit_logs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
    ALTER TABLE integration_audit_logs ADD COLUMN IF NOT EXISTS branch_id INTEGER;
    ALTER TABLE integration_audit_logs ADD COLUMN IF NOT EXISTS employee_id INTEGER;

    CREATE TABLE IF NOT EXISTS integration_api_keys (
      key_id BIGSERIAL PRIMARY KEY,
      integration_id INTEGER NOT NULL REFERENCES integration_registry(integration_id) ON DELETE CASCADE,
      key_name VARCHAR(150) NOT NULL,
      api_key_hash VARCHAR(128) NOT NULL UNIQUE,
      status VARCHAR(30) NOT NULL DEFAULT 'Active',
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_integration_registry_system_code ON integration_registry(system_code);
    CREATE INDEX IF NOT EXISTS idx_integration_registry_status ON integration_registry(status);
    CREATE INDEX IF NOT EXISTS idx_integration_audit_integration ON integration_audit_logs(integration_id);
    CREATE INDEX IF NOT EXISTS idx_integration_audit_created ON integration_audit_logs(request_timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_integration_api_keys_integration ON integration_api_keys(integration_id);
    CREATE INDEX IF NOT EXISTS idx_integration_api_keys_status ON integration_api_keys(status);

    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS origin_system VARCHAR(150);
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS origin_module VARCHAR(150);
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS origin_feature VARCHAR(150);
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS external_reference VARCHAR(150);
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS external_attachment_metadata JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS external_request_fingerprint VARCHAR(64);
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS integration_id INTEGER REFERENCES integration_registry(integration_id) ON DELETE SET NULL;
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS created_via VARCHAR(100);
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS external_requester_name VARCHAR(200);
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS external_requester_email VARCHAR(320);
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS external_employee_id VARCHAR(150);

    ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS integration_id INTEGER REFERENCES integration_registry(integration_id) ON DELETE SET NULL;
    ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS external_comment_reference VARCHAR(150);

    CREATE INDEX IF NOT EXISTS idx_tickets_integration_id ON tickets(integration_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_external_reference ON tickets(external_reference);
    CREATE INDEX IF NOT EXISTS idx_tickets_origin_system ON tickets(origin_system);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_external_idempotency
      ON tickets(origin_system, external_reference)
      WHERE origin_system IS NOT NULL AND external_reference IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_external_comment_reference
      ON ticket_comments(ticket_id, integration_id, external_comment_reference)
      WHERE integration_id IS NOT NULL AND external_comment_reference IS NOT NULL;
  `);
}

async function auditIntegrationRequest(req, eventType, options = {}) {
  try {
    await ensureIntegrationGatewaySchema();
    const metadata = {
      ...(req.integration?.system_name ? { origin_system: req.integration.system_name } : {}),
      ...(options.metadata || {}),
    };
    const durationMs = options.durationMs ?? (req.integrationStartedAt ? Date.now() - req.integrationStartedAt : null);
    await db.query(
      `
      INSERT INTO integration_audit_logs
      (integration_id, event_type, source_ip, request_method, request_path, success, status_code, duration_ms, branch_id, employee_id, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `,
      [
        options.integrationId || req.integration?.integration_id || null,
        eventType,
        getSourceIp(req),
        req.method,
        req.originalUrl || req.url,
        options.success !== false,
        options.statusCode || null,
        durationMs,
        options.branchId || metadata.branch_id || req.body?.branch_id || req.query?.branch_id || null,
        options.employeeId || metadata.employee_id || req.body?.employee_id || req.query?.employee_id || null,
        JSON.stringify(metadata),
      ]
    );
  } catch (err) {
    console.warn("Integration audit failed:", err.message);
  }
}

async function findIntegrationByApiKey(apiKey) {
  if (!apiKey) return null;
  await ensureIntegrationGatewaySchema();
  const result = await db.query(
    `
    SELECT
      i.integration_id,
      i.system_name,
      i.system_code,
      i.description,
      i.status,
      i.allowed_branches,
      i.created_at,
      i.updated_at,
      i.last_used_at,
      k.key_id,
      k.key_name,
      k.status AS key_status
    FROM integration_api_keys k
    JOIN integration_registry i ON i.integration_id = k.integration_id
    WHERE k.api_key_hash = $1
    LIMIT 1
    `,
    [hashApiKey(apiKey)]
  );
  if (result.rows[0]) return result.rows[0];

  const fallback = await db.query(
    `
    SELECT integration_id, system_name, system_code, description, status, allowed_branches,
           created_at, updated_at, last_used_at, NULL::bigint AS key_id, 'Legacy Key' AS key_name, status AS key_status
    FROM integration_registry
    WHERE api_key_hash = $1
    LIMIT 1
    `,
    [hashApiKey(apiKey)]
  );
  return fallback.rows[0] || null;
}

async function touchIntegration(integrationId, keyId = null) {
  await db.query(
    `UPDATE integration_registry SET last_used_at = CURRENT_TIMESTAMP WHERE integration_id = $1`,
    [integrationId]
  );
  if (keyId) {
    await db.query(
      `UPDATE integration_api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE key_id = $1`,
      [keyId]
    );
  }
}

module.exports = {
  auditIntegrationRequest,
  ensureIntegrationGatewaySchema,
  findIntegrationByApiKey,
  generateApiKey,
  getSourceIp,
  hashApiKey,
  integrationAllowsBranch,
  parseAllowedBranches,
  touchIntegration,
};
