const fs = require('fs');
let code = fs.readFileSync('backend/src/routes/invites.js', 'utf8');

// 1. Update sendInviteResponse to accept a custom message
code = code.replace(
  'branchId,\n}) {',
  'branchId,\n  customMessage = null,\n}) {'
);
code = code.replace(
  'message: "Invitation email sent successfully.",',
  'message: customMessage || "Invitation email sent successfully.",'
);

// 2. Trim emails in POST /
code = code.replace(
  'personal_email,',
  'personal_email: raw_pe,'
);
code = code.replace(
  'company_email = null,',
  'company_email: raw_ce = null,'
);
code = code.replace(
  'current_user_id = null,\n    } = req.body;',
  'current_user_id = null,\n    } = req.body;\n\n    const personal_email = String(raw_pe || "").trim();\n    const company_email = raw_ce ? String(raw_ce).trim() : null;'
);

// 3. Fix the existing check
const oldCheck = `    if (existing && existing.invite_status !== INVITE_STATUSES.PENDING) {
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
    }`;

const newCheck = `    let customMessage = null;
    if (existing) {
      if (existing.invite_status === INVITE_STATUSES.ACCEPTED || existing.is_active) {
        return res.status(409).json({
          success: false,
          error: "User already registered.",
        });
      }
      if (existing.invite_status === INVITE_STATUSES.REVOKED) {
        return res.status(409).json({
          success: false,
          error: "Invitation has been revoked.",
        });
      }
      if (existing.invite_status === INVITE_STATUSES.PENDING) {
        customMessage = "Invitation resent successfully.";
      } else if (existing.invite_status === INVITE_STATUSES.EXPIRED) {
        customMessage = "Invitation renewed and sent successfully.";
      }
    }`;

code = code.replace(oldCheck, newCheck);

// 4. Update the sendInviteResponse call for existing to pass customMessage
code = code.replace(
  'personalEmail: personal_email,\n        branchId: branch_id,\n      });',
  'personalEmail: personal_email,\n        branchId: branch_id,\n        customMessage,\n      });'
);

// 5. Add new endpoints at the end, before module.exports
const newEndpoints = `

// -- NEW INVITATION MANAGEMENT ENDPOINTS --

router.get("/", async (req, res) => {
  try {
    const actorRole = normalizeRole(req.query.current_role);
    const branchId = req.query.current_branch_id;

    if (!["superadmin", "admin"].includes(actorRole)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    let query = \`
      SELECT 
        u.user_id, u.full_name, u.email, u.personal_email, u.company_email, 
        u.invite_status, u.invite_expires_at, u.invited_at, u.invite_token,
        sr.role_name, b.branch_name, b.branch_id
      FROM users u
      LEFT JOIN system_roles sr ON u.role_id = sr.role_id
      LEFT JOIN branches b ON u.branch_id = b.branch_id
      WHERE u.invite_status IS NOT NULL
    \`;
    
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
      invite_link: inv.invite_token ? \`\${origin.replace(/\\/$/, "")}/invite/\${inv.invite_token}\` : null
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
      \`UPDATE users 
         SET invite_status = $1, 
             invite_token = $2, 
             invite_expires_at = CURRENT_TIMESTAMP + INTERVAL '48 hours',
             invite_used_at = NULL 
         WHERE user_id = $3
         RETURNING *\`,
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
      \`UPDATE users 
         SET invite_status = $1, 
             invite_token = $2, 
             invite_expires_at = CURRENT_TIMESTAMP + INTERVAL '48 hours',
             invite_used_at = NULL 
         WHERE user_id = $3\`,
      [INVITE_STATUSES.PENDING, token, id]
    );

    res.json({ success: true, message: "Invitation has been reactivated." });
  } catch (err) {
    console.error("Reactivate invite error:", err.message);
    res.status(500).json({ success: false, error: "Failed to reactivate invitation." });
  }
});
`;

code = code.replace('module.exports = router;', newEndpoints + '\nmodule.exports = router;');
fs.writeFileSync('backend/src/routes/invites.js', code);
console.log('Successfully updated invites.js');
