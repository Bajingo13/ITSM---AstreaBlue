const express = require("express");
const db = require("../../config/db");

const router = express.Router();

async function ensureKnowledgeBaseTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS knowledge_base (
        kb_id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        symptoms TEXT,
        resolution TEXT,
        created_by INTEGER REFERENCES users(user_id),
        related_ticket_id INTEGER REFERENCES tickets(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.error("Knowledge base table setup error:", err.message);
  }
}

ensureKnowledgeBaseTable();

router.get("/", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        kb.kb_id,
        kb.title,
        kb.category,
        kb.symptoms,
        kb.resolution,
        kb.created_by,
        kb.related_ticket_id,
        kb.created_at,
        kb.updated_at,
        u.full_name AS created_by_name,
        t.ticket_number AS related_ticket_number
      FROM knowledge_base kb
      LEFT JOIN users u
        ON kb.created_by = u.user_id
      LEFT JOIN tickets t
        ON kb.related_ticket_id = t.id
      ORDER BY kb.updated_at DESC, kb.created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch knowledge base error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch knowledge base articles",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `
      SELECT
        kb.kb_id,
        kb.title,
        kb.category,
        kb.symptoms,
        kb.resolution,
        kb.created_by,
        kb.related_ticket_id,
        kb.created_at,
        kb.updated_at,
        u.full_name AS created_by_name,
        t.ticket_number AS related_ticket_number
      FROM knowledge_base kb
      LEFT JOIN users u
        ON kb.created_by = u.user_id
      LEFT JOIN tickets t
        ON kb.related_ticket_id = t.id
      WHERE kb.kb_id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Knowledge base article not found",
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Fetch knowledge base article error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch knowledge base article",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      title,
      category = null,
      symptoms = null,
      resolution = null,
      created_by = null,
      related_ticket_id = null,
    } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: "Title is required",
      });
    }

    const result = await db.query(
      `
      INSERT INTO knowledge_base
      (title, category, symptoms, resolution, created_by, related_ticket_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        title,
        category || null,
        symptoms || null,
        resolution || null,
        created_by || null,
        related_ticket_id || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create knowledge base article error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to create knowledge base article",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      category = null,
      symptoms = null,
      resolution = null,
      related_ticket_id = null,
    } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: "Title is required",
      });
    }

    const result = await db.query(
      `
      UPDATE knowledge_base
      SET
        title = $1,
        category = $2,
        symptoms = $3,
        resolution = $4,
        related_ticket_id = $5,
        updated_at = CURRENT_TIMESTAMP
      WHERE kb_id = $6
      RETURNING *
      `,
      [
        title,
        category || null,
        symptoms || null,
        resolution || null,
        related_ticket_id || null,
        id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Knowledge base article not found",
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update knowledge base article error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to update knowledge base article",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `
      DELETE FROM knowledge_base
      WHERE kb_id = $1
      RETURNING kb_id
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Knowledge base article not found",
      });
    }

    res.json({
      success: true,
      message: "Knowledge base article deleted successfully",
    });
  } catch (err) {
    console.error("Delete knowledge base article error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to delete knowledge base article",
    });
  }
});

module.exports = router;
