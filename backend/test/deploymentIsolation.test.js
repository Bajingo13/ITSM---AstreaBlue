process.env.NODE_ENV = "test";
// Require the Main-only routers with no profile set so module load stays on the
// fail-closed STANDARD path (no schema/DB work at import time).
delete process.env.DEPLOYMENT_PROFILE;
delete process.env.INSTANCE_TYPE;

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const jwt = require("jsonwebtoken");

const integrationsRouter = require("../src/routes/integrations");
const integrationGatewayRouter = require("../src/routes/integrationGateway");
const branchRoutes = require("../src/routes/branches");

const secret = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
const superAdminToken = jwt.sign(
  { userId: 1, role: "SuperAdmin", branchId: null },
  secret,
  { expiresIn: "5m" }
);

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/integrations", integrationsRouter);
  app.use("/api/v1/external", integrationGatewayRouter);
  app.use("/api/v1/branches", branchRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

function withProfile(profile, run) {
  const previous = process.env.DEPLOYMENT_PROFILE;
  if (profile === undefined) delete process.env.DEPLOYMENT_PROFILE;
  else process.env.DEPLOYMENT_PROFILE = profile;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (previous === undefined) delete process.env.DEPLOYMENT_PROFILE;
      else process.env.DEPLOYMENT_PROFILE = previous;
    });
}

test("STANDARD deployment blocks Integration Hub before auth, even for SuperAdmin", async () => {
  await withProfile("STANDARD", async () => {
    const anonymous = await fetch(`${baseUrl}/api/v1/integrations/dashboard`);
    assert.equal(anonymous.status, 403);
    assert.equal((await anonymous.json()).code, "DEPLOYMENT_CAPABILITY_DISABLED");

    const asSuperAdmin = await fetch(`${baseUrl}/api/v1/integrations`, {
      headers: { authorization: `Bearer ${superAdminToken}` },
    });
    assert.equal(asSuperAdmin.status, 403);
    assert.equal((await asSuperAdmin.json()).code, "DEPLOYMENT_CAPABILITY_DISABLED");
  });
});

test("STANDARD deployment blocks external ticket intake", async () => {
  await withProfile("STANDARD", async () => {
    const created = await fetch(`${baseUrl}/api/v1/external/tickets`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "irrelevant-on-standard" },
      body: JSON.stringify({ title: "should never be accepted" }),
    });
    assert.equal(created.status, 403);
    assert.equal((await created.json()).code, "DEPLOYMENT_CAPABILITY_DISABLED");
  });
});

test("default (unset) profile is treated as STANDARD and stays fail-closed", async () => {
  await withProfile(undefined, async () => {
    const response = await fetch(`${baseUrl}/api/v1/integrations`);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "DEPLOYMENT_CAPABILITY_DISABLED");
  });
});

test("MAIN_HUB deployment lets the same requests past the capability gate", async () => {
  await withProfile("MAIN_HUB", async () => {
    // Past the gate the request meets normal auth/validation, so it is no longer
    // a capability denial. Any non-DEPLOYMENT_CAPABILITY_DISABLED outcome proves
    // the gate is profile-aware rather than a hard block.
    const hub = await fetch(`${baseUrl}/api/v1/integrations`, {
      headers: { authorization: `Bearer ${superAdminToken}` },
    });
    const hubBody = await hub.json().catch(() => ({}));
    assert.notEqual(hubBody.code, "DEPLOYMENT_CAPABILITY_DISABLED");

    const gateway = await fetch(`${baseUrl}/api/v1/external/tickets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "missing api key" }),
    });
    const gatewayBody = await gateway.json().catch(() => ({}));
    assert.notEqual(gatewayBody.code, "DEPLOYMENT_CAPABILITY_DISABLED");
    assert.equal(gateway.status, 401); // stopped by API-key auth, not by the profile
  });
});

test("normal modules are unaffected by the deployment profile", async () => {
  await withProfile("STANDARD", async () => {
    const response = await fetch(`${baseUrl}/api/v1/branches`);
    // No auth -> 401, never a deployment-capability denial.
    assert.equal(response.status, 401);
    const body = await response.json().catch(() => ({}));
    assert.notEqual(body.code, "DEPLOYMENT_CAPABILITY_DISABLED");
  });
});

test("server.js mounts the Main-only routers behind their capability gate", () => {
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(serverSource, /app\.use\("\/api\/v1\/external",\s*integrationGatewayRoutes\)/);
  assert.match(serverSource, /app\.use\("\/api\/v1\/integrations",\s*integrationManagementRoutes\)/);

  const gatewaySource = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "integrationGateway.js"), "utf8");
  const integrationsSource = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "integrations.js"), "utf8");
  assert.match(gatewaySource, /router\.use\(requireDeploymentCapability\("externalTicketIntake"\)\)/);
  assert.match(integrationsSource, /router\.use\(requireDeploymentCapability\("integrationManagement"\)\)/);
});
