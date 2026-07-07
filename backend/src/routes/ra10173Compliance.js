const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const PDFDocument = require("pdfkit");
const db = require("../../config/db");
const { sendMail } = require("../services/emailService");
const { generateEmailHtml } = require("../services/emailTemplates");
const JWT_SECRET = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
const router = express.Router();

// Ensure upload directory for signatures
const signatureDir = path.join(__dirname, "..", "..", "uploads", "signatures");

// Ensure PDF storage directory
const pdfDir = path.join(__dirname, "..", "..", "uploads", "pdf");
fs.mkdirSync(pdfDir, { recursive: true });
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

    // Prevent duplicate consents
    const existingConsent = await db.query(
      `SELECT id, consent_status FROM laptop_activity_monitoring WHERE user_id = $1 AND consent_status = 'Consented' LIMIT 1`,
      [user.userId]
    );
    if (existingConsent.rows.length > 0) {
      return res.status(409).json({ success: false, error: "Consent has already been submitted. Use PUT to update preferences." });
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

// ─── PDF Generation ────────────────────────────────────────────
function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dataUriToBuffer(dataUri) {
  if (!dataUri || !dataUri.startsWith("data:")) return null;
  const matches = dataUri.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
  if (!matches) return null;
  return Buffer.from(matches[2], "base64");
}

async function generateConsentPdf(consent, userRecord) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const buffers = [];
  doc.on("data", (chunk) => buffers.push(chunk));

  const MONITORING_LABELS = [
    { key: "application_monitoring", label: "Application Monitoring" },
    { key: "web_monitoring", label: "Web Activity Monitoring" },
    { key: "location_tracking", label: "Location Tracking" },
    { key: "device_telemetry", label: "Device Telemetry" },
    { key: "email_header_monitoring", label: "Email Header Monitoring" },
  ];

  const navy = "#0B2B5E";
  const blue = "#0B4FA8";
  const dark = "#1E2A44";
  const muted = "#64748B";
  const green = "#059669";
  const border = "#E2E8F0";
  const light = "#F1F5F9";
  const altRow = "#F8FAFC";
  const white = "#FFFFFF";

  const PW = doc.page.width;
  const M = 40;
  const CW = PW - M * 2;
  let y = M;

  // ─── HEADER BANNER ─────────────────────────────────────────────
  doc.rect(0, 0, PW, 115).fill(blue);

  // Logo — properly sized, positioned left
  const logoPath = path.join(__dirname, "..", "..", "..", "frontend", "public", "astrea-blue-logo.png");
  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, M, 14, { width: 140 });
    } catch (_) {
      // fallback
    }
  }

  // "Enterprise IT Service Management" — right of logo, vertically centred
  doc.fillColor(white).fontSize(8).font("Helvetica")
    .text("Enterprise IT Service Management", M + 155, 44);

  // Document title — below the logo
  doc.fontSize(13).font("Helvetica-Bold")
    .text("RA 10173 Compliance Consent Summary", M, 88);
  doc.fontSize(7).font("Helvetica")
    .text("Data Privacy Act of 2012 \u2014 Republic Act No. 10173", M, 104);
  doc.rect(M, 111, CW, 1.5).fill("#38BDF8");
  y = 130;

  // ─── EMPLOYEE INFORMATION (two-column table) ───────────────────
  doc.roundedRect(M, y, CW, 18, 3).fill(light);
  doc.fillColor(dark).fontSize(8.5).font("Helvetica-Bold")
    .text("EMPLOYEE INFORMATION", M + 10, y + 5);
  y += 24;

  const tCol1 = M + 8;
  const tCol2 = M + 120;
  const empFields = [
    ["Full Name", userRecord.full_name || "N/A"],
    ["Employee ID", String(userRecord.user_id || "N/A")],
    ["Department", userRecord.team_department || "N/A"],
    ["Branch", userRecord.branch_name || "Unassigned"],
  ];
  const empRowH = 17;
  const empTableH = empFields.length * empRowH + 6;

  doc.roundedRect(M, y, CW, empTableH, 4).fill(white);
  doc.roundedRect(M, y, CW, empTableH, 4).lineWidth(0.5).stroke(border);

  for (let i = 0; i < empFields.length; i++) {
    const ry = y + 5 + i * empRowH;
    if (i % 2 === 0) {
      doc.rect(M + 2, ry - 1, CW - 4, empRowH).fill(altRow);
    }
    doc.fillColor(muted).fontSize(7.5).font("Helvetica-Bold")
      .text(empFields[i][0], tCol1, ry + 1);
    doc.fillColor(dark).fontSize(8).font("Helvetica")
      .text(empFields[i][1], tCol2, ry + 1);
  }
  y += empTableH + 14;

  // ─── CONSENT STATUS ────────────────────────────────────────────
  doc.roundedRect(M, y, CW, 18, 3).fill(light);
  doc.fillColor(dark).fontSize(8.5).font("Helvetica-Bold")
    .text("CONSENT STATUS", M + 10, y + 5);
  y += 24;

  const isConsented = consent.consent_status === "Consented";
  doc.roundedRect(M, y, CW, 40, 4).fill(white);
  doc.roundedRect(M, y, CW, 40, 4).lineWidth(0.5).stroke(border);

  doc.fontSize(10).font("Helvetica-Bold");
  if (isConsented) {
    doc.fillColor(green).text("Consented", M + 12, y + 6);
  } else {
    doc.fillColor(muted).text(consent.consent_status || "Pending", M + 12, y + 6);
  }
  doc.fillColor(muted).fontSize(7.5).font("Helvetica")
    .text("Submitted:", M + 12, y + 22);
  doc.fillColor(dark).fontSize(7.5).font("Helvetica")
    .text(
      consent.submitted_at
        ? new Date(consent.submitted_at).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "long", timeStyle: "short" })
        : "N/A",
      M + 72, y + 22
    );
  y += 50;

  // ─── MONITORING PREFERENCES (compact table) ────────────────────
  doc.roundedRect(M, y, CW, 18, 3).fill(light);
  doc.fillColor(dark).fontSize(8.5).font("Helvetica-Bold")
    .text("MONITORING PREFERENCES", M + 10, y + 5);
  y += 23;

  const tblLeft = M;
  const tblW = CW;
  const th1 = tblLeft + 12;
  const th2 = tblLeft + tblW - 90;
  const hdrH = 20;

  doc.roundedRect(tblLeft, y, tblW, hdrH, 3).fill(navy);
  doc.fillColor(white).fontSize(7.5).font("Helvetica-Bold")
    .text("Monitoring Feature", th1, y + 6);
  doc.text("Status", th2, y + 6);
  y += hdrH;

  for (let i = 0; i < MONITORING_LABELS.length; i++) {
    const cat = MONITORING_LABELS[i];
    const enabled = consent[cat.key] === true;
    const rh = 20;
    const bg = i % 2 === 0 ? white : altRow;

    doc.rect(tblLeft, y, tblW, rh).fill(bg);
    doc.rect(tblLeft, y, tblW, rh).lineWidth(0.3).stroke(border);

    doc.fillColor(dark).fontSize(7.5).font("Helvetica")
      .text(cat.label, th1, y + 5);

    if (enabled) {
      doc.fillColor(green).fontSize(7.5).font("Helvetica-Bold")
        .text("Enabled", th2, y + 5);
    } else {
      doc.fillColor("#94A3B8").fontSize(7.5).font("Helvetica")
        .text("Disabled", th2, y + 5);
    }
    y += rh;
  }
  y += 14;

  // ─── DIGITAL SIGNATURE (left-aligned, formal) ──────────────────
  doc.roundedRect(M, y, CW, 18, 3).fill(light);
  doc.fillColor(dark).fontSize(8.5).font("Helvetica-Bold")
    .text("EMPLOYEE DIGITAL SIGNATURE", M + 10, y + 5);
  y += 26;

  const sigCardH = 135;
  doc.roundedRect(M, y, CW, sigCardH, 4).fill(white);
  doc.roundedRect(M, y, CW, sigCardH, 4).lineWidth(0.5).stroke(border);

  const sigLeft = M + 16;
  const sigCardBottom = y + sigCardH;
  let sigY = y + 14;

  // Signature image — upper-left inside the box
  if (consent.signature_image) {
    const sigBuf = dataUriToBuffer(consent.signature_image);
    let placed = false;
    if (sigBuf) {
      try {
        doc.image(sigBuf, sigLeft, sigY, { height: 40 });
        sigY += 52;
        placed = true;
      } catch (_) { /* skip */ }
    }
    if (!placed) {
      const sigPath = consent.signature_image.startsWith("/")
        ? path.join(__dirname, "..", "..", consent.signature_image) : null;
      if (sigPath && fs.existsSync(sigPath)) {
        try { doc.image(sigPath, sigLeft, sigY, { height: 40 }); sigY += 52; } catch (_) { sigY += 12; }
      } else {
        sigY += 12;
      }
    }
  } else {
    sigY += 12;
  }

  // Horizontal signature line
  const lineY = Math.max(sigY, sigCardBottom - 52);
  doc.moveTo(sigLeft, lineY).lineTo(sigLeft + 200, lineY).strokeColor(dark).lineWidth(1).stroke();

  // Employee name on the left below the line
  const textY = lineY + 8;
  doc.fillColor(dark).fontSize(9).font("Helvetica-Bold")
    .text(userRecord.full_name || "Employee", sigLeft, textY);
  // Employee ID below the name
  doc.fillColor(muted).fontSize(7.5).font("Helvetica")
    .text(`Employee ID: ${userRecord.user_id || "N/A"}`, sigLeft, textY + 15);
  // Date Signed on the right side
  const signedDate = consent.submitted_at
    ? new Date(consent.submitted_at).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric" })
    : "N/A";
  doc.fillColor(muted).fontSize(7.5).font("Helvetica")
    .text(`Date Signed: ${signedDate}`, sigLeft + 280, textY);

  y += sigCardH + 14;

  // ─── DIVIDER ───────────────────────────────────────────────────
  doc.moveTo(M, y).lineTo(M + CW, y).strokeColor(border).lineWidth(0.5).stroke();
  y += 10;

  // ─── FOOTER ────────────────────────────────────────────────────
  const genDate = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "long", timeStyle: "short" });
  doc.fillColor(muted).fontSize(6.5).font("Helvetica-Oblique")
    .text(
      "This document certifies that the employee has voluntarily provided consent for laptop activity monitoring " +
      "in accordance with Republic Act No. 10173 (Data Privacy Act of 2012).",
      M, y,
      { align: "center", width: CW }
    );
  y += 14;
  doc.fillColor("#94A3B8").fontSize(6).font("Helvetica")
    .text(
      `Generated by AstreaBlue Enterprise IT Service Management  |  Generated Date: ${genDate}`,
      M, y,
      { align: "center", width: CW }
    );

  doc.end();
  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
  });
}

// GET /pdf-download — Generate, save, email, and return consent PDF
router.get("/pdf-download", requireAuth, async (req, res) => {
  try {
    const user = req.user;

    // Fetch consent record + user details
    const consentResult = await db.query(
      `SELECT lam.*, u.full_name, u.email, b.branch_name
       FROM laptop_activity_monitoring lam
       JOIN users u ON lam.user_id = u.user_id
       LEFT JOIN branches b ON lam.branch_id = b.branch_id
       WHERE lam.user_id = $1
       ORDER BY lam.created_at DESC
       LIMIT 1`,
      [user.userId]
    );

    if (consentResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "No consent record found." });
    }

    const record = consentResult.rows[0];
    const userRecord = {
      full_name: record.full_name,
      user_id: record.user_id,
      team_department: "N/A",
      branch_name: record.branch_name || "Unassigned",
    };

    // Generate PDF
    const pdfBuffer = await generateConsentPdf(record, userRecord);
    const safeName = (record.full_name || "Employee").replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    const filename = `RA10173_Consent_Summary_${safeName}.pdf`;
    const filepath = path.join(pdfDir, filename);

    // Save PDF for audit
    fs.writeFileSync(filepath, pdfBuffer);

    // Send email
    let emailStatus = "skipped";
    let emailError = null;
    try {
      const employeeEmail = record.email;
      if (employeeEmail) {
        const fromName = process.env.SMTP_FROM_NAME || "AstreaBlue ITSM";
        const fromEmail = process.env.EMAIL_FROM || process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
        const emailResult = await sendMail({
          from: `"${fromName}" <${fromEmail}>`,
          to: employeeEmail,
          subject: "RA 10173 Compliance Consent Confirmation",
          text: [
            `Dear ${record.full_name || "Employee"},`,
            "",
            "This email confirms that you have voluntarily provided your consent for laptop activity monitoring under Republic Act No. 10173 (Data Privacy Act of 2012).",
            "",
            `Attached is your official Consent Summary in PDF format for your records.`,
            "",
            "Thank you.",
            "AstreaBlue IT Service Management System",
          ].join("\n"),
          html: generateEmailHtml(
            "RA 10173 Compliance Consent Confirmation",
            `<p>Dear <strong>${escapeHtml(record.full_name || "Employee")}</strong>,</p>
             <p>This email confirms that you have voluntarily provided your consent for laptop activity monitoring under <strong>Republic Act No. 10173 (Data Privacy Act of 2012)</strong>.</p>
             <p>Attached is your official Consent Summary in PDF format for your records.</p>
             <p>Thank you.</p>
             <p><strong>AstreaBlue IT Service Management System</strong></p>`
          ),
          attachments: [
            {
              filename: "Consent-Summary.pdf",
              content: pdfBuffer,
              contentType: "application/pdf",
            },
          ],
        });
        emailStatus = emailResult.success ? "success" : "failed";
      }
    } catch (emailErr) {
      emailStatus = "failed";
      emailError = emailErr.message;
      console.error("Email send error:", emailErr.message);
    }

    // Audit log
    await db.query(
      `INSERT INTO consent_audit_logs (user_id, action, details, ip_address)
       VALUES ($1, 'pdf_downloaded', $2, $3)`,
      [
        user.userId,
        JSON.stringify({
          filename,
          email_status: emailStatus,
          email_error: emailError,
          generated_at: new Date().toISOString(),
        }),
        req.ip || null,
      ]
    );

    // Return PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    console.error("PDF download error:", err.message);
    res.status(500).json({ success: false, error: "Failed to generate consent PDF." });
  }
});

module.exports = router;
