const express = require('express');
const router = express.Router();
const db = require('./config/db');

/**
 * 🛰️ POST /api/v1/agent/log
 * Receives continuous activity packets from laptop endpoints.
 * Automatically checks for employee data privacy consent before logging!
 */
router.post('/log', async (req, res) => {
  const { asset_id, user_id, session_id, activity_type, application_name, window_title } = req.body;

  // 1. Structural check on payload parameters
  if (!asset_id || !user_id || !activity_type) {
    return res.status(400).json({ success: false, error: "Missing core tracking properties." });
  }

  try {
    // 2. PRIVACY GUARDRAIL CHECK: Look up the user's consent status for app monitoring
    const consentCheck = await db.query(
      `SELECT consent_given FROM employee_consent 
       WHERE user_id = $1 AND consent_type = 'APP_MONITORING' 
       ORDER BY consent_date DESC LIMIT 1`,
      [user_id]
    );

    const hasGrantedConsent = consentCheck.rows.length > 0 && consentCheck.rows[0].consent_given;

    // 3. If consent is missing or false, drop the transaction right here!
    if (!hasGrantedConsent) {
      console.log(`⚠️ SECURITY BLOCK: Activity log rejected for User [${user_id}]. Reason: No consent on file.`);
      return res.status(403).json({
        success: false,
        error: "Access Denied: Telemetry monitoring is disabled for this profile due to privacy constraints (RA 10173)."
      });
    }

    // 4. Consent verified! Proceed to save the tracking log down into our database disk space
    const insertLogQuery = `
      INSERT INTO laptop_activity_log (asset_id, user_id, session_id, activity_type, application_name, window_title)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING activity_id, activity_timestamp;
    `;
    const result = await db.query(insertLogQuery, [
      asset_id, user_id, session_id || 'SESS-TEMP', activity_type, application_name, window_title
    ]);

    res.status(201).json({
      success: true,
      message: "Telemetry packet securely processed and committed to data logs.",
      activity_id: result.rows[0].activity_id
    });

  } catch (error) {
    console.error("Agent telemetry parsing error:", error);
    res.status(500).json({ success: false, error: "Internal processing fault." });
  }
});

module.exports = router;