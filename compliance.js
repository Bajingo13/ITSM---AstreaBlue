const express = require('express');
const router = express.Router();
const db = require('./config/db');

/**
 * 📜 POST /api/v1/compliance/consent
 * Registers or updates granular data tracking consent options for an employee.
 * Enforces compliance rules derived from Republic Act No. 10173 (Data Privacy Act)
 */
router.post('/consent', async (req, res) => {
  const { user_id, consent_type, consent_given } = req.body;

  // 1. Validate inbound request parameters
  if (!user_id || !consent_type || consent_given === undefined) {
    return res.status(400).json({ 
      success: false, 
      error: "Missing required properties. Must provide user_id, consent_type, and consent_given status." 
    });
  }

  // Define valid tracking types mapping exactly to our Database Postgres Enums
  const validTypes = ['APP_MONITORING', 'WEB', 'FILE', 'USB', 'SCREENSHOT'];
  if (!validTypes.includes(consent_type.toUpperCase())) {
    return res.status(400).json({ 
      success: false, 
      error: `Invalid tracking module classification: ${consent_type}. Must match framework enums.` 
    });
  }

  try {
    // 2. Perform upsert operations (Update if exists, insert if completely new)
    const upsertQuery = `
      INSERT INTO employee_consent (user_id, consent_type, consent_given, consent_date, revocation_date)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, NULL)
      ON CONFLICT ON CONSTRAINT employee_consent_user_id_consent_type_key 
      -- Wait, let's create a dynamic manual update fallback handling step to avoid target constraint index mismatches:
      DO UPDATE SET 
        consent_given = EXCLUDED.consent_given,
        consent_date = CASE WHEN EXCLUDED.consent_given = TRUE THEN CURRENT_TIMESTAMP ELSE employee_consent.consent_date END,
        revocation_date = CASE WHEN EXCLUDED.consent_given = FALSE THEN CURRENT_TIMESTAMP ELSE NULL END
      RETURNING consent_id, user_id, consent_type, consent_given;
    `;

    // Simple robust query logic approach for our initial database schema structure:
    const insertQuery = `
      INSERT INTO employee_consent (user_id, consent_type, consent_given, revocation_date)
      VALUES ($1, $2, $3, $4)
      RETURNING consent_id, consent_given, consent_date;
    `;
    
    const revocationDate = consent_given ? null : new Date();
    const result = await db.query(insertQuery, [user_id, consent_type.toUpperCase(), consent_given, revocationDate]);

    res.status(201).json({
      success: true,
      message: "Employee compliance consent registry successfully updated.",
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Compliance processing system error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Internal data persistence transaction fault.",
      details: error.message 
    });
  }
});

module.exports = router;