const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const jwt = require("jsonwebtoken");

const backendRoot = path.resolve(__dirname, "..");
const serverSource = fs.readFileSync(
  path.join(backendRoot, "server.js"),
  "utf8"
);

function readRouteSource(fileName) {
  return fs.readFileSync(
    path.join(backendRoot, "src", "routes", fileName),
    "utf8"
  );
}

function collectRouteSurface(source) {
  const routes = [];
  const routePattern =
    /router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;
  let match;

  while ((match = routePattern.exec(source))) {
    routes.push(`${match[1].toUpperCase()} ${match[2]}`);
  }

  return routes.sort();
}

const expectedModules = {
  "branches.js": [
    "GET /",
    "PATCH /:id/admin",
    "PATCH /:id/status",
    "POST /",
    "PUT /:id",
  ],
  "users.js": [
    "GET /",
    "PATCH /:id/reset-password",
    "PATCH /:id/status",
    "POST /",
    "POST /invite",
    "PUT /:id",
  ],
  "roles.js": ["GET /"],
  "technicians.js": ["GET /"],
  "ticketCategories.js": ["GET /", "POST /"],
  "knowledgeBase.js": [
    "DELETE /:id",
    "GET /",
    "GET /:id",
    "POST /",
    "PUT /:id",
  ],
  "softwareLicenses.js": [
    "DELETE /:id",
    "GET /",
    "GET /:id/renewals",
    "GET /export",
    "GET /summary",
    "POST /",
    "POST /:id/renew",
    "PUT /:id",
  ],
  "hardwareAssets.js": [
    "DELETE /hardware-assets/:id",
    "GET /assets/:assetId/reconciliation",
    "GET /hardware-assets",
    "GET /hardware-assets/:id/history",
    "PATCH /hardware-assets/:id/status",
    "POST /hardware-assets",
    "PUT /hardware-assets/:id",
    "PUT /hardware-assets/:id/link-device",
  ],
  "invites.js": [
    "GET /",
    "GET /:token",
    "PATCH /:id/reactivate",
    "PATCH /:id/revoke",
    "POST /",
    "POST /:id/resend",
    "POST /:token/accept",
    "POST /:token/complete",
  ],
  "tickets.js": [
    "DELETE /:id",
    "GET /",
    "GET /:id",
    "GET /export",
    "PATCH /:id/assign",
    "PATCH /:id/cancel",
    "POST /",
    "POST /:id/comments",
    "PUT /:id",
  ],
  "serviceRequests.js": ["GET /", "GET /:id", "GET /popular"],
  "dashboard.js": ["GET /summary"],
};

const expectedMounts = [
  ["/api/v1/branches", "branchRoutes"],
  ["/api/v1/users", "userRoutes"],
  ["/api/v1/roles", "roleRoutes"],
  ["/api/v1/technicians", "technicianRoutes"],
  ["/api/v1/ticket-categories", "ticketCategoryRoutes"],
  ["/api/v1/knowledge-base", "knowledgeBaseRoutes"],
  ["/api/v1/software-licenses", "softwareLicenseRoutes"],
  ["/api/v1/invites", "inviteRoutes"],
  ["/api/v1/tickets", "ticketRoutes"],
  ["/api/v1/requests", "serviceRequestRoutes"],
  ["/api/v1/dashboard", "dashboardRoutes"],
];

test("decomposed administrative route modules preserve their HTTP surface", () => {
  for (const [fileName, expectedSurface] of Object.entries(expectedModules)) {
    const source = readRouteSource(fileName);
    assert.deepEqual(
      collectRouteSurface(source),
      [...expectedSurface].sort(),
      `${fileName} route surface changed`
    );
  }
});

test("server mounts each decomposed route once and has no inline duplicate", () => {
  for (const [mountPath, variableName] of expectedMounts) {
    const escapedPath = mountPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mountPattern = new RegExp(
      `app\\.use\\("${escapedPath}",\\s*${variableName}\\)`
    );
    assert.match(serverSource, mountPattern);

    const inlinePattern = new RegExp(
      `app\\.(?:get|post|put|patch|delete)\\("${escapedPath}(?:/[^"]*)?"`
    );
    assert.doesNotMatch(
      serverSource,
      inlinePattern,
      `${mountPath} still has an inline server.js handler`
    );
  }
});

test("administrative mutations retain JWT and SuperAdmin guards", () => {
  const branchSource = readRouteSource("branches.js");
  const userSource = readRouteSource("users.js");
  const roleSource = readRouteSource("roles.js");
  const categorySource = readRouteSource("ticketCategories.js");

  assert.match(
    branchSource,
    /router\.get\("\/",\s*requireAuthenticatedRequest/
  );
  assert.equal(
    (branchSource.match(/requireSuperAdminRequest,\s*async/g) || []).length,
    4
  );

  assert.match(
    userSource,
    /router\.get\("\/",\s*requireAuthenticatedRequest/
  );
  assert.equal(
    (userSource.match(/requireSuperAdminRequest,\s*async/g) || []).length,
    5
  );

  assert.match(
    roleSource,
    /router\.get\("\/",\s*requireAuthenticatedRequest/
  );
  assert.match(categorySource, /const user = getAuthFromRequest\(req\)/);
});

test("software license routes delegate persistence to a repository", () => {
  const routeSource = readRouteSource("softwareLicenses.js");
  const repositorySource = fs.readFileSync(
    path.join(
      backendRoot,
      "src",
      "repositories",
      "softwareLicenseRepository.js"
    ),
    "utf8"
  );

  assert.doesNotMatch(routeSource, /config\/db/);
  assert.doesNotMatch(routeSource, /\bdb\.(?:query|rawPool)\b/);
  assert.match(routeSource, /repositories\/softwareLicenseRepository/);
  assert.match(repositorySource, /\bdb\.query\b/);
  assert.match(repositorySource, /\bdb\.rawPool\.connect\b/);
});

test("hardware asset routes delegate SQL while preserving monitoring orchestration", () => {
  const routeSource = readRouteSource("hardwareAssets.js");
  const repositorySource = fs.readFileSync(
    path.join(
      backendRoot,
      "src",
      "repositories",
      "hardwareAssetRepository.js"
    ),
    "utf8"
  );

  assert.match(
    serverSource,
    /createHardwareAssetRoutes\(\{\s*tablesReady:\s*hardwareAssetTablesReady\s*\}\)/
  );
  assert.doesNotMatch(
    serverSource,
    /app\.(?:get|post|put|patch|delete)\("\/api\/v1\/hardware-assets/
  );
  assert.doesNotMatch(routeSource, /config\/db/);
  assert.doesNotMatch(routeSource, /\bdb\.(?:query|rawPool)\b/);
  assert.match(routeSource, /reconcileDevice\(/);
  assert.match(routeSource, /getCurrentMonitoringStatus\(/);
  assert.match(repositorySource, /\bdb\.query\b/);
});

test("legacy invitation acceptance uses the current secure completion workflow", () => {
  const inviteSource = readRouteSource("invites.js");

  assert.match(inviteSource, /const passwordHash = hashPassword\(password\)/);
  assert.match(
    inviteSource,
    /router\.post\("\/:token\/accept",[\s\S]*return completeInvite\(req, res\)/
  );
  assert.doesNotMatch(
    serverSource,
    /app\.(?:get|post)\("\/api\/v1\/invites\/:token/
  );
});

test("ticket deletion is owned by the modular authenticated ticket router", () => {
  const ticketSource = readRouteSource("tickets.js");

  assert.match(ticketSource, /router\.use\(requireAuthenticatedTicketUser\)/);
  assert.match(ticketSource, /router\.delete\("\/:id"/);
  assert.doesNotMatch(
    serverSource,
    /app\.(?:get|post|put|patch|delete)\("\/api\/v1\/tickets/
  );
});

test("schema compatibility startup is isolated from the HTTP composition root", () => {
  const schemaSource = fs.readFileSync(
    path.join(
      backendRoot,
      "src",
      "services",
      "schemaCompatibilityService.js"
    ),
    "utf8"
  );

  assert.match(serverSource, /services\/schemaCompatibilityService/);
  assert.doesNotMatch(serverSource, /CREATE TABLE|ALTER TABLE|CREATE INDEX/);
  assert.match(schemaSource, /const legacySchemaReady = \(async \(\) =>/);
});

test("shared legacy JWT guards preserve the live authorization responses", () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "route-parity-test-secret";

  const modulePath = require.resolve("../src/middleware/legacyJwtAuth");
  delete require.cache[modulePath];
  const {
    requireAuthenticatedRequest,
    requireSuperAdminRequest,
  } = require(modulePath);

  const createResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  });

  const unauthenticatedResponse = createResponse();
  requireAuthenticatedRequest(
    { headers: {} },
    unauthenticatedResponse,
    () => assert.fail("unauthenticated request called next")
  );
  assert.equal(unauthenticatedResponse.statusCode, 401);
  assert.equal(
    unauthenticatedResponse.body.error,
    "Authentication required."
  );

  const adminToken = jwt.sign(
    { userId: 4, role: "Admin", branchId: 1 },
    process.env.JWT_SECRET
  );
  const forbiddenResponse = createResponse();
  requireSuperAdminRequest(
    { headers: { authorization: `Bearer ${adminToken}` } },
    forbiddenResponse,
    () => assert.fail("Admin request called SuperAdmin next")
  );
  assert.equal(forbiddenResponse.statusCode, 403);
  assert.equal(
    forbiddenResponse.body.error,
    "SuperAdmin access required."
  );

  const superAdminToken = jwt.sign(
    { userId: 1, role: "SuperAdmin", branchId: null },
    process.env.JWT_SECRET
  );
  const request = {
    headers: { authorization: `Bearer ${superAdminToken}` },
  };
  let nextCalled = false;
  requireSuperAdminRequest(request, createResponse(), () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(request.authenticatedUser.userId, 1);

  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
  delete require.cache[modulePath];
});
