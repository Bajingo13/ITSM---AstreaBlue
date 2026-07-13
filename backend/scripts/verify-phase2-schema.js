const { rawPool } = require("../config/db");

async function main() {
  const [systems, columns, indexes] = await Promise.all([
    rawPool.query("SELECT system_code FROM integration_registry WHERE system_code LIKE 'phase2_%'"),
    rawPool.query(`SELECT column_name FROM information_schema.columns
      WHERE table_name='tickets' AND column_name IN
      ('origin_feature','external_attachment_metadata','external_request_fingerprint')`),
    rawPool.query(`SELECT indexname FROM pg_indexes
      WHERE tablename='tickets' AND indexname='uq_tickets_external_idempotency'`),
  ]);
  console.log(JSON.stringify({
    test_leftovers: systems.rowCount,
    phase2_columns: columns.rows.map((row) => row.column_name).sort(),
    idempotency_index_present: indexes.rowCount === 1,
  }));
  if (systems.rowCount || columns.rowCount !== 3 || indexes.rowCount !== 1) process.exitCode = 1;
}

main()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => rawPool.end());
