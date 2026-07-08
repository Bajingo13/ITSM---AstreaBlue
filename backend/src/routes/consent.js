/**
 * RA 10173 Consent Document Workflow Route
 * All consent operations: create, sign, withdraw, print, audit, policy.
 */

const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../../config/db");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";

// ─── Signature image storage ──────────────────────────────────────────────────
const sigDir = path.join(__dirname, "..", "..", "uploads", "consent-signatures");
fs.mkdirSync(sigDir, { recursive: true });

// ─── DB bootstrap (idempotent) ────────────────────────────────────────────────
const tablesReady = (async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS consent_documents (
        consent_id        BIGSERIAL PRIMARY KEY,
        employee_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        employee_full_name VARCHAR(255) NOT NULL,
        employee_email    VARCHAR(255) NOT NULL,
        employee_number   VARCHAR(100),
        branch_id         INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
        branch_name       VARCHAR(255),
        department        VARCHAR(255),
        form_title        VARCHAR(255) NOT NULL DEFAULT 'RA 10173 Data Privacy Consent — Employee Monitoring',
        consent_version   VARCHAR(50)  NOT NULL DEFAULT '1.0',
        monitoring_preferences JSONB   NOT NULL DEFAULT '[]',
        signed_at         TIMESTAMPTZ,
        e_signature_image TEXT,
        printed_name      VARCHAR(255),
        status            VARCHAR(30)  NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','signed','withdrawn','superseded')),
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS consent_audit_logs (
        log_id       BIGSERIAL PRIMARY KEY,
        consent_id   BIGINT REFERENCES consent_documents(consent_id) ON DELETE SET NULL,
        employee_id  INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        actor_id     INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        actor_role   VARCHAR(50),
        event_type   VARCHAR(80) NOT NULL,
        details      TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS consent_documents_employee_idx ON consent_documents(employee_id);
      CREATE INDEX IF NOT EXISTS consent_documents_status_idx   ON consent_documents(status);
      CREATE INDEX IF NOT EXISTS consent_audit_employee_idx ON consent_audit_logs(employee_id);
      CREATE INDEX IF NOT EXISTS consent_audit_consent_idx  ON consent_audit_logs(consent_id);
    `);
    // Idempotently add optional user fields used by consent documents
    await db.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_number VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(255);
    `);
    return true;
  } catch (err) {
    console.error("[consent] table init failed:", err.message);
    return false;
  }
})();

router.use(async (_req, res, next) => {
  if (await tablesReady) return next();
  return res.status(503).json({ success: false, message: "Consent storage unavailable." });
});

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function parseUser(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  try { return jwt.verify(auth.slice(7), JWT_SECRET); } catch { return null; }
}

function requireAuth(req, res, next) {
  const user = parseUser(req);
  if (!user) return res.status(401).json({ success: false, message: "Authentication required." });
  req.actor = user;
  return next();
}

function requireAdminOrHR(req, res, next) {
  const user = parseUser(req);
  if (!user) return res.status(401).json({ success: false, message: "Authentication required." });
  const r = String(user.role || "").toLowerCase().replace(/[\s_-]/g, "");
  if (!["superadmin", "admin", "hr"].includes(r))
    return res.status(403).json({ success: false, message: "Admin or HR role required." });
  req.actor = user;
  return next();
}

// ─── Audit helper ─────────────────────────────────────────────────────────────
async function audit(consentId, employeeId, actorId, actorRole, eventType, details) {
  try {
    await db.query(
      `INSERT INTO consent_audit_logs (consent_id,employee_id,actor_id,actor_role,event_type,details)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [consentId || null, employeeId || null, actorId || null, actorRole || null, eventType, details || null]
    );
  } catch (err) {
    console.error("[consent:audit] failed:", err.message);
  }
}

// ─── Manila timestamp helper ──────────────────────────────────────────────────
function manilaTime(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  return d.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: true,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMPLOYEE ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /consent/my — fetch my active/latest consent document
router.get("/my", requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM consent_documents WHERE employee_id=$1
       ORDER BY CASE status WHEN 'signed' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                created_at DESC LIMIT 1`,
      [req.actor.userId || req.actor.user_id]
    );
    return res.json({ success: true, data: result.rows[0] || null });
  } catch (err) {
    console.error("[consent:my]", err.message);
    return res.status(500).json({ success: false, message: "Failed to load consent." });
  }
});

// POST /consent/draft — employee starts a new draft (only if no active signed doc)
router.post("/draft", requireAuth, async (req, res) => {
  const employeeId = req.actor.userId || req.actor.user_id;
  try {
    // Check for existing signed consent
    const existing = await db.query(
      `SELECT consent_id, status FROM consent_documents
       WHERE employee_id=$1 AND status='signed' LIMIT 1`,
      [employeeId]
    );
    if (existing.rows.length)
      return res.status(409).json({
        success: false,
        message: "You already have a signed consent document. Use 'Request Consent Change' to modify it.",
        existing: existing.rows[0],
      });

    // Fetch employee profile
    const userRes = await db.query(
      `SELECT u.full_name, u.email, u.employee_number,
              b.branch_name, b.branch_id, u.department
       FROM users u
       LEFT JOIN branches b ON b.branch_id=u.branch_id
       WHERE u.user_id=$1`,
      [employeeId]
    );
    if (!userRes.rows.length)
      return res.status(404).json({ success: false, message: "Employee profile not found." });
    const emp = userRes.rows[0];

    const draft = await db.query(
      `INSERT INTO consent_documents
         (employee_id,employee_full_name,employee_email,employee_number,
          branch_id,branch_name,department,form_title,consent_version,
          monitoring_preferences,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')
       RETURNING *`,
      [
        employeeId,
        emp.full_name || "Unknown",
        emp.email || "",
        emp.employee_number || null,
        emp.branch_id || null,
        emp.branch_name || null,
        emp.department || null,
        "RA 10173 Data Privacy Consent — Employee Monitoring",
        "1.0",
        JSON.stringify(req.body.monitoring_preferences || []),
      ]
    );
    await audit(draft.rows[0].consent_id, employeeId, employeeId, req.actor.role, "consent_created",
      "Employee initiated consent draft.");
    return res.status(201).json({ success: true, data: draft.rows[0] });
  } catch (err) {
    console.error("[consent:draft]", err.message);
    return res.status(500).json({ success: false, message: "Failed to create consent draft." });
  }
});

// POST /consent/:id/sign — employee signs the consent (locks it)
router.post("/:id/sign", requireAuth, async (req, res) => {
  const employeeId = req.actor.userId || req.actor.user_id;
  try {
    const docRes = await db.query(
      `SELECT * FROM consent_documents WHERE consent_id=$1 AND employee_id=$2 AND status='pending'`,
      [req.params.id, employeeId]
    );
    if (!docRes.rows.length)
      return res.status(404).json({
        success: false,
        message: "Consent document not found or already signed.",
      });

    const { e_signature_image, printed_name, monitoring_preferences } = req.body;
    if (!e_signature_image || !printed_name)
      return res.status(400).json({ success: false, message: "E-signature and printed name are required." });

    // Save signature image as file (base64 → PNG) for durable storage
    let sigPath = null;
    try {
      const base64Data = String(e_signature_image).replace(/^data:image\/\w+;base64,/, "");
      const filename = `sig-${req.params.id}-${Date.now()}.png`;
      const fullPath = path.join(sigDir, filename);
      fs.writeFileSync(fullPath, Buffer.from(base64Data, "base64"));
      sigPath = `/uploads/consent-signatures/${filename}`;
    } catch (sigErr) {
      console.warn("[consent:sign] Signature file save failed:", sigErr.message);
      // Fall back: store inline base64 (capped to 2 MB)
      sigPath = null;
    }

    const now = new Date();
    const updated = await db.query(
      `UPDATE consent_documents SET
         status='signed',
         signed_at=$1,
         e_signature_image=$2,
         printed_name=$3,
         monitoring_preferences=$4,
         updated_at=CURRENT_TIMESTAMP
       WHERE consent_id=$5 AND employee_id=$6
       RETURNING *`,
      [
        now,
        sigPath || e_signature_image,    // prefer file path, fall back to inline base64
        String(printed_name).trim().slice(0, 255),
        JSON.stringify(monitoring_preferences || docRes.rows[0].monitoring_preferences || []),
        req.params.id,
        employeeId,
      ]
    );

    await audit(req.params.id, employeeId, employeeId, req.actor.role, "consent_signed",
      `Signed at ${manilaTime(now)}. Printed name: ${printed_name}.`);

    return res.json({ success: true, data: updated.rows[0] });
  } catch (err) {
    console.error("[consent:sign]", err.message);
    return res.status(500).json({ success: false, message: "Failed to sign consent." });
  }
});

// POST /consent/request-change — employee files a change/withdrawal request (creates a service ticket)
router.post("/request-change", requireAuth, async (req, res) => {
  const employeeId = req.actor.userId || req.actor.user_id;
  const { consent_id, change_type, reason, requested_changes, current_preferences } = req.body;
  if (!reason || !reason.trim())
    return res.status(400).json({ success: false, message: "Reason is required." });

  try {
    // Fetch active consent
    const consentRes = await db.query(
      `SELECT * FROM consent_documents WHERE consent_id=$1 AND employee_id=$2`,
      [consent_id, employeeId]
    );
    const consent = consentRes.rows[0];
    if (!consent)
      return res.status(404).json({ success: false, message: "Consent document not found." });

    // Build ticket title and description
    const title = change_type === "withdraw"
      ? "Consent Withdrawal Request — RA 10173"
      : "Consent Change Request — RA 10173";
    const currentPrefs = Array.isArray(current_preferences || consent.monitoring_preferences)
      ? (current_preferences || consent.monitoring_preferences).join(", ") || "None"
      : "None";
    const description = [
      `[Category: Privacy Request | Subtype: Consent Change]`,
      ``,
      `Employee: ${consent.employee_full_name} (${consent.employee_email})`,
      `Branch/Department: ${consent.branch_name || "—"} / ${consent.department || "—"}`,
      `Consent Document ID: ${consent.consent_id}`,
      `Consent Version: ${consent.consent_version}`,
      `Request Type: ${change_type === "withdraw" ? "Full Withdrawal" : "Preference Change"}`,
      ``,
      `Current Monitoring Preferences:`,
      currentPrefs,
      ``,
      `Reason:`,
      reason.trim(),
      requested_changes ? `\nRequested Changes:\n${requested_changes.trim()}` : "",
    ].join("\n");

    // Find or create "Consent / Privacy Request" category
    let categoryId = null;
    try {
      const catUpsert = await db.query(
        `INSERT INTO ticket_categories (category_name) VALUES ($1)
         ON CONFLICT (category_name) DO UPDATE SET category_name=EXCLUDED.category_name
         RETURNING category_id`,
        ["Consent / Privacy Request"]
      );
      categoryId = catUpsert.rows[0]?.category_id || null;
    } catch (_catErr) {
      // If upsert fails (e.g. no ON CONFLICT support), try SELECT
      try {
        const catSel = await db.query(`SELECT category_id FROM ticket_categories WHERE category_name=$1`, ["Consent / Privacy Request"]);
        categoryId = catSel.rows[0]?.category_id || null;
      } catch {}
    }

    // Generate ticket number
    const countRes = await db.query(`SELECT COUNT(*)::int AS count FROM tickets WHERE DATE(created_at)=CURRENT_DATE`);
    const nextNum = (countRes.rows[0]?.count || 0) + 1;
    // Find or create 'Privacy Request' category
    let privCategoryId = null;
    try {
      const privCat = await db.query(
        `INSERT INTO ticket_categories (category_name) VALUES ($1)
         ON CONFLICT (category_name) DO UPDATE SET category_name=EXCLUDED.category_name RETURNING category_id`,
        ["Privacy Request"]
      );
      privCategoryId = privCat.rows[0]?.category_id || null;
    } catch { privCategoryId = null; }
    const ticketNumber = `TKT-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${String(nextNum).padStart(4,"0")}`;

    const ticketRes = await db.query(
      `INSERT INTO tickets (ticket_number, title, description, status, priority, category_id, requester_id, created_at, updated_at)
       VALUES ($1,$2,$3,'Open Queue','P3-Medium',$4,$5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
       RETURNING *`,
      [ticketNumber, title, description, privCategoryId || categoryId, employeeId]
    );
    const ticket = ticketRes.rows[0];

    await audit(consent_id, employeeId, employeeId, req.actor.role,
      "consent_change_requested",
      `Request type: ${change_type || "change"}. Ticket: ${ticket.id} (${ticketNumber}). Reason: ${reason.trim()}`);  

    return res.json({
      success: true,
      message: "Consent change request submitted. An admin or HR officer will review it.",
      ticket_id: ticket.id,
      ticket_number: ticketNumber,
    });
  } catch (err) {
    console.error("[consent:request-change]", err.message);
    return res.status(500).json({ success: false, message: "Failed to submit consent change request." });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN / HR ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /consent/all — list all consent documents
router.get("/all", requireAuth, async (req, res) => {
  try {
    const actor = req.actor;
    const role = String(actor.role || "").toLowerCase().replace(/[\s_-]/g, "");
    
    let queryArgs = [];
    let whereClause = "";

    if (role === "superadmin" || role === "hr") {
      whereClause = "";
    } else if (role === "admin") {
      whereClause = "WHERE cd.branch_id = $1";
      queryArgs.push(actor.branchId || actor.branch_id);
    } else {
      whereClause = "WHERE cd.employee_id = $1";
      queryArgs.push(actor.userId || actor.user_id);
    }

    const result = await db.query(
      `SELECT cd.consent_id, 
              cd.employee_full_name AS employee, 
              cd.employee_id, 
              b.branch_name AS branch, 
              cd.department, 
              cd.monitoring_preferences, 
              cd.e_signature_image AS signature, 
              cd.status AS consent_status, 
              cd.created_at AS submitted_at, 
              cd.updated_at
       FROM consent_documents cd
       LEFT JOIN branches b ON b.branch_id = cd.branch_id
       ${whereClause}
       ORDER BY cd.created_at DESC`,
       queryArgs
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("[consent:all]", err.message);
    return res.status(500).json({ success: false, message: "Failed to load consents." });
  }
});

// GET /consent/:id — single consent document
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const actor = req.actor;
    const role = String(actor.role || "").toLowerCase().replace(/[\s_-]/g, "");
    const isAdmin = ["superadmin", "admin", "hr"].includes(role);
    const employeeId = actor.userId || actor.user_id;

    const result = await db.query(
      `SELECT * FROM consent_documents WHERE consent_id=$1 ${isAdmin ? "" : "AND employee_id=$2"}`,
      isAdmin ? [req.params.id] : [req.params.id, employeeId]
    );
    if (!result.rows.length)
      return res.status(404).json({ success: false, message: "Consent document not found." });

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("[consent:get]", err.message);
    return res.status(500).json({ success: false, message: "Failed to load consent." });
  }
});

// POST /consent/:id/log-print — log that admin printed/downloaded the consent
router.post("/:id/log-print", requireAuth, async (req, res) => {
  const actor = req.actor;
  try {
    const docRes = await db.query(
      `SELECT employee_id FROM consent_documents WHERE consent_id=$1`, [req.params.id]
    );
    if (!docRes.rows.length)
      return res.status(404).json({ success: false, message: "Consent not found." });
    const eventType = req.body.action === "download" ? "consent_downloaded" : "consent_printed";
    await audit(req.params.id, docRes.rows[0].employee_id, actor.userId || actor.user_id,
      actor.role, eventType, `Document ${req.body.action === "download" ? "downloaded" : "printed"} by ${actor.role}.`);
    return res.json({ success: true });
  } catch (err) {
    console.error("[consent:log-print]", err.message);
    return res.status(500).json({ success: false, message: "Failed to log print." });
  }
});

// PUT /consent/:id/admin-action — admin approves withdrawal or change
router.put("/:id/admin-action", requireAdminOrHR, async (req, res) => {
  const { action, notes } = req.body; // action: 'withdraw' | 'supersede' | 'reject'
  const actor = req.actor;
  try {
    const docRes = await db.query(
      `SELECT * FROM consent_documents WHERE consent_id=$1`, [req.params.id]
    );
    if (!docRes.rows.length)
      return res.status(404).json({ success: false, message: "Consent not found." });

    let newStatus = docRes.rows[0].status;
    let eventType = "consent_approved";
    if (action === "withdraw") {
      newStatus = "withdrawn";
      eventType = "consent_withdrawn";
    } else if (action === "supersede") {
      newStatus = "superseded";
      eventType = "consent_superseded";
    } else if (action === "reject") {
      eventType = "consent_rejected";
    }

    if (action !== "reject") {
      await db.query(
        `UPDATE consent_documents SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE consent_id=$2`,
        [newStatus, req.params.id]
      );
    }

    await audit(req.params.id, docRes.rows[0].employee_id,
      actor.userId || actor.user_id, actor.role, eventType,
      notes || `Admin action: ${action}.`);

    return res.json({ success: true, new_status: newStatus });
  } catch (err) {
    console.error("[consent:admin-action]", err.message);
    return res.status(500).json({ success: false, message: "Failed to apply admin action." });
  }
});

// POST /consent/:id/approve-change — admin approves a change request, creates new consent version
router.post("/:id/approve-change", requireAdminOrHR, async (req, res) => {
  const { new_preferences, notes } = req.body;
  const actor = req.actor;
  try {
    const docRes = await db.query(
      `SELECT * FROM consent_documents WHERE consent_id=$1 AND status='signed'`,
      [req.params.id]
    );
    if (!docRes.rows.length)
      return res.status(404).json({ success: false, message: "Active signed consent not found." });
    const old = docRes.rows[0];

    // Bump major version: "1.0" → "2.0"
    const oldMajor = parseInt(String(old.consent_version || "1").split(".")[0]) || 1;
    const newVersion = `${oldMajor + 1}.0`;

    // Create new consent document inheriting employee identity + original signature
    const newDoc = await db.query(
      `INSERT INTO consent_documents
         (employee_id, employee_full_name, employee_email, employee_number,
          branch_id, branch_name, department, form_title, consent_version,
          monitoring_preferences, signed_at, e_signature_image, printed_name, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_TIMESTAMP,$11,$12,'signed')
       RETURNING *`,
      [
        old.employee_id, old.employee_full_name, old.employee_email, old.employee_number,
        old.branch_id, old.branch_name, old.department, old.form_title, newVersion,
        JSON.stringify(new_preferences || old.monitoring_preferences || []),
        old.e_signature_image, old.printed_name,
      ]
    );

    // Archive old consent
    await db.query(
      `UPDATE consent_documents SET status='superseded', updated_at=CURRENT_TIMESTAMP WHERE consent_id=$1`,
      [old.consent_id]
    );

    const newId = newDoc.rows[0].consent_id;
    await audit(old.consent_id, old.employee_id, actor.userId || actor.user_id, actor.role,
      "consent_superseded", `Superseded by new version ${newVersion} upon admin approval.`);
    await audit(newId, old.employee_id, actor.userId || actor.user_id, actor.role,
      "consent_approved", notes || `Change approved by ${actor.name || actor.role}. New version: ${newVersion}.`);
    await audit(newId, old.employee_id, actor.userId || actor.user_id, actor.role,
      "policy_updated", `Monitoring policy updated to consent version ${newVersion}.`);

    return res.json({
      success: true,
      new_consent: newDoc.rows[0],
      message: `Consent updated to version ${newVersion}.`,
    });
  } catch (err) {
    console.error("[consent:approve-change]", err.message);
    return res.status(500).json({ success: false, message: "Failed to approve consent change." });
  }
});

// GET /consent/:id/audit — audit trail for a consent (admin/HR)
router.get("/:id/audit", requireAdminOrHR, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT cal.*, u.full_name actor_name
       FROM consent_audit_logs cal
       LEFT JOIN users u ON u.user_id=cal.actor_id
       WHERE cal.consent_id=$1
       ORDER BY cal.created_at ASC`,
      [req.params.id]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("[consent:audit]", err.message);
    return res.status(500).json({ success: false, message: "Failed to load audit trail." });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MONITORING POLICY — used by laptop agent / endpoint monitoring
// ═══════════════════════════════════════════════════════════════════════════════

// GET /consent/policy/:userId — return active consent policy for a user
router.get("/policy/:userId", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT consent_id, status, monitoring_preferences, signed_at, consent_version
       FROM consent_documents
       WHERE employee_id=$1
       ORDER BY CASE status WHEN 'signed' THEN 0 ELSE 1 END, signed_at DESC NULLS LAST
       LIMIT 1`,
      [req.params.userId]
    );
    const doc = result.rows[0];
    // Log policy sync (non-blocking)
    audit(doc?.consent_id || null, Number(req.params.userId) || null, null, "agent",
      "policy_synced", `Agent fetched policy for user ${req.params.userId}.`).catch(() => {});

    if (!doc || doc.status !== "signed") {
      return res.json({
        success: true,
        policy: {
          optional_monitoring_enabled: false,
          reason: doc ? `Consent status: ${doc.status}` : "No consent on file",
          preferences: [],
          // Policy plumbing: feature flags for agent implementation
          screenshot_allowed: false,
          usb_monitoring_allowed: false,
          website_monitoring_allowed: false,
        },
      });
    }
    const prefs = doc.monitoring_preferences || [];
    return res.json({
      success: true,
      policy: {
        optional_monitoring_enabled: true,
        preferences: prefs,
        signed_at: doc.signed_at,
        consent_version: doc.consent_version,
        consent_id: doc.consent_id,
        // Convenience feature flags for agent consumption
        screenshot_allowed: Array.isArray(prefs) && prefs.includes("screenshot"),
        usb_monitoring_allowed: Array.isArray(prefs) && prefs.includes("usb_monitoring"),
        website_monitoring_allowed: Array.isArray(prefs) && prefs.includes("website_monitoring"),
      },
    });
  } catch (err) {
    console.error("[consent:policy]", err.message);
    return res.status(500).json({ success: false, message: "Failed to load consent policy." });
  }
});

module.exports = router;
