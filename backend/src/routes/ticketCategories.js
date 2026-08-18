const express = require("express");
const db = require("../../config/db");
const {
  getAuthFromRequest,
} = require("../middleware/legacyJwtAuth");
const { requireCurrentRoles } = require("../middleware/currentActor");

const router = express.Router();

router.use(requireCurrentRoles());

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
  const user = req.currentActor || getAuthFromRequest(req);
  if (!user) {
    return res
      .status(401)
      .json({ success: false, error: "Authentication required." });
  }

  const categoryName = String(req.body?.category_name || "")
    .trim()
    .replace(/\s+/g, " ");

  if (
    !categoryName ||
    categoryName.length > 100 ||
    categoryName.toLowerCase() === "other"
  ) {
    return res.status(400).json({
      success: false,
      error: "Specify a valid category up to 100 characters.",
    });
  }

  try {
    const existing = await db.query(
      `
      SELECT category_id, category_name, description
      FROM ticket_categories
      WHERE LOWER(category_name) = LOWER($1)
      LIMIT 1
      `,
      [categoryName]
    );

    if (existing.rows.length) {
      return res.json({
        success: true,
        message: "Category already exists.",
        category: existing.rows[0],
        created: false,
      });
    }

    try {
      const inserted = await db.query(
        `
        INSERT INTO ticket_categories (category_name)
        VALUES ($1)
        RETURNING category_id, category_name, description
        `,
        [categoryName]
      );

      return res.status(201).json({
        success: true,
        message: "Category created.",
        category: inserted.rows[0],
        created: true,
      });
    } catch (insertError) {
      if (insertError.code !== "23505") throw insertError;

      const concurrent = await db.query(
        `
        SELECT category_id, category_name, description
        FROM ticket_categories
        WHERE LOWER(category_name) = LOWER($1)
        LIMIT 1
        `,
        [categoryName]
      );

      return res.json({
        success: true,
        message: "Category already exists.",
        category: concurrent.rows[0],
        created: false,
      });
    }
  } catch (error) {
    console.error("Create ticket category error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to save ticket category.",
    });
  }
});

module.exports = router;
