const express = require("express");
const db = require("../../config/db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        category_id,
        category_name,
        description
      FROM ticket_categories
      ORDER BY category_name ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch categories error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch ticket categories",
    });
  }
});

module.exports = router;
