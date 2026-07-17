const fs = require("fs");
const path = require("path");
const db = require("../../config/db");

let schemaReady;

async function ensureReplacementSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const client = await db.rawPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["astreablue_replacement_requests_v1"]);
      const readiness = await client.query(`SELECT
        to_regclass('replacement_requests') IS NOT NULL
        AND to_regclass('replacement_request_history') IS NOT NULL
        AND to_regclass('replacement_request_attachments') IS NOT NULL AS ready`);
      if (!readiness.rows[0]?.ready) {
        const migration = fs.readFileSync(
          path.join(__dirname, "../../database/2026-07-17-replacement-requests.sql"),
          "utf8"
        );
        await client.query(migration);
      }
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      schemaReady = null;
      throw error;
    } finally {
      client.release();
    }
  })();
  return schemaReady;
}

module.exports = { ensureReplacementSchema };
