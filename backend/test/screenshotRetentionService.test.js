process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");

const dbPath = require.resolve("../config/db");
const storagePath = require.resolve("../src/services/r2StorageService");
const servicePath = require.resolve("../src/services/screenshotRetentionService");

test("expired screenshot retention removes the private object and database metadata", async () => {
  const queries = [];
  const deletedObjects = [];
  const originalDb = require.cache[dbPath];
  const originalStorage = require.cache[storagePath];
  const originalService = require.cache[servicePath];

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      query: async (sql, params = []) => {
        queries.push({ sql, params });
        if (/SELECT id, object_key\s+FROM laptop_screenshots/i.test(sql)) {
          return { rows: [{ id: 42, object_key: "screenshots/device/expired.abenc" }] };
        }
        if (/DELETE FROM laptop_screenshots/i.test(sql)) return { rowCount: 1, rows: [{ id: 9001 }] };
        throw new Error(`Unexpected retention query: ${sql}`);
      },
    },
  };
  require.cache[storagePath] = {
    id: storagePath,
    filename: storagePath,
    loaded: true,
    exports: {
      deletePrivateObject: async (key) => { deletedObjects.push(key); },
    },
  };
  delete require.cache[servicePath];

  try {
    const { purgeExpiredScreenshots } = require(servicePath);
    const removed = await purgeExpiredScreenshots();

    assert.equal(removed, 1);
    assert.deepEqual(deletedObjects, ["screenshots/device/expired.abenc"]);
    assert.equal(queries.length, 2);
    assert.match(queries[1].sql, /Screenshot retention/i);
    assert.deepEqual(queries[1].params, [42]);
  } finally {
    if (originalDb) require.cache[dbPath] = originalDb;
    else delete require.cache[dbPath];
    if (originalStorage) require.cache[storagePath] = originalStorage;
    else delete require.cache[storagePath];
    if (originalService) require.cache[servicePath] = originalService;
    else delete require.cache[servicePath];
  }
});
