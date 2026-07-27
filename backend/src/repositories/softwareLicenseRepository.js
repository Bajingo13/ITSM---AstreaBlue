const db = require("../../config/db");

async function ensureSchema() {
  return db.query(`
    CREATE TABLE IF NOT EXISTS software_licenses (
      license_id SERIAL PRIMARY KEY,
      license_name VARCHAR(255) NOT NULL,
      vendor VARCHAR(255) NOT NULL,
      license_type VARCHAR(50) NOT NULL CHECK (license_type IN ('Subscription', 'Annual', 'Perpetual')),
      total_licenses INTEGER NOT NULL DEFAULT 0,
      used_licenses INTEGER NOT NULL DEFAULT 0,
      expiry_date DATE,
      annual_cost NUMERIC(12,2) DEFAULT 0,
      status VARCHAR(50) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Expiring Soon', 'Expired', 'Available')),
      branch_id INTEGER REFERENCES branches(branch_id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS software_license_renewals (
      renewal_id BIGSERIAL PRIMARY KEY,
      license_id INTEGER NOT NULL REFERENCES software_licenses(license_id) ON DELETE CASCADE,
      previous_expiry_date DATE,
      new_expiry_date DATE NOT NULL,
      previous_annual_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      new_annual_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      renewal_reference VARCHAR(255),
      notes TEXT,
      renewed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      renewed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS software_license_renewals_license_idx
      ON software_license_renewals(license_id, renewed_at DESC)
  `);
}

function branchFilter(branchId) {
  return branchId
    ? { clause: "WHERE sl.branch_id = $1", params: [branchId] }
    : { clause: "", params: [] };
}

async function list(branchId, { alphabetical = false } = {}) {
  const filter = branchFilter(branchId);
  const overuseColumn = alphabetical
    ? ""
    : ",\n        (sl.used_licenses > sl.total_licenses) AS is_overused";

  return db.query(
    `SELECT
      sl.*,
      GREATEST(sl.total_licenses - sl.used_licenses, 0) AS available_licenses
      ${overuseColumn},
      CASE
        WHEN sl.expiry_date < CURRENT_DATE THEN 'Expired'
        WHEN sl.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'Expiring Soon'
        ELSE 'Active'
      END AS status,
      b.branch_name
    FROM software_licenses sl
    LEFT JOIN branches b ON sl.branch_id = b.branch_id
    ${filter.clause}
    ORDER BY ${alphabetical ? "sl.license_name" : "sl.created_at DESC"}`,
    filter.params
  );
}

async function getSummary(branchId) {
  const filter = branchFilter(branchId);
  return db.query(
    `SELECT
      COALESCE(SUM(sl.total_licenses)::int, 0) AS total_licenses,
      COALESCE(SUM(sl.used_licenses)::int, 0) AS total_in_use,
      COALESCE(SUM(GREATEST(sl.total_licenses - sl.used_licenses, 0))::int, 0) AS total_available,
      COALESCE(SUM(sl.annual_cost)::numeric, 0) AS total_annual_cost,
      COUNT(*) FILTER (
        WHERE sl.expiry_date IS NOT NULL
          AND sl.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
          AND sl.expiry_date >= CURRENT_DATE
      )::int AS expiring_soon
    FROM software_licenses sl
    ${filter.clause}`,
    filter.params
  );
}

async function branchExists(branchId) {
  const result = await db.query(
    "SELECT branch_id FROM branches WHERE branch_id = $1 LIMIT 1",
    [branchId]
  );
  return result.rows.length > 0;
}

function findById(licenseId, executor = db) {
  return executor.query(
    `SELECT license_id, branch_id, expiry_date, annual_cost
     FROM software_licenses
     WHERE license_id = $1
     LIMIT 1`,
    [licenseId]
  );
}

function findByIdForUpdate(licenseId, executor) {
  return executor.query(
    `SELECT license_id, branch_id, expiry_date, annual_cost
     FROM software_licenses
     WHERE license_id = $1
     FOR UPDATE`,
    [licenseId]
  );
}

function listRenewals(licenseId) {
  return db.query(
    `SELECT r.*, u.full_name AS renewed_by_name
     FROM software_license_renewals r
     LEFT JOIN users u ON u.user_id = r.renewed_by
     WHERE r.license_id = $1
     ORDER BY r.renewed_at DESC, r.renewal_id DESC`,
    [licenseId]
  );
}

function insertRenewal(executor, values) {
  return executor.query(
    `INSERT INTO software_license_renewals
       (license_id, previous_expiry_date, new_expiry_date, previous_annual_cost,
        new_annual_cost, renewal_reference, notes, renewed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    values
  );
}

function updateRenewalTerm(executor, {
  licenseId,
  expiryDate,
  annualCost,
  status,
}) {
  return executor.query(
    `UPDATE software_licenses
     SET expiry_date = $1,
         annual_cost = $2,
         status = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE license_id = $4
     RETURNING *`,
    [expiryDate, annualCost, status, licenseId]
  );
}

function create(values) {
  return db.query(
    `INSERT INTO software_licenses
       (license_name, vendor, license_type, total_licenses, used_licenses,
        expiry_date, annual_cost, status, branch_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    values
  );
}

function update(licenseId, values) {
  return db.query(
    `UPDATE software_licenses
     SET license_name = $1,
         vendor = $2,
         license_type = $3,
         total_licenses = $4,
         used_licenses = $5,
         expiry_date = $6,
         annual_cost = $7,
         status = $8,
         branch_id = $9,
         updated_at = CURRENT_TIMESTAMP
     WHERE license_id = $10
     RETURNING *`,
    [...values, licenseId]
  );
}

function remove(licenseId) {
  return db.query(
    "DELETE FROM software_licenses WHERE license_id = $1 RETURNING license_id",
    [licenseId]
  );
}

function connect() {
  return db.rawPool.connect();
}

module.exports = {
  branchExists,
  connect,
  create,
  ensureSchema,
  findById,
  findByIdForUpdate,
  getSummary,
  insertRenewal,
  list,
  listRenewals,
  remove,
  update,
  updateRenewalTerm,
};
