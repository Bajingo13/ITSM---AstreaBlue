const express = require("express");
const jwt = require("jsonwebtoken");
const { getMissingSmtpConfig, sendTestEmail } = require("../services/emailService");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";

function requireSuperAdmin(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";
    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }

    const user = jwt.verify(authorization.slice(7), JWT_SECRET);
    const role = String(user.role || "").toLowerCase().replace(/[\s_-]/g, "");
    if (role !== "superadmin") {
      return res.status(403).json({ success: false, error: "SuperAdmin access required." });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, error: error.message });
  }
}

router.post("/test", requireSuperAdmin, async (req, res) => {
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
