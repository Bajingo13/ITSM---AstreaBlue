const express = require("express");
const db = require("../../config/db");
const {
  getAuthFromRequest,
  requireAuthenticatedRequest,
  requireSuperAdminRequest,
} = require("../middleware/legacyJwtAuth");

const router = express.Router();

router.get("/", requireAuthenticatedRequest, async (req, res) => {
  try {
    const auth = getAuthFromRequest(req);
    let whereClause = "";
    const params = [];

    const role = String(auth.role || "").toLowerCase();
    if (role !== "superadmin") {
      if (!auth.branchId) {
        return res
          .status(403)
          .json({ success: false, error: "Branch access denied." });
      }

      whereClause = "WHERE b.branch_id = $1";
      params.push(auth.branchId);
    }

    const result = await db.query(
      `
      SELECT
        b.branch_id,
        b.branch_name,
        b.branch_location,
        b.is_headquarters,
        b.is_active,
        b.created_at,
        admin.user_id AS admin_user_id,
        admin.full_name AS admin_name,
        admin.email AS admin_email
      FROM branches b
      LEFT JOIN LATERAL (
        SELECT u.user_id, u.full_name, u.email
        FROM users u
        JOIN system_roles sr
          ON u.role_id = sr.role_id
        WHERE u.branch_id = b.branch_id
          AND LOWER(sr.role_name) = 'admin'
          AND COALESCE(u.is_active, TRUE) = TRUE
        ORDER BY u.user_id ASC
        LIMIT 1
      ) admin ON TRUE
      ${whereClause}
      ORDER BY b.branch_name ASC
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch branches error:", err.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch branches",
    });
  }
});

router.post("/", requireSuperAdminRequest, async (req, res) => {
  try {
    const {
      branch_name,
      branch_location = null,
      is_active = true,
      is_headquarters = false,
      admin_user_id = null,
    } = req.body;

    if (!branch_name) {
      return res.status(400).json({
        success: false,
        error: "Branch name is required",
      });
    }

    const result = await db.query(
      `
      INSERT INTO branches (branch_name, branch_location, is_active, is_headquarters)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [branch_name, branch_location, is_active, is_headquarters]
    );

    if (admin_user_id) {
      await db.query(
        "UPDATE users SET branch_id = $1 WHERE user_id = $2",
        [result.rows[0].branch_id, admin_user_id]
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create branch error:", err.message);
    res.status(500).json({
      success: false,
      error: "Failed to create branch",
    });
  }
});

router.put("/:id", requireSuperAdminRequest, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      branch_name,
      branch_location = null,
      is_active = true,
      is_headquarters = false,
      admin_user_id = null,
    } = req.body;

    if (!branch_name) {
      return res.status(400).json({
        success: false,
        error: "Branch name is required",
      });
    }

    const result = await db.query(
      `
      UPDATE branches
      SET
        branch_name = $1,
        branch_location = $2,
        is_active = $3,
        is_headquarters = $4
      WHERE branch_id = $5
      RETURNING *
      `,
      [branch_name, branch_location, is_active, is_headquarters, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Branch not found",
      });
    }

    if (admin_user_id) {
      await db.query(
        "UPDATE users SET branch_id = $1 WHERE user_id = $2",
        [id, admin_user_id]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update branch error:", err.message);
    res.status(500).json({
      success: false,
      error: "Failed to update branch",
    });
  }
});

router.patch("/:id/status", requireSuperAdminRequest, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    if (typeof is_active !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "is_active must be true or false",
      });
    }

    const result = await db.query(
      `
      UPDATE branches
      SET is_active = $1
      WHERE branch_id = $2
      RETURNING *
      `,
      [is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Branch not found",
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update branch status error:", err.message);
    res.status(500).json({
      success: false,
      error: "Failed to update branch status",
    });
  }
});

router.patch("/:id/admin", requireSuperAdminRequest, async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: "Admin user is required",
      });
    }

    const result = await db.query(
      `
      UPDATE users
      SET branch_id = $1
      WHERE user_id = $2
      RETURNING user_id, full_name, email, branch_id
      `,
      [id, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Assign branch admin error:", err.message);
    res.status(500).json({
      success: false,
      error: "Failed to assign branch admin",
    });
  }
});

module.exports = router;
