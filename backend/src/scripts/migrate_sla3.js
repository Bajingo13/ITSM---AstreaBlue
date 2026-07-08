const db = require('../../config/db');

async function run() {
  try {
    console.log('Dropping and recreating sla_policies table...');
    await db.query(`DROP TABLE IF EXISTS sla_policies CASCADE;`);
    await db.query(`
      CREATE TABLE sla_policies (
        policy_id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        priority VARCHAR(50) NOT NULL,
        category_id INTEGER,
        response_target_mins INTEGER NOT NULL,
        resolution_target_mins INTEGER NOT NULL,
        business_hours BOOLEAN DEFAULT false,
        escalation_enabled BOOLEAN DEFAULT true,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('Adding SLA columns to tickets...');
    const alterQuery = `
      ALTER TABLE tickets
      ADD COLUMN IF NOT EXISTS sla_policy_id INTEGER REFERENCES sla_policies(policy_id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS response_due_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS resolution_due_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS first_responded_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS response_sla_status VARCHAR(50) DEFAULT 'Pending',
      ADD COLUMN IF NOT EXISTS resolution_sla_status VARCHAR(50) DEFAULT 'Pending';
    `;
    await db.query(alterQuery);

    console.log('Inserting default SLA policies...');
    const insertDefaults = `
      INSERT INTO sla_policies (name, priority, response_target_mins, resolution_target_mins)
      VALUES 
        ('Default Critical SLA', 'P1-Critical', 15, 120),
        ('Default High SLA', 'P2-High', 30, 240),
        ('Default Medium SLA', 'P3-Medium', 120, 480),
        ('Default Low SLA', 'P4-Low', 240, 1440)
      ON CONFLICT DO NOTHING;
    `;
    await db.query(insertDefaults);

    console.log('Migration successful.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

run();
