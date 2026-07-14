const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../../config/db");
const { getRequestContext } = require("./_ticketAccess");
const { uploadTicketAttachments } = require("./_uploads");

const router = express.Router();
let workflowSchemaReady;

async function ensureWorkflowSchema() {
  if (workflowSchemaReady) return workflowSchemaReady;
  workflowSchemaReady = (async () => {
    const client = await db.rawPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["astreablue_change_request_workflow_v1"]);
      const readiness = await client.query(`SELECT
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='change_requests' AND column_name='assigned_technician_id')
        AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='change_requests' AND column_name='business_justification')
        AND to_regclass('change_cab_members') IS NOT NULL
        AND to_regclass('change_cab_reviews') IS NOT NULL
        AND to_regclass('change_implementation_updates') IS NOT NULL
        AND to_regclass('change_schedule_history') IS NOT NULL AS ready`);
      if (!readiness.rows[0]?.ready) {
        const migrationPath = path.join(__dirname, "../../database/2026-07-14-change-request-workflow.sql");
        console.warn("[Change Release] workflow schema is behind; applying the workflow migration.");
        await client.query(fs.readFileSync(migrationPath, "utf8"));
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      workflowSchemaReady = null;
      throw error;
    } finally {
      client.release();
    }
  })();
  return workflowSchemaReady;
}

router.use(async (req, res, next) => {
  try {
    await ensureWorkflowSchema();
    next();
  } catch (error) {
    console.error("Change workflow schema bootstrap error:", error.message);
    res.status(503).json({ success: false, message: "Change Management is waiting for its database migration. Please retry shortly.", data: null });
  }
});

const RELEASE_FLOW = ["Planned", "Scheduled", "Deploying", "Verifying", "Completed", "Closed"];
const ROLLBACK_FLOW = ["Draft", "Approved", "Available", "Executed", "Verified"];

const CHANGE_FLOW_ORDER = ['Draft','Submitted','Under Assessment','Pending Manager Approval','Pending CAB Review','Approved','Rejected','Scheduled','In Progress','Implemented','Validation Pending','Completed','Failed','Rolled Back','Cancelled'];

const VALID_TRANSITIONS = {
  'Draft': ['Submitted'],
  'Submitted': ['Under Assessment', 'Cancelled'],
  'Under Assessment': ['Pending Manager Approval', 'Rejected', 'Cancelled'],
  'Pending Manager Approval': ['Pending CAB Review', 'Approved', 'Rejected', 'Cancelled'],
  'Pending CAB Review': ['Approved', 'Rejected', 'Cancelled'],
  'Approved': ['Scheduled', 'Rejected'],
  'Rejected': ['Draft', 'Cancelled'],
  'Scheduled': ['In Progress', 'Cancelled'],
  'In Progress': ['Implemented', 'Failed', 'Rolled Back'],
  'Implemented': ['Validation Pending', 'Completed', 'Failed', 'Rolled Back'],
  'Validation Pending': ['Completed', 'Failed', 'Rolled Back'],
  'Completed': [],
  'Failed': ['Draft', 'Cancelled'],
  'Rolled Back': ['Draft', 'Cancelled'],
  'Cancelled': []
};

function requireChangeAccess(req, res, next) {
  const context = getRequestContext(req);
  const role = String(context.roleName || '').toLowerCase();
  if (!context.authenticated) return res.status(401).json({ success: false, message: 'Authentication required.', data: null });
  if (!['superadmin','admin','technician','employee'].includes(role)) return res.status(403).json({ success: false, message: 'Access denied.', data: null });
  if (['admin','technician','employee'].includes(role) && !context.branchId && role !== 'employee')
    return res.status(403).json({ success: false, message: 'An assigned branch is required.', data: null });
  req.changeContext = { ...context, role };
  next();
}

const branchForWrite = (req) => req.changeContext.role === "superadmin" ? Number(req.body.branch_id) : Number(req.changeContext.branchId);
const branchScope = (req, alias, params) => {
  if (req.changeContext.role === 'superadmin') {
    if (req.changeContext.filterBranchId) {
      params.push(req.changeContext.filterBranchId);
      return `${alias}.branch_id=$${params.length}`;
    }
    return '1=1';
  }
  if (req.changeContext.role === 'employee') {
    params.push(req.changeContext.currentUserId);
    return `${alias}.requester_id=$${params.length}`;
  }
  params.push(req.changeContext.branchId);
  return `${alias}.branch_id=$${params.length}`;
};
const operationScope = (req, alias, params) => {
  if (req.changeContext.role === 'superadmin') return '1=1';
  if (req.changeContext.role === 'employee') return '1=0'; // Employees don't see releases/rollbacks
  params.push(req.changeContext.branchId);
  return `${alias}.branch_id=$${params.length}`;
};
const safeArray = (value) => Array.isArray(value) ? value : [];
const positiveInt = (value, fallback) => Math.max(1, Number.parseInt(value, 10) || fallback);
const ensureNextStatus = (flow, current, next) => flow.indexOf(next) === flow.indexOf(current) + 1;

async function nextNumber(client, prefix, table, column) {
  const res = await client.query(`SELECT ${column} FROM ${table} WHERE ${column} LIKE $1 ORDER BY id DESC LIMIT 1`, [`${prefix}%`]);
  const last = res.rows[0] ? Number(res.rows[0][column].slice(prefix.length)) : 0;
  return `${prefix}${String(last + 1).padStart(5, "0")}`;
}
router.get("/summary", requireChangeAccess, async (req, res) => {
  try {
    const params = [];
    const changeWhere = branchScope(req, "c", params);
    const releaseParams = [];
    const releaseWhere = operationScope(req, "r", releaseParams);
    const rollbackParams = [];
    const rollbackWhere = operationScope(req, "rb", rollbackParams);
    const [changes, releases, rollbacks, trend, recent, openChangesRes, cabQueueRes, emergChangesRes, scheduledRes] = await Promise.all([
      db.query(`SELECT COUNT(*)::int total,
        COUNT(*) FILTER(WHERE c.status NOT IN ('Completed','Closed'))::int pending_changes,
        COUNT(*) FILTER(WHERE c.status='CAB Review')::int cab_queue,
        COUNT(*) FILTER(WHERE c.status='In Progress')::int active_changes,
        COUNT(*) FILTER(WHERE c.status='Completed')::int completed_changes,
        COUNT(*) FILTER(WHERE c.status='Closed')::int closed_changes
        FROM change_requests c WHERE ${changeWhere}`, params),
      db.query(`SELECT COUNT(*)::int total,
        COUNT(*) FILTER(WHERE r.scheduled_start BETWEEN NOW() AND NOW()+INTERVAL '30 days')::int upcoming_releases,
        COUNT(*) FILTER(WHERE r.status IN ('Completed','Closed'))::int successful_releases,
        COUNT(*) FILTER(WHERE r.status='Deploying')::int deploying
        FROM release_plans r WHERE ${releaseWhere}`, releaseParams),
      db.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE rb.status IN ('Approved','Available','Verified'))::int ready
        FROM rollback_procedures rb WHERE ${rollbackWhere}`, rollbackParams),
      db.query(`SELECT TO_CHAR(DATE_TRUNC('month',c.created_at),'YYYY-MM') period,COUNT(*)::int count,
        COUNT(*) FILTER(WHERE c.status IN ('Completed','Closed'))::int successful
        FROM change_requests c WHERE ${changeWhere} AND c.created_at>=CURRENT_DATE-INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month',c.created_at) ORDER BY DATE_TRUNC('month',c.created_at)`, params),
      db.query(`SELECT a.event_type,a.message,a.created_at,c.change_number,c.title
        FROM change_activities a JOIN change_requests c ON c.id=a.change_id WHERE ${changeWhere}
        ORDER BY a.created_at DESC LIMIT 8`, params),
      db.query(`SELECT COUNT(*)::int count FROM change_requests c WHERE ${changeWhere} AND c.status NOT IN ('Completed','Closed','Cancelled')`, params),
      db.query(`SELECT COUNT(*)::int count FROM change_requests c WHERE ${changeWhere} AND c.status='Pending CAB Review'`, params),
      db.query(`SELECT COUNT(*)::int count FROM change_requests c WHERE ${changeWhere} AND c.change_type='Emergency'`, params),
      db.query(`SELECT COUNT(*)::int count FROM change_requests c WHERE ${changeWhere} AND c.status='Scheduled'`, params),
    ]);
    const c = changes.rows[0] || {}; const r = releases.rows[0] || {}; const rb = rollbacks.rows[0] || {};
    const deploymentTotal = Number(r.successful_releases || 0) + Number(r.deploying || 0);
    res.json({ success: true, message: "Change and release summary loaded.", data: {
      pending_changes: Number(c.pending_changes || 0), cab_queue: Number(c.cab_queue || 0), active_changes: Number(c.active_changes || 0),
      upcoming_releases: Number(r.upcoming_releases || 0), rollback_readiness_pct: Number(rb.total) ? Math.round(Number(rb.ready) / Number(rb.total) * 100) : 0,
      deployment_success_pct: deploymentTotal ? Math.round(Number(r.successful_releases) / deploymentTotal * 100) : 0,
      trend: trend.rows, recent_activity: recent.rows,
      open_changes: Number(openChangesRes.rows[0]?.count || 0),
      cab_queue_count: Number(cabQueueRes.rows[0]?.count || 0),
      emergency_changes: Number(emergChangesRes.rows[0]?.count || 0),
      scheduled: Number(scheduledRes.rows[0]?.count || 0),
    }});
  } catch (error) { console.error("Change summary error:", error.message); res.status(500).json({ success: false, message: "Failed to load Change and Release summary.", data: null }); }
});

router.get("/changes", requireChangeAccess, async (req, res) => {
  try {
    const params = []; const clauses = [branchScope(req, "c", params)];
    if (req.query.status) { params.push(req.query.status); clauses.push(`c.status=$${params.length}`); }
    if (req.query.type) { params.push(req.query.type); clauses.push(`c.change_type=$${params.length}`); }
    if (req.query.search) { params.push(`%${req.query.search}%`); clauses.push(`(c.change_number ILIKE $${params.length} OR c.title ILIKE $${params.length})`); }
    if (req.query.date_from) { params.push(req.query.date_from); clauses.push(`c.planned_start::date >= $${params.length}`); }
    if (req.query.date_to) { params.push(req.query.date_to); clauses.push(`c.planned_start::date <= $${params.length}`); }
    if (req.query.risk_level) { params.push(req.query.risk_level); clauses.push(`c.risk_level=$${params.length}`); }
    if (req.query.change_type) { params.push(req.query.change_type); clauses.push(`c.change_type=$${params.length}`); }
    const page = positiveInt(req.query.page, 1); const limit = Math.min(100, positiveInt(req.query.limit, 25)); const offset = (page - 1) * limit;
    params.push(limit, offset); const limitPos = params.length - 1; const offsetPos = params.length;
    const sortBy = req.query.sort_by || 'c.updated_at'; const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const allowedSorts = ['c.updated_at','c.created_at','c.planned_start','c.scheduled_date','c.title','c.status','c.priority','c.risk_level'];
    const safeSort = allowedSorts.includes(sortBy) ? sortBy : 'c.updated_at';
    const result = await db.query(`SELECT c.*,b.branch_name,u.full_name owner_name,tech.full_name assigned_technician_name,COUNT(*) OVER()::int total_count
      FROM change_requests c LEFT JOIN branches b ON b.branch_id=c.branch_id LEFT JOIN users u ON u.user_id=c.owner_id LEFT JOIN users tech ON tech.user_id=c.assigned_technician_id
      WHERE ${clauses.join(" AND ")} ORDER BY ${safeSort} ${sortOrder} LIMIT $${limitPos} OFFSET $${offsetPos}`, params);
    res.json({ success: true, message: "Change requests loaded.", data: result.rows, meta: { page, limit, total: result.rows[0]?.total_count || 0 } });
  } catch (error) { console.error("List changes error:", error.message); res.status(500).json({ success: false, message: "Failed to load change requests.", data: null }); }
});

router.post("/changes", requireChangeAccess, async (req, res) => {
  const branchId = branchForWrite(req);
  if (!branchId || !String(req.body.title || "").trim()) return res.status(400).json({ success: false, message: "Title and branch are required.", data: null });
  const client = await db.rawPool.connect();
  try {
    await client.query("BEGIN");
    const number = await nextNumber(client, "CHG", "change_requests", "change_number");
    const ownerId = req.changeContext.role === "superadmin" && req.body.owner_id ? req.body.owner_id : req.changeContext.currentUserId;
    const values = [number, req.body.title.trim(), req.body.description || null, req.body.change_type || "Normal", req.body.category || "Infrastructure", req.body.priority || "Medium", branchId, req.changeContext.currentUserId, ownerId, req.body.planned_start || null, req.body.planned_end || null, req.body.impact_level || "Medium", req.body.risk_level || "Medium", req.body.implementation_plan || null, req.body.backout_plan || null, req.body.communication_plan || null, JSON.stringify(safeArray(req.body.linked_assets)), JSON.stringify(safeArray(req.body.linked_services)), JSON.stringify(safeArray(req.body.linked_cis)), JSON.stringify(safeArray(req.body.linked_incidents)), JSON.stringify(safeArray(req.body.linked_problems)), req.body.business_justification || null, req.body.testing_plan || null, req.body.post_implementation_verification || null, req.body.risk_score || 0, req.body.security_impact || 'None', req.body.compliance_impact || 'None', req.body.data_loss_risk || 'None', req.body.operational_risk || 'None', req.body.assigned_technician_id || null, req.body.scheduled_date || null];
    const result = await client.query(`INSERT INTO change_requests(change_number,title,description,change_type,category,priority,branch_id,requester_id,owner_id,planned_start,planned_end,impact_level,risk_level,implementation_plan,backout_plan,communication_plan,linked_assets,linked_services,linked_cis,linked_incidents,linked_problems,business_justification,testing_plan,post_implementation_verification,risk_score,security_impact,compliance_impact,data_loss_risk,operational_risk,assigned_technician_id,scheduled_date)
      VALUES(${values.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`, values);
    await client.query("INSERT INTO change_activities(change_id,actor_id,event_type,message) VALUES($1,$2,'created',$3)", [result.rows[0].id, req.changeContext.currentUserId, `Change request ${number} created.`]);
    await client.query("COMMIT"); res.status(201).json({ success: true, message: "Change request created.", data: result.rows[0] });
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); console.error("Create change error:", error.message); res.status(500).json({ success: false, message: "Failed to create change request.", data: null }); } finally { client.release(); }
});

router.get("/changes/:id", requireChangeAccess, async (req, res) => {
  try {
    const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    const change = await db.query(`SELECT c.*,b.branch_name,u.full_name owner_name,tech.full_name assigned_technician_name FROM change_requests c LEFT JOIN branches b ON b.branch_id=c.branch_id LEFT JOIN users u ON u.user_id=c.owner_id LEFT JOIN users tech ON tech.user_id=c.assigned_technician_id WHERE c.id=$1 AND ${scoped}`, params);
    if (!change.rows.length) return res.status(404).json({ success: false, message: "Change request not found.", data: null });
    const [activities, approvals, releases, attachments, cabMembers, cabReviews, implUpdates, schedHistory] = await Promise.all([
      db.query("SELECT a.*,u.full_name actor_name FROM change_activities a LEFT JOIN users u ON u.user_id=a.actor_id WHERE a.change_id=$1 ORDER BY a.created_at DESC", [req.params.id]),
      db.query("SELECT a.*,u.full_name approver_name FROM change_approvals a LEFT JOIN users u ON u.user_id=a.approver_id WHERE a.change_id=$1 ORDER BY a.created_at DESC", [req.params.id]),
      db.query("SELECT r.* FROM release_plans r JOIN change_release_links l ON l.release_id=r.id WHERE l.change_id=$1 ORDER BY r.scheduled_start", [req.params.id]),
      db.query("SELECT * FROM change_attachments WHERE change_id=$1 ORDER BY created_at DESC", [req.params.id]),
      db.query("SELECT cm.*,u.full_name member_name FROM change_cab_members cm LEFT JOIN users u ON u.user_id=cm.user_id WHERE cm.change_id=$1 ORDER BY cm.created_at", [req.params.id]),
      db.query("SELECT cr.*,u.full_name reviewer_name FROM change_cab_reviews cr LEFT JOIN users u ON u.user_id=cr.reviewed_by WHERE cr.change_id=$1 ORDER BY cr.created_at DESC", [req.params.id]),
      db.query("SELECT ci.*,u.full_name performed_by_name FROM change_implementation_updates ci LEFT JOIN users u ON u.user_id=ci.performed_by WHERE ci.change_id=$1 ORDER BY ci.created_at DESC", [req.params.id]),
      db.query("SELECT sh.*,u.full_name changed_by_name FROM change_schedule_history sh LEFT JOIN users u ON u.user_id=sh.changed_by WHERE sh.change_id=$1 ORDER BY sh.created_at DESC", [req.params.id]),
    ]);
    res.json({ success: true, message: "Change request loaded.", data: { ...change.rows[0], activities: activities.rows, approvals: approvals.rows, releases: releases.rows, attachments: attachments.rows, cab_members: cabMembers.rows, cab_reviews: cabReviews.rows, implementation_updates: implUpdates.rows, schedule_history: schedHistory.rows } });
  } catch (error) { res.status(500).json({ success: false, message: "Failed to load change request.", data: null }); }
});

router.get("/changes/:id/actions", requireChangeAccess, async (req, res) => {
  try {
    const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    const current = await db.query(`SELECT c.* FROM change_requests c WHERE c.id=$1 AND ${scoped}`, params);
    if (!current.rows.length) return res.status(404).json({ success: false, message: "Change request not found.", data: null });
    const change = current.rows[0];
    const role = req.changeContext.role;
    const nextStatuses = VALID_TRANSITIONS[change.status] || [];
    let actions = nextStatuses.map(s => ({ action: s, label: `Move to ${s}` }));
    if (role === 'employee' && change.requester_id !== req.changeContext.currentUserId) {
      actions = actions.filter(a => a.action === 'Cancelled');
    }
    if (['Approved','Rejected'].some(s => actions.some(a => a.action === s)) && !['superadmin','admin'].includes(role)) {
      actions = actions.filter(a => !['Approved','Rejected'].includes(a.action));
    }
    if (change.status === 'In Progress' && role === 'technician' && change.assigned_technician_id !== req.changeContext.currentUserId) {
      actions = actions.filter(a => !['Implemented','Failed','Rolled Back'].includes(a.action));
    }
    if (change.status === 'Draft' && role === 'employee' && change.requester_id === req.changeContext.currentUserId) {
      if (!actions.some(a => a.action === 'Cancelled')) actions.push({ action: 'Cancelled', label: 'Cancel' });
    }
    res.json({ success: true, message: "Available actions loaded.", data: { current_status: change.status, valid_transitions: VALID_TRANSITIONS[change.status] || [], actions } });
  } catch (error) { res.status(500).json({ success: false, message: "Failed to load available actions.", data: null }); }
});

router.patch("/changes/:id/status", requireChangeAccess, async (req, res) => {
  if (!req.body.status || !String(req.body.status).trim()) {
    return res.status(400).json({ success: false, message: "Status field is required.", data: null });
  }
  const client = await db.rawPool.connect();
  let transitionStage = "begin";
  try {
    await client.query("BEGIN"); const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    transitionStage = "validate_actor";
    const actor = await client.query("SELECT 1 FROM users WHERE user_id=$1 AND is_active=TRUE", [req.changeContext.currentUserId]);
    if (!actor.rows.length) {
      await client.query("ROLLBACK");
      return res.status(401).json({ success: false, message: "Your session is no longer valid. Please sign in again.", data: null });
    }
    transitionStage = "lock_change";
    const current = await client.query(`SELECT * FROM change_requests c WHERE c.id=$1 AND ${scoped} FOR UPDATE`, params);
    if (!current.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Change request not found.", data: null }); }
    const change = current.rows[0]; const next = req.body.status;
    const validNext = VALID_TRANSITIONS[change.status];
    if (!validNext || !validNext.includes(next)) { await client.query("ROLLBACK"); return res.status(400).json({ success: false, message: `Invalid transition from '${change.status}' to '${next}'. Allowed: ${(validNext||[]).join(', ') || 'none'}.`, data: null }); }
    const role = req.changeContext.role;
    if (['Approved','Rejected'].includes(next) && !['superadmin','admin'].includes(role)) { await client.query("ROLLBACK"); return res.status(403).json({ success: false, message: 'Only administrators can approve or reject changes.', data: null }); }
    if (next === 'In Progress' && role === 'technician' && change.assigned_technician_id !== req.changeContext.currentUserId) { await client.query("ROLLBACK"); return res.status(403).json({ success: false, message: 'You are not the assigned technician for this change.', data: null }); }
    if (next === 'Cancelled' && !['superadmin','admin'].includes(role) && change.requester_id !== req.changeContext.currentUserId) { await client.query("ROLLBACK"); return res.status(403).json({ success: false, message: 'Only the requester or an admin can cancel this change.', data: null }); }
    let extraFields = '';
    const extraValues = [];
    if (next === 'In Progress') { extraFields = ',actual_start=NOW(),implementation_started_at=NOW()'; }
    if (next === 'Implemented') { extraFields = ',implemented_at=NOW()'; }
    if (next === 'Completed') { extraFields = ',closed_at=NOW()'; }
    if (next === 'Failed') { extraValues.push(req.body.failure_reason || null); extraFields = `,failure_reason=$${2 + extraValues.length}`; }
    if (next === 'Rolled Back') { extraValues.push(req.body.rollback_reason || null); extraFields = `,rollback_reason=$${2 + extraValues.length}`; }
    if (next === 'Cancelled') { extraValues.push(req.body.cancellation_reason || null); extraFields = `,cancellation_reason=$${2 + extraValues.length}`; }
    if (next === 'Rejected') { extraValues.push(req.body.rejection_reason || null); extraFields = `,rejection_reason=$${2 + extraValues.length}`; }
    if (next === 'Under Assessment') { extraValues.push(req.body.assigned_technician_id || null); extraFields = `,assigned_technician_id=COALESCE($${2 + extraValues.length},assigned_technician_id)`; }
    if (next === 'Scheduled') { extraValues.push(req.body.scheduled_date || null); extraFields = `,scheduled_date=COALESCE($${2 + extraValues.length},scheduled_date)`; }
    if (next === 'Completed' || next === 'Closed') { extraFields = ',actual_end=NOW(),closed_at=NOW()'; }
    const updateParams = [next, req.params.id, ...extraValues];
    transitionStage = "update_change";
    const updated = await client.query(`UPDATE change_requests SET status=$1,updated_at=NOW()${extraFields} WHERE id=$2 RETURNING *`, updateParams);
    const metadata = JSON.stringify({ from: change.status, to: next, ...(req.body.failure_reason ? { failure_reason: req.body.failure_reason } : {}), ...(req.body.rollback_reason ? { rollback_reason: req.body.rollback_reason } : {}), ...(req.body.cancellation_reason ? { cancellation_reason: req.body.cancellation_reason } : {}), ...(req.body.rejection_reason ? { rejection_reason: req.body.rejection_reason } : {}) });
    transitionStage = "write_activity";
    await client.query("INSERT INTO change_activities(change_id,actor_id,event_type,message,metadata) VALUES($1,$2,'status_changed',$3,$4)", [req.params.id, req.changeContext.currentUserId, `Status changed from ${change.status} to ${next}.`, metadata]);
    transitionStage = "commit";
    await client.query("COMMIT"); res.json({ success: true, message: "Change status updated.", data: updated.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Status transition error:", { stage: transitionStage, changeId: req.params.id, code: error.code, message: error.message }, error.stack);
    const diagnostic = process.env.NODE_ENV !== "production" ? { stage: transitionStage, code: error.code || null, detail: error.message } : undefined;
    res.status(500).json({ success: false, message: "Failed to update change status.", data: null, ...(diagnostic ? { diagnostic } : {}) });
  } finally { client.release(); }
});

router.put("/changes/:id", requireChangeAccess, async (req, res) => {
  const client = await db.rawPool.connect();
  try {
    await client.query("BEGIN"); const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    const current = await client.query(`SELECT * FROM change_requests c WHERE c.id=$1 AND ${scoped} FOR UPDATE`, params);
    if (!current.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Change request not found.", data: null }); }
    const change = current.rows[0];
    if (!['Draft','Submitted'].includes(change.status)) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "Change can only be updated in Draft or Submitted status.", data: null }); }
    if (req.changeContext.role === 'employee' && change.requester_id !== req.changeContext.currentUserId) { await client.query("ROLLBACK"); return res.status(403).json({ success: false, message: "You can only update your own change requests.", data: null }); }
    const updates = []; const values = []; let idx = 0;
    const fields = ['title','description','change_type','category','priority','planned_start','planned_end','impact_level','risk_level','implementation_plan','backout_plan','communication_plan','business_justification','testing_plan','post_implementation_verification','risk_score','security_impact','compliance_impact','data_loss_risk','operational_risk','assigned_technician_id','scheduled_date','linked_assets','linked_services','linked_cis','linked_incidents','linked_problems'];
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        idx++; values.push(['linked_assets','linked_services','linked_cis','linked_incidents','linked_problems'].includes(field) ? JSON.stringify(safeArray(req.body[field])) : req.body[field]);
        updates.push(`${field}=$${idx}`);
      }
    }
    if (!updates.length) { await client.query("ROLLBACK"); return res.status(400).json({ success: false, message: "No fields to update.", data: null }); }
    values.push(req.params.id);
    const updated = await client.query(`UPDATE change_requests SET ${updates.join(',')},updated_at=NOW() WHERE id=$${idx+1} RETURNING *`, values);
    await client.query("INSERT INTO change_activities(change_id,actor_id,event_type,message,metadata) VALUES($1,$2,'updated',$3,$4)", [req.params.id, req.changeContext.currentUserId, `Change request ${change.change_number} updated.`, JSON.stringify({ fields: updates.map(u => u.split('=')[0]) })]);
    await client.query("COMMIT"); res.json({ success: true, message: "Change request updated.", data: updated.rows[0] });
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); res.status(500).json({ success: false, message: "Failed to update change request.", data: null }); } finally { client.release(); }
});

router.get("/changes/:id/audit", requireChangeAccess, async (req, res) => {
  try {
    const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    if (!(await db.query(`SELECT 1 FROM change_requests c WHERE c.id=$1 AND ${scoped}`, params)).rows.length) return res.status(404).json({ success: false, message: "Change request not found.", data: null });
    const [activities, approvals, implUpdates, schedHistory] = await Promise.all([
      db.query("SELECT a.*,u.full_name actor_name FROM change_activities a LEFT JOIN users u ON u.user_id=a.actor_id WHERE a.change_id=$1 ORDER BY a.created_at DESC", [req.params.id]),
      db.query("SELECT a.*,u.full_name approver_name FROM change_approvals a LEFT JOIN users u ON u.user_id=a.approver_id WHERE a.change_id=$1 ORDER BY a.created_at DESC", [req.params.id]),
      db.query("SELECT ci.*,u.full_name performed_by_name FROM change_implementation_updates ci LEFT JOIN users u ON u.user_id=ci.performed_by WHERE ci.change_id=$1 ORDER BY ci.created_at DESC", [req.params.id]),
      db.query("SELECT sh.*,u.full_name changed_by_name FROM change_schedule_history sh LEFT JOIN users u ON u.user_id=sh.changed_by WHERE sh.change_id=$1 ORDER BY sh.created_at DESC", [req.params.id]),
    ]);
    res.json({ success: true, message: "Audit trail loaded.", data: { activities: activities.rows, approvals: approvals.rows, implementation_updates: implUpdates.rows, schedule_history: schedHistory.rows } });
  } catch (error) { res.status(500).json({ success: false, message: "Failed to load audit trail.", data: null }); }
});

router.get("/changes/:id/cab-members", requireChangeAccess, async (req, res) => {
  try {
    const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    if (!(await db.query(`SELECT 1 FROM change_requests c WHERE c.id=$1 AND ${scoped}`, params)).rows.length) return res.status(404).json({ success: false, message: "Change request not found.", data: null });
    const members = await db.query("SELECT cm.*,u.full_name member_name FROM change_cab_members cm LEFT JOIN users u ON u.user_id=cm.user_id WHERE cm.change_id=$1 ORDER BY cm.created_at", [req.params.id]);
    res.json({ success: true, message: "CAB members loaded.", data: members.rows });
  } catch (error) { res.status(500).json({ success: false, message: "Failed to load CAB members.", data: null }); }
});

router.post("/changes/:id/cab-members", requireChangeAccess, async (req, res) => {
  if (!req.body.user_id) return res.status(400).json({ success: false, message: "User ID is required.", data: null });
  try {
    const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    if (!(await db.query(`SELECT 1 FROM change_requests c WHERE c.id=$1 AND ${scoped}`, params)).rows.length) return res.status(404).json({ success: false, message: "Change request not found.", data: null });
    const result = await db.query("INSERT INTO change_cab_members(change_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(change_id,user_id) DO UPDATE SET role=EXCLUDED.role RETURNING *", [req.params.id, req.body.user_id, req.body.role || 'Member']);
    await db.query("INSERT INTO change_activities(change_id,actor_id,event_type,message) VALUES($1,$2,'cab_member_added',$3)", [req.params.id, req.changeContext.currentUserId, `CAB member ${req.body.user_id} added with role ${req.body.role || 'Member'}.`]);
    res.status(201).json({ success: true, message: "CAB member added.", data: result.rows[0] });
  } catch (error) { res.status(500).json({ success: false, message: "Failed to add CAB member.", data: null }); }
});

router.delete("/changes/:id/cab-members/:memberId", requireChangeAccess, async (req, res) => {
  try {
    const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    if (!(await db.query(`SELECT 1 FROM change_requests c WHERE c.id=$1 AND ${scoped}`, params)).rows.length) return res.status(404).json({ success: false, message: "Change request not found.", data: null });
    const result = await db.query("DELETE FROM change_cab_members WHERE change_id=$1 AND id=$2 RETURNING *", [req.params.id, req.params.memberId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "CAB member not found.", data: null });
    await db.query("INSERT INTO change_activities(change_id,actor_id,event_type,message) VALUES($1,$2,'cab_member_removed',$3)", [req.params.id, req.changeContext.currentUserId, `CAB member ${req.params.memberId} removed.`]);
    res.json({ success: true, message: "CAB member removed.", data: result.rows[0] });
  } catch (error) { res.status(500).json({ success: false, message: "Failed to remove CAB member.", data: null }); }
});

router.get("/changes/:id/cab-review", requireChangeAccess, async (req, res) => {
  try {
    const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    if (!(await db.query(`SELECT 1 FROM change_requests c WHERE c.id=$1 AND ${scoped}`, params)).rows.length) return res.status(404).json({ success: false, message: "Change request not found.", data: null });
    const reviews = await db.query("SELECT cr.*,u.full_name reviewer_name FROM change_cab_reviews cr LEFT JOIN users u ON u.user_id=cr.reviewed_by WHERE cr.change_id=$1 ORDER BY cr.created_at DESC", [req.params.id]);
    res.json({ success: true, message: "CAB reviews loaded.", data: reviews.rows });
  } catch (error) { res.status(500).json({ success: false, message: "Failed to load CAB reviews.", data: null }); }
});

router.post("/changes/:id/cab-review", requireChangeAccess, async (req, res) => {
  if (!req.body.review_status || !['Pending','Approved','Rejected','Request Changes'].includes(req.body.review_status))
    return res.status(400).json({ success: false, message: "Review status must be Pending, Approved, Rejected, or Request Changes.", data: null });
  try {
    const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    const change = await db.query(`SELECT c.* FROM change_requests c WHERE c.id=$1 AND ${scoped}`, params);
    if (!change.rows.length) return res.status(404).json({ success: false, message: "Change request not found.", data: null });
    const result = await db.query(`INSERT INTO change_cab_reviews(change_id,meeting_ref,review_status,decision_notes,quorum_met,reviewed_by,reviewed_at)
      VALUES($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`, [req.params.id, req.body.meeting_ref || null, req.body.review_status, req.body.decision_notes || null, req.body.quorum_met || false, req.changeContext.currentUserId]);
    await db.query("INSERT INTO change_activities(change_id,actor_id,event_type,message,metadata) VALUES($1,$2,'cab_review',$3,$4)", [req.params.id, req.changeContext.currentUserId, `CAB review recorded: ${req.body.review_status}.`, JSON.stringify({ review_status: req.body.review_status, decision_notes: req.body.decision_notes || null })]);
    res.status(201).json({ success: true, message: "CAB review recorded.", data: result.rows[0] });
  } catch (error) { console.error("CAB review error:", error.message, error.stack); res.status(500).json({ success: false, message: "Failed to record CAB review.", data: null }); }
});

router.get("/changes/:id/implementation", requireChangeAccess, async (req, res) => {
  try {
    const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    if (!(await db.query(`SELECT 1 FROM change_requests c WHERE c.id=$1 AND ${scoped}`, params)).rows.length) return res.status(404).json({ success: false, message: "Change request not found.", data: null });
    const updates = await db.query("SELECT ci.*,u.full_name performed_by_name FROM change_implementation_updates ci LEFT JOIN users u ON u.user_id=ci.performed_by WHERE ci.change_id=$1 ORDER BY ci.created_at DESC", [req.params.id]);
    res.json({ success: true, message: "Implementation updates loaded.", data: updates.rows });
  } catch (error) { console.error("Implementation updates load error:", error.message, error.stack); res.status(500).json({ success: false, message: "Failed to load implementation updates.", data: null }); }
});

router.post("/changes/:id/implementation", requireChangeAccess, async (req, res) => {
  if (!req.body.action || !String(req.body.action || "").trim()) return res.status(400).json({ success: false, message: "Action is required.", data: null });
  try {
    const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    const change = await db.query(`SELECT c.* FROM change_requests c WHERE c.id=$1 AND ${scoped}`, params);
    if (!change.rows.length) return res.status(404).json({ success: false, message: "Change request not found.", data: null });
    if (req.changeContext.role === 'technician' && change.rows[0].assigned_technician_id !== req.changeContext.currentUserId)
      return res.status(403).json({ success: false, message: "You are not the assigned technician for this change.", data: null });
    const result = await db.query("INSERT INTO change_implementation_updates(change_id,action,notes,performed_by) VALUES($1,$2,$3,$4) RETURNING *",
      [req.params.id, req.body.action.trim(), req.body.notes || null, req.changeContext.currentUserId]);
    await db.query("INSERT INTO change_activities(change_id,actor_id,event_type,message,metadata) VALUES($1,$2,'implementation_update',$3,$4)",
      [req.params.id, req.changeContext.currentUserId, `Implementation update: ${req.body.action.trim()}.`, JSON.stringify({ action: req.body.action, notes: req.body.notes || null })]);
    res.status(201).json({ success: true, message: "Implementation update recorded.", data: result.rows[0] });
  } catch (error) { console.error("Implementation update record error:", error.message, error.stack); res.status(500).json({ success: false, message: "Failed to record implementation update.", data: null }); }
});

router.get("/changes/:id/schedule", requireChangeAccess, async (req, res) => {
  try {
    const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    const change = await db.query(`SELECT c.id,c.status,c.scheduled_date,c.planned_start,c.planned_end FROM change_requests c WHERE c.id=$1 AND ${scoped}`, params);
    if (!change.rows.length) return res.status(404).json({ success: false, message: "Change request not found.", data: null });
    const history = await db.query("SELECT sh.*,u.full_name changed_by_name FROM change_schedule_history sh LEFT JOIN users u ON u.user_id=sh.changed_by WHERE sh.change_id=$1 ORDER BY sh.created_at DESC", [req.params.id]);
    res.json({ success: true, message: "Schedule loaded.", data: { current: change.rows[0], history: history.rows } });
  } catch (error) { console.error("Schedule load error:", error.message, error.stack); res.status(500).json({ success: false, message: "Failed to load schedule.", data: null }); }
});

router.post("/changes/:id/schedule", requireChangeAccess, async (req, res) => {
  if (!req.body.planned_start && !req.body.planned_end && !req.body.scheduled_date)
    return res.status(400).json({ success: false, message: "At least one date field (planned_start, planned_end, scheduled_date) is required.", data: null });
  const client = await db.rawPool.connect();
  try {
    await client.query("BEGIN"); const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    const current = await client.query(`SELECT c.* FROM change_requests c WHERE c.id=$1 AND ${scoped} FOR UPDATE`, params);
    if (!current.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Change request not found.", data: null }); }
    const change = current.rows[0];
    const newStart = req.body.planned_start || change.planned_start;
    const newEnd = req.body.planned_end || change.planned_end;
    const newScheduled = req.body.scheduled_date || change.scheduled_date;
    await client.query("INSERT INTO change_schedule_history(change_id,previous_start,previous_end,new_start,new_end,reason,changed_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [req.params.id, change.planned_start, change.planned_end, newStart, newEnd, req.body.reason || null, req.changeContext.currentUserId]);
    const updateClauses = []; const updateValues = []; let idx = 0;
    if (req.body.planned_start) { idx++; updateValues.push(req.body.planned_start); updateClauses.push(`planned_start=$${idx}`); }
    if (req.body.planned_end) { idx++; updateValues.push(req.body.planned_end); updateClauses.push(`planned_end=$${idx}`); }
    if (req.body.scheduled_date) { idx++; updateValues.push(req.body.scheduled_date); updateClauses.push(`scheduled_date=$${idx}`); }
    updateValues.push(req.params.id);
    await client.query(`UPDATE change_requests SET ${updateClauses.join(',')},updated_at=NOW() WHERE id=$${idx+1}`, updateValues);
    await client.query("INSERT INTO change_activities(change_id,actor_id,event_type,message,metadata) VALUES($1,$2,'schedule_updated',$3,$4)",
      [req.params.id, req.changeContext.currentUserId, `Schedule updated for ${change.change_number}.`, JSON.stringify({ reason: req.body.reason || null, new_start: newStart, new_end: newEnd })]);
    await client.query("COMMIT"); res.json({ success: true, message: "Schedule updated.", data: { planned_start: newStart, planned_end: newEnd, scheduled_date: newScheduled } });
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); console.error("Schedule update error:", error.message, error.stack); res.status(500).json({ success: false, message: "Failed to update schedule.", data: null }); } finally { client.release(); }
});

router.post("/changes/:id/approvals", requireChangeAccess, async (req, res) => {
  if (!["Approved", "Rejected"].includes(req.body.decision)) return res.status(400).json({ success: false, message: "Decision must be Approved or Rejected.", data: null });
  try {
    const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    if (!(await db.query(`SELECT 1 FROM change_requests c WHERE c.id=$1 AND ${scoped}`, params)).rows.length) return res.status(404).json({ success: false, message: "Change request not found.", data: null });
    const result = await db.query("INSERT INTO change_approvals(change_id,approver_id,decision,comments,decided_at) VALUES($1,$2,$3,$4,NOW()) RETURNING *", [req.params.id, req.changeContext.currentUserId, req.body.decision, req.body.comments || null]);
    await db.query("INSERT INTO change_activities(change_id,actor_id,event_type,message) VALUES($1,$2,'cab_decision',$3)", [req.params.id, req.changeContext.currentUserId, `CAB decision recorded: ${req.body.decision}.`]);
    res.status(201).json({ success: true, message: "CAB decision recorded.", data: result.rows[0] });
  } catch (error) { console.error("CAB decision record error:", error.message, error.stack); res.status(500).json({ success: false, message: "Failed to record CAB decision.", data: null }); }
});

router.post("/changes/:id/comments", requireChangeAccess, async (req, res) => {
  if (!String(req.body.message || "").trim()) return res.status(400).json({ success: false, message: "Comment is required.", data: null });
  try {
    const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    if (!(await db.query(`SELECT 1 FROM change_requests c WHERE c.id=$1 AND ${scoped}`, params)).rows.length) return res.status(404).json({ success: false, message: "Change request not found.", data: null });
    const result = await db.query("INSERT INTO change_activities(change_id,actor_id,event_type,message) VALUES($1,$2,'comment',$3) RETURNING *", [req.params.id, req.changeContext.currentUserId, req.body.message.trim()]);
    res.status(201).json({ success: true, message: "Comment added.", data: result.rows[0] });
  } catch (error) { console.error("Comment add error:", error.message, error.stack); res.status(500).json({ success: false, message: "Failed to add comment.", data: null }); }
});

router.post("/changes/:id/attachments", requireChangeAccess, (req, res) => {
  uploadTicketAttachments.array("attachments", 10)(req, res, async (uploadError) => {
    if (uploadError) return res.status(400).json({ success: false, message: uploadError.code === "LIMIT_FILE_SIZE" ? "File size must be 10MB or less." : uploadError.message, data: null });
    try {
      const params = [req.params.id]; const scoped = branchScope(req, "c", params);
      if (!(await db.query(`SELECT 1 FROM change_requests c WHERE c.id=$1 AND ${scoped}`, params)).rows.length) return res.status(404).json({ success: false, message: "Change request not found.", data: null });
      const saved = [];
      for (const file of req.files || []) {
        const row = await db.query("INSERT INTO change_attachments(change_id,file_name,file_path,file_size,mime_type,uploaded_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [req.params.id, file.originalname, `/uploads/tickets/${file.filename}`, file.size, file.mimetype, req.changeContext.currentUserId]);
        saved.push(row.rows[0]);
      }
      if (!saved.length) return res.status(400).json({ success: false, message: "At least one attachment is required.", data: null });
      await db.query("INSERT INTO change_activities(change_id,actor_id,event_type,message) VALUES($1,$2,'attachment',$3)", [req.params.id, req.changeContext.currentUserId, `${saved.length} attachment(s) added.`]);
      res.status(201).json({ success: true, message: "Attachments uploaded.", data: saved });
    } catch (error) { res.status(500).json({ success: false, message: "Failed to upload attachments.", data: null }); }
  });
});

async function listOperational(req, res, kind) {
  const release = kind === "releases"; const table = release ? "release_plans" : "rollback_procedures"; const alias = release ? "r" : "rb";
  try {
    const params = []; const clauses = [operationScope(req, alias, params)];
    if (req.query.status) { params.push(req.query.status); clauses.push(`${alias}.status=$${params.length}`); }
    if (req.query.search) { params.push(`%${req.query.search}%`); clauses.push(`(${alias}.${release ? "release_number" : "rollback_number"} ILIKE $${params.length} OR ${alias}.title ILIKE $${params.length})`); }
    const result = await db.query(`SELECT ${alias}.*,b.branch_name,u.full_name owner_name FROM ${table} ${alias} LEFT JOIN branches b ON b.branch_id=${alias}.branch_id LEFT JOIN users u ON u.user_id=${alias}.owner_id WHERE ${clauses.join(" AND ")} ORDER BY ${release ? `${alias}.scheduled_start NULLS LAST,` : ""}${alias}.updated_at DESC`, params);
    res.json({ success: true, message: `${release ? "Releases" : "Rollback procedures"} loaded.`, data: result.rows });
  } catch (error) { res.status(500).json({ success: false, message: `Failed to load ${kind}.`, data: null }); }
}
router.get("/releases", requireChangeAccess, (req, res) => listOperational(req, res, "releases"));
router.get("/rollbacks", requireChangeAccess, (req, res) => listOperational(req, res, "rollbacks"));

router.post("/releases", requireChangeAccess, async (req, res) => {
  const branchId = branchForWrite(req); if (!branchId || !String(req.body.title || "").trim()) return res.status(400).json({ success: false, message: "Title and branch are required.", data: null });
  const client = await db.rawPool.connect();
  try { await client.query("BEGIN"); const changeIds=safeArray(req.body.change_ids).map(Number).filter(Boolean);
    if(changeIds.length){const valid=await client.query("SELECT COUNT(*)::int count FROM change_requests WHERE id=ANY($1::bigint[]) AND branch_id=$2",[changeIds,branchId]);if(valid.rows[0].count!==new Set(changeIds).size){await client.query("ROLLBACK");return res.status(400).json({success:false,message:"Every linked change must belong to the release branch.",data:null});}}
    const number = await nextNumber(client, "REL", "release_plans", "release_number");
    const ownerId=req.changeContext.role==='superadmin'&&req.body.owner_id?req.body.owner_id:req.changeContext.currentUserId;
    const result = await client.query(`INSERT INTO release_plans(release_number,title,description,environment,branch_id,owner_id,scheduled_start,scheduled_end,package_details,dependencies,checklist,release_notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [number, req.body.title.trim(), req.body.description || null, req.body.environment || "Development", branchId, ownerId, req.body.scheduled_start || null, req.body.scheduled_end || null, JSON.stringify(safeArray(req.body.package_details)), JSON.stringify(safeArray(req.body.dependencies)), JSON.stringify(safeArray(req.body.checklist)), req.body.release_notes || null]);
    for (const changeId of changeIds) await client.query("INSERT INTO change_release_links(change_id,release_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [changeId, result.rows[0].id]);
    await client.query("COMMIT"); res.status(201).json({ success: true, message: "Release plan created.", data: result.rows[0] });
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); console.error("Create release error:", error.message); res.status(500).json({ success: false, message: "Failed to create release plan.", data: null }); } finally { client.release(); }
});

router.patch("/releases/:id/status", requireChangeAccess, async (req, res) => {
  try { const params = [req.params.id]; const scoped = operationScope(req, "r", params); const current = await db.query(`SELECT * FROM release_plans r WHERE r.id=$1 AND ${scoped}`, params); if (!current.rows.length) return res.status(404).json({ success: false, message: "Release not found.", data: null });
    if (!ensureNextStatus(RELEASE_FLOW, current.rows[0].status, req.body.status)) return res.status(400).json({ success: false, message: "Invalid release status transition.", data: null });
    const progress = req.body.status === "Completed" || req.body.status === "Closed" ? 100 : Math.max(Number(current.rows[0].progress), Number(req.body.progress || 0));
    const result = await db.query("UPDATE release_plans SET status=$1,progress=$2,validation_notes=COALESCE($3,validation_notes),updated_at=NOW() WHERE id=$4 RETURNING *", [req.body.status, progress, req.body.validation_notes || null, req.params.id]); res.json({ success: true, message: "Release status updated.", data: result.rows[0] });
  } catch (error) { res.status(500).json({ success: false, message: "Failed to update release.", data: null }); }
});

router.post("/rollbacks", requireChangeAccess, async (req, res) => {
  const branchId = branchForWrite(req); if (!branchId || !String(req.body.title || "").trim() || !String(req.body.recovery_plan || "").trim()) return res.status(400).json({ success: false, message: "Title, branch, and recovery plan are required.", data: null });
  const client = await db.rawPool.connect();
  try { await client.query("BEGIN");
    if(req.body.linked_change_id&&!(await client.query("SELECT 1 FROM change_requests WHERE id=$1 AND branch_id=$2",[req.body.linked_change_id,branchId])).rows.length){await client.query("ROLLBACK");return res.status(400).json({success:false,message:"Linked change must belong to the rollback branch.",data:null});}
    if(req.body.linked_release_id&&!(await client.query("SELECT 1 FROM release_plans WHERE id=$1 AND branch_id=$2",[req.body.linked_release_id,branchId])).rows.length){await client.query("ROLLBACK");return res.status(400).json({success:false,message:"Linked release must belong to the rollback branch.",data:null});}
    const number = await nextNumber(client, "RBK", "rollback_procedures", "rollback_number");
    const ownerId=req.changeContext.role==='superadmin'&&req.body.owner_id?req.body.owner_id:req.changeContext.currentUserId;
    const result = await client.query(`INSERT INTO rollback_procedures(rollback_number,title,description,branch_id,owner_id,linked_change_id,linked_release_id,recovery_plan,checklist) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [number, req.body.title.trim(), req.body.description || null, branchId, ownerId, req.body.linked_change_id || null, req.body.linked_release_id || null, req.body.recovery_plan.trim(), JSON.stringify(safeArray(req.body.checklist))]);
    await client.query("INSERT INTO rollback_versions(rollback_id,version,recovery_plan,checklist,changed_by) VALUES($1,1,$2,$3,$4)", [result.rows[0].id, req.body.recovery_plan.trim(), JSON.stringify(safeArray(req.body.checklist)), req.changeContext.currentUserId]);
    await client.query("INSERT INTO rollback_execution_logs(rollback_id,actor_id,action,details) VALUES($1,$2,'Created',$3)", [result.rows[0].id, req.changeContext.currentUserId, "Initial recovery plan created."]);
    await client.query("COMMIT"); res.status(201).json({ success: true, message: "Rollback procedure created.", data: result.rows[0] });
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); console.error("Create rollback error:", error.message); res.status(500).json({ success: false, message: "Failed to create rollback procedure.", data: null }); } finally { client.release(); }
});

router.patch("/rollbacks/:id/status", requireChangeAccess, async (req, res) => {
  try { const params = [req.params.id]; const scoped = operationScope(req, "rb", params); const current = await db.query(`SELECT * FROM rollback_procedures rb WHERE rb.id=$1 AND ${scoped}`, params); if (!current.rows.length) return res.status(404).json({ success: false, message: "Rollback procedure not found.", data: null });
    if (!ensureNextStatus(ROLLBACK_FLOW, current.rows[0].status, req.body.status)) return res.status(400).json({ success: false, message: "Invalid rollback status transition.", data: null });
    const stamp = req.body.status === "Approved" ? ",approved_by=$3,approved_at=NOW()" : req.body.status === "Executed" ? ",executed_at=NOW()" : req.body.status === "Verified" ? ",verified_at=NOW()" : "";
    const queryParams = stamp.includes("$3") ? [req.body.status, req.params.id, req.changeContext.currentUserId] : [req.body.status, req.params.id];
    const result = await db.query(`UPDATE rollback_procedures SET status=$1,updated_at=NOW()${stamp} WHERE id=$2 RETURNING *`, queryParams);
    await db.query("INSERT INTO rollback_execution_logs(rollback_id,actor_id,action,details) VALUES($1,$2,$3,$4)", [req.params.id, req.changeContext.currentUserId, req.body.status, req.body.details || `Rollback moved to ${req.body.status}.`]);
    res.json({ success: true, message: "Rollback status updated.", data: result.rows[0] });
  } catch (error) { res.status(500).json({ success: false, message: "Failed to update rollback.", data: null }); }
});

router.put("/rollbacks/:id", requireChangeAccess, async (req, res) => {
  if (!String(req.body.recovery_plan || "").trim()) return res.status(400).json({ success: false, message: "Recovery plan is required.", data: null });
  const client = await db.rawPool.connect();
  try {
    await client.query("BEGIN"); const params=[req.params.id]; const scoped=operationScope(req,"rb",params);
    const current=await client.query(`SELECT * FROM rollback_procedures rb WHERE rb.id=$1 AND ${scoped} FOR UPDATE`,params);
    if(!current.rows.length){await client.query("ROLLBACK");return res.status(404).json({success:false,message:"Rollback procedure not found.",data:null});}
    const version=Number(current.rows[0].version)+1; const checklist=safeArray(req.body.checklist);
    const updated=await client.query("UPDATE rollback_procedures SET recovery_plan=$1,checklist=$2,version=$3,description=COALESCE($4,description),updated_at=NOW() WHERE id=$5 RETURNING *",[req.body.recovery_plan.trim(),JSON.stringify(checklist),version,req.body.description||null,req.params.id]);
    await client.query("INSERT INTO rollback_versions(rollback_id,version,recovery_plan,checklist,changed_by) VALUES($1,$2,$3,$4,$5)",[req.params.id,version,req.body.recovery_plan.trim(),JSON.stringify(checklist),req.changeContext.currentUserId]);
    await client.query("INSERT INTO rollback_execution_logs(rollback_id,actor_id,action,details) VALUES($1,$2,'Version Updated',$3)",[req.params.id,req.changeContext.currentUserId,`Recovery plan version ${version} created.`]);
    await client.query("COMMIT");res.json({success:true,message:"Rollback version created.",data:updated.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(500).json({success:false,message:"Failed to create rollback version.",data:null});}finally{client.release();}
});

router.get("/rollbacks/:id/history", requireChangeAccess, async (req, res) => {
  try { const params = [req.params.id]; const scoped = operationScope(req, "rb", params); if (!(await db.query(`SELECT 1 FROM rollback_procedures rb WHERE rb.id=$1 AND ${scoped}`, params)).rows.length) return res.status(404).json({ success: false, message: "Rollback procedure not found.", data: null });
    const [versions, logs] = await Promise.all([db.query("SELECT v.*,u.full_name changed_by_name FROM rollback_versions v LEFT JOIN users u ON u.user_id=v.changed_by WHERE v.rollback_id=$1 ORDER BY v.version DESC", [req.params.id]), db.query("SELECT l.*,u.full_name actor_name FROM rollback_execution_logs l LEFT JOIN users u ON u.user_id=l.actor_id WHERE l.rollback_id=$1 ORDER BY l.created_at DESC", [req.params.id])]);
    res.json({ success: true, message: "Rollback history loaded.", data: { versions: versions.rows, logs: logs.rows } });
  } catch (error) { res.status(500).json({ success: false, message: "Failed to load rollback history.", data: null }); }
});

module.exports = router;
