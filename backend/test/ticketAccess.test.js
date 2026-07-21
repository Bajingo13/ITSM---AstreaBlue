process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { addTicketAccessFilter } = require("../src/routes/_ticketAccess");

const secret = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";

function requestFor(role, branchId = null) {
  const token = jwt.sign({ userId: 9001, role, branchId }, secret, { expiresIn: "5m" });
  return {
    headers: { authorization: `Bearer ${token}` },
    query: {},
    body: {},
    ticketAccessContext: {
      authenticated: true,
      currentUserId: 9001,
      roleName: String(role).toLowerCase(),
      branchId,
      filterBranchId: null,
    },
  };
}

test("external integration tickets remain exclusive to SuperAdmin", () => {
  for (const [role, branchId] of [["Admin", 1], ["HR", 1], ["Technician", null], ["Technician", 1], ["Employee", 1]]) {
    const clauses = addTicketAccessFilter(requestFor(role, branchId), [], "t");
    assert.ok(clauses.includes("t.integration_id IS NULL"), `${role} must be restricted to internal tickets`);
  }

  const superAdminClauses = addTicketAccessFilter(requestFor("SuperAdmin"), [], "t");
  assert.equal(superAdminClauses.includes("t.integration_id IS NULL"), false);
});

test("technician without a branch cannot see the unassigned ticket queue", () => {
  const params = [];
  const clauses = addTicketAccessFilter(requestFor("Technician", null), params, "t");

  assert.ok(clauses.includes("t.assigned_to = $1"));
  assert.equal(clauses.some((clause) => clause.includes("assigned_to IS NULL")), false);
});

test("branch technician is restricted to that branch for assigned and available tickets", () => {
  const params = [];
  const clauses = addTicketAccessFilter(requestFor("Technician", 12), params, "t");

  assert.ok(clauses.includes("t.branch_id = $2"));
  assert.ok(clauses.includes("(t.assigned_to = $1 OR t.assigned_to IS NULL)"));
  assert.ok(clauses.some((clause) => clause.includes("visibility_scope")));
  assert.ok(clauses.some((clause) => clause.includes("COALESCE")), "uncategorized standard tickets must remain visible");
  assert.deepEqual(params, [9001, 12]);
});

test("HR sees only same-branch lifecycle-linked tickets or tickets HR personally filed", () => {
  const params = [];
  const clauses = addTicketAccessFilter(requestFor("HR", 12), params, "t");

  assert.ok(clauses.includes("t.branch_id = $1"));
  assert.ok(clauses.some((clause) => clause.includes("employee_lifecycle_cases")));
  assert.ok(clauses.some((clause) => clause.includes("creation_history.changed_by = $2")));
  assert.deepEqual(params, [12, 9001]);
});
