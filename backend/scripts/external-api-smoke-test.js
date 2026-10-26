/**
 * End-to-end smoke test for the External Ticket API, run the way a partner
 * system (e.g. EIS) would call it: create -> replay -> status -> comment.
 *
 * Usage (from backend/):
 *   ASTREABLUE_API_URL=http://localhost:5000 \
 *   ASTREABLUE_EXTERNAL_API_KEY=<key> \
 *   ASTREABLUE_SYSTEM_CODE=EIS \
 *   node scripts/external-api-smoke-test.js
 *
 * The API key is never printed.
 */
const baseUrl = String(process.env.ASTREABLUE_API_URL || "").replace(/\/+$/, "");
const apiKey = String(process.env.ASTREABLUE_EXTERNAL_API_KEY || "").trim();
const systemCode = String(process.env.ASTREABLUE_SYSTEM_CODE || "").trim();

async function call(method, path, body) {
  const response = await fetch(`${baseUrl}/api/v1/external${path}`, {
    method,
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const json = await response.json().catch(() => null);
  console.log(`${method} ${path} -> ${response.status} ${json?.message || ""}`);
  return { status: response.status, json };
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  if (!baseUrl || !apiKey || !systemCode) {
    throw new Error("Set ASTREABLUE_API_URL, ASTREABLUE_EXTERNAL_API_KEY and ASTREABLUE_SYSTEM_CODE.");
  }
  const reference = `${systemCode}-SMOKE-${Date.now()}`;
  const ticket = {
    external_employee_id: `${systemCode}-EMP-SMOKE`,
    requester_name: "Integration Smoke Test",
    requester_email: "integration.smoke@example.com",
    origin_system: systemCode,
    origin_module: "Smoke Test",
    origin_feature: "External API",
    external_reference: reference,
    priority: "Low",
    title: `[SMOKE TEST] ${systemCode} external ticket`,
    description: "Automated smoke test of the External Ticket API. Safe to close.",
  };

  const created = await call("POST", "/tickets", ticket);
  expect(created.status === 201, `Create expected 201, got ${created.status}`);
  const ticketNumber = created.json.data.ticket_number;
  console.log(`  ticket_number=${ticketNumber} status=${created.json.data.status} priority=${created.json.data.priority}`);

  const replay = await call("POST", "/tickets", ticket);
  expect(replay.status === 200 && replay.json.data.ticket_number === ticketNumber, "Replay did not return the same ticket");

  const status = await call("GET", `/tickets/${encodeURIComponent(ticketNumber)}`);
  expect(status.status === 200, `Status expected 200, got ${status.status}`);

  const comment = await call("POST", `/tickets/${encodeURIComponent(ticketNumber)}/comments`, {
    comment: "Smoke test follow-up comment.",
    external_comment_reference: `${reference}-C1`,
  });
  expect([200, 201].includes(comment.status), `Comment expected 201, got ${comment.status}`);

  const badKey = await fetch(`${baseUrl}/api/v1/external/tickets/${encodeURIComponent(ticketNumber)}`, {
    headers: { "x-api-key": "invalid" },
    signal: AbortSignal.timeout(20000),
  });
  expect(badKey.status === 401, `Invalid key expected 401, got ${badKey.status}`);
  console.log("GET with invalid key -> 401 (as expected)");

  console.log(`\nPASS. Look for ${ticketNumber} in Incident Management.`);
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
