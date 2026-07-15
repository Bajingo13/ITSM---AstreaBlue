const { rawPool } = require("../config/db");
const { ensureIntegrationGatewaySchema, generateApiKey, hashApiKey } = require("../src/services/integrationService");

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const systemCode = String(argument("code") || "").trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  const systemName = String(argument("name") || "").trim();
  const keyName = String(argument("key-name") || "Primary API Key").trim();
  if (!systemCode || !systemName) {
    throw new Error("Usage: npm run integration:provision -- --code=HRIS --name=HRIS [--key-name=Primary]");
  }

  await ensureIntegrationGatewaySchema();
  const client = await rawPool.connect();
  const apiKey = generateApiKey(systemCode);
  try {
    await client.query("BEGIN");
    const integration = await client.query(
      `INSERT INTO integration_registry (system_name,system_code,description,api_key_hash,status,allowed_branches)
       VALUES ($1,$2,$3,$4,'Active',$5::jsonb)
       ON CONFLICT (system_code) DO UPDATE SET
         system_name=EXCLUDED.system_name, allowed_branches=EXCLUDED.allowed_branches,
         status='Active', updated_at=CURRENT_TIMESTAMP
       RETURNING integration_id,system_code,system_name,status,allowed_branches,created_at,last_used_at`,
      [systemName, systemCode, `Centralized External Ticket API integration for ${systemName}`, hashApiKey(apiKey), JSON.stringify([])]
    );
    await client.query(
      `UPDATE integration_api_keys SET status='Revoked',revoked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
       WHERE integration_id=$1 AND status <> 'Revoked'`,
      [integration.rows[0].integration_id]
    );
    await client.query(
      `INSERT INTO integration_api_keys (integration_id,key_name,api_key_hash,status)
       VALUES ($1,$2,$3,'Active')`,
      [integration.rows[0].integration_id, keyName, hashApiKey(apiKey)]
    );
    await client.query("COMMIT");
    console.log(JSON.stringify({ ...integration.rows[0], api_key: apiKey }, null, 2));
    console.error("Store api_key securely now. AstreaBlue stores only its hash and cannot display it again.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await rawPool.end();
  }
}

main().catch((error) => {
  console.error(`Credential provisioning failed: ${error.message}`);
  process.exitCode = 1;
});
