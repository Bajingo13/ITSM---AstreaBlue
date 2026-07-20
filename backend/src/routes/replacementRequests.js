const express = require("express");
const db = require("../../config/db");
const { getRequestContext } = require("./_ticketAccess");
const { uploadTicketAttachments } = require("./_uploads");
const { createNotification } = require("../services/notificationService");
const { emitReplacementChanged } = require("../services/socketService");
const { ensureReplacementSchema } = require("../services/replacementSchemaService");
const { resolvePostRepairAssetStatus } = require("../services/replacementAssetStatusService");

const router = express.Router();

const TERMINAL_STATUSES = new Set(["Completed", "Repaired", "Rejected", "Cancelled"]);
const VALID_TRANSITIONS = {
  Submitted: ["Under Assessment", "Cancelled"],
  "Under Assessment": ["Awaiting Approval", "Repair Recommended", "Cancelled"],
  "Awaiting Approval": ["Approved", "Rejected", "Cancelled"],
  Approved: ["Replacement Reserved", "Cancelled"],
  "Replacement Reserved": ["Issued", "Cancelled"],
  Issued: ["Completed"],
  Completed: [],
  "Repair Recommended": ["In Repair", "Cancelled"],
  "In Repair": ["Repaired"],
  Repaired: [],
  Rejected: [],
  Cancelled: [],
};

function requireReplacementAccess(req, res, next) {
  const context = getRequestContext(req);
  const role = String(context.roleName || "").toLowerCase();
  if (!context.authenticated) return res.status(401).json({ success: false, message: "Authentication required.", data: null });
  if (!["superadmin", "admin", "technician", "employee"].includes(role)) {
    return res.status(403).json({ success: false, message: "Access denied.", data: null });
  }
  if (role !== "superadmin" && role !== "employee" && !context.branchId) {
    return res.status(403).json({ success: false, message: "An assigned branch is required.", data: null });
  }
  req.replacementContext = { ...context, role };
  return next();
}

function scopeSql(req, alias, params) {
  const { role, currentUserId, branchId, filterBranchId } = req.replacementContext;
  if (role === "superadmin") {
    if (filterBranchId) {
      params.push(Number(filterBranchId));
      return `${alias}.branch_id=$${params.length}`;
    }
    return "1=1";
  }
  if (role === "employee") {
    params.push(Number(currentUserId));
    return `${alias}.employee_id=$${params.length}`;
  }
  params.push(Number(branchId));
  return `${alias}.branch_id=$${params.length}`;
}

function canTransition(role, current, next) {
  if (!(VALID_TRANSITIONS[current] || []).includes(next)) return false;
  if (role === "employee") return current === "Submitted" && next === "Cancelled";
  if (role === "technician") {
    return (current === "Submitted" && next === "Under Assessment") ||
      (current === "Under Assessment" && ["Awaiting Approval", "Repair Recommended", "Cancelled"].includes(next));
  }
  return ["admin", "superadmin"].includes(role);
}

async function updateRepairAsset(client, request, nextStatus, actorId, resolution = null) {
  const assetResult = await client.query(`SELECT * FROM hardware_assets WHERE asset_id=$1 FOR UPDATE`, [request.current_asset_id]);
  const asset = assetResult.rows[0];
  if (!asset) throw Object.assign(new Error("The laptop linked to this request no longer exists."), { status: 409 });
  if (Number(asset.branch_id) !== Number(request.branch_id)) {
    throw Object.assign(new Error("The laptop is no longer in the request branch."), { status: 409 });
  }

  let hardwareStatus = "In Repair";
  let eventType = "Replacement request - repair started";
  if (nextStatus === "Repaired") {
    const linkedDevice = await client.query(
      `SELECT 1 FROM monitored_devices WHERE asset_id=$1 AND assigned_user_id IS NOT NULL LIMIT 1`,
      [request.current_asset_id]
    );
    const assigned = Boolean(String(asset.employee_id || "").trim() ||
      String(asset.assigned_name || asset.borrower_name || "").trim() || linkedDevice.rows.length);
    hardwareStatus = resolvePostRepairAssetStatus(request.pre_repair_asset_status, assigned);
    eventType = "Replacement request - repair completed";
  }

  await client.query(
    `UPDATE hardware_assets
        SET status=$1,
            condition_after=CASE WHEN $2::text IS NULL THEN condition_after ELSE $2 END,
            notes=CASE WHEN $2::text IS NULL THEN notes ELSE CONCAT_WS(E'\n',NULLIF(notes,''),$2) END,
            updated_at=CURRENT_TIMESTAMP
      WHERE asset_id=$3`,
    [hardwareStatus, resolution, request.current_asset_id]
  );
  await client.query(
    `INSERT INTO asset_history(asset_id,event_type,event_data,branch_id,created_by)
     VALUES($1,$2,$3::jsonb,$4,$5)`,
    [request.current_asset_id, eventType, JSON.stringify({
      requestNumber: request.request_number,
      requestStatus: nextStatus,
      assetStatus: hardwareStatus,
      previousAssetStatus: nextStatus === "In Repair" ? asset.status : request.pre_repair_asset_status || null,
      resolution: resolution || null,
    }), request.branch_id, actorId]
  );
  return { hardwareStatus, previousStatus: asset.status };
}

async function loadRequest(queryable, id, lock = false) {
  const result = await queryable.query(
    `SELECT rr.*, b.branch_name,
            employee.full_name employee_name, employee.email employee_email, employee.department employee_department,
            requester.full_name requester_name,
            current_asset.asset_tag current_asset_tag, current_asset.asset_name current_asset_name,
            current_asset.serial_number current_asset_serial, current_asset.status current_asset_status,
            replacement_asset.asset_tag replacement_asset_tag, replacement_asset.asset_name replacement_asset_name,
            replacement_asset.serial_number replacement_asset_serial,
            assessor.full_name assessed_by_name, approver.full_name approved_by_name,
            issuer.full_name issued_by_name, completer.full_name completed_by_name,
            t.ticket_number source_ticket_number
       FROM replacement_requests rr
       JOIN branches b ON b.branch_id=rr.branch_id
       JOIN users employee ON employee.user_id=rr.employee_id
       JOIN users requester ON requester.user_id=rr.requester_id
       JOIN hardware_assets current_asset ON current_asset.asset_id=rr.current_asset_id
       LEFT JOIN hardware_assets replacement_asset ON replacement_asset.asset_id=rr.replacement_asset_id
       LEFT JOIN users assessor ON assessor.user_id=rr.assessed_by
       LEFT JOIN users approver ON approver.user_id=rr.approved_by
       LEFT JOIN users issuer ON issuer.user_id=rr.issued_by
       LEFT JOIN users completer ON completer.user_id=rr.completed_by
       LEFT JOIN tickets t ON t.id=rr.source_ticket_id
      WHERE rr.id=$1${lock ? " FOR UPDATE OF rr" : ""}`,
    [id]
  );
  return result.rows[0] || null;
}

async function addHistory(queryable, requestId, actorId, eventType, message, oldStatus = null, newStatus = null, metadata = {}) {
  await queryable.query(
    `INSERT INTO replacement_request_history
       (replacement_request_id,event_type,old_status,new_status,message,metadata,changed_by)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [requestId, eventType, oldStatus, newStatus, message, JSON.stringify(metadata), actorId]
  );
}

async function assertScopedRequest(req, queryable, id, lock = false) {
  const params = [id];
  const scoped = scopeSql(req, "rr", params);
  const allowed = await queryable.query(`SELECT rr.id FROM replacement_requests rr WHERE rr.id=$1 AND ${scoped}${lock ? " FOR UPDATE" : ""}`, params);
  if (!allowed.rows.length) return null;
  return loadRequest(queryable, id, lock);
}

async function nextRequestNumber(client) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`replacement-number-${date}`]);
  const result = await client.query(
    `SELECT request_number FROM replacement_requests
      WHERE request_number LIKE $1 ORDER BY request_number DESC LIMIT 1`,
    [`RPL-${date}-%`]
  );
  const previous = Number(String(result.rows[0]?.request_number || "").split("-").pop()) || 0;
  return `RPL-${date}-${String(previous + 1).padStart(4, "0")}`;
}

async function exchangeAssets(client, request, actorId) {
  const employeeResult = await client.query(
    `SELECT user_id,full_name,email,department,branch_id,onboarding_status,onboarding_required
       FROM users WHERE user_id=$1 FOR UPDATE`,
    [request.employee_id]
  );
  const employee = employeeResult.rows[0];
  if (!employee) throw Object.assign(new Error("Assigned employee no longer exists."), { status: 409 });
  if (employee.onboarding_required || employee.onboarding_status !== "Completed") {
    throw Object.assign(new Error("The employee must complete consent onboarding before a replacement can be issued."), { status: 409 });
  }
  const consent = await client.query(
    `SELECT consent_id FROM consent_documents
      WHERE employee_id=$1 AND status='approved' AND active=true
      ORDER BY approved_at DESC NULLS LAST LIMIT 1`,
    [request.employee_id]
  );
  if (!consent.rows.length) throw Object.assign(new Error("An active approved consent is required before issuing the replacement."), { status: 409 });

  const assets = await client.query(
    `SELECT * FROM hardware_assets WHERE asset_id=ANY($1::int[]) FOR UPDATE`,
    [[request.current_asset_id, request.replacement_asset_id]]
  );
  const oldAsset = assets.rows.find((row) => Number(row.asset_id) === Number(request.current_asset_id));
  const newAsset = assets.rows.find((row) => Number(row.asset_id) === Number(request.replacement_asset_id));
  if (!oldAsset || !newAsset) throw Object.assign(new Error("One of the replacement assets no longer exists."), { status: 409 });
  const oldDevices = await client.query(`SELECT * FROM monitored_devices WHERE asset_id=$1 FOR UPDATE`, [request.current_asset_id]);
  const newDevices = await client.query(`SELECT * FROM monitored_devices WHERE asset_id=$1 FOR UPDATE`, [request.replacement_asset_id]);
  const oldStillAssigned = String(oldAsset.employee_id || "") === String(request.employee_id) ||
    String(oldAsset.assigned_name || oldAsset.borrower_name || "").trim().toLowerCase() === String(employee.full_name || "").trim().toLowerCase() ||
    oldDevices.rows.some((device) => Number(device.assigned_user_id) === Number(request.employee_id));
  if (!oldStillAssigned) throw Object.assign(new Error("The original laptop is no longer assigned to this employee."), { status: 409 });
  if (String(newAsset.employee_id || "").trim() || String(newAsset.assigned_name || newAsset.borrower_name || "").trim()) {
    throw Object.assign(new Error("The selected replacement asset is no longer available."), { status: 409 });
  }
  if (newDevices.rows.some((device) => device.assigned_user_id)) {
    throw Object.assign(new Error("The monitoring device linked to the replacement asset is already assigned."), { status: 409 });
  }
  if (!["active", "available", "in stock"].includes(String(newAsset.status || "").toLowerCase())) {
    throw Object.assign(new Error(`The selected replacement asset is currently ${newAsset.status || "unavailable"}.`), { status: 409 });
  }

  await client.query(
    `UPDATE hardware_assets SET
       employee_id=NULL,assigned_name=NULL,borrower_name=NULL,borrower_email=NULL,
       borrower_department=NULL,actual_return_date=CURRENT_DATE,returned_date=CURRENT_DATE,
       status='In Repair',condition_after=COALESCE($1,condition_after),updated_at=CURRENT_TIMESTAMP
     WHERE asset_id=$2`,
    [request.diagnosis || request.assessment_notes || "Replacement issued after reported hardware failure.", request.current_asset_id]
  );
  await client.query(
    `UPDATE hardware_assets SET
       employee_id=$1,assigned_name=$2,borrower_name=$2,borrower_email=$3,
       department=$4,borrower_department=$4,team_department=$4,branch_id=$5,
       assigned_date=CURRENT_DATE,borrow_date=CURRENT_DATE,actual_return_date=NULL,returned_date=NULL,
       status='Borrowed',updated_at=CURRENT_TIMESTAMP
     WHERE asset_id=$6`,
    [String(employee.user_id), employee.full_name, employee.email || null, employee.department || null, request.branch_id, request.replacement_asset_id]
  );

  await client.query(`UPDATE monitored_devices SET assigned_user_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE asset_id=$1`, [request.current_asset_id]);
  await client.query(
    `UPDATE monitored_devices SET assigned_user_id=$1,branch_id=$2,department=$3,updated_at=CURRENT_TIMESTAMP WHERE asset_id=$4`,
    [request.employee_id, request.branch_id, employee.department || null, request.replacement_asset_id]
  );

  const assignmentTable = await client.query(`SELECT to_regclass('monitored_device_assignments') table_name`);
  if (assignmentTable.rows[0]?.table_name) {
    for (const device of oldDevices.rows) {
      await client.query(
        `INSERT INTO monitored_device_assignments
          (device_id,device_uuid,asset_id,old_user_id,new_user_id,old_branch_id,new_branch_id,old_department,new_department,reason,changed_by)
         VALUES($1,$2,$3,$4,NULL,$5,$5,$6,$6,$7,$8)`,
        [device.device_id, device.device_uuid, device.asset_id, device.assigned_user_id, device.branch_id, device.department, `Unassigned by ${request.request_number}`, actorId]
      );
    }
    for (const device of newDevices.rows) {
      await client.query(
        `INSERT INTO monitored_device_assignments
          (device_id,device_uuid,asset_id,old_user_id,new_user_id,old_branch_id,new_branch_id,old_department,new_department,reason,changed_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [device.device_id, device.device_uuid, device.asset_id, device.assigned_user_id, request.employee_id, device.branch_id, request.branch_id, device.department, employee.department || null, `Assigned by ${request.request_number}`, actorId]
      );
    }
  }

  for (const [assetId, eventType, payload] of [
    [request.current_asset_id, "Replacement - old asset returned", { requestNumber: request.request_number, status: "In Repair" }],
    [request.replacement_asset_id, "Replacement - asset issued", { requestNumber: request.request_number, employeeId: request.employee_id, status: "Borrowed" }],
  ]) {
    await client.query(
      `INSERT INTO asset_history(asset_id,event_type,event_data,branch_id,created_by) VALUES($1,$2,$3::jsonb,$4,$5)`,
      [assetId, eventType, JSON.stringify(payload), request.branch_id, actorId]
    );
  }
}

router.use(async (_req, res, next) => {
  try {
    await ensureReplacementSchema();
    return next();
  } catch (error) {
    console.error("[replacement:schema]", error.message);
    return res.status(503).json({ success: false, message: "Replacement Management is waiting for its database migration.", data: null });
  }
});
router.use(requireReplacementAccess);

router.get("/summary", async (req, res) => {
  try {
    const params = [];
    const scoped = scopeSql(req, "rr", params);
    const result = await db.query(
      `SELECT COUNT(*)::int total,
        COUNT(*) FILTER(WHERE rr.status NOT IN ('Completed','Repaired','Rejected','Cancelled'))::int active,
        COUNT(*) FILTER(WHERE rr.status='Awaiting Approval')::int awaiting_approval,
        COUNT(*) FILTER(WHERE rr.status='Replacement Reserved')::int reserved,
        COUNT(*) FILTER(WHERE rr.status='Completed')::int completed,
        COUNT(*) FILTER(WHERE rr.status='Repair Recommended')::int repair_recommended,
        COUNT(*) FILTER(WHERE rr.status='In Repair')::int in_repair,
        COUNT(*) FILTER(WHERE rr.status='Repaired')::int repaired
       FROM replacement_requests rr WHERE ${scoped}`,
      params
    );
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("[replacement:summary]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load replacement summary.", data: null });
  }
});

router.get("/assets/current", async (req, res) => {
  try {
    const { role, currentUserId, branchId } = req.replacementContext;
    const employeeId = role === "employee" ? currentUserId : Number(req.query.employee_id || 0);
    if (!employeeId) return res.status(400).json({ success: false, message: "employee_id is required.", data: null });
    const params = [employeeId];
    let branchClause = "";
    if (role !== "superadmin" && role !== "employee") { params.push(branchId); branchClause = ` AND a.branch_id=$${params.length}`; }
    const result = await db.query(
      `SELECT DISTINCT a.asset_id,a.asset_tag,a.asset_name,a.asset_type,a.brand,a.model,a.serial_number,a.status,a.branch_id
       FROM hardware_assets a
       LEFT JOIN monitored_devices d ON d.asset_id=a.asset_id
       LEFT JOIN users u ON u.user_id=$1
       WHERE (a.employee_id::text=$1::text OR d.assigned_user_id=$1 OR LOWER(COALESCE(a.assigned_name,a.borrower_name,''))=LOWER(u.full_name))${branchClause}
       ORDER BY a.asset_tag`,
      params
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load assigned assets.", data: null });
  }
});

router.get("/assets/available", async (req, res) => {
  const { role, branchId } = req.replacementContext;
  if (role === "employee") return res.status(403).json({ success: false, message: "Asset reservation is restricted to IT staff.", data: null });
  try {
    const params = [];
    let where = `NULLIF(TRIM(COALESCE(a.employee_id::text,'')),'') IS NULL
      AND NULLIF(TRIM(COALESCE(a.assigned_name,a.borrower_name,'')),'') IS NULL
      AND LOWER(COALESCE(a.status,'')) IN ('active','available','in stock')
      AND NOT EXISTS (
        SELECT 1 FROM replacement_requests rr
        WHERE rr.replacement_asset_id=a.asset_id AND rr.status IN ('Replacement Reserved','Issued')
      )`;
    if (role !== "superadmin") { params.push(branchId); where += ` AND a.branch_id=$${params.length}`; }
    const result = await db.query(
      `SELECT a.asset_id,a.asset_tag,a.asset_name,a.asset_type,a.brand,a.model,a.serial_number,a.status,a.branch_id,b.branch_name
       FROM hardware_assets a LEFT JOIN branches b ON b.branch_id=a.branch_id WHERE ${where} ORDER BY a.asset_tag`,
      params
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load available replacement assets.", data: null });
  }
});

router.get("/tickets/linkable", async (req, res) => {
  try {
    const { role, currentUserId, branchId } = req.replacementContext;
    const employeeId = role === "employee" ? Number(currentUserId) : Number(req.query.employee_id || 0);
    if (!employeeId) return res.status(400).json({ success: false, message: "employee_id is required.", data: null });

    const employeeResult = await db.query(`SELECT user_id,branch_id FROM users WHERE user_id=$1`, [employeeId]);
    const employee = employeeResult.rows[0];
    if (!employee) return res.status(404).json({ success: false, message: "Employee not found.", data: null });
    if (role !== "superadmin" && role !== "employee" && Number(employee.branch_id) !== Number(branchId)) {
      return res.status(403).json({ success: false, message: "The employee must belong to your branch.", data: null });
    }

    const internalOnly = role === "superadmin" ? "" : `
      AND t.integration_id IS NULL
      AND t.origin_system IS NULL
      AND COALESCE(t.created_via,'') <> 'External API'`;
    const result = await db.query(
      `SELECT t.id,t.ticket_number,t.title,t.status,t.priority,t.created_at
         FROM tickets t
        WHERE t.requester_id=$1
          AND t.branch_id=$2
          AND t.status='Open Queue'${internalOnly}
        ORDER BY t.created_at DESC,t.id DESC
        LIMIT 100`,
      [employeeId, employee.branch_id]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("[replacement:linkable-tickets]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load eligible open tickets.", data: null });
  }
});

router.get("/", async (req, res) => {
  try {
    const params = [];
    const clauses = [scopeSql(req, "rr", params)];
    if (req.query.status) { params.push(req.query.status); clauses.push(`rr.status=$${params.length}`); }
    if (req.query.search) {
      params.push(`%${String(req.query.search).trim()}%`);
      clauses.push(`(rr.request_number ILIKE $${params.length} OR rr.title ILIKE $${params.length} OR employee.full_name ILIKE $${params.length} OR asset.asset_tag ILIKE $${params.length})`);
    }
    const result = await db.query(
      `SELECT rr.*,employee.full_name employee_name,b.branch_name,asset.asset_tag current_asset_tag,
              asset.asset_name current_asset_name,replacement.asset_tag replacement_asset_tag
       FROM replacement_requests rr
       JOIN users employee ON employee.user_id=rr.employee_id
       JOIN branches b ON b.branch_id=rr.branch_id
       JOIN hardware_assets asset ON asset.asset_id=rr.current_asset_id
       LEFT JOIN hardware_assets replacement ON replacement.asset_id=rr.replacement_asset_id
       WHERE ${clauses.join(" AND ")} ORDER BY rr.updated_at DESC LIMIT 500`,
      params
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("[replacement:list]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load replacement requests.", data: null });
  }
});

router.post("/", async (req, res) => {
  const client = await db.rawPool.connect();
  try {
    const { role, currentUserId, branchId } = req.replacementContext;
    const employeeId = role === "employee" ? Number(currentUserId) : Number(req.body.employee_id);
    const assetId = Number(req.body.current_asset_id);
    if (!employeeId || !assetId || !String(req.body.description || "").trim()) {
      return res.status(400).json({ success: false, message: "Employee, current asset, and problem description are required.", data: null });
    }
    await client.query("BEGIN");
    const employeeResult = await client.query(`SELECT user_id,full_name,branch_id FROM users WHERE user_id=$1`, [employeeId]);
    const employee = employeeResult.rows[0];
    if (!employee) throw Object.assign(new Error("Employee not found."), { status: 404 });
    if (role !== "superadmin" && role !== "employee" && Number(employee.branch_id) !== Number(branchId)) {
      throw Object.assign(new Error("The employee must belong to your branch."), { status: 403 });
    }
    const assetResult = await client.query(
      `SELECT a.*,EXISTS(SELECT 1 FROM monitored_devices d WHERE d.asset_id=a.asset_id AND d.assigned_user_id=$2) device_match
       FROM hardware_assets a WHERE a.asset_id=$1 FOR UPDATE`,
      [assetId, employeeId]
    );
    const asset = assetResult.rows[0];
    if (!asset) throw Object.assign(new Error("Current asset not found."), { status: 404 });
    const assignedMatches = String(asset.employee_id || "") === String(employeeId) || asset.device_match ||
      String(asset.assigned_name || asset.borrower_name || "").trim().toLowerCase() === String(employee.full_name || "").trim().toLowerCase();
    if (!assignedMatches) throw Object.assign(new Error("The selected laptop is not assigned to this employee."), { status: 409 });
    if (Number(asset.branch_id) !== Number(employee.branch_id)) throw Object.assign(new Error("Employee and asset branches do not match."), { status: 409 });

    if (req.body.source_ticket_id) {
      const ticket = await client.query(`SELECT requester_id,branch_id,integration_id,origin_system,created_via,status FROM tickets WHERE id=$1`, [req.body.source_ticket_id]);
      if (!ticket.rows.length) throw Object.assign(new Error("Linked ticket not found."), { status: 404 });
      const linked = ticket.rows[0];
      if (linked.status !== "Open Queue") throw Object.assign(new Error("Only an Open Queue ticket can be linked to a new replacement request."), { status: 409 });
      if (role === "employee" && Number(linked.requester_id) !== employeeId) throw Object.assign(new Error("You can only link your own ticket."), { status: 403 });
      if (role !== "superadmin" && (linked.integration_id || linked.origin_system || linked.created_via === "External API" || Number(linked.branch_id) !== Number(employee.branch_id))) {
        throw Object.assign(new Error("The linked ticket is outside your permitted branch scope."), { status: 403 });
      }
    }

    const requestNumber = await nextRequestNumber(client);
    const inserted = await client.query(
      `INSERT INTO replacement_requests
       (request_number,requester_id,employee_id,branch_id,current_asset_id,source_ticket_id,title,description,damage_type,urgency)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [requestNumber, currentUserId, employeeId, employee.branch_id, assetId, req.body.source_ticket_id || null,
       String(req.body.title || `Replacement request for ${asset.asset_tag}`).trim(), String(req.body.description).trim(),
       req.body.damage_type || null, ["Low", "Medium", "High", "Critical"].includes(req.body.urgency) ? req.body.urgency : "Medium"]
    );
    await addHistory(client, inserted.rows[0].id, currentUserId, "request_created", "Replacement request submitted.", null, "Submitted", { assetId });
    await client.query("COMMIT");
    emitReplacementChanged({ action: "created", requestId: inserted.rows[0].id });
    return res.status(201).json({ success: true, message: "Replacement request submitted.", data: await loadRequest(db, inserted.rows[0].id) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[replacement:create]", error.message);
    return res.status(error.status || (error.code === "23505" ? 409 : 500)).json({ success: false, message: error.code === "23505" ? "An active replacement request already exists for this asset." : error.message || "Failed to create replacement request.", data: null });
  } finally {
    client.release();
  }
});

router.get("/:id", async (req, res) => {
  try {
    const request = await assertScopedRequest(req, db, req.params.id);
    if (!request) return res.status(404).json({ success: false, message: "Replacement request not found.", data: null });
    const [history, attachments] = await Promise.all([
      db.query(`SELECT h.*,u.full_name changed_by_name FROM replacement_request_history h LEFT JOIN users u ON u.user_id=h.changed_by WHERE h.replacement_request_id=$1 ORDER BY h.created_at DESC`, [req.params.id]),
      db.query(`SELECT * FROM replacement_request_attachments WHERE replacement_request_id=$1 ORDER BY created_at DESC`, [req.params.id]),
    ]);
    return res.json({ success: true, data: { ...request, history: history.rows, attachments: attachments.rows } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load replacement request.", data: null });
  }
});

router.patch("/:id/assessment", async (req, res) => {
  const { role, currentUserId } = req.replacementContext;
  if (role === "employee") return res.status(403).json({ success: false, message: "Assessment is restricted to IT staff.", data: null });
  try {
    const request = await assertScopedRequest(req, db, req.params.id);
    if (!request) return res.status(404).json({ success: false, message: "Replacement request not found.", data: null });
    if (TERMINAL_STATUSES.has(request.status) || ["Issued", "Completed"].includes(request.status)) return res.status(409).json({ success: false, message: "This request can no longer be assessed.", data: null });
    const result = await db.query(
      `UPDATE replacement_requests SET diagnosis=$1,assessment_notes=$2,recommendation=$3,assessed_by=$4,assessed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$5 RETURNING *`,
      [req.body.diagnosis || null, req.body.assessment_notes || null, req.body.recommendation || null, currentUserId, req.params.id]
    );
    await addHistory(db, req.params.id, currentUserId, "assessment_updated", "Technical assessment updated.", request.status, request.status);
    emitReplacementChanged({ action: "assessment_updated", requestId: req.params.id });
    return res.json({ success: true, message: "Assessment saved.", data: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to save assessment.", data: null });
  }
});

router.patch("/:id/status", async (req, res) => {
  const client = await db.rawPool.connect();
  let requesterId = null;
  let committed = false;
  try {
    const { role, currentUserId } = req.replacementContext;
    const next = String(req.body.status || "");
    await client.query("BEGIN");
    const request = await assertScopedRequest(req, client, req.params.id, true);
    if (!request) throw Object.assign(new Error("Replacement request not found."), { status: 404 });
    requesterId = request.employee_id;
    if (!canTransition(role, request.status, next)) throw Object.assign(new Error(`The ${request.status} request cannot move to ${next || "an empty status"} for your role.`), { status: 409 });
    if (next === "Awaiting Approval" && !String(req.body.diagnosis || request.diagnosis || "").trim()) {
      throw Object.assign(new Error("A technical diagnosis is required before requesting approval."), { status: 400 });
    }
    if (next === "Rejected" && !String(req.body.rejection_reason || "").trim()) throw Object.assign(new Error("A rejection reason is required."), { status: 400 });
    if (next === "Repair Recommended" && !String(req.body.recommendation || request.recommendation || "").trim()) throw Object.assign(new Error("A repair recommendation is required."), { status: 400 });
    if (next === "Repaired" && !String(req.body.repair_resolution || "").trim()) throw Object.assign(new Error("Repair resolution details are required before returning the laptop to service."), { status: 400 });
    const replacementAssetId = Number(req.body.replacement_asset_id || request.replacement_asset_id || 0) || null;
    if (["Replacement Reserved", "Issued"].includes(next) && !replacementAssetId) throw Object.assign(new Error("Select an available replacement asset first."), { status: 400 });

    if (next === "Replacement Reserved") {
      const available = await client.query(
        `SELECT asset_id,status,employee_id,assigned_name,borrower_name,branch_id FROM hardware_assets WHERE asset_id=$1 FOR UPDATE`,
        [replacementAssetId]
      );
      const asset = available.rows[0];
      const conflictingReservation = asset ? await client.query(
        `SELECT id FROM replacement_requests WHERE replacement_asset_id=$1 AND id<>$2 AND status IN ('Replacement Reserved','Issued') FOR UPDATE`,
        [replacementAssetId, request.id]
      ) : { rows: [] };
      if (!asset || conflictingReservation.rows.length || String(asset.employee_id || "").trim() || String(asset.assigned_name || asset.borrower_name || "").trim() ||
          !["active", "available", "in stock"].includes(String(asset.status || "").toLowerCase())) {
        throw Object.assign(new Error("The selected replacement asset is not available."), { status: 409 });
      }
      if (role !== "superadmin" && Number(asset.branch_id) !== Number(request.branch_id)) throw Object.assign(new Error("The replacement asset must belong to your branch."), { status: 403 });
    }
    if (next === "Issued") await exchangeAssets(client, { ...request, replacement_asset_id: replacementAssetId }, currentUserId);
    let repairAssetUpdate = null;
    if (next === "In Repair") repairAssetUpdate = await updateRepairAsset(client, request, next, currentUserId);
    if (next === "Repaired") repairAssetUpdate = await updateRepairAsset(client, request, next, currentUserId, String(req.body.repair_resolution).trim());

    const fields = ["status=$1", "updated_at=CURRENT_TIMESTAMP"];
    const values = [next];
    const set = (sql, value) => { values.push(value); fields.push(`${sql}=$${values.length}`); };
    if (req.body.diagnosis !== undefined) set("diagnosis", req.body.diagnosis || null);
    if (req.body.assessment_notes !== undefined) set("assessment_notes", req.body.assessment_notes || null);
    if (req.body.recommendation !== undefined) set("recommendation", req.body.recommendation || null);
    if (req.body.approval_notes !== undefined) set("approval_notes", req.body.approval_notes || null);
    if (req.body.rejection_reason !== undefined) set("rejection_reason", req.body.rejection_reason || null);
    if (req.body.repair_resolution !== undefined) set("repair_resolution", req.body.repair_resolution || null);
    if (replacementAssetId) set("replacement_asset_id", replacementAssetId);
    if (next === "Under Assessment") { set("assessed_by", currentUserId); fields.push("assessed_at=CURRENT_TIMESTAMP"); }
    if (next === "Approved") { set("approved_by", currentUserId); fields.push("approved_at=CURRENT_TIMESTAMP"); }
    if (next === "Replacement Reserved") { set("reserved_by", currentUserId); fields.push("reserved_at=CURRENT_TIMESTAMP"); }
    if (next === "Issued") { set("issued_by", currentUserId); fields.push("issued_at=CURRENT_TIMESTAMP"); }
    if (next === "Completed") { set("completed_by", currentUserId); fields.push("completed_at=CURRENT_TIMESTAMP"); }
    if (next === "Cancelled") { set("cancelled_by", currentUserId); fields.push("cancelled_at=CURRENT_TIMESTAMP"); }
    if (next === "In Repair") {
      set("repair_started_by", currentUserId);
      set("pre_repair_asset_status", repairAssetUpdate.previousStatus || null);
      fields.push("repair_started_at=CURRENT_TIMESTAMP");
    }
    if (next === "Repaired") { set("repaired_by", currentUserId); fields.push("repaired_at=CURRENT_TIMESTAMP"); }
    values.push(req.params.id);
    await client.query(`UPDATE replacement_requests SET ${fields.join(",")} WHERE id=$${values.length}`, values);
    await addHistory(client, req.params.id, currentUserId, "status_changed", `Status changed from ${request.status} to ${next}.`, request.status, next, {
      replacementAssetId,
      assetStatus: repairAssetUpdate?.hardwareStatus || null,
      previousAssetStatus: next === "In Repair" ? repairAssetUpdate?.previousStatus || null : request.pre_repair_asset_status || null,
    });
    await client.query("COMMIT");
    committed = true;
    emitReplacementChanged({ action: "status_changed", requestId: req.params.id });
    const updated = await loadRequest(db, req.params.id);
    createNotification({
      userId: requesterId,
      title: `Replacement request ${next}`,
      message: `${request.request_number} is now ${next}.`,
      type: ["Rejected", "Cancelled"].includes(next) ? "warning" : "info",
      relatedEntityType: "replacement_request",
      relatedEntityId: req.params.id,
      metadata: { path: "/replacement-requests", requestNumber: request.request_number },
    }).catch((error) => console.error("[replacement:notification]", error.message));
    return res.json({ success: true, message: `Replacement request moved to ${next}.`, data: updated });
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    console.error("[replacement:transition]", error.message);
    const message = error.code === "23505" ? "The selected asset was reserved by another request. Choose a different asset." : error.message;
    return res.status(error.status || (error.code === "23505" ? 409 : 500)).json({ success: false, message: message || "Failed to update replacement request.", data: null });
  } finally {
    client.release();
  }
});

router.post("/:id/attachments", (req, res) => {
  uploadTicketAttachments.array("attachments", 5)(req, res, async (error) => {
    if (error) return res.status(400).json({ success: false, message: error.message, data: null });
    try {
      const request = await assertScopedRequest(req, db, req.params.id);
      if (!request) return res.status(404).json({ success: false, message: "Replacement request not found.", data: null });
      const saved = [];
      for (const file of req.files || []) {
        const row = await db.query(
          `INSERT INTO replacement_request_attachments(replacement_request_id,file_name,file_url,mime_type,file_size,uploaded_by)
           VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          [req.params.id, file.originalname, `/uploads/tickets/${file.filename}`, file.mimetype, file.size, req.replacementContext.currentUserId]
        );
        saved.push(row.rows[0]);
      }
      await addHistory(db, req.params.id, req.replacementContext.currentUserId, "attachments_added", `${saved.length} attachment(s) uploaded.`);
      return res.status(201).json({ success: true, message: "Attachments uploaded.", data: saved });
    } catch (saveError) {
      return res.status(500).json({ success: false, message: "Failed to save attachments.", data: null });
    }
  });
});

module.exports = router;
