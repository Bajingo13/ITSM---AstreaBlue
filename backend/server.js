const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const db = require("./config/db");
const authRoutes = require("./src/routes/auth");

const app = express();

app.use(cors());
app.use(express.json());

const ticketUploadDir = path.join(__dirname, "uploads", "tickets");
fs.mkdirSync(ticketUploadDir, { recursive: true });
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const allowedAttachmentMimeTypes = new Set([
  "image/jpg",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const ticketAttachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ticketUploadDir),
  filename: (req, file, cb) => {
    const safeBase = path
      .basename(file.originalname)
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeBase}`);
  },
});

const uploadTicketAttachments = multer({
  storage: ticketAttachmentStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!allowedAttachmentMimeTypes.has(file.mimetype)) {
      return cb(new Error("Only JPG, JPEG, PNG, WEBP, and PDF files are supported"));
    }
    cb(null, true);
  },
});

async function ensureKnowledgeBaseTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS knowledge_base (
        kb_id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        tags TEXT,
        symptoms TEXT,
        resolution TEXT,
        branch_id INTEGER REFERENCES branches(branch_id),
        created_by INTEGER REFERENCES users(user_id),
        related_ticket_id INTEGER REFERENCES tickets(id),
        views INTEGER DEFAULT 0,
        helpful_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      ALTER TABLE knowledge_base
      ADD COLUMN IF NOT EXISTS tags TEXT,
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id),
      ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS helpful_count INTEGER DEFAULT 0
    `);
  } catch (err) {
    console.error("Knowledge base table setup error:", err.message);
  }
}

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

async function ensureTicketWorkflowColumns() {
  try {
    await db.query(`
      ALTER TABLE tickets
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id),
      ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS cancelled_by INTEGER REFERENCES users(user_id),
      ADD COLUMN IF NOT EXISTS cancellation_reason TEXT
    `);
  } catch (err) {
    console.error("Ticket workflow column setup error:", err.message);
  }
}

async function ensureRoleBranchManagement() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS branches (
        branch_id SERIAL PRIMARY KEY,
        branch_name VARCHAR(150) NOT NULL,
        branch_location VARCHAR(255),
        is_headquarters BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      ALTER TABLE branches
      ADD COLUMN IF NOT EXISTS is_headquarters BOOLEAN DEFAULT FALSE
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

    await db.query(`
      INSERT INTO users
      (full_name, email, password_hash, role_id, company_name, status, is_active)
      SELECT
        'Super Administrator',
        'superadmin@astreablue.com',
        'superadmin123',
        sr.role_id,
        'AstreaBlue',
        'Active',
        TRUE
      FROM system_roles sr
      WHERE LOWER(sr.role_name) = 'superadmin'
        AND NOT EXISTS (
          SELECT 1
          FROM users u
          WHERE LOWER(u.email) = 'superadmin@astreablue.com'
        )
      LIMIT 1
    `);
  } catch (err) {
    console.error("Role/branch setup error:", err.message);
  }
}

ensureRoleBranchManagement();
ensureKnowledgeBaseTable();
ensureTicketWorkflowColumns();

async function ensureAttachmentsAndInvites() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ticket_attachments (
        attachment_id SERIAL PRIMARY KEY,
        ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
        file_name VARCHAR(255),
        file_path TEXT,
        file_size INTEGER,
        mime_type VARCHAR(100),
        uploaded_by INTEGER REFERENCES users(user_id),
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      ALTER TABLE ticket_attachments
      ADD COLUMN IF NOT EXISTS file_path TEXT,
      ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100),
      ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    await db.query(`
      ALTER TABLE ticket_attachments
      ALTER COLUMN file_data DROP NOT NULL
    `).catch(() => {});

    await db.query(`
      CREATE TABLE IF NOT EXISTS user_invites (
        invite_id SERIAL PRIMARY KEY,
        token VARCHAR(120) UNIQUE NOT NULL,
        email VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        role_id INTEGER REFERENCES system_roles(role_id),
        branch_id INTEGER REFERENCES branches(branch_id),
        company_name VARCHAR(255),
        mobile_number VARCHAR(20),
        invited_by INTEGER REFERENCES users(user_id),
        accepted_at TIMESTAMP,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.error("Attachments/invites setup error:", err.message);
  }
}

ensureAttachmentsAndInvites();

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
   DASHBOARD SUMMARY
========================== */

function getDashboardAccessFilter(req) {
  const role = String(req.query.role_name || "").toLowerCase();
  const branchId = req.query.current_branch_id || req.query.branch_id;
  const userId = req.query.current_user_id || req.query.user_id;

  if (role === "superadmin") {
    return { whereSql: "", params: [] };
  }

  if ((role === "admin" || role === "technician") && branchId) {
    return {
      whereSql: "WHERE COALESCE(t.branch_id, requester.branch_id) = $1",
      params: [branchId],
    };
  }

  if (role === "employee" && userId) {
    return {
      whereSql: "WHERE t.requester_id = $1",
      params: [userId],
    };
  }

  return { whereSql: "", params: [] };
}

app.get("/api/v1/dashboard/summary", async (req, res) => {
  try {
    const { whereSql, params } = getDashboardAccessFilter(req);

    const statsResult = await db.query(
      `
      SELECT
        COUNT(*)::int AS total_tickets,
        COUNT(*) FILTER (WHERE t.status = 'Open Queue')::int AS open_tickets,
        COUNT(*) FILTER (WHERE t.status = 'In Progress')::int AS in_progress_tickets,
        COUNT(*) FILTER (
          WHERE t.priority = 'P1-Critical'
            AND t.status IN ('Open Queue', 'In Progress')
        )::int AS critical_tickets,
        COUNT(*) FILTER (WHERE t.status = 'Resolved')::int AS resolved_tickets,
        COUNT(*) FILTER (WHERE t.status = 'Closed')::int AS closed_tickets,
        COUNT(*) FILTER (WHERE t.status = 'Cancelled')::int AS cancelled_tickets
      FROM tickets t
      LEFT JOIN users requester
        ON t.requester_id = requester.user_id
      ${whereSql}
      `,
      params
    );

    const recentResult = await db.query(
      `
      SELECT
        t.id,
        t.ticket_number,
        t.title,
        t.priority,
        t.status,
        COALESCE(t.branch_id, requester.branch_id) AS branch_id,
        COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,
        t.created_at
      FROM tickets t
      LEFT JOIN users requester
        ON t.requester_id = requester.user_id
      LEFT JOIN branches b
        ON COALESCE(t.branch_id, requester.branch_id) = b.branch_id
      ${whereSql}
      ORDER BY t.created_at DESC
      LIMIT 10
      `,
      params
    );

    const stats = statsResult.rows[0] || {};

    res.json({
      success: true,
      stats: {
        openTickets: stats.open_tickets || 0,
        inProgressTickets: stats.in_progress_tickets || 0,
        criticalTickets: stats.critical_tickets || 0,
        resolvedTickets: stats.resolved_tickets || 0,
        closedTickets: stats.closed_tickets || 0,
        cancelledTickets: stats.cancelled_tickets || 0,
        totalTickets: stats.total_tickets || 0,
      },
      recentTickets: recentResult.rows,
    });
  } catch (err) {
    console.error("Dashboard summary error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch dashboard summary",
    });
  }
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

app.post("/api/v1/users/invite", async (req, res) => {
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

app.get("/api/v1/invites/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const result = await db.query(
      `
      SELECT
        i.invite_id,
        i.token,
        i.email,
        i.full_name,
        i.role_id,
        sr.role_name,
        i.branch_id,
        b.branch_name,
        i.company_name,
        i.mobile_number,
        i.accepted_at,
        i.expires_at
      FROM user_invites i
      LEFT JOIN system_roles sr ON i.role_id = sr.role_id
      LEFT JOIN branches b ON i.branch_id = b.branch_id
      WHERE i.token = $1
      `,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Invite not found" });
    }

    const invite = result.rows[0];
    if (invite.accepted_at) {
      return res.status(400).json({ success: false, error: "Invite already accepted" });
    }

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ success: false, error: "Invite expired" });
    }

    res.json(invite);
  } catch (err) {
    console.error("Fetch invite error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch invite" });
  }
});

app.post("/api/v1/invites/:token/accept", async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ success: false, error: "Password is required" });
    }

    const inviteResult = await db.query(
      `SELECT * FROM user_invites WHERE token = $1`,
      [token]
    );

    if (inviteResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Invite not found" });
    }

    const invite = inviteResult.rows[0];
    if (invite.accepted_at) {
      return res.status(400).json({ success: false, error: "Invite already accepted" });
    }

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ success: false, error: "Invite expired" });
    }

    const userResult = await db.query(
      `
      INSERT INTO users
      (full_name, email, password_hash, role_id, company_name, branch_id, mobile_number, status, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'Active', TRUE)
      RETURNING user_id, full_name, email, role_id, branch_id
      `,
      [
        invite.full_name || invite.email,
        invite.email,
        password,
        invite.role_id,
        invite.company_name,
        invite.branch_id,
        invite.mobile_number,
      ]
    );

    await db.query(
      `UPDATE user_invites SET accepted_at = CURRENT_TIMESTAMP WHERE invite_id = $1`,
      [invite.invite_id]
    );

    res.status(201).json({ success: true, user: userResult.rows[0] });
  } catch (err) {
    console.error("Accept invite error:", err.message);

    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "A user with this email already exists",
      });
    }

    res.status(500).json({ success: false, error: "Failed to accept invite" });
  }
});

/* ==========================
   KNOWLEDGE BASE
========================== */

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
  return user && (isSuperAdmin(user.role) || isAdmin(user.role) || isTechnician(user.role));
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

app.get("/api/v1/knowledge-base", async (req, res) => {
  try {
    const user = decodeRequestUser(req);
    if (!user) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }

    const scope = buildKnowledgeBaseScope(user, 1);
    if (scope.unauthorized) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }
    if (scope.forbidden) {
      return res.status(403).json({ success: false, error: "Access denied for your role or branch." });
    }

    const { ticket_id, category, search } = req.query;
    const whereClauses = [];
    const queryParams = [...scope.params];
    let idx = scope.params.length + 1;

    if (scope.clause) whereClauses.push(scope.clause);

    if (category && category !== "All") {
      whereClauses.push(`LOWER(kb.category) = LOWER($${idx})`);
      queryParams.push(category);
      idx++;
    }

    if (ticket_id) {
      whereClauses.push(`kb.related_ticket_id = $${idx}`);
      queryParams.push(ticket_id);
      idx++;
    }

    if (search && search.trim()) {
      whereClauses.push(`(
        kb.title ILIKE $${idx} OR
        kb.category ILIKE $${idx} OR
        kb.tags ILIKE $${idx} OR
        kb.symptoms ILIKE $${idx} OR
        kb.resolution ILIKE $${idx}
      )`);
      queryParams.push(`%${search.trim()}%`);
      idx++;
    }

    const whereString = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const result = await db.query(`
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
    `, queryParams);

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
    const user = decodeRequestUser(req);
    if (!user) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }

    const scope = buildKnowledgeBaseScope(user, 2);
    if (scope.unauthorized) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }
    if (scope.forbidden) {
      return res.status(403).json({ success: false, error: "Access denied for your role or branch." });
    }

    const { id } = req.params;
    const queryParams = [id, ...scope.params];
    const clause = scope.clause ? `AND ${scope.clause}` : "";

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

app.post("/api/v1/knowledge-base", async (req, res) => {
  try {
    const user = decodeRequestUser(req);
    if (!user) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }

    if (!userCanManageKnowledgeBase(user)) {
      return res.status(403).json({ success: false, error: "Only technicians, branch admins, and superadmins can create articles." });
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
      return res.status(400).json({ success: false, error: "Title is required" });
    }

    const articleBranchId = isSuperAdmin(user.role)
      ? branch_id || null
      : user.branchId;

    if (!articleBranchId) {
      return res.status(400).json({ success: false, error: "Branch is required for knowledge base articles." });
    }

    const result = await db.query(
      `
      INSERT INTO knowledge_base
      (title, category, tags, symptoms, resolution, branch_id, created_by, related_ticket_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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

app.put("/api/v1/knowledge-base/:id", async (req, res) => {
  try {
    const user = decodeRequestUser(req);
    if (!user) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }

    if (!userCanManageKnowledgeBase(user)) {
      return res.status(403).json({ success: false, error: "Only technicians, branch admins, and superadmins can update articles." });
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
      return res.status(400).json({ success: false, error: "Title is required" });
    }

    const existing = await db.query(`SELECT branch_id FROM knowledge_base WHERE kb_id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Knowledge base article not found" });
    }

    const existingBranchId = existing.rows[0].branch_id;
    if (!userCanEditKnowledgeBase(user, existingBranchId)) {
      return res.status(403).json({ success: false, error: "Update denied for this article branch." });
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

app.delete("/api/v1/knowledge-base/:id", async (req, res) => {
  try {
    const user = decodeRequestUser(req);
    if (!user) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }

    if (!userCanManageKnowledgeBase(user)) {
      return res.status(403).json({ success: false, error: "Only technicians, branch admins, and superadmins can delete articles." });
    }

    const { id } = req.params;
    const existing = await db.query(`SELECT branch_id FROM knowledge_base WHERE kb_id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Knowledge base article not found" });
    }

    if (!userCanEditKnowledgeBase(user, existing.rows[0].branch_id)) {
      return res.status(403).json({ success: false, error: "Delete denied for this article branch." });
    }

    const result = await db.query(
      `
      DELETE FROM knowledge_base
      WHERE kb_id = $1
      RETURNING kb_id
      `,
      [id]
    );

    res.json({ success: true, message: "Knowledge base article deleted successfully" });
  } catch (err) {
    console.error("Delete knowledge base article error:", err.message);

    res.status(500).json({ success: false, error: "Failed to delete knowledge base article" });
  }
});

/* ==========================
   TICKETS
========================== */

function getTicketRequestContext(req) {
  const body = req.body || {};
  const decoded = decodeRequestUser(req);

  return {
    currentUserId:
      decoded?.userId ||
      req.query.current_user_id ||
      body.current_user_id ||
      req.query.user_id ||
      body.user_id ||
      null,
    roleName: decoded?.role || req.query.role_name || body.role_name || null,
    branchId:
      decoded?.branchId ||
      req.query.current_branch_id ||
      body.current_branch_id ||
      req.query.branch_id ||
      body.branch_id ||
      null,
    filterBranchId: req.query.filter_branch_id || body.filter_branch_id || null,
  };
}

function addTicketAccessClauses(req, params, alias = "t", requesterAlias = "requester") {
  const { currentUserId, roleName, branchId, filterBranchId } =
    getTicketRequestContext(req);
  const role = normalizeRole(roleName);
  const branchExpression = `COALESCE(${alias}.branch_id, ${requesterAlias}.branch_id)`;
  const clauses = [];

  if (role === "superadmin") {
    if (filterBranchId) {
      params.push(filterBranchId);
      clauses.push(`${branchExpression} = $${params.length}`);
    }
    return clauses;
  }

  if (role === "admin") {
    if (!branchId) return ["1 = 0"];
    params.push(branchId);
    clauses.push(`${branchExpression} = $${params.length}`);
    return clauses;
  }

  if (role === "employee") {
    if (!currentUserId) return ["1 = 0"];
    params.push(currentUserId);
    clauses.push(`${alias}.requester_id = $${params.length}`);
    return clauses;
  }

  if (role === "technician") {
    if (!currentUserId) return ["1 = 0"];
    params.push(currentUserId);
    const technicianParam = params.length;

    if (branchId) {
      params.push(branchId);
      const branchParam = params.length;
      clauses.push(
        `(${alias}.assigned_to = $${technicianParam} OR (${alias}.assigned_to IS NULL AND ${branchExpression} = $${branchParam}))`
      );
    } else {
      clauses.push(`${alias}.assigned_to = $${technicianParam}`);
    }

    return clauses;
  }

  return ["1 = 0"];
}

app.get("/api/v1/tickets", async (req, res) => {
  try {
    const params = [];
    const accessClauses = addTicketAccessClauses(req, params, "t", "requester");
    const whereSql = accessClauses.length
      ? `WHERE ${accessClauses.join(" AND ")}`
      : "";

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
        t.root_cause,
        t.time_spent_minutes,
        t.parts_used,
        t.satisfaction_rating,
        COALESCE(t.branch_id, requester.branch_id) AS branch_id,
        t.cancelled_at,
        t.cancelled_by,
        t.cancellation_reason,
        t.created_at,
        t.updated_at,

        c.category_id,
        c.category_name AS category,
        b.branch_name,

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
      LEFT JOIN branches b
        ON COALESCE(t.branch_id, requester.branch_id) = b.branch_id
      LEFT JOIN users assignee
        ON t.assigned_to = assignee.user_id
      ${whereSql}
      ORDER BY t.created_at DESC
    `, params);

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
    const params = [id];
    const accessClauses = addTicketAccessClauses(req, params, "t", "requester");
    const accessSql = accessClauses.length
      ? `AND ${accessClauses.join(" AND ")}`
      : "";

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
        t.root_cause,
        t.time_spent_minutes,
        t.parts_used,
        t.satisfaction_rating,
        COALESCE(t.branch_id, requester.branch_id) AS branch_id,
        t.cancelled_at,
        t.cancelled_by,
        t.cancellation_reason,
        t.created_at,
        t.updated_at,

        c.category_id,
        c.category_name AS category,
        b.branch_name,

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
      LEFT JOIN branches b
        ON COALESCE(t.branch_id, requester.branch_id) = b.branch_id
      LEFT JOIN users assignee
        ON t.assigned_to = assignee.user_id
      WHERE t.id = $1
      ${accessSql}
      `,
      params
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

    const attachmentsResult = await db.query(
      `
      SELECT
        ta.attachment_id,
        ta.ticket_id,
        ta.uploaded_by,
        ta.file_name,
        ta.file_path,
        ta.mime_type,
        ta.file_size,
        ta.uploaded_at,
        u.full_name AS uploaded_by_name
      FROM ticket_attachments ta
      LEFT JOIN users u
        ON ta.uploaded_by = u.user_id
      WHERE ta.ticket_id = $1
      ORDER BY ta.uploaded_at ASC
      `,
      [id]
    );

    res.json({
      ...ticketResult.rows[0],
      comments: commentsResult.rows,
      history: historyResult.rows,
      attachments: attachmentsResult.rows,
    });
  } catch (err) {
    console.error("Fetch single ticket error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch ticket",
    });
  }
});

app.get("/api/v1/tickets/:id/attachments", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `
      SELECT
        attachment_id,
        ticket_id,
        uploaded_by,
        file_name,
        file_path,
        mime_type,
        file_size,
        uploaded_at
      FROM ticket_attachments
      WHERE ticket_id = $1
      ORDER BY uploaded_at ASC
      `,
      [id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch attachments error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch attachments" });
  }
});

app.post("/api/v1/tickets/:id/attachments", (req, res) => {
  uploadTicketAttachments.array("attachments", 10)(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({
        success: false,
        error:
          uploadErr.code === "LIMIT_FILE_SIZE"
            ? "File size must be 10MB or less"
            : uploadErr.message || "Failed to upload attachment",
      });
    }

  try {
    const { id } = req.params;
    const uploadedBy = req.body.uploaded_by || null;
    const files = req.files || [];

    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        error: "At least one attachment file is required",
      });
    }

    const ticketResult = await db.query(`SELECT id FROM tickets WHERE id = $1`, [id]);
    if (ticketResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Ticket not found" });
    }

    const savedAttachments = [];

    for (const file of files) {
      const relativePath = `/uploads/tickets/${file.filename}`;
      const result = await db.query(
        `
        INSERT INTO ticket_attachments
        (ticket_id, file_name, file_path, file_size, mime_type, uploaded_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING attachment_id, ticket_id, uploaded_by, file_name, file_path, mime_type, file_size, uploaded_at
        `,
        [
          id,
          file.originalname,
          relativePath,
          file.size,
          file.mimetype,
          uploadedBy || null,
        ]
      );

      await db.query(
        `
        INSERT INTO ticket_history
        (ticket_id, changed_by, action, old_value, new_value)
        VALUES ($1, $2, 'Attachment Added', NULL, $3)
        `,
        [id, uploadedBy || null, file.originalname]
      );

      savedAttachments.push(result.rows[0]);
    }

    res.status(201).json({ success: true, attachments: savedAttachments });
  } catch (err) {
    console.error("Upload attachment error:", err.message);
    res.status(500).json({ success: false, error: "Failed to upload attachment" });
  }
  });
});

app.delete("/api/v1/tickets/:id/attachments/:attachmentId", async (req, res) => {
  try {
    const { id, attachmentId } = req.params;
    const result = await db.query(
      `
      DELETE FROM ticket_attachments
      WHERE ticket_id = $1 AND attachment_id = $2
      RETURNING attachment_id, file_path
      `,
      [id, attachmentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Attachment not found" });
    }

    const filePath = result.rows[0].file_path;
    if (filePath) {
      const absolutePath = path.join(__dirname, filePath.replace(/^\/uploads[\\/]/, "uploads/"));
      fs.unlink(absolutePath, () => {});
    }

    res.json({ success: true, message: "Attachment deleted successfully" });
  } catch (err) {
    console.error("Delete attachment error:", err.message);
    res.status(500).json({ success: false, error: "Failed to delete attachment" });
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
      branch_id = null,
      current_branch_id = null,
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
    const finalBranchId = current_branch_id || branch_id || null;

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
        branch_id,
        source,
        impact,
        urgency,
        sla_due_date
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
        branch_id,
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
        finalBranchId,
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
      root_cause,
      time_spent_minutes,
      parts_used,
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

    const firstResponseAt =
      finalStatus === "In Progress" && !existing.first_response_at
        ? new Date()
        : existing.first_response_at;

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
        root_cause = $12,
        time_spent_minutes = $13,
        parts_used = $14,
        satisfaction_rating = $15,
        resolved_at = $16,
        closed_at = $17,
        first_response_at = $18
      WHERE id = $19
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
        first_response_at,
        resolved_at,
        closed_at,
        resolution_notes,
        root_cause,
        time_spent_minutes,
        parts_used,
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
        root_cause ?? existing.root_cause,
        time_spent_minutes ?? existing.time_spent_minutes,
        parts_used ?? existing.parts_used,
        satisfaction_rating ?? existing.satisfaction_rating,
        resolvedAt,
        closedAt,
        firstResponseAt,
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

app.patch("/api/v1/tickets/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    const roleName = normalizeRole(req.query.role_name || req.body?.role_name);
    const cancelledBy =
      req.query.current_user_id || req.body?.current_user_id || req.body?.cancelled_by || null;
    const reason = req.body?.cancellation_reason || req.body?.reason || "";

    if (roleName !== "superadmin") {
      return res.status(403).json({
        success: false,
        error: "Only superadmins can cancel tickets.",
      });
    }

    if (!reason.trim()) {
      return res.status(400).json({
        success: false,
        error: "Cancellation reason is required.",
      });
    }

    const existingResult = await db.query(
      `SELECT status FROM tickets WHERE id = $1`,
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found.",
      });
    }

    const previousStatus = existingResult.rows[0].status;
    if (previousStatus === "Closed" || previousStatus === "Cancelled") {
      return res.status(400).json({
        success: false,
        error: "Closed or already cancelled tickets cannot be cancelled.",
      });
    }

    const result = await db.query(
      `
      UPDATE tickets
      SET
        status = 'Cancelled',
        cancelled_at = NOW(),
        cancelled_by = $1,
        cancellation_reason = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
      `,
      [cancelledBy, reason.trim(), id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found.",
      });
    }

    await db.query(
      `
      INSERT INTO ticket_history
      (ticket_id, changed_by, action, old_value, new_value)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [id, cancelledBy, "Ticket Cancelled", previousStatus, reason.trim()]
    );

    res.json({
      success: true,
      message: "Ticket cancelled successfully.",
      ticket: result.rows[0],
    });
  } catch (err) {
    console.error("Cancel ticket error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to cancel ticket",
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
   SERVICE REQUESTS (RBAC)
========================== */

const JWT_FALLBACK_SECRET = "astreablue_dev_secret_change_in_prod";
const JWT_SECRET = process.env.JWT_SECRET || JWT_FALLBACK_SECRET;

// Normalise any role variant to a canonical lowercase token
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

function isServiceRequestRole(role) {
  const normalized = normalizeRole(role);
  return normalized === "superadmin" || normalized === "admin" || normalized === "technician";
}

// Decode the Bearer JWT and attach user context. Does NOT abort — falls through
// so endpoints can decide whether auth is required.
function decodeRequestUser(req) {
  try {
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) return null;
    const token = auth.slice(7);
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (JWT_SECRET === JWT_FALLBACK_SECRET) {
        throw err;
      }
      return jwt.verify(token, JWT_FALLBACK_SECRET);
    }
  } catch {
    return null;
  }
}

// Returns { clause, params } or { forbidden: true, unauthorized: true }
// startIndex is the $N index for the first new param.
function buildRequestScope(user, startIndex = 1) {
  if (!user) return { unauthorized: true };
  if (!isServiceRequestRole(user.role)) return { forbidden: true };
  if (isSuperAdmin(user.role)) return { clause: "", params: [] };
  if (!user.branchId) return { forbidden: true };
  return {
    clause: `requester.branch_id = $${startIndex}`,
    params: [user.branchId],
  };
}

// GET /api/v1/requests?category=Hardware&search=text
app.get("/api/v1/requests", async (req, res) => {
  try {
    const user = decodeRequestUser(req);
    const scope = buildRequestScope(user, 1);
    if (scope.unauthorized) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }
    if (scope.forbidden) {
      return res.status(403).json({ success: false, error: "Access denied for your role or branch." });
    }

    const { category, search } = req.query;
    const whereClauses = [];
    const queryParams = [...scope.params];
    let idx = scope.params.length + 1;

    if (scope.clause) whereClauses.push(scope.clause);

    if (category && category !== "All Services") {
      whereClauses.push(`LOWER(c.category_name) = LOWER($${idx})`);
      queryParams.push(category);
      idx++;
    }

    if (search && search.trim()) {
      whereClauses.push(`(
        t.ticket_number ILIKE $${idx} OR
        t.title        ILIKE $${idx} OR
        t.description  ILIKE $${idx} OR
        requester.full_name ILIKE $${idx} OR
        requester.email     ILIKE $${idx} OR
        c.category_name     ILIKE $${idx} OR
        t.status            ILIKE $${idx}
      )`);
      queryParams.push(`%${search.trim()}%`);
      idx++;
    }

    const whereString = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const result = await db.query(
      `SELECT
        t.id,
        t.ticket_number,
        t.title,
        t.description,
        t.priority,
        t.status,
        t.created_at,
        c.category_name                      AS service_category,
        requester.user_id                    AS requester_id,
        requester.full_name                  AS requester_name,
        requester.email                      AS requester_email,
        b.branch_id,
        b.branch_name,
        b.branch_location,
        assignee.full_name                   AS assigned_technician
      FROM tickets t
      LEFT JOIN users requester   ON t.requester_id = requester.user_id
      LEFT JOIN branches b        ON requester.branch_id = b.branch_id
      LEFT JOIN ticket_categories c ON t.category_id = c.category_id
      LEFT JOIN users assignee    ON t.assigned_to = assignee.user_id
      ${whereString}
      ORDER BY t.created_at DESC`,
      queryParams
    );

    // [DEBUG] console.log("[requests] user:", user?.role, "branch:", user?.branchId, "rows:", result.rows.length);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Fetch requests error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch service requests." });
  }
});

// GET /api/v1/requests/popular
app.get("/api/v1/requests/popular", async (req, res) => {
  try {
    const user = decodeRequestUser(req);
    const scope = buildRequestScope(user, 1);
    if (scope.unauthorized) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }
    if (scope.forbidden) {
      return res.status(403).json({ success: false, error: "Access denied for your role or branch." });
    }

    const whereString = scope.clause ? `WHERE ${scope.clause}` : "";

    const result = await db.query(
      `SELECT
        c.category_name  AS service_category,
        COUNT(t.id)::int AS count
      FROM tickets t
      LEFT JOIN users requester   ON t.requester_id = requester.user_id
      LEFT JOIN ticket_categories c ON t.category_id = c.category_id
      ${whereString}
      GROUP BY c.category_name
      ORDER BY count DESC, c.category_name ASC`,
      scope.params
    );

    // [DEBUG] console.log("[popular] user:", user?.role, "branch:", user?.branchId, "rows:", result.rows.length);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Fetch popular requests error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch popular services." });
  }
});

// GET /api/v1/requests/:id
app.get("/api/v1/requests/:id", async (req, res) => {
  try {
    const user = decodeRequestUser(req);
    const scope = buildRequestScope(user, 2); // $1 = ticket id, $2 = branchId
    if (scope.unauthorized) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }
    if (scope.forbidden) {
      return res.status(403).json({ success: false, error: "Access denied for your role or branch." });
    }

    const queryParams = [req.params.id, ...scope.params];
    const whereClauses = ["t.id = $1"];
    if (scope.clause) whereClauses.push(scope.clause);

    const result = await db.query(
      `SELECT
        t.id,
        t.ticket_number,
        t.title,
        t.description,
        t.priority,
        t.status,
        t.created_at,
        t.resolution_notes,
        c.category_name                      AS service_category,
        requester.user_id                    AS requester_id,
        requester.full_name                  AS requester_name,
        requester.email                      AS requester_email,
        b.branch_id,
        b.branch_name,
        b.branch_location,
        assignee.full_name                   AS assigned_technician
      FROM tickets t
      LEFT JOIN users requester   ON t.requester_id = requester.user_id
      LEFT JOIN branches b        ON requester.branch_id = b.branch_id
      LEFT JOIN ticket_categories c ON t.category_id = c.category_id
      LEFT JOIN users assignee    ON t.assigned_to = assignee.user_id
      WHERE ${whereClauses.join(" AND ")}
      LIMIT 1`,
      queryParams
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Request not found or access denied." });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Fetch request by id error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch service request." });
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "API route not found",
  });
});

app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err.message);
  res.status(500).json({
    success: false,
    error: "Internal server error",
  });
});

/* ==========================
   START SERVER
========================== */

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`🪐 AstreaBlue Secure Server active on port ${PORT}`);
});
