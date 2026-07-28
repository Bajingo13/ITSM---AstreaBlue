const crypto = require("crypto");

function screenshotEncryptionKey() {
  const configured = String(process.env.SCREENSHOT_ENCRYPTION_KEY || "").trim();
  let key = null;

  if (/^[0-9a-f]{64}$/i.test(configured)) {
    key = Buffer.from(configured, "hex");
  } else if (configured) {
    try {
      key = Buffer.from(configured, "base64");
    } catch {
      key = null;
    }
  }

  if (!key || key.length !== 32) {
    const error = new Error("SCREENSHOT_ENCRYPTION_KEY must be a base64 or hexadecimal 32-byte key.");
    error.code = "SCREENSHOT_ENCRYPTION_NOT_CONFIGURED";
    throw error;
  }

  return key;
}

function encryptScreenshot(bytes) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", screenshotEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);

  return {
    ciphertext,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function decryptScreenshot(bytes, iv, authTag) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    screenshotEncryptionKey(),
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([decipher.update(bytes), decipher.final()]);
}

module.exports = {
  decryptScreenshot,
  encryptScreenshot,
  screenshotEncryptionKey,
};
