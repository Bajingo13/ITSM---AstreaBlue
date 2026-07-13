const { rawPool } = require("../config/db");
const { ensureIntegrationGatewaySchema } = require("../src/services/integrationService");

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const systemCode = String(argument("code") || "").trim().toUpperCase();
  if (!systemCode) throw new Error("Usage: npm run integration:revoke -- --code=HRIS");
  await ensureIntegrationGatewaySchema();
  const client = await rawPool.connect();
  try {
    await client.query("BEGIN");
    const integration = await client.query(
      `UPDATE integration_registry SET status='Disabled',updated_at=CURRENT_TIMESTAMP
       WHERE system_code=$1 RETURNING integration_id,system_code,system_name,status`,
      [systemCode]
    );
    if (!integration.rows[0]) throw new Error("External system not found.");
    await client.query(
      `UPDATE integration_api_keys SET status='Revoked',revoked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
       WHERE integration_id=$1 AND status <> 'Revoked'`,
      [integration.rows[0].integration_id]
    );
    await client.query("COMMIT");
    console.log(JSON.stringify(integration.rows[0], null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await rawPool.end();
  }
}

main().catch((error) => {
  console.error(`Credential revocation failed: ${error.message}`);
  process.exitCode = 1;
});
