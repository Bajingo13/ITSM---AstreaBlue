const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../../config/db");
const { getR2Status } = require("../services/r2StorageService");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";

function requireAuth(req, res, next) {
  try {
    const header = String(req.headers.authorization || "");
    if (!header.startsWith("Bearer ")) throw new Error("Authentication required.");
    req.actor = jwt.verify(header.slice(7), JWT_SECRET);
    return next();
  } catch (_error) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
}

const tablesReady = db.query(`
  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS onboarding_status VARCHAR(40) NOT NULL DEFAULT 'Completed',
    ADD COLUMN IF NOT EXISTS onboarding_required BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS invitation_accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS privacy_notice_viewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS consent_submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS onboarding_consent_id BIGINT,
    ADD COLUMN IF NOT EXISTS onboarding_version VARCHAR(40) NOT NULL DEFAULT '1.0';
  CREATE TABLE IF NOT EXISTS user_onboarding_history (
    onboarding_history_id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    previous_status VARCHAR(40), new_status VARCHAR(40) NOT NULL,
    consent_id BIGINT, changed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    reason TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`).catch((error) => {
  console.error("[onboarding] storage initialization failed:", error.message);
  return null;
});

router.use(requireAuth);
router.use(async (_req, res, next) => {
  if (await tablesReady) return next();
  return res.status(503).json({ success: false, message: "Onboarding storage is unavailable." });
});

router.get("/status", async (req, res) => {
  try {
    const userId = req.actor.userId || req.actor.user_id;
    const result = await db.query(
      `SELECT u.user_id,u.full_name,u.email,u.branch_id,b.branch_name,sr.role_name,
              u.onboarding_status,u.onboarding_required,u.invitation_accepted_at,
              u.privacy_notice_viewed_at,u.consent_submitted_at,u.onboarding_completed_at,
              u.onboarding_consent_id,u.onboarding_version,
              cd.status AS consent_status,cd.consent_version,cd.monitoring_preferences,
              cd.document_object_key,cd.signature_object_key,cd.storage_status,
              ha.asset_id,ha.asset_tag,md.device_id,md.device_uuid,md.last_seen_at,
              ep.generated_at AS policy_generated_at,md.last_policy_sync_at
       FROM users u
       JOIN system_roles sr ON sr.role_id=u.role_id
       LEFT JOIN branches b ON b.branch_id=u.branch_id
       LEFT JOIN consent_documents cd ON cd.consent_id=u.onboarding_consent_id
       LEFT JOIN hardware_assets ha ON ha.employee_id::text=u.user_id::text
       LEFT JOIN monitored_devices md ON md.assigned_user_id=u.user_id
       LEFT JOIN endpoint_effective_policies ep ON ep.device_uuid=md.device_uuid
       WHERE u.user_id=$1 LIMIT 1`,
      [userId]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "User not found." });
    const row = result.rows[0];
    return res.json({
      success: true,
      data: {
        ...row,
        must_complete_onboarding: Boolean(row.onboarding_required && row.onboarding_status !== "Completed"),
        readiness: {
          account_ready: true,
          consent_approved: row.consent_status === "approved",
          asset_assigned: Boolean(row.asset_id),
          agent_registered: Boolean(row.device_uuid),
          policy_generated: Boolean(row.policy_generated_at),
          policy_downloaded: Boolean(row.last_policy_sync_at),
          monitoring_active: Boolean(row.consent_status === "approved" && row.device_uuid && row.last_policy_sync_at),
        },
        r2: getR2Status(),
      },
    });
  } catch (error) {
    console.error("[onboarding:status]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load onboarding status." });
  }
});

router.post("/privacy-notice-viewed", async (req, res) => {
  const userId = req.actor.userId || req.actor.user_id;
  try {
    const previous = await db.query(`SELECT onboarding_status FROM users WHERE user_id=$1`, [userId]);
    const updated = await db.query(
      `UPDATE users SET privacy_notice_viewed_at=COALESCE(privacy_notice_viewed_at,CURRENT_TIMESTAMP),
        onboarding_status=CASE WHEN onboarding_required AND onboarding_status <> 'Completed' THEN 'Consent Required' ELSE onboarding_status END
       WHERE user_id=$1 RETURNING onboarding_status,privacy_notice_viewed_at`,
      [userId]
    );
    await db.query(
      `INSERT INTO user_onboarding_history (user_id,previous_status,new_status,changed_by,reason)
       VALUES ($1,$2,$3,$1,'Employee viewed the RA 10173 privacy notice.')`,
      [userId, previous.rows[0]?.onboarding_status || null, updated.rows[0].onboarding_status]
    );
    return res.json({ success: true, data: updated.rows[0] });
  } catch (error) {
    console.error("[onboarding:privacy]", error.message);
    return res.status(500).json({ success: false, message: "Failed to record privacy notice acknowledgement." });
  }
});

module.exports = router;
