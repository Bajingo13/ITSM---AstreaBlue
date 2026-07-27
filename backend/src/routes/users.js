const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../../config/db");
const {
  getAuthFromRequest,
  requireAuthenticatedRequest,
  requireSuperAdminRequest,
} = require("../middleware/legacyJwtAuth");
const { validateStrongPassword } = require("../services/passwordPolicyService");

const router = express.Router();

router.get("/", requireAuthenticatedRequest, async (req, res) => {
  try {
    const auth = getAuthFromRequest(req);
    let whereClause = "";
    const params = [];

    const role = String(auth.role || "").toLowerCase();
    if (role === "employee") {
      whereClause = "WHERE u.user_id = $1";
      params.push(auth.userId);
    } else if (role !== "superadmin") {
      if (!auth.branchId) {
        return res
          .status(403)
          .json({ success: false, error: "Branch access denied." });
      }

      whereClause = "WHERE u.branch_id = $1";
      params.push(auth.branchId);
    }

    const result = await db.query(
      `
      SELECT
        u.user_id,
        u.full_name,
        u.email,
        u.company_name,
        u.mobile_number,
        u.branch_id,
        b.branch_name,
        u.role_id,
        sr.role_name,
        COALESCE(u.is_active, TRUE) AS is_active,
        CASE
          WHEN COALESCE(u.is_active, TRUE) = TRUE THEN 'Active'
          ELSE 'Inactive'
        END AS status,
        u.created_at
      FROM users u
      LEFT JOIN system_roles sr
        ON u.role_id = sr.role_id
      LEFT JOIN branches b
        ON u.branch_id = b.branch_id
      ${whereClause}
      ORDER BY u.created_at DESC, u.user_id DESC
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch users error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch users",
    });
  }
});

router.post("/", requireSuperAdminRequest, async (req, res) => {
  try {
    const {
      full_name,
      email,
      password,
      password_hash,
      role_id,
      company_name = null,
      branch_id = null,
      mobile_number = null,
      status = "Active",
      is_active,
    } = req.body;

    const finalPassword = password_hash || password;
    const finalIsActive =
      typeof is_active === "boolean" ? is_active : status !== "Inactive";

    if (!full_name || !email || !finalPassword || !role_id) {
      return res.status(400).json({
        success: false,
        error: "Full name, email, temporary password, and role are required",
      });
    }

    const passwordValidation = validateStrongPassword(finalPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        success: false,
        error: passwordValidation.message,
      });
    }

    const hashedPwd = bcrypt.hashSync(finalPassword, 12);

    const result = await db.query(
      `
      INSERT INTO users
      (full_name, email, password_hash, role_id, company_name, branch_id, mobile_number, status, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING user_id, full_name, email, company_name, branch_id, mobile_number, role_id, status, is_active, created_at
      `,
      [
        full_name,
        email,
        hashedPwd,
        role_id,
        company_name,
        branch_id || null,
        mobile_number || null,
        finalIsActive ? "Active" : "Inactive",
        finalIsActive,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create user error:", err.message);

    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "A user with this email already exists",
      });
    }

    res.status(500).json({
      success: false,
      error: "Failed to create user",
    });
  }
});

router.put("/:id", requireSuperAdminRequest, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      full_name,
      email,
      role_id,
      company_name = null,
      branch_id = null,
      mobile_number = null,
      status = "Active",
      is_active,
    } = req.body;
    const finalIsActive =
      typeof is_active === "boolean" ? is_active : status !== "Inactive";

    if (!full_name || !email || !role_id) {
      return res.status(400).json({
        success: false,
        error: "Full name, email, and role are required",
      });
    }

    const result = await db.query(
      `
      UPDATE users
      SET
        full_name = $1,
        email = $2,
        role_id = $3,
        company_name = $4,
        status = $5,
        is_active = $6,
        branch_id = $7,
        mobile_number = $8
      WHERE user_id = $9
      RETURNING user_id, full_name, email, company_name, branch_id, mobile_number, role_id, status, is_active, created_at
      `,
      [
        full_name,
        email,
        role_id,
        company_name,
        finalIsActive ? "Active" : "Inactive",
        finalIsActive,
        branch_id || null,
        mobile_number || null,
        id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update user error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to update user",
    });
  }
});

router.patch(
  "/:id/reset-password",
  requireSuperAdminRequest,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { password, password_hash } = req.body;
      const finalPassword = password_hash || password;

      if (!finalPassword) {
        return res.status(400).json({
          success: false,
          error: "Temporary password is required",
        });
      }

      const passwordValidation = validateStrongPassword(finalPassword);
      if (!passwordValidation.valid) {
        return res.status(400).json({
          success: false,
          error: passwordValidation.message,
        });
      }

      const hashedPwd = bcrypt.hashSync(finalPassword, 12);

      const result = await db.query(
        `
        UPDATE users
        SET password_hash = $1
        WHERE user_id = $2 AND COALESCE(is_active, TRUE) = TRUE
        RETURNING user_id
        `,
        [hashedPwd, id]
      );

      if (result.rows.length === 0) {
        const userResult = await db.query(
          "SELECT COALESCE(is_active, TRUE) AS is_active FROM users WHERE user_id = $1",
          [id]
        );
        if (userResult.rows.length && !userResult.rows[0].is_active) {
          return res.status(409).json({
            success: false,
            error: "Reactivate this account before resetting its password.",
          });
        }
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      res.json({ success: true, message: "Password reset successfully" });
    } catch (err) {
      console.error("Reset password error:", err.message);

      res.status(500).json({
        success: false,
        error: "Failed to reset password",
      });
    }
  }
);

router.patch("/:id/status", requireSuperAdminRequest, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["Active", "Inactive"].includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Status must be Active or Inactive",
      });
    }

    const nextIsActive = status === "Active";

    const result = await db.query(
      `
      UPDATE users
      SET
        status = $1,
        is_active = $2
      WHERE user_id = $3
      RETURNING user_id, status, is_active
      `,
      [status, nextIsActive, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    if (!nextIsActive) {
      await db.query(
        "UPDATE password_resets SET used_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND used_at IS NULL",
        [id]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update user status error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to update user status",
    });
  }
});

router.post("/invite", requireSuperAdminRequest, async (req, res) => {
  try {
    const {
      full_name,
      email,
      role_id,
      branch_id = null,
      company_name = null,
      mobile_number = null,
      invited_by = null,
    } = req.body;

    if (!email || !role_id) {
      return res.status(400).json({
        success: false,
        error: "Email and role are required",
      });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const result = await db.query(
      `
      INSERT INTO user_invites
      (token, email, full_name, role_id, branch_id, company_name, mobile_number, invited_by, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP + INTERVAL '7 days')
      RETURNING *
      `,
      [
        token,
        email,
        full_name || null,
        role_id,
        branch_id || null,
        company_name,
        mobile_number,
        invited_by,
      ]
    );

    res.status(201).json({
      ...result.rows[0],
      invite_link: `http://localhost:5173/register-invite/${token}`,
    });
  } catch (err) {
    console.error("Create invite error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to create invite",
    });
  }
});

module.exports = router;
