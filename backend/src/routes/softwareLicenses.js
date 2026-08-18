const express = require("express");
const {
  getAuthFromRequest,
} = require("../middleware/legacyJwtAuth");
const repository = require("../repositories/softwareLicenseRepository");
const {
  computeSoftwareLicenseStatus,
  validateLicenseRenewal,
} = require("../services/softwareLicenseRenewalService");
const { protectWorkbook } = require("../services/excelProtectionService");
const { requireCurrentRoles } = require("../middleware/currentActor");

const router = express.Router();

function normalizeRole(role) {
  return String(role || "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function parseBranchId(value) {
  if (value === undefined || value === null || value === "") return null;
  if (["all", "undefined", "null"].includes(String(value).toLowerCase())) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function getScope(req) {
  const auth = req.currentActor || getAuthFromRequest(req);
  if (!auth) return { unauthorized: true };

  const user = {
    userId: auth.userId || auth.id || null,
    role: normalizeRole(auth.role),
    branchId: parseBranchId(auth.branchId),
  };

  if (user.role === "superadmin") {
    return {
      user,
      branchId: parseBranchId(
        req.query.branch_id || req.query.filter_branch_id
      ),
      canSeeAll: true,
    };
  }

  if (user.role === "admin") {
    if (!user.branchId) return { forbidden: true };
    return { user, branchId: user.branchId, canSeeAll: false };
  }

  return { forbidden: true };
}

function requireScope(req, res) {
  const scope = getScope(req);
  if (scope.unauthorized) {
    res
      .status(401)
      .json({ success: false, error: "Authentication required." });
    return null;
  }
  if (scope.forbidden) {
    res.status(403).json({
      success: false,
      error: "Access denied for your role or branch.",
    });
    return null;
  }
  return scope;
}

function canManage(scope, licenseBranchId) {
  if (!scope?.user) return false;
  if (scope.user.role === "superadmin") return true;
  return (
    scope.user.role === "admin" &&
    Number(scope.user.branchId) === Number(licenseBranchId)
  );
}

function parseLicenseId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function validateLicenseFields({ licenseName, vendor, licenseType, totalCount, usedCount, annualCost, expiryDate }) {
  if (![licenseName, vendor, licenseType].every((value) => String(value || "").trim())) {
    return "License name, vendor, and type are required.";
  }
  if (!Number.isInteger(totalCount) || !Number.isInteger(usedCount) || totalCount < 0 || usedCount < 0) {
    return "License totals must be valid non-negative whole numbers.";
  }
  if (usedCount > totalCount) return "Used licenses cannot exceed total licenses.";
  if (!Number.isFinite(annualCost) || annualCost < 0) {
    return "Annual cost must be a valid non-negative number.";
  }
  if (expiryDate) {
    const text = String(expiryDate);
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? new Date(`${text}T00:00:00.000Z`)
      : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
      return "Expiry date must be a valid date in YYYY-MM-DD format.";
    }
  }
  return null;
}

router.use(requireCurrentRoles("superadmin", "admin"));

router.get("/", async (req, res) => {
  try {
    const scope = requireScope(req, res);
    if (!scope) return;
    const result = await repository.list(scope.branchId);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Fetch software licenses error:", error.message);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch software licenses." });
  }
});

router.get("/export", async (req, res) => {
  try {
    const scope = requireScope(req, res);
    if (!scope) return;

    const result = await repository.list(scope.branchId, {
      alphabetical: true,
    });
    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "No software licenses found for export.",
      });
    }

    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "AstreaBlue ITSM";
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet("Software Licenses");

    const headers = [
      "License Name",
      "Vendor",
      "Branch",
      "Type",
      "Total Licenses",
      "Used Licenses",
      "Available Licenses",
      "Utilization",
      "Expiry Date",
      "Annual Cost",
      "Status",
    ];
    const keys = [
      "license_name",
      "vendor",
      "branch_name",
      "license_type",
      "total_licenses",
      "used_licenses",
      "available_licenses",
      "utilization",
      "expiry_date",
      "annual_cost",
      "status",
    ];
    const widths = [30, 22, 18, 18, 16, 16, 18, 14, 16, 16, 16];
    worksheet.columns = headers.map((header, index) => ({
      header,
      key: keys[index],
      width: widths[index],
    }));

    const border = {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
    worksheet.getRow(1).eachCell((cell) => {
      cell.style = {
        font: { bold: true, color: { argb: "FFFFFFFF" }, size: 11 },
        fill: {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF1E40AF" },
        },
        alignment: { vertical: "middle", horizontal: "center" },
        border,
      };
    });
    worksheet.views = [{ state: "frozen", ySplit: 1 }];

    const formatDate = (value) =>
      value ? new Date(value).toLocaleDateString("en-PH") : "";
    const formatCurrency = (value) =>
      value == null
        ? ""
        : Number(value).toLocaleString("en-PH", {
            minimumFractionDigits: 2,
          });

    result.rows.forEach((license) => {
      const total = Number(license.total_licenses) || 0;
      const used = Number(license.used_licenses) || 0;
      const row = worksheet.addRow({
        license_name: license.license_name,
        vendor: license.vendor || "",
        branch_name: license.branch_name || "",
        license_type: license.license_type || "",
        total_licenses: total,
        used_licenses: used,
        available_licenses: Math.max(total - used, 0),
        utilization:
          total > 0 ? `${((used / total) * 100).toFixed(1)}%` : "0%",
        expiry_date: formatDate(license.expiry_date),
        annual_cost: formatCurrency(license.annual_cost),
        status: license.status || "Active",
      });
      row.eachCell((cell) => {
        cell.style = {
          alignment: { vertical: "middle" },
          border: {
            top: { style: "thin", color: { argb: "FFE2E8F0" } },
            bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
            left: { style: "thin", color: { argb: "FFE2E8F0" } },
            right: { style: "thin", color: { argb: "FFE2E8F0" } },
          },
        };
      });
    });

    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: worksheet.rowCount, column: headers.length },
    };
    await protectWorkbook(workbook);

    const output = Buffer.from(await workbook.xlsx.writeBuffer());
    const filename = `software-licenses-${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    return res.end(output);
  } catch (error) {
    console.error("Export software licenses error:", error.message);
    return res
      .status(500)
      .json({ success: false, error: "Failed to export software licenses." });
  }
});

router.get("/summary", async (req, res) => {
  try {
    const scope = requireScope(req, res);
    if (!scope) return;
    const result = await repository.getSummary(scope.branchId);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Fetch software licenses summary error:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch software licenses summary.",
    });
  }
});

router.get("/:id/reconciliation", async (req, res) => {
  try {
    const scope = requireScope(req, res);
    if (!scope) return;
    const licenseId = parseLicenseId(req.params.id);
    if (!licenseId) return res.status(400).json({ success: false, error: "Invalid license ID." });
    const licenseResult = await repository.findById(licenseId);
    const license = licenseResult.rows[0];
    if (!license) return res.status(404).json({ success: false, error: "License not found." });
    if (!canManage(scope, license.branch_id)) {
      return res.status(403).json({ success: false, error: "Reconciliation denied for this license branch." });
    }
    const [assignmentsResult, employeesResult, assetsResult, historyResult] = await repository.getReconciliation(licenseId);
    const trackedAssignments = assignmentsResult.rowCount;
    return res.json({
      success: true,
      data: {
        license: {
          ...license,
          tracked_assignments: trackedAssignments,
          unlinked_used_licenses: Math.max(Number(license.used_licenses) - trackedAssignments, 0),
        },
        assignments: assignmentsResult.rows,
        assignment_history: historyResult.rows,
        employees: employeesResult.rows,
        assets: assetsResult.rows,
      },
    });
  } catch (error) {
    console.error("License reconciliation fetch error:", error.message);
    return res.status(500).json({ success: false, error: "Failed to load license reconciliation." });
  }
});

router.post("/:id/reconcile", async (req, res) => {
  const scope = requireScope(req, res);
  if (!scope) return;
  const licenseId = parseLicenseId(req.params.id);
  const employeeId = Number.parseInt(req.body.user_id, 10);
  const assetId = req.body.asset_id ? Number.parseInt(req.body.asset_id, 10) : null;
  if (!licenseId || !Number.isInteger(employeeId) || (req.body.asset_id && !Number.isInteger(assetId))) {
    return res.status(400).json({ success: false, error: "Select a valid employee and assigned asset." });
  }
  const client = await repository.connect();
  try {
    await client.query("BEGIN");
    const licenseResult = await repository.findByIdForUpdate(licenseId, client);
    const license = licenseResult.rows[0];
    if (!license) throw Object.assign(new Error("License not found."), { status: 404 });
    if (!canManage(scope, license.branch_id)) {
      throw Object.assign(new Error("Reconciliation denied for this license branch."), { status: 403 });
    }
    const employeeResult = await client.query(
      `SELECT employee.user_id,employee.branch_id,employee.full_name,employee.employee_number
         FROM users employee JOIN system_roles role ON role.role_id=employee.role_id
        WHERE employee.user_id=$1 AND employee.is_active=TRUE AND LOWER(role.role_name)='employee'
        FOR UPDATE OF employee`,
      [employeeId]
    );
    const employee = employeeResult.rows[0];
    if (!employee || Number(employee.branch_id) !== Number(license.branch_id)) {
      throw Object.assign(new Error("The selected employee is outside this license branch."), { status: 400 });
    }
    const trackedResult = await repository.countActiveAssignments(licenseId, client);
    const trackedAssignments = Number(trackedResult.rows[0].count);
    const unlinkedUsage = Math.max(Number(license.used_licenses) - trackedAssignments, 0);
    if (unlinkedUsage < 1) {
      throw Object.assign(new Error("This license has no unlinked usage to reconcile."), { status: 409 });
    }
    if (assetId) {
      const assetResult = await client.query(
        `SELECT asset_id FROM hardware_assets
          WHERE asset_id=$1 AND branch_id=$2
            AND (assigned_to=$3 OR (assigned_to IS NULL AND (
              employee_id=$3::text OR ($4::text<>'' AND employee_id=$4::text)
            )))
          FOR UPDATE`,
        [assetId, license.branch_id, employee.user_id, String(employee.employee_number || "")]
      );
      if (!assetResult.rows.length) {
        throw Object.assign(new Error("The selected asset is not currently assigned to this employee."), { status: 400 });
      }
    }
    const seatCost = Number(license.total_licenses) > 0
      ? Number((Number(license.annual_cost || 0) / Number(license.total_licenses)).toFixed(2))
      : 0;
    const inserted = await client.query(
      `INSERT INTO software_license_assignments
         (license_id,user_id,asset_id,assigned_by,annual_cost_snapshot,
          seat_annual_cost_snapshot,status,assignment_source)
       VALUES($1,$2,$3,$4,$5,$6,'Active','Reconciliation')
       RETURNING assignment_id,license_id,user_id,asset_id,assigned_at,assignment_source`,
      [licenseId, employee.user_id, assetId, scope.user.userId,
        Number(license.annual_cost) || 0, seatCost]
    );
    await client.query("COMMIT");
    return res.status(201).json({
      success: true,
      data: {
        assignment: inserted.rows[0],
        used_licenses: Number(license.used_licenses),
        tracked_assignments: trackedAssignments + 1,
        unlinked_used_licenses: unlinkedUsage - 1,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("License reconciliation error:", error.message);
    if (error.code === "23505") {
      return res.status(409).json({ success: false, error: "This employee already has an active assignment for the license." });
    }
    return res.status(error.status || 500).json({
      success: false,
      error: error.status ? error.message : "Failed to reconcile license usage.",
    });
  } finally {
    client.release();
  }
});

router.get("/:id/renewals", async (req, res) => {
  try {
    const scope = requireScope(req, res);
    if (!scope) return;
    const licenseId = parseLicenseId(req.params.id);
    if (!licenseId) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid license ID." });
    }

    const existing = await repository.findById(licenseId);
    if (!existing.rows.length) {
      return res
        .status(404)
        .json({ success: false, error: "License not found." });
    }
    if (!canManage(scope, existing.rows[0].branch_id)) {
      return res.status(403).json({
        success: false,
        error: "Renewal history denied for this license branch.",
      });
    }

    const history = await repository.listRenewals(licenseId);
    return res.json({ success: true, data: history.rows });
  } catch (error) {
    console.error(
      "Fetch software license renewal history error:",
      error.message
    );
    return res.status(500).json({
      success: false,
      error: "Failed to load license renewal history.",
    });
  }
});

router.post("/:id/renew", async (req, res) => {
  const scope = requireScope(req, res);
  if (!scope) return;
  const licenseId = parseLicenseId(req.params.id);
  if (!licenseId) {
    return res
      .status(400)
      .json({ success: false, error: "Invalid license ID." });
  }

  const client = await repository.connect();
  try {
    await client.query("BEGIN");
    const existing = await repository.findByIdForUpdate(licenseId, client);
    if (!existing.rows.length) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ success: false, error: "License not found." });
    }

    const license = existing.rows[0];
    if (!canManage(scope, license.branch_id)) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        error: "Renewal denied for this license branch.",
      });
    }

    const validation = validateLicenseRenewal({
      currentExpiryDate: license.expiry_date,
      newExpiryDate: req.body.new_expiry_date,
      annualCost: req.body.annual_cost,
    });
    if (!validation.valid) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ success: false, error: validation.message });
    }

    const previousCost = Number(license.annual_cost) || 0;
    const newCost =
      req.body.annual_cost === undefined ||
      req.body.annual_cost === null ||
      req.body.annual_cost === ""
        ? previousCost
        : Number(req.body.annual_cost);
    const reference =
      String(req.body.renewal_reference || "").trim() || null;
    const notes = String(req.body.notes || "").trim() || null;

    const renewal = await repository.insertRenewal(client, [
      licenseId,
      license.expiry_date,
      validation.newExpiryDate,
      previousCost,
      newCost,
      reference,
      notes,
      scope.user.userId,
    ]);
    const updated = await repository.updateRenewalTerm(client, {
      licenseId,
      expiryDate: validation.newExpiryDate,
      annualCost: newCost,
      status: computeSoftwareLicenseStatus(validation.newExpiryDate),
    });
    await client.query("COMMIT");
    return res.json({
      success: true,
      data: updated.rows[0],
      renewal: renewal.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Renew software license error:", error.message);
    return res
      .status(500)
      .json({ success: false, error: "Failed to renew software license." });
  } finally {
    client.release();
  }
});

router.post("/", async (req, res) => {
  try {
    const scope = requireScope(req, res);
    if (!scope) return;
    const {
      license_name,
      vendor,
      license_type,
      total_licenses,
      used_licenses,
      expiry_date,
      annual_cost,
      branch_id,
    } = req.body;
    const targetBranchId =
      scope.user.role === "superadmin"
        ? parseBranchId(branch_id)
        : scope.user.branchId;
    const totalCount = Number.parseInt(total_licenses, 10);
    const usedCount = Number.parseInt(used_licenses, 10);
    const annualCost = annual_cost === undefined || annual_cost === "" ? 0 : Number(annual_cost);
    const validationError = validateLicenseFields({
      licenseName: license_name,
      vendor,
      licenseType: license_type,
      totalCount,
      usedCount,
      annualCost,
      expiryDate: expiry_date,
    });
    if (validationError) {
      return res.status(400).json({
        success: false,
        error: validationError,
      });
    }
    if (!targetBranchId) {
      return res
        .status(400)
        .json({ success: false, error: "Branch is required." });
    }
    if (!(await repository.branchExists(targetBranchId))) {
      return res.status(400).json({
        success: false,
        error: "Selected branch does not exist or is inactive.",
      });
    }

    const result = await repository.create([
      license_name,
      vendor,
      license_type,
      totalCount,
      usedCount,
      expiry_date || null,
      annualCost,
      computeSoftwareLicenseStatus(expiry_date),
      targetBranchId,
    ]);
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Create software license error:", error.message);
    return res
      .status(500)
      .json({ success: false, error: "Failed to create software license." });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const scope = requireScope(req, res);
    if (!scope) return;
    const licenseId = parseLicenseId(req.params.id);
    if (!licenseId) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid license ID." });
    }

    const existing = await repository.findById(licenseId);
    if (!existing.rows.length) {
      return res
        .status(404)
        .json({ success: false, error: "License not found." });
    }
    if (!canManage(scope, existing.rows[0].branch_id)) {
      return res.status(403).json({
        success: false,
        error: "Update denied for this license branch.",
      });
    }

    const {
      license_name,
      vendor,
      license_type,
      total_licenses,
      used_licenses,
      expiry_date,
      annual_cost,
      branch_id,
    } = req.body;
    const totalCount = Number.parseInt(total_licenses, 10);
    const usedCount = Number.parseInt(used_licenses, 10);
    const annualCost = annual_cost === undefined || annual_cost === "" ? 0 : Number(annual_cost);
    const validationError = validateLicenseFields({
      licenseName: license_name,
      vendor,
      licenseType: license_type,
      totalCount,
      usedCount,
      annualCost,
      expiryDate: expiry_date,
    });
    if (validationError) {
      return res.status(400).json({
        success: false,
        error: validationError,
      });
    }
    const trackedResult = await repository.countActiveAssignments(licenseId);
    const trackedAssignments = Number(trackedResult.rows[0].count);
    if (usedCount < trackedAssignments) {
      return res.status(409).json({
        success: false,
        error: `Used licenses cannot be lower than ${trackedAssignments} active employee assignment(s).`,
      });
    }

    const targetBranchId =
      scope.user.role === "superadmin"
        ? parseBranchId(branch_id) || existing.rows[0].branch_id
        : existing.rows[0].branch_id;
    if (trackedAssignments > 0 && Number(targetBranchId) !== Number(existing.rows[0].branch_id)) {
      return res.status(409).json({
        success: false,
        error: "Release or reassign active employee links before changing the license branch.",
      });
    }
    if (!(await repository.branchExists(targetBranchId))) {
      return res.status(400).json({
        success: false,
        error: "Selected branch does not exist or is inactive.",
      });
    }

    const result = await repository.update(licenseId, [
      license_name,
      vendor,
      license_type,
      totalCount,
      usedCount,
      expiry_date || null,
      annualCost,
      computeSoftwareLicenseStatus(expiry_date),
      targetBranchId,
    ]);
    if (!result.rows.length) {
      return res
        .status(404)
        .json({ success: false, error: "License not found." });
    }
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Update software license error:", error.message);
    return res
      .status(500)
      .json({ success: false, error: "Failed to update software license." });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const scope = requireScope(req, res);
    if (!scope) return;
    const licenseId = parseLicenseId(req.params.id);
    if (!licenseId) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid license ID." });
    }

    const existing = await repository.findById(licenseId);
    if (!existing.rows.length) {
      return res
        .status(404)
        .json({ success: false, error: "License not found." });
    }
    if (!canManage(scope, existing.rows[0].branch_id)) {
      return res.status(403).json({
        success: false,
        error: "Delete denied for this license branch.",
      });
    }

    const history = await repository.countAuditHistory(licenseId);
    const assignmentCount = Number(history.rows[0]?.assignment_count) || 0;
    const renewalCount = Number(history.rows[0]?.renewal_count) || 0;
    if (assignmentCount > 0 || renewalCount > 0) {
      return res.status(409).json({
        success: false,
        error: "This license has assignment or renewal history and cannot be deleted.",
      });
    }

    const result = await repository.remove(licenseId);
    if (!result.rows.length) {
      return res
        .status(404)
        .json({ success: false, error: "License not found." });
    }
    return res.json({
      success: true,
      message: "License deleted successfully.",
    });
  } catch (error) {
    console.error("Delete software license error:", error.message);
    return res
      .status(500)
      .json({ success: false, error: "Failed to delete software license." });
  }
});

module.exports = router;
