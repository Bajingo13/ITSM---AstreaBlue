process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const jwt = require("jsonwebtoken");
const repository = require("../src/repositories/hardwareAssetRepository");
const createHardwareAssetRoutes = require("../src/routes/hardwareAssets");
const { getAuthFromRequest } = require("../src/middleware/legacyJwtAuth");

const secret =
  process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";

async function withServer(run) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1",
    createHardwareAssetRoutes({
      tablesReady: Promise.resolve(true),
      actorResolver: async (req) => {
        const claim = getAuthFromRequest(req);
        if (!claim?.userId) return null;
        return {
          userId: Number(claim.userId),
          role: String(claim.role || "").toLowerCase().replace(/[\s_-]/g, ""),
          branchId: claim.branchId == null ? null : Number(claim.branchId),
          employeeNumber: claim.employeeNumber || null,
        };
      },
    })
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
        whereSql: "WHERE (a.assigned_to = $1 OR (a.assigned_to IS NULL AND (a.employee_id = $1::text)))",
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

test("manual unlinked hardware assets can be deleted atomically", async () => {
  const originalDeleteAssetSafely = repository.deleteAssetSafely;
  repository.deleteAssetSafely = async (assetId, branchId) => ({
    asset: {
      asset_id: Number(assetId),
      asset_name: "Manual QA Asset",
      branch_id: branchId,
    },
    linkedDevice: null,
  });
  const token = jwt.sign(
    { userId: 1, role: "SuperAdmin", branchId: null },
    secret,
    { expiresIn: "5m" }
  );

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/hardware-assets/501`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.success, true);
    });
  } finally {
    repository.deleteAssetSafely = originalDeleteAssetSafely;
  }
});

test("linked endpoint assets must be unlinked before deletion", async () => {
  const originalDeleteAssetSafely = repository.deleteAssetSafely;
  repository.deleteAssetSafely = async () => ({
    asset: { asset_id: 502, asset_name: "Linked QA Asset", branch_id: 2 },
    linkedDevice: { device_id: 88, hostname: "QA-ENDPOINT-88" },
  });
  const token = jwt.sign(
    { userId: 1, role: "SuperAdmin", branchId: null },
    secret,
    { expiresIn: "5m" }
  );

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/hardware-assets/502`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      assert.equal(response.status, 409, JSON.stringify(body));
      assert.match(body.error, /QA-ENDPOINT-88/);
      assert.match(body.error, /Unlink or reassign/);
    });
  } finally {
    repository.deleteAssetSafely = originalDeleteAssetSafely;
  }
});

test("hardware mutations reject anonymous and employee callers", async () => {
  const employeeToken = jwt.sign(
    { userId: 27, role: "Employee", branchId: 4 },
    secret,
    { expiresIn: "5m" }
  );
  await withServer(async (baseUrl) => {
    const anonymous = await fetch(`${baseUrl}/api/v1/hardware-assets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(anonymous.status, 401);

    const employee = await fetch(`${baseUrl}/api/v1/hardware-assets`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${employeeToken}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(employee.status, 403);
  });
});

test("monitoring devices cannot be linked across branches", async () => {
  const originals = {
    findAssetBranch: repository.findAssetBranch,
    findDevice: repository.findDevice,
    unlinkAssetDevices: repository.unlinkAssetDevices,
  };
  let unlinked = false;
  repository.findAssetBranch = async () => ({ rows: [{ branch_id: 2 }] });
  repository.findDevice = async () => ({ rows: [{ device_id: 55, branch_id: 3, asset_id: null }] });
  repository.unlinkAssetDevices = async () => {
    unlinked = true;
    return { rows: [] };
  };
  const token = jwt.sign(
    { userId: 1, role: "SuperAdmin", branchId: null },
    secret,
    { expiresIn: "5m" }
  );

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/hardware-assets/90/link-device`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ device_id: 55 }),
      });
      assert.equal(response.status, 409);
      assert.equal(unlinked, false);
    });
  } finally {
    repository.findAssetBranch = originals.findAssetBranch;
    repository.findDevice = originals.findDevice;
    repository.unlinkAssetDevices = originals.unlinkAssetDevices;
  }
});

test("protected replacement history is never deleted by hardware cleanup", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "repositories", "hardwareAssetRepository.js"),
    "utf8"
  );
  assert.doesNotMatch(source, /DELETE FROM replacement_requests/i);
});
