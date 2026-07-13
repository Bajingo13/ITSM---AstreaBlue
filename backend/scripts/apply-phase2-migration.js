const fs = require("fs");
const path = require("path");
const { rawPool } = require("../config/db");

async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "database", "2026-07-10-integration-gateway-foundation.sql"),
    "utf8"
  );
  const client = await rawPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("Phase 2 External Ticket Gateway migration applied.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await rawPool.end();
  }
}

main().catch((error) => {
  console.error("Phase 2 migration failed:", error.message);
  process.exitCode = 1;
});
