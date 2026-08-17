function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function calculateSeatAnnualCost(annualCost, totalLicenses) {
  const cost = Number(annualCost) || 0;
  const seats = Number(totalLicenses) || 0;
  return seats > 0 ? Number((cost / seats).toFixed(2)) : 0;
}

function summarizeTechnologyValue(assets, assignments) {
  const assetValue = assets.reduce((sum, asset) => sum + (Number(asset.purchase_price) || 0), 0);
  const annualSoftwareCost = assignments.reduce(
    (sum, assignment) => sum + (
      Number(assignment.seat_annual_cost_snapshot ?? assignment.annual_seat_cost)
      || calculateSeatAnnualCost(assignment.annual_cost, assignment.total_licenses)
    ),
    0
  );
  return {
    asset_value: Number(assetValue.toFixed(2)),
    annual_software_cost: Number(annualSoftwareCost.toFixed(2)),
    first_year_assigned_value: Number((assetValue + annualSoftwareCost).toFixed(2)),
  };
}

async function listEmployeeTechnologyValues(queryable, { branchId = null } = {}) {
  const params = [];
  const branchClause = branchId
    ? (params.push(Number(branchId)), `AND u.branch_id=$${params.length}`)
    : "";
  const result = await queryable.query(
    `SELECT u.user_id,u.full_name,u.employee_number,u.department,u.branch_id,u.is_active,
            b.branch_name,
            COALESCE(asset_value.asset_count,0)::int asset_count,
            COALESCE(asset_value.asset_value,0)::numeric(14,2) asset_value,
            COALESCE(software_value.license_count,0)::int license_count,
            COALESCE(software_value.annual_software_cost,0)::numeric(14,2) annual_software_cost,
            (COALESCE(asset_value.asset_value,0)+COALESCE(software_value.annual_software_cost,0))::numeric(14,2) first_year_assigned_value
       FROM users u
       JOIN system_roles role ON role.role_id=u.role_id
       JOIN branches b ON b.branch_id=u.branch_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int asset_count,COALESCE(SUM(asset.purchase_price),0) asset_value
           FROM hardware_assets asset
          WHERE asset.assigned_to=u.user_id
             OR (asset.assigned_to IS NULL AND (
                  asset.employee_id=u.user_id::text
                  OR (COALESCE(u.employee_number,'')<>'' AND asset.employee_id=u.employee_number)
                ))
       ) asset_value ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int license_count,
                COALESCE(SUM(CASE
                  WHEN assignment.seat_annual_cost_snapshot>0 THEN assignment.seat_annual_cost_snapshot
                  WHEN license.total_licenses>0 THEN ROUND(license.annual_cost/license.total_licenses,2)
                  ELSE 0
                END),0) annual_software_cost
           FROM software_license_assignments assignment
           JOIN software_licenses license ON license.license_id=assignment.license_id
          WHERE assignment.user_id=u.user_id AND assignment.status='Active'
       ) software_value ON TRUE
      WHERE LOWER(role.role_name)='employee' ${branchClause}
      ORDER BY first_year_assigned_value DESC,u.full_name`,
    params
  );
  const employees = result.rows;
  return {
    employees,
    totals: {
      employee_count: employees.length,
      asset_count: employees.reduce((sum, employee) => sum + Number(employee.asset_count || 0), 0),
      license_count: employees.reduce((sum, employee) => sum + Number(employee.license_count || 0), 0),
      asset_value: Number(employees.reduce((sum, employee) => sum + Number(employee.asset_value || 0), 0).toFixed(2)),
      annual_software_cost: Number(employees.reduce((sum, employee) => sum + Number(employee.annual_software_cost || 0), 0).toFixed(2)),
      first_year_assigned_value: Number(employees.reduce((sum, employee) => sum + Number(employee.first_year_assigned_value || 0), 0).toFixed(2)),
    },
  };
}

async function loadEmployee(queryable, employeeId, branchId = null) {
  const params = [Number(employeeId)];
  const branchClause = branchId ? (params.push(Number(branchId)), `AND u.branch_id=$${params.length}`) : "";
  const result = await queryable.query(
    `SELECT u.user_id,u.full_name,u.email,u.employee_number,u.department,u.branch_id,u.is_active,b.branch_name
       FROM users u
       LEFT JOIN branches b ON b.branch_id=u.branch_id
      WHERE u.user_id=$1 ${branchClause}
      LIMIT 1`,
    params
  );
  return result.rows[0] || null;
}

async function loadAssignedAssets(queryable, employee, { lock = false } = {}) {
  const employeeNumber = String(employee.employee_number || "").trim();
  return queryable.query(
    `SELECT asset_id,asset_tag,asset_name,brand,model,serial_number,status,purchase_price,branch_id
       FROM hardware_assets
      WHERE assigned_to=$1
         OR (assigned_to IS NULL AND (
              employee_id=$1::text
              OR ($2::text<>'' AND employee_id=$2::text)
            ))
      ORDER BY asset_name,asset_tag${lock ? " FOR UPDATE" : ""}`,
    [employee.user_id, employeeNumber]
  );
}

async function getEmployeeTechnologyValue(queryable, { employeeId, branchId = null }) {
  const employee = await loadEmployee(queryable, employeeId, branchId);
  if (!employee) throw httpError(404, "Employee not found in the authorized branch.");

  const [assetResult, assignmentResult, historyResult, availableResult] = await Promise.all([
    loadAssignedAssets(queryable, employee),
    queryable.query(
      `SELECT assignment.assignment_id,assignment.license_id,assignment.asset_id,
              assignment.assigned_at,assignment.lifecycle_case_id,
              license.license_name,license.vendor,license.license_type,
              license.annual_cost,license.total_licenses,license.expiry_date,
              assignment.annual_cost_snapshot,assignment.seat_annual_cost_snapshot,
              asset.asset_tag,asset.asset_name,
              CASE WHEN license.total_licenses>0
                   THEN ROUND(license.annual_cost/license.total_licenses,2)
                   ELSE 0 END AS annual_seat_cost
         FROM software_license_assignments assignment
         JOIN software_licenses license ON license.license_id=assignment.license_id
         LEFT JOIN hardware_assets asset ON asset.asset_id=assignment.asset_id
        WHERE assignment.user_id=$1 AND assignment.status='Active'
        ORDER BY license.license_name`,
      [employee.user_id]
    ),
    queryable.query(
      `SELECT assignment.assignment_id,assignment.license_id,assignment.asset_id,
              assignment.status,assignment.assignment_source,assignment.assigned_at,
              assignment.released_at,assignment.release_reason,
              assignment.seat_annual_cost_snapshot,
              license.license_name,license.vendor,
              asset.asset_tag,asset.asset_name
         FROM software_license_assignments assignment
         JOIN software_licenses license ON license.license_id=assignment.license_id
         LEFT JOIN hardware_assets asset ON asset.asset_id=assignment.asset_id
        WHERE assignment.user_id=$1
        ORDER BY assignment.assigned_at DESC,assignment.assignment_id DESC`,
      [employee.user_id]
    ),
    queryable.query(
      `SELECT license_id,license_name,vendor,license_type,total_licenses,used_licenses,
              GREATEST(total_licenses-used_licenses,0)::int available_licenses,
              annual_cost,expiry_date,
              CASE WHEN total_licenses>0 THEN ROUND(annual_cost/total_licenses,2) ELSE 0 END annual_seat_cost
         FROM software_licenses
        WHERE branch_id=$1
          AND total_licenses>used_licenses
          AND (expiry_date IS NULL OR expiry_date>=CURRENT_DATE)
          AND NOT EXISTS (
            SELECT 1 FROM software_license_assignments assignment
             WHERE assignment.license_id=software_licenses.license_id
               AND assignment.user_id=$2
               AND assignment.status='Active'
          )
        ORDER BY license_name`,
      [employee.branch_id, employee.user_id]
    ),
  ]);

  return {
    employee,
    assets: assetResult.rows,
    assignments: assignmentResult.rows,
    assignment_history: historyResult.rows,
    available_licenses: availableResult.rows,
    totals: summarizeTechnologyValue(assetResult.rows, assignmentResult.rows),
  };
}

async function assignEmployeeLicenses(queryable, {
  lifecycleCase,
  employee,
  actor,
  assetId,
  licenseIds,
  noLicenseRequired = false,
  requireAsset = true,
  assignmentSource = "Lifecycle",
}) {
  const normalizedLicenseIds = [...new Set((licenseIds || []).map(Number).filter(Number.isInteger))]
    .sort((left, right) => left - right);
  if (!normalizedLicenseIds.length) {
    if (!noLicenseRequired) throw httpError(400, "Select at least one software license or confirm that none is required.");
    return { action: "no_software_license_required", affected: 0, assignmentIds: [], licenseIds: [] };
  }

  const assignmentBranchId = Number(lifecycleCase?.branch_id || employee.branch_id);
  let asset = null;
  if (assetId || requireAsset) {
    const assets = await loadAssignedAssets(queryable, employee, { lock: true });
    asset = assets.rows.find((candidate) => Number(candidate.asset_id) === Number(assetId));
    if (!asset) throw httpError(400, "Select an asset currently assigned to this employee.");
    if (Number(asset.branch_id) !== assignmentBranchId) {
      throw httpError(403, "The assigned asset is outside the employee branch.");
    }
  }

  const licenseResult = await queryable.query(
    `SELECT license_id,license_name,total_licenses,used_licenses,annual_cost,branch_id
       FROM software_licenses
      WHERE license_id=ANY($1::int[])
      FOR UPDATE`,
    [normalizedLicenseIds]
  );
  if (licenseResult.rowCount !== normalizedLicenseIds.length) throw httpError(404, "One or more selected software licenses no longer exist.");

  const existing = await queryable.query(
    `SELECT license_id FROM software_license_assignments
      WHERE user_id=$1 AND license_id=ANY($2::int[]) AND status='Active'`,
    [employee.user_id, normalizedLicenseIds]
  );
  if (existing.rowCount) throw httpError(409, "The employee already has one or more selected licenses.");

  const assignmentIds = [];
  for (const license of licenseResult.rows) {
    if (Number(license.branch_id) !== assignmentBranchId) {
      throw httpError(403, `${license.license_name} is outside the employee branch.`);
    }
    if (Number(license.used_licenses) >= Number(license.total_licenses)) {
      throw httpError(409, `${license.license_name} has no available seats.`);
    }
    const seatCost = calculateSeatAnnualCost(license.annual_cost, license.total_licenses);
    const inserted = await queryable.query(
      `INSERT INTO software_license_assignments
         (license_id,user_id,asset_id,lifecycle_case_id,assigned_by,
          annual_cost_snapshot,seat_annual_cost_snapshot,status,assignment_source)
       VALUES($1,$2,$3,$4,$5,$6,$7,'Active',$8)
       RETURNING assignment_id`,
      [license.license_id, employee.user_id, asset?.asset_id || null, lifecycleCase?.lifecycle_case_id || null,
        actor.user_id, Number(license.annual_cost) || 0, seatCost, assignmentSource]
    );
    assignmentIds.push(Number(inserted.rows[0].assignment_id));
    await queryable.query(
      `UPDATE software_licenses
          SET used_licenses=used_licenses+1,updated_at=CURRENT_TIMESTAMP
        WHERE license_id=$1`,
      [license.license_id]
    );
  }

  return {
    action: "software_licenses_assigned",
    affected: assignmentIds.length,
    assignmentIds,
    licenseIds: normalizedLicenseIds,
    assetId: asset ? Number(asset.asset_id) : null,
  };
}

module.exports = {
  assignEmployeeLicenses,
  calculateSeatAnnualCost,
  getEmployeeTechnologyValue,
  listEmployeeTechnologyValues,
  loadAssignedAssets,
  loadEmployee,
  summarizeTechnologyValue,
};
