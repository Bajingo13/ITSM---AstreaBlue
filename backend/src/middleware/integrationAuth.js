const {
  auditIntegrationRequest,
  findIntegrationByApiKey,
  touchIntegration,
} = require("../services/integrationService");

function extractIntegrationApiKey(req) {
  const headerKey = req.headers["x-api-key"];
  return headerKey ? String(headerKey).trim() : null;
}

async function requireIntegrationApiKey(req, res, next) {
  try {
    req.integrationStartedAt = Date.now();
    const apiKey = extractIntegrationApiKey(req);
    const integration = await findIntegrationByApiKey(apiKey);

    if (!integration) {
      await auditIntegrationRequest(req, "Authentication Failed", {
        success: false,
        statusCode: 401,
      });
      return res.status(401).json({
        success: false,
        message: "Invalid API key.",
        data: null,
      });
    }

    const integrationStatus = String(integration.status || "").toLowerCase();
    const keyStatus = String(integration.key_status || "").toLowerCase();
    if (integrationStatus !== "active" || keyStatus !== "active") {
      await auditIntegrationRequest(req, "Authentication Failed", {
        integrationId: integration.integration_id,
        success: false,
        statusCode: 403,
        metadata: { reason: integrationStatus !== "active" ? "integration_inactive" : "api_key_inactive" },
      });
      return res.status(403).json({
        success: false,
        message: "External system is disabled.",
        data: null,
      });
    }

    req.integration = integration;
    console.info(JSON.stringify({ event: "external_authentication_succeeded", integration_id: integration.integration_id }));
    await touchIntegration(integration.integration_id, integration.key_id);
    await auditIntegrationRequest(req, "integration_authenticated", {
      integrationId: integration.integration_id,
      statusCode: 200,
    });
    return next();
  } catch (err) {
    console.error("Integration authentication error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Integration authentication failed.",
      data: null,
    });
  }
}

module.exports = { requireIntegrationApiKey };
