process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const assetManagementRoutes = require("../src/routes/assetManagement");

const secret = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";

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
