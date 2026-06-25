const express = require("express");
const crypto = require("crypto");
const db = require("../../config/db");

const router = express.Router();

function hashPassword(password) {
  return `sha256$${crypto.createHash("sha256").update(password).digest("hex")}`;
}

function normalizeRoleName(roleName) {
  return String(roleName || "").trim().toLowerCase();
}

function buildInviteLink(req, token) {
  const origin = req.body?.app_origin || req.get("origin") || "http://localhost:5173";
  return `${origin.replace(/\/$/, "")}/invite/${token}`;
}

async function ensureInviteFoundation() {
  try {
    await db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS personal_email VARCHAR(255),
      ADD COLUMN IF NOT EXISTS company_email VARCHAR(255),
      ADD COLUMN IF NOT EXISTS invite_token VARCHAR(120),
      ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS invite_used_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS invite_status VARCHAR(20)
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS user_invites (
        invite_id SERIAL PRIMARY KEY,
        token VARCHAR(120) UNIQUE NOT NULL,
        email VARCHAR(255),
        personal_email VARCHAR(255),
        company_email VARCHAR(255),
        full_name VARCHAR(255),
        role_id INTEGER REFERENCES system_roles(role_id),
        branch_id INTEGER REFERENCES branches(branch_id),
        company_name VARCHAR(255),
        mobile_number VARCHAR(20),
        invited_by INTEGER REFERENCES users(user_id),
        accepted_at TIMESTAMP,
        expires_at TIMESTAMP,
        invite_used_at TIMESTAMP,
        invite_status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      ALTER TABLE user_invites
      ADD COLUMN IF NOT EXISTS email VARCHAR(255),
      ADD COLUMN IF NOT EXISTS personal_email VARCHAR(255),
      ADD COLUMN IF NOT EXISTS company_email VARCHAR(255),
      ADD COLUMN IF NOT EXISTS invite_used_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS invite_status VARCHAR(20) DEFAULT 'pending'
    `);
  } catch (err) {
    console.error("Invites setup error:", err.message);
  }
}

async function getRoleByInput({ role_id, role_name }) {
  if (role_id) {
    const result = await db.query(
      `SELECT role_id, role_name FROM system_roles WHERE role_id = $1`,
      [role_id]
    );
    return result.rows[0] || null;
  }

  if (role_name) {
    const result = await db.query(
      `SELECT role_id, role_name FROM system_roles WHERE LOWER(role_name) = LOWER($1)`,
      [role_name]
    );
    return result.rows[0] || null;
  }

  return null;
}

async function findInvite(token) {
  const result = await db.query(
    `
    SELECT
      i.invite_id,
      i.token,
      COALESCE(i.personal_email, i.email) AS personal_email,
      i.company_email,
      COALESCE(i.company_email, i.email) AS login_email,
      i.email,
      i.full_name,
      i.role_id,
      sr.role_name,
      i.branch_id,
      b.branch_name,
      i.company_name,
      i.mobile_number,
      i.accepted_at,
      i.expires_at,
      i.invite_used_at,
      COALESCE(i.invite_status, 'pending') AS invite_status
    FROM user_invites i
    LEFT JOIN system_roles sr ON i.role_id = sr.role_id
    LEFT JOIN branches b ON i.branch_id = b.branch_id
    WHERE i.token = $1
    `,
    [token]
  );

  return result.rows[0] || null;
}

function validateUsableInvite(invite) {
  if (!invite) return "Invite not found";
  if (invite.invite_used_at || invite.accepted_at || invite.invite_status === "used") {
    return "Invite already used";
  }
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return "Invite expired";
  }
  return "";
}

ensureInviteFoundation();

router.post("/", async (req, res) => {
  try {
    const {
      full_name = null,
      personal_email,
      company_email = null,
      role_id = null,
      role_name = null,
      branch_id,
      company_name = null,
      mobile_number = null,
      current_role = null,
      current_branch_id = null,
      current_user_id = null,
      expires_in_hours = 48,
    } = req.body;

    const actorRole = normalizeRoleName(current_role || req.body.role_name_actor);
    const inviteRole = await getRoleByInput({ role_id, role_name });

    if (!["superadmin", "admin"].includes(actorRole)) {
      return res.status(403).json({
        success: false,
        error: "You are not allowed to invite users.",
      });
    }

    if (!inviteRole) {
      return res.status(400).json({
        success: false,
        error: "Role is required.",
      });
    }

    if (!branch_id) {
      return res.status(400).json({
        success: false,
        error: "Branch is required.",
      });
    }

    if (!personal_email) {
      return res.status(400).json({
        success: false,
        error: "Personal email is required.",
      });
    }

    if (actorRole === "admin" && Number(branch_id) !== Number(current_branch_id)) {
      return res.status(403).json({
        success: false,
        error: "Admin can invite users only within their own branch.",
      });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const hours = Number(expires_in_hours) || 48;
    const loginEmail = company_email || personal_email;

    const result = await db.query(
      `
      INSERT INTO user_invites
      (
        token,
        email,
        personal_email,
        company_email,
        full_name,
        role_id,
        branch_id,
        company_name,
        mobile_number,
        invited_by,
        expires_at,
        invite_status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_TIMESTAMP + ($11::text || ' hours')::interval,'pending')
      RETURNING
        invite_id,
        token,
        personal_email,
        company_email,
        full_name,
        role_id,
        branch_id,
        expires_at,
        invite_status
      `,
      [
        token,
        loginEmail,
        personal_email,
        company_email,
        full_name,
        inviteRole.role_id,
        branch_id,
        company_name,
        mobile_number,
        current_user_id,
        hours,
      ]
    );

    res.status(201).json({
      success: true,
      ...result.rows[0],
      role_name: inviteRole.role_name,
      invite_link: buildInviteLink(req, token),
    });
  } catch (err) {
    console.error("Create invite error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to create invite",
    });
  }
});

router.get("/:token", async (req, res) => {
  try {
    const invite = await findInvite(req.params.token);
    const inviteError = validateUsableInvite(invite);

    if (inviteError) {
      const status = inviteError === "Invite not found" ? 404 : 400;
      return res.status(status).json({ success: false, error: inviteError });
    }

    res.json(invite);
  } catch (err) {
    console.error("Fetch invite error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch invite" });
  }
});

async function completeInvite(req, res) {
  try {
    const { token } = req.params;
    const { password, confirm_password, confirmPassword } = req.body;
    const finalConfirmPassword = confirm_password || confirmPassword;

    if (!password || !finalConfirmPassword) {
      return res.status(400).json({
        success: false,
        error: "Password and confirmation are required.",
      });
    }

    if (password !== finalConfirmPassword) {
      return res.status(400).json({
        success: false,
        error: "Passwords do not match.",
      });
    }

    const invite = await findInvite(token);
    const inviteError = validateUsableInvite(invite);

    if (inviteError) {
      const status = inviteError === "Invite not found" ? 404 : 400;
      return res.status(status).json({ success: false, error: inviteError });
    }

    const passwordHash = hashPassword(password);
    const loginEmail = invite.company_email || invite.email || invite.personal_email;

    const userResult = await db.query(
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
        mobile_number,
        status,
        is_active,
        invite_token,
        invite_expires_at,
        invite_used_at,
        invite_status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Active',TRUE,$10,$11,CURRENT_TIMESTAMP,'used')
      RETURNING user_id, full_name, email, personal_email, company_email, role_id, branch_id
      `,
      [
        invite.full_name || loginEmail,
        loginEmail,
        invite.personal_email,
        invite.company_email,
        passwordHash,
        invite.role_id,
        invite.company_name,
        invite.branch_id,
        invite.mobile_number,
        token,
        invite.expires_at,
      ]
    );

    await db.query(
      `
      UPDATE user_invites
      SET
        accepted_at = CURRENT_TIMESTAMP,
        invite_used_at = CURRENT_TIMESTAMP,
        invite_status = 'used'
      WHERE invite_id = $1
      `,
      [invite.invite_id]
    );

    res.status(201).json({ success: true, user: userResult.rows[0] });
  } catch (err) {
    console.error("Complete invite error:", err.message);

    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "A user with this email already exists",
      });
    }

    res.status(500).json({ success: false, error: "Failed to complete invite" });
  }
}

router.post("/:token/complete", completeInvite);
router.post("/:token/accept", completeInvite);

module.exports = router;
