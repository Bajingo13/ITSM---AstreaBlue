import test from "node:test";
import assert from "node:assert/strict";
import { compareHardwareAssets, SORT_OPTIONS, getSortOptionLabel } from "../src/views/assets/assetViewUtils.js";

const assets = [
  { asset_id: 1, asset_tag: "AocTAX2025-001", purchase_date: "2025-05-22", created_at: "2024-01-01", updated_at: "2026-10-01" },
  { asset_id: 2, asset_tag: "Aoc-TAX2024-013", purchase_date: "2024-11-07", created_at: "2026-01-01", updated_at: "2026-10-08" },
  { asset_id: 3, asset_tag: "AocTAX2024-011", purchase_date: "2024-06-01", created_at: "2025-01-01", updated_at: "2026-10-03" },
];
const ids = (rows, mode) => [...rows].sort((a, b) => compareHardwareAssets(a, b, mode)).map(a => a.asset_id);

test("oldest/latest depend on purchase date, not entry date or tag year", () => {
  assert.deepEqual(ids(assets, "oldest"), [3, 2, 1]);
  assert.deepEqual(ids(assets, "latest"), [1, 2, 3]);
});
test("a corrected purchase date immediately changes ordering", () => {
  const corrected = assets.map(a => a.asset_id === 2 ? { ...a, purchase_date: "2924-11-07" } : a);
  assert.deepEqual(ids(corrected, "oldest"), [3, 1, 2]);
  corrected[1].purchase_date = "2024-11-07";
  assert.deepEqual(ids(corrected, "oldest"), [3, 2, 1]);
});
test("missing and invalid dates go last in both directions, not to 1970", () => {
  const rows = [...assets, { asset_id: 4, purchase_date: null }, { asset_id: 5, purchase_date: "invalid" }, { asset_id: 6, purchase_date: "2024-02-30" }];
  assert.deepEqual(ids(rows, "oldest"), [3, 2, 1, 4, 5, 6]);
  assert.deepEqual(ids(rows, "latest"), [1, 2, 3, 4, 5, 6]);
});
test("purchase dates use calendar days even when the API sends ISO timestamps", () => {
  const rows = [{ asset_id: 1, purchase_date: "2024-11-07T23:00:00-08:00" }, { asset_id: 2, purchase_date: "2024-11-08" }];
  assert.deepEqual(ids(rows, "oldest"), [1, 2]);
});
test("asset tags use natural numeric ascending/descending order", () => {
  const rows = [{ asset_id: 1, asset_tag: "TAX2025-001" }, { asset_id: 2, asset_tag: "TAX2024-10" }, { asset_id: 3, asset_tag: "tax2024-2" }, { asset_id: 4, asset_tag: null }];
  assert.deepEqual(ids(rows, "asset-tag-asc"), [3, 2, 1, 4]);
  assert.deepEqual(ids(rows, "asset-tag-desc"), [1, 2, 3, 4]);
});
test("recently updated still sorts by update time; alphabetical still sorts by name", () => {
  assert.deepEqual(ids(assets, "updated"), [2, 3, 1]);
  assert.deepEqual(ids([{ asset_id: 1, asset_name: "Zebra" }, { asset_id: 2, asset_name: "Alpha" }], "alphabetical"), [2, 1]);
});
test("equal values use tag then id as stable ties regardless of API order", () => {
  const rows = [3, 1, 2].map(asset_id => ({ asset_id, asset_tag: "SAME", purchase_date: "2024-11-07" }));
  for (const mode of ["oldest", "latest", "asset-tag-asc", "asset-tag-desc"]) {
    assert.deepEqual(ids(rows, mode), [1, 2, 3]);
    assert.deepEqual(ids([...rows].reverse(), mode), [1, 2, 3]);
  }
});
test("both requested asset-tag options are included in the filter menu", () => {
  assert.ok(SORT_OPTIONS.some(o => o.value === "asset-tag-asc"));
  assert.equal(getSortOptionLabel("asset-tag-desc"), "Asset Tag Descending");
});
