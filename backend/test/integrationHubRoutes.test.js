process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const path = require("node:path");
const crypto = require("node:crypto");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const db = require("../config/db");
const integrationManagementRoutes = require("../src/routes/integrations");
let server;
let baseUrl;

const token = jwt.sign(
  { userId: 1, role: "SuperAdmin", branchId: null },
  process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod",
  { expiresIn: "5m" }
);

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/integrations", integrationManagementRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.rawPool.end();
});

test("Integration Hub management routes are mounted and protected", async () => {
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(serverSource, /app\.use\(["']\/api\/v1\/integrations["'],\s*integrationManagementRoutes\)/);

  const unauthorized = await fetch(`${baseUrl}/api/v1/integrations`);
  assert.equal(unauthorized.status, 401);

  const headers = { authorization: `Bearer ${token}` };
  for (const route of ["", "/dashboard", "/logs"]) {
    const response = await fetch(`${baseUrl}/api/v1/integrations${route}`, { headers });
    assert.equal(response.status, 200, `${route || "/"} should be mounted`);
    const body = await response.json();
    assert.equal(body.success, true);
  }
});

test("SuperAdmin can delete only an unused inactive API key", async () => {
  const marker = crypto.randomBytes(8).toString("hex");
  let integrationId;
  let keyId;
  try {
    const integration = await db.query(
      `INSERT INTO integration_registry
       (system_name, system_code, description, api_key_hash, status, allowed_branches)
       VALUES ($1,$2,$3,$4,'Active','[]'::jsonb)
       RETURNING integration_id`,
      [`Delete Key Test ${marker}`, `DELETE_KEY_${marker.toUpperCase()}`, "Test only", crypto.createHash("sha256").update(`legacy-${marker}`).digest("hex")]
    );
    integrationId = integration.rows[0].integration_id;
    const key = await db.query(
      `INSERT INTO integration_api_keys (integration_id, key_name, api_key_hash, status)
       VALUES ($1,'Mistaken key',$2,'Active') RETURNING key_id`,
      [integrationId, crypto.createHash("sha256").update(`key-${marker}`).digest("hex")]
    );
    keyId = key.rows[0].key_id;

    const activeDelete = await fetch(`${baseUrl}/api/v1/integrations/api-keys/${keyId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(activeDelete.status, 409);

    await db.query(`UPDATE integration_api_keys SET status='Disabled' WHERE key_id=$1`, [keyId]);
    const deleted = await fetch(`${baseUrl}/api/v1/integrations/api-keys/${keyId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).success, true);
    assert.equal((await db.query(`SELECT 1 FROM integration_api_keys WHERE key_id=$1`, [keyId])).rowCount, 0);
  } finally {
    if (keyId) await db.query(`DELETE FROM integration_audit_logs WHERE event_type='unused_api_key_deleted' AND metadata->>'key_id'=$1`, [String(keyId)]);
    if (integrationId) await db.query(`DELETE FROM integration_registry WHERE integration_id=$1`, [integrationId]);
  }
});
