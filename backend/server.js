const express = require("express");
const http = require("http");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const db = require("./config/db");

const { calculateSlaDueDate } = require("./src/services/slaService");
const { calculateStraightLine } = require("./src/services/assetFinancialService");
const authRoutes = require("./src/routes/auth");
require("./src/services/slaCron");
const dashboardRoutes = require("./src/routes/dashboard");
const slaRoutes = require("./src/routes/sla");
const inviteRoutes = require("./src/routes/invites");
const emailRoutes = require("./src/routes/email");
const assetManagementRoutes = require("./src/routes/assetManagement");
const laptopMonitoringRoutes = require("./src/routes/laptopMonitoring");
const attachmentRoutes = require("./src/routes/attachments");
const ticketRoutes = require("./src/routes/tickets");
const notificationRoutes = require("./src/routes/notifications");
const ra10173ComplianceRoutes = require("./src/routes/ra10173Compliance");
const consentRoutes = require("./src/routes/consent");
const { setSocketServer } = require("./src/services/socketService");

const app = express();

const allowedOrigins = new Set(
  [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://frontend-production-4c52.up.railway.app",
    "https://vibrant-healing-production-bb79.up.railway.app",
    "https://itsm-astreablue-production.up.railway.app",
    process.env.FRONTEND_URL,
  ]
    .filter(Boolean)
    .map((origin) => String(origin).trim().replace(/\/$/, ""))
);

const httpServer = http.createServer(app);
let io = null;
try {
  const { Server } = require("socket.io");
  io = new Server(httpServer, {
    cors: {
      origin: [...allowedOrigins],
      methods: ["GET", "POST"],
      credentials: true,
    },
  });
  setSocketServer(io);
} catch (error) {
  console.warn("Socket.io initialization failed; HTTP API will continue:", error.message);
}

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin.replace(/\/$/, ""))) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: "3mb" }));

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
      ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
      ADD COLUMN IF NOT EXISTS sla_due_soon_notified_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS sla_breach_notification_sent_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS sla_breach_email_sent_at TIMESTAMP
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

    await db.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        reset_id SERIAL PRIMARY KEY,
        token VARCHAR(120) UNIQUE NOT NULL,
        user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(50) DEFAULT 'info',
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      ALTER TABLE notifications
      ADD COLUMN IF NOT EXISTS related_ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    `);
  } catch (err) {
    console.error("Attachments/invites setup error:", err.message);
  }
}

async function ensureHardwareAssetTables() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS hardware_assets (
        asset_id SERIAL PRIMARY KEY,
        asset_name VARCHAR(255) NOT NULL,
        asset_type VARCHAR(100) NOT NULL,
        brand VARCHAR(100),
        manufacturer VARCHAR(100),
        model VARCHAR(150),
        serial_number VARCHAR(150) NOT NULL UNIQUE,
        asset_tag VARCHAR(150) UNIQUE,
        color VARCHAR(100),
        purchase_price NUMERIC(12,2),
        supplier VARCHAR(150),
        assigned_name VARCHAR(255),
        returned_name VARCHAR(255),
        warranty VARCHAR(100),
        condition_notes TEXT,
        team_department VARCHAR(100),
        assigned_date DATE,
        returned_date DATE,
        accessories TEXT,
        processor VARCHAR(150),
        ram VARCHAR(100),
        storage VARCHAR(150),
        signature_link TEXT,
        returned_name_forms VARCHAR(255),
        attachments JSONB,
        image_url TEXT,
        branch_id INTEGER REFERENCES branches(branch_id),
        status VARCHAR(50) NOT NULL DEFAULT 'Active',
        purchase_date DATE,
        warranty_expiration DATE,
        borrower_name VARCHAR(150),
        borrower_email VARCHAR(255),
        employee_id VARCHAR(100),
        borrower_department VARCHAR(100),
        borrow_date DATE,
        expected_return_date DATE,
        actual_return_date DATE,
        condition_before TEXT,
        condition_after TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      ALTER TABLE hardware_assets
      ADD COLUMN IF NOT EXISTS asset_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS asset_type VARCHAR(100),
      ADD COLUMN IF NOT EXISTS model_name VARCHAR(100),
      ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(100),
      ADD COLUMN IF NOT EXISTS model VARCHAR(150),
      ADD COLUMN IF NOT EXISTS asset_tag VARCHAR(150),
      ADD COLUMN IF NOT EXISTS color VARCHAR(100),
      ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS supplier VARCHAR(150),
      ADD COLUMN IF NOT EXISTS assigned_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS returned_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS warranty VARCHAR(100),
      ADD COLUMN IF NOT EXISTS condition_notes TEXT,
      ADD COLUMN IF NOT EXISTS team_department VARCHAR(100),
      ADD COLUMN IF NOT EXISTS assigned_date DATE,
      ADD COLUMN IF NOT EXISTS returned_date DATE,
      ADD COLUMN IF NOT EXISTS accessories TEXT,
      ADD COLUMN IF NOT EXISTS processor VARCHAR(150),
      ADD COLUMN IF NOT EXISTS ram VARCHAR(100),
      ADD COLUMN IF NOT EXISTS storage VARCHAR(150),
      ADD COLUMN IF NOT EXISTS signature_link TEXT,
      ADD COLUMN IF NOT EXISTS returned_name_forms VARCHAR(255),
      ADD COLUMN IF NOT EXISTS attachments JSONB,
      ADD COLUMN IF NOT EXISTS image_url TEXT,
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id),
      ADD COLUMN IF NOT EXISTS location VARCHAR(255),
      ADD COLUMN IF NOT EXISTS department VARCHAR(100),
      ADD COLUMN IF NOT EXISTS warranty_expiration DATE,
      ADD COLUMN IF NOT EXISTS borrower_name VARCHAR(150),
      ADD COLUMN IF NOT EXISTS borrower_email VARCHAR(255),
      ADD COLUMN IF NOT EXISTS employee_id VARCHAR(100),
      ADD COLUMN IF NOT EXISTS borrower_department VARCHAR(100),
      ADD COLUMN IF NOT EXISTS borrow_date DATE,
      ADD COLUMN IF NOT EXISTS expected_return_date DATE,
      ADD COLUMN IF NOT EXISTS actual_return_date DATE,
      ADD COLUMN IF NOT EXISTS condition_before TEXT,
      ADD COLUMN IF NOT EXISTS condition_after TEXT,
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS vendor VARCHAR(150),
      ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(150),
      ADD COLUMN IF NOT EXISTS useful_life_months INTEGER,
      ADD COLUMN IF NOT EXISTS useful_life_years NUMERIC(6,2) DEFAULT 5,
      ADD COLUMN IF NOT EXISTS salvage_value NUMERIC(12,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS depreciation_method VARCHAR(50) DEFAULT 'Straight-Line',
      ADD COLUMN IF NOT EXISTS hostname VARCHAR(255),
      ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64),
      ADD COLUMN IF NOT EXISTS mac_address VARCHAR(32),
      ADD COLUMN IF NOT EXISTS operating_system VARCHAR(150),
      ADD COLUMN IF NOT EXISTS device_type VARCHAR(100),
      ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP,
      ADD COLUMN IF NOT EXISTS discovery_status VARCHAR(20),
      ADD COLUMN IF NOT EXISTS discovery_source VARCHAR(100),
      ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    await db.query(`
      UPDATE hardware_assets
      SET
        asset_name = COALESCE(asset_name, model, model_name, brand || ' Asset'),
        asset_type = COALESCE(asset_type, 'Other'),
        manufacturer = COALESCE(manufacturer, brand),
        model = COALESCE(model, model_name)
    `);

    await db.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'hardware_assets'
            AND column_name = 'model_name'
        ) THEN
          ALTER TABLE hardware_assets ALTER COLUMN model_name DROP NOT NULL;
        END IF;
      END $$;
    `);

    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS hardware_assets_asset_tag_unique
      ON hardware_assets (asset_tag)
      WHERE asset_tag IS NOT NULL
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS asset_borrow_records (
        record_id SERIAL PRIMARY KEY,
        asset_id INTEGER REFERENCES hardware_assets(asset_id) ON DELETE CASCADE,
        borrower_name VARCHAR(150),
        employee_id VARCHAR(100),
        borrower_department VARCHAR(100),
        borrow_date DATE,
        expected_return_date DATE,
        actual_return_date DATE,
        condition_before TEXT,
        condition_after TEXT,
        notes TEXT,
        status_from VARCHAR(50),
        status_to VARCHAR(50),
        branch_id INTEGER REFERENCES branches(branch_id),
        created_by INTEGER REFERENCES users(user_id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS asset_history (
        history_id SERIAL PRIMARY KEY,
        asset_id INTEGER REFERENCES hardware_assets(asset_id) ON DELETE CASCADE,
        event_type VARCHAR(100) NOT NULL,
        event_data JSONB,
        branch_id INTEGER REFERENCES branches(branch_id),
        created_by INTEGER REFERENCES users(user_id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS asset_discovery_scans (
        scan_id BIGSERIAL PRIMARY KEY,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        duration_ms INTEGER,
        devices_found INTEGER NOT NULL DEFAULT 0,
        new_assets INTEGER NOT NULL DEFAULT 0,
        updated_assets INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(30) NOT NULL DEFAULT 'Running',
        branch_id INTEGER REFERENCES branches(branch_id),
        initiated_by INTEGER REFERENCES users(user_id),
        error_message TEXT
      )
    `);
    await db.query(`ALTER TABLE asset_discovery_scans ADD COLUMN IF NOT EXISTS source VARCHAR(100) DEFAULT 'Manual Import'`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS asset_financials (
        financial_id BIGSERIAL PRIMARY KEY,
        asset_id INTEGER NOT NULL UNIQUE REFERENCES hardware_assets(asset_id) ON DELETE CASCADE,
        useful_life_months INTEGER DEFAULT 36,
        useful_life_years NUMERIC(6,2) NOT NULL DEFAULT 3 CHECK (useful_life_years > 0),
        salvage_value NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
        depreciation_method VARCHAR(50) NOT NULL DEFAULT 'Straight-Line',
        depreciation_start_date DATE,
        disposal_value NUMERIC(12,2),
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`ALTER TABLE asset_financials ADD COLUMN IF NOT EXISTS useful_life_months INTEGER`);
    await db.query(`
      UPDATE asset_financials SET useful_life_months = GREATEST(1, ROUND(useful_life_years * 12)::INTEGER)
      WHERE useful_life_months IS NULL OR useful_life_months <= 0
    `);
    await db.query(`
      UPDATE hardware_assets SET useful_life_months = CASE
        WHEN useful_life_years IS NOT NULL AND useful_life_years > 0 THEN GREATEST(1, ROUND(useful_life_years * 12)::INTEGER)
        ELSE 36 END
      WHERE useful_life_months IS NULL OR useful_life_months <= 0
    `);
    await db.query(`ALTER TABLE asset_financials ALTER COLUMN useful_life_months SET DEFAULT 36`);
    await db.query(`ALTER TABLE hardware_assets ALTER COLUMN useful_life_months SET DEFAULT 36`);
    await db.query(`
      INSERT INTO asset_financials (asset_id,useful_life_months,useful_life_years,salvage_value,depreciation_method,depreciation_start_date)
      SELECT asset_id,COALESCE(useful_life_months,ROUND(useful_life_years * 12)::INTEGER,36),COALESCE(useful_life_years,3),COALESCE(salvage_value,0),COALESCE(depreciation_method,'Straight-Line'),purchase_date
      FROM hardware_assets ON CONFLICT (asset_id) DO NOTHING
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS asset_discoveries (
        discovery_id BIGSERIAL PRIMARY KEY,
        hostname VARCHAR(255) NOT NULL,
        ip_address VARCHAR(64), mac_address VARCHAR(32), serial_number VARCHAR(150), asset_tag VARCHAR(150),
        os_name VARCHAR(150), manufacturer VARCHAR(150), device_type VARCHAR(100),
        source VARCHAR(100) NOT NULL DEFAULT 'Manual',
        first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(30) NOT NULL DEFAULT 'Online',
        reconciliation_status VARCHAR(30) NOT NULL DEFAULT 'Unmanaged',
        matched_asset_id INTEGER REFERENCES hardware_assets(asset_id) ON DELETE SET NULL,
        branch_id INTEGER REFERENCES branches(branch_id), raw_data JSONB,
        created_by INTEGER REFERENCES users(user_id), updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS asset_types (
        asset_type_id SERIAL PRIMARY KEY,
        type_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS asset_types_type_name_ci_unique ON asset_types (LOWER(type_name))`);
    await db.query(`
      INSERT INTO asset_types (type_name)
      SELECT seed.type_name FROM (VALUES ('Laptop'),('Desktop'),('Printer'),('Phone'),('Monitor'),('Server'),('Network Device'),('Other')) seed(type_name)
      WHERE NOT EXISTS (SELECT 1 FROM asset_types existing WHERE LOWER(existing.type_name)=LOWER(seed.type_name))
    `);
    await db.query(`
      INSERT INTO asset_types (type_name)
      SELECT MIN(TRIM(asset_type)) FROM hardware_assets source
      WHERE NULLIF(TRIM(asset_type),'') IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM asset_types existing WHERE LOWER(existing.type_name)=LOWER(TRIM(source.asset_type)))
      GROUP BY LOWER(TRIM(asset_type))
    `);
    return true;
  } catch (err) {
    console.error("Hardware asset table setup error:", err.message);
    return false;
  }
}

ensureAttachmentsAndInvites();
const hardwareAssetTablesReady = ensureHardwareAssetTables();

async function ensureRa10173Tables() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS laptop_activity_monitoring (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        branch_id INTEGER REFERENCES branches(branch_id),
        application_monitoring BOOLEAN NOT NULL DEFAULT FALSE,
        web_monitoring BOOLEAN NOT NULL DEFAULT FALSE,
        location_tracking BOOLEAN NOT NULL DEFAULT FALSE,
        device_telemetry BOOLEAN NOT NULL DEFAULT TRUE,
        email_header_monitoring BOOLEAN NOT NULL DEFAULT FALSE,
        signature_image TEXT,
        consent_status VARCHAR(30) NOT NULL DEFAULT 'Pending',
        submitted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS laptop_monitoring_user_id_idx ON laptop_activity_monitoring (user_id)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS laptop_monitoring_branch_id_idx ON laptop_activity_monitoring (branch_id)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS laptop_monitoring_consent_status_idx ON laptop_activity_monitoring (consent_status)
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS consent_audit_logs (
        log_id BIGSERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        action VARCHAR(50) NOT NULL,
        details JSONB,
        ip_address VARCHAR(45),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS consent_audit_employee_idx ON consent_audit_logs (employee_id)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS consent_audit_action_idx ON consent_audit_logs (action)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS consent_audit_created_idx ON consent_audit_logs (created_at DESC)
    `);

    return true;
  } catch (err) {
    console.error("RA 10173 table setup error:", err.message);
    return false;
  }
}

ensureRa10173Tables();

/* ==========================
   AUTH ROUTES
========================== */

app.use("/api/auth", authRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/sla", slaRoutes);
app.use("/api/v1/invites", inviteRoutes);
app.use("/api/v1/email", emailRoutes);
app.use("/api/v1/hardware-assets", async (_req, res, next) => {
  if (await hardwareAssetTablesReady) return next();
  return res.status(503).json({ success: false, message: "Hardware asset storage is unavailable." });
}, assetManagementRoutes);
app.use("/api/v1/laptop-monitoring", laptopMonitoringRoutes);
app.use("/api/v1/ra-10173-compliance", ra10173ComplianceRoutes);
app.use("/api/v1/tickets", attachmentRoutes);
app.use("/api/v1/tickets", ticketRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/consent", consentRoutes);

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
    const {
      branch_id,
      current_branch_id,
      current_role,
      role_name,
      current_user_id,
      ticket_id,
    } = req.query;
    const actorRole = String(current_role || role_name || "").toLowerCase();
    const params = [];
    const filters = [];

    if (actorRole === "employee") {
      return res.status(403).json({
        success: false,
        error: "Employees cannot view technician assignment options.",
      });
    }

    if (ticket_id) {
      const ticketResult = await db.query(
        `SELECT branch_id FROM tickets WHERE id = $1 LIMIT 1`,
        [ticket_id]
      );

      if (ticketResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Ticket not found.",
        });
      }

      const ticketBranchId = ticketResult.rows[0]?.branch_id;

      if (!ticketBranchId) return res.json([]);

      params.push(ticketBranchId);
      filters.push(`u.branch_id = $${params.length}`);
    }

    if (actorRole === "admin") {
      const adminBranchId = current_branch_id || branch_id;

      if (!adminBranchId) return res.json([]);

      params.push(adminBranchId);
      filters.push(`u.branch_id = $${params.length}`);
    } else if (actorRole === "technician") {
      if (current_user_id) {
        params.push(current_user_id);
        filters.push(`u.user_id = $${params.length}`);
      } else if (current_branch_id || branch_id) {
        params.push(current_branch_id || branch_id);
        filters.push(`u.branch_id = $${params.length}`);
      } else {
        return res.json([]);
      }
    } else if (!actorRole && branch_id) {
      params.push(branch_id);
      filters.push(`u.branch_id = $${params.length}`);
    }

    const result = await db.query(`
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
        ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
      ORDER BY u.full_name ASC
    `, params);

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
    const auth = getAuthFromRequest(req);
    let whereClause = "";
    const params = [];

    if (auth) {
      const role = String(auth.role || "").toLowerCase();
      if ((role === "admin" || role === "technician") && auth.branchId) {
        whereClause = "WHERE b.branch_id = $1";
        params.push(auth.branchId);
      }
    }

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
      ${whereClause}
      ORDER BY b.branch_name ASC
    `, params);

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


function getAuthFromRequest(req) {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.split(" ")[1];
    if (!token) return null;
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function getHardwareAssetAccessFilter(req) {
  const auth = getAuthFromRequest(req);
  if (!auth) return { whereSql: "WHERE 1=0", params: [] };

  const role = String(auth.role || "").toLowerCase().replace(/[\s_-]/g, "");
  const branchId = auth.branchId;
  const filterBranch = req.query.filter_branch_id;

  if (role === "superadmin") {
    return filterBranch
      ? { whereSql: "WHERE a.branch_id = $1", params: [filterBranch] }
      : { whereSql: "", params: [] };
  }

  if (role === "admin" || role === "technician") {
    if (!branchId) return { whereSql: "WHERE 1=0", params: [] };
    return { whereSql: "WHERE a.branch_id = $1", params: [branchId] };
  }

  if (role === "employee") {
    if (!auth.userId) return { whereSql: "WHERE 1=0", params: [] };
    // Employees can only see assets assigned to them
    return { whereSql: "WHERE a.employee_id = $1", params: [auth.userId] };
  }

  return { whereSql: "WHERE 1=0", params: [] };
}

function logHardwareAssetError(operation, err) {
  console.error(`[Hardware Assets] ${operation} failed`, {
    message: err.message,
    code: err.code || null,
    detail: err.detail || null,
    constraint: err.constraint || null,
  });
}

function getHardwareAssetErrorMessage(err, fallback) {
  if (err.code === "23505") return "An asset with this serial number or asset tag already exists.";
  if (err.code === "23503") return "The selected branch or assigned record does not exist.";
  if (err.code === "22P02") return "One or more asset values have an invalid format.";
  if (err.code === "42703") return "The hardware asset database schema is not up to date.";
  return err.message || fallback;
}

async function requireHardwareAssetTables() {
  const ready = await hardwareAssetTablesReady;
  if (!ready) throw new Error("Hardware asset database initialization failed.");
}

async function insertAssetHistory(assetId, eventType, eventData, branchId, createdBy) {
  try {
    await db.query(
      `
      INSERT INTO asset_history (asset_id, event_type, event_data, branch_id, created_by)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [assetId, eventType, JSON.stringify(eventData || {}), branchId || null, createdBy || null]
    );
  } catch (err) {
    console.error("Insert asset history error:", err.message);
  }
}

async function createBorrowRecord(assetId, record) {
  try {
    await db.query(
      `
      INSERT INTO asset_borrow_records (
        asset_id,
        borrower_name,
        employee_id,
        borrower_department,
        borrow_date,
        expected_return_date,
        actual_return_date,
        condition_before,
        condition_after,
        notes,
        status_from,
        status_to,
        branch_id,
        created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      `,
      [
        assetId,
        record.borrower_name || null,
        record.employee_id || null,
        record.borrower_department || null,
        record.borrow_date || null,
        record.expected_return_date || null,
        record.actual_return_date || null,
        record.condition_before || null,
        record.condition_after || null,
        record.notes || null,
        record.status_from || null,
        record.status_to || null,
        record.branch_id || null,
        record.created_by || null,
      ]
    );
  } catch (err) {
    console.error("Create borrow record error:", err.message);
  }
}

app.get("/api/v1/hardware-assets", async (req, res) => {
  try {
    await requireHardwareAssetTables();
    const accessFilter = getHardwareAssetAccessFilter(req);
    const params = [...accessFilter.params];
    const filters = [];

    const search = String(req.query.search || "").trim();
    const assetType = String(req.query.type || "").trim();
    const status = String(req.query.status || "").trim();
    const manufacturer = String(req.query.manufacturer || "").trim();

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      filters.push(
        `(a.asset_name ILIKE $${idx} OR a.asset_tag ILIKE $${idx} OR a.serial_number ILIKE $${idx} OR a.brand ILIKE $${idx} OR a.manufacturer ILIKE $${idx} OR a.model ILIKE $${idx} OR a.supplier ILIKE $${idx} OR a.assigned_name ILIKE $${idx} OR a.team_department ILIKE $${idx} OR a.location ILIKE $${idx} OR a.department ILIKE $${idx} OR a.borrower_email ILIKE $${idx})`
      );
    }

    if (assetType && assetType.toLowerCase() !== "all") {
      params.push(assetType);
      filters.push(`a.asset_type = $${params.length}`);
    }

    if (status && status.toLowerCase() !== "all") {
      params.push(status);
      filters.push(`a.status = $${params.length}`);
    }

    if (manufacturer && manufacturer.toLowerCase() !== "all") {
      params.push(manufacturer);
      filters.push(`a.brand = $${params.length}`);
    }

    const whereClauses = [];
    if (accessFilter.whereSql) {
      whereClauses.push(accessFilter.whereSql.replace(/^WHERE\s+/i, ""));
    }
    whereClauses.push(...filters);
    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const result = await db.query(
      `
      SELECT
        a.asset_id,
        a.asset_name,
        a.asset_type,
        a.brand,
        a.manufacturer,
        a.model,
        a.serial_number,
        a.asset_tag,
        a.color,
        a.purchase_price,
        a.supplier,
        a.assigned_name,
        a.returned_name,
        a.warranty,
        a.condition_notes,
        a.team_department,
        a.assigned_date,
        a.returned_date,
        a.accessories,
        a.processor,
        a.ram,
        a.storage,
        a.signature_link,
        a.returned_name_forms,
        a.attachments,
        a.image_url,
        a.location,
        a.department,
        a.status,
        a.purchase_date,
        a.warranty_expiration,
        a.borrower_name,
        a.borrower_email,
        a.employee_id,
        a.borrower_department,
        a.borrow_date,
        a.expected_return_date,
        a.actual_return_date,
        a.condition_before,
        a.condition_after,
        a.notes,
        a.vendor,
        a.invoice_number,
        COALESCE(f.useful_life_months, a.useful_life_months, ROUND(f.useful_life_years * 12), ROUND(a.useful_life_years * 12), 36) AS useful_life_months,
        COALESCE(f.useful_life_years, a.useful_life_years, 3) AS useful_life_years,
        COALESCE(f.salvage_value, a.salvage_value, 0) AS salvage_value,
        COALESCE(f.depreciation_method, a.depreciation_method, 'Straight-Line') AS depreciation_method,
        COALESCE(f.depreciation_start_date, a.purchase_date) AS depreciation_start_date,
        a.hostname,
        a.ip_address,
        a.mac_address,
        a.operating_system,
        a.device_type,
        a.last_seen,
        a.discovery_status,
        a.discovery_source,
        a.discovered_at,
        a.branch_id,
        COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,
        a.created_at,
        a.updated_at,
        md.device_id as monitoring_device_id,
        md.device_uuid as monitoring_device_uuid,
        md.hostname as monitoring_hostname,
        md.status as monitoring_status,
        md.last_seen_at as monitoring_last_seen,
        md.logged_in_user as monitoring_logged_in_user
      FROM hardware_assets a
      LEFT JOIN branches b ON a.branch_id = b.branch_id
      LEFT JOIN asset_financials f ON f.asset_id = a.asset_id
      LEFT JOIN monitored_devices md ON md.asset_id = a.asset_id
      ${whereSql}
      ORDER BY a.created_at DESC
      `,
      params
    );

    res.json(result.rows.map((asset) => ({ ...asset, ...calculateStraightLine(asset) })));
  } catch (err) {
    logHardwareAssetError("GET", err);
    return res.status(500).json({
      success: false,
      error: getHardwareAssetErrorMessage(err, "Failed to fetch hardware assets"),
    });
  }
});

app.get("/api/v1/hardware-assets/:id/history", async (req, res) => {
  try {
    await requireHardwareAssetTables();
    const result = await db.query(
      `
      SELECT history_id, asset_id, event_type, event_data, branch_id, created_by, created_at
      FROM asset_history
      WHERE asset_id = $1
      ORDER BY created_at DESC
      `,
      [req.params.id]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("Fetch asset history error:", err.message);
    return res.status(500).json({ success: false, error: "Failed to fetch asset history" });
  }
});

app.post("/api/v1/hardware-assets", async (req, res) => {
  try {
    await requireHardwareAssetTables();
    const {
      asset_name,
      asset_type,
      brand,
      manufacturer,
      model,
      serial_number,
      asset_tag,
      color,
      purchase_price,
      supplier,
      assigned_name,
      returned_name,
      warranty,
      condition_notes,
      team_department,
      assigned_date,
      returned_date,
      accessories,
      processor,
      ram,
      storage,
      signature_link,
      returned_name_forms,
      attachments,
      image_url,
      location,
      department,
      branch_id: requestedBranchId,
      status = "Active",
      purchase_date,
      warranty_expiration,
      borrower_name,
      borrower_email,
      employee_id,
      borrower_department,
      borrow_date,
      expected_return_date,
      actual_return_date,
      condition_before,
      condition_after,
      notes,
    } = req.body;

    const finalManufacturer = manufacturer || brand;
    const finalBrand = brand || manufacturer;
    const finalAssetName =
      asset_name ||
      [finalManufacturer, model].filter(Boolean).join(" ") ||
      asset_tag;
    const attachmentPayload = JSON.stringify(Array.isArray(attachments) ? attachments : []);

    if (!asset_tag || !asset_type || !status || !finalManufacturer || !model || !serial_number) {
      return res.status(400).json({
        success: false,
        error: "Asset tag, status, manufacturer, model, asset type, and serial number are required",
      });
    }

    const auth = getAuthFromRequest(req);
    const isAdminFromJwt = auth && String(auth.role || "").toLowerCase() === "admin";
    const isSuperAdminFromJwt = auth && String(auth.role || "").toLowerCase() === "superadmin";

    const currentBranchId = req.query.current_branch_id || req.body.current_branch_id;
    let branchId;
    if (isAdminFromJwt && auth.branchId) {
      branchId = auth.branchId;
    } else if (isSuperAdminFromJwt) {
      branchId = requestedBranchId || currentBranchId || null;
    } else {
      const role = String(req.query.role_name || req.body.role_name || "").toLowerCase();
      branchId =
        role === "superadmin"
          ? requestedBranchId || currentBranchId || null
          : currentBranchId || requestedBranchId || null;
    }

    if (!branchId) {
      return res.status(400).json({
        success: false,
        error: "Branch location is required",
      });
    }

    const result = await db.query(
      `
      INSERT INTO hardware_assets (
        asset_name,
        asset_type,
        brand,
        manufacturer,
        model,
        serial_number,
        asset_tag,
        color,
        purchase_price,
        supplier,
        assigned_name,
        returned_name,
        warranty,
        condition_notes,
        team_department,
        assigned_date,
        returned_date,
        accessories,
        processor,
        ram,
        storage,
        signature_link,
        returned_name_forms,
        attachments,
        location,
        department,
        branch_id,
        status,
        purchase_date,
        warranty_expiration,
        borrower_name,
        borrower_email,
        employee_id,
        borrower_department,
        borrow_date,
        expected_return_date,
        actual_return_date,
        condition_before,
        condition_after,
        notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40)
      RETURNING *
      `,
      [
        finalAssetName,
        asset_type,
        finalBrand,
        finalManufacturer,
        model || null,
        serial_number,
        asset_tag,
        color || null,
        purchase_price || null,
        supplier || null,
        assigned_name || null,
        returned_name || null,
        warranty || null,
        condition_notes || null,
        team_department || null,
        assigned_date || null,
        returned_date || null,
        accessories || null,
        processor || null,
        ram || null,
        storage || null,
        signature_link || null,
        returned_name_forms || null,
        attachmentPayload,
        location || null,
        department || team_department || null,
        branchId,
        status,
        purchase_date || null,
        warranty_expiration || warranty || null,
        borrower_name || assigned_name || null,
        borrower_email || null,
        employee_id || null,
        borrower_department || null,
        borrow_date || null,
        expected_return_date || null,
        actual_return_date || null,
        condition_before || null,
        condition_after || null,
        notes || null,
      ]
    );

    let asset = result.rows[0];

    if (image_url) {
      const imageResult = await db.query(
        "UPDATE hardware_assets SET image_url = $1 WHERE asset_id = $2 RETURNING *",
        [image_url, asset.asset_id]
      );
      asset = imageResult.rows[0];
    }

    await insertAssetHistory(asset.asset_id, "Asset Created", {
      status,
      branch_id: branchId,
      created: new Date().toISOString(),
    }, branchId, null);

    if (status === "Borrowed") {
      await createBorrowRecord(asset.asset_id, {
        borrower_name,
        employee_id,
        borrower_department,
        borrow_date,
        expected_return_date,
        actual_return_date,
        condition_before,
        condition_after,
        notes,
        status_from: "Active",
        status_to: "Borrowed",
        branch_id: branchId,
        created_by: null,
      });
    }

    res.status(201).json(asset);
  } catch (err) {
    logHardwareAssetError("POST", err);
    if (err.code === "23505") {
      return res.status(409).json({ success: false, error: getHardwareAssetErrorMessage(err) });
    }
    return res.status(500).json({
      success: false,
      error: getHardwareAssetErrorMessage(err, "Failed to create hardware asset"),
    });
  }
});

app.put("/api/v1/hardware-assets/:id", async (req, res) => {
  try {
    await requireHardwareAssetTables();
    const { id } = req.params;
    const {
      asset_name,
      asset_type,
      brand,
      manufacturer,
      model,
      serial_number,
      asset_tag,
      color,
      purchase_price,
      supplier,
      assigned_name,
      returned_name,
      warranty,
      condition_notes,
      team_department,
      assigned_date,
      returned_date,
      accessories,
      processor,
      ram,
      storage,
      signature_link,
      returned_name_forms,
      attachments,
      image_url,
      location,
      department,
      branch_id: requestedBranchId,
      status,
      purchase_date,
      warranty_expiration,
      borrower_name,
      borrower_email,
      employee_id,
      borrower_department,
      borrow_date,
      expected_return_date,
      actual_return_date,
      condition_before,
      condition_after,
      notes,
    } = req.body;

    const finalManufacturer = manufacturer || brand;
    const finalBrand = brand || manufacturer;
    const finalAssetName =
      asset_name ||
      [finalManufacturer, model].filter(Boolean).join(" ") ||
      asset_tag;
    const attachmentPayload = JSON.stringify(Array.isArray(attachments) ? attachments : []);

    if (!asset_tag || !asset_type || !status || !finalManufacturer || !model || !serial_number) {
      return res.status(400).json({
        success: false,
        error: "Asset tag, status, manufacturer, model, asset type, and serial number are required",
      });
    }

    const existing = await db.query(`SELECT * FROM hardware_assets WHERE asset_id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Asset not found" });
    }

    const auth = getAuthFromRequest(req);
    const isAdminFromJwt = auth && String(auth.role || "").toLowerCase() === "admin";
    const isSuperAdminFromJwt = auth && String(auth.role || "").toLowerCase() === "superadmin";

    const currentBranchId = req.query.current_branch_id || req.body.current_branch_id;
    let branchId;
    if (isAdminFromJwt && auth.branchId) {
      branchId = auth.branchId;
    } else if (isSuperAdminFromJwt) {
      branchId = requestedBranchId || currentBranchId || existing.rows[0].branch_id;
    } else {
      const role = String(req.query.role_name || req.body.role_name || "").toLowerCase();
      branchId =
        role === "superadmin"
          ? requestedBranchId || currentBranchId || existing.rows[0].branch_id
          : currentBranchId || existing.rows[0].branch_id;
    }

    const result = await db.query(
      `
      UPDATE hardware_assets
      SET
        asset_name = $1,
        asset_type = $2,
        brand = $3,
        manufacturer = $4,
        model = $5,
        serial_number = $6,
        asset_tag = $7,
        color = $8,
        purchase_price = $9,
        supplier = $10,
        assigned_name = $11,
        returned_name = $12,
        warranty = $13,
        condition_notes = $14,
        team_department = $15,
        assigned_date = $16,
        returned_date = $17,
        accessories = $18,
        processor = $19,
        ram = $20,
        storage = $21,
        signature_link = $22,
        returned_name_forms = $23,
        attachments = $24::jsonb,
        location = $25,
        department = $26,
        branch_id = $27,
        status = $28,
        purchase_date = $29,
        warranty_expiration = $30,
        borrower_name = $31,
        borrower_email = $32,
        employee_id = $33,
        borrower_department = $34,
        borrow_date = $35,
        expected_return_date = $36,
        actual_return_date = $37,
        condition_before = $38,
        condition_after = $39,
        notes = $40,
        updated_at = CURRENT_TIMESTAMP
      WHERE asset_id = $41
      RETURNING *
      `,
      [
        finalAssetName,
        asset_type,
        finalBrand,
        finalManufacturer,
        model || null,
        serial_number,
        asset_tag,
        color || null,
        purchase_price || null,
        supplier || null,
        assigned_name || null,
        returned_name || null,
        warranty || null,
        condition_notes || null,
        team_department || null,
        assigned_date || null,
        returned_date || null,
        accessories || null,
        processor || null,
        ram || null,
        storage || null,
        signature_link || null,
        returned_name_forms || null,
        attachmentPayload,
        location || null,
        department || team_department || null,
        branchId,
        status || existing.rows[0].status,
        purchase_date || null,
        warranty_expiration || warranty || null,
        borrower_name || assigned_name || null,
        borrower_email || null,
        employee_id || null,
        borrower_department || null,
        borrow_date || null,
        expected_return_date || null,
        actual_return_date || null,
        condition_before || null,
        condition_after || null,
        notes || null,
        id,
      ]
    );

    let updatedAsset = result.rows[0];

    if (image_url !== undefined) {
      const imageResult = await db.query(
        "UPDATE hardware_assets SET image_url = $1 WHERE asset_id = $2 RETURNING *",
        [image_url || null, id]
      );
      updatedAsset = imageResult.rows[0];
    }

    // Sync assignment to monitored device if linked
    if (employee_id || assigned_name || borrower_name) {
      await db.query(
        `UPDATE monitored_devices 
         SET assigned_user_id=$1, department=$2, branch_id=$3, updated_at=CURRENT_TIMESTAMP
         WHERE asset_id=$4`,
        [
          employee_id || null, 
          department || team_department || borrower_department || null, 
          branchId || null, 
          id
        ]
      );
    }

    await insertAssetHistory(updatedAsset.asset_id, "Asset Updated", { status: status || existing.rows[0].status }, branchId, null);

    res.json(updatedAsset);
  } catch (err) {
    console.error("Update hardware asset error:", err.message);
    res.status(500).json({ success: false, error: "Failed to update hardware asset" });
  }
});

app.put("/api/v1/hardware-assets/:id/link-device", async (req, res) => {
  try {
    const auth = getAuthFromRequest(req);
    if (!auth || (auth.role !== "SuperAdmin" && auth.role !== "Admin")) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    const { id } = req.params;
    if (auth.role === "Admin" && auth.branchId) {
      const assetCheck = await db.query(`SELECT branch_id FROM hardware_assets WHERE asset_id = $1`, [id]);
      if (assetCheck.rows.length === 0 || assetCheck.rows[0].branch_id !== auth.branchId) {
        return res.status(403).json({ success: false, error: "Cannot link/unlink assets from another branch." });
      }
    }

    const { device_id } = req.body;
    
    if (device_id === null || device_id === "") {
      await db.query(`UPDATE monitored_devices SET asset_id = NULL WHERE asset_id = $1`, [id]);
      return res.json({ success: true, message: "Asset unlinked successfully." });
    }

    // Check if the device is already linked to another asset
    const checkLink = await db.query(`SELECT asset_id, device_uuid, hostname FROM monitored_devices WHERE device_id = $1`, [device_id]);
    if (!checkLink.rows.length) {
      return res.status(404).json({ success: false, error: "Monitored device not found." });
    }
    const existingAssetId = checkLink.rows[0].asset_id;
    if (existingAssetId && String(existingAssetId) !== String(id)) {
      const otherAsset = await db.query(`SELECT asset_tag FROM hardware_assets WHERE asset_id = $1`, [existingAssetId]);
      const otherTag = otherAsset.rows.length ? otherAsset.rows[0].asset_tag : "another asset";
      return res.status(409).json({ success: false, error: `This monitoring device is already linked to Asset ${otherTag}.` });
    }

    // First unlink any device currently linked to this asset, then link the new device
    await db.query(`UPDATE monitored_devices SET asset_id = NULL WHERE asset_id = $1`, [id]);
    const result = await db.query(`UPDATE monitored_devices SET asset_id = $1 WHERE device_id = $2 RETURNING *`, [id, device_id]);
    
    return res.json({ success: true, message: "Asset linked successfully.", data: result.rows[0] });
  } catch (err) {
    console.error("Link device error:", err.message);
    res.status(500).json({ success: false, error: "Failed to link monitored device." });
  }
});

app.patch("/api/v1/hardware-assets/:id/status", async (req, res) => {
  try {
    await requireHardwareAssetTables();
    const { id } = req.params;
    const {
      status,
      borrower_name,
      employee_id,
      borrower_department,
      borrow_date,
      expected_return_date,
      actual_return_date,
      condition_before,
      condition_after,
      notes,
    } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, error: "Asset status is required" });
    }

    const existing = await db.query(`SELECT * FROM hardware_assets WHERE asset_id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Asset not found" });
    }

    const currentAsset = existing.rows[0];
    const role = String(req.query.role_name || req.body.role_name || "").toLowerCase();
    const currentBranchId = req.query.current_branch_id || req.body.current_branch_id;

    if (role !== "superadmin" && currentBranchId && Number(currentAsset.branch_id) !== Number(currentBranchId)) {
      return res.status(403).json({ success: false, error: "You are not authorized to update this asset" });
    }

    if (status === "Borrowed") {
      if (!borrower_name || !employee_id || !borrower_department || !borrow_date || !expected_return_date) {
        return res.status(400).json({
          success: false,
          error: "Borrower name, employee ID, department, borrow date, and expected return date are required for borrowed assets",
        });
      }
    }

    if (["Active", "In Stock"].includes(status) && !actual_return_date) {
      return res.status(400).json({
        success: false,
        error: "Actual return date is required when returning an asset",
      });
    }

    const result = await db.query(
      `
      UPDATE hardware_assets
      SET
        status = $1,
        borrower_name = $2,
        employee_id = $3,
        borrower_department = $4,
        borrow_date = $5,
        expected_return_date = $6,
        actual_return_date = $7,
        condition_before = $8,
        condition_after = $9,
        notes = $10,
        updated_at = CURRENT_TIMESTAMP
      WHERE asset_id = $11
      RETURNING *
      `,
      [
        status,
        borrower_name || null,
        employee_id || null,
        borrower_department || null,
        borrow_date || null,
        expected_return_date || null,
        actual_return_date || null,
        condition_before || null,
        condition_after || null,
        notes || null,
        id,
      ]
    );

    const updatedAsset = result.rows[0];

    await insertAssetHistory(updatedAsset.asset_id, "Status Change", {
      from: currentAsset.status,
      to: status,
      borrower_name,
      employee_id,
      borrower_department,
      borrow_date,
      expected_return_date,
      actual_return_date,
      condition_before,
      condition_after,
      notes,
    }, currentAsset.branch_id, null);

    await createBorrowRecord(updatedAsset.asset_id, {
      borrower_name,
      employee_id,
      borrower_department,
      borrow_date,
      expected_return_date,
      actual_return_date,
      condition_before,
      condition_after,
      notes,
      status_from: currentAsset.status,
      status_to: status,
      branch_id: currentAsset.branch_id,
      created_by: null,
    });

    res.json(updatedAsset);
  } catch (err) {
    console.error("Update hardware asset status error:", err.message);
    res.status(500).json({ success: false, error: "Failed to update hardware asset status" });
  }
});

app.get("/api/v1/users", async (req, res) => {
  try {
    const auth = getAuthFromRequest(req);
    let whereClause = "";
    const params = [];
    
    if (auth) {
      const role = String(auth.role || "").toLowerCase();
      if ((role === "admin" || role === "technician") && auth.branchId) {
        whereClause = "WHERE u.branch_id = $1";
        params.push(auth.branchId);
      }
    }

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
      ${whereClause}
      ORDER BY u.created_at DESC, u.user_id DESC
    `, params);

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

    const hashedPwd = `sha256$${crypto.createHash("sha256").update(finalPassword).digest("hex")}`;

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

    const hashedPwd = `sha256$${crypto.createHash("sha256").update(finalPassword).digest("hex")}`;

    const result = await db.query(
      `
      UPDATE users
      SET password_hash = $1
      WHERE user_id = $2
      RETURNING user_id
      `,
      [hashedPwd, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
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

    if (related_ticket_id) {
      const existingArticle = await db.query(
        `SELECT kb_id,title FROM knowledge_base WHERE related_ticket_id=$1 LIMIT 1`,
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
   SOFTWARE LICENSES
========================== */
async function ensureSoftwareLicensesTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS software_licenses (
        license_id SERIAL PRIMARY KEY,
        license_name VARCHAR(255) NOT NULL,
        vendor VARCHAR(255) NOT NULL,
        license_type VARCHAR(50) NOT NULL CHECK (license_type IN ('Subscription', 'Annual', 'Perpetual')),
        total_licenses INTEGER NOT NULL DEFAULT 0,
        used_licenses INTEGER NOT NULL DEFAULT 0,
        expiry_date DATE,
        annual_cost NUMERIC(12,2) DEFAULT 0,
        status VARCHAR(50) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Expiring Soon', 'Expired', 'Available')),
        branch_id INTEGER REFERENCES branches(branch_id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.error("Software licenses table setup error:", err.message);
  }
}
ensureSoftwareLicensesTable();

function parseBranchId(value) {
  if (value === undefined || value === null || value === "") return null;
  if (["all", "undefined", "null"].includes(String(value).toLowerCase())) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function getSoftwareLicenseUser(req) {
  const user = decodeRequestUser(req);
  if (!user) return null;

  return {
    userId: user.userId || user.id || null,
    role: normalizeRole(user.role),
    branchId: parseBranchId(user.branchId),
  };
}

function getSoftwareLicenseScope(req) {
  const user = getSoftwareLicenseUser(req);
  if (!user) return { unauthorized: true };

  if (user.role === "superadmin") {
    return {
      user,
      branchId: parseBranchId(req.query.branch_id || req.query.filter_branch_id),
      canSeeAll: true,
    };
  }

  if (user.role === "admin") {
    if (!user.branchId) return { forbidden: true };
    return { user, branchId: user.branchId, canSeeAll: false };
  }

  return { forbidden: true };
}

function requireSoftwareLicenseScope(req, res) {
  const scope = getSoftwareLicenseScope(req);
  if (scope.unauthorized) {
    res.status(401).json({ success: false, error: "Authentication required." });
    return null;
  }
  if (scope.forbidden) {
    res.status(403).json({ success: false, error: "Access denied for your role or branch." });
    return null;
  }
  return scope;
}

async function branchExists(branchId) {
  if (!branchId) return false;
  const result = await db.query(
    `SELECT branch_id FROM branches WHERE branch_id = $1 LIMIT 1`,
    [branchId]
  );
  return result.rows.length > 0;
}

function canManageSoftwareLicense(scope, licenseBranchId) {
  if (!scope?.user) return false;
  if (scope.user.role === "superadmin") return true;
  return scope.user.role === "admin" && Number(scope.user.branchId) === Number(licenseBranchId);
}

function computeSoftwareLicenseStatus(expiryDate) {
  if (!expiryDate) return "Active";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${String(expiryDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return "Active";
  if (expiry < today) return "Expired";
  const daysRemaining = Math.ceil((expiry - today) / 86400000);
  return daysRemaining <= 30 ? "Expiring Soon" : "Active";
}

// GET /api/v1/software-licenses?branch_id=1
app.get("/api/v1/software-licenses", async (req, res) => {
  try {
    const scope = requireSoftwareLicenseScope(req, res);
    if (!scope) return;

    let whereClause = "";
    const params = [];

    if (scope.branchId) {
      params.push(scope.branchId);
      whereClause = `WHERE sl.branch_id = $1`;
    }

    const result = await db.query(
      `SELECT
        sl.*,
        GREATEST(sl.total_licenses - sl.used_licenses, 0) AS available_licenses,
        (sl.used_licenses > sl.total_licenses) AS is_overused,
        CASE
          WHEN sl.expiry_date < CURRENT_DATE THEN 'Expired'
          WHEN sl.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'Expiring Soon'
          ELSE 'Active'
        END AS status,
        b.branch_name
      FROM software_licenses sl
      LEFT JOIN branches b ON sl.branch_id = b.branch_id
      ${whereClause}
      ORDER BY sl.created_at DESC`,
      params
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Fetch software licenses error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch software licenses." });
  }
});

// GET /api/v1/software-licenses/summary?branch_id=1
app.get("/api/v1/software-licenses/summary", async (req, res) => {
  try {
    const scope = requireSoftwareLicenseScope(req, res);
    if (!scope) return;

    let whereClause = "";
    const params = [];

    if (scope.branchId) {
      params.push(scope.branchId);
      whereClause = `WHERE sl.branch_id = $1`;
    }

    const result = await db.query(
      `SELECT
        COALESCE(SUM(sl.total_licenses)::int, 0) AS total_licenses,
        COALESCE(SUM(sl.used_licenses)::int, 0) AS total_in_use,
        COALESCE(SUM(GREATEST(sl.total_licenses - sl.used_licenses, 0))::int, 0) AS total_available,
        COALESCE(SUM(sl.annual_cost)::numeric, 0) AS total_annual_cost,
        COUNT(*) FILTER (WHERE sl.expiry_date IS NOT NULL AND sl.expiry_date <= CURRENT_DATE + INTERVAL '30 days' AND sl.expiry_date >= CURRENT_DATE)::int AS expiring_soon
      FROM software_licenses sl
      ${whereClause}`,
      params
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Fetch software licenses summary error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch software licenses summary." });
  }
});

// POST /api/v1/software-licenses
app.post("/api/v1/software-licenses", async (req, res) => {
  try {
    const scope = requireSoftwareLicenseScope(req, res);
    if (!scope) return;

    const { license_name, vendor, license_type, total_licenses, used_licenses, expiry_date, annual_cost, branch_id } = req.body;
    const targetBranchId = scope.user.role === "superadmin" ? parseBranchId(branch_id) : scope.user.branchId;
    const totalLicenseCount = Number.parseInt(total_licenses, 10);
    const usedLicenseCount = Number.parseInt(used_licenses, 10);

    if (!license_name || !vendor || !license_type) {
      return res.status(400).json({ success: false, error: "License name, vendor, and type are required." });
    }

    if (!Number.isInteger(totalLicenseCount) || !Number.isInteger(usedLicenseCount) || totalLicenseCount < 0 || usedLicenseCount < 0) {
      return res.status(400).json({ success: false, error: "License totals must be valid non-negative numbers." });
    }

    if (!targetBranchId) {
      return res.status(400).json({ success: false, error: "Branch is required." });
    }

    if (!(await branchExists(targetBranchId))) {
      return res.status(400).json({ success: false, error: "Selected branch does not exist or is inactive." });
    }

    const result = await db.query(
      `INSERT INTO software_licenses (license_name, vendor, license_type, total_licenses, used_licenses, expiry_date, annual_cost, status, branch_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [license_name, vendor, license_type, totalLicenseCount, usedLicenseCount, expiry_date || null, parseFloat(annual_cost) || 0, computeSoftwareLicenseStatus(expiry_date), targetBranchId]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Create software license error:", err.message);
    res.status(500).json({ success: false, error: "Failed to create software license." });
  }
});

// PUT /api/v1/software-licenses/:id
app.put("/api/v1/software-licenses/:id", async (req, res) => {
  try {
    const scope = requireSoftwareLicenseScope(req, res);
    if (!scope) return;

    const { id } = req.params;
    const { license_name, vendor, license_type, total_licenses, used_licenses, expiry_date, annual_cost, branch_id } = req.body;
    const totalLicenseCount = Number.parseInt(total_licenses, 10);
    const usedLicenseCount = Number.parseInt(used_licenses, 10);
    const existing = await db.query(
      `SELECT license_id, branch_id FROM software_licenses WHERE license_id = $1 LIMIT 1`,
      [parseInt(id)]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: "License not found." });
    }

    if (!canManageSoftwareLicense(scope, existing.rows[0].branch_id)) {
      return res.status(403).json({ success: false, error: "Update denied for this license branch." });
    }

    if (!Number.isInteger(totalLicenseCount) || !Number.isInteger(usedLicenseCount) || totalLicenseCount < 0 || usedLicenseCount < 0) {
      return res.status(400).json({ success: false, error: "License totals must be valid non-negative numbers." });
    }

    const targetBranchId = scope.user.role === "superadmin"
      ? parseBranchId(branch_id) || existing.rows[0].branch_id
      : existing.rows[0].branch_id;

    if (!(await branchExists(targetBranchId))) {
      return res.status(400).json({ success: false, error: "Selected branch does not exist or is inactive." });
    }

    const result = await db.query(
      `UPDATE software_licenses SET
        license_name = $1, vendor = $2, license_type = $3,
        total_licenses = $4, used_licenses = $5,
        expiry_date = $6, annual_cost = $7, status = $8,
        branch_id = $9,
        updated_at = CURRENT_TIMESTAMP
      WHERE license_id = $10
      RETURNING *`,
      [license_name, vendor, license_type, totalLicenseCount, usedLicenseCount, expiry_date || null, parseFloat(annual_cost) || 0, computeSoftwareLicenseStatus(expiry_date), targetBranchId, parseInt(id)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "License not found." });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Update software license error:", err.message);
    res.status(500).json({ success: false, error: "Failed to update software license." });
  }
});

// DELETE /api/v1/software-licenses/:id
app.delete("/api/v1/software-licenses/:id", async (req, res) => {
  try {
    const scope = requireSoftwareLicenseScope(req, res);
    if (!scope) return;

    const { id } = req.params;
    const existing = await db.query(
      `SELECT license_id, branch_id FROM software_licenses WHERE license_id = $1 LIMIT 1`,
      [parseInt(id)]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: "License not found." });
    }

    if (!canManageSoftwareLicense(scope, existing.rows[0].branch_id)) {
      return res.status(403).json({ success: false, error: "Delete denied for this license branch." });
    }

    const result = await db.query(
      `DELETE FROM software_licenses WHERE license_id = $1 RETURNING license_id`,
      [parseInt(id)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "License not found." });
    }

    res.json({ success: true, message: "License deleted successfully." });
  } catch (err) {
    console.error("Delete software license error:", err.message);
    res.status(500).json({ success: false, error: "Failed to delete software license." });
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

    const slaDueDate = await calculateSlaDueDate(priority || "P3-Medium");
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
    const currentUserId =
      req.body?.current_user_id ||
      req.query.current_user_id ||
      req.body?.user_id ||
      req.query.user_id ||
      null;
    const currentRole = String(
      req.body?.role_name || req.query.role_name || req.body?.current_role || ""
    ).toLowerCase();
    const currentBranchId =
      req.body?.current_branch_id ||
      req.query.current_branch_id ||
      req.body?.branch_id ||
      req.query.branch_id ||
      null;

    if (!["superadmin", "admin", "technician"].includes(currentRole)) {
      return res.status(403).json({
        success: false,
        error: "You are not allowed to assign tickets.",
      });
    }

    if (
      currentRole === "technician" &&
      (!currentUserId || !assigned_to || Number(assigned_to) !== Number(currentUserId))
    ) {
      return res.status(403).json({
        success: false,
        error: "Technicians can only accept tickets for themselves.",
      });
    }

    const existingResult = await db.query(
      `
      SELECT
        t.id,
        t.assigned_to,
        t.branch_id,
        t.status,
        COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name
      FROM tickets t
      LEFT JOIN branches b
        ON t.branch_id = b.branch_id
      WHERE t.id = $1
      `,
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found",
      });
    }

    const ticket = existingResult.rows[0];

    if (currentRole === "admin") {
      if (!currentBranchId || Number(ticket.branch_id) !== Number(currentBranchId)) {
        return res.status(403).json({
          success: false,
          error: "Admin can only assign technicians from the same branch.",
        });
      }
    }

    if (
      currentRole === "technician" &&
      ticket.assigned_to &&
      Number(ticket.assigned_to) !== Number(currentUserId)
    ) {
      return res.status(403).json({
        success: false,
        error: "Technicians can only accept unassigned tickets.",
      });
    }

    if (assigned_to) {
      const technicianResult = await db.query(
        `
        SELECT
          u.user_id,
          u.full_name,
          u.branch_id,
          COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name
        FROM users u
        JOIN system_roles sr
          ON u.role_id = sr.role_id
        LEFT JOIN branches b
          ON u.branch_id = b.branch_id
        WHERE u.user_id = $1
          AND LOWER(sr.role_name) = 'technician'
          AND COALESCE(u.is_active, TRUE) = TRUE
        `,
        [assigned_to]
      );

      if (technicianResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Selected user is not an active technician",
        });
      }

      const technician = technicianResult.rows[0];

      if (!ticket.branch_id || !technician.branch_id) {
        return res.status(400).json({
          success: false,
          error: "Ticket and technician must both have an assigned branch.",
        });
      }

      if (
        currentRole === "admin" &&
        (Number(technician.branch_id) !== Number(currentBranchId) ||
          Number(technician.branch_id) !== Number(ticket.branch_id))
      ) {
        return res.status(403).json({
          success: false,
          error: "Admin can only assign technicians from the same branch.",
        });
      }

      if (Number(ticket.branch_id) !== Number(technician.branch_id)) {
        return res.status(403).json({
          success: false,
          error: `Technician must belong to the same branch as the ticket. Ticket branch: ${ticket.branch_name}, Technician branch: ${technician.branch_name}`,
        });
      }
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
        branch_id,
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
        changed_by || currentUserId,
        "Ticket Assigned",
        ticket.assigned_to,
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

app.get('/', (req, res) => res.status(200).json({ success: true, message: "API is online" }));



/* ==========================
   START SERVER
========================== */

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`AstreaBlue API active on port ${PORT}`);
  console.log(
    `[AstreaBlue API] health=http://localhost:${PORT}/api/health dashboard=http://localhost:${PORT}/api/v1/dashboard/summary`
  );
  console.log(
    "[AstreaBlue API] mounted routes: /api/auth, /api/v1/dashboard, /api/v1/tickets, /api/v1/branches, /api/v1/users, /api/v1/roles, /api/v1/technicians, /api/v1/ticket-categories, /api/v1/invites, /api/v1/email, /api/v1/knowledge-base, /api/v1/requests, /api/v1/ra-10173-compliance"
  );
});

app.post("/api/v1/ticket-categories", async (req, res) => {
  const user = decodeRequestUser(req);
  if (!user) return res.status(401).json({ success: false, error: "Authentication required." });

  const categoryName = String(req.body?.category_name || "").trim().replace(/\s+/g, " ");
  if (!categoryName || categoryName.length > 100 || categoryName.toLowerCase() === "other") {
    return res.status(400).json({ success: false, error: "Specify a valid category up to 100 characters." });
  }

  try {
    const existing = await db.query(
      `SELECT category_id,category_name,description FROM ticket_categories WHERE LOWER(category_name)=LOWER($1) LIMIT 1`,
      [categoryName]
    );
    if (existing.rows.length) {
      return res.json({ success: true, message: "Category already exists.", category: existing.rows[0], created: false });
    }

    try {
      const inserted = await db.query(
        `INSERT INTO ticket_categories (category_name) VALUES ($1) RETURNING category_id,category_name,description`,
        [categoryName]
      );
      return res.status(201).json({ success: true, message: "Category created.", category: inserted.rows[0], created: true });
    } catch (insertError) {
      if (insertError.code !== "23505") throw insertError;
      const concurrent = await db.query(
        `SELECT category_id,category_name,description FROM ticket_categories WHERE LOWER(category_name)=LOWER($1) LIMIT 1`,
        [categoryName]
      );
      return res.json({ success: true, message: "Category already exists.", category: concurrent.rows[0], created: false });
    }
  } catch (error) {
    console.error("Create ticket category error:", error.message);
    return res.status(500).json({ success: false, error: "Failed to save ticket category." });
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

module.exports = { app, httpServer, get io() { return io; } };
