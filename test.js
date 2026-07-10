const db = require('./backend/config/db');
async function run() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS endpoint_policies (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT true,
        config_json JSONB NOT NULL DEFAULT '{}',
        created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        branch_id INTEGER REFERENCES branches(branch_id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('OK');
  } catch(e) {
    console.log('ERR', e.message);
  }
  process.exit();
}
run();
