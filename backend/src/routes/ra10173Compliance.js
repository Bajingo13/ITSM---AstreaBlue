const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const db = require("../../config/db");
const JWT_SECRET = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";

const router = express.Router();

// Ensure upload directory for signatures
const signatureDir = path.join(__dirname, "..", "..", "uploads", "signatures");
fs.mkdirSync(signatureDir, { recursive: true });

const signatureStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, signatureDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `sig-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  },
});

const uploadSignature = multer({
  storage: signatureStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    cb(new Error("Only image files are allowed for signatures"));
  },
});

// Inline RBAC helpers
const normalizeRole = (role = "") =>
  role.toString().toLowerCase().replace(/[\s_-]/g, "");
const isSuperAdmin = (role) => normalizeRole(role) === "superadmin";
const isAdmin = (role) => normalizeRole(role) === "admin";
const isEmployee = (role) => normalizeRole(role) === "employee";
const isAdminOrSuper = (role) => isSuperAdmin(role) || isAdmin(role);

function decodeRequestUser(req) {
  const user = req.user || req.query;
  if (user?.userId || user?.user_id) {
    return {
      userId: user.userId || user.user_id,
      role: user.role,
      branchId: user.branchId || user.branch_id || null,
      name: user.name || user.full_name || "",
      email: user.email || "",
    };
  }
  return null;
}

// Require auth middleware — decodes JWT from Authorization header
function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }
    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      userId: decoded.userId || decoded.id || decoded._id,
      role: decoded.role,
      branchId: decoded.branchId || null,
      name: decoded.name || "",
      email: decoded.email || "",
    };
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
}

// POST / — Submit complete consent (Step 4)
router.post("/", requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const {
      application_monitoring,
      web_monitoring,
      location_tracking,
      device_telemetry,
      email_header_monitoring,
      signature_image,
      consent_status = "Consented",
    } = req.body;

    // Validate: device_telemetry must be true
    if (device_telemetry !== true) {
      return res.status(400).json({ success: false, error: "Device Telemetry is required and cannot be disabled." });
    }

    // Get user's branch
    const userResult = await db.query(
      `SELECT branch_id FROM users WHERE user_id = $1`,
      [user.userId]
    );
    const branchId = userResult.rows[0]?.branch_id || null;

    // Insert consent record
    const result = await db.query(
      `INSERT INTO laptop_activity_monitoring
        (user_id, branch_id, application_monitoring, web_monitoring, location_tracking,
         device_telemetry, email_header_monitoring, signature_image, consent_status, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        user.userId,
        branchId,
        application_monitoring || false,
        web_monitoring || false,
        location_tracking || false,
        device_telemetry,
        email_header_monitoring || false,
        signature_image || null,
        consent_status,
      ]
    );

    // Audit log
    await db.query(
      `INSERT INTO consent_audit_logs (user_id, action, details, ip_address)
       VALUES ($1, 'consent_submitted', $2, $3)`,
      [
        user.userId,
        JSON.stringify({
          consent_id: result.rows[0].id,
          preferences: {
            application_monitoring,
            web_monitoring,
            location_tracking,
            device_telemetry,
            email_header_monitoring,
          },
        }),
        req.ip || null,
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Submit consent error:", err.message);
    res.status(500).json({ success: false, error: "Failed to submit consent." });
  }
});

// PUT /:id — Update monitoring preferences (re-consent)
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;
    const {
      application_monitoring,
      web_monitoring,
      location_tracking,
      device_telemetry,
      email_header_monitoring,
      signature_image,
      consent_status = "Consented",
    } = req.body;

    if (device_telemetry !== true) {
      return res.status(400).json({ success: false, error: "Device Telemetry is required and cannot be disabled." });
    }

    // Verify ownership
    const existing = await db.query(
      `SELECT * FROM laptop_activity_monitoring WHERE id = $1`,
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Consent record not found." });
    }

    const record = existing.rows[0];
    if (Number(record.user_id) !== Number(user.userId)) {
      return res.status(403).json({ success: false, error: "You can only update your own consent record." });
    }

    const result = await db.query(
      `UPDATE laptop_activity_monitoring SET
        application_monitoring = $1,
        web_monitoring = $2,
        location_tracking = $3,
        device_telemetry = $4,
        email_header_monitoring = $5,
        signature_image = COALESCE($6, signature_image),
        consent_status = $7,
        submitted_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING *`,
      [
        application_monitoring ?? record.application_monitoring,
        web_monitoring ?? record.web_monitoring,
        location_tracking ?? record.location_tracking,
        device_telemetry ?? record.device_telemetry,
        email_header_monitoring ?? record.email_header_monitoring,
        signature_image || null,
        consent_status,
        id,
      ]
    );

    // Audit log
    await db.query(
      `INSERT INTO consent_audit_logs (user_id, action, details, ip_address)
       VALUES ($1, 'consent_updated', $2, $3)`,
      [
        user.userId,
        JSON.stringify({
          consent_id: id,
          previous: {
            application_monitoring: record.application_monitoring,
            web_monitoring: record.web_monitoring,
            location_tracking: record.location_tracking,
            device_telemetry: record.device_telemetry,
            email_header_monitoring: record.email_header_monitoring,
          },
          updated: {
            application_monitoring,
            web_monitoring,
            location_tracking,
            device_telemetry,
            email_header_monitoring,
          },
        }),
        req.ip || null,
      ]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Update consent error:", err.message);
    res.status(500).json({ success: false, error: "Failed to update consent." });
  }
});

// GET /my-record — Employee: get own consent record
router.get("/my-record", requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const result = await db.query(
      `SELECT * FROM laptop_activity_monitoring WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [user.userId]
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Fetch my consent error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch consent record." });
  }
});

// GET /my-history — Employee: consent history
router.get("/my-history", requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const result = await db.query(
      `SELECT * FROM laptop_activity_monitoring WHERE user_id = $1 ORDER BY created_at DESC`,
      [user.userId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Fetch consent history error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch consent history." });
  }
});

// GET / — SuperAdmin/Admin: list consent records with filters
router.get("/", requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const role = user.role;
    const userBranchId = user.branchId;

    if (!isAdminOrSuper(role)) {
      return res.status(403).json({ success: false, error: "Access denied. Admin or SuperAdmin only." });
    }

    const {
      branch_id,
      status,
      search,
      date_from,
      date_to,
      limit = 50,
      offset = 0,
    } = req.query;

    const conditions = [];
    const params = [];
    let idx = 1;

    // Branch scope
    if (isSuperAdmin(role)) {
      if (branch_id) {
        conditions.push(`lam.branch_id = $${idx++}`);
        params.push(branch_id);
      }
    } else if (isAdmin(role)) {
      conditions.push(`lam.branch_id = $${idx++}`);
      params.push(userBranchId);
    }

    if (status) {
      conditions.push(`lam.consent_status = $${idx++}`);
      params.push(status);
    }

    if (date_from) {
      conditions.push(`lam.submitted_at >= $${idx++}`);
      params.push(date_from);
    }

    if (date_to) {
      conditions.push(`lam.submitted_at <= $${idx++}`);
      params.push(date_to);
    }

    if (search) {
      conditions.push(`(u.full_name ILIKE $${idx} OR u.email ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count
    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total
       FROM laptop_activity_monitoring lam
       JOIN users u ON lam.user_id = u.user_id
       ${whereClause}`,
      params
    );

    // Data
    const result = await db.query(
      `SELECT
        lam.*,
        u.full_name AS employee_name,
        u.email AS employee_email,
        COALESCE(b.branch_name, 'Unassigned') AS branch_name
       FROM laptop_activity_monitoring lam
       JOIN users u ON lam.user_id = u.user_id
       LEFT JOIN branches b ON lam.branch_id = b.branch_id
       ${whereClause}
       ORDER BY lam.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, Number(limit), Number(offset)]
    );

    res.json({
      success: true,
      data: result.rows,
      total: countResult.rows[0]?.total || 0,
    });
  } catch (err) {
    console.error("Fetch consent records error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch consent records." });
  }
});

// GET /summary — Admin dashboard summary
router.get("/summary", requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const role = user.role;
    const userBranchId = user.branchId;

    if (!isAdminOrSuper(role)) {
      return res.status(403).json({ success: false, error: "Access denied." });
    }

    const branchCondition = isSuperAdmin(role)
      ? ""
      : "WHERE lam.branch_id = $1";

    const params = isSuperAdmin(role) ? [] : [userBranchId];

    const summaryResult = await db.query(
      `SELECT
        COUNT(*)::int AS total_consents,
        COUNT(*) FILTER (WHERE lam.consent_status = 'Consented')::int AS consented,
        COUNT(*) FILTER (WHERE lam.consent_status = 'Pending')::int AS pending,
        COUNT(*) FILTER (WHERE lam.consent_status = 'Revoked')::int AS revoked,
        COUNT(*) FILTER (WHERE lam.application_monitoring = TRUE)::int AS app_monitoring,
        COUNT(*) FILTER (WHERE lam.web_monitoring = TRUE)::int AS web_monitoring,
        COUNT(*) FILTER (WHERE lam.location_tracking = TRUE)::int AS location_tracking,
        COUNT(*) FILTER (WHERE lam.email_header_monitoring = TRUE)::int AS email_monitoring
       FROM laptop_activity_monitoring lam
       ${branchCondition}`,
      params
    );

    res.json({ success: true, data: summaryResult.rows[0] || {} });
  } catch (err) {
    console.error("Consent summary error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch consent summary." });
  }
});

// POST /signature — Upload signature image
router.post("/signature", requireAuth, uploadSignature.single("signature"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No signature file provided." });
    }

    const imageUrl = `/uploads/signatures/${req.file.filename}`;

    res.json({ success: true, data: { url: imageUrl, filename: req.file.filename } });
  } catch (err) {
    console.error("Signature upload error:", err.message);
    res.status(500).json({ success: false, error: "Failed to upload signature." });
  }
});

// GET /export — Export consent records (admin only)
router.get("/export", requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const role = user.role;

    if (!isAdminOrSuper(role)) {
      return res.status(403).json({ success: false, error: "Access denied." });
    }

    const { branch_id } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (isSuperAdmin(role)) {
      if (branch_id) {
        conditions.push(`lam.branch_id = $${idx++}`);
        params.push(branch_id);
      }
    } else {
      conditions.push(`lam.branch_id = $${idx++}`);
      params.push(user.branchId);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await db.query(
      `SELECT
        lam.id,
        u.full_name AS employee_name,
        u.email AS employee_email,
        b.branch_name,
        lam.application_monitoring,
        lam.web_monitoring,
        lam.location_tracking,
        lam.device_telemetry,
        lam.email_header_monitoring,
        lam.consent_status,
        lam.submitted_at,
        lam.created_at,
        lam.updated_at
       FROM laptop_activity_monitoring lam
       JOIN users u ON lam.user_id = u.user_id
       LEFT JOIN branches b ON lam.branch_id = b.branch_id
       ${whereClause}
       ORDER BY lam.created_at DESC`,
      params
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Export consent error:", err.message);
    res.status(500).json({ success: false, error: "Failed to export consent records." });
  }
});

module.exports = router;
