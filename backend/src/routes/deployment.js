const express = require("express");
const { getDeploymentConfig } = require("../config/deployment");

const router = express.Router();

router.get("/", (_req, res) => {
  const deployment = getDeploymentConfig();
  res.json({
    success: true,
    data: {
      instance_id: deployment.instanceId,
      profile: deployment.profile,
      capabilities: deployment.capabilities,
    },
  });
});

module.exports = router;
