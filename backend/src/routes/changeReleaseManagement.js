const express = require("express");
const db = require("../../config/db");
const { getRequestContext } = require("./_ticketAccess");
const { uploadTicketAttachments } = require("./_uploads");

const router = express.Router();
const CHANGE_FLOW = ["Draft", "Submitted", "Risk Assessment", "CAB Review", "Approved", "Scheduled", "In Progress", "Completed", "Closed"];
const RELEASE_FLOW = ["Planned", "Scheduled", "Deploying", "Verifying", "Completed", "Closed"];
const ROLLBACK_FLOW = ["Draft", "Approved", "Available", "Executed", "Verified"];

function requireManager(req, res, next) {
  const context = getRequestContext(req);
  const role = String(context.roleName || "").toLowerCase();
  if (!context.authenticated) return res.status(401).json({ success: false, message: "Authentication required.", data: null });
  if (!["superadmin", "admin"].includes(role)) return res.status(403).json({ success: false, message: "Change and Release Management access denied.", data: null });
  if (role === "admin" && !context.branchId) return res.status(403).json({ success: false, message: "An assigned branch is required.", data: null });
  req.changeContext = { ...context, role };
  next();
}

const branchForWrite = (req) => req.changeContext.role === "superadmin" ? Number(req.body.branch_id) : Number(req.changeContext.branchId);
const branchScope = (req, alias, params) => {
  if (req.changeContext.role === "superadmin") return "1=1";
  params.push(req.changeContext.branchId);
  return `${alias}.branch_id=$${params.length}`;
};
const safeArray = (value) => Array.isArray(value) ? value : [];
const positiveInt = (value, fallback) => Math.max(1, Number.parseInt(value, 10) || fallback);
const ensureNextStatus = (flow, current, next) => flow.indexOf(next) === flow.indexOf(current) + 1;

async function nextNumber(client, prefix, table, column) {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const base = `${prefix}-${date}`;
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [base]);
  const result = await client.query(`SELECT COALESCE(MAX(NULLIF(SUBSTRING(${column} FROM $1), '')::int),0)+1 next_value FROM ${table} WHERE ${column} LIKE $2`, [base.length + 1, `${base}%`]);
  return `${base}${String(result.rows[0].next_value).padStart(3, "0")}`;
}

router.get("/summary", requireManager, async (req, res) => {
  try {
    const params = [];
    const changeWhere = branchScope(req, "c", params);
    const releaseParams = [];
    const releaseWhere = branchScope(req, "r", releaseParams);
    const rollbackParams = [];
    const rollbackWhere = branchScope(req, "rb", rollbackParams);
    const [changes, releases, rollbacks, trend, recent] = await Promise.all([
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
    ]);
    const c = changes.rows[0] || {}; const r = releases.rows[0] || {}; const rb = rollbacks.rows[0] || {};
    const deploymentTotal = Number(r.successful_releases || 0) + Number(r.deploying || 0);
    res.json({ success: true, message: "Change and release summary loaded.", data: {
      pending_changes: Number(c.pending_changes || 0), cab_queue: Number(c.cab_queue || 0), active_changes: Number(c.active_changes || 0),
      upcoming_releases: Number(r.upcoming_releases || 0), rollback_readiness_pct: Number(rb.total) ? Math.round(Number(rb.ready) / Number(rb.total) * 100) : 0,
      deployment_success_pct: deploymentTotal ? Math.round(Number(r.successful_releases) / deploymentTotal * 100) : 0,
      trend: trend.rows, recent_activity: recent.rows,
    }});
  } catch (error) { console.error("Change summary error:", error.message); res.status(500).json({ success: false, message: "Failed to load Change and Release summary.", data: null }); }
});

router.get("/changes", requireManager, async (req, res) => {
  try {
    const params = []; const clauses = [branchScope(req, "c", params)];
    if (req.query.status) { params.push(req.query.status); clauses.push(`c.status=$${params.length}`); }
    if (req.query.type) { params.push(req.query.type); clauses.push(`c.change_type=$${params.length}`); }
    if (req.query.search) { params.push(`%${req.query.search}%`); clauses.push(`(c.change_number ILIKE $${params.length} OR c.title ILIKE $${params.length})`); }
    if (req.query.date_from) { params.push(req.query.date_from); clauses.push(`c.planned_start::date >= $${params.length}`); }
    if (req.query.date_to) { params.push(req.query.date_to); clauses.push(`c.planned_start::date <= $${params.length}`); }
    const page = positiveInt(req.query.page, 1); const limit = Math.min(100, positiveInt(req.query.limit, 25)); const offset = (page - 1) * limit;
    params.push(limit, offset); const limitPos = params.length - 1; const offsetPos = params.length;
    const result = await db.query(`SELECT c.*,b.branch_name,u.full_name owner_name,COUNT(*) OVER()::int total_count
      FROM change_requests c LEFT JOIN branches b ON b.branch_id=c.branch_id LEFT JOIN users u ON u.user_id=c.owner_id
      WHERE ${clauses.join(" AND ")} ORDER BY c.updated_at DESC LIMIT $${limitPos} OFFSET $${offsetPos}`, params);
    res.json({ success: true, message: "Change requests loaded.", data: result.rows, meta: { page, limit, total: result.rows[0]?.total_count || 0 } });
  } catch (error) { console.error("List changes error:", error.message); res.status(500).json({ success: false, message: "Failed to load change requests.", data: null }); }
});

router.post("/changes", requireManager, async (req, res) => {
  const branchId = branchForWrite(req);
  if (!branchId || !String(req.body.title || "").trim()) return res.status(400).json({ success: false, message: "Title and branch are required.", data: null });
  const client = await db.rawPool.connect();
  try {
    await client.query("BEGIN");
    const number = await nextNumber(client, "CHG", "change_requests", "change_number");
    const ownerId = req.changeContext.role === "superadmin" && req.body.owner_id ? req.body.owner_id : req.changeContext.currentUserId;
    const values = [number, req.body.title.trim(), req.body.description || null, req.body.change_type || "Normal", req.body.category || "Infrastructure", req.body.priority || "Medium", branchId, req.changeContext.currentUserId, ownerId, req.body.planned_start || null, req.body.planned_end || null, req.body.impact_level || "Medium", req.body.risk_level || "Medium", req.body.implementation_plan || null, req.body.backout_plan || null, req.body.communication_plan || null, JSON.stringify(safeArray(req.body.linked_assets)), JSON.stringify(safeArray(req.body.linked_services)), JSON.stringify(safeArray(req.body.linked_cis)), JSON.stringify(safeArray(req.body.linked_incidents)), JSON.stringify(safeArray(req.body.linked_problems))];
    const result = await client.query(`INSERT INTO change_requests(change_number,title,description,change_type,category,priority,branch_id,requester_id,owner_id,planned_start,planned_end,impact_level,risk_level,implementation_plan,backout_plan,communication_plan,linked_assets,linked_services,linked_cis,linked_incidents,linked_problems)
      VALUES(${values.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`, values);
    await client.query("INSERT INTO change_activities(change_id,actor_id,event_type,message) VALUES($1,$2,'created',$3)", [result.rows[0].id, req.changeContext.currentUserId, `Change request ${number} created.`]);
    await client.query("COMMIT"); res.status(201).json({ success: true, message: "Change request created.", data: result.rows[0] });
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); console.error("Create change error:", error.message); res.status(500).json({ success: false, message: "Failed to create change request.", data: null }); } finally { client.release(); }
});

router.get("/changes/:id", requireManager, async (req, res) => {
  try {
    const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    const change = await db.query(`SELECT c.*,b.branch_name,u.full_name owner_name FROM change_requests c LEFT JOIN branches b ON b.branch_id=c.branch_id LEFT JOIN users u ON u.user_id=c.owner_id WHERE c.id=$1 AND ${scoped}`, params);
    if (!change.rows.length) return res.status(404).json({ success: false, message: "Change request not found.", data: null });
    const [activities, approvals, releases, attachments] = await Promise.all([
      db.query("SELECT a.*,u.full_name actor_name FROM change_activities a LEFT JOIN users u ON u.user_id=a.actor_id WHERE a.change_id=$1 ORDER BY a.created_at DESC", [req.params.id]),
      db.query("SELECT a.*,u.full_name approver_name FROM change_approvals a LEFT JOIN users u ON u.user_id=a.approver_id WHERE a.change_id=$1 ORDER BY a.created_at DESC", [req.params.id]),
      db.query("SELECT r.* FROM release_plans r JOIN change_release_links l ON l.release_id=r.id WHERE l.change_id=$1 ORDER BY r.scheduled_start", [req.params.id]),
      db.query("SELECT * FROM change_attachments WHERE change_id=$1 ORDER BY created_at DESC", [req.params.id]),
    ]);
    res.json({ success: true, message: "Change request loaded.", data: { ...change.rows[0], activities: activities.rows, approvals: approvals.rows, releases: releases.rows, attachments: attachments.rows } });
  } catch (error) { res.status(500).json({ success: false, message: "Failed to load change request.", data: null }); }
});

router.patch("/changes/:id/status", requireManager, async (req, res) => {
  const client = await db.rawPool.connect();
  try {
    await client.query("BEGIN"); const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    const current = await client.query(`SELECT * FROM change_requests c WHERE c.id=$1 AND ${scoped} FOR UPDATE`, params);
    if (!current.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Change request not found.", data: null }); }
    const next = req.body.status;
    if (!ensureNextStatus(CHANGE_FLOW, current.rows[0].status, next)) { await client.query("ROLLBACK"); return res.status(400).json({ success: false, message: `Next valid status is ${CHANGE_FLOW[CHANGE_FLOW.indexOf(current.rows[0].status) + 1] || "none"}.`, data: null }); }
    if (next === "Approved") { const approval = await client.query("SELECT 1 FROM change_approvals WHERE change_id=$1 AND decision='Approved' LIMIT 1", [req.params.id]); if (!approval.rows.length) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "A CAB approval is required before approval.", data: null }); } }
    const updated = await client.query("UPDATE change_requests SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *", [next, req.params.id]);
    await client.query("INSERT INTO change_activities(change_id,actor_id,event_type,message,metadata) VALUES($1,$2,'status_changed',$3,$4)", [req.params.id, req.changeContext.currentUserId, `Status changed from ${current.rows[0].status} to ${next}.`, JSON.stringify({ from: current.rows[0].status, to: next })]);
    await client.query("COMMIT"); res.json({ success: true, message: "Change status updated.", data: updated.rows[0] });
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); res.status(500).json({ success: false, message: "Failed to update change status.", data: null }); } finally { client.release(); }
});

router.post("/changes/:id/approvals", requireManager, async (req, res) => {
  if (!["Approved", "Rejected"].includes(req.body.decision)) return res.status(400).json({ success: false, message: "Decision must be Approved or Rejected.", data: null });
  try {
    const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    if (!(await db.query(`SELECT 1 FROM change_requests c WHERE c.id=$1 AND ${scoped}`, params)).rows.length) return res.status(404).json({ success: false, message: "Change request not found.", data: null });
    const result = await db.query("INSERT INTO change_approvals(change_id,approver_id,decision,comments,decided_at) VALUES($1,$2,$3,$4,NOW()) RETURNING *", [req.params.id, req.changeContext.currentUserId, req.body.decision, req.body.comments || null]);
    await db.query("INSERT INTO change_activities(change_id,actor_id,event_type,message) VALUES($1,$2,'cab_decision',$3)", [req.params.id, req.changeContext.currentUserId, `CAB decision recorded: ${req.body.decision}.`]);
    res.status(201).json({ success: true, message: "CAB decision recorded.", data: result.rows[0] });
  } catch (error) { res.status(500).json({ success: false, message: "Failed to record CAB decision.", data: null }); }
});

router.post("/changes/:id/comments", requireManager, async (req, res) => {
  if (!String(req.body.message || "").trim()) return res.status(400).json({ success: false, message: "Comment is required.", data: null });
  try {
    const params = [req.params.id]; const scoped = branchScope(req, "c", params);
    if (!(await db.query(`SELECT 1 FROM change_requests c WHERE c.id=$1 AND ${scoped}`, params)).rows.length) return res.status(404).json({ success: false, message: "Change request not found.", data: null });
    const result = await db.query("INSERT INTO change_activities(change_id,actor_id,event_type,message) VALUES($1,$2,'comment',$3) RETURNING *", [req.params.id, req.changeContext.currentUserId, req.body.message.trim()]);
    res.status(201).json({ success: true, message: "Comment added.", data: result.rows[0] });
  } catch (error) { res.status(500).json({ success: false, message: "Failed to add comment.", data: null }); }
});

router.post("/changes/:id/attachments", requireManager, (req, res) => {
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
    const params = []; const clauses = [branchScope(req, alias, params)];
    if (req.query.status) { params.push(req.query.status); clauses.push(`${alias}.status=$${params.length}`); }
    if (req.query.search) { params.push(`%${req.query.search}%`); clauses.push(`(${alias}.${release ? "release_number" : "rollback_number"} ILIKE $${params.length} OR ${alias}.title ILIKE $${params.length})`); }
    const result = await db.query(`SELECT ${alias}.*,b.branch_name,u.full_name owner_name FROM ${table} ${alias} LEFT JOIN branches b ON b.branch_id=${alias}.branch_id LEFT JOIN users u ON u.user_id=${alias}.owner_id WHERE ${clauses.join(" AND ")} ORDER BY ${release ? `${alias}.scheduled_start NULLS LAST,` : ""}${alias}.updated_at DESC`, params);
    res.json({ success: true, message: `${release ? "Releases" : "Rollback procedures"} loaded.`, data: result.rows });
  } catch (error) { res.status(500).json({ success: false, message: `Failed to load ${kind}.`, data: null }); }
}
router.get("/releases", requireManager, (req, res) => listOperational(req, res, "releases"));
router.get("/rollbacks", requireManager, (req, res) => listOperational(req, res, "rollbacks"));

router.post("/releases", requireManager, async (req, res) => {
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

router.patch("/releases/:id/status", requireManager, async (req, res) => {
  try { const params = [req.params.id]; const scoped = branchScope(req, "r", params); const current = await db.query(`SELECT * FROM release_plans r WHERE r.id=$1 AND ${scoped}`, params); if (!current.rows.length) return res.status(404).json({ success: false, message: "Release not found.", data: null });
    if (!ensureNextStatus(RELEASE_FLOW, current.rows[0].status, req.body.status)) return res.status(400).json({ success: false, message: "Invalid release status transition.", data: null });
    const progress = req.body.status === "Completed" || req.body.status === "Closed" ? 100 : Math.max(Number(current.rows[0].progress), Number(req.body.progress || 0));
    const result = await db.query("UPDATE release_plans SET status=$1,progress=$2,validation_notes=COALESCE($3,validation_notes),updated_at=NOW() WHERE id=$4 RETURNING *", [req.body.status, progress, req.body.validation_notes || null, req.params.id]); res.json({ success: true, message: "Release status updated.", data: result.rows[0] });
  } catch (error) { res.status(500).json({ success: false, message: "Failed to update release.", data: null }); }
});

router.post("/rollbacks", requireManager, async (req, res) => {
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

router.patch("/rollbacks/:id/status", requireManager, async (req, res) => {
  try { const params = [req.params.id]; const scoped = branchScope(req, "rb", params); const current = await db.query(`SELECT * FROM rollback_procedures rb WHERE rb.id=$1 AND ${scoped}`, params); if (!current.rows.length) return res.status(404).json({ success: false, message: "Rollback procedure not found.", data: null });
    if (!ensureNextStatus(ROLLBACK_FLOW, current.rows[0].status, req.body.status)) return res.status(400).json({ success: false, message: "Invalid rollback status transition.", data: null });
    const stamp = req.body.status === "Approved" ? ",approved_by=$3,approved_at=NOW()" : req.body.status === "Executed" ? ",executed_at=NOW()" : req.body.status === "Verified" ? ",verified_at=NOW()" : "";
    const queryParams = stamp.includes("$3") ? [req.body.status, req.params.id, req.changeContext.currentUserId] : [req.body.status, req.params.id];
    const result = await db.query(`UPDATE rollback_procedures SET status=$1,updated_at=NOW()${stamp} WHERE id=$2 RETURNING *`, queryParams);
    await db.query("INSERT INTO rollback_execution_logs(rollback_id,actor_id,action,details) VALUES($1,$2,$3,$4)", [req.params.id, req.changeContext.currentUserId, req.body.status, req.body.details || `Rollback moved to ${req.body.status}.`]);
    res.json({ success: true, message: "Rollback status updated.", data: result.rows[0] });
  } catch (error) { res.status(500).json({ success: false, message: "Failed to update rollback.", data: null }); }
});

router.put("/rollbacks/:id", requireManager, async (req, res) => {
  if (!String(req.body.recovery_plan || "").trim()) return res.status(400).json({ success: false, message: "Recovery plan is required.", data: null });
  const client = await db.rawPool.connect();
  try {
    await client.query("BEGIN"); const params=[req.params.id]; const scoped=branchScope(req,"rb",params);
    const current=await client.query(`SELECT * FROM rollback_procedures rb WHERE rb.id=$1 AND ${scoped} FOR UPDATE`,params);
    if(!current.rows.length){await client.query("ROLLBACK");return res.status(404).json({success:false,message:"Rollback procedure not found.",data:null});}
    const version=Number(current.rows[0].version)+1; const checklist=safeArray(req.body.checklist);
    const updated=await client.query("UPDATE rollback_procedures SET recovery_plan=$1,checklist=$2,version=$3,description=COALESCE($4,description),updated_at=NOW() WHERE id=$5 RETURNING *",[req.body.recovery_plan.trim(),JSON.stringify(checklist),version,req.body.description||null,req.params.id]);
    await client.query("INSERT INTO rollback_versions(rollback_id,version,recovery_plan,checklist,changed_by) VALUES($1,$2,$3,$4,$5)",[req.params.id,version,req.body.recovery_plan.trim(),JSON.stringify(checklist),req.changeContext.currentUserId]);
    await client.query("INSERT INTO rollback_execution_logs(rollback_id,actor_id,action,details) VALUES($1,$2,'Version Updated',$3)",[req.params.id,req.changeContext.currentUserId,`Recovery plan version ${version} created.`]);
    await client.query("COMMIT");res.json({success:true,message:"Rollback version created.",data:updated.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});res.status(500).json({success:false,message:"Failed to create rollback version.",data:null});}finally{client.release();}
});

router.get("/rollbacks/:id/history", requireManager, async (req, res) => {
  try { const params = [req.params.id]; const scoped = branchScope(req, "rb", params); if (!(await db.query(`SELECT 1 FROM rollback_procedures rb WHERE rb.id=$1 AND ${scoped}`, params)).rows.length) return res.status(404).json({ success: false, message: "Rollback procedure not found.", data: null });
    const [versions, logs] = await Promise.all([db.query("SELECT v.*,u.full_name changed_by_name FROM rollback_versions v LEFT JOIN users u ON u.user_id=v.changed_by WHERE v.rollback_id=$1 ORDER BY v.version DESC", [req.params.id]), db.query("SELECT l.*,u.full_name actor_name FROM rollback_execution_logs l LEFT JOIN users u ON u.user_id=l.actor_id WHERE l.rollback_id=$1 ORDER BY l.created_at DESC", [req.params.id])]);
    res.json({ success: true, message: "Rollback history loaded.", data: { versions: versions.rows, logs: logs.rows } });
  } catch (error) { res.status(500).json({ success: false, message: "Failed to load rollback history.", data: null }); }
});

module.exports = router;
