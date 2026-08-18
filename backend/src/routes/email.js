const express = require("express");
const { getMissingSmtpConfig, sendTestEmail } = require("../services/emailService");
const { requireCurrentRoles } = require("../middleware/currentActor");

const router = express.Router();
router.post("/test", requireCurrentRoles("superadmin"), async (req, res) => {
  const to = String(req.body?.to || "").trim();
  if (!/^\S+@\S+\.\S+$/.test(to)) {
    return res.status(400).json({ success: false, error: "A valid recipient email is required." });
  }

  const missingConfig = getMissingSmtpConfig();
  if (missingConfig.length) {
    return res.status(503).json({
      success: false,
      provider: String(process.env.EMAIL_PROVIDER || "smtp").toLowerCase(),
      error: `Email configuration is incomplete. Missing: ${missingConfig.join(", ")}.`,
    });
  }

  const result = await sendTestEmail(to);
  return res.status(result.success ? 200 : 502).json(result);
});

module.exports = router;
