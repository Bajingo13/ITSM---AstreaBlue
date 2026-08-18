const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const router = express.Router();
const db = require("../../config/db");

const JWT_SECRET = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
const JWT_EXPIRES = "8h";

const bcrypt = require("bcryptjs");
const { getMissingSmtpConfig, sendPasswordResetEmail } = require("../services/emailService");
const { validateStrongPassword } = require("../services/passwordPolicyService");
const { createRateLimit } = require("../middleware/rateLimit");

const loginIpRateLimit = createRateLimit({ windowMs: 15 * 60 * 1000, max: 50 });
const loginAccountRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: (req) => `${req.ip}:${String(req.body?.email || "").trim().toLowerCase()}`,
});
const resetRequestRateLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 5 });
const resetCompletionRateLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 10 });

function passwordMatches(inputPassword, storedPassword) {
  if (!storedPassword) return false;

  if (storedPassword.startsWith("sha256$")) {
    const inputHash = crypto
      .createHash("sha256")
      .update(inputPassword || "")
      .digest("hex");
    return storedPassword === `sha256$${inputHash}`;
  }

  // Check if it's a bcrypt hash (starts with $2a$, $2b$, or $2y$)
  if (storedPassword.startsWith("$2a$") || storedPassword.startsWith("$2b$") || storedPassword.startsWith("$2y$")) {
    return bcrypt.compareSync(inputPassword, storedPassword);
  }

  return inputPassword === storedPassword;
}

function isBcryptHash(value) {
  return /^\$2[aby]\$/.test(String(value || ""));
}

function hashOpaqueToken(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

router.post("/login", loginIpRateLimit, loginAccountRateLimit, async (req, res) => {
  // ... existing login code remains unchanged ...
  try {
    const { email, password } = req.body;
    const loginEmail = String(email || "").trim().toLowerCase();

    const result = await db.query(
      `
      SELECT
        u.user_id,
        u.full_name,
        COALESCE(NULLIF(u.company_email, ''), u.email) AS email,
        u.password_hash,
        u.company_name,
        u.branch_id,
        u.mobile_number,
        COALESCE(u.onboarding_status, 'Completed') AS onboarding_status,
        COALESCE(u.onboarding_required, FALSE) AS onboarding_required,
        u.onboarding_completed_at,
        u.onboarding_consent_id,
        COALESCE(u.is_active, TRUE) AS is_active,
        b.branch_name,
        sr.role_name
      FROM users u
      JOIN system_roles sr ON u.role_id = sr.role_id
      LEFT JOIN branches b ON u.branch_id = b.branch_id
      WHERE LOWER(COALESCE(NULLIF(u.company_email, ''), u.email)) = $1
      LIMIT 1
      `,
      [loginEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });

    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "This account is inactive. Please contact your administrator.",
      });
    }

    if (!passwordMatches(password, user.password_hash)) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    if (!isBcryptHash(user.password_hash)) {
      const upgradedHash = bcrypt.hashSync(password, 10);
      await db.query("UPDATE users SET password_hash = $1 WHERE user_id = $2", [
        upgradedHash,
        user.user_id,
      ]);
    }

    const tokenPayload = {
      userId: user.user_id,
      role: user.role_name,
      branchId: user.branch_id || null,
      email: user.email,
      name: user.full_name,
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    return res.json({
      success: true,
      token,
      user: {
        user_id: user.user_id,
        full_name: user.full_name,
        email: user.email,
        company_name: user.company_name,
        branch_id: user.branch_id,
        branch_name: user.branch_name,
        mobile_number: user.mobile_number,
        is_active: user.is_active,
        role_name: user.role_name,
        onboarding_status: user.onboarding_status,
        onboarding_required: user.onboarding_required,
        onboarding_completed_at: user.onboarding_completed_at,
        onboarding_consent_id: user.onboarding_consent_id,
        must_complete_onboarding: Boolean((String(user.role_name || "").toLowerCase().replace(/[\s_-]/g, "") === "employee" || user.onboarding_required) && user.onboarding_status !== "Completed"),
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
});

router.post("/forgot-password", resetRequestRateLimit, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ success: false, message: "A valid email address is required." });
  }

  const missingConfig = getMissingSmtpConfig();
  if (missingConfig.length) {
    console.error("Password reset email unavailable", { missingConfig });
    return res.status(503).json({
      success: false,
      message: "Email delivery is not configured. A SuperAdmin must complete the SMTP settings in Railway.",
    });
  }

  let pendingTokenHash = null;
  try {
    const userResult = await db.query(
      `SELECT user_id
         FROM users
        WHERE LOWER(COALESCE(NULLIF(company_email, ''), email)) = $1
          AND COALESCE(is_active, TRUE) = TRUE
        LIMIT 1`,
      [email]
    );
    
    if (userResult.rows.length > 0) {
      const userId = userResult.rows[0].user_id;
      const token = crypto.randomBytes(32).toString("hex");
      pendingTokenHash = hashOpaqueToken(token);
      
      const expiresAt = new Date(Date.now() + 30 * 60000); // 30 minutes
      
      await db.query(
        "INSERT INTO password_resets (token, user_id, expires_at) VALUES ($1, $2, $3)",
        [pendingTokenHash, userId, expiresAt]
      );
      
      const frontendUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, "") : "http://localhost:5173";
      const resetLink = `${frontendUrl}/reset-password/${token}`;
      
      const emailResult = await sendPasswordResetEmail(email, resetLink);
      if (emailResult && !emailResult.success) {
        await db.query("DELETE FROM password_resets WHERE token=$1 AND used_at IS NULL", [pendingTokenHash]);
        pendingTokenHash = null;
        console.error("Password reset email delivery failed", { provider: emailResult.provider, error: emailResult.error });
        return res.status(502).json({
          success: false,
          message: "Email delivery failed. Ask a SuperAdmin to run the Email Test and verify the Railway SMTP variables."
        });
      }
      await db.query(
        "UPDATE password_resets SET used_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND token<>$2 AND used_at IS NULL",
        [userId, pendingTokenHash]
      );
      pendingTokenHash = null;
    }
  } catch (error) {
    console.error("Forgot password error:", error.message);
    if (pendingTokenHash) {
      await db.query("DELETE FROM password_resets WHERE token=$1 AND used_at IS NULL", [pendingTokenHash]).catch(() => {});
    }
    return res.status(500).json({ success: false, message: "Unable to process the password reset request." });
  }

  // Always return generic message to prevent email enumeration
  return res.json({ 
    success: true, 
    message: "If the email exists, a reset link has been sent." 
  });
});

router.post("/reset-password", resetCompletionRateLimit, async (req, res) => {
  const { token, password } = req.body;
  
  if (!token || !password) {
    return res.status(400).json({ success: false, message: "Token and password are required" });
  }

  const passwordValidation = validateStrongPassword(password);
  if (!passwordValidation.valid) {
    return res.status(400).json({ success: false, message: passwordValidation.message });
  }

  try {
    const tokenHash = hashOpaqueToken(token);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const resetResult = await client.query(
        `UPDATE password_resets pr
            SET used_at = CURRENT_TIMESTAMP
           FROM users u
          WHERE pr.user_id = u.user_id
            AND pr.token IN ($1, $2)
            AND pr.used_at IS NULL
            AND pr.expires_at > CURRENT_TIMESTAMP
            AND COALESCE(u.is_active, TRUE) = TRUE
          RETURNING pr.user_id`,
        [tokenHash, token]
      );
      if (resetResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, message: "Invalid or expired reset token" });
      }

      const hash = bcrypt.hashSync(password, 10);
      await client.query("UPDATE users SET password_hash = $1 WHERE user_id = $2", [
        hash,
        resetResult.rows[0].user_id,
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    return res.json({ success: true, message: "Password successfully updated" });
  } catch (error) {
    console.error("Reset password error:", error.message);
    return res.status(500).json({ success: false, message: "An error occurred while resetting password" });
  }
});

router.get("/me", (req, res) => {
  res.json({
    success: true,
    message: "Auth route working",
  });
});

module.exports = router;
