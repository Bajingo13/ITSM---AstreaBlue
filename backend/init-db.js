const fs = require("fs");
const path = require("path");
const { rawPool } = require("./config/db");
const bcrypt = require("bcryptjs");

const migrationFiles = [
  "BASE_SCHEMA.sql",
  "2026-06-19-role-branch-management.sql",
  "2026-06-25-invite-link-registration-foundation.sql",
  "2026-06-30-hardware-assets-image.sql",
  "2026-07-02-asset-discovery-financial.sql",
  "2026-07-03-asset-finance-discovery-modules.sql",
  "2026-07-03-asset-types.sql",
  "2026-07-03-ticket-notifications.sql",
  "2026-07-03-ticket-history-comments-sla.sql",
  "2026-07-06-useful-life-months-capitalization.sql",
  "2026-07-06-laptop-monitoring-mvp.sql",
  "2026-07-06-laptop-monitoring-device-uuid.sql",
  "2026-07-07-consent-document-workflow.sql",
  "2026-07-07-fix-schema-drift.sql",
  "2026-07-07-ra10173-compliance.sql",
  "2026-07-07-user-employee-fields.sql",
  "2026-07-08-laptop-monitoring-asset-department.sql",
  "2026-07-10-integration-gateway-foundation.sql",
  "2026-07-13-project-analytics.sql",
  "2026-07-13-change-release-management.sql",
  "2026-07-13-onboarding-consent-governance.sql",
  "2026-07-14-endpoint-agent-enrollment.sql",
  "2026-07-14-change-request-workflow.sql",
  "2026-07-14-change-release-schema-hardening.sql",
  "2026-07-15-asset-query-performance.sql",
  "2026-07-15-integration-hub-centralized-scope.sql",
  "2026-07-15-core-query-performance.sql",
  "2026-07-17-replacement-requests.sql",
  "2026-07-17-replacement-repair-lifecycle.sql",
  "2026-07-20-replacement-restore-asset-status.sql",
  "2026-07-21-employee-lifecycle-foundation.sql",
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

async function migrateLegacyPlaintextPasswords(client) {
  const result = await client.query(`
    SELECT user_id,password_hash
    FROM users
    WHERE password_hash IS NOT NULL
      AND password_hash NOT LIKE '$2a$%'
      AND password_hash NOT LIKE '$2b$%'
      AND password_hash NOT LIKE '$2y$%'
      AND password_hash NOT LIKE 'sha256$%'
  `);
  for (const user of result.rows) {
    await client.query(
      "UPDATE users SET password_hash=$1 WHERE user_id=$2 AND password_hash=$3",
      [bcrypt.hashSync(user.password_hash, 12), user.user_id, user.password_hash]
    );
  }
  if (result.rowCount) {
    console.log(`[AstreaBlue DB] migrated ${result.rowCount} legacy plaintext password(s)`);
  }
}

async function runMigrations() {
  const client = await rawPool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    for (const fileName of migrationFiles) {
      const applied = await client.query(
        "SELECT 1 FROM schema_migrations WHERE migration_name = $1",
        [fileName]
      );
      if (applied.rowCount) {
        console.log(`[AstreaBlue DB] already applied ${fileName}`);
        continue;
      }

      const filePath = path.join(__dirname, "database", fileName);
      const sql = fs.readFileSync(filePath, "utf8");

      console.log(`[AstreaBlue DB] applying ${fileName}`);
      await client.query("BEGIN");

      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (migration_name) VALUES ($1)",
          [fileName]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    await seedTicketCategories(client);
    await migrateLegacyPlaintextPasswords(client);

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
