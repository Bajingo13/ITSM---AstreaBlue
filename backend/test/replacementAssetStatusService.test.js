const test = require("node:test");
const assert = require("node:assert/strict");
const { resolvePostRepairAssetStatus } = require("../src/services/replacementAssetStatusService");

test("restores an assigned asset's prior operational status", () => {
  assert.equal(resolvePostRepairAssetStatus("In Use", true), "In Use");
  assert.equal(resolvePostRepairAssetStatus("Borrowed", true), "Borrowed");
});

test("uses In Use when an assigned asset has no safe prior status", () => {
  assert.equal(resolvePostRepairAssetStatus(null, true), "In Use");
  assert.equal(resolvePostRepairAssetStatus("Available", true), "In Use");
  assert.equal(resolvePostRepairAssetStatus("In Repair", true), "In Use");
});

test("restores an unassigned asset's prior available status", () => {
  assert.equal(resolvePostRepairAssetStatus("Available", false), "Available");
  assert.equal(resolvePostRepairAssetStatus("Active", false), "Active");
  assert.equal(resolvePostRepairAssetStatus("In Stock", false), "In Stock");
});

test("uses Available when an unassigned asset has no safe prior status", () => {
  assert.equal(resolvePostRepairAssetStatus(null, false), "Available");
  assert.equal(resolvePostRepairAssetStatus("In Use", false), "Available");
  assert.equal(resolvePostRepairAssetStatus("Borrowed", false), "Available");
});
