const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeCpuName,
  textValuesMatch,
} = require("../src/services/reconciliationService");

test("normalizes equivalent Intel CPU names reported in different formats", () => {
  const assetValue = "Intel Core™ i5-8265U";
  const agentValue = "Intel(R) Core(TM) i5-8265U CPU @ 1.60GHz";

  assert.equal(normalizeCpuName(assetValue), "intel core i5 8265u");
  assert.equal(normalizeCpuName(agentValue), "intel core i5 8265u");
  assert.equal(textValuesMatch("cpu_name", assetValue, agentValue), true);
});

test("still detects genuinely different processors", () => {
  assert.equal(
    textValuesMatch(
      "cpu_name",
      "Intel Core i5-8265U",
      "AMD Ryzen 7 5700U"
    ),
    false
  );
});
