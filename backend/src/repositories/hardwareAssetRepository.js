const db = require("../../config/db");

function listAssets(whereSql, params) {
  return db.query(
    `
    SELECT
      a.asset_id,
      a.asset_name,
      a.asset_type,
      a.brand,
      a.manufacturer,
      a.model,
      a.serial_number,
      a.asset_tag,
      a.color,
      a.purchase_price,
      a.supplier,
      a.assigned_name,
      a.returned_name,
      a.warranty,
      a.condition_notes,
      a.team_department,
      a.assigned_date,
      a.returned_date,
      a.accessories,
      a.processor,
      a.ram,
      a.storage,
      a.signature_link,
      a.returned_name_forms,
      a.attachments,
      a.image_url,
      a.location,
      a.department,
      a.status,
      a.purchase_date,
      a.warranty_expiration,
      a.borrower_name,
      a.borrower_email,
      a.employee_id,
      a.borrower_department,
      a.borrow_date,
      a.expected_return_date,
      a.actual_return_date,
      a.condition_before,
      a.condition_after,
      a.notes,
      a.vendor,
      a.invoice_number,
      COALESCE(f.useful_life_months, a.useful_life_months, ROUND(f.useful_life_years * 12), ROUND(a.useful_life_years * 12), 36) AS useful_life_months,
      COALESCE(f.useful_life_years, a.useful_life_years, 3) AS useful_life_years,
      COALESCE(f.salvage_value, a.salvage_value, 0) AS salvage_value,
      COALESCE(f.depreciation_method, a.depreciation_method, 'Straight-Line') AS depreciation_method,
      COALESCE(f.depreciation_start_date, a.purchase_date) AS depreciation_start_date,
      a.hostname,
      a.ip_address,
      a.mac_address,
      a.operating_system,
      a.device_type,
      a.last_seen,
      a.discovery_status,
      a.discovery_source,
      a.discovered_at,
      a.branch_id,
      COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,
      a.created_at,
      a.updated_at,
      md.device_id AS monitoring_device_id,
      md.device_uuid AS monitoring_device_uuid,
      md.hostname AS monitoring_hostname,
      md.status AS monitoring_recorded_status,
      md.last_seen_at AS monitoring_last_seen,
      md.logged_in_user AS monitoring_logged_in_user,
      ehi.serial_number AS agent_serial_number,
      ehi.manufacturer AS agent_manufacturer,
      ehi.model AS agent_model,
      ehi.scanned_at AS inventory_scanned_at,
      COALESCE(rec.match_count, 0) AS reconciliation_match_count,
      COALESCE(rec.mismatch_count, 0) AS reconciliation_mismatch_count,
      COALESCE(rec.unknown_count, 0) AS reconciliation_unknown_count
    FROM hardware_assets a
    LEFT JOIN branches b ON a.branch_id = b.branch_id
    LEFT JOIN asset_financials f ON f.asset_id = a.asset_id
    LEFT JOIN LATERAL (
      SELECT linked_device.*
      FROM monitored_devices linked_device
      WHERE linked_device.asset_id = a.asset_id
      ORDER BY linked_device.last_seen_at DESC NULLS LAST, linked_device.device_id DESC
      LIMIT 1
    ) md ON TRUE
    LEFT JOIN LATERAL (
      SELECT hi.serial_number, hi.manufacturer, hi.model, hi.scanned_at
      FROM endpoint_hardware_inventory hi
      WHERE hi.device_id = md.device_id
      ORDER BY hi.scanned_at DESC
      LIMIT 1
    ) ehi ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE LOWER(reconciliation.status) = 'match')::INTEGER AS match_count,
        COUNT(*) FILTER (WHERE LOWER(reconciliation.status) = 'mismatch')::INTEGER AS mismatch_count,
        COUNT(*) FILTER (WHERE LOWER(reconciliation.status) NOT IN ('match', 'mismatch'))::INTEGER AS unknown_count
      FROM asset_inventory_reconciliation reconciliation
      WHERE reconciliation.asset_id = a.asset_id
        AND reconciliation.device_id = md.device_id
        AND reconciliation.field_name IN ('serial_number', 'manufacturer', 'model')
    ) rec ON TRUE
    ${whereSql}
    ORDER BY a.created_at DESC
    `,
    params
  );
}

function getHistory(assetId) {
  return db.query(
    `SELECT history_id, asset_id, event_type, event_data, branch_id, created_by, created_at
     FROM asset_history
     WHERE asset_id = $1
     ORDER BY created_at DESC`,
    [assetId]
  );
}

function insertHistory(assetId, eventType, eventData, branchId, createdBy) {
  return db.query(
    `INSERT INTO asset_history
       (asset_id, event_type, event_data, branch_id, created_by)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      assetId,
      eventType,
      JSON.stringify(eventData || {}),
      branchId || null,
      createdBy || null,
    ]
  );
}

function insertBorrowRecord(assetId, record) {
  return db.query(
    `INSERT INTO asset_borrow_records (
       asset_id, borrower_name, employee_id, borrower_department, borrow_date,
       expected_return_date, actual_return_date, condition_before,
       condition_after, notes, status_from, status_to, branch_id, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      assetId,
      record.borrower_name || null,
      record.employee_id || null,
      record.borrower_department || null,
      record.borrow_date || null,
      record.expected_return_date || null,
      record.actual_return_date || null,
      record.condition_before || null,
      record.condition_after || null,
      record.notes || null,
      record.status_from || null,
      record.status_to || null,
      record.branch_id || null,
      record.created_by || null,
    ]
  );
}

function createAsset(values) {
  return db.query(
    `INSERT INTO hardware_assets (
       asset_name, asset_type, brand, manufacturer, model, serial_number,
       asset_tag, color, purchase_price, supplier, assigned_name,
       returned_name, warranty, condition_notes, team_department,
       assigned_date, returned_date, accessories, processor, ram, storage,
       signature_link, returned_name_forms, attachments, location, department,
       branch_id, status, purchase_date, warranty_expiration, borrower_name,
       borrower_email, employee_id, borrower_department, borrow_date,
       expected_return_date, actual_return_date, condition_before,
       condition_after, notes
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
       $19,$20,$21,$22,$23,$24::jsonb,$25,$26,$27,$28,$29,$30,$31,$32,$33,
       $34,$35,$36,$37,$38,$39,$40
     )
     RETURNING *`,
    values
  );
}

function findAsset(assetId) {
  return db.query(
    "SELECT * FROM hardware_assets WHERE asset_id = $1",
    [assetId]
  );
}

function findAssetBranch(assetId) {
  return db.query(
    "SELECT branch_id FROM hardware_assets WHERE asset_id = $1",
    [assetId]
  );
}

function updateAsset(assetId, values) {
  return db.query(
    `UPDATE hardware_assets
     SET asset_name=$1, asset_type=$2, brand=$3, manufacturer=$4, model=$5,
         serial_number=$6, asset_tag=$7, color=$8, purchase_price=$9,
         supplier=$10, assigned_name=$11, returned_name=$12, warranty=$13,
         condition_notes=$14, team_department=$15, assigned_date=$16,
         returned_date=$17, accessories=$18, processor=$19, ram=$20,
         storage=$21, signature_link=$22, returned_name_forms=$23,
         attachments=$24::jsonb, location=$25, department=$26, branch_id=$27,
         status=$28, purchase_date=$29, warranty_expiration=$30,
         borrower_name=$31, borrower_email=$32, employee_id=$33,
         borrower_department=$34, borrow_date=$35, expected_return_date=$36,
         actual_return_date=$37, condition_before=$38, condition_after=$39,
         notes=$40, updated_at=CURRENT_TIMESTAMP
     WHERE asset_id=$41
     RETURNING *`,
    [...values, assetId]
  );
}

function updateImage(assetId, imageUrl) {
  return db.query(
    "UPDATE hardware_assets SET image_url = $1 WHERE asset_id = $2 RETURNING *",
    [imageUrl, assetId]
  );
}

function updateStatus(assetId, values) {
  return db.query(
    `UPDATE hardware_assets
     SET status=$1, borrower_name=$2, employee_id=$3, borrower_department=$4,
         borrow_date=$5, expected_return_date=$6, actual_return_date=$7,
         condition_before=$8, condition_after=$9, notes=$10,
         updated_at=CURRENT_TIMESTAMP
     WHERE asset_id=$11
     RETURNING *`,
    [...values, assetId]
  );
}

function syncMonitoredAssignment(assetId, employeeId, department, branchId) {
  return db.query(
    `UPDATE monitored_devices
     SET assigned_user_id=$1, department=$2, branch_id=$3,
         updated_at=CURRENT_TIMESTAMP
     WHERE asset_id=$4`,
    [employeeId, department, branchId, assetId]
  );
}

function getLinkedDevice(assetId) {
  return db.query(
    "SELECT device_id FROM monitored_devices WHERE asset_id = $1",
    [assetId]
  );
}

function getReconciliation(assetId) {
  return db.query(
    `SELECT *
     FROM asset_inventory_reconciliation
     WHERE asset_id=$1
     ORDER BY checked_at DESC`,
    [assetId]
  );
}

function findDeletableAsset(assetId, branchId) {
  const scoped = branchId !== null && branchId !== undefined;
  return db.query(
    `SELECT asset_id, branch_id, asset_name
     FROM hardware_assets
     WHERE asset_id=$1${scoped ? " AND branch_id=$2" : ""}`,
    scoped ? [assetId, branchId] : [assetId]
  );
}

function unlinkAssetDevices(assetId) {
  return db.query(
    "UPDATE monitored_devices SET asset_id = NULL WHERE asset_id = $1",
    [assetId]
  );
}

function deleteAsset(assetId) {
  return db.query("DELETE FROM hardware_assets WHERE asset_id = $1", [assetId]);
}

function findDevice(deviceId) {
  return db.query(
    `SELECT asset_id, device_uuid, hostname
     FROM monitored_devices
     WHERE device_id=$1`,
    [deviceId]
  );
}

function findAssetTag(assetId) {
  return db.query(
    "SELECT asset_tag FROM hardware_assets WHERE asset_id = $1",
    [assetId]
  );
}

function linkDevice(assetId, deviceId) {
  return db.query(
    `UPDATE monitored_devices
     SET asset_id=$1
     WHERE device_id=$2
     RETURNING *`,
    [assetId, deviceId]
  );
}

module.exports = {
  createAsset,
  deleteAsset,
  findAsset,
  findAssetBranch,
  findAssetTag,
  findDeletableAsset,
  findDevice,
  getHistory,
  getLinkedDevice,
  getReconciliation,
  insertBorrowRecord,
  insertHistory,
  linkDevice,
  listAssets,
  syncMonitoredAssignment,
  unlinkAssetDevices,
  updateAsset,
  updateImage,
  updateStatus,
};
