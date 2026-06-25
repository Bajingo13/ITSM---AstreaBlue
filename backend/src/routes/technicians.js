const express = require("express");
const db = require("../../config/db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { branch_id } = req.query;

    const params = [];
    let branchFilter = "";

    if (branch_id) {
      params.push(branch_id);
      branchFilter = `AND u.branch_id = $${params.length}`;
    }

    const result = await db.query(
      `
      SELECT
        u.user_id,
        u.full_name,
        u.email,
        u.branch_id,
        COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,
        sr.role_name
      FROM users u
      JOIN system_roles sr
        ON u.role_id = sr.role_id
      LEFT JOIN branches b
        ON u.branch_id = b.branch_id
      WHERE LOWER(sr.role_name) = 'technician'
        AND COALESCE(u.is_active, TRUE) = TRUE
        ${branchFilter}
      ORDER BY u.full_name ASC
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch technicians error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch technicians",
    });
  }
});

module.exports = router;