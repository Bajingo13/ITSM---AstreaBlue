const express = require("express");
const { getAuthFromRequest } = require("../middleware/legacyJwtAuth");
const { createAiAssistantService } = require("../services/aiAssistantService");

function createAiAssistantRoutes({ service = createAiAssistantService() } = {}) {
  const router = express.Router();

  function requireTokenUser(req, res) {
    const tokenUser = getAuthFromRequest(req);
    if (!tokenUser?.userId && !tokenUser?.user_id) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return null;
    }
    return tokenUser;
  }

  router.get("/suggestions", async (req, res) => {
    const tokenUser = requireTokenUser(req, res);
    if (!tokenUser) return;

    try {
      const data = await service.getSuggestions({ tokenUser });
      return res.json({ success: true, data });
    } catch (error) {
      console.error("[ai-assistant] suggestions failed:", error.message);
      return res.status(error.status || 500).json({
        success: false,
        message: error.status ? error.message : "Suggested questions are unavailable.",
      });
    }
  });

  router.post("/feedback", async (req, res) => {
    const tokenUser = requireTokenUser(req, res);
    if (!tokenUser) return;

    try {
      const data = await service.submitFeedback({
        tokenUser,
        question: req.body?.question,
        responseMode: req.body?.response_mode,
        helpful: req.body?.helpful,
      });
      return res.status(201).json({ success: true, data });
    } catch (error) {
      console.error("[ai-assistant] feedback failed:", error.message);
      return res.status(error.status || 500).json({
        success: false,
        message: error.status ? error.message : "Feedback could not be saved.",
      });
    }
  });

  router.post("/chat", async (req, res) => {
    const tokenUser = requireTokenUser(req, res);
    if (!tokenUser) return;

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
