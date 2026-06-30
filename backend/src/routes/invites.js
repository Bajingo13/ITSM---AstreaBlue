const express = require("express");
const crypto = require("crypto");
const db = require("../../config/db");
const {
  getMissingSmtpConfig,
  sendInvitationEmail,
} = require("../services/emailService");

const router = express.Router();

const INVITE_STATUSES = {
  PENDING: "Pending",
  ACCEPTED: "Accepted",
  EXPIRED: "Expired",
  REVOKED: "Revoked",
};

function hashPassword(password) {
  return `sha256$${crypto.createHash("sha256").update(password).digest("hex")}`;
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function buildInviteLink(req, token) {
  const origin =
    process.env.FRONTEND_URL ||
    req.body?.app_origin ||
    req.get("origin") ||
    "http://localhost:5173";
  return `${origin.replace(/\/$/, "")}/invite/${token}`;
}

async function getBranchName(branchId) {
  if (!branchId) return "Assigned Branch";

  const result = await db.query(
    `SELECT branch_name FROM branches WHERE branch_id = $1`,
    [branchId]
  );

  return result.rows[0]?.branch_name || "Assigned Branch";
}

async function sendInviteResponse({
  req,
  res,
  invitation,
  inviteRole,
  inviteLink,
  fullName,
  personalEmail,
  branchId,
  customMessage,
}) {
  const safeCustomMessage = customMessage || "Invitation email sent successfully.";
  const missingSmtpConfig = getMissingSmtpConfig();

  if (missingSmtpConfig.length) {
    return res.status(201).json({
      success: true,
      email_sent: false,
      warning: `Invite created, but email sending is not configured. Missing: ${missingSmtpConfig.join(", ")}.`,
      invitation: {
        ...invitation,
        role: inviteRole.role_name,
      },
      invite_link: inviteLink,
    });
  }

  try {
    const branchName = await getBranchName(branchId);
    await sendInvitationEmail({
      to: personalEmail,
      fullName,
      roleName: inviteRole.role_name,
      branchName,
      inviteLink,
    });

    return res.status(201).json({
      success: true,
      email_sent: true,
      message: safeCustomMessage,
      invitation: {
        ...invitation,
        role: inviteRole.role_name,
      },
      invite_link: inviteLink,
    });
  } catch (err) {
    console.error("Invite email send failed:", err.message);

    return res.status(201).json({
      success: true,
      email_sent: false,
      warning: "Invite created, but email sending failed.",
      invitation: {
        ...invitation,
        role: inviteRole.role_name,
      },
      invite_link: inviteLink,
    });
  }
}

async function ensureInviteColumns() {
  try {
    await db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS personal_email VARCHAR(255),
      ADD COLUMN IF NOT EXISTS company_email VARCHAR(255),
      ADD COLUMN IF NOT EXISTS invite_status VARCHAR(20),
      ADD COLUMN IF NOT EXISTS invite_token VARCHAR(120),
      ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS invite_used_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS invited_by INTEGER REFERENCES users(user_id),
      ADD COLUMN IF NOT EXISTS invited_at TIMESTAMP
    `);

    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_invite_token_unique
      ON users(invite_token)
      WHERE invite_token IS NOT NULL
    `);
  } catch (err) {
    console.error("Invite column setup error:", err.message);
  }
}

async function findRole({ role_id, role_name, role }) {
  const roleInput = role_name || role;
  const result = role_id
    ? await db.query(
        `
        SELECT role_id, role_name
        FROM system_roles
        WHERE role_id = $1
        LIMIT 1
        `,
        [role_id]
      )
    : await db.query(
        `
        SELECT role_id, role_name
        FROM system_roles
        WHERE LOWER(role_name) = LOWER($1)
        LIMIT 1
        `,
        [roleInput]
      );

  return result.rows[0] || null;
}

async function findInvite(token) {
  const result = await db.query(
    `
    SELECT
      u.user_id,
      u.full_name,
      u.email,
      u.personal_email,
      u.company_email,
      u.branch_id,
      b.branch_name,
      u.role_id,
      sr.role_name,
      u.invite_status,
      u.invite_token,
      u.invite_expires_at,
      u.invite_used_at
    FROM users u
    LEFT JOIN system_roles sr ON u.role_id = sr.role_id
    LEFT JOIN branches b ON u.branch_id = b.branch_id
    WHERE u.invite_token = $1
    LIMIT 1
    `,
    [token]
  );

  return result.rows[0] || null;
}

async function validateInvite(token) {
  const invite = await findInvite(token);

  if (!invite) {
    return { status: 404, error: "Invite not found." };
  }

  if (invite.invite_status === INVITE_STATUSES.REVOKED) {
    return { status: 400, error: "Invite has been revoked." };
  }

  if (invite.invite_used_at || invite.invite_status === INVITE_STATUSES.ACCEPTED) {
    return { status: 400, error: "Invite has already been used." };
  }

  if (invite.invite_expires_at && new Date(invite.invite_expires_at) < new Date()) {
    await db.query(
      `
      UPDATE users
      SET invite_status = $1
      WHERE user_id = $2
        AND invite_status = $3
      `,
      [INVITE_STATUSES.EXPIRED, invite.user_id, INVITE_STATUSES.PENDING]
    );

    return { status: 400, error: "Invite has expired." };
  }

  if (invite.invite_status !== INVITE_STATUSES.PENDING) {
    return { status: 400, error: "Invite is not active." };
  }

  return { invite };
}

ensureInviteColumns();

router.post("/", async (req, res) => {
  try {
    const {
      full_name,
      personal_email: raw_pe,
      company_email: raw_ce = null,
      role,
      role_name = null,
      role_id = null,
      branch_id,
      company_name = "AstreaBlue",
      current_role,
      current_branch_id,
      current_user_id = null,
    } = req.body;

    const personal_email = raw_pe ? String(raw_pe).trim() : null;
    const company_email = raw_ce ? String(raw_ce).trim() : null;

    const actorRole = normalizeRole(current_role || req.body.role_name || req.body.actor_role);

    if (!["superadmin", "admin"].includes(actorRole)) {
      return res.status(403).json({
        success: false,
        error: "You are not allowed to create invitations.",
      });
    }

    if (!full_name || !personal_email || !(role || role_name || role_id) || !branch_id) {
      return res.status(400).json({
        success: false,
        error: "Full name, personal email, role, and branch are required.",
      });
    }

    if (actorRole === "admin" && Number(branch_id) !== Number(current_branch_id)) {
      return res.status(403).json({
        success: false,
        error: "Admin can invite users only within their own branch.",
      });
    }

    const inviteRole = await findRole({ role_id, role_name, role });

    if (!inviteRole) {
      return res.status(400).json({
        success: false,
        error: "Role does not exist.",
      });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const loginEmail = company_email || personal_email;

    let valid_invited_by = null;
    if (current_user_id) {
      const actorCheck = await db.query('SELECT user_id FROM users WHERE user_id = $1', [current_user_id]);
      if (actorCheck.rows.length > 0) {
        valid_invited_by = actorCheck.rows[0].user_id;
      }
    }

    const existingResult = await db.query(
      `
      SELECT user_id, invite_status, is_active
      FROM users
      WHERE LOWER(email) = LOWER($1)
         OR LOWER(personal_email) = LOWER($2)
         OR ($3::text IS NOT NULL AND LOWER(company_email) = LOWER($3))
      LIMIT 1
      `,
      [loginEmail, personal_email, company_email]
    );

    const existing = existingResult.rows[0];

    if (existing && existing.invite_status !== INVITE_STATUSES.PENDING) {
      return res.status(409).json({
        success: false,
        error: "A non-pending user already exists for this email.",
      });
    }

    if (existing?.is_active) {
      return res.status(409).json({
        success: false,
        error: "An active user already exists for this email.",
      });
    }

    if (existing) {
      const updateResult = await db.query(
        `
        UPDATE users
        SET
          full_name = $1,
          email = $2,
          personal_email = $3,
          company_email = $4,
          password_hash = 'INVITE_PENDING',
          role_id = $5,
          company_name = $6,
          branch_id = $7,
          status = 'Inactive',
          is_active = FALSE,
          invite_status = $8,
          invite_token = $9,
          invite_expires_at = CURRENT_TIMESTAMP + INTERVAL '48 hours',
          invite_used_at = NULL,
          invited_by = $10,
          invited_at = CURRENT_TIMESTAMP
        WHERE user_id = $11
        RETURNING
          user_id,
          full_name,
          personal_email,
          company_email,
          branch_id,
          role_id,
          invite_status,
          invite_expires_at,
          invited_at
        `,
        [
          full_name,
          loginEmail,
          personal_email,
          company_email,
          inviteRole.role_id,
          company_name,
          branch_id,
          INVITE_STATUSES.PENDING,
          token,
          current_user_id,
          existing.user_id,
        ]
      );

      return sendInviteResponse({
        req,
        res,
        invitation: updateResult.rows[0],
        inviteRole,
        inviteLink: buildInviteLink(req, token),
        fullName: full_name,
        personalEmail: personal_email,
        branchId: branch_id,
      });
    }

    const result = await db.query(
      `
      INSERT INTO users
      (
        full_name,
        email,
        personal_email,
        company_email,
        password_hash,
        role_id,
        company_name,
        branch_id,
        status,
        is_active,
        invite_status,
        invite_token,
        invite_expires_at,
        invited_by,
        invited_at
      )
      VALUES
      ($1,$2,$3,$4,'INVITE_PENDING',$5,$6,$7,'Inactive',FALSE,$8,$9,CURRENT_TIMESTAMP + INTERVAL '48 hours',$10,CURRENT_TIMESTAMP)
      RETURNING
        user_id,
        full_name,
        personal_email,
        company_email,
        branch_id,
        role_id,
        invite_status,
        invite_expires_at,
        invited_at
      `,
      [
        full_name,
        loginEmail,
        personal_email,
        company_email,
        inviteRole.role_id,
        company_name,
        branch_id,
        INVITE_STATUSES.PENDING,
        token,
        valid_invited_by,
      ]
    );

    return sendInviteResponse({
      req,
      res,
      invitation: result.rows[0],
      inviteRole,
      inviteLink: buildInviteLink(req, token),
      fullName: full_name,
      personalEmail: personal_email,
      branchId: branch_id,
    });
  } catch (err) {
    console.error("Create invite error:", err);

    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "A user or invite with this email or token already exists.",
      });
    }

    res.status(500).json({
      success: false,
      error: err.message || "Failed to create invite.",
      sqlError: err.detail || err.hint || null
    });
  }
});

router.get("/:token", async (req, res) => {
  try {
    const validation = await validateInvite(req.params.token);

    if (validation.error) {
      return res.status(validation.status).json({
        success: false,
        error: validation.error,
      });
    }

    const invite = validation.invite;

    res.json({
      success: true,
      invite: {
        full_name: invite.full_name,
        role: invite.role_name,
        branch: invite.branch_name,
        branch_id: invite.branch_id,
        personal_email: invite.personal_email,
      },
    });
  } catch (err) {
    console.error("Validate invite error:", err.message);
    res.status(500).json({ success: false, error: "Failed to validate invite." });
  }
});

router.post("/:token/complete", async (req, res) => {
  try {
    const { password, confirm_password } = req.body;

    if (!password || !confirm_password) {
      return res.status(400).json({
        success: false,
        error: "Password and confirmation are required.",
      });
    }

    if (password !== confirm_password) {
      return res.status(400).json({
        success: false,
        error: "Passwords do not match.",
      });
    }

    const validation = await validateInvite(req.params.token);

    if (validation.error) {
      return res.status(validation.status).json({
        success: false,
        error: validation.error,
      });
    }

    const invite = validation.invite;
    const passwordHash = hashPassword(password);

    await db.query(
      `
      UPDATE users
      SET
        password_hash = $1,
        status = 'Active',
        is_active = TRUE,
        invite_status = $2,
        invite_used_at = CURRENT_TIMESTAMP
      WHERE user_id = $3
        AND invite_token = $4
        AND invite_status = $5
        AND invite_used_at IS NULL
      `,
      [
        passwordHash,
        INVITE_STATUSES.ACCEPTED,
        invite.user_id,
        req.params.token,
        INVITE_STATUSES.PENDING,
      ]
    );

    res.json({
      success: true,
      message: "Invite accepted successfully. Account is now active.",
    });
  } catch (err) {
    console.error("Complete invite error:", err.message);
    res.status(500).json({ success: false, error: "Failed to complete invite." });
  }
});



// -- NEW INVITATION MANAGEMENT ENDPOINTS --

router.get("/", async (req, res) => {
  try {
    const actorRole = normalizeRole(req.query.current_role);
    const branchId = req.query.current_branch_id;

    if (!["superadmin", "admin"].includes(actorRole)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    let query = `
      SELECT 
        u.user_id, u.full_name, u.email, u.personal_email, u.company_email, 
        u.invite_status, u.invite_expires_at, u.invited_at, u.invite_token,
        sr.role_name, b.branch_name, b.branch_id
      FROM users u
      LEFT JOIN system_roles sr ON u.role_id = sr.role_id
      LEFT JOIN branches b ON u.branch_id = b.branch_id
      WHERE u.invite_status IS NOT NULL
    `;
    
    const params = [];
    if (actorRole === "admin") {
      query += " AND u.branch_id = $1";
      params.push(branchId);
    }
    
    query += " ORDER BY u.invited_at DESC";

    const result = await db.query(query, params);
    
    // Add public links
    const origin = process.env.FRONTEND_URL || req.get("origin") || "http://localhost:5173";
    const invites = result.rows.map(inv => ({
      ...inv,
      invite_link: inv.invite_token ? `${origin.replace(/\/$/, "")}/invite/${inv.invite_token}` : null
    }));

    res.json({ success: true, invites });
  } catch (err) {
    console.error("GET /invites error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch invitations." });
  }
});

router.post("/:id/resend", async (req, res) => {
  try {
    const actorRole = normalizeRole(req.body.current_role);
    const branchId = req.body.current_branch_id;

    if (!["superadmin", "admin"].includes(actorRole)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const { id } = req.params;
    
    const existing = await db.query('SELECT * FROM users WHERE user_id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, error: "Not found" });
    const user = existing.rows[0];
    
    if (actorRole === "admin" && Number(user.branch_id) !== Number(branchId)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    if (user.invite_status === INVITE_STATUSES.ACCEPTED) {
      return res.status(400).json({ success: false, error: "User already registered." });
    }
    if (user.invite_status === INVITE_STATUSES.REVOKED) {
      return res.status(400).json({ success: false, error: "Invitation has been revoked." });
    }

    const token = crypto.randomBytes(32).toString("hex");

    const updateResult = await db.query(
      `UPDATE users 
         SET invite_status = $1, 
             invite_token = $2, 
             invite_expires_at = CURRENT_TIMESTAMP + INTERVAL '48 hours',
             invite_used_at = NULL 
         WHERE user_id = $3
         RETURNING *`,
      [INVITE_STATUSES.PENDING, token, id]
    );

    const inviteRole = await findRole({ role_id: user.role_id });
    const customMessage = user.invite_status === INVITE_STATUSES.PENDING 
        ? "Invitation resent successfully."
        : "Invitation renewed and sent successfully.";

    return sendInviteResponse({
      req, res,
      invitation: updateResult.rows[0],
      inviteRole,
      inviteLink: buildInviteLink(req, token),
      fullName: user.full_name,
      personalEmail: user.personal_email,
      branchId: user.branch_id,
      customMessage
    });
  } catch (err) {
    console.error("Resend invite error:", err.message);
    res.status(500).json({ success: false, error: "Failed to resend invitation." });
  }
});

router.patch("/:id/revoke", async (req, res) => {
  try {
    const actorRole = normalizeRole(req.body.current_role);
    const branchId = req.body.current_branch_id;

    if (!["superadmin", "admin"].includes(actorRole)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const { id } = req.params;
    
    const existing = await db.query('SELECT branch_id, invite_status FROM users WHERE user_id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, error: "Not found" });
    
    if (actorRole === "admin" && Number(existing.rows[0].branch_id) !== Number(branchId)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    if (existing.rows[0].invite_status === INVITE_STATUSES.ACCEPTED) {
      return res.status(400).json({ success: false, error: "Cannot revoke accepted invite" });
    }

    await db.query(
      'UPDATE users SET invite_status = $1, invite_token = NULL WHERE user_id = $2',
      [INVITE_STATUSES.REVOKED, id]
    );

    res.json({ success: true, message: "Invitation has been revoked." });
  } catch (err) {
    console.error("Revoke invite error:", err.message);
    res.status(500).json({ success: false, error: "Failed to revoke invitation." });
  }
});

router.patch("/:id/reactivate", async (req, res) => {
  try {
    const actorRole = normalizeRole(req.body.current_role);
    const branchId = req.body.current_branch_id;

    if (!["superadmin", "admin"].includes(actorRole)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const { id } = req.params;
    
    const existing = await db.query('SELECT branch_id, invite_status FROM users WHERE user_id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, error: "Not found" });
    
    if (actorRole === "admin" && Number(existing.rows[0].branch_id) !== Number(branchId)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const token = crypto.randomBytes(32).toString("hex");

    await db.query(
      `UPDATE users 
         SET invite_status = $1, 
             invite_token = $2, 
             invite_expires_at = CURRENT_TIMESTAMP + INTERVAL '48 hours',
             invite_used_at = NULL 
         WHERE user_id = $3`,
      [INVITE_STATUSES.PENDING, token, id]
    );

    res.json({ success: true, message: "Invitation has been reactivated." });
  } catch (err) {
    console.error("Reactivate invite error:", err.message);
    res.status(500).json({ success: false, error: "Failed to reactivate invitation." });
  }
});


// -- INVITATION MANAGEMENT ENDPOINTS --

router.get("/", async (req, res) => {
  try {
    const actorRole = normalizeRole(req.query.current_role);
    const branchId = req.query.current_branch_id;

    if (!["superadmin", "admin"].includes(actorRole)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    let query = `
      SELECT 
        u.user_id, u.full_name, u.email, u.personal_email, u.company_email, 
        u.invite_status, u.invite_expires_at, u.invited_at, u.invite_token,
        sr.role_name, b.branch_name, b.branch_id
      FROM users u
      LEFT JOIN system_roles sr ON u.role_id = sr.role_id
      LEFT JOIN branches b ON u.branch_id = b.branch_id
      WHERE u.invite_status IS NOT NULL
    `;
    
    const params = [];
    if (actorRole === "admin") {
      query += " AND u.branch_id = $1";
      params.push(branchId);
    }
    
    query += " ORDER BY u.invited_at DESC";

    const result = await db.query(query, params);
    
    // Add public links
    const origin = process.env.FRONTEND_URL || req.get("origin") || "http://localhost:5173";
    const invites = result.rows.map(inv => ({
      ...inv,
      invite_link: inv.invite_token ? `${origin.replace(/\/$/, "")}/invite/${inv.invite_token}` : null
    }));

    res.json({ success: true, invites });
  } catch (err) {
    console.error("GET /invites error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch invitations." });
  }
});

router.post("/:id/resend", async (req, res) => {
  try {
    const actorRole = normalizeRole(req.body.current_role);
    const branchId = req.body.current_branch_id;

    if (!["superadmin", "admin"].includes(actorRole)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const { id } = req.params;
    
    const existing = await db.query('SELECT * FROM users WHERE user_id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, error: "Not found" });
    const user = existing.rows[0];
    
    if (actorRole === "admin" && Number(user.branch_id) !== Number(branchId)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    if (user.invite_status === INVITE_STATUSES.ACCEPTED) {
      return res.status(400).json({ success: false, error: "User already registered." });
    }
    if (user.invite_status === INVITE_STATUSES.REVOKED) {
      return res.status(400).json({ success: false, error: "Invitation has been revoked." });
    }

    const token = require("crypto").randomBytes(32).toString("hex");

    const updateResult = await db.query(
      `UPDATE users 
         SET invite_status = $1, 
             invite_token = $2, 
             invite_expires_at = CURRENT_TIMESTAMP + INTERVAL '48 hours',
             invite_used_at = NULL 
         WHERE user_id = $3
         RETURNING *`,
      [INVITE_STATUSES.PENDING, token, id]
    );

    const inviteRole = await findRole({ role_id: user.role_id });
    const customMessage = user.invite_status === INVITE_STATUSES.PENDING 
        ? "Invitation resent successfully."
        : "Invitation renewed and sent successfully.";

    return sendInviteResponse({
      req, res,
      invitation: updateResult.rows[0],
      inviteRole,
      inviteLink: buildInviteLink(req, token),
      fullName: user.full_name,
      personalEmail: user.personal_email,
      branchId: user.branch_id,
      customMessage
    });
  } catch (err) {
    console.error("Resend invite error:", err.message);
    res.status(500).json({ success: false, error: "Failed to resend invitation." });
  }
});

router.patch("/:id/revoke", async (req, res) => {
  try {
    const actorRole = normalizeRole(req.body.current_role);
    const branchId = req.body.current_branch_id;

    if (!["superadmin", "admin"].includes(actorRole)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const { id } = req.params;
    
    const existing = await db.query('SELECT branch_id, invite_status FROM users WHERE user_id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, error: "Not found" });
    
    if (actorRole === "admin" && Number(existing.rows[0].branch_id) !== Number(branchId)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    if (existing.rows[0].invite_status === INVITE_STATUSES.ACCEPTED) {
      return res.status(400).json({ success: false, error: "Cannot revoke accepted invite" });
    }

    await db.query(
      'UPDATE users SET invite_status = $1, invite_token = NULL WHERE user_id = $2',
      [INVITE_STATUSES.REVOKED, id]
    );

    res.json({ success: true, message: "Invitation has been revoked." });
  } catch (err) {
    console.error("Revoke invite error:", err.message);
    res.status(500).json({ success: false, error: "Failed to revoke invitation." });
  }
});

router.patch("/:id/reactivate", async (req, res) => {
  try {
    const actorRole = normalizeRole(req.body.current_role);
    const branchId = req.body.current_branch_id;

    if (!["superadmin", "admin"].includes(actorRole)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const { id } = req.params;
    
    const existing = await db.query('SELECT branch_id, invite_status FROM users WHERE user_id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, error: "Not found" });
    
    if (actorRole === "admin" && Number(existing.rows[0].branch_id) !== Number(branchId)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const token = require("crypto").randomBytes(32).toString("hex");

    await db.query(
      `UPDATE users 
         SET invite_status = $1, 
             invite_token = $2, 
             invite_expires_at = CURRENT_TIMESTAMP + INTERVAL '48 hours',
             invite_used_at = NULL 
         WHERE user_id = $3`,
      [INVITE_STATUSES.PENDING, token, id]
    );

    res.json({ success: true, message: "Invitation has been reactivated." });
  } catch (err) {
    console.error("Reactivate invite error:", err.message);
    res.status(500).json({ success: false, error: "Failed to reactivate invitation." });
  }
});

module.exports = router;

