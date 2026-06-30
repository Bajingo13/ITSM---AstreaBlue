const fs = require('fs');
let code = fs.readFileSync('backend/src/routes/invites.js', 'utf8');

const brokenBlock = `    return sendInviteResponse({
      req,
      res,
      success: true,
      invite: {
        full_name: invite.full_name,`;

const fixedBlock = `    return sendInviteResponse({
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
    console.error("Create invite error:", err.message);

    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "A user or invite with this email or token already exists.",
      });
    }

    res.status(500).json({
      success: false,
      error: err.message || "Failed to create invite.",
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
        full_name: invite.full_name,`;

code = code.replace(brokenBlock, fixedBlock);
fs.writeFileSync('backend/src/routes/invites.js', code);
console.log('Fixed invites.js successfully');
