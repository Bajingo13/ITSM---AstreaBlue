const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateSeatAnnualCost,
  summarizeTechnologyValue,
} = require("../src/services/employeeTechnologyValueService");

test("annual software value is allocated across purchased seats", () => {
  assert.equal(calculateSeatAnnualCost(120000, 10), 12000);
  assert.equal(calculateSeatAnnualCost(10000, 3), 3333.33);
  assert.equal(calculateSeatAnnualCost(12000, 0), 0);
});

test("employee technology value separates capital assets and annual software", () => {
  const totals = summarizeTechnologyValue(
    [{ purchase_price: "45000.00" }, { purchase_price: "15000.00" }],
    [
      { annual_cost: "120000.00", total_licenses: 10, seat_annual_cost_snapshot: "12000.00" },
      { annual_cost: "36000.00", total_licenses: 12 },
    ]
  );
  assert.deepEqual(totals, {
    asset_value: 60000,
    annual_software_cost: 15000,
    first_year_assigned_value: 75000,
  });
});

test("employee technology value preserves the assigned per-seat annual cost", () => {
  const totals = summarizeTechnologyValue([], [
    { annual_cost: "24000.00", total_licenses: 12, seat_annual_cost_snapshot: "1000.00" },
  ]);
  assert.equal(totals.annual_software_cost, 1000);
});
