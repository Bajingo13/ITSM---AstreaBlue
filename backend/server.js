const express = require("express");
const cors = require("cors");
const db = require("./config/db");
const authRoutes = require("./src/routes/auth");

require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

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

async function ensureUserStatusColumn() {
  try {
    await db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active'
    `);
  } catch (err) {
    console.error("User status column setup error:", err.message);
  }
}

ensureUserStatusColumn();

async function ensureRoleBranchManagement() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS branches (
        branch_id SERIAL PRIMARY KEY,
        branch_name VARCHAR(150) NOT NULL,
        branch_location VARCHAR(255),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id),
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS mobile_number VARCHAR(20)
    `);

    await db.query(`
      INSERT INTO system_roles (role_name)
      SELECT role_name
      FROM (VALUES
        ('SuperAdmin'),
        ('Admin'),
        ('Technician'),
        ('Employee')
      ) AS required_roles(role_name)
      WHERE NOT EXISTS (
        SELECT 1
        FROM system_roles sr
        WHERE LOWER(sr.role_name) = LOWER(required_roles.role_name)
      )
    `);
  } catch (err) {
    console.error("Role/branch setup error:", err.message);
  }
}

ensureRoleBranchManagement();

/* ==========================
   AUTH ROUTES
========================== */

app.use("/api/auth", authRoutes);

/* ==========================
   HEALTH CHECK
========================== */

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "AstreaBlue API is running",
  });
});

/* ==========================
   TICKET CATEGORIES
========================== */

app.get("/api/v1/ticket-categories", async (req, res) => {
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

/* ==========================
   TECHNICIANS
========================== */

app.get("/api/v1/technicians", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        u.user_id,
        u.full_name,
        u.email,
        sr.role_name
      FROM users u
      JOIN system_roles sr
        ON u.role_id = sr.role_id
      WHERE LOWER(sr.role_name) = 'technician'
      ORDER BY u.full_name ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch technicians error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch technicians",
    });
  }
});

/* ==========================
   USER MANAGEMENT
========================== */

app.get("/api/v1/roles", async (req, res) => {
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

app.get("/api/v1/branches", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        b.branch_id,
        b.branch_name,
        b.branch_location,
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
      ORDER BY b.branch_name ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch branches error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch branches",
    });
  }
});

app.post("/api/v1/branches", async (req, res) => {
  try {
    const { branch_name, branch_location = null, is_active = true, admin_user_id = null } = req.body;

    if (!branch_name) {
      return res.status(400).json({
        success: false,
        error: "Branch name is required",
      });
    }

    const result = await db.query(
      `
      INSERT INTO branches (branch_name, branch_location, is_active)
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [branch_name, branch_location, is_active]
    );

    if (admin_user_id) {
      await db.query(
        `UPDATE users SET branch_id = $1 WHERE user_id = $2`,
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

app.put("/api/v1/branches/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { branch_name, branch_location = null, is_active = true, admin_user_id = null } = req.body;

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
        is_active = $3
      WHERE branch_id = $4
      RETURNING *
      `,
      [branch_name, branch_location, is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Branch not found",
      });
    }

    if (admin_user_id) {
      await db.query(
        `UPDATE users SET branch_id = $1 WHERE user_id = $2`,
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

app.patch("/api/v1/branches/:id/status", async (req, res) => {
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

app.patch("/api/v1/branches/:id/admin", async (req, res) => {
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

app.get("/api/v1/users", async (req, res) => {
  try {
    const result = await db.query(`
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
      ORDER BY u.created_at DESC, u.user_id DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch users error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch users",
    });
  }
});

app.post("/api/v1/users", async (req, res) => {
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
        finalPassword,
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

app.put("/api/v1/users/:id", async (req, res) => {
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

app.patch("/api/v1/users/:id/reset-password", async (req, res) => {
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

    const result = await db.query(
      `
      UPDATE users
      SET password_hash = $1
      WHERE user_id = $2
      RETURNING user_id
      `,
      [finalPassword, id]
    );

    if (result.rows.length === 0) {
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
});

app.patch("/api/v1/users/:id/status", async (req, res) => {
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

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update user status error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to update user status",
    });
  }
});

/* ==========================
   KNOWLEDGE BASE
========================== */

app.get("/api/v1/knowledge-base", async (req, res) => {
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

app.get("/api/v1/knowledge-base/:id", async (req, res) => {
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

app.post("/api/v1/knowledge-base", async (req, res) => {
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

app.put("/api/v1/knowledge-base/:id", async (req, res) => {
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

app.delete("/api/v1/knowledge-base/:id", async (req, res) => {
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

/* ==========================
   TICKETS
========================== */

app.get("/api/v1/tickets", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        t.id,
        t.ticket_number,
        t.title,
        t.description AS desc,
        t.description,
        t.priority,
        t.status,
        t.source,
        t.impact,
        t.urgency,
        t.sla_due_date,
        t.first_response_at,
        t.resolved_at,
        t.closed_at,
        t.resolution_notes,
        t.satisfaction_rating,
        t.created_at,
        t.updated_at,

        c.category_id,
        c.category_name AS category,

        requester.user_id AS requester_id,
        requester.full_name AS requester_name,
        requester.email AS requester_email,

        assignee.user_id AS assigned_to,
        assignee.full_name AS assigned_name,
        assignee.email AS assigned_email

      FROM tickets t
      LEFT JOIN ticket_categories c
        ON t.category_id = c.category_id
      LEFT JOIN users requester
        ON t.requester_id = requester.user_id
      LEFT JOIN users assignee
        ON t.assigned_to = assignee.user_id
      ORDER BY t.created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch tickets error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch tickets",
    });
  }
});

app.get("/api/v1/tickets/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const ticketResult = await db.query(
      `
      SELECT
        t.id,
        t.ticket_number,
        t.title,
        t.description AS desc,
        t.description,
        t.priority,
        t.status,
        t.source,
        t.impact,
        t.urgency,
        t.sla_due_date,
        t.first_response_at,
        t.resolved_at,
        t.closed_at,
        t.resolution_notes,
        t.satisfaction_rating,
        t.created_at,
        t.updated_at,

        c.category_id,
        c.category_name AS category,

        requester.user_id AS requester_id,
        requester.full_name AS requester_name,
        requester.email AS requester_email,

        assignee.user_id AS assigned_to,
        assignee.full_name AS assigned_name,
        assignee.email AS assigned_email

      FROM tickets t
      LEFT JOIN ticket_categories c
        ON t.category_id = c.category_id
      LEFT JOIN users requester
        ON t.requester_id = requester.user_id
      LEFT JOIN users assignee
        ON t.assigned_to = assignee.user_id
      WHERE t.id = $1
      `,
      [id]
    );

    if (ticketResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found",
      });
    }

    const commentsResult = await db.query(
      `
      SELECT
        tc.comment_id,
        tc.comment_text,
        tc.is_internal,
        tc.created_at,
        u.user_id,
        u.full_name,
        u.email
      FROM ticket_comments tc
      LEFT JOIN users u
        ON tc.user_id = u.user_id
      WHERE tc.ticket_id = $1
      ORDER BY tc.created_at ASC
      `,
      [id]
    );

    const historyResult = await db.query(
      `
      SELECT
        th.history_id,
        th.action,
        th.old_value,
        th.new_value,
        th.created_at,
        u.user_id,
        u.full_name,
        u.email
      FROM ticket_history th
      LEFT JOIN users u
        ON th.changed_by = u.user_id
      WHERE th.ticket_id = $1
      ORDER BY th.created_at ASC
      `,
      [id]
    );

    res.json({
      ...ticketResult.rows[0],
      comments: commentsResult.rows,
      history: historyResult.rows,
    });
  } catch (err) {
    console.error("Fetch single ticket error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch ticket",
    });
  }
});

app.post("/api/v1/tickets", async (req, res) => {
  try {
    const {
      title,
      description,
      desc,
      priority = "P3-Medium",
      status = "Open Queue",
      category_id = null,
      requester_id = null,
      assigned_to = null,
      source = "portal",
      impact = null,
      urgency = null,
    } = req.body;

    const finalDescription = description || desc || "";

    if (!title || !finalDescription) {
      return res.status(400).json({
        success: false,
        error: "Title and description are required",
      });
    }

    const countResult = await db.query(`
      SELECT COUNT(*)::int AS count
      FROM tickets
      WHERE DATE(created_at) = CURRENT_DATE
    `);

    const nextNumber = countResult.rows[0].count + 1;

    const ticketNumber = `TKT-${new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "")}-${String(nextNumber).padStart(4, "0")}`;

    const slaDueDate = new Date();
    slaDueDate.setHours(slaDueDate.getHours() + 24);

    const result = await db.query(
      `
      INSERT INTO tickets
      (
        ticket_number,
        title,
        description,
        priority,
        status,
        category_id,
        requester_id,
        assigned_to,
        source,
        impact,
        urgency,
        sla_due_date
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING
        id,
        ticket_number,
        title,
        description AS desc,
        description,
        priority,
        status,
        source,
        impact,
        urgency,
        sla_due_date,
        created_at,
        updated_at
      `,
      [
        ticketNumber,
        title,
        finalDescription,
        priority,
        status,
        category_id,
        requester_id,
        assigned_to,
        source,
        impact,
        urgency,
        slaDueDate,
      ]
    );

    await db.query(
      `
      INSERT INTO ticket_history
      (ticket_id, changed_by, action, old_value, new_value)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        result.rows[0].id,
        requester_id,
        "Ticket Created",
        null,
        result.rows[0].status,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create ticket error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to create ticket",
    });
  }
});

app.put("/api/v1/tickets/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      title,
      description,
      desc,
      priority,
      status,
      category_id,
      requester_id,
      assigned_to,
      source,
      impact,
      urgency,
      resolution_notes,
      satisfaction_rating,
      changed_by = null,
    } = req.body;

    const existingResult = await db.query(
      `SELECT * FROM tickets WHERE id = $1`,
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found",
      });
    }

    const existing = existingResult.rows[0];

    const finalDescription =
      description !== undefined
        ? description
        : desc !== undefined
        ? desc
        : existing.description;

    const finalStatus = status ?? existing.status;

    const resolvedAt =
      finalStatus === "Resolved" && !existing.resolved_at
        ? new Date()
        : existing.resolved_at;

    const closedAt =
      finalStatus === "Closed" && !existing.closed_at
        ? new Date()
        : existing.closed_at;

    const result = await db.query(
      `
      UPDATE tickets
      SET
        title = $1,
        description = $2,
        priority = $3,
        status = $4,
        category_id = $5,
        requester_id = $6,
        assigned_to = $7,
        source = $8,
        impact = $9,
        urgency = $10,
        resolution_notes = $11,
        satisfaction_rating = $12,
        resolved_at = $13,
        closed_at = $14
      WHERE id = $15
      RETURNING
        id,
        ticket_number,
        title,
        description AS desc,
        description,
        priority,
        status,
        source,
        impact,
        urgency,
        sla_due_date,
        resolved_at,
        closed_at,
        resolution_notes,
        satisfaction_rating,
        created_at,
        updated_at
      `,
      [
        title ?? existing.title,
        finalDescription,
        priority ?? existing.priority,
        finalStatus,
        category_id ?? existing.category_id,
        requester_id ?? existing.requester_id,
        assigned_to ?? existing.assigned_to,
        source ?? existing.source,
        impact ?? existing.impact,
        urgency ?? existing.urgency,
        resolution_notes ?? existing.resolution_notes,
        satisfaction_rating ?? existing.satisfaction_rating,
        resolvedAt,
        closedAt,
        id,
      ]
    );

    if (status && status !== existing.status) {
      await db.query(
        `
        INSERT INTO ticket_history
        (ticket_id, changed_by, action, old_value, new_value)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [id, changed_by, "Status Updated", existing.status, status]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update ticket error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to update ticket",
    });
  }
});

app.patch("/api/v1/tickets/:id/assign", async (req, res) => {
  try {
    const { id } = req.params;
    const { assigned_to, changed_by = null } = req.body;

    const existingResult = await db.query(
      `SELECT assigned_to FROM tickets WHERE id = $1`,
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found",
      });
    }

    const result = await db.query(
      `
      UPDATE tickets
      SET assigned_to = $1
      WHERE id = $2
      RETURNING
        id,
        ticket_number,
        title,
        description AS desc,
        priority,
        status,
        assigned_to,
        updated_at
      `,
      [assigned_to || null, id]
    );

    await db.query(
      `
      INSERT INTO ticket_history
      (ticket_id, changed_by, action, old_value, new_value)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        id,
        changed_by,
        "Ticket Assigned",
        existingResult.rows[0].assigned_to,
        assigned_to || null,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Assign ticket error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to assign ticket",
    });
  }
});

app.post("/api/v1/tickets/:id/comments", async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id = null, comment_text, is_internal = false } = req.body;

    if (!comment_text) {
      return res.status(400).json({
        success: false,
        error: "Comment text is required",
      });
    }

    const result = await db.query(
      `
      INSERT INTO ticket_comments
      (ticket_id, user_id, comment_text, is_internal)
      VALUES ($1,$2,$3,$4)
      RETURNING *
      `,
      [id, user_id, comment_text, is_internal]
    );

    await db.query(
      `
      INSERT INTO ticket_history
      (ticket_id, changed_by, action, old_value, new_value)
      VALUES ($1,$2,$3,$4,$5)
      `,
      [id, user_id, "Comment Added", null, comment_text]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Add comment error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to add comment",
    });
  }
});

app.delete("/api/v1/tickets/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `
      DELETE FROM tickets
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found",
      });
    }

    res.json({
      success: true,
      message: "Ticket deleted successfully",
    });
  } catch (err) {
    console.error("Delete ticket error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to delete ticket",
    });
  }
});

/* ==========================
   START SERVER
========================== */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🪐 AstreaBlue Secure Server active on port ${PORT}`);
});
