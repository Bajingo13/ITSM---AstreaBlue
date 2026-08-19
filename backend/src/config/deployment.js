const DEPLOYMENT_PROFILES = Object.freeze({
  MAIN_HUB: "MAIN_HUB",
  STANDARD: "STANDARD",
});

const PROFILE_CAPABILITIES = Object.freeze({
  [DEPLOYMENT_PROFILES.MAIN_HUB]: Object.freeze({
    centralSupport: true,
    externalTicketIntake: true,
    integrationManagement: true,
    crossSystemAnalytics: true,
  }),
  [DEPLOYMENT_PROFILES.STANDARD]: Object.freeze({
    centralSupport: false,
    externalTicketIntake: false,
    integrationManagement: false,
    crossSystemAnalytics: false,
  }),
});

function resolveDeploymentConfig(env = process.env) {
  const rawProfile = String(env.DEPLOYMENT_PROFILE || env.INSTANCE_TYPE || "STANDARD")
    .trim()
    .toUpperCase();
  if (!Object.hasOwn(PROFILE_CAPABILITIES, rawProfile)) {
    throw new Error(`DEPLOYMENT_PROFILE must be one of: ${Object.keys(PROFILE_CAPABILITIES).join(", ")}.`);
  }

  const instanceId = String(env.INSTANCE_ID || "LOCAL").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(instanceId)) {
    throw new Error("INSTANCE_ID must contain 1-64 letters, numbers, underscores, or hyphens.");
  }

  return Object.freeze({
    instanceId,
    profile: rawProfile,
    capabilities: PROFILE_CAPABILITIES[rawProfile],
  });
}

function getDeploymentConfig() {
  return resolveDeploymentConfig(process.env);
}

function validateDeploymentEnvironment(env = process.env) {
  const deployment = resolveDeploymentConfig(env);
  if (String(env.NODE_ENV || "").toLowerCase() !== "production") return deployment;

  const missing = [];
  if (!String(env.DEPLOYMENT_PROFILE || env.INSTANCE_TYPE || "").trim()) missing.push("DEPLOYMENT_PROFILE");
  if (!String(env.INSTANCE_ID || "").trim()) missing.push("INSTANCE_ID");
  if (!String(env.FRONTEND_URL || env.CORS_ALLOWED_ORIGINS || "").trim()) missing.push("FRONTEND_URL");
  if (!String(env.DATABASE_URL || "").trim()) missing.push("DATABASE_URL");
  if (!String(env.JWT_SECRET || "").trim()) missing.push("JWT_SECRET");
  if (missing.length) {
    throw new Error(`Missing required production configuration: ${missing.join(", ")}.`);
  }

  const frontendUrls = [env.FRONTEND_URL, ...String(env.CORS_ALLOWED_ORIGINS || "").split(",")]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (frontendUrls.some((value) => !/^https:\/\//i.test(value))) {
    throw new Error("Production frontend origins must use HTTPS.");
  }
  return deployment;
}

function hasDeploymentCapability(capability) {
  return getDeploymentConfig().capabilities[capability] === true;
}

function assertDeploymentCapability(capability) {
  if (hasDeploymentCapability(capability)) return;
  const error = new Error("This deployment does not provide that capability.");
  error.statusCode = 403;
  error.code = "DEPLOYMENT_CAPABILITY_DISABLED";
  throw error;
}

module.exports = {
  DEPLOYMENT_PROFILES,
  assertDeploymentCapability,
  getDeploymentConfig,
  hasDeploymentCapability,
  resolveDeploymentConfig,
  validateDeploymentEnvironment,
};
