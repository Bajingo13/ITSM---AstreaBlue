process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateUsbTransfer, resolveDlpRules } = require("../src/services/dlpRiskService");

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

test("endpoint policy can configure extensions and filename keywords", () => {
  const policy = {
    dlp_high_risk_extensions: ["docx"],
    dlp_sensitive_filename_keywords: ["board-report"],
  };
  const result = evaluateUsbTransfer(
    { file_name: "board-report.docx", extension: "docx", file_size_bytes: 1024 },
    policy
  );
  assert.equal(result.riskLevel, "Critical");
  assert.equal(result.score, 90);
  assert.match(result.matches.join(" "), /\.docx/);
  assert.match(result.matches.join(" "), /board-report/);
});

test("DLP rule normalization rejects malformed values and clamps transfer thresholds", () => {
  const rules = resolveDlpRules({
    dlp_high_risk_extensions: [".SQL", "../exe", "pfx", ".toolongextensionvalue"],
    dlp_sensitive_filename_keywords: [" Payroll ", "", "x".repeat(70)],
    dlp_large_transfer_mb: 999999,
  });
  assert.deepEqual(rules.highRiskExtensions, [".sql", ".pfx"]);
  assert.deepEqual(rules.sensitiveFilenameKeywords, ["payroll"]);
  assert.equal(rules.largeTransferMb, 102400);
  assert.deepEqual(rules.thresholds, { medium: 25, high: 50, critical: 70 });
});
