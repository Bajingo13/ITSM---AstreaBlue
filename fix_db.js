const db = require("./backend/config/db");

async function fixDb() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ticket_history (
        history_id SERIAL PRIMARY KEY,
        ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
        changed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL,
        old_value TEXT,
        new_value TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("ticket_history created");

    await db.query(`
      CREATE TABLE IF NOT EXISTS ticket_comments (
        comment_id SERIAL PRIMARY KEY,
        ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        comment_text TEXT NOT NULL,
        is_internal BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("ticket_comments created");

    // Also fix the ticket cancel bug in the schema if possible, but we'll do it in the code.
  } catch (err) {
    console.error("Error fixing DB:", err);
  } finally {
    process.exit(0);
  }
}

fixDb();
