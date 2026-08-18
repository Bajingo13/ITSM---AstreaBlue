process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const inviteRoutes = require("../src/routes/invites");
const softwareLicenseRoutes = require("../src/routes/softwareLicenses");
const softwareRepository = require("../src/repositories/softwareLicenseRepository");

const secret = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
let server;
let baseUrl;
let branchOneId;
let branchTwoId;
let superAdminId;
let adminId;
let employeeId;
let technicianRoleId;

function tokenFor(userId, role = "SuperAdmin", branchId = null) {
  return jwt.sign({ userId, role, branchId }, secret, { expiresIn: "5m" });
}

test.before(async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const roles = await db.query(
    `SELECT role_id,LOWER(role_name) role_name FROM system_roles
      WHERE LOWER(role_name)=ANY($1::text[])`,
    [["superadmin", "admin", "employee", "technician"]]
  );
  const roleIds = Object.fromEntries(roles.rows.map((role) => [role.role_name, role.role_id]));
  assert.ok(roleIds.superadmin && roleIds.admin && roleIds.employee && roleIds.technician);
  technicianRoleId = roleIds.technician;

  const branches = await db.query(
    `INSERT INTO branches(branch_name,branch_location,is_active,is_headquarters)
     VALUES($1,'QA',TRUE,FALSE),($2,'QA',TRUE,FALSE)
     RETURNING branch_id`,
    [`QA RBAC One ${suffix}`, `QA RBAC Two ${suffix}`]
  );
  [branchOneId, branchTwoId] = branches.rows.map((row) => Number(row.branch_id));

  const users = await db.query(
    `INSERT INTO users(full_name,email,password_hash,role_id,company_name,branch_id,status,is_active)
     VALUES
       ($1,$2,'disabled-test-password',$3,'AstreaBlue',NULL,'Active',TRUE),
       ($4,$5,'disabled-test-password',$6,'AstreaBlue',$7,'Active',TRUE),
       ($8,$9,'disabled-test-password',$10,'AstreaBlue',$7,'Active',TRUE)
     RETURNING user_id`,
    [
      `QA SuperAdmin ${suffix}`, `qa-super-${suffix}@example.test`, roleIds.superadmin,
      `QA Admin ${suffix}`, `qa-admin-${suffix}@example.test`, roleIds.admin, branchOneId,
      `QA Employee ${suffix}`, `qa-employee-${suffix}@example.test`, roleIds.employee,
    ]
  );
  [superAdminId, adminId, employeeId] = users.rows.map((row) => Number(row.user_id));

  const app = express();
  app.use(express.json());
  app.use("/api/v1/invites", inviteRoutes);
  app.use("/api/v1/software-licenses", softwareLicenseRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (branchOneId) {
    await db.query("DELETE FROM users WHERE branch_id=ANY($1::int[])", [[branchOneId, branchTwoId]]);
  }
  if (superAdminId) {
    await db.query("DELETE FROM users WHERE user_id=ANY($1::int[])", [[superAdminId, adminId, employeeId]]);
  }
  if (branchOneId) {
    await db.query("DELETE FROM branches WHERE branch_id=ANY($1::int[])", [[branchOneId, branchTwoId]]);
  }
  await db.rawPool.end();
});

test("management routes reject anonymous requests", async () => {
  const [invites, licenses] = await Promise.all([
    fetch(`${baseUrl}/api/v1/invites`),
    fetch(`${baseUrl}/api/v1/software-licenses`),
  ]);
  assert.equal(invites.status, 401);
  assert.equal(licenses.status, 401);
});

test("current database role overrides a forged invite-management claim", async () => {
  const response = await fetch(`${baseUrl}/api/v1/invites`, {
    headers: { authorization: `Bearer ${tokenFor(employeeId, "SuperAdmin")}` },
  });
  assert.equal(response.status, 403);
});

test("branch administrators cannot create invitations for another branch", async () => {
  const response = await fetch(`${baseUrl}/api/v1/invites`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokenFor(adminId, "SuperAdmin", branchTwoId)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      full_name: "Cross Branch QA",
      personal_email: `cross-branch-personal-${Date.now()}@example.test`,
      company_email: `cross-branch-${Date.now()}@example.test`,
      role_id: technicianRoleId,
      branch_id: branchTwoId,
    }),
  });
  assert.equal(response.status, 403);
});

test("software license accounting rejects impossible totals and costs", async () => {
  const originalCreate = softwareRepository.create;
  let createCalled = false;
  softwareRepository.create = async () => {
    createCalled = true;
    return { rows: [] };
  };
  try {
    const headers = {
      authorization: `Bearer ${tokenFor(superAdminId)}`,
      "content-type": "application/json",
    };
    const overAllocated = await fetch(`${baseUrl}/api/v1/software-licenses`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        license_name: "QA License",
        vendor: "QA Vendor",
        license_type: "Subscription",
        total_licenses: 2,
        used_licenses: 3,
        annual_cost: 100,
        branch_id: branchOneId,
      }),
    });
    assert.equal(overAllocated.status, 400);

    const negativeCost = await fetch(`${baseUrl}/api/v1/software-licenses`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        license_name: "QA License",
        vendor: "QA Vendor",
        license_type: "Subscription",
        total_licenses: 2,
        used_licenses: 1,
        annual_cost: -1,
        branch_id: branchOneId,
      }),
    });
    assert.equal(negativeCost.status, 400);
    assert.equal(createCalled, false);
  } finally {
    softwareRepository.create = originalCreate;
  }
});
