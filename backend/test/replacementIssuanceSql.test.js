const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("replacement issuance explicitly types the old-asset audit note parameter", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/routes/replacementRequests.js"),
    "utf8"
  );

  assert.match(
    source,
    /notes=CONCAT_WS\(E'\\n',NULLIF\(notes,''\),\$1::text\)/
  );
});
