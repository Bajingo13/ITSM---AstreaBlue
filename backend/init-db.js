const fs = require("fs");
const path = require("path");
const { rawPool } = require("./config/db");

const migrationFiles = [
  "BASE_SCHEMA.sql",
  "2026-06-19-role-branch-management.sql",
  "2026-06-25-invite-link-registration-foundation.sql",
  "2026-06-30-hardware-assets-image.sql",
];

const defaultTicketCategories = [
  "Software",
  "Hardware",
  "Network",
  "Access Request",
  "Other",
];

async function seedTicketCategories(client) {
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE ticket_categories IN SHARE ROW EXCLUSIVE MODE");

    const result = await client.query(
      "SELECT COUNT(*)::int AS count FROM ticket_categories"
    );

    if (result.rows[0].count !== 0) {
      await client.query("COMMIT");
      return;
    }

    for (const categoryName of defaultTicketCategories) {
      await client.query(
        "INSERT INTO ticket_categories (category_name) VALUES ($1)",
        [categoryName]
      );
    }

    await client.query("COMMIT");
    console.log("[AstreaBlue DB] seeded default ticket categories");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[AstreaBlue DB] ticket category seeding failed:", error.message);
    throw error;
  }
}

async function runMigrations() {
  const client = await rawPool.connect();

  try {
    for (const fileName of migrationFiles) {
      const filePath = path.join(__dirname, "database", fileName);
      const sql = fs.readFileSync(filePath, "utf8");

      console.log(`[AstreaBlue DB] applying ${fileName}`);
      await client.query("BEGIN");

      try {
        await client.query(sql);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    await seedTicketCategories(client);

    console.log("[AstreaBlue DB] initialization complete");
  } finally {
    client.release();
    await rawPool.end();
  }
}

runMigrations().catch((error) => {
  console.error("[AstreaBlue DB] initialization failed:", error.message);
  process.exitCode = 1;
});
