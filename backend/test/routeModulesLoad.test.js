const test = require("node:test");
const assert = require("node:assert/strict");

test("service request routes load without relying on the server app instance", () => {
  assert.doesNotThrow(() => require("../src/routes/serviceRequests"));
});
