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
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["astreablue_replacement_requests_v3"]);
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
      const repairReadiness = await client.query(`SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema=current_schema()
            AND table_name='replacement_requests'
            AND column_name='repair_resolution'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema=current_schema()
            AND table_name='replacement_requests'
            AND column_name='repaired_at'
        )
        AND EXISTS (
          SELECT 1
          FROM pg_constraint constraint_record
          JOIN pg_class table_record ON table_record.oid=constraint_record.conrelid
          JOIN pg_namespace schema_record ON schema_record.oid=table_record.relnamespace
          WHERE table_record.relname='replacement_requests'
            AND schema_record.nspname=current_schema()
            AND constraint_record.conname='replacement_requests_status_check'
            AND pg_get_constraintdef(constraint_record.oid) LIKE '%Repaired%'
        ) AS ready`);
      if (!repairReadiness.rows[0]?.ready) {
        const repairMigration = fs.readFileSync(
          path.join(__dirname, "../../database/2026-07-17-replacement-repair-lifecycle.sql"),
          "utf8"
        );
        await client.query(repairMigration);
      }
      const statusRestoreReadiness = await client.query(`SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema=current_schema()
          AND table_name='replacement_requests'
          AND column_name='pre_repair_asset_status'
      ) AS ready`);
      if (!statusRestoreReadiness.rows[0]?.ready) {
        const statusRestoreMigration = fs.readFileSync(
          path.join(__dirname, "../../database/2026-07-20-replacement-restore-asset-status.sql"),
          "utf8"
        );
        await client.query(statusRestoreMigration);
      }
      // Older repair flows stored free-form resolution notes in the asset condition.
      // Restore the condition to a structured value while preserving the resolution
      // in both the request record and asset notes.
      await client.query(`
        UPDATE hardware_assets asset
           SET condition_after='Working',
               notes=CASE
                 WHEN POSITION(request.repair_resolution IN COALESCE(asset.notes,'')) > 0 THEN asset.notes
                 ELSE CONCAT_WS(E'\n',NULLIF(asset.notes,''),request.repair_resolution)
               END
          FROM replacement_requests request
         WHERE request.current_asset_id=asset.asset_id
           AND request.status='Repaired'
           AND NULLIF(BTRIM(request.repair_resolution),'') IS NOT NULL
           AND asset.condition_after=request.repair_resolution
      `);
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
