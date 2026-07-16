const normalizeCsv = (value, fallback) => String(value || fallback)
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

function evaluateUsbTransfer(event, policy = {}) {
  const fileName = String(event.file_name || "").toLowerCase();
  const rawExtension = String(event.extension || "").trim().toLowerCase();
  const extension = rawExtension && !rawExtension.startsWith(".") ? `.${rawExtension}` : rawExtension;
  const fileSizeBytes = Math.max(0, Number(event.file_size_bytes) || 0);
  const blockedExtensions = normalizeCsv(
    process.env.DLP_HIGH_RISK_EXTENSIONS,
    ".pem,.key,.pfx,.p12,.sql,.bak,.pst"
  );
  const sensitiveKeywords = normalizeCsv(
    process.env.DLP_SENSITIVE_FILENAME_KEYWORDS,
    "confidential,restricted,payroll,salary,password,secret,employee-data"
  );
  const largeTransferMb = Math.max(1, Number(policy.dlp_large_transfer_mb || process.env.DLP_LARGE_TRANSFER_MB) || 100);
  const matches = [];
  let score = 0;

  if (blockedExtensions.includes(extension)) {
    score += 55;
    matches.push(`high-risk extension ${extension}`);
  }
  const keyword = sensitiveKeywords.find((entry) => fileName.includes(entry));
  if (keyword) {
    score += 35;
    matches.push(`sensitive filename keyword ${keyword}`);
  }
  if (fileSizeBytes >= largeTransferMb * 1024 * 1024) {
    score += 25;
    matches.push(`large transfer at least ${largeTransferMb} MB`);
  }
  score = Math.min(100, score);
  const riskLevel = score >= 70 ? "Critical" : score >= 50 ? "High" : score >= 25 ? "Medium" : "Low";
  return { score, riskLevel, matches, largeTransferMb };
}

module.exports = { evaluateUsbTransfer };
