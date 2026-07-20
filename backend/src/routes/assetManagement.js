const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const db = require("../../config/db");
const { calculateStraightLine } = require("../services/assetFinancialService");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
const AGENT_MESSAGE = "Network scanning requires a local discovery agent inside the company network. You can import discoveries or use manual registration for now.";

function requireAssetManager(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";
    if (!authorization.startsWith("Bearer ")) throw new Error("Authentication required.");
    const user = jwt.verify(authorization.slice(7), JWT_SECRET);
    const role = String(user.role || "").toLowerCase().replace(/[\s_-]/g, "");
    if (!["superadmin", "admin"].includes(role)) {
      return res.status(403).json({ success: false, message: "Asset manager access required.", error: "Asset manager access required." });
    }
    req.assetUser = user;
    req.assetBranchId = role === "admin" ? user.branchId : null;
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: error.message, error: error.message });
  }
}

function clean(value) {
  const text = String(value || "").trim();
  return text || null;
}

router.get("/types", requireAssetManager, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT asset_type_id,type_name,created_at FROM asset_types
       ORDER BY CASE WHEN LOWER(type_name)='other' THEN 1 ELSE 0 END, LOWER(type_name)`
    );
    return res.json({ success: true, message: "Asset types loaded.", data: result.rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load asset types.", error: error.message });
  }
});

router.post("/types", requireAssetManager, async (req, res) => {
  const typeName = String(req.body?.type_name || "").trim().replace(/\s+/g, " ");
  if (!typeName || typeName.length > 100 || typeName.toLowerCase() === "other") {
    return res.status(400).json({ success: false, message: "Specify a valid asset type up to 100 characters.", error: "Invalid asset type." });
  }
  try {
    const existing = await db.query(`SELECT * FROM asset_types WHERE LOWER(type_name)=LOWER($1) LIMIT 1`, [typeName]);
    if (existing.rows.length) {
      return res.json({ success: true, message: "Asset type already exists.", data: existing.rows[0], created: false });
    }
    try {
      const inserted = await db.query(`INSERT INTO asset_types (type_name) VALUES ($1) RETURNING *`, [typeName]);
      return res.status(201).json({ success: true, message: "Asset type created.", data: inserted.rows[0], created: true });
    } catch (insertError) {
      if (insertError.code !== "23505") throw insertError;
      const concurrent = await db.query(`SELECT * FROM asset_types WHERE LOWER(type_name)=LOWER($1) LIMIT 1`, [typeName]);
      return res.json({ success: true, message: "Asset type already exists.", data: concurrent.rows[0], created: false });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to save asset type.", error: error.message });
  }
});

router.patch("/:id/procurement", requireAssetManager, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE hardware_assets SET vendor=$1,invoice_number=$2,updated_at=CURRENT_TIMESTAMP
       WHERE asset_id=$3 AND ($4::int IS NULL OR branch_id=$4) RETURNING *`,
      [clean(req.body?.vendor), clean(req.body?.invoice_number), req.params.id, req.assetBranchId]
    );
    if (!result.rows.length) return res.status(404).json({ success:false,message:"Asset not found.",error:"Asset not found." });
    return res.json({ success:true,message:"Asset procurement details updated.",data:result.rows[0] });
  } catch (error) {
    return res.status(500).json({ success:false,message:"Failed to update procurement details.",error:error.message });
  }
});

async function getFinancialAssets(user) {
  const isAdmin = String(user.role || "").toLowerCase() === "admin";
  const result = await db.query(
    `SELECT a.asset_id,a.asset_tag,a.asset_name,a.serial_number,a.purchase_date,a.purchase_price,
            a.vendor,a.supplier,a.branch_id,b.branch_name,
            COALESCE(f.useful_life_months, ROUND(f.useful_life_years * 12), 36) useful_life_months,
            COALESCE(f.useful_life_years,3) useful_life_years,
            COALESCE(f.salvage_value,0) salvage_value,
            COALESCE(f.depreciation_method,'Straight-Line') depreciation_method,
            COALESCE(f.depreciation_start_date,a.purchase_date) depreciation_start_date,
            f.disposal_value,f.notes financial_notes
       FROM hardware_assets a
       LEFT JOIN asset_financials f ON f.asset_id=a.asset_id
       LEFT JOIN branches b ON b.branch_id=a.branch_id
       ${isAdmin ? "WHERE a.branch_id=$1" : ""}
       ORDER BY a.asset_tag`,
    isAdmin ? [user.branchId] : []
  );
  return result.rows.map((asset) => ({ ...asset, ...calculateStraightLine(asset) }));
}

router.get("/financial/assets", requireAssetManager, async (req, res) => {
  try {
    return res.json({ success: true, message: "Depreciation records loaded.", data: await getFinancialAssets(req.assetUser) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load depreciation records.", error: error.message });
  }
});

router.get("/financial/summary", requireAssetManager, async (req, res) => {
  try {
    const assets = await getFinancialAssets(req.assetUser);
    const depreciableAssets = assets.filter((asset) => asset.is_depreciable);
    const sum = (field) => depreciableAssets.reduce((total, asset) => total + Number(asset[field] || 0), 0);
    return res.json({ success: true, message: "Depreciation summary loaded.", data: {
      total_asset_value: sum("purchase_cost"),
      current_book_value: sum("current_book_value"),
      accumulated_depreciation: sum("accumulated_depreciation"),
      monthly_depreciation_expense: sum("monthly_depreciation"),
      fully_depreciated_assets: depreciableAssets.filter((asset) => asset.fully_depreciated).length,
      assets_near_end_of_life: depreciableAssets.filter((asset) => ["Near End of Life", "Critical", "End of Life"].includes(asset.lifespan_status)).length,
      expense_items: assets.filter((asset) => !asset.is_depreciable).length,
    } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load depreciation summary.", error: error.message });
  }
});

router.patch("/:id/financial", requireAssetManager, async (req, res) => {
  const { useful_life_months, useful_life_years, salvage_value, depreciation_method, depreciation_start_date, disposal_value, notes } = req.body || {};
  const normalizedUsefulLifeMonths = Number(useful_life_months) > 0
    ? Math.round(Number(useful_life_months))
    : Math.round(Number(useful_life_years) * 12);
  if (!Number.isFinite(normalizedUsefulLifeMonths) || normalizedUsefulLifeMonths <= 0) {
    return res.status(400).json({ success: false, message: "Useful life must be greater than zero.", error: "Invalid useful life." });
  }
  if (!Number.isFinite(Number(salvage_value)) || Number(salvage_value) < 0) {
    return res.status(400).json({ success: false, message: "Salvage value cannot be negative.", error: "Invalid salvage value." });
  }
  if (depreciation_method && depreciation_method !== "Straight-Line") {
    return res.status(400).json({ success: false, message: "Only Straight-Line depreciation is currently supported.", error: "Unsupported depreciation method." });
  }
  try {
    const asset = await db.query(
      `SELECT asset_id FROM hardware_assets WHERE asset_id=$1 AND ($2::int IS NULL OR branch_id=$2)`,
      [req.params.id, req.assetBranchId]
    );
    if (!asset.rows.length) return res.status(404).json({ success: false, message: "Asset not found.", error: "Asset not found." });
    await db.query(
      `INSERT INTO asset_financials
       (asset_id,useful_life_months,useful_life_years,salvage_value,depreciation_method,depreciation_start_date,disposal_value,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (asset_id) DO UPDATE SET useful_life_months=EXCLUDED.useful_life_months,
       useful_life_years=EXCLUDED.useful_life_years,
       salvage_value=EXCLUDED.salvage_value,depreciation_method=EXCLUDED.depreciation_method,
       depreciation_start_date=EXCLUDED.depreciation_start_date,disposal_value=EXCLUDED.disposal_value,
       notes=EXCLUDED.notes,updated_at=CURRENT_TIMESTAMP`,
      [req.params.id, normalizedUsefulLifeMonths, normalizedUsefulLifeMonths / 12, Number(salvage_value) || 0,
        depreciation_method || "Straight-Line", depreciation_start_date || null,
        disposal_value === "" || disposal_value == null ? null : Number(disposal_value), notes || null]
    );
    const data = (await getFinancialAssets(req.assetUser)).find((row) => Number(row.asset_id) === Number(req.params.id));
    return res.json({ success: true, message: "Finance settings updated.", data });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to update finance settings.", error: error.message });
  }
});

router.get("/financial/reports/depreciation", requireAssetManager, async (req, res) => {
  try {
    return res.json({ success: true, message: "Depreciation report generated.", data: {
      generated_at: new Date().toISOString(), assets: await getFinancialAssets(req.assetUser),
    } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to generate depreciation report.", error: error.message });
  }
});

async function findAssetMatch(record, branchId) {
  const result = await db.query(
    `SELECT asset_id FROM hardware_assets WHERE (($1::text IS NOT NULL AND LOWER(serial_number)=LOWER($1))
      OR ($2::text IS NOT NULL AND LOWER(mac_address)=LOWER($2))
      OR ($3::text IS NOT NULL AND LOWER(asset_tag)=LOWER($3)))
      AND ($4::int IS NULL OR branch_id=$4)
      ORDER BY CASE WHEN branch_id IS NOT DISTINCT FROM $4 THEN 0 ELSE 1 END LIMIT 2`,
    [clean(record.serial_number), clean(record.mac_address), clean(record.asset_tag), branchId]
  );
  return { assetId: result.rows[0]?.asset_id || null, duplicate: result.rows.length > 1 };
}

async function registerDiscovery(record, user, source = "Manual") {
  if (!clean(record.hostname)) throw new Error("Hostname is required.");
  const branchId = String(user.role || "").toLowerCase() === "admin" ? user.branchId : record.branch_id || user.branchId || null;
  const match = await findAssetMatch(record, branchId);
  const status = clean(record.status) || "Online";
  const reconciliation = status.toLowerCase() === "offline" ? "Offline" : match.duplicate ? "Duplicate" : match.assetId ? "Matched" : "Unmanaged";
  const existing = await db.query(
    `SELECT discovery_id FROM asset_discoveries WHERE
      (($1::text IS NOT NULL AND LOWER(mac_address)=LOWER($1)) OR
      ($2::text IS NOT NULL AND LOWER(serial_number)=LOWER($2)) OR
      ($3::text IS NOT NULL AND LOWER(asset_tag)=LOWER($3)))
      AND ($4::int IS NULL OR branch_id=$4) LIMIT 1`,
    [clean(record.mac_address), clean(record.serial_number), clean(record.asset_tag), branchId]
  );
  const values = [clean(record.hostname), clean(record.ip_address), clean(record.mac_address), clean(record.serial_number),
    clean(record.asset_tag), clean(record.os_name || record.operating_system), clean(record.manufacturer),
    clean(record.device_type), source, status, reconciliation, match.assetId, branchId,
    JSON.stringify(record), user.userId || null];
  if (existing.rows.length) {
    const result = await db.query(
      `UPDATE asset_discoveries SET hostname=$1,ip_address=$2,mac_address=COALESCE($3,mac_address),
       serial_number=COALESCE($4,serial_number),asset_tag=COALESCE($5,asset_tag),os_name=$6,manufacturer=$7,
       device_type=$8,source=$9,last_seen=CURRENT_TIMESTAMP,status=$10,reconciliation_status=$11,
       matched_asset_id=$12,branch_id=$13,raw_data=$14::jsonb,updated_at=CURRENT_TIMESTAMP
       WHERE discovery_id=$16 RETURNING *`,
      [...values, existing.rows[0].discovery_id]
    );
    return { record: result.rows[0], created: false };
  }
  const result = await db.query(
    `INSERT INTO asset_discoveries
     (hostname,ip_address,mac_address,serial_number,asset_tag,os_name,manufacturer,device_type,source,
      status,reconciliation_status,matched_asset_id,branch_id,raw_data,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15) RETURNING *`, values
  );
  return { record: result.rows[0], created: true };
}

async function syncDiscoveredEndpointAsset(discovery, assetId, queryable = db) {
  const deviceUuid = clean(discovery?.raw_data?.device_uuid);
  if (!deviceUuid) return;
  const asset = await queryable.query(`SELECT branch_id FROM hardware_assets WHERE asset_id=$1`, [assetId]);
  const branchId = asset.rows[0]?.branch_id || null;
  await queryable.query(
    `UPDATE monitored_devices
        SET asset_id=$1, branch_id=COALESCE($2,branch_id), updated_at=CURRENT_TIMESTAMP
      WHERE device_uuid=$3::uuid`,
    [assetId, branchId, deviceUuid]
  );
  await queryable.query(`UPDATE endpoint_hardware_inventory SET asset_id=$1 WHERE device_uuid=$2::uuid`, [assetId, deviceUuid]);
  await queryable.query(
    `UPDATE endpoint_software_inventory
        SET asset_id=$1, branch_id=COALESCE($2,branch_id), updated_at=CURRENT_TIMESTAMP
      WHERE device_uuid=$3::uuid`,
    [assetId, branchId, deviceUuid]
  );
}

router.get("/discovery", requireAssetManager, async (req, res) => {
  try {
    await db.query(
      `UPDATE asset_discoveries
          SET reconciliation_status='Unmanaged'
        WHERE reconciliation_status='Matched'
          AND matched_asset_id IS NULL
          AND ($1::int IS NULL OR branch_id=$1)`,
      [req.assetBranchId]
    );
    const result = await db.query(
      `SELECT d.*,a.asset_name,a.asset_tag matched_asset_tag,b.branch_name FROM asset_discoveries d
       LEFT JOIN hardware_assets a ON a.asset_id=d.matched_asset_id LEFT JOIN branches b ON b.branch_id=d.branch_id
       WHERE ($1::int IS NULL OR d.branch_id=$1) ORDER BY d.last_seen DESC`, [req.assetBranchId]
    );
    return res.json({ success: true, message: "Discovery registry loaded.", data: result.rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load discovery registry.", error: error.message });
  }
});

router.post("/discovery", requireAssetManager, async (req, res) => {
  try {
    const result = await registerDiscovery(req.body || {}, req.assetUser, "Manual");
    return res.status(result.created ? 201 : 200).json({ success: true, message: result.created ? "Discovery registered." : "Discovery updated.", data: result.record });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message, error: error.message });
  }
});

router.post("/discovery/import", requireAssetManager, async (req, res) => {
  const records = Array.isArray(req.body?.records) ? req.body.records : [];
  if (!records.length) return res.status(400).json({ success: false, message: "No discovery records supplied.", error: "No discovery records supplied." });
  try {
    let created = 0;
    let updated = 0;
    for (const record of records) {
      const result = await registerDiscovery(record, req.assetUser, "CSV Import");
      result.created ? created++ : updated++;
    }
    await db.query(
      `INSERT INTO asset_discovery_scans (completed_at,duration_ms,devices_found,new_assets,updated_assets,status,branch_id,initiated_by,source)
       VALUES (CURRENT_TIMESTAMP,0,$1,$2,$3,'Completed',$4,$5,'CSV Import')`,
      [records.length, created, updated, req.assetBranchId || req.body.branch_id || null, req.assetUser.userId || null]
    );
    return res.json({ success: true, message: "Discovery import completed.", data: { records: records.length, created, updated } });
  } catch (error) {
    return res.status(400).json({ success: false, message: "Discovery import failed.", error: error.message });
  }
});

router.post("/discovery/agent", requireAssetManager, async (req, res) => {
  req.body = { records: Array.isArray(req.body?.records) ? req.body.records : [] };
  const records = req.body.records;
  if (!records.length) return res.status(400).json({ success: false, message: "No agent discoveries supplied.", error: "No agent discoveries supplied." });
  try {
    for (const record of records) await registerDiscovery(record, req.assetUser, "Discovery Agent");
    return res.json({ success: true, message: "Agent discoveries accepted.", data: { records: records.length } });
  } catch (error) {
    return res.status(400).json({ success: false, message: "Agent discovery ingestion failed.", error: error.message });
  }
});

router.post("/discovery/scan", requireAssetManager, async (req, res) => {
  await db.query(
    `INSERT INTO asset_discovery_scans (completed_at,duration_ms,status,branch_id,initiated_by,error_message,source)
     VALUES (CURRENT_TIMESTAMP,0,'Agent Required',$1,$2,$3,'Network Scan')`,
    [req.assetBranchId || req.body?.branch_id || null, req.assetUser.userId || null, AGENT_MESSAGE]
  ).catch(() => {});
  return res.status(409).json({ success: false, message: AGENT_MESSAGE, error: AGENT_MESSAGE, data: { mode: "agent-required" } });
});

router.get("/discovery/history", requireAssetManager, async (req, res) => {
  const result = await db.query(`SELECT * FROM asset_discovery_scans WHERE ($1::int IS NULL OR branch_id=$1) ORDER BY started_at DESC LIMIT 25`, [req.assetBranchId]);
  return res.json({ success: true, message: "Discovery history loaded.", data: result.rows });
});

router.patch("/discovery/:id/link", requireAssetManager, async (req, res) => {
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const asset = await client.query(`SELECT asset_id FROM hardware_assets WHERE asset_id=$1 AND ($2::int IS NULL OR branch_id=$2)`, [req.body?.asset_id, req.assetBranchId]);
    if (!asset.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Hardware asset not found.", error: "Hardware asset not found." });
    }
    const result = await client.query(
      `UPDATE asset_discoveries SET matched_asset_id=$1,reconciliation_status='Matched',updated_at=CURRENT_TIMESTAMP
       WHERE discovery_id=$2 AND ($3::int IS NULL OR branch_id=$3) RETURNING *`,
      [req.body.asset_id, req.params.id, req.assetBranchId]
    );
    if (!result.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Discovery record not found.", error: "Discovery record not found." });
    }
    await syncDiscoveredEndpointAsset(result.rows[0], req.body.asset_id, client);
    await client.query("COMMIT");
    return res.json({ success: true, message: "Discovery linked to hardware asset.", data: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return res.status(500).json({ success: false, message: "Failed to link discovery.", error: error.message });
  } finally {
    client?.release();
  }
});

router.post("/discovery/:id/create-asset", requireAssetManager, async (req, res) => {
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const found = await client.query(`SELECT * FROM asset_discoveries WHERE discovery_id=$1 AND ($2::int IS NULL OR branch_id=$2)`, [req.params.id, req.assetBranchId]);
    if (!found.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Discovery record not found.", error: "Discovery record not found." });
    }
    const discovery = found.rows[0];
    if (discovery.matched_asset_id) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Discovery is already linked.", error: "Discovery is already linked." });
    }
    const suffix = crypto.createHash("sha256").update(`${discovery.discovery_id}-${discovery.hostname}`).digest("hex").slice(0, 10).toUpperCase();
    const assetTag = discovery.asset_tag || `DISC-${suffix}`;
    const serial = discovery.serial_number || discovery.mac_address || `DISC-SN-${suffix}`;
    const branchId = req.assetBranchId || discovery.branch_id || req.body?.branch_id;
    if (!branchId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "A branch is required before creating an asset.", error: "Branch is required." });
    }
    const inserted = await client.query(
      `INSERT INTO hardware_assets (asset_name,asset_type,brand,manufacturer,model,serial_number,asset_tag,branch_id,status)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7,'Active') RETURNING *`,
      [discovery.hostname, discovery.device_type || "Other", discovery.manufacturer || "Unknown", "Discovered Device", serial, assetTag, branchId]
    );
    await client.query(`UPDATE asset_discoveries SET matched_asset_id=$1,reconciliation_status='Matched',updated_at=CURRENT_TIMESTAMP WHERE discovery_id=$2`, [inserted.rows[0].asset_id, discovery.discovery_id]);
    await syncDiscoveredEndpointAsset(discovery, inserted.rows[0].asset_id, client);
    await client.query("COMMIT");
    return res.status(201).json({ success: true, message: "Hardware asset created from discovery.", data: inserted.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return res.status(500).json({ success: false, message: "Failed to create hardware asset from discovery.", error: error.message });
  } finally {
    client?.release();
  }
});

/* ─────────────────────────────────────────────
   GET /api/v1/hardware-assets/export — Excel export with role enforcement
   ───────────────────────────────────────────── */
router.get("/export", requireAssetManager, async (req, res) => {
  try {
    const { start_date, end_date, filter_branch_id } = req.query;
    const role = String(req.assetUser.role || "").toLowerCase().replace(/[\s_-]/g, "");
    const isSuperAdmin = role === "superadmin";
    const branchId = req.assetBranchId; // set by requireAssetManager for admins

    // Build query with role-based branch scope
    const conditions = [];
    const params = [];
    let idx = 1;

    if (!isSuperAdmin && branchId) {
      conditions.push(`a.branch_id = $${idx++}`);
      params.push(branchId);
    } else if (isSuperAdmin && filter_branch_id) {
      conditions.push(`a.branch_id = $${idx++}`);
      params.push(filter_branch_id);
    }

    if (start_date) {
      conditions.push(`(a.created_at::date >= $${idx} OR a.purchase_date >= $${idx} OR a.updated_at::date >= $${idx})`);
      params.push(start_date);
      idx++;
    }

    if (end_date) {
      conditions.push(`(a.created_at::date <= $${idx} OR a.purchase_date <= $${idx} OR a.updated_at::date <= $${idx})`);
      params.push(end_date);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await db.query(`
      SELECT
        a.asset_id, a.asset_name, a.asset_type, a.serial_number,
        a.brand, a.model, a.manufacturer, a.asset_tag,
        COALESCE(b.branch_name, 'Unassigned') AS branch_name,
        a.branch_id, a.assigned_name, a.borrower_name, a.status,
        a.purchase_date, a.warranty_expiration, a.created_at, a.updated_at,
        a.supplier, a.purchase_price, a.team_department,
        a.processor, a.ram, a.storage
      FROM hardware_assets a
      LEFT JOIN branches b ON a.branch_id = b.branch_id
      ${whereClause}
      ORDER BY b.branch_name, a.asset_name
    `, params);

    const rows = result.rows;
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "No hardware assets found for the selected date range." });
    }

    // Group by branch
    const branchMap = {};
    for (const row of rows) {
      const bn = row.branch_name || "Unassigned";
      if (!branchMap[bn]) branchMap[bn] = [];
      branchMap[bn].push(row);
    }

    const branchNames = Object.keys(branchMap);

    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "AstreaBlue ITSM";
    workbook.created = new Date();

    const colWidths = [8, 28, 16, 20, 14, 14, 20, 18, 14, 16, 16, 20, 20];
    const headers = [
      "Asset ID", "Asset Name", "Type", "Serial Number", "Brand",
      "Model", "Branch", "Assigned User", "Status",
      "Purchase Date", "Warranty Date", "Created Date", "Last Updated",
    ];
    const colKeys = ["asset_id", "asset_name", "asset_type", "serial_number", "brand", "model", "branch_name", "assigned_user", "status", "purchase_date", "warranty_date", "created_date", "last_updated"];

    const headerStyle = {
      font: { bold: true, color: { argb: "FFFFFFFF" }, size: 11 },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } },
      alignment: { vertical: "middle", horizontal: "center" },
      border: {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } },
      },
    };

    const cellStyle = {
      alignment: { vertical: "middle" },
      border: {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      },
    };

    const formatDate = (d) => (d ? new Date(d).toLocaleDateString("en-PH") : "");
    const rowToValues = (r) => [
      r.asset_id, r.asset_name, r.asset_type, r.serial_number,
      r.brand || "", r.model || "", r.branch_name,
      r.assigned_name || r.borrower_name || "", r.status,
      formatDate(r.purchase_date), formatDate(r.warranty_expiration),
      formatDate(r.created_at), formatDate(r.updated_at),
    ];

    const addAutoFilter = (ws, colCount) => {
      const lastCol = String.fromCharCode(64 + colCount);
      ws.autoFilter = `A1:${lastCol}${ws.rowCount}`;
    };

    if (isSuperAdmin && branchNames.length > 0) {
      // ── Sheet 1: All Hardware Assets (everything) ──
      const mainWs = workbook.addWorksheet("All Hardware Assets");
      mainWs.columns = headers.map((h, i) => ({ header: h, key: colKeys[i], width: colWidths[i] }));
      mainWs.getRow(1).eachCell((cell) => { cell.style = headerStyle; });
      mainWs.views = [{ state: "frozen", ySplit: 1 }];

      rows.forEach((r) => {
        mainWs.addRow(rowToValues(r)).eachCell((cell) => { cell.style = cellStyle; });
      });
      addAutoFilter(mainWs, headers.length);

      // ── Per-branch sheets ──
      for (const branchName of branchNames) {
        const sheetName = branchName.substring(0, 31);
        const ws = workbook.addWorksheet(sheetName);
        ws.columns = headers.map((h, i) => ({ header: h, key: colKeys[i], width: colWidths[i] }));
        ws.getRow(1).eachCell((cell) => { cell.style = headerStyle; });
        ws.views = [{ state: "frozen", ySplit: 1 }];

        branchMap[branchName].forEach((r) => {
          ws.addRow(rowToValues(r)).eachCell((cell) => { cell.style = cellStyle; });
        });
        addAutoFilter(ws, headers.length);
      }
    } else {
      // Single sheet for Admin or single-branch SuperAdmin
      const ws = workbook.addWorksheet("Hardware Assets");
      ws.columns = headers.map((h, i) => ({ header: h, key: colKeys[i], width: colWidths[i] }));
      ws.getRow(1).eachCell((cell) => { cell.style = headerStyle; });
      ws.views = [{ state: "frozen", ySplit: 1 }];

      rows.forEach((r) => {
        ws.addRow(rowToValues(r)).eachCell((cell) => { cell.style = cellStyle; });
      });
      addAutoFilter(ws, headers.length);
    }

    /* ── Apply protection ── */
    // Build descriptive filename
    const dateLabel = start_date && end_date
      ? `${start_date}_to_${end_date}`
      : new Date().toISOString().slice(0, 10);
    const scopeLabel = isSuperAdmin
      ? (filter_branch_id ? `branch-${filter_branch_id}` : "all-branches")
      : `branch-${branchId}`;
    const filename = `hardware-assets-${scopeLabel}-${dateLabel}.xlsx`;

    const finalBuf = Buffer.from(await workbook.xlsx.writeBuffer());

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.end(finalBuf);
  } catch (error) {
    console.error("Export error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to generate export.", error: error.message });
  }
});

module.exports = router;
