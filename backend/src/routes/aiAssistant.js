const express = require("express");
const { getAuthFromRequest } = require("../middleware/legacyJwtAuth");
const { createAiAssistantService } = require("../services/aiAssistantService");

function createAiAssistantRoutes({ service = createAiAssistantService() } = {}) {
  const router = express.Router();

  router.post("/chat", async (req, res) => {
    const tokenUser = getAuthFromRequest(req);
    if (!tokenUser?.userId && !tokenUser?.user_id) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    try {
      const data = await service.ask({
        tokenUser,
        message: req.body?.message,
        history: req.body?.history,
        ipAddress: req.ip || req.socket?.remoteAddress || null,
      });
      return res.json({ success: true, data });
    } catch (error) {
      console.error("[ai-assistant] request failed:", error.message);
      return res.status(error.status || 500).json({
        success: false,
        message: error.status ? error.message : "The assistant could not process this request.",
      });
    }
  });

  return router;
}

module.exports = createAiAssistantRoutes();
module.exports.createAiAssistantRoutes = createAiAssistantRoutes;
