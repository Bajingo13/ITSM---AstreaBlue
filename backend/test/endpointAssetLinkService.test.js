const assert = require("node:assert/strict");
const test = require("node:test");

const { syncEndpointAssetReferences } = require("../src/services/endpointAssetLinkService");

test("endpoint asset linking synchronizes every dependent inventory record", async () => {
  const queries = [];
  const discoveryCalls = [];
  const queryable = {
    async query(sql, params) {
      queries.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      return { rows: [] };
    },
  };
  const device = {
    device_id: 41,
    device_uuid: "1cafc3b8-c510-43fc-b7d4-16c6a7800c89",
    hostname: "QA-LAPTOP-41",
    branch_id: 2,
  };
  const inventory = { serial_number: "QA-SERIAL-41" };

  await syncEndpointAssetReferences(queryable, {
    device,
    inventory,
    assetId: 91,
    branchId: 2,
    actorUserId: 1,
    created: true,
    discoveryUpsert: async (...args) => discoveryCalls.push(args),
  });

  assert.equal(queries.length, 4);
  assert.match(queries[0].sql, /UPDATE monitored_devices/);
  assert.deepEqual(queries[0].params, [91, 2, 41]);
  assert.match(queries[1].sql, /UPDATE endpoint_hardware_inventory/);
  assert.match(queries[2].sql, /UPDATE endpoint_software_inventory/);
  assert.match(queries[3].sql, /INSERT INTO asset_history/);
  assert.equal(queries[3].params[1], "Asset Created from Endpoint");
  assert.equal(discoveryCalls.length, 1);
  assert.equal(discoveryCalls[0][0].asset_id, 91);
  assert.equal(discoveryCalls[0][2], queryable);
});

test("linking an existing asset records an endpoint link rather than a creation", async () => {
  const queries = [];
  const queryable = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };

  await syncEndpointAssetReferences(queryable, {
    device: {
      device_id: 42,
      device_uuid: "2cafc3b8-c510-43fc-b7d4-16c6a7800c89",
      hostname: "QA-LAPTOP-42",
      branch_id: 3,
    },
    inventory: {},
    assetId: 92,
    branchId: 3,
    actorUserId: 1,
    created: false,
    discoveryUpsert: async () => {},
  });

  assert.equal(queries.at(-1).params[1], "Endpoint Linked");
});
