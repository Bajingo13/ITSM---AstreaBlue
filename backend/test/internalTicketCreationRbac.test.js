process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const ticketRoutes = require("../src/routes/tickets");

const secret = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
let server;
let baseUrl;
let superAdmin;
let employee;
let categoryId;
let alternateBranchId;
let createdBranchId;
const ticketIds = [];

function tokenFor(user, role) {
  return jwt.sign({ userId: user.user_id, role, branchId: user.branch_id || null }, secret, { expiresIn: "5m" });
}

async function createTicket(user, role, body) {
  return fetch(`${baseUrl}/api/v1/tickets`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokenFor(user, role)}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test.before(async () => {
  superAdmin = (await db.query(
    `SELECT u.user_id,u.branch_id FROM users u JOIN system_roles r ON r.role_id=u.role_id
     WHERE LOWER(REPLACE(REPLACE(r.role_name,'_',''),' ',''))='superadmin' LIMIT 1`
  )).rows[0];
  employee = (await db.query(
    `SELECT u.user_id,u.branch_id FROM users u JOIN system_roles r ON r.role_id=u.role_id
     WHERE LOWER(r.role_name)='employee' AND u.branch_id IS NOT NULL LIMIT 1`
  )).rows[0];
  categoryId = (await db.query(`SELECT category_id FROM ticket_categories ORDER BY category_id LIMIT 1`)).rows[0]?.category_id;
  assert.ok(superAdmin?.user_id, "ticket tests require a SuperAdmin");
  assert.ok(employee?.user_id && employee?.branch_id, "ticket tests require a branch-assigned employee");
  assert.ok(categoryId, "ticket tests require a category");

  const branch = await db.query(
    `INSERT INTO branches (branch_name,branch_location,is_active) VALUES ($1,'Test',TRUE) RETURNING branch_id`,
    [`Ticket RBAC Test ${Date.now()}`]
  );
  alternateBranchId = branch.rows[0].branch_id;
  createdBranchId = alternateBranchId;

  const app = express();
  app.use(express.json());
  app.use("/api/v1/tickets", ticketRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (ticketIds.length) {
    await db.query(`DELETE FROM notifications WHERE related_ticket_id = ANY($1::int[])`, [ticketIds]);
    await db.query(`DELETE FROM ticket_history WHERE ticket_id = ANY($1::int[])`, [ticketIds]);
    await db.query(`DELETE FROM integration_audit_logs WHERE metadata->>'ticket_id' = ANY($1::text[])`, [ticketIds.map(String)]);
    await db.query(`DELETE FROM tickets WHERE id = ANY($1::int[])`, [ticketIds]);
  }
  if (createdBranchId) await db.query(`DELETE FROM branches WHERE branch_id=$1`, [createdBranchId]);
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.rawPool.end();
});

test("SuperAdmin can create a ticket across branches without weakening branch-bound roles", async () => {
  const response = await createTicket(superAdmin, "SuperAdmin", {
    title: "Cross-branch SuperAdmin ticket test",
    description: "Verifies enterprise-wide ticket creation authority.",
    priority: "P3-Medium",
    category_id: categoryId,
    requester_id: superAdmin.user_id,
    branch_id: alternateBranchId,
  });
  const payload = await response.json();
  assert.equal(response.status, 201, payload.error || JSON.stringify(payload));
  assert.equal(Number(payload.data.branch_id), Number(alternateBranchId));
  ticketIds.push(payload.data.id);
});

test("Employee can create a ticket in their own branch with an integer category", async () => {
  const response = await createTicket(employee, "Employee", {
    title: "Employee ticket test",
    description: "Verifies integer category SLA matching and employee branch scope.",
    priority: "P3-Medium",
    category_id: categoryId,
    requester_id: employee.user_id,
    branch_id: employee.branch_id,
  });
  const payload = await response.json();
  assert.equal(response.status, 201, payload.error || JSON.stringify(payload));
  assert.equal(Number(payload.data.requester_id), Number(employee.user_id));
  assert.equal(Number(payload.data.branch_id), Number(employee.branch_id));
  ticketIds.push(payload.data.id);
});

test("Loading tickets never deletes an old cancelled ticket", async () => {
  const response = await createTicket(superAdmin, "SuperAdmin", {
    title: "Cancelled ticket retention test",
    description: "Verifies that ticket reads are non-destructive and preserve the audit record.",
    priority: "P3-Medium",
    category_id: categoryId,
    requester_id: superAdmin.user_id,
    branch_id: alternateBranchId,
  });
  const created = await response.json();
  assert.equal(response.status, 201, created.error || JSON.stringify(created));
  ticketIds.push(created.data.id);

  await db.query(
    `UPDATE tickets
     SET status = 'Cancelled', cancelled_at = NOW() - INTERVAL '4 days'
     WHERE id = $1`,
    [created.data.id]
  );

  const listResponse = await fetch(`${baseUrl}/api/v1/tickets`, {
    headers: { authorization: `Bearer ${tokenFor(superAdmin, "SuperAdmin")}` },
  });
  const listedTickets = await listResponse.json();
  assert.equal(listResponse.status, 200, JSON.stringify(listedTickets));
  assert.ok(listedTickets.some((ticket) => Number(ticket.id) === Number(created.data.id)));

  const persisted = await db.query("SELECT status FROM tickets WHERE id = $1", [created.data.id]);
  assert.equal(persisted.rows[0]?.status, "Cancelled");
});

test("Employee remains blocked from creating a ticket for another branch", async () => {
  const response = await createTicket(employee, "Employee", {
    title: "Forbidden cross-branch ticket test",
    description: "This request must remain blocked by RBAC.",
    category_id: categoryId,
    requester_id: employee.user_id,
    branch_id: alternateBranchId,
  });
  assert.equal(response.status, 403);
});
