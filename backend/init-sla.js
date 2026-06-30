
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { Pool } = require("pg");

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
});

async function run() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sla_policies (
        policy_id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        priority VARCHAR(50) NOT NULL UNIQUE,
        resolution_time_minutes INTEGER NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default SLAs if none exist
    const { rows } = await pool.query('SELECT COUNT(*) FROM sla_policies');
    if (parseInt(rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO sla_policies (name, priority, resolution_time_minutes) VALUES
        ('Critical SLA', 'P1-Critical', 240), -- 4 hours
        ('High SLA', 'P2-High', 480),         -- 8 hours
        ('Medium SLA', 'P3-Medium', 1440),    -- 24 hours
        ('Low SLA', 'P4-Low', 2880)           -- 48 hours
      `);
      console.log('Default SLA policies inserted.');
    } else {
      console.log('SLA policies already exist.');
    }
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

run();
