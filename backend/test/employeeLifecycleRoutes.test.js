process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const fs = require("node:fs");
const path = require("node:path");
const db = require("../config/db");
const employeeLifecycleRoutes = require("../src/routes/employeeLifecycle");

const secret = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
let server;
let baseUrl;
let branchId;
let employeeId;
let hrId;
let superAdminId;
let caseId;

function authHeaders(userId, role, branch) {
  const token = jwt.sign({ userId, role, branchId: branch || null }, secret, { expiresIn: "5m" });
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

test.before(async () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "database", "2026-07-21-employee-lifecycle-foundation.sql"), "utf8");
  await db.query(migration);
  const branch = await db.query(`SELECT branch_id FROM branches ORDER BY branch_id LIMIT 1`);
  assert.ok(branch.rows[0]?.branch_id);
  branchId = branch.rows[0].branch_id;
  const roles = await db.query(`SELECT role_id,LOWER(role_name) role FROM system_roles WHERE LOWER(role_name) IN ('employee','hr','superadmin')`);
  const roleMap = Object.fromEntries(roles.rows.map((row) => [row.role, row.role_id]));
  assert.ok(roleMap.employee && roleMap.hr && roleMap.superadmin);
  const suffix = Date.now();
  const employee = await db.query(
    `INSERT INTO users(full_name,email,password_hash,role_id,company_name,branch_id,status,is_active,onboarding_status,onboarding_required)
     VALUES('Lifecycle Employee',$1,'test',$2,'AstreaBlue',$3,'Active',TRUE,'Completed',FALSE) RETURNING user_id`,
    [`lifecycle-employee-${suffix}@example.test`, roleMap.employee, branchId]
  );
  employeeId = employee.rows[0].user_id;
  const hr = await db.query(
    `INSERT INTO users(full_name,email,password_hash,role_id,company_name,branch_id,status,is_active,onboarding_status,onboarding_required)
     VALUES('Lifecycle HR',$1,'test',$2,'AstreaBlue',$3,'Active',TRUE,'Completed',FALSE) RETURNING user_id`,
    [`lifecycle-hr-${suffix}@example.test`, roleMap.hr, branchId]
  );
  hrId = hr.rows[0].user_id;
  const superAdmin = await db.query(
    `INSERT INTO users(full_name,email,password_hash,role_id,company_name,status,is_active,onboarding_status,onboarding_required)
     VALUES('Lifecycle SuperAdmin',$1,'test',$2,'AstreaBlue','Active',TRUE,'Completed',FALSE) RETURNING user_id`,
    [`lifecycle-super-${suffix}@example.test`, roleMap.superadmin]
  );
  superAdminId = superAdmin.rows[0].user_id;
  const app = express();
  app.use(express.json());
  app.use("/api/v1/employee-lifecycle", employeeLifecycleRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (caseId) await db.query(`DELETE FROM employee_lifecycle_cases WHERE lifecycle_case_id=$1`, [caseId]);
  await db.query(`DELETE FROM users WHERE user_id=ANY($1::int[])`, [[employeeId, hrId, superAdminId].filter(Boolean)]);
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.rawPool.end();
});

test("HR creates a branch-scoped onboarding case with a complete template", async () => {
  const response = await fetch(`${baseUrl}/api/v1/employee-lifecycle/cases`, {
    method: "POST",
    headers: authHeaders(hrId, "HR", branchId),
    body: JSON.stringify({ lifecycle_type: "Onboarding", employee_id: employeeId }),
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  caseId = payload.data.lifecycle_case_id;
  assert.match(payload.data.case_number, /^ONB-\d{8}-\d{4}$/);

  const details = await fetch(`${baseUrl}/api/v1/employee-lifecycle/cases/${caseId}`, {
    headers: authHeaders(hrId, "HR", branchId),
  });
  assert.equal(details.status, 200);
  const data = (await details.json()).data;
  assert.equal(data.tasks.length, 9);
  assert.equal(data.required_pending_count, 9);
});

test("HR can oversee IT tasks but cannot falsely complete them", async () => {
  const details = await fetch(`${baseUrl}/api/v1/employee-lifecycle/cases/${caseId}`, {
    headers: authHeaders(hrId, "HR", branchId),
  });
  const task = (await details.json()).data.tasks.find((item) => item.assigned_role === "IT");
  const response = await fetch(`${baseUrl}/api/v1/employee-lifecycle/cases/${caseId}/tasks/${task.lifecycle_task_id}`, {
    method: "PATCH",
    headers: authHeaders(hrId, "HR", branchId),
    body: JSON.stringify({ status: "Completed" }),
  });
  assert.equal(response.status, 403);
});

test("required tasks block completion until an authorized administrator finishes verification", async () => {
  const headers = authHeaders(superAdminId, "SuperAdmin", null);
  let response = await fetch(`${baseUrl}/api/v1/employee-lifecycle/cases/${caseId}/status`, {
    method: "PATCH", headers, body: JSON.stringify({ status: "In Progress" }),
  });
  assert.equal(response.status, 200);
  response = await fetch(`${baseUrl}/api/v1/employee-lifecycle/cases/${caseId}/status`, {
    method: "PATCH", headers, body: JSON.stringify({ status: "Ready for Verification" }),
  });
  assert.equal(response.status, 200);
  response = await fetch(`${baseUrl}/api/v1/employee-lifecycle/cases/${caseId}/status`, {
    method: "PATCH", headers, body: JSON.stringify({ status: "Completed" }),
  });
  assert.equal(response.status, 409);

  const details = await fetch(`${baseUrl}/api/v1/employee-lifecycle/cases/${caseId}`, { headers });
  for (const task of (await details.json()).data.tasks) {
    const taskResponse = await fetch(`${baseUrl}/api/v1/employee-lifecycle/cases/${caseId}/tasks/${task.lifecycle_task_id}`, {
      method: "PATCH", headers, body: JSON.stringify({ status: "Completed" }),
    });
    assert.equal(taskResponse.status, 200);
  }
  response = await fetch(`${baseUrl}/api/v1/employee-lifecycle/cases/${caseId}/status`, {
    method: "PATCH", headers, body: JSON.stringify({ status: "Completed" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.status, "Completed");
});

