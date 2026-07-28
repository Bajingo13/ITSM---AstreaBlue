const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const {
  decryptScreenshot,
  encryptScreenshot,
  screenshotEncryptionKey,
} = require("../src/services/screenshotCryptoService");

test("screenshot encryption remains AES-256-GCM compatible", () => {
  const original = process.env.SCREENSHOT_ENCRYPTION_KEY;
  process.env.SCREENSHOT_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

  try {
    const plaintext = Buffer.from("AstreaBlue protected screenshot regression payload");
    const encrypted = encryptScreenshot(plaintext);
    const decrypted = decryptScreenshot(encrypted.ciphertext, encrypted.iv, encrypted.authTag);

    assert.deepEqual(decrypted, plaintext);
    assert.equal(encrypted.sha256, crypto.createHash("sha256").update(plaintext).digest("hex"));
  } finally {
    if (original === undefined) delete process.env.SCREENSHOT_ENCRYPTION_KEY;
    else process.env.SCREENSHOT_ENCRYPTION_KEY = original;
  }
});

test("screenshot encryption rejects invalid keys", () => {
  const original = process.env.SCREENSHOT_ENCRYPTION_KEY;
  process.env.SCREENSHOT_ENCRYPTION_KEY = "not-a-32-byte-key";

  try {
    assert.throws(
      () => screenshotEncryptionKey(),
      (error) => error.code === "SCREENSHOT_ENCRYPTION_NOT_CONFIGURED"
    );
  } finally {
    if (original === undefined) delete process.env.SCREENSHOT_ENCRYPTION_KEY;
    else process.env.SCREENSHOT_ENCRYPTION_KEY = original;
  }
});
