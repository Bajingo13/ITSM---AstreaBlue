process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const analyticsCenterRoutes = require("../src/routes/analyticsCenter");

let server;
let baseUrl;
let branchId;
let superAdminUser;
let adminUser;
let technicianUser;

const tokenFor = (user, claimedRole = null) => jwt.sign(
  { userId: user.user_id, role: claimedRole || user.role_name, branchId: user.branch_id },
  process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod",
  { expiresIn: "5m" }
);

test.before(async () => {
  branchId = (await db.query("SELECT branch_id FROM branches ORDER BY branch_id LIMIT 1")).rows[0]?.branch_id;
  assert.ok(branchId, "analytics tests require at least one branch");
  const users = await db.query(`
    SELECT u.user_id,u.branch_id,r.role_name
      FROM users u JOIN system_roles r ON r.role_id=u.role_id
     WHERE COALESCE(u.is_active,TRUE)=TRUE
       AND LOWER(COALESCE(u.status,'Active')) NOT IN ('inactive','disabled','deactivated')
       AND LOWER(r.role_name) IN ('superadmin','admin','technician')
     ORDER BY u.user_id`);
  superAdminUser = users.rows.find((user) => String(user.role_name).toLowerCase() === "superadmin");
  adminUser = users.rows.find((user) => String(user.role_name).toLowerCase() === "admin" && user.branch_id);
  technicianUser = users.rows.find((user) => String(user.role_name).toLowerCase() === "technician" && user.branch_id);
  assert.ok(superAdminUser && adminUser && technicianUser, "analytics tests require active SuperAdmin, Admin, and Technician users");
  branchId = adminUser.branch_id;
  const app = express();
  app.use("/api/v1/analytics", analyticsCenterRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.rawPool.end();
});

test("enterprise summary enforces authentication and returns complete manager analytics", async () => {
  assert.equal((await fetch(`${baseUrl}/api/v1/analytics/summary`)).status, 401);

  const response = await fetch(`${baseUrl}/api/v1/analytics/summary`, {
    headers: { authorization: `Bearer ${tokenFor(superAdminUser)}` },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  for (const section of ["service_desk", "problems", "assets", "endpoints", "sla", "knowledge", "compliance", "resources", "projects", "replacements"]) {
    assert.ok(Object.hasOwn(body.data, section), `missing ${section}`);
  }
  assert.equal(body.data.replacements.available, true);
  assert.ok(Object.hasOwn(body.data.replacements, "awaiting_approval"));
});

test("technicians cannot access reporting and analytics", async () => {
  const headers = { authorization: `Bearer ${tokenFor(technicianUser)}` };
  const response = await fetch(`${baseUrl}/api/v1/analytics/summary`, { headers });
  assert.equal(response.status, 403);
  assert.match((await response.json()).message, /administrators/i);
  assert.equal((await fetch(`${baseUrl}/api/v1/analytics/custom-report`, { headers })).status, 403);
});

test("administrators can generate branch-scoped reports and TXT exports", async () => {
  const headers = { authorization: `Bearer ${tokenFor(adminUser)}` };
  const optionResponse = await fetch(`${baseUrl}/api/v1/analytics/report-options`, { headers });
  assert.equal(optionResponse.status, 200);
  const options = (await optionResponse.json()).data;
  assert.equal(options.branches.length, 1);
  assert.equal(String(options.branches[0].branch_id), String(branchId));
  assert.ok(Array.isArray(options.categories));
  assert.ok(Array.isArray(options.technicians));
  assert.ok(Array.isArray(options.department_options));
  for (const technician of options.technicians) {
    assert.equal(String(technician.branch_id), String(branchId));
    assert.ok(Object.hasOwn(technician, "branch_name"));
    assert.ok(Object.hasOwn(technician, "department"));
  }

  const report = await fetch(`${baseUrl}/api/v1/analytics/custom-report`, { headers });
  assert.equal(report.status, 200);
  assert.ok(Array.isArray((await report.json()).data));

  const textExport = await fetch(`${baseUrl}/api/v1/analytics/custom-report/export?format=txt`, { headers });
  assert.equal(textExport.status, 200);
  assert.match(textExport.headers.get("content-type") || "", /text\/plain/);
  assert.match(await textExport.text(), /CUSTOM SERVICE DESK REPORT/);
});

test("custom reports reject invalid date ranges instead of returning a database error", async () => {
  const headers = { authorization: `Bearer ${tokenFor(superAdminUser)}` };
  const response = await fetch(
    `${baseUrl}/api/v1/analytics/custom-report?date_from=2026-08-04&date_to=2026-06-15`,
    { headers }
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /From date cannot be later/i);
});

test("custom report TXT exports identify the branch by name", async (t) => {
  const ticket = (await db.query(
    `SELECT t.branch_id,b.branch_name,t.status
       FROM tickets t JOIN branches b ON b.branch_id=t.branch_id
      ORDER BY t.created_at DESC LIMIT 1`
  )).rows[0];
  if (!ticket) return t.skip("No ticket exists for a report export fixture.");
  const headers = { authorization: `Bearer ${tokenFor(superAdminUser)}` };
  const params = new URLSearchParams({
    format: "txt",
    branch_id: String(ticket.branch_id),
    status: ticket.status,
  });
  const response = await fetch(`${baseUrl}/api/v1/analytics/custom-report/export?${params}`, { headers });
  assert.equal(response.status, 200);
  const output = await response.text();
  assert.match(output, new RegExp(ticket.branch_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.doesNotMatch(output, new RegExp(`Scope:\\s*Branch ID ${ticket.branch_id}`, "i"));
});

test("custom report Excel and PDF exports use the filtered report dataset", async (t) => {
  const ticket = (await db.query(
    `SELECT t.ticket_number,t.branch_id,t.status
       FROM tickets t
      ORDER BY t.created_at DESC LIMIT 1`
  )).rows[0];
  if (!ticket) return t.skip("No ticket exists for the report export fixture.");

  const headers = { authorization: `Bearer ${tokenFor(superAdminUser)}` };
  const filters = new URLSearchParams({
    branch_id: String(ticket.branch_id),
    status: ticket.status,
  });

  const reportResponse = await fetch(`${baseUrl}/api/v1/analytics/custom-report?${filters}`, { headers });
  assert.equal(reportResponse.status, 200);
  const reportRows = (await reportResponse.json()).data;
  assert.ok(reportRows.length > 0);
  assert.ok(reportRows.some((row) => row.ticket_number === ticket.ticket_number));
  assert.ok(reportRows.every((row) => String(row.branch_id) === String(ticket.branch_id)));
  assert.ok(reportRows.every((row) => row.status === ticket.status));

  const excelParams = new URLSearchParams(filters);
  excelParams.set("format", "excel");
  const excelResponse = await fetch(`${baseUrl}/api/v1/analytics/custom-report/export?${excelParams}`, { headers });
  assert.equal(excelResponse.status, 200);
  assert.match(excelResponse.headers.get("content-type") || "", /spreadsheetml/);
  const excelBytes = Buffer.from(await excelResponse.arrayBuffer());
  assert.equal(excelBytes.subarray(0, 2).toString("ascii"), "PK");

  const pdfParams = new URLSearchParams(filters);
  pdfParams.set("format", "pdf");
  const pdfResponse = await fetch(`${baseUrl}/api/v1/analytics/custom-report/export?${pdfParams}`, { headers });
  assert.equal(pdfResponse.status, 200);
  assert.match(pdfResponse.headers.get("content-type") || "", /application\/pdf/);
  const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
  assert.equal(pdfBytes.subarray(0, 5).toString("ascii"), "%PDF-");
});

test("custom report exports explain when no rows match", async () => {
  const headers = { authorization: `Bearer ${tokenFor(superAdminUser)}` };
  const response = await fetch(
    `${baseUrl}/api/v1/analytics/custom-report/export?format=pdf&date_from=2999-01-01&date_to=2999-01-02`,
    { headers }
  );
  assert.equal(response.status, 422);
  assert.match((await response.json()).message, /No records match/i);
});
