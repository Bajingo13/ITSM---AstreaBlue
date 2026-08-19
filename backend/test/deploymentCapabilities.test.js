const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEPLOYMENT_PROFILES,
  resolveDeploymentConfig,
  validateDeploymentEnvironment,
} = require("../src/config/deployment");
const { requireDeploymentCapability } = require("../src/middleware/deploymentCapability");
const { addTicketAccessFilter } = require("../src/routes/_ticketAccess");

test("STANDARD is the fail-closed default and has no central capabilities", () => {
  const deployment = resolveDeploymentConfig({});
  assert.equal(deployment.profile, DEPLOYMENT_PROFILES.STANDARD);
  assert.equal(deployment.instanceId, "LOCAL");
  assert.equal(deployment.capabilities.centralSupport, false);
  assert.equal(deployment.capabilities.externalTicketIntake, false);
  assert.equal(deployment.capabilities.integrationManagement, false);
});

test("MAIN_HUB derives central support capabilities", () => {
  const deployment = resolveDeploymentConfig({
    DEPLOYMENT_PROFILE: "main_hub",
    INSTANCE_ID: "main-production",
  });
  assert.equal(deployment.profile, DEPLOYMENT_PROFILES.MAIN_HUB);
  assert.equal(deployment.instanceId, "MAIN-PRODUCTION");
  assert.equal(deployment.capabilities.centralSupport, true);
  assert.equal(deployment.capabilities.externalTicketIntake, true);
  assert.equal(deployment.capabilities.integrationManagement, true);
});

test("invalid deployment profiles and identities fail validation", () => {
  assert.throws(() => resolveDeploymentConfig({ DEPLOYMENT_PROFILE: "UNKNOWN" }), /DEPLOYMENT_PROFILE/);
  assert.throws(() => resolveDeploymentConfig({ INSTANCE_ID: "invalid instance name" }), /INSTANCE_ID/);
});

test("production requires explicit isolated deployment configuration", () => {
  assert.throws(
    () => validateDeploymentEnvironment({ NODE_ENV: "production" }),
    /DEPLOYMENT_PROFILE.*INSTANCE_ID.*FRONTEND_URL.*DATABASE_URL.*JWT_SECRET/
  );
  const deployment = validateDeploymentEnvironment({
    NODE_ENV: "production",
    DEPLOYMENT_PROFILE: "STANDARD",
    INSTANCE_ID: "AOC",
    FRONTEND_URL: "https://aoc.example.com",
    DATABASE_URL: "postgresql://configured-without-connecting",
    JWT_SECRET: "configured-without-printing",
  });
  assert.equal(deployment.instanceId, "AOC");
  assert.equal(deployment.profile, "STANDARD");
});

test("production rejects insecure browser origins", () => {
  assert.throws(() => validateDeploymentEnvironment({
    NODE_ENV: "production",
    DEPLOYMENT_PROFILE: "STANDARD",
    INSTANCE_ID: "ORTIGAS",
    FRONTEND_URL: "http://ortigas.example.com",
    DATABASE_URL: "postgresql://configured-without-connecting",
    JWT_SECRET: "configured-without-printing",
  }), /HTTPS/);
});

test("Standard deployment denies direct Main-only API access before downstream middleware", () => {
  const previousProfile = process.env.DEPLOYMENT_PROFILE;
  process.env.DEPLOYMENT_PROFILE = "STANDARD";
  let nextCalled = false;
  let statusCode;
  let body;
  const req = { method: "GET", originalUrl: "/api/v1/integrations" };
  const res = {
    status(value) {
      statusCode = value;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };

  try {
    requireDeploymentCapability("integrationManagement")(req, res, () => {
      nextCalled = true;
    });
  } finally {
    if (previousProfile === undefined) delete process.env.DEPLOYMENT_PROFILE;
    else process.env.DEPLOYMENT_PROFILE = previousProfile;
  }

  assert.equal(statusCode, 403);
  assert.equal(body.code, "DEPLOYMENT_CAPABILITY_DISABLED");
  assert.equal(nextCalled, false);
});

test("Standard deployment excludes central tickets even for SuperAdmin", () => {
  const previousProfile = process.env.DEPLOYMENT_PROFILE;
  process.env.DEPLOYMENT_PROFILE = "STANDARD";
  try {
    const clauses = addTicketAccessFilter({
      ticketAccessContext: {
        authenticated: true,
        currentUserId: 1,
        roleName: "superadmin",
        branchId: null,
        filterBranchId: null,
      },
    }, []);
    assert.deepEqual(clauses, [
      "t.integration_id IS NULL",
      "COALESCE(t.created_via, '') <> 'External API'",
    ]);
  } finally {
    if (previousProfile === undefined) delete process.env.DEPLOYMENT_PROFILE;
    else process.env.DEPLOYMENT_PROFILE = previousProfile;
  }
});
