const { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

function readConfig() {
  const accountId = String(process.env.R2_ACCOUNT_ID || "").trim();
  const endpoint = String(process.env.R2_ENDPOINT || "").trim() ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  return {
    accountId,
    endpoint,
    accessKeyId: String(process.env.R2_ACCESS_KEY_ID || "").trim(),
    secretAccessKey: String(process.env.R2_SECRET_ACCESS_KEY || "").trim(),
    bucket: String(process.env.R2_BUCKET_NAME || "").trim(),
  };
}

function getR2Status() {
  const config = readConfig();
  const missing = [];
  if (!config.endpoint) missing.push("R2_ENDPOINT or R2_ACCOUNT_ID");
  if (!config.accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!config.secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!config.bucket) missing.push("R2_BUCKET_NAME");
  return { configured: missing.length === 0, missing, bucket: config.bucket || null };
}

function clientAndBucket() {
  const status = getR2Status();
  if (!status.configured) {
    const error = new Error(`Private consent storage is not configured. Missing: ${status.missing.join(", ")}.`);
    error.code = "R2_NOT_CONFIGURED";
    throw error;
  }
  const config = readConfig();
  return {
    bucket: config.bucket,
    client: new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    }),
  };
}

async function putPrivateObject({ key, body, contentType, metadata = {} }) {
  const { client, bucket } = clientAndBucket();
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    Metadata: Object.fromEntries(Object.entries(metadata).map(([name, value]) => [name, String(value)])),
  }));
  return { key, bucket, size: Buffer.byteLength(body) };
}

async function getPrivateObject(key) {
  const { client, bucket } = clientAndBucket();
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await result.Body.transformToByteArray();
  return {
    body: Buffer.from(bytes),
    contentType: result.ContentType || "application/octet-stream",
    size: result.ContentLength || bytes.length,
  };
}

async function deletePrivateObject(key) {
  const { client, bucket } = clientAndBucket();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  return { key, bucket };
}

module.exports = { deletePrivateObject, getPrivateObject, getR2Status, putPrivateObject };
