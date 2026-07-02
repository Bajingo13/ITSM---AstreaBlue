const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const router = express.Router();
const db = require("../../config/db");

const JWT_SECRET = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
const JWT_EXPIRES = "8h";

const bcrypt = require("bcryptjs");
const { sendPasswordResetEmail } = require("../services/emailService");

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

router.post("/login", async (req, res) => {
  // ... existing login code remains unchanged ...
  try {
    const { email, password } = req.body;

    const result = await db.query(
      `
      SELECT
        u.user_id,
        u.full_name,
        u.email,
        u.password_hash,
        u.company_name,
        u.branch_id,
        u.mobile_number,
        COALESCE(u.is_active, TRUE) AS is_active,
        b.branch_name,
        sr.role_name
      FROM users u
      JOIN system_roles sr ON u.role_id = sr.role_id
      LEFT JOIN branches b ON u.branch_id = b.branch_id
      WHERE u.email = $1
      LIMIT 1
      `,
      [email]
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

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required" });
  }

  try {
    const userResult = await db.query("SELECT user_id FROM users WHERE email = $1 LIMIT 1", [email]);
    
    if (userResult.rows.length > 0) {
      const userId = userResult.rows[0].user_id;
      const token = crypto.randomBytes(32).toString("hex");
      
      const expiresAt = new Date(Date.now() + 30 * 60000); // 30 minutes
      
      await db.query(
        "INSERT INTO password_resets (token, user_id, expires_at) VALUES ($1, $2, $3)",
        [token, userId, expiresAt]
      );
      
      const frontendUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, "") : "http://localhost:5173";
      const resetLink = `${frontendUrl}/reset-password/${token}`;
      
      const emailResult = await sendPasswordResetEmail(email, resetLink);
      if (emailResult && !emailResult.success) {
        return res.status(500).json({
          success: false,
          message: "Failed to send reset email. SMTP configuration may be incomplete."
        });
      }
    }
  } catch (error) {
    console.error("Forgot password error:", error.message);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }

  // Always return generic message to prevent email enumeration
  return res.json({ 
    success: true, 
    message: "If the email exists, a reset link has been sent." 
  });
});

router.post("/reset-password", async (req, res) => {
  const { token, password } = req.body;
  
  if (!token || !password) {
    return res.status(400).json({ success: false, message: "Token and password are required" });
  }

  if (password.length < 8) {
    return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
  }

  try {
    const resetResult = await db.query(
      "SELECT reset_id, user_id FROM password_resets WHERE token = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP",
      [token]
    );

    if (resetResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset token" });
    }

    const { reset_id, user_id } = resetResult.rows[0];

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);

    await db.query("UPDATE users SET password_hash = $1 WHERE user_id = $2", [hash, user_id]);
    await db.query("UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE reset_id = $1", [reset_id]);

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
