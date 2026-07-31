const express = require("express");
const repository = require("../repositories/hardwareAssetRepository");
const { getAuthFromRequest } = require("../middleware/legacyJwtAuth");
const { calculateStraightLine } = require("../services/assetFinancialService");
const {
  DEFAULT_ONLINE_THRESHOLD_SECONDS,
  getAssetVerificationStatus,
  getCurrentMonitoringStatus,
} = require("../services/assetVerificationService");
const { reconcileDevice } = require("../services/reconciliationService");
const {
  getHardwareAssetAccessFilter,
} = require("../services/hardwareAssetAccessService");

function normalizeRole(role) {
  return String(role || "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
}

function getErrorMessage(error, fallback) {
  if (error.code === "23505") {
    return "An asset with this serial number or asset tag already exists.";
  }
  if (error.code === "23503") {
    return "The selected branch or assigned record does not exist.";
  }
  if (error.code === "22P02") {
    return "One or more asset values have an invalid format.";
  }
  if (error.code === "42703") {
    return "The hardware asset database schema is not up to date.";
  }
  return error.message || fallback;
}

function logError(operation, error) {
  console.error(`[Hardware Assets] ${operation} failed`, {
    message: error.message,
    code: error.code || null,
    detail: error.detail || null,
    constraint: error.constraint || null,
  });
}

function getAccessFilter(req) {
  const auth = getAuthFromRequest(req);
  if (!auth) return { whereSql: "WHERE 1=0", params: [] };
  return getHardwareAssetAccessFilter({
    role: auth.role,
    userId: auth.userId,
    branchId: auth.branchId,
    filterBranchId: req.query.filter_branch_id,
  });
}

function buildListFilter(req) {
  const access = getAccessFilter(req);
  const params = [...access.params];
  const filters = [];
  const addExact = (column, value) => {
    if (value && value.toLowerCase() !== "all") {
      params.push(value);
      filters.push(`${column} = $${params.length}`);
    }
  };

  const search = String(req.query.search || "").trim();
  if (search) {
    params.push(`%${search}%`);
    const index = params.length;
    filters.push(
      `(a.asset_name ILIKE $${index} OR a.asset_tag ILIKE $${index} OR ` +
        `a.serial_number ILIKE $${index} OR a.brand ILIKE $${index} OR ` +
        `a.manufacturer ILIKE $${index} OR a.model ILIKE $${index} OR ` +
        `a.supplier ILIKE $${index} OR a.assigned_name ILIKE $${index} OR ` +
        `a.team_department ILIKE $${index} OR a.location ILIKE $${index} OR ` +
        `a.department ILIKE $${index} OR a.borrower_email ILIKE $${index})`
    );
  }
  addExact("a.asset_type", String(req.query.type || "").trim());
  addExact("a.status", String(req.query.status || "").trim());
  addExact("a.brand", String(req.query.manufacturer || "").trim());

  const clauses = [];
  if (access.whereSql) {
    clauses.push(access.whereSql.replace(/^WHERE\s+/i, ""));
  }
  clauses.push(...filters);
  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

function normalizeAssetPayload(body) {
  const manufacturer = body.manufacturer || body.brand;
  const brand = body.brand || body.manufacturer;
  const assetName =
    body.asset_name ||
    [manufacturer, body.model].filter(Boolean).join(" ") ||
    body.asset_tag;
  return {
    ...body,
    finalManufacturer: manufacturer,
    finalBrand: brand,
    finalAssetName: assetName,
    attachmentPayload: JSON.stringify(
      Array.isArray(body.attachments) ? body.attachments : []
    ),
  };
}

function validateRequiredAsset(payload) {
  return Boolean(
    payload.asset_tag &&
      payload.asset_type &&
      payload.status &&
      payload.finalManufacturer &&
      payload.model &&
      payload.serial_number
  );
}

function resolveBranchId(req, auth, requestedBranchId, fallback = null) {
  const currentBranchId =
    req.query.current_branch_id || req.body.current_branch_id;
  const role = normalizeRole(auth?.role);
  if (role === "admin" && auth.branchId) return auth.branchId;
  if (role === "superadmin") {
    return requestedBranchId || currentBranchId || fallback;
  }
  const legacyRole = normalizeRole(
    req.query.role_name || req.body.role_name
  );
  return legacyRole === "superadmin"
    ? requestedBranchId || currentBranchId || fallback
    : currentBranchId || fallback || requestedBranchId || null;
}

function assetValues(payload, branchId, status) {
  return [
    payload.finalAssetName,
    payload.asset_type,
    payload.finalBrand,
    payload.finalManufacturer,
    payload.model || null,
    payload.serial_number,
    payload.asset_tag,
    payload.color || null,
    payload.purchase_price || null,
    payload.supplier || null,
    payload.assigned_name || null,
    payload.returned_name || null,
    payload.warranty || null,
    payload.condition_notes || null,
    payload.team_department || null,
    payload.assigned_date || null,
    payload.returned_date || null,
    payload.accessories || null,
    payload.processor || null,
    payload.ram || null,
    payload.storage || null,
    payload.signature_link || null,
    payload.returned_name_forms || null,
    payload.attachmentPayload,
    payload.location || null,
    payload.department || payload.team_department || null,
    branchId,
    status,
    payload.purchase_date || null,
    payload.warranty_expiration || payload.warranty || null,
    payload.borrower_name || payload.assigned_name || null,
    payload.borrower_email || null,
    payload.employee_id || null,
    payload.borrower_department || null,
    payload.borrow_date || null,
    payload.expected_return_date || null,
    payload.actual_return_date || null,
    payload.condition_before || null,
    payload.condition_after || null,
    payload.notes || null,
  ];
}

async function recordHistory(...args) {
  try {
    await repository.insertHistory(...args);
  } catch (error) {
    console.error("Insert asset history error:", error.message);
  }
}

async function recordBorrow(...args) {
  try {
    await repository.insertBorrowRecord(...args);
  } catch (error) {
    console.error("Create borrow record error:", error.message);
  }
}

function createHardwareAssetRoutes({ tablesReady }) {
  const router = express.Router();
  const requireTables = async () => {
    if (!(await tablesReady)) {
      throw new Error("Hardware asset database initialization failed.");
    }
  };

  router.get("/hardware-assets", async (req, res) => {
    try {
      await requireTables();
      if (!getAuthFromRequest(req)) {
        return res
          .status(401)
          .json({ success: false, error: "Authentication required." });
      }
      const filter = buildListFilter(req);
      const result = await repository.listAssets(
        filter.whereSql,
        filter.params
      );
      const threshold =
        Number(process.env.MONITORING_ONLINE_THRESHOLD_SECONDS) ||
        DEFAULT_ONLINE_THRESHOLD_SECONDS;
      return res.json(
        result.rows.map((asset) => ({
          ...asset,
          monitoring_status: asset.monitoring_device_id
            ? getCurrentMonitoringStatus(asset.monitoring_last_seen, {
                thresholdSeconds: threshold,
              })
            : null,
          verification_status: getAssetVerificationStatus(asset),
          ...calculateStraightLine(asset),
        }))
      );
    } catch (error) {
      logError("GET", error);
      return res.status(500).json({
        success: false,
        error: getErrorMessage(error, "Failed to fetch hardware assets"),
      });
    }
  });

  router.get("/hardware-assets/:id/history", async (req, res) => {
    try {
      await requireTables();
      const result = await repository.getHistory(req.params.id);
      return res.json(result.rows);
    } catch (error) {
      console.error("Fetch asset history error:", error.message);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch asset history",
      });
    }
  });

  router.post("/hardware-assets", async (req, res) => {
    try {
      await requireTables();
      const payload = normalizeAssetPayload({
        status: "Active",
        ...req.body,
      });
      if (!validateRequiredAsset(payload)) {
        return res.status(400).json({
          success: false,
          error:
            "Asset tag, status, manufacturer, model, asset type, and serial number are required",
        });
      }
      const auth = getAuthFromRequest(req);
      const branchId = resolveBranchId(
        req,
        auth,
        payload.branch_id,
        null
      );
      if (!branchId) {
        return res
          .status(400)
          .json({ success: false, error: "Branch location is required" });
      }

      const result = await repository.createAsset(
        assetValues(payload, branchId, payload.status)
      );
      let asset = result.rows[0];
      if (payload.image_url) {
        asset = (
          await repository.updateImage(asset.asset_id, payload.image_url)
        ).rows[0];
      }
      await recordHistory(
        asset.asset_id,
        "Asset Created",
        {
          status: payload.status,
          branch_id: branchId,
          created: new Date().toISOString(),
        },
        branchId,
        null
      );
      if (payload.status === "Borrowed") {
        await recordBorrow(asset.asset_id, {
          ...payload,
          status_from: "Active",
          status_to: "Borrowed",
          branch_id: branchId,
          created_by: null,
        });
      }
      return res.status(201).json(asset);
    } catch (error) {
      logError("POST", error);
      if (error.code === "23505") {
        return res
          .status(409)
          .json({ success: false, error: getErrorMessage(error) });
      }
      return res.status(500).json({
        success: false,
        error: getErrorMessage(error, "Failed to create hardware asset"),
      });
    }
  });

  router.get("/assets/:assetId/reconciliation", async (req, res) => {
    try {
      const auth = getAuthFromRequest(req);
      if (!auth) {
        return res
          .status(401)
          .json({ success: false, error: "Unauthorized" });
      }
      const role = normalizeRole(auth.role);
      if (role === "employee") {
        return res
          .status(403)
          .json({ success: false, error: "Access denied" });
      }
      if (role !== "superadmin" && auth.branchId) {
        const asset = await repository.findAssetBranch(req.params.assetId);
        if (
          !asset.rows.length ||
          Number(asset.rows[0].branch_id) !== Number(auth.branchId)
        ) {
          return res
            .status(403)
            .json({ success: false, error: "Access denied" });
        }
      }
      const result = await repository.getReconciliation(req.params.assetId);
      return res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Fetch reconciliation error:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch reconciliation data.",
      });
    }
  });

  router.put("/hardware-assets/:id", async (req, res) => {
    try {
      await requireTables();
      const payload = normalizeAssetPayload(req.body);
      if (!validateRequiredAsset(payload)) {
        return res.status(400).json({
          success: false,
          error:
            "Asset tag, status, manufacturer, model, asset type, and serial number are required",
        });
      }
      const existing = await repository.findAsset(req.params.id);
      if (!existing.rows.length) {
        return res
          .status(404)
          .json({ success: false, error: "Asset not found" });
      }
      const current = existing.rows[0];
      const branchId = resolveBranchId(
        req,
        getAuthFromRequest(req),
        payload.branch_id,
        current.branch_id
      );
      const status = payload.status || current.status;
      let updated = (
        await repository.updateAsset(
          req.params.id,
          assetValues(payload, branchId, status)
        )
      ).rows[0];

      if (payload.image_url !== undefined) {
        updated = (
          await repository.updateImage(
            req.params.id,
            payload.image_url || null
          )
        ).rows[0];
      }
      if (
        payload.employee_id ||
        payload.assigned_name ||
        payload.borrower_name
      ) {
        await repository.syncMonitoredAssignment(
          req.params.id,
          payload.employee_id || null,
          payload.department ||
            payload.team_department ||
            payload.borrower_department ||
            null,
          branchId || null
        );
      }
      await recordHistory(
        updated.asset_id,
        "Asset Updated",
        { status },
        branchId,
        null
      );
      const linked = await repository.getLinkedDevice(req.params.id);
      if (linked.rows.length) {
        await reconcileDevice(linked.rows[0].device_id);
      }
      return res.json(updated);
    } catch (error) {
      console.error("Update hardware asset error:", error.message);
      return res.status(500).json({
        success: false,
        error: "Failed to update hardware asset",
      });
    }
  });

  router.delete("/hardware-assets/:id", async (req, res) => {
    try {
      await requireTables();
      const auth = getAuthFromRequest(req);
      if (!auth) {
        return res
          .status(401)
          .json({ success: false, error: "Authentication required." });
      }
      const role = normalizeRole(auth.role);
      if (!["superadmin", "admin"].includes(role)) {
        return res.status(403).json({
          success: false,
          error:
            "Only Super Admin and Admin Branch can delete hardware assets.",
        });
      }
      const deletion = await repository.deleteAssetSafely(
        req.params.id,
        role === "admin" ? auth.branchId : null
      );
      if (!deletion.asset) {
        return res.status(404).json({
          success: false,
          error:
            "Hardware asset not found or you do not have permission to delete it.",
        });
      }
      if (deletion.linkedDevice) {
        return res.status(409).json({
          success: false,
          error: `This asset is linked to endpoint ${deletion.linkedDevice.hostname || deletion.linkedDevice.device_id}. Unlink or reassign that endpoint before deleting the asset.`,
        });
      }
      return res.json({
        success: true,
        message: "Hardware asset deleted successfully.",
      });
    } catch (error) {
      logError("DELETE", error);
      if (error.code === "23503") {
        return res.status(409).json({
          success: false,
          error:
            "This asset has protected replacement or service history and cannot be permanently deleted. Set its status to Retired or Disposed instead.",
        });
      }
      return res.status(500).json({
        success: false,
        error: getErrorMessage(
          error,
          "Failed to delete hardware asset. Please try again."
        ),
      });
    }
  });

  router.put("/hardware-assets/:id/link-device", async (req, res) => {
    try {
      const auth = getAuthFromRequest(req);
      const role = normalizeRole(auth?.role);
      if (!auth || !["superadmin", "admin"].includes(role)) {
        return res
          .status(403)
          .json({ success: false, error: "Unauthorized" });
      }
      if (role === "admin" && auth.branchId) {
        const asset = await repository.findAssetBranch(req.params.id);
        if (
          !asset.rows.length ||
          Number(asset.rows[0].branch_id) !== Number(auth.branchId)
        ) {
          return res.status(403).json({
            success: false,
            error: "Cannot link/unlink assets from another branch.",
          });
        }
      }
      const { device_id: deviceId } = req.body;
      if (deviceId === null || deviceId === "") {
        await repository.unlinkAssetDevices(req.params.id);
        return res.json({
          success: true,
          message: "Asset unlinked successfully.",
        });
      }

      const device = await repository.findDevice(deviceId);
      if (!device.rows.length) {
        return res.status(404).json({
          success: false,
          error: "Monitored device not found.",
        });
      }
      const existingAssetId = device.rows[0].asset_id;
      if (
        existingAssetId &&
        String(existingAssetId) !== String(req.params.id)
      ) {
        const other = await repository.findAssetTag(existingAssetId);
        const tag = other.rows.length
          ? other.rows[0].asset_tag
          : "another asset";
        return res.status(409).json({
          success: false,
          error: `This monitoring device is already linked to Asset ${tag}.`,
        });
      }
      await repository.unlinkAssetDevices(req.params.id);
      const result = await repository.linkDevice(req.params.id, deviceId);
      await reconcileDevice(deviceId);
      return res.json({
        success: true,
        message: "Asset linked successfully.",
        data: result.rows[0],
      });
    } catch (error) {
      console.error("Link device error:", error.message);
      return res.status(500).json({
        success: false,
        error: "Failed to link monitored device.",
      });
    }
  });

  router.patch("/hardware-assets/:id/status", async (req, res) => {
    try {
      await requireTables();
      const { status } = req.body;
      if (!status) {
        return res
          .status(400)
          .json({ success: false, error: "Asset status is required" });
      }
      const existing = await repository.findAsset(req.params.id);
      if (!existing.rows.length) {
        return res
          .status(404)
          .json({ success: false, error: "Asset not found" });
      }
      const current = existing.rows[0];
      const role = normalizeRole(
        req.query.role_name || req.body.role_name
      );
      const currentBranchId =
        req.query.current_branch_id || req.body.current_branch_id;
      if (
        role !== "superadmin" &&
        currentBranchId &&
        Number(current.branch_id) !== Number(currentBranchId)
      ) {
        return res.status(403).json({
          success: false,
          error: "You are not authorized to update this asset",
        });
      }
      if (
        status === "Borrowed" &&
        (!req.body.borrower_name ||
          !req.body.employee_id ||
          !req.body.borrower_department ||
          !req.body.borrow_date ||
          !req.body.expected_return_date)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Borrower name, employee ID, department, borrow date, and expected return date are required for borrowed assets",
        });
      }
      if (
        ["Active", "In Stock"].includes(status) &&
        !req.body.actual_return_date
      ) {
        return res.status(400).json({
          success: false,
          error: "Actual return date is required when returning an asset",
        });
      }
      const values = [
        status,
        req.body.borrower_name || null,
        req.body.employee_id || null,
        req.body.borrower_department || null,
        req.body.borrow_date || null,
        req.body.expected_return_date || null,
        req.body.actual_return_date || null,
        req.body.condition_before || null,
        req.body.condition_after || null,
        req.body.notes || null,
      ];
      const updated = (
        await repository.updateStatus(req.params.id, values)
      ).rows[0];
      const event = {
        from: current.status,
        to: status,
        borrower_name: req.body.borrower_name,
        employee_id: req.body.employee_id,
        borrower_department: req.body.borrower_department,
        borrow_date: req.body.borrow_date,
        expected_return_date: req.body.expected_return_date,
        actual_return_date: req.body.actual_return_date,
        condition_before: req.body.condition_before,
        condition_after: req.body.condition_after,
        notes: req.body.notes,
      };
      await recordHistory(
        updated.asset_id,
        "Status Change",
        event,
        current.branch_id,
        null
      );
      await recordBorrow(updated.asset_id, {
        ...req.body,
        status_from: current.status,
        status_to: status,
        branch_id: current.branch_id,
        created_by: null,
      });
      return res.json(updated);
    } catch (error) {
      console.error("Update hardware asset status error:", error.message);
      return res.status(500).json({
        success: false,
        error: "Failed to update hardware asset status",
      });
    }
  });

  return router;
}

module.exports = createHardwareAssetRoutes;
