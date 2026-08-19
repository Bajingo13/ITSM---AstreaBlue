const { getDeploymentConfig, hasDeploymentCapability } = require("../config/deployment");

function requireDeploymentCapability(capability) {
  return (req, res, next) => {
    if (hasDeploymentCapability(capability)) return next();

    const deployment = getDeploymentConfig();
    console.warn(JSON.stringify({
      event: "deployment_capability_denied",
      instance_id: deployment.instanceId,
      profile: deployment.profile,
      capability,
      method: req.method,
      path: req.originalUrl,
    }));
    return res.status(403).json({
      success: false,
      code: "DEPLOYMENT_CAPABILITY_DISABLED",
      message: "This function is not available on this deployment.",
    });
  };
}

module.exports = { requireDeploymentCapability };
