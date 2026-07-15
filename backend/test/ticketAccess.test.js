process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { addTicketAccessFilter } = require("../src/routes/_ticketAccess");

const secret = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";

function requestFor(role, branchId = null) {
  const token = jwt.sign({ userId: 9001, role, branchId }, secret, { expiresIn: "5m" });
  return { headers: { authorization: `Bearer ${token}` }, query: {}, body: {} };
}

test("external integration tickets remain exclusive to SuperAdmin", () => {
  for (const [role, branchId] of [["Admin", 1], ["Technician", null], ["Technician", 1], ["Employee", 1]]) {
    const clauses = addTicketAccessFilter(requestFor(role, branchId), [], "t");
    assert.ok(clauses.includes("t.integration_id IS NULL"), `${role} must be restricted to internal tickets`);
  }

  const superAdminClauses = addTicketAccessFilter(requestFor("SuperAdmin"), [], "t");
  assert.equal(superAdminClauses.includes("t.integration_id IS NULL"), false);
});
