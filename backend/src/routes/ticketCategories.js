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

router.post("/", async (req, res) => {
  try {
    const { category_name } = req.body;

    if (!category_name || !category_name.trim()) {
      return res.status(400).json({
        success: false,
        error: "Category name is required.",
      });
    }

    const trimmed = category_name.trim();

    // Case-insensitive duplicate check
    const existing = await db.query(
      `SELECT category_id, category_name FROM ticket_categories WHERE LOWER(category_name) = LOWER($1)`,
      [trimmed]
    );

    if (existing.rows.length > 0) {
      return res.json({
        success: true,
        category: existing.rows[0],
        message: "Category already exists.",
      });
    }

    const result = await db.query(
      `INSERT INTO ticket_categories (category_name) VALUES ($1) RETURNING category_id, category_name`,
      [trimmed]
    );

    res.status(201).json({
      success: true,
      category: result.rows[0],
      message: "Category created.",
    });
  } catch (err) {
    console.error("Create category error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to create ticket category",
    });
  }
});

module.exports = router;
