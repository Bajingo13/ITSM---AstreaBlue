const db = require('./backend/config/db');
async function test() {
  try {
    const res = await db.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'consent_audit_logs'");
    console.table(res.rows);
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
test();
