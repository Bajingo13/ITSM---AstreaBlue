const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAgentAssetIdentity,
  cleanInventoryText,
  normalizeDetectedSerial,
} = require("../src/routes/endpointInventoryRoutes");

test("normalizeDetectedSerial rejects common firmware placeholders", () => {
  assert.equal(normalizeDetectedSerial("UNKNOWN-SN"), null);
  assert.equal(normalizeDetectedSerial("To Be Filled By O.E.M."), null);
  assert.equal(normalizeDetectedSerial("  "), null);
});

test("normalizeDetectedSerial preserves a real serial number", () => {
  assert.equal(normalizeDetectedSerial(" FGT123456 "), "FGT123456");
});

test("buildAgentAssetIdentity creates stable unique fallback identifiers", () => {
  const device = {
    device_id: 38938,
    device_uuid: "1cafc3b8-c510-43fc-b7d4-16c6a7800c89",
  };

  const first = buildAgentAssetIdentity(device, { serial_number: "Unknown" });
  const second = buildAgentAssetIdentity(device, { serial_number: "Unknown" });

  assert.deepEqual(first, second);
  assert.match(first.assetTag, /^AUTO-[A-F0-9]{10}$/);
  assert.match(first.serialNumber, /^AGENT-[A-F0-9]{10}$/);
});

test("buildAgentAssetIdentity uses the detected serial when it is valid", () => {
  const identity = buildAgentAssetIdentity(
    { device_id: 38938, device_uuid: "1cafc3b8-c510-43fc-b7d4-16c6a7800c89" },
    { serial_number: "FGTPM23615002812" }
  );

  assert.equal(identity.serialNumber, "FGTPM23615002812");
});

test("cleanInventoryText protects legacy asset column lengths", () => {
  assert.equal(cleanInventoryText("  Dell Inc.  ", 100), "Dell Inc.");
  assert.equal(cleanInventoryText("x".repeat(120), 100).length, 100);
  assert.equal(cleanInventoryText("", 100, "Unknown"), "Unknown");
});
