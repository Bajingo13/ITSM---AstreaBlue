"use strict";

// Shared test fixtures.
//
// Historically several RBAC/analytics/ticket test suites assumed the local
// database already contained Admin, Employee, Technician, HR and SuperAdmin
// records. On a freshly initialised database (which only seeds a bootstrap
// SuperAdmin) those suites aborted in `before` with "tests require ...".
//
// These helpers let a suite create exactly the branches and users it needs and
// remove exactly those rows afterwards. Nothing here touches or depends on
// pre-existing data, so it is safe against both an empty and a fully populated
// database.

const db = require("../../config/db");

const KNOWN_ROLES = ["SuperAdmin", "Admin", "Technician", "Employee", "HR"];
const roleIdCache = new Map();

function uniqueStamp() {
  return `${Date.now()}_${process.pid}_${Math.random().toString(16).slice(2, 8)}`;
}

async function resolveRoleId(roleName) {
  const key = String(roleName).toLowerCase();
  if (roleIdCache.has(key)) return roleIdCache.get(key);
  const { rows } = await db.query(
    "SELECT role_id FROM system_roles WHERE LOWER(role_name) = $1 LIMIT 1",
    [key]
  );
  if (!rows[0]) {
    throw new Error(`system_roles is missing the "${roleName}" role; run migrations first`);
  }
  roleIdCache.set(key, rows[0].role_id);
  return rows[0].role_id;
}

// Creates an isolated set of test fixtures and tracks every row it inserts so
// cleanup() can delete precisely those rows (children first).
function createFixtureScope() {
  const createdUserIds = [];
  const createdBranchIds = [];
  const createdTicketIds = [];

  async function createBranch(label = "QA Branch") {
    const { rows } = await db.query(
      `INSERT INTO branches (branch_name, branch_location, is_active)
       VALUES ($1, 'QA', TRUE)
       RETURNING branch_id, branch_name`,
      [`${label} ${uniqueStamp()}`]
    );
    createdBranchIds.push(rows[0].branch_id);
    return rows[0].branch_id;
  }

  // roleName: one of KNOWN_ROLES (case-insensitive).
  // options: { branchId, status, isActive, fullName, department }
  async function createUser(roleName, options = {}) {
    const {
      branchId = null,
      status = "Active",
      isActive = true,
      fullName,
      department = null,
    } = options;
    const roleId = await resolveRoleId(roleName);
    const stamp = uniqueStamp();
    const { rows } = await db.query(
      `INSERT INTO users
         (full_name, email, password_hash, role_id, company_name, branch_id,
          department, status, is_active, onboarding_status, onboarding_required)
       VALUES ($1, $2, 'test-only-not-a-real-hash', $3, 'AstreaBlue QA', $4,
               $5, $6, $7, 'Completed', FALSE)
       RETURNING user_id, full_name, branch_id, status, is_active`,
      [
        fullName || `QA ${roleName} ${stamp}`,
        `qa_${String(roleName).toLowerCase()}_${stamp}@example.invalid`,
        roleId,
        branchId,
        department,
        status,
        isActive,
      ]
    );
    const user = rows[0];
    createdUserIds.push(user.user_id);
    // Shape mirrors the columns the suites read from their own SELECTs.
    return {
      user_id: user.user_id,
      userId: user.user_id,
      full_name: user.full_name,
      branch_id: user.branch_id,
      branchId: user.branch_id,
      status: user.status,
      is_active: user.is_active,
      role_name: roleName,
      role: String(roleName).toLowerCase(),
    };
  }

  // Convenience: one branch + one user for each requested role, all bound to
  // that branch unless roleBranch overrides it. Returns { branchId, otherBranchId, users }.
  async function seedRbacSet(roles = KNOWN_ROLES, { withSecondBranch = true, label = "QA" } = {}) {
    const branchId = await createBranch(`${label} Primary`);
    const otherBranchId = withSecondBranch ? await createBranch(`${label} Secondary`) : null;
    const users = {};
    for (const roleName of roles) {
      const key = String(roleName).toLowerCase();
      // SuperAdmin is branch-agnostic in this system; keep branch_id null for it.
      users[key] = await createUser(roleName, {
        branchId: key === "superadmin" ? null : branchId,
      });
    }
    return { branchId, otherBranchId, users };
  }

  // Direct-insert a ticket for report/analytics coverage. options:
  // { branchId, requesterId, categoryId, status, priority, title }
  async function createTicket(options = {}) {
    const {
      branchId = null,
      requesterId = null,
      categoryId = null,
      status = "Open Queue",
      priority = "P3-Medium",
      title = `QA Ticket ${uniqueStamp()}`,
    } = options;
    const ticketNumber = `QA-${uniqueStamp()}`.slice(0, 40);
    const { rows } = await db.query(
      `INSERT INTO tickets
         (ticket_number, title, description, priority, status, category_id,
          requester_id, employee_id, branch_id, source, created_via)
       VALUES ($1, $2, 'QA fixture ticket', $3, $4, $5, $6, $6, $7, 'portal', 'qa-fixture')
       RETURNING id, ticket_number, branch_id, status`,
      [ticketNumber, title, priority, status, categoryId, requesterId, branchId]
    );
    createdTicketIds.push(rows[0].id);
    return rows[0];
  }

  async function cleanup() {
    if (createdTicketIds.length) {
      await db.query("DELETE FROM tickets WHERE id = ANY($1::int[])", [createdTicketIds]);
      createdTicketIds.length = 0;
    }
    if (createdUserIds.length) {
      await db.query("DELETE FROM users WHERE user_id = ANY($1::int[])", [createdUserIds]);
      createdUserIds.length = 0;
    }
    if (createdBranchIds.length) {
      await db.query("DELETE FROM branches WHERE branch_id = ANY($1::int[])", [createdBranchIds]);
      createdBranchIds.length = 0;
    }
  }

  function trackUser(userId) {
    if (userId != null) createdUserIds.push(Number(userId));
  }

  function trackBranch(branchId) {
    if (branchId != null) createdBranchIds.push(Number(branchId));
  }

  function trackTicket(ticketId) {
    if (ticketId != null) createdTicketIds.push(Number(ticketId));
  }

  return {
    createBranch,
    createUser,
    createTicket,
    seedRbacSet,
    cleanup,
    trackUser,
    trackBranch,
    trackTicket,
  };
}

async function ensureTicketCategory() {
  const existing = await db.query(
    "SELECT category_id FROM ticket_categories ORDER BY category_id LIMIT 1"
  );
  if (existing.rows[0]) return existing.rows[0].category_id;
  const { rows } = await db.query(
    `INSERT INTO ticket_categories (category_name, visibility_scope)
     VALUES ($1, 'standard') RETURNING category_id`,
    [`QA Category ${uniqueStamp()}`]
  );
  return rows[0].category_id;
}

module.exports = { createFixtureScope, ensureTicketCategory, KNOWN_ROLES };
