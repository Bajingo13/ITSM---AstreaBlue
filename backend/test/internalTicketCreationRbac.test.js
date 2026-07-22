process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const ticketRoutes = require("../src/routes/tickets");
const { setSocketServer } = require("../src/services/socketService");

const secret = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
let server;
let baseUrl;
let superAdmin;
let employee;
let hr;
let admin;
let categoryId;
let alternateBranchId;
let createdBranchId;
let createdHrUserId;
let createdAdminUserId;
const ticketIds = [];
const socketEvents = [];

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

  const hrRole = await db.query(`SELECT role_id FROM system_roles WHERE LOWER(role_name)='hr' LIMIT 1`);
  assert.ok(hrRole.rows[0]?.role_id, "ticket tests require the HR role migration");
  const createdHr = await db.query(
    `INSERT INTO users(full_name,email,password_hash,role_id,company_name,branch_id,status,is_active,onboarding_status,onboarding_required)
     VALUES('Ticket Test HR',$1,'test',$2,'AstreaBlue',$3,'Active',TRUE,'Completed',FALSE)
     RETURNING user_id,branch_id`,
    [`ticket-hr-${Date.now()}@example.test`, hrRole.rows[0].role_id, employee.branch_id]
  );
  hr = createdHr.rows[0];
  createdHrUserId = hr.user_id;

  const adminRole = await db.query(`SELECT role_id FROM system_roles WHERE LOWER(role_name)='admin' LIMIT 1`);
  assert.ok(adminRole.rows[0]?.role_id, "ticket tests require the Admin role");
  const createdAdmin = await db.query(
    `INSERT INTO users(full_name,email,password_hash,role_id,company_name,branch_id,status,is_active,onboarding_status,onboarding_required)
     VALUES('Ticket Test Admin',$1,'test',$2,'AstreaBlue',$3,'Active',TRUE,'Completed',FALSE)
     RETURNING user_id,branch_id`,
    [`ticket-admin-${Date.now()}@example.test`, adminRole.rows[0].role_id, employee.branch_id]
  );
  admin = createdAdmin.rows[0];
  createdAdminUserId = admin.user_id;

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
  setSocketServer({
    emit(eventName, payload) {
      socketEvents.push({ eventName, payload });
    },
  });
});

test.after(async () => {
  if (ticketIds.length) {
    await db.query(`DELETE FROM notifications WHERE related_ticket_id = ANY($1::int[])`, [ticketIds]);
    await db.query(`DELETE FROM ticket_history WHERE ticket_id = ANY($1::int[])`, [ticketIds]);
    await db.query(`DELETE FROM integration_audit_logs WHERE metadata->>'ticket_id' = ANY($1::text[])`, [ticketIds.map(String)]);
    await db.query(`DELETE FROM tickets WHERE id = ANY($1::int[])`, [ticketIds]);
  }
  if (createdBranchId) await db.query(`DELETE FROM branches WHERE branch_id=$1`, [createdBranchId]);
  if (createdHrUserId) await db.query(`DELETE FROM users WHERE user_id=$1`, [createdHrUserId]);
  if (createdAdminUserId) await db.query(`DELETE FROM users WHERE user_id=$1`, [createdAdminUserId]);
  if (server) await new Promise((resolve) => server.close(resolve));
  setSocketServer(null);
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
  assert.ok(socketEvents.some((event) => event.eventName === "ticket_changed" && event.payload.action === "created"));
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

test("HR can create a ticket only for an employee in HR's branch", async () => {
  const response = await createTicket(hr, "HR", {
    title: "HR branch employee ticket test",
    description: "Verifies HR can file an IT request for a branch employee.",
    priority: "P3-Medium",
    category_id: categoryId,
    requester_id: employee.user_id,
    branch_id: hr.branch_id,
  });
  const payload = await response.json();
  assert.equal(response.status, 201, payload.error || JSON.stringify(payload));
  assert.equal(Number(payload.data.requester_id), Number(employee.user_id));
  assert.equal(Number(payload.data.branch_id), Number(hr.branch_id));
  ticketIds.push(payload.data.id);

  const missingEmployee = await createTicket(hr, "HR", {
    title: "HR missing requester test",
    description: "HR must select the employee represented by the request.",
    category_id: categoryId,
    branch_id: hr.branch_id,
  });
  assert.equal(missingEmployee.status, 400);

  const nonEmployee = await createTicket(hr, "HR", {
    title: "HR invalid requester role test",
    description: "HR cannot file an employee request using an HR account as requester.",
    category_id: categoryId,
    requester_id: hr.user_id,
    branch_id: hr.branch_id,
  });
  assert.equal(nonEmployee.status, 400);
});

test("HR remains blocked from creating tickets for another branch", async () => {
  const response = await createTicket(hr, "HR", {
    title: "Forbidden HR cross-branch ticket test",
    description: "This request must remain blocked by branch RBAC.",
    category_id: categoryId,
    requester_id: employee.user_id,
    branch_id: alternateBranchId,
  });
  assert.equal(response.status, 403);
});

test("database account state overrides a still-valid HR JWT", async () => {
  await db.query("UPDATE users SET is_active=FALSE,status='Inactive' WHERE user_id=$1", [hr.user_id]);
  try {
    const response = await createTicket(hr, "HR", {
      title: "Deactivated HR token must fail",
      description: "A signed JWT must not bypass current database account state.",
      category_id: categoryId,
      requester_id: employee.user_id,
      branch_id: hr.branch_id,
    });
    assert.equal(response.status, 401);
  } finally {
    await db.query("UPDATE users SET is_active=TRUE,status='Active' WHERE user_id=$1", [hr.user_id]);
  }
});

test("database role overrides a forged role claim in a valid JWT", async () => {
  const response = await createTicket(employee, "SuperAdmin", {
    title: "Forged SuperAdmin claim must fail",
    description: "The employee remains branch-bound according to the database role.",
    category_id: categoryId,
    requester_id: employee.user_id,
    branch_id: alternateBranchId,
  });
  assert.equal(response.status, 403);
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

test("Ticket status updates broadcast a real-time dashboard refresh", async () => {
  const createResponse = await createTicket(superAdmin, "SuperAdmin", {
    title: "Real-time ticket update test",
    description: "Verifies that dashboard clients are invalidated after a status update.",
    priority: "P3-Medium",
    category_id: categoryId,
    requester_id: superAdmin.user_id,
    branch_id: alternateBranchId,
  });
  const created = await createResponse.json();
  assert.equal(createResponse.status, 201, created.error || JSON.stringify(created));
  ticketIds.push(created.data.id);

  const updateResponse = await fetch(`${baseUrl}/api/v1/tickets/${created.data.id}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${tokenFor(superAdmin, "SuperAdmin")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ status: "In Progress" }),
  });
  const updated = await updateResponse.json();
  assert.equal(updateResponse.status, 200, updated.error || JSON.stringify(updated));
  assert.ok(socketEvents.some((event) => event.eventName === "ticket_changed" && event.payload.action === "updated"));
});

test("Admin can correct same-branch priority and the correction is audited", async () => {
  const createResponse = await createTicket(employee, "Employee", {
    title: "Admin priority correction test",
    description: "The filer selected a lower priority than the branch administrator determines.",
    priority: "P4-Low",
    category_id: categoryId,
    requester_id: employee.user_id,
    branch_id: employee.branch_id,
  });
  const created = await createResponse.json();
  assert.equal(createResponse.status, 201, created.error || JSON.stringify(created));
  ticketIds.push(created.data.id);

  const updateResponse = await fetch(`${baseUrl}/api/v1/tickets/${created.data.id}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${tokenFor(admin, "Admin")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ priority: "P1-Critical" }),
  });
  const updated = await updateResponse.json();
  assert.equal(updateResponse.status, 200, updated.error || JSON.stringify(updated));
  assert.equal(updated.data.priority, "P1-Critical");

  const history = await db.query(
    `SELECT changed_by,old_value,new_value FROM ticket_history
      WHERE ticket_id=$1 AND action='Priority Corrected'`,
    [created.data.id]
  );
  assert.equal(Number(history.rows[0]?.changed_by), Number(admin.user_id));
  assert.equal(history.rows[0]?.old_value, "P4-Low");
  assert.equal(history.rows[0]?.new_value, "P1-Critical");
});

test("Employee cannot change ticket priority after filing", async () => {
  const createResponse = await createTicket(employee, "Employee", {
    title: "Employee priority escalation guard test",
    description: "Employees may suggest priority when filing but cannot revise it afterward.",
    priority: "P3-Medium",
    category_id: categoryId,
    requester_id: employee.user_id,
    branch_id: employee.branch_id,
  });
  const created = await createResponse.json();
  assert.equal(createResponse.status, 201, created.error || JSON.stringify(created));
  ticketIds.push(created.data.id);

  const updateResponse = await fetch(`${baseUrl}/api/v1/tickets/${created.data.id}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${tokenFor(employee, "Employee")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ priority: "P1-Critical" }),
  });
  assert.equal(updateResponse.status, 403);
});

test("SuperAdmin cancellation records both SLA transitions as Cancelled", async () => {
  const createResponse = await createTicket(superAdmin, "SuperAdmin", {
    title: "SLA cancellation history test",
    description: "Verifies cancellation is visible in recent SLA activity.",
    priority: "P3-Medium",
    category_id: categoryId,
    requester_id: superAdmin.user_id,
    branch_id: alternateBranchId,
  });
  const created = await createResponse.json();
  assert.equal(createResponse.status, 201, created.error || JSON.stringify(created));
  ticketIds.push(created.data.id);

  const cancelResponse = await fetch(`${baseUrl}/api/v1/tickets/${created.data.id}/cancel`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${tokenFor(superAdmin, "SuperAdmin")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ cancellation_reason: "Cancellation SLA audit test" }),
  });
  const cancelled = await cancelResponse.json();
  assert.equal(cancelResponse.status, 200, cancelled.error || JSON.stringify(cancelled));
  assert.equal(cancelled.data.response_sla_status, "Cancelled");
  assert.equal(cancelled.data.resolution_sla_status, "Cancelled");

  const history = await db.query(
    `SELECT action, old_value, new_value
     FROM ticket_history
     WHERE ticket_id = $1 AND action IN ('Response SLA', 'Resolution SLA')
     ORDER BY action`,
    [created.data.id]
  );
  assert.deepEqual(
    history.rows.map((row) => [row.action, row.old_value, row.new_value]),
    [
      ["Resolution SLA", "Pending", "Cancelled"],
      ["Response SLA", "Pending", "Cancelled"],
    ]
  );
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

test("internal ticket routes reject unauthenticated requests", async () => {
  const response = await fetch(`${baseUrl}/api/v1/tickets`);
  assert.equal(response.status, 401);
});

test("employee cannot comment on a ticket in another branch", async () => {
  const createResponse = await createTicket(superAdmin, "SuperAdmin", {
    title: "Cross-branch comment scope test",
    description: "Verifies comment writes respect ticket RBAC.",
    priority: "P3-Medium",
    category_id: categoryId,
    requester_id: superAdmin.user_id,
    branch_id: alternateBranchId,
  });
  const created = await createResponse.json();
  assert.equal(createResponse.status, 201, JSON.stringify(created));
  ticketIds.push(created.data.id);

  const response = await fetch(`${baseUrl}/api/v1/tickets/${created.data.id}/comments`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokenFor(employee, "Employee")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      comment_text: "This cross-branch write must be denied.",
      user_id: superAdmin.user_id,
    }),
  });
  assert.equal(response.status, 404);
});
