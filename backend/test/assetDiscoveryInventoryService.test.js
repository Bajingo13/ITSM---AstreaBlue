process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const { upsertAgentInventoryDiscovery } = require("../src/services/assetDiscoveryInventoryService");

function queryMock(results) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const next = results.shift();
      if (!next) throw new Error(`Unexpected query: ${sql}`);
      return next;
    },
  };
}

test("linked endpoint inventory creates an already-matched discovery record", async () => {
  const queryable = queryMock([
    { rows: [] },
    { rows: [{ discovery_id: 81, matched_asset_id: 42, reconciliation_status: "Matched" }] },
  ]);
  const result = await upsertAgentInventoryDiscovery({
    device_id: 7,
    device_uuid: "1cafc3b8-c510-43fc-b7d4-16c6a7800c89",
    hostname: "LAPTOP-QA",
    status: "Online",
    agent_version: "native-1.3.0",
    asset_id: 42,
    branch_id: 1,
  }, {
    serial_number: "QA-SERIAL",
    mac_address: "00:11:22:33:44:55",
    manufacturer: "AstreaBlue QA",
    os_name: "Windows 11",
  }, queryable);

  assert.equal(result.matched_asset_id, 42);
  assert.match(queryable.calls[1].sql, /INSERT INTO asset_discoveries/);
  assert.equal(queryable.calls[1].params[8], "Matched");
  assert.equal(queryable.calls[1].params[9], 42);
});

test("unlinked endpoint inventory matches one existing asset by serial number", async () => {
  const queryable = queryMock([
    { rows: [{ asset_id: 99 }] },
    { rows: [] },
    { rows: [{ discovery_id: 82, matched_asset_id: 99, reconciliation_status: "Matched" }] },
  ]);
  const result = await upsertAgentInventoryDiscovery({
    device_id: 8,
    device_uuid: "2cafc3b8-c510-43fc-b7d4-16c6a7800c89",
    hostname: "LAPTOP-QA-2",
    status: "Online",
    asset_id: null,
    branch_id: 2,
  }, { serial_number: "KNOWN-SERIAL" }, queryable);

  assert.equal(result.matched_asset_id, 99);
  assert.equal(queryable.calls[2].params[9], 99);
});
