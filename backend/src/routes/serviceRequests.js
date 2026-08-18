const express = require("express");
const db = require("../../config/db");
const { requireCurrentRoles } = require("../middleware/currentActor");

const router = express.Router();


// Normalise any role variant to a canonical lowercase token
function normalizeRole(role) {
  return String(role || "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function isSuperAdmin(role) {
  return normalizeRole(role) === "superadmin";
}

function isAdmin(role) {
  return normalizeRole(role) === "admin";
}

function isTechnician(role) {
  return normalizeRole(role) === "technician";
}

function isServiceRequestRole(role) {
  const normalized = normalizeRole(role);
  return normalized === "superadmin" || normalized === "admin" || normalized === "technician";
}

// Decode the Bearer JWT and attach user context. Does NOT abort — falls through
// so endpoints can decide whether auth is required.
function decodeRequestUser(req) {
  return req.currentActor || null;
}

router.use(requireCurrentRoles("superadmin", "admin", "technician"));

// Returns { clause, params } or { forbidden: true, unauthorized: true }
// startIndex is the $N index for the first new param.
function buildRequestScope(user, startIndex = 1) {
  if (!user) return { unauthorized: true };
  if (!isServiceRequestRole(user.role)) return { forbidden: true };
  if (isSuperAdmin(user.role)) return { clause: "", params: [] };
  if (!user.branchId) return { forbidden: true };
  return {
    clause: `requester.branch_id = $${startIndex}`,
    params: [user.branchId],
  };
}

// GET /api/v1/requests?category=Hardware&search=text
router.get("/", async (req, res) => {
  try {
    const user = decodeRequestUser(req);
    const scope = buildRequestScope(user, 1);
    if (scope.unauthorized) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }
    if (scope.forbidden) {
      return res.status(403).json({ success: false, error: "Access denied for your role or branch." });
    }

    const { category, search } = req.query;
    const whereClauses = [];
    const queryParams = [...scope.params];
    let idx = scope.params.length + 1;

    if (scope.clause) whereClauses.push(scope.clause);

    if (category && category !== "All Services") {
      whereClauses.push(`LOWER(c.category_name) = LOWER($${idx})`);
      queryParams.push(category);
      idx++;
    }

    if (search && search.trim()) {
      whereClauses.push(`(
        t.ticket_number ILIKE $${idx} OR
        t.title        ILIKE $${idx} OR
        t.description  ILIKE $${idx} OR
        requester.full_name ILIKE $${idx} OR
        requester.email     ILIKE $${idx} OR
        c.category_name     ILIKE $${idx} OR
        t.status            ILIKE $${idx}
      )`);
      queryParams.push(`%${search.trim()}%`);
      idx++;
    }

    const whereString = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const result = await db.query(
      `SELECT
        t.id,
        t.ticket_number,
        t.title,
        t.description,
        t.priority,
        t.status,
        t.created_at,
        c.category_name                      AS service_category,
        requester.user_id                    AS requester_id,
        requester.full_name                  AS requester_name,
        requester.email                      AS requester_email,
        b.branch_id,
        b.branch_name,
        b.branch_location,
        assignee.full_name                   AS assigned_technician
      FROM tickets t
      LEFT JOIN users requester   ON t.requester_id = requester.user_id
      LEFT JOIN branches b        ON requester.branch_id = b.branch_id
      LEFT JOIN ticket_categories c ON t.category_id = c.category_id
      LEFT JOIN users assignee    ON t.assigned_to = assignee.user_id
      ${whereString}
      ORDER BY t.created_at DESC`,
      queryParams
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Fetch requests error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch service requests." });
  }
});

// GET /api/v1/requests/popular
router.get("/popular", async (req, res) => {
  try {
    const user = decodeRequestUser(req);
    const scope = buildRequestScope(user, 1);
    if (scope.unauthorized) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }
    if (scope.forbidden) {
      return res.status(403).json({ success: false, error: "Access denied for your role or branch." });
    }

    const whereString = scope.clause ? `WHERE ${scope.clause}` : "";

    const result = await db.query(
      `SELECT
        c.category_name  AS service_category,
        COUNT(t.id)::int AS count
      FROM tickets t
      LEFT JOIN users requester   ON t.requester_id = requester.user_id
      LEFT JOIN ticket_categories c ON t.category_id = c.category_id
      ${whereString}
      GROUP BY c.category_name
      ORDER BY count DESC, c.category_name ASC`,
      scope.params
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Fetch popular requests error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch popular services." });
  }
});

// GET /api/v1/requests/:id
router.get("/:id", async (req, res) => {
  try {
    const user = decodeRequestUser(req);
    const scope = buildRequestScope(user, 2); // $1 = ticket id, $2 = branchId
    if (scope.unauthorized) {
      return res.status(401).json({ success: false, error: "Authentication required." });
    }
    if (scope.forbidden) {
      return res.status(403).json({ success: false, error: "Access denied for your role or branch." });
    }

    const queryParams = [req.params.id, ...scope.params];
    const whereClauses = ["t.id = $1"];
    if (scope.clause) whereClauses.push(scope.clause);

    const result = await db.query(
      `SELECT
        t.id,
        t.ticket_number,
        t.title,
        t.description,
        t.priority,
        t.status,
        t.created_at,
        t.resolution_notes,
        c.category_name                      AS service_category,
        requester.user_id                    AS requester_id,
        requester.full_name                  AS requester_name,
        requester.email                      AS requester_email,
        b.branch_id,
        b.branch_name,
        b.branch_location,
        assignee.full_name                   AS assigned_technician
      FROM tickets t
      LEFT JOIN users requester   ON t.requester_id = requester.user_id
      LEFT JOIN branches b        ON requester.branch_id = b.branch_id
      LEFT JOIN ticket_categories c ON t.category_id = c.category_id
      LEFT JOIN users assignee    ON t.assigned_to = assignee.user_id
      WHERE ${whereClauses.join(" AND ")}
      LIMIT 1`,
      queryParams
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Request not found or access denied." });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Fetch request by id error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch service request." });
  }
});

module.exports = router;
