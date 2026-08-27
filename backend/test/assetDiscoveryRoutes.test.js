process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const assetManagementRoutes = require("../src/routes/assetManagement");

const secret = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";

test("discovery registry derives row-specific agent and manual verification", async () => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql) => {
    calls.push(sql);
    // Auth now resolves the caller against the database on every request.
    if (/FROM users u\s+JOIN system_roles r/.test(sql)) {
      return {
        rows: [{
          user_id: 1,
          full_name: "QA Asset Manager",
          employee_number: null,
          branch_id: null,
          is_active: true,
          status: "Active",
          role_name: "SuperAdmin",
        }],
      };
    }
    if (/SELECT d\.\*,a\.asset_name/.test(sql)) {
      return {
        rows: [
          {
            discovery_id: 18,
            matched_asset_id: 91,
            raw_data: { device_id: 17 },
            reconciliation_status: "Matched",
            reconciliation_match_count: 2,
            reconciliation_mismatch_count: 1,
            reconciliation_unknown_count: 0,
          },
          {
            discovery_id: 19,
            matched_asset_id: 91,
            raw_data: {},
            reconciliation_status: "Matched",
            hostname: "UNRELATED-LAPTOP",
            serial_number: "OTHER-SERIAL",
            manufacturer: "Other Manufacturer",
            asset_tag: "OTHER-TAG",
            matched_asset_hostname: "MANAGED-LAPTOP",
            matched_asset_serial_number: "ASSET-SERIAL",
            matched_asset_manufacturer: "Asset Manufacturer",
            matched_asset_tag: "ASSET-TAG",
            reconciliation_match_count: 3,
            reconciliation_mismatch_count: 0,
            reconciliation_unknown_count: 0,
          },
        ],
      };
    }
    return { rows: [] };
  };

  const app = express();
  app.use(express.json());
  app.use("/api/v1/hardware-assets", assetManagementRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const token = jwt.sign({ userId: 1, role: "SuperAdmin", branchId: null }, secret, { expiresIn: "5m" });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/hardware-assets/discovery`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.data[0].verification_status, "Mismatched");
    assert.equal(body.data[1].verification_status, "Mismatched");
    assert.equal(body.data[1].reconciliation_mismatch_count, 4);
    assert.ok(calls.some((sql) => /asset_inventory_reconciliation/.test(sql)));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.query = originalQuery;
  }
});

test("creating an asset from discovery uses the real hardware_assets schema", async () => {
  const originalConnect = db.connect;
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT \* FROM asset_discoveries/.test(sql)) {
        return { rows: [{
          discovery_id: 17,
          hostname: "LAPTOP-DISCOVERY-QA",
          device_type: "Computer",
          manufacturer: "AstreaBlue QA",
          serial_number: "DISCOVERY-QA-SERIAL",
          asset_tag: "DISCOVERY-QA-TAG",
          branch_id: 3,
          matched_asset_id: null,
          raw_data: {},
        }] };
      }
      if (/INSERT INTO hardware_assets/.test(sql)) {
        assert.doesNotMatch(sql, /manufacturer/);
        assert.equal(params.length, 7);
        return { rows: [{ asset_id: 91, asset_tag: "DISCOVERY-QA-TAG", branch_id: 3 }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  db.connect = async () => client;

  const app = express();
  app.use(express.json());
  app.use("/api/v1/hardware-assets", assetManagementRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const token = jwt.sign({ userId: 1, role: "SuperAdmin", branchId: null }, secret, { expiresIn: "5m" });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/hardware-assets/discovery/17/create-asset`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ branch_id: 3 }),
    });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(body.success, true);
    assert.ok(calls.some(({ sql }) => /COMMIT/.test(sql)));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.connect = originalConnect;
  }
});
