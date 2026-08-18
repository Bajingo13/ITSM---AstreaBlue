process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const db = require("../config/db");
const softwareLicenseRoutes = require("../src/routes/softwareLicenses");
const employeeLifecycleRoutes = require("../src/routes/employeeLifecycle");
const createHardwareAssetRoutes = require("../src/routes/hardwareAssets");
const { executeInternalOffboardingTask } = require("../src/services/internalOffboardingService");
const { getEmployeeTechnologyValue } = require("../src/services/employeeTechnologyValueService");

const secret = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
let server;
let baseUrl;
let branchId;
let createdBranchId;
let employeeId;
let shadowEmployeeId;
let superAdminId;
let assetId;
let deviceId;
let licenseId;
let directLicenseId;

function headers(userId, role, branchIdValue = null) {
  const token = jwt.sign({ userId, role, branchId: branchIdValue }, secret, { expiresIn: "5m" });
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

test.before(async () => {
  for (const fileName of [
    "2026-07-21-internal-offboarding-automation.sql",
    "2026-08-17-employee-technology-value.sql",
    "2026-08-17-software-license-reconciliation.sql",
    "2026-08-17-direct-license-assignment.sql",
    "2026-08-18-license-assignment-audit.sql",
    "2026-08-18-optional-onboarding-license-assignment.sql",
  ]) {
    await db.query(fs.readFileSync(path.join(__dirname, "..", "database", fileName), "utf8"));
  }
  let branch = await db.query("SELECT branch_id FROM branches ORDER BY branch_id LIMIT 1");
  if (!branch.rows.length) {
    branch = await db.query(
      "INSERT INTO branches(branch_name,branch_code,is_active) VALUES('License Reconciliation Test',$1,TRUE) RETURNING branch_id",
      [`LIC-REC-${Date.now()}`]
    );
    createdBranchId = branch.rows[0].branch_id;
  }
  branchId = branch.rows[0].branch_id;
  const roles = await db.query("SELECT role_id,LOWER(role_name) role FROM system_roles WHERE LOWER(role_name) IN ('employee','superadmin')");
  const roleMap = Object.fromEntries(roles.rows.map((row) => [row.role, row.role_id]));
  const suffix = Date.now();
  const employee = await db.query(
    `INSERT INTO users(full_name,email,password_hash,role_id,company_name,branch_id,status,is_active,onboarding_status,onboarding_required,employee_number)
     VALUES('Reconciliation Employee',$1,'test',$2,'AstreaBlue',$3,'Active',TRUE,'Completed',FALSE,$4) RETURNING user_id`,
    [`license-reconciliation-employee-${suffix}@example.test`, roleMap.employee, branchId, `REC-${suffix}`]
  );
  employeeId = employee.rows[0].user_id;
  const shadowEmployee = await db.query(
    `INSERT INTO users(full_name,email,password_hash,role_id,company_name,branch_id,status,is_active,onboarding_status,onboarding_required,employee_number)
     VALUES('Legacy Shadow Employee',$1,'test',$2,'AstreaBlue',$3,'Active',TRUE,'Completed',FALSE,$4) RETURNING user_id`,
    [`license-reconciliation-shadow-${suffix}@example.test`, roleMap.employee, branchId, `SHADOW-${suffix}`]
  );
  shadowEmployeeId = shadowEmployee.rows[0].user_id;
  const superAdmin = await db.query(
    `INSERT INTO users(full_name,email,password_hash,role_id,company_name,status,is_active,onboarding_status,onboarding_required)
     VALUES('Reconciliation SuperAdmin',$1,'test',$2,'AstreaBlue','Active',TRUE,'Completed',FALSE) RETURNING user_id`,
    [`license-reconciliation-admin-${suffix}@example.test`, roleMap.superadmin]
  );
  superAdminId = superAdmin.rows[0].user_id;
  const asset = await db.query(
    `INSERT INTO hardware_assets(asset_name,asset_type,serial_number,branch_id,status,purchase_price)
     VALUES('Reconciliation Laptop','Laptop',$1,$2,'In Stock',50000) RETURNING asset_id`,
    [`REC-ASSET-${suffix}`, branchId]
  );
  assetId = asset.rows[0].asset_id;
  const device = await db.query(
    `INSERT INTO monitored_devices(hostname,branch_id,asset_id,device_uuid,status)
     VALUES($1,$2,$3,$4,'Online') RETURNING device_id`,
    [`REC-ENDPOINT-${suffix}`, branchId, assetId, crypto.randomUUID()]
  );
  deviceId = device.rows[0].device_id;
  const license = await db.query(
    `INSERT INTO software_licenses(license_name,vendor,license_type,total_licenses,used_licenses,annual_cost,status,branch_id)
     VALUES($1,'AstreaBlue Vendor','Annual',10,3,120000,'Active',$2) RETURNING license_id`,
    [`Restored Aggregate License ${suffix}`, branchId]
  );
  licenseId = license.rows[0].license_id;
  const directLicense = await db.query(
    `INSERT INTO software_licenses(license_name,vendor,license_type,total_licenses,used_licenses,annual_cost,status,branch_id)
     VALUES($1,'AstreaBlue Vendor','Annual',5,0,30000,'Active',$2) RETURNING license_id`,
    [`Direct Employee License ${suffix}`, branchId]
  );
  directLicenseId = directLicense.rows[0].license_id;

  const app = express();
  app.use(express.json());
  app.use("/api/v1/software-licenses", softwareLicenseRoutes);
  app.use("/api/v1/employee-lifecycle", employeeLifecycleRoutes);
  app.use("/api/v1", createHardwareAssetRoutes({ tablesReady: Promise.resolve(true) }));
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (licenseId || directLicenseId) {
    await db.query("DELETE FROM software_licenses WHERE license_id=ANY($1::int[])", [[licenseId, directLicenseId].filter(Boolean)]);
  }
  if (deviceId) await db.query("DELETE FROM monitored_devices WHERE device_id=$1", [deviceId]);
  if (assetId) await db.query("DELETE FROM hardware_assets WHERE asset_id=$1", [assetId]);
  await db.query("DELETE FROM users WHERE user_id=ANY($1::int[])", [[employeeId, shadowEmployeeId, superAdminId].filter(Boolean)]);
  if (createdBranchId) await db.query("DELETE FROM branches WHERE branch_id=$1", [createdBranchId]);
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.rawPool.end();
});

test("restored aggregate usage is mapped without double-counting and releases during offboarding", async () => {
  const auth = headers(superAdminId, "SuperAdmin");
  let response = await fetch(`${baseUrl}/api/v1/hardware-assets/assignment-options?branch_id=${branchId}`, { headers: auth });
  assert.equal(response.status, 200);
  const options = (await response.json()).data;
  assert.ok(options.some((employee) => Number(employee.user_id) === Number(employeeId)));

  response = await fetch(`${baseUrl}/api/v1/hardware-assets/${assetId}/status`, {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({
      status: "Borrowed",
      assigned_to: employeeId,
      borrow_date: "2026-08-17",
      expected_return_date: "2026-12-31",
    }),
  });
  const borrowBody = await response.text();
  assert.equal(response.status, 200, borrowBody);
  const [borrowedAsset, assignedDevice] = await Promise.all([
    db.query("SELECT assigned_to,employee_id,borrower_name,status FROM hardware_assets WHERE asset_id=$1", [assetId]),
    db.query("SELECT assigned_user_id FROM monitored_devices WHERE device_id=$1", [deviceId]),
  ]);
  assert.equal(Number(borrowedAsset.rows[0].assigned_to), Number(employeeId));
  assert.equal(borrowedAsset.rows[0].status, "Borrowed");
  assert.equal(Number(assignedDevice.rows[0].assigned_user_id), Number(employeeId));

  // Canonical assignment must win over stale legacy free-text ownership.
  await db.query("UPDATE hardware_assets SET employee_id=$1 WHERE asset_id=$2", [String(shadowEmployeeId), assetId]);
  const shadowValue = await getEmployeeTechnologyValue(db, { employeeId: shadowEmployeeId, branchId });
  assert.equal(Number(shadowValue.totals.asset_value), 0);

  response = await fetch(`${baseUrl}/api/v1/software-licenses`, { headers: auth });
  assert.equal(response.status, 200);
  const listed = (await response.json()).data.find((license) => Number(license.license_id) === Number(licenseId));
  assert.equal(Number(listed.used_licenses), 3);
  assert.equal(Number(listed.tracked_assignments), 0);
  assert.equal(Number(listed.unlinked_used_licenses), 3);

  response = await fetch(`${baseUrl}/api/v1/software-licenses/${licenseId}/reconcile`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ user_id: employeeId, asset_id: assetId }),
  });
  const reconciliationBody = await response.text();
  assert.equal(response.status, 201, reconciliationBody);
  const reconciliation = JSON.parse(reconciliationBody).data;
  assert.equal(reconciliation.used_licenses, 3);
  assert.equal(reconciliation.tracked_assignments, 1);
  assert.equal(reconciliation.unlinked_used_licenses, 2);

  response = await fetch(`${baseUrl}/api/v1/software-licenses/${licenseId}/reconciliation`, { headers: auth });
  assert.equal(response.status, 200);
  const seatAudit = (await response.json()).data;
  assert.equal(seatAudit.assignments[0].full_name, "Reconciliation Employee");
  assert.equal(seatAudit.assignments[0].assigned_by_name, "Reconciliation SuperAdmin");
  assert.ok(seatAudit.assignments[0].assigned_at);
  assert.equal(seatAudit.assignment_history[0].assignment_source, "Reconciliation");

  const assignment = await db.query(
    "SELECT status,assignment_source,asset_id,seat_annual_cost_snapshot FROM software_license_assignments WHERE license_id=$1 AND user_id=$2",
    [licenseId, employeeId]
  );
  assert.equal(assignment.rows[0].status, "Active");
  assert.equal(assignment.rows[0].assignment_source, "Reconciliation");
  assert.equal(Number(assignment.rows[0].asset_id), Number(assetId));
  assert.equal(Number(assignment.rows[0].seat_annual_cost_snapshot), 12000);
  const technologyValue = await getEmployeeTechnologyValue(db, { employeeId, branchId });
  assert.equal(Number(technologyValue.totals.asset_value), 50000);
  assert.equal(Number(technologyValue.totals.annual_software_cost), 12000);
  assert.equal(Number(technologyValue.totals.first_year_assigned_value), 62000);

  response = await fetch(`${baseUrl}/api/v1/employee-lifecycle/technology-values/${employeeId}/license-assignments`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ license_ids: [directLicenseId], asset_id: null }),
  });
  const directBody = await response.text();
  assert.equal(response.status, 201, directBody);
  const directValue = JSON.parse(directBody).data;
  assert.equal(Number(directValue.totals.annual_software_cost), 18000);
  assert.equal(Number(directValue.totals.first_year_assigned_value), 68000);
  const directHistory = directValue.assignment_history.find(
    (item) => Number(item.license_id) === Number(directLicenseId)
  );
  assert.equal(directHistory.status, "Active");
  assert.equal(directHistory.assignment_source, "Direct");
  assert.equal(directHistory.asset_id, null);
  assert.equal(directHistory.assigned_by_name, "Reconciliation SuperAdmin");

  response = await fetch(`${baseUrl}/api/v1/hardware-assets/${assetId}/status`, {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({ status: "In Stock", actual_return_date: "2026-08-17" }),
  });
  assert.equal(response.status, 200, await response.text());
  const [returnedAsset, unassignedDevice, detachedAssignment] = await Promise.all([
    db.query("SELECT assigned_to,employee_id,borrower_name,status FROM hardware_assets WHERE asset_id=$1", [assetId]),
    db.query("SELECT assigned_user_id FROM monitored_devices WHERE device_id=$1", [deviceId]),
    db.query("SELECT status,asset_id FROM software_license_assignments WHERE license_id=$1 AND user_id=$2", [licenseId, employeeId]),
  ]);
  assert.equal(returnedAsset.rows[0].assigned_to, null);
  assert.equal(returnedAsset.rows[0].employee_id, null);
  assert.equal(returnedAsset.rows[0].borrower_name, null);
  assert.equal(returnedAsset.rows[0].status, "In Stock");
  assert.equal(unassignedDevice.rows[0].assigned_user_id, null);
  assert.equal(detachedAssignment.rows[0].status, "Active");
  assert.equal(detachedAssignment.rows[0].asset_id, null);

  response = await fetch(`${baseUrl}/api/v1/software-licenses/${licenseId}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      license_name: listed.license_name,
      vendor: listed.vendor,
      license_type: listed.license_type,
      total_licenses: 10,
      used_licenses: 0,
      annual_cost: 120000,
      branch_id: branchId,
    }),
  });
  assert.equal(response.status, 409);

  await executeInternalOffboardingTask({
    queryable: db,
    lifecycleCase: { lifecycle_case_id: 0, lifecycle_type: "Offboarding", case_number: "OFF-RECONCILIATION" },
    task: { task_key: "audit_licenses" },
    employee: { user_id: employeeId, full_name: "Reconciliation Employee" },
    actor: { user_id: superAdminId },
  });
  const [released, licenseAfter, directLicenseAfter] = await Promise.all([
    db.query("SELECT status,released_at FROM software_license_assignments WHERE license_id=$1 AND user_id=$2", [licenseId, employeeId]),
    db.query("SELECT used_licenses FROM software_licenses WHERE license_id=$1", [licenseId]),
    db.query("SELECT used_licenses FROM software_licenses WHERE license_id=$1", [directLicenseId]),
  ]);
  assert.equal(released.rows[0].status, "Released");
  assert.ok(released.rows[0].released_at);
  assert.equal(Number(licenseAfter.rows[0].used_licenses), 2);
  assert.equal(Number(directLicenseAfter.rows[0].used_licenses), 0);

  response = await fetch(`${baseUrl}/api/v1/employee-lifecycle/technology-values/${employeeId}`, { headers: auth });
  assert.equal(response.status, 200);
  const releasedAudit = (await response.json()).data.assignment_history.find(
    (item) => Number(item.license_id) === Number(licenseId)
  );
  assert.equal(releasedAudit.status, "Released");
  assert.equal(releasedAudit.assigned_by_name, "Reconciliation SuperAdmin");
  assert.equal(releasedAudit.released_by_name, "Reconciliation SuperAdmin");
  assert.ok(releasedAudit.released_at);

  await db.query("UPDATE users SET is_active=FALSE WHERE user_id=$1", [employeeId]);
  response = await fetch(`${baseUrl}/api/v1/employee-lifecycle/technology-values/${employeeId}/license-assignments`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ license_ids: [directLicenseId] }),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).message, /Inactive employees/);

});
