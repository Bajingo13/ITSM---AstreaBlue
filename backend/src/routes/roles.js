const express = require("express");
const db = require("../../config/db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT role_id, role_name
      FROM system_roles
      ORDER BY
        CASE LOWER(role_name)
          WHEN 'superadmin' THEN 1
          WHEN 'admin' THEN 2
          WHEN 'technician' THEN 3
          WHEN 'employee' THEN 4
          ELSE 5
        END,
        role_name ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch roles error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch roles",
    });
  }
});

module.exports = router;
