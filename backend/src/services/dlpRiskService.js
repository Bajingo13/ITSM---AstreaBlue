const DEFAULT_HIGH_RISK_EXTENSIONS = [".pem", ".key", ".pfx", ".p12", ".sql", ".bak", ".pst"];
const DEFAULT_SENSITIVE_FILENAME_KEYWORDS = [
  "confidential", "restricted", "payroll", "salary", "password", "secret", "employee-data",
];
const RISK_THRESHOLDS = Object.freeze({ medium: 25, high: 50, critical: 70 });

const normalizeList = (value, fallback) => {
  const entries = Array.isArray(value) ? value : String(value || "").split(",");
  const normalized = entries.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean);
  return normalized.length ? [...new Set(normalized)] : [...fallback];
};

const normalizeExtensions = (value) => normalizeList(value, DEFAULT_HIGH_RISK_EXTENSIONS)
  .map((entry) => entry.startsWith(".") ? entry : `.${entry}`)
  .filter((entry) => /^\.[a-z0-9]{1,15}$/.test(entry))
  .slice(0, 50);

const normalizeKeywords = (value) => normalizeList(value, DEFAULT_SENSITIVE_FILENAME_KEYWORDS)
  .filter((entry) => entry.length <= 64)
  .slice(0, 50);

function resolveDlpRules(policy = {}) {
  const configuredExtensions = policy.dlp_high_risk_extensions ?? process.env.DLP_HIGH_RISK_EXTENSIONS;
  const configuredKeywords = policy.dlp_sensitive_filename_keywords ?? process.env.DLP_SENSITIVE_FILENAME_KEYWORDS;
  const largeTransferMb = Math.min(
    102400,
    Math.max(1, Number(policy.dlp_large_transfer_mb || process.env.DLP_LARGE_TRANSFER_MB) || 100)
  );
  return {
    highRiskExtensions: normalizeExtensions(configuredExtensions),
    sensitiveFilenameKeywords: normalizeKeywords(configuredKeywords),
    largeTransferMb,
    thresholds: { ...RISK_THRESHOLDS },
    scoring: {
      highRiskExtension: 55,
      sensitiveFilenameKeyword: 35,
      largeTransfer: 25,
    },
  };
}

function evaluateUsbTransfer(event, policy = {}) {
  const fileName = String(event.file_name || "").toLowerCase();
  const rawExtension = String(event.extension || "").trim().toLowerCase();
  const extension = rawExtension && !rawExtension.startsWith(".") ? `.${rawExtension}` : rawExtension;
  const fileSizeBytes = Math.max(0, Number(event.file_size_bytes) || 0);
  const rules = resolveDlpRules(policy);
  const matches = [];
  let score = 0;

  if (rules.highRiskExtensions.includes(extension)) {
    score += rules.scoring.highRiskExtension;
    matches.push(`high-risk extension ${extension}`);
  }
  const keyword = rules.sensitiveFilenameKeywords.find((entry) => fileName.includes(entry));
  if (keyword) {
    score += rules.scoring.sensitiveFilenameKeyword;
    matches.push(`sensitive filename keyword ${keyword}`);
  }
  if (fileSizeBytes >= rules.largeTransferMb * 1024 * 1024) {
    score += rules.scoring.largeTransfer;
    matches.push(`large transfer at least ${rules.largeTransferMb} MB`);
  }
  score = Math.min(100, score);
  const riskLevel = score >= rules.thresholds.critical
    ? "Critical"
    : score >= rules.thresholds.high
      ? "High"
      : score >= rules.thresholds.medium ? "Medium" : "Low";
  return { score, riskLevel, matches, largeTransferMb: rules.largeTransferMb };
}

module.exports = {
  DEFAULT_HIGH_RISK_EXTENSIONS,
  DEFAULT_SENSITIVE_FILENAME_KEYWORDS,
  RISK_THRESHOLDS,
  evaluateUsbTransfer,
  resolveDlpRules,
};
