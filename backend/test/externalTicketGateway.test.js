process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const path = require("node:path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const schemaName = `phase2_test_${process.pid}_${Date.now()}`;
const clonedTables = [
  "branches",
  "users",
  "tickets",
  "ticket_history",
  "ticket_comments",
  "notifications",
  "integration_registry",
  "integration_api_keys",
  "integration_audit_logs",
];
let adminPool;
let db;
let ticketRoutes;
let externalRoutes;
let createServiceDeskTicket;

const ids = { tickets: [], integrations: [], users: [], branches: [] };
let server;
let baseUrl;
let branchA;
let branchB;
let employee;
let adminA;
let adminB;
let technicianA;
let superAdmin;
let integrationA;
let integrationB;
const keyA = `ab_test_${crypto.randomBytes(16).toString("hex")}`;
const keyB = `ab_test_${crypto.randomBytes(16).toString("hex")}`;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  return { status: response.status, body: await response.json() };
}

function token(userId, role, branchId) {
  return jwt.sign(
    { userId, role, branchId },
    process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod"
  );
}

test.before(async () => {
  adminPool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
  });
  await adminPool.query(`CREATE SCHEMA ${schemaName}`);
  for (const table of clonedTables) {
    await adminPool.query(`CREATE TABLE ${schemaName}.${table} (LIKE public.${table} INCLUDING ALL)`);
  }

  process.env.PGOPTIONS = `-c search_path=${schemaName},public`;
  db = require("../config/db");
  ticketRoutes = require("../src/routes/tickets");
  await ticketRoutes.ticketSchemaReady;
  externalRoutes = require("../src/routes/integrationGateway");
  await externalRoutes.gatewaySchemaReady;
  ({ createServiceDeskTicket } = require("../src/services/serviceDeskTicketService"));

  const suffix = `${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const a = await db.query("INSERT INTO branches (branch_name) VALUES ($1) RETURNING branch_id", [`Phase2 A ${suffix}`]);
  const b = await db.query("INSERT INTO branches (branch_name) VALUES ($1) RETURNING branch_id", [`Phase2 B ${suffix}`]);
  branchA = a.rows[0].branch_id;
  branchB = b.rows[0].branch_id;
  ids.branches.push(branchA, branchB);
  const role = await db.query("SELECT role_id FROM system_roles WHERE LOWER(role_name)='employee' LIMIT 1");
  const user = await db.query(`
    INSERT INTO users (full_name,email,password_hash,role_id,company_name,status,branch_id,is_active)
    VALUES ($1,$2,'test-only',$3,'AstreaBlue','Active',$4,true) RETURNING user_id
  `, [`Phase2 Employee ${suffix}`, `phase2-${suffix}@example.invalid`, role.rows[0].role_id, branchA]);
  employee = user.rows[0].user_id;
  ids.users.push(employee);
  async function addUser(label, roleName, branchId) {
    const roleResult = await db.query("SELECT role_id FROM system_roles WHERE LOWER(role_name)=LOWER($1) LIMIT 1", [roleName]);
    const result = await db.query(`
      INSERT INTO users (full_name,email,password_hash,role_id,company_name,status,branch_id,is_active)
      VALUES ($1,$2,'test-only',$3,'AstreaBlue','Active',$4,true) RETURNING user_id
    `, [`Phase2 ${label} ${suffix}`, `phase2-${label}-${suffix}@example.invalid`, roleResult.rows[0].role_id, branchId]);
    ids.users.push(result.rows[0].user_id);
    return result.rows[0].user_id;
  }
  adminA = await addUser("admin-a", "Admin", branchA);
  adminB = await addUser("admin-b", "Admin", branchB);
  technicianA = await addUser("tech-a", "Technician", branchA);
  superAdmin = await addUser("super", "SuperAdmin", null);
  const ia = await db.query(`
    INSERT INTO integration_registry (system_name,system_code,api_key_hash,status,allowed_branches)
    VALUES ('HRIS',$1,$2,'Active',$3::jsonb) RETURNING integration_id
  `, ["HRIS", crypto.createHash("sha256").update(`legacy-${keyA}`).digest("hex"), JSON.stringify([branchA])]);
  const ib = await db.query(`
    INSERT INTO integration_registry (system_name,system_code,api_key_hash,status,allowed_branches)
    VALUES ('Payroll',$1,$2,'Active',$3::jsonb) RETURNING integration_id
  `, ["PAYROLL", crypto.createHash("sha256").update(`legacy-${keyB}`).digest("hex"), JSON.stringify([branchB])]);
  integrationA = ia.rows[0].integration_id;
  integrationB = ib.rows[0].integration_id;
  ids.integrations.push(integrationA, integrationB);
  await db.query(
    `INSERT INTO integration_api_keys(integration_id,key_name,api_key_hash,status)
     VALUES ($1,'HRIS Test Key',$2,'Active'),($3,'Payroll Test Key',$4,'Active')`,
    [integrationA, crypto.createHash("sha256").update(keyA).digest("hex"), integrationB, crypto.createHash("sha256").update(keyB).digest("hex")]
  );

  const app = express();
  app.use(express.json());
  app.use("/api/v1/tickets", ticketRoutes);
  app.use("/api/v1/external", externalRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await db.rawPool.end();
  } finally {
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      await adminPool.end();
    }
  }
});

test("Phase 3 external developer handoff acceptance workflow", async () => {
  const internal = await request("/api/v1/tickets", {
    method: "POST",
    headers: { authorization: `Bearer ${token(employee, "Employee", branchA)}` },
    body: JSON.stringify({ title: "Internal shared service", description: "Internal creation", branch_id: branchA, requester_id: employee }),
  });
  assert.equal(internal.status, 201);
  assert.match(internal.body.data.ticket_number, /^TKT-\d{8}-\d{4,}$/);
  ids.tickets.push(internal.body.data.id);

  const reference = `phase2-ref-${Date.now()}`;
  const payload = { branch_id: branchA, external_employee_id: "HRIS-EMP-1045", requester_name: "Phase 3 HRIS User", requester_email: "hris-user@example.invalid", origin_system: "HRIS", origin_module: "HR", origin_feature: "Help", priority: "Medium", title: "External shared service", description: "External creation", external_reference: reference };
  const external = await request("/api/v1/external/tickets", { method: "POST", headers: { "x-api-key": keyA }, body: JSON.stringify(payload) });
  assert.equal(external.status, 201);
  assert.match(external.body.data.ticket_number, /^HRIS-\d{8}\d{3,}$/);
  assert.equal(external.body.data.priority, "P3-Medium");
  assert.equal(external.body.data.id, undefined);
  assert.equal(external.body.data.branch_id, undefined);
  const externalRecord = await db.query("SELECT id,created_via FROM tickets WHERE ticket_number=$1", [external.body.data.ticket_number]);
  const externalTicketId = externalRecord.rows[0].id;
  ids.tickets.push(externalTicketId);
  assert.equal(externalRecord.rows[0].created_via, "External API");

  const records = await db.query(`
    SELECT t.id,t.sla_due_date,t.sla_policy_id,
      (SELECT COUNT(*)::int FROM ticket_history h WHERE h.ticket_id=t.id AND h.action='Ticket Created') history_count,
      (SELECT COUNT(*)::int FROM notifications n WHERE n.related_ticket_id=t.id) notification_count,
      (SELECT COUNT(*)::int FROM integration_audit_logs a WHERE (a.metadata->>'ticket_id')::int=t.id) audit_count
    FROM tickets t WHERE t.id = ANY($1::int[]) ORDER BY t.id
  `, [[internal.body.data.id, externalTicketId]]);
  for (const row of records.rows) {
    assert.ok(row.sla_due_date);
    assert.ok(row.sla_policy_id);
    assert.equal(row.history_count, 1);
    assert.ok(row.notification_count >= 1);
    assert.equal(row.audit_count, 1);
  }
  assert.equal(records.rows[0].sla_policy_id, records.rows[1].sla_policy_id);

  const branchBTicket = await createServiceDeskTicket({ title: "Branch B ticket", description: "RBAC verification", branchId: branchB, source: "test" });
  ids.tickets.push(branchBTicket.ticket.id);
  const adminAList = await request("/api/v1/tickets", { headers: { authorization: `Bearer ${token(adminA, "Admin", branchA)}` } });
  assert.ok(!adminAList.body.some((ticket) => ticket.id === externalTicketId));
  assert.ok(!adminAList.body.some((ticket) => ticket.id === branchBTicket.ticket.id));
  const adminBList = await request("/api/v1/tickets", { headers: { authorization: `Bearer ${token(adminB, "Admin", branchB)}` } });
  assert.ok(adminBList.body.some((ticket) => ticket.id === branchBTicket.ticket.id));
  assert.ok(!adminBList.body.some((ticket) => ticket.id === externalTicketId));
  const technicianList = await request("/api/v1/tickets", { headers: { authorization: `Bearer ${token(technicianA, "Technician", branchA)}` } });
  assert.ok(!technicianList.body.some((ticket) => ticket.id === externalTicketId));
  const employeeList = await request("/api/v1/tickets", { headers: { authorization: `Bearer ${token(employee, "Employee", branchA)}` } });
  assert.ok(!employeeList.body.some((ticket) => ticket.id === externalTicketId));
  assert.ok(!employeeList.body.some((ticket) => ticket.id === branchBTicket.ticket.id));
  const superList = await request("/api/v1/tickets", { headers: { authorization: `Bearer ${token(superAdmin, "SuperAdmin", null)}` } });
  assert.ok(superList.body.some((ticket) => ticket.id === externalTicketId));
  assert.ok(superList.body.some((ticket) => ticket.id === branchBTicket.ticket.id));

  const internalCrossBranch = await request("/api/v1/tickets", {
    method: "POST",
    headers: { authorization: `Bearer ${token(adminA, "Admin", branchA)}` },
    body: JSON.stringify({ title: "Denied internal cross-branch", description: "Must not be created", branch_id: branchB, requester_id: employee }),
  });
  assert.equal(internalCrossBranch.status, 403);

  const replay = await request("/api/v1/external/tickets", { method: "POST", headers: { "x-api-key": keyA }, body: JSON.stringify(payload) });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.ticket_number, external.body.data.ticket_number);
  assert.equal(replay.body.data.idempotent_replay, true);
  const conflict = await request("/api/v1/external/tickets", { method: "POST", headers: { "x-api-key": keyA }, body: JSON.stringify({ ...payload, title: "Conflicting retry" }) });
  assert.equal(conflict.status, 409);

  assert.equal((await request("/api/v1/external/tickets", { method: "POST", body: JSON.stringify(payload) })).status, 401);
  await db.query("UPDATE integration_registry SET status='Disabled' WHERE integration_id=$1", [integrationA]);
  assert.equal((await request("/api/v1/external/tickets", { method: "POST", headers: { "x-api-key": keyA }, body: JSON.stringify({ ...payload, external_reference: `${reference}-disabled` }) })).status, 403);
  await db.query("UPDATE integration_registry SET status='Active' WHERE integration_id=$1", [integrationA]);

  const branchIndependent = await request("/api/v1/external/tickets", { method: "POST", headers: { "x-api-key": keyA }, body: JSON.stringify({ ...payload, branch_id: branchB, external_reference: `${reference}-branch-independent` }) });
  assert.equal(branchIndependent.status, 201);
  assert.equal((await request(`/api/v1/external/tickets/${external.body.data.ticket_number}`, { headers: { "x-api-key": keyB } })).status, 404);
  assert.equal((await request(`/api/v1/external/tickets/${external.body.data.ticket_number}/comments`, { method: "POST", headers: { "x-api-key": keyB }, body: JSON.stringify({ comment_text: "denied" }) })).status, 404);

  const assignment = await request(`/api/v1/tickets/${externalTicketId}/assign`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token(superAdmin, "SuperAdmin", null)}` },
    body: JSON.stringify({ assigned_to: technicianA, current_user_id: superAdmin, role_name: "SuperAdmin" }),
  });
  // Centralized external tickets are enterprise records. They cannot be
  // delegated into a branch technician queue without first becoming a
  // branch-scoped internal ticket.
  assert.equal(assignment.status, 403);
  const statusUpdate = await request(`/api/v1/tickets/${externalTicketId}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token(technicianA, "Technician", branchA)}` },
    body: JSON.stringify({ status: "In Progress", changed_by: technicianA }),
  });
  assert.equal(statusUpdate.status, 404);
  const superAdminStatusUpdate = await request(`/api/v1/tickets/${externalTicketId}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token(superAdmin, "SuperAdmin", null)}` },
    body: JSON.stringify({ status: "In Progress", changed_by: superAdmin }),
  });
  assert.equal(superAdminStatusUpdate.status, 200);
  const lookup = await request(`/api/v1/external/tickets/${external.body.data.ticket_number}`, { headers: { "x-api-key": keyA } });
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.data.status, "In Progress");
  await db.query("INSERT INTO ticket_comments(ticket_id,user_id,comment_text,is_internal) VALUES($1,$2,'Internal secret',true)", [externalTicketId, adminA]);
  const commentPayload = { comment: "External follow-up", external_comment_reference: "HRIS-COMMENT-0001" };
  const comment = await request(`/api/v1/external/tickets/${external.body.data.ticket_number}/comments`, { method: "POST", headers: { "x-api-key": keyA }, body: JSON.stringify(commentPayload) });
  assert.equal(comment.status, 201);
  const commentReplay = await request(`/api/v1/external/tickets/${external.body.data.ticket_number}/comments`, { method: "POST", headers: { "x-api-key": keyA }, body: JSON.stringify(commentPayload) });
  assert.equal(commentReplay.status, 200);
  assert.equal(commentReplay.body.data.idempotent_replay, true);
  const commentConflict = await request(`/api/v1/external/tickets/${external.body.data.ticket_number}/comments`, { method: "POST", headers: { "x-api-key": keyA }, body: JSON.stringify({ ...commentPayload, comment: "Conflicting comment" }) });
  assert.equal(commentConflict.status, 409);
  const timeline = await db.query("SELECT COUNT(*)::int n FROM ticket_comments WHERE ticket_id=$1 AND comment_text='External follow-up'", [externalTicketId]);
  assert.equal(timeline.rows[0].n, 1);
  const safeLookup = await request(`/api/v1/external/tickets/${external.body.data.ticket_number}`, { headers: { "x-api-key": keyA } });
  assert.ok(safeLookup.body.data.comments.some((entry) => entry.comment === "External follow-up"));
  assert.ok(!safeLookup.body.data.comments.some((entry) => entry.comment === "Internal secret"));

  const before = await db.query("SELECT COUNT(*)::int n FROM tickets");
  await assert.rejects(createServiceDeskTicket({ title: "Rollback", description: "Must rollback", branchId: branchA, requesterId: employee, source: "test", failBeforeCommit: true }));
  const after = await db.query("SELECT COUNT(*)::int n FROM tickets");
  assert.equal(after.rows[0].n, before.rows[0].n);
});
