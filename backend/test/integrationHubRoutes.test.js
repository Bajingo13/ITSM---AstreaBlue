process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const path = require("node:path");
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
