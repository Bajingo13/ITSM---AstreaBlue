process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");
const repository = require("../src/repositories/hardwareAssetRepository");
const createHardwareAssetRoutes = require("../src/routes/hardwareAssets");

const secret =
  process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";

async function withServer(run) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1",
    createHardwareAssetRoutes({ tablesReady: Promise.resolve(true) })
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("employee hardware listing remains scoped to the authenticated employee", async () => {
  const originalListAssets = repository.listAssets;
  let receivedFilter = null;
  repository.listAssets = async (whereSql, params) => {
    receivedFilter = { whereSql, params };
    return {
      rows: [
        {
          asset_id: 10,
          employee_id: 27,
          purchase_price: 1000,
          salvage_value: 0,
          useful_life_months: 36,
          monitoring_device_id: null,
          reconciliation_match_count: 0,
          reconciliation_mismatch_count: 0,
          reconciliation_unknown_count: 0,
        },
      ],
    };
  };
  const token = jwt.sign(
    { userId: 27, role: "Employee", branchId: 4 },
    secret,
    { expiresIn: "5m" }
  );

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/hardware-assets`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.length, 1);
      assert.deepEqual(receivedFilter, {
        whereSql: "WHERE a.employee_id = $1",
        params: [27],
      });
    });
  } finally {
    repository.listAssets = originalListAssets;
  }
});

test("hardware creation delegates persistence and retains asset history", async () => {
  const originals = {
    createAsset: repository.createAsset,
    insertHistory: repository.insertHistory,
  };
  const calls = [];
  repository.createAsset = async (values) => {
    calls.push({ operation: "create", values });
    return {
      rows: [
        {
          asset_id: 91,
          asset_tag: "QA-ASSET-91",
          branch_id: 2,
          status: "Active",
        },
      ],
    };
  };
  repository.insertHistory = async (...args) => {
    calls.push({ operation: "history", args });
    return { rows: [] };
  };
  const token = jwt.sign(
    { userId: 1, role: "SuperAdmin", branchId: null },
    secret,
    { expiresIn: "5m" }
  );

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/hardware-assets`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          asset_name: "QA Laptop",
          asset_type: "Laptop",
          manufacturer: "AstreaBlue QA",
          model: "QA-2026",
          serial_number: "QA-SERIAL-91",
          asset_tag: "QA-ASSET-91",
          branch_id: 2,
          status: "Active",
        }),
      });
      const body = await response.json();
      assert.equal(response.status, 201, JSON.stringify(body));
      assert.equal(body.asset_id, 91);
      assert.equal(calls[0].operation, "create");
      assert.equal(calls[0].values.length, 40);
      assert.equal(calls[1].operation, "history");
      assert.equal(calls[1].args[0], 91);
      assert.equal(calls[1].args[1], "Asset Created");
    });
  } finally {
    repository.createAsset = originals.createAsset;
    repository.insertHistory = originals.insertHistory;
  }
});
