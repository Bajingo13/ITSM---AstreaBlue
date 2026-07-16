process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateUsbTransfer } = require("../src/services/dlpRiskService");

test("ordinary USB file metadata remains low risk", () => {
  const result = evaluateUsbTransfer({ file_name: "meeting-notes.txt", extension: ".txt", file_size_bytes: 2048 });
  assert.equal(result.riskLevel, "Low");
  assert.equal(result.score, 0);
  assert.deepEqual(result.matches, []);
});

test("high-risk extensions and sensitive filenames produce a critical DLP result", () => {
  const result = evaluateUsbTransfer({ file_name: "confidential-payroll-backup.sql", extension: ".sql", file_size_bytes: 4096 });
  assert.equal(result.riskLevel, "Critical");
  assert.equal(result.score, 90);
  assert.match(result.matches.join(" "), /high-risk extension/i);
  assert.match(result.matches.join(" "), /sensitive filename/i);
});

test("large-transfer threshold can be controlled by effective policy", () => {
  const result = evaluateUsbTransfer(
    { file_name: "archive.zip", extension: ".zip", file_size_bytes: 6 * 1024 * 1024 },
    { dlp_large_transfer_mb: 5 }
  );
  assert.equal(result.riskLevel, "Medium");
  assert.equal(result.score, 25);
});
