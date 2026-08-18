const express = require("express");
const db = require("../../config/db");
const {
  getAuthFromRequest,
} = require("../middleware/legacyJwtAuth");
const { requireCurrentRoles } = require("../middleware/currentActor");

const router = express.Router();
const PUBLICATION_STATUSES = new Set(["Draft", "Published", "Archived"]);

router.use(requireCurrentRoles());

function normalizePublicationStatus(value) {
  const normalized = String(value || "Published").trim().toLowerCase();
  return [...PUBLICATION_STATUSES].find(
    (status) => status.toLowerCase() === normalized
  ) || null;
}

function normalizeRole(role) {
  return String(role || "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function isSuperAdmin(role) {
  return normalizeRole(role) === "superadmin";
}

function isAdmin(role) {
  return normalizeRole(role) === "admin";
}

function isTechnician(role) {
  return normalizeRole(role) === "technician";
}

function buildKnowledgeBaseScope(user, startIndex = 1) {
  if (!user) return { unauthorized: true };
  if (isSuperAdmin(user.role)) return { clause: "", params: [] };
  if (!user.branchId) return { forbidden: true };

  return {
    clause: `kb.branch_id = $${startIndex}`,
    params: [user.branchId],
  };
}

function userCanManageKnowledgeBase(user) {
  return (
    user &&
    (isSuperAdmin(user.role) ||
      isAdmin(user.role) ||
      isTechnician(user.role))
  );
}

function userCanEditKnowledgeBase(user, articleBranchId) {
  if (!user) return false;
  if (isSuperAdmin(user.role)) return true;
  if (!user.branchId) return false;

  return (
    (isAdmin(user.role) || isTechnician(user.role)) &&
    Number(user.branchId) === Number(articleBranchId)
  );
}

router.get("/", async (req, res) => {
  try {
    const user = req.currentActor || getAuthFromRequest(req);
    if (!user) {
      return res
        .status(401)
        .json({ success: false, error: "Authentication required." });
    }

    const scope = buildKnowledgeBaseScope(user, 1);
    if (scope.unauthorized) {
      return res
        .status(401)
        .json({ success: false, error: "Authentication required." });
    }
    if (scope.forbidden) {
      return res.status(403).json({
        success: false,
        error: "Access denied for your role or branch.",
      });
    }

    const { ticket_id, category, search } = req.query;
    const whereClauses = [];
    const queryParams = [...scope.params];
    let index = scope.params.length + 1;

    if (scope.clause) whereClauses.push(scope.clause);
    if (!userCanManageKnowledgeBase(user)) {
      whereClauses.push(
        "LOWER(COALESCE(kb.publication_status, 'Published')) = 'published'"
      );
    }

    if (category && category !== "All") {
      whereClauses.push(`LOWER(kb.category) = LOWER($${index})`);
      queryParams.push(category);
      index += 1;
    }

    if (ticket_id) {
      whereClauses.push(`kb.related_ticket_id = $${index}`);
      queryParams.push(ticket_id);
      index += 1;
    }

    if (search && search.trim()) {
      whereClauses.push(`(
        kb.title ILIKE $${index} OR
        kb.category ILIKE $${index} OR
        kb.tags ILIKE $${index} OR
        kb.symptoms ILIKE $${index} OR
        kb.resolution ILIKE $${index}
      )`);
      queryParams.push(`%${search.trim()}%`);
    }

    const whereString = whereClauses.length
      ? `WHERE ${whereClauses.join(" AND ")}`
      : "";

    const result = await db.query(
      `
      SELECT
        kb.kb_id,
        kb.title,
        kb.category,
        kb.tags,
        kb.symptoms,
        kb.resolution,
        kb.branch_id,
        kb.created_by,
        kb.related_ticket_id,
        kb.views,
        kb.helpful_count,
        kb.publication_status,
        kb.published_at,
        kb.archived_at,
        kb.created_at,
        kb.updated_at,
        u.full_name AS created_by_name,
        t.ticket_number AS related_ticket_number,
        b.branch_name
      FROM knowledge_base kb
      LEFT JOIN users u ON kb.created_by = u.user_id
      LEFT JOIN tickets t ON kb.related_ticket_id = t.id
      LEFT JOIN branches b ON kb.branch_id = b.branch_id
      ${whereString}
      ORDER BY kb.updated_at DESC, kb.created_at DESC
      `,
      queryParams
    );

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
    const user = req.currentActor || getAuthFromRequest(req);
    if (!user) {
      return res
        .status(401)
        .json({ success: false, error: "Authentication required." });
    }

    const scope = buildKnowledgeBaseScope(user, 2);
    if (scope.unauthorized) {
      return res
        .status(401)
        .json({ success: false, error: "Authentication required." });
    }
    if (scope.forbidden) {
      return res.status(403).json({
        success: false,
        error: "Access denied for your role or branch.",
      });
    }

    const { id } = req.params;
    const queryParams = [id, ...scope.params];
    const accessClauses = [];
    if (scope.clause) accessClauses.push(scope.clause);
    if (!userCanManageKnowledgeBase(user)) {
      accessClauses.push(
        "LOWER(COALESCE(kb.publication_status, 'Published')) = 'published'"
      );
    }
    const clause = accessClauses.length
      ? `AND ${accessClauses.join(" AND ")}`
      : "";

    const result = await db.query(
      `
      SELECT
        kb.kb_id,
        kb.title,
        kb.category,
        kb.tags,
        kb.symptoms,
        kb.resolution,
        kb.branch_id,
        kb.created_by,
        kb.related_ticket_id,
        kb.views,
        kb.helpful_count,
        kb.publication_status,
        kb.published_at,
        kb.archived_at,
        kb.created_at,
        kb.updated_at,
        u.full_name AS created_by_name,
        t.ticket_number AS related_ticket_number,
        b.branch_name
      FROM knowledge_base kb
      LEFT JOIN users u ON kb.created_by = u.user_id
      LEFT JOIN tickets t ON kb.related_ticket_id = t.id
      LEFT JOIN branches b ON kb.branch_id = b.branch_id
      WHERE kb.kb_id = $1
      ${clause}
      LIMIT 1
      `,
      queryParams
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
    const user = req.currentActor || getAuthFromRequest(req);
    if (!user) {
      return res
        .status(401)
        .json({ success: false, error: "Authentication required." });
    }

    if (!userCanManageKnowledgeBase(user)) {
      return res.status(403).json({
        success: false,
        error:
          "Only technicians, branch admins, and superadmins can create articles.",
      });
    }

    const {
      title,
      category = null,
      tags = null,
      symptoms = null,
      resolution = null,
      related_ticket_id = null,
      branch_id = null,
    } = req.body;

    if (!title) {
      return res
        .status(400)
        .json({ success: false, error: "Title is required" });
    }

    const articleBranchId = isSuperAdmin(user.role)
      ? branch_id || null
      : user.branchId;

    if (!articleBranchId) {
      return res.status(400).json({
        success: false,
        error: "Branch is required for knowledge base articles.",
      });
    }

    if (related_ticket_id) {
      const existingArticle = await db.query(
        "SELECT kb_id, title FROM knowledge_base WHERE related_ticket_id = $1 LIMIT 1",
        [Number(related_ticket_id)]
      );

      if (existingArticle.rows.length) {
        return res.status(409).json({
          success: false,
          message: "Article already created for this ticket.",
          error: "Article already created for this ticket.",
          data: existingArticle.rows[0],
        });
      }
    }

    const result = await db.query(
      `
      INSERT INTO knowledge_base
      (title, category, tags, symptoms, resolution, branch_id, created_by,
       related_ticket_id, publication_status, published_at, archived_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Published', CURRENT_TIMESTAMP, NULL)
      RETURNING *
      `,
      [
        title,
        category || null,
        tags || null,
        symptoms || null,
        resolution || null,
        articleBranchId,
        user.userId || user.id || null,
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
    const user = req.currentActor || getAuthFromRequest(req);
    if (!user) {
      return res
        .status(401)
        .json({ success: false, error: "Authentication required." });
    }

    if (!userCanManageKnowledgeBase(user)) {
      return res.status(403).json({
        success: false,
        error:
          "Only technicians, branch admins, and superadmins can update articles.",
      });
    }

    const { id } = req.params;
    const {
      title,
      category = null,
      tags = null,
      symptoms = null,
      resolution = null,
      related_ticket_id = null,
      branch_id = null,
    } = req.body;

    if (!title) {
      return res
        .status(400)
        .json({ success: false, error: "Title is required" });
    }

    const existing = await db.query(
      "SELECT branch_id FROM knowledge_base WHERE kb_id = $1",
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Knowledge base article not found",
      });
    }

    const existingBranchId = existing.rows[0].branch_id;
    if (!userCanEditKnowledgeBase(user, existingBranchId)) {
      return res.status(403).json({
        success: false,
        error: "Update denied for this article branch.",
      });
    }

    const effectiveBranchId = isSuperAdmin(user.role)
      ? branch_id || existingBranchId
      : existingBranchId;

    const result = await db.query(
      `
      UPDATE knowledge_base
      SET
        title = $1,
        category = $2,
        tags = $3,
        symptoms = $4,
        resolution = $5,
        branch_id = $6,
        related_ticket_id = $7,
        updated_at = CURRENT_TIMESTAMP
      WHERE kb_id = $8
      RETURNING *
      `,
      [
        title,
        category || null,
        tags || null,
        symptoms || null,
        resolution || null,
        effectiveBranchId,
        related_ticket_id || null,
        id,
      ]
    );

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
    const user = req.currentActor || getAuthFromRequest(req);
    if (!user) {
      return res
        .status(401)
        .json({ success: false, error: "Authentication required." });
    }

    if (!userCanManageKnowledgeBase(user)) {
      return res.status(403).json({
        success: false,
        error:
          "Only technicians, branch admins, and superadmins can delete articles.",
      });
    }

    const { id } = req.params;
    const existing = await db.query(
      "SELECT branch_id FROM knowledge_base WHERE kb_id = $1",
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Knowledge base article not found",
      });
    }

    if (!userCanEditKnowledgeBase(user, existing.rows[0].branch_id)) {
      return res.status(403).json({
        success: false,
        error: "Delete denied for this article branch.",
      });
    }

    await db.query(
      `
      DELETE FROM knowledge_base
      WHERE kb_id = $1
      RETURNING kb_id
      `,
      [id]
    );

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
