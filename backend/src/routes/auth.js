const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const router = express.Router();
const db = require("../../config/db");

const JWT_SECRET = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
const JWT_EXPIRES = "8h";

function passwordMatches(inputPassword, storedPassword) {
  if (!storedPassword) return false;

  if (storedPassword.startsWith("sha256$")) {
    const inputHash = crypto
      .createHash("sha256")
      .update(inputPassword || "")
      .digest("hex");
    return storedPassword === `sha256$${inputHash}`;
  }

  return inputPassword === storedPassword;
}

router.post("/login", async (req, res) => {
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

    // Issue JWT so backend can enforce RBAC on service request endpoints
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

router.get("/me", (req, res) => {
  res.json({
    success: true,
    message: "Auth route working",
  });
});

module.exports = router;
