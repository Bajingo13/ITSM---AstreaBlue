const express = require("express");
const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const jwt = require("jsonwebtoken");
const db = require("../../config/db");
const { calculateStraightLine } = require("../services/assetFinancialService");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";

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
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: error.message, error: error.message });
  }
}

function configuredTargets() {
  const raw = String(process.env.ASSET_DISCOVERY_TARGETS || "").trim();
  if (!raw) return [];
  try {
    const targets = JSON.parse(raw);
    return (Array.isArray(targets) ? targets : []).map((target) =>
      typeof target === "string" ? { hostname: target } : target
    );
  } catch {
    return raw.split(",").map((hostname) => ({ hostname: hostname.trim() })).filter((item) => item.hostname);
  }
}

function probe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (online) => {
      socket.destroy();
      resolve(online);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function inspectTarget(target) {
  const hostname = String(target.hostname || target.ip_address || target.ip || "").trim();
  if (!hostname) return null;
  let ipAddress = String(target.ip_address || target.ip || "").trim();
  try {
    if (!ipAddress) ipAddress = (await dns.lookup(hostname)).address;
  } catch {
    ipAddress = hostname;
  }
  const ports = Array.isArray(target.ports) ? target.ports : [443, 80, 22, 3389];
  const timeoutMs = Math.max(250, Number(process.env.ASSET_DISCOVERY_TIMEOUT_MS) || 1200);
  let online = false;
  for (const port of ports) {
    if (await probe(ipAddress, Number(port), timeoutMs)) {
      online = true;
      break;
    }
  }
  return {
    hostname,
    ip_address: ipAddress,
    mac_address: target.mac_address || target.mac || null,
    manufacturer: target.manufacturer || "Unknown",
    operating_system: target.operating_system || target.os || "Unknown",
    device_type: target.device_type || target.type || "Other",
    model: target.model || "Discovered Device",
    online,
  };
}

router.post("/discovery/scan", requireAssetManager, async (req, res) => {
  const startedAt = Date.now();
  const branchId = req.assetUser.role?.toLowerCase() === "admin"
    ? req.assetUser.branchId
    : req.body?.branch_id || req.assetUser.branchId || null;
  let scanId;
  try {
    const scan = await db.query(
      `INSERT INTO asset_discovery_scans (branch_id, initiated_by) VALUES ($1,$2) RETURNING scan_id`,
      [branchId, req.assetUser.userId || null]
    );
    scanId = scan.rows[0].scan_id;
    const devices = (await Promise.all(configuredTargets().map(inspectTarget))).filter(Boolean);
    let newAssets = 0;
    let updatedAssets = 0;

    for (const device of devices) {
      const existing = await db.query(
        `SELECT asset_id FROM hardware_assets
         WHERE ($1::text IS NOT NULL AND LOWER(mac_address) = LOWER($1))
            OR ($2::text IS NOT NULL AND LOWER(hostname) = LOWER($2) AND branch_id IS NOT DISTINCT FROM $4)
            OR ($3::text IS NOT NULL AND ip_address = $3 AND branch_id IS NOT DISTINCT FROM $4)
         LIMIT 1`,
        [device.mac_address, device.hostname, device.ip_address, branchId]
      );
      let assetId;
      if (existing.rows.length) {
        assetId = existing.rows[0].asset_id;
        await db.query(
          `UPDATE hardware_assets SET hostname=$1, ip_address=$2, mac_address=COALESCE($3,mac_address),
           manufacturer=COALESCE(NULLIF($4,'Unknown'),manufacturer), operating_system=$5, device_type=$6,
           last_seen=CASE WHEN $7 THEN CURRENT_TIMESTAMP ELSE last_seen END,
           discovery_status=$8, discovery_source='Network Scan', updated_at=CURRENT_TIMESTAMP WHERE asset_id=$9`,
          [device.hostname, device.ip_address, device.mac_address, device.manufacturer, device.operating_system,
            device.device_type, device.online, device.online ? "Online" : "Offline", assetId]
        );
        updatedAssets += 1;
      } else {
        const fingerprint = device.mac_address || `${device.hostname}-${device.ip_address}`;
        const suffix = crypto.createHash("sha256").update(fingerprint).digest("hex").slice(0, 12).toUpperCase();
        const inserted = await db.query(
          `INSERT INTO hardware_assets
           (asset_name,asset_type,brand,manufacturer,model,serial_number,asset_tag,branch_id,status,
            hostname,ip_address,mac_address,operating_system,device_type,last_seen,discovery_status,discovery_source,discovered_at)
           VALUES ($1,$2,$3,$3,$4,$5,$6,$7,'Active',$8,$9,$10,$11,$12,
            CASE WHEN $13 THEN CURRENT_TIMESTAMP ELSE NULL END,$14,'Network Scan',CURRENT_TIMESTAMP)
           RETURNING asset_id`,
          [device.hostname, device.device_type, device.manufacturer, device.model, `DISC-${suffix}`, `DISC-${suffix}`,
            branchId, device.hostname, device.ip_address, device.mac_address, device.operating_system,
            device.device_type, device.online, device.online ? "Online" : "Offline"]
        );
        assetId = inserted.rows[0].asset_id;
        newAssets += 1;
      }
      await db.query(
        `INSERT INTO asset_history (asset_id,event_type,event_data,branch_id,created_by)
         VALUES ($1,'Network Discovery',$2::jsonb,$3,$4)`,
        [assetId, JSON.stringify(device), branchId, req.assetUser.userId || null]
      );
    }

    const durationMs = Date.now() - startedAt;
    await db.query(
      `UPDATE asset_discovery_scans SET completed_at=CURRENT_TIMESTAMP,duration_ms=$1,devices_found=$2,
       new_assets=$3,updated_assets=$4,status='Completed' WHERE scan_id=$5`,
      [durationMs, devices.length, newAssets, updatedAssets, scanId]
    );
    return res.json({ success: true, message: "Network scan completed.", data: {
      scan_id: scanId, devices_found: devices.length, new_assets: newAssets,
      updated_assets: updatedAssets, duration_ms: durationMs, devices,
    } });
  } catch (error) {
    if (scanId) await db.query(
      `UPDATE asset_discovery_scans SET completed_at=CURRENT_TIMESTAMP,duration_ms=$1,status='Failed',error_message=$2 WHERE scan_id=$3`,
      [Date.now() - startedAt, error.message, scanId]
    ).catch(() => {});
    return res.status(500).json({ success: false, message: "Asset discovery failed.", error: error.message });
  }
});

router.get("/discovery/history", requireAssetManager, async (req, res) => {
  const adminBranch = String(req.assetUser.role || "").toLowerCase() === "admin" ? req.assetUser.branchId : null;
  const result = await db.query(
    `SELECT * FROM asset_discovery_scans WHERE ($1::int IS NULL OR branch_id=$1) ORDER BY started_at DESC LIMIT 25`,
    [adminBranch]
  );
  return res.json({ success: true, message: "Discovery history loaded.", data: result.rows });
});

router.patch("/:id/financial", requireAssetManager, async (req, res) => {
  const { vendor, invoice_number, useful_life_years, salvage_value, depreciation_method } = req.body || {};
  if (depreciation_method && depreciation_method !== "Straight-Line") {
    return res.status(400).json({ success: false, message: "Only Straight-Line depreciation is currently supported.", error: "Only Straight-Line depreciation is currently supported." });
  }
  const adminBranch = String(req.assetUser.role || "").toLowerCase() === "admin" ? req.assetUser.branchId : null;
  const result = await db.query(
    `UPDATE hardware_assets SET vendor=$1,invoice_number=$2,useful_life_years=$3,salvage_value=$4,
     depreciation_method=COALESCE($5,'Straight-Line'),updated_at=CURRENT_TIMESTAMP
     WHERE asset_id=$6 AND ($7::int IS NULL OR branch_id=$7) RETURNING *`,
    [vendor || null, invoice_number || null, useful_life_years || 5, salvage_value || 0,
      depreciation_method || "Straight-Line", req.params.id, adminBranch]
  );
  if (!result.rows.length) return res.status(404).json({ success: false, message: "Asset not found.", error: "Asset not found." });
  const data = { ...result.rows[0], ...calculateStraightLine(result.rows[0]) };
  return res.json({ success: true, message: "Asset financial details updated.", data });
});

router.get("/financial/summary", requireAssetManager, async (req, res) => {
  const isAdmin = String(req.assetUser.role || "").toLowerCase() === "admin";
  const result = await db.query(
    `SELECT * FROM hardware_assets ${isAdmin ? "WHERE branch_id = $1" : ""}`,
    isAdmin ? [req.assetUser.branchId] : []
  );
  const assets = result.rows.map((asset) => ({ ...asset, ...calculateStraightLine(asset) }));
  const sum = (field) => assets.reduce((total, asset) => total + Number(asset[field] || 0), 0);
  const now = Date.now();
  const inNinetyDays = now + 90 * 86400000;
  const data = {
    total_asset_value: sum("purchase_cost"),
    current_asset_value: sum("current_book_value"),
    accumulated_depreciation: sum("accumulated_depreciation"),
    assets_near_warranty_expiration: assets.filter((asset) => {
      const date = asset.warranty_expiration ? new Date(asset.warranty_expiration).getTime() : 0;
      return date >= now && date <= inNinetyDays;
    }).length,
    assets_near_end_of_life: assets.filter((asset) => asset.remaining_useful_life_years <= 0.25).length,
  };
  return res.json({ success: true, message: "Asset financial summary loaded.", data });
});

router.get("/financial/reports/:type", requireAssetManager, async (req, res) => {
  const allowed = new Set(["asset-register", "depreciation", "financial-summary", "budget-forecast", "tco"]);
  if (!allowed.has(req.params.type)) return res.status(404).json({ success: false, message: "Unknown report type.", error: "Unknown report type." });
  const isAdmin = String(req.assetUser.role || "").toLowerCase() === "admin";
  const result = await db.query(
    `SELECT * FROM hardware_assets ${isAdmin ? "WHERE branch_id = $1" : ""} ORDER BY asset_tag`,
    isAdmin ? [req.assetUser.branchId] : []
  );
  const assets = result.rows.map((asset) => ({ ...asset, ...calculateStraightLine(asset) }));
  return res.json({ success: true, message: "Financial report generated.", data: { type: req.params.type, generated_at: new Date().toISOString(), assets } });
});

module.exports = router;
