const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../../config/db");
const {
  CASE_STATUSES,
  TERMINAL_STATUSES,
  normalizeLifecycleType,
  getDefaultTasks,
  canTransition,
  canCompleteCase,
  canUpdateLifecycleTask,
  lifecycleTaskOwnerLabel,
} = require("../services/employeeLifecycleService");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
const ACCESS_ROLES = new Set(["superadmin", "admin", "hr"]);

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]/g, "");
}

async function requireLifecycleAccess(req, res, next) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
  try {
    const claim = jwt.verify(header.slice(7), JWT_SECRET);
    const actorId = Number(claim.userId || claim.user_id);
    const result = await db.query(
      `SELECT u.user_id,u.full_name,u.branch_id,u.is_active,r.role_name
         FROM users u JOIN system_roles r ON r.role_id=u.role_id
        WHERE u.user_id=$1 LIMIT 1`,
      [actorId]
    );
    const actor = result.rows[0];
    const role = normalizeRole(actor?.role_name);
    if (!actor || actor.is_active === false) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    if (!ACCESS_ROLES.has(role)) {
      return res.status(403).json({ success: false, message: "Employee lifecycle access denied." });
    }
    if (role !== "superadmin" && !actor.branch_id) {
      return res.status(403).json({ success: false, message: "An assigned branch is required." });
    }
    req.lifecycleActor = { ...actor, role };
    return next();
  } catch (_error) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
}

function addCaseScope(req, alias, params, requestedBranch = null) {
  if (req.lifecycleActor.role === "superadmin") {
    if (requestedBranch) {
      params.push(Number(requestedBranch));
      return `${alias}.branch_id=$${params.length}`;
    }
    return "1=1";
  }
  params.push(Number(req.lifecycleActor.branch_id));
  return `${alias}.branch_id=$${params.length}`;
}

async function loadCase(queryable, caseId) {
  const result = await queryable.query(
    `SELECT lc.*,employee.full_name employee_name,employee.email employee_email,
            employee.department employee_department,b.branch_name,
            creator.full_name created_by_name,verifier.full_name verified_by_name,
            t.ticket_number related_ticket_number,t.title related_ticket_title,
            COUNT(lt.lifecycle_task_id)::int task_count,
            COUNT(lt.lifecycle_task_id) FILTER (WHERE lt.status='Completed')::int completed_task_count,
            COUNT(lt.lifecycle_task_id) FILTER (WHERE lt.is_required AND lt.status='Pending')::int required_pending_count
       FROM employee_lifecycle_cases lc
       JOIN users employee ON employee.user_id=lc.employee_id
       JOIN branches b ON b.branch_id=lc.branch_id
       JOIN users creator ON creator.user_id=lc.created_by
       LEFT JOIN users verifier ON verifier.user_id=lc.verified_by
       LEFT JOIN tickets t ON t.id=lc.related_ticket_id
       LEFT JOIN employee_lifecycle_tasks lt ON lt.lifecycle_case_id=lc.lifecycle_case_id
      WHERE lc.lifecycle_case_id=$1
      GROUP BY lc.lifecycle_case_id,employee.user_id,b.branch_id,creator.user_id,verifier.user_id,t.id`,
    [caseId]
  );
  return result.rows[0] || null;
}

async function assertScopedCase(req, queryable, caseId, lock = false) {
  const params = [Number(caseId)];
  const scope = addCaseScope(req, "lc", params);
  const result = await queryable.query(
    `SELECT lc.lifecycle_case_id FROM employee_lifecycle_cases lc
      WHERE lc.lifecycle_case_id=$1 AND ${scope}${lock ? " FOR UPDATE" : ""}`,
    params
  );
  return Boolean(result.rows.length);
}

async function addHistory(queryable, caseId, actorId, eventType, message, previousStatus = null, newStatus = null, metadata = {}) {
  await queryable.query(
    `INSERT INTO employee_lifecycle_history
       (lifecycle_case_id,event_type,previous_status,new_status,message,metadata,changed_by)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [caseId, eventType, previousStatus, newStatus, message, JSON.stringify(metadata), actorId]
  );
}

async function nextCaseNumber(client, type) {
  const prefix = type === "Onboarding" ? "ONB" : "OFF";
  const dateResult = await client.query(`SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila','YYYYMMDD') value`);
  const date = dateResult.rows[0].value;
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`employee-lifecycle-${prefix}-${date}`]);
  const result = await client.query(
    `SELECT case_number FROM employee_lifecycle_cases
      WHERE case_number LIKE $1 ORDER BY case_number DESC LIMIT 1`,
    [`${prefix}-${date}-%`]
  );
  const previous = Number(String(result.rows[0]?.case_number || "").split("-").pop()) || 0;
  return `${prefix}-${date}-${String(previous + 1).padStart(4, "0")}`;
}

router.use(requireLifecycleAccess);

router.get("/employees", async (req, res) => {
  try {
    const params = [];
    const scope = addCaseScope(req, "u", params, req.query.branch_id);
    const result = await db.query(
      `SELECT u.user_id,u.full_name,u.email,u.department,u.branch_id,b.branch_name,
              u.onboarding_status,u.onboarding_required,u.is_active
         FROM users u JOIN system_roles r ON r.role_id=u.role_id
         JOIN branches b ON b.branch_id=u.branch_id
        WHERE LOWER(r.role_name)='employee' AND ${scope}
        ORDER BY u.full_name`,
      params
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("[employee-lifecycle:employees]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load lifecycle employees." });
  }
});

router.get("/summary", async (req, res) => {
  try {
    const params = [];
    const scope = addCaseScope(req, "lc", params, req.query.branch_id);
    const result = await db.query(
      `SELECT COUNT(*)::int total,
              COUNT(*) FILTER (WHERE lc.lifecycle_type='Onboarding' AND lc.status NOT IN ('Completed','Cancelled'))::int active_onboarding,
              COUNT(*) FILTER (WHERE lc.lifecycle_type='Offboarding' AND lc.status NOT IN ('Completed','Cancelled'))::int active_offboarding,
              COUNT(*) FILTER (WHERE lc.status='Ready for Verification')::int ready_for_verification,
              COUNT(*) FILTER (WHERE lc.status='Completed')::int completed
         FROM employee_lifecycle_cases lc WHERE ${scope}`,
      params
    );
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("[employee-lifecycle:summary]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load lifecycle summary." });
  }
});

router.get("/cases", async (req, res) => {
  try {
    const params = [];
    const clauses = [addCaseScope(req, "lc", params, req.query.branch_id)];
    const type = normalizeLifecycleType(req.query.type);
    if (req.query.type && !type) return res.status(400).json({ success: false, message: "Invalid lifecycle type." });
    if (type) {
      params.push(type);
      clauses.push(`lc.lifecycle_type=$${params.length}`);
    }
    if (req.query.status) {
      if (!CASE_STATUSES.includes(String(req.query.status))) return res.status(400).json({ success: false, message: "Invalid lifecycle status." });
      params.push(String(req.query.status));
      clauses.push(`lc.status=$${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${String(req.query.search).trim()}%`);
      clauses.push(`(lc.case_number ILIKE $${params.length} OR employee.full_name ILIKE $${params.length} OR employee.email ILIKE $${params.length})`);
    }
    const result = await db.query(
      `SELECT lc.*,employee.full_name employee_name,employee.email employee_email,b.branch_name,
              t.ticket_number related_ticket_number,
              COUNT(lt.lifecycle_task_id)::int task_count,
              COUNT(lt.lifecycle_task_id) FILTER (WHERE lt.status='Completed')::int completed_task_count,
              COUNT(lt.lifecycle_task_id) FILTER (WHERE lt.is_required AND lt.status='Pending')::int required_pending_count
         FROM employee_lifecycle_cases lc
         JOIN users employee ON employee.user_id=lc.employee_id
         JOIN branches b ON b.branch_id=lc.branch_id
         LEFT JOIN tickets t ON t.id=lc.related_ticket_id
         LEFT JOIN employee_lifecycle_tasks lt ON lt.lifecycle_case_id=lc.lifecycle_case_id
        WHERE ${clauses.join(" AND ")}
        GROUP BY lc.lifecycle_case_id,employee.user_id,b.branch_id,t.id
        ORDER BY CASE WHEN lc.status IN ('Completed','Cancelled') THEN 1 ELSE 0 END,lc.updated_at DESC
        LIMIT 250`,
      params
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("[employee-lifecycle:list]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load lifecycle cases." });
  }
});

router.post("/cases", async (req, res) => {
  const client = await db.rawPool.connect();
  try {
    const type = normalizeLifecycleType(req.body.lifecycle_type);
    const employeeId = Number(req.body.employee_id);
    if (!type || !employeeId) return res.status(400).json({ success: false, message: "Lifecycle type and employee are required." });
    await client.query("BEGIN");
    const employeeResult = await client.query(
      `SELECT u.user_id,u.branch_id,u.full_name,r.role_name
         FROM users u JOIN system_roles r ON r.role_id=u.role_id
        WHERE u.user_id=$1 FOR UPDATE OF u`,
      [employeeId]
    );
    const employee = employeeResult.rows[0];
    if (!employee || normalizeRole(employee.role_name) !== "employee") {
      throw Object.assign(new Error("The selected employee does not exist."), { status: 404 });
    }
    if (req.lifecycleActor.role !== "superadmin" && Number(employee.branch_id) !== Number(req.lifecycleActor.branch_id)) {
      throw Object.assign(new Error("The selected employee is outside your branch."), { status: 403 });
    }
    if (req.body.related_ticket_id) {
      const ticket = await client.query(`SELECT id,branch_id FROM tickets WHERE id=$1`, [Number(req.body.related_ticket_id)]);
      if (!ticket.rows.length || Number(ticket.rows[0].branch_id) !== Number(employee.branch_id)) {
        throw Object.assign(new Error("The linked ticket must exist in the employee branch."), { status: 400 });
      }
    }
    const caseNumber = await nextCaseNumber(client, type);
    const created = await client.query(
      `INSERT INTO employee_lifecycle_cases
         (case_number,lifecycle_type,employee_id,branch_id,related_ticket_id,target_date,notes,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING lifecycle_case_id`,
      [caseNumber, type, employeeId, employee.branch_id, req.body.related_ticket_id || null,
        req.body.target_date || null, String(req.body.notes || "").trim() || null, req.lifecycleActor.user_id]
    );
    const caseId = created.rows[0].lifecycle_case_id;
    for (const task of getDefaultTasks(type)) {
      await client.query(
        `INSERT INTO employee_lifecycle_tasks
           (lifecycle_case_id,task_key,task_label,task_description,assigned_role,is_required,sort_order)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [caseId, task.taskKey, task.label, task.description, task.assignedRole, task.required, task.sortOrder]
      );
    }
    await addHistory(client, caseId, req.lifecycleActor.user_id, "case_created", `${type} case ${caseNumber} created.`);
    await client.query("COMMIT");
    return res.status(201).json({ success: true, data: await loadCase(db, caseId) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return res.status(409).json({ success: false, message: "This employee already has an active case of this type." });
    console.error("[employee-lifecycle:create]", error.message);
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Failed to create lifecycle case." });
  } finally {
    client.release();
  }
});

router.get("/cases/:id", async (req, res) => {
  try {
    if (!(await assertScopedCase(req, db, req.params.id))) return res.status(404).json({ success: false, message: "Lifecycle case not found." });
    const [caseData, tasks, history] = await Promise.all([
      loadCase(db, req.params.id),
      db.query(
        `SELECT lt.*,u.full_name completed_by_name FROM employee_lifecycle_tasks lt
         LEFT JOIN users u ON u.user_id=lt.completed_by
         WHERE lt.lifecycle_case_id=$1 ORDER BY lt.sort_order,lt.lifecycle_task_id`,
        [req.params.id]
      ),
      db.query(
        `SELECT lh.*,u.full_name changed_by_name FROM employee_lifecycle_history lh
         LEFT JOIN users u ON u.user_id=lh.changed_by
         WHERE lh.lifecycle_case_id=$1 ORDER BY lh.created_at DESC`,
        [req.params.id]
      ),
    ]);
    return res.json({ success: true, data: { ...caseData, tasks: tasks.rows, history: history.rows } });
  } catch (error) {
    console.error("[employee-lifecycle:details]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load lifecycle case." });
  }
});

router.patch("/cases/:id/tasks/:taskId", async (req, res) => {
  const client = await db.rawPool.connect();
  try {
    const nextStatus = String(req.body.status || "");
    if (!["Pending", "Completed", "Not Applicable"].includes(nextStatus)) {
      return res.status(400).json({ success: false, message: "Invalid task status." });
    }
    await client.query("BEGIN");
    if (!(await assertScopedCase(req, client, req.params.id, true))) throw Object.assign(new Error("Lifecycle case not found."), { status: 404 });
    const taskResult = await client.query(
      `SELECT lt.*,lc.status case_status FROM employee_lifecycle_tasks lt
       JOIN employee_lifecycle_cases lc ON lc.lifecycle_case_id=lt.lifecycle_case_id
       WHERE lt.lifecycle_case_id=$1 AND lt.lifecycle_task_id=$2 FOR UPDATE OF lt`,
      [req.params.id, req.params.taskId]
    );
    const task = taskResult.rows[0];
    if (!task) throw Object.assign(new Error("Checklist task not found."), { status: 404 });
    if (TERMINAL_STATUSES.has(task.case_status)) throw Object.assign(new Error("A completed or cancelled case cannot be edited."), { status: 409 });
    if (!canUpdateLifecycleTask(req.lifecycleActor.role, task.assigned_role)) {
      throw Object.assign(new Error(`This task must be completed by an ${lifecycleTaskOwnerLabel(task.assigned_role)}.`), { status: 403 });
    }
    if (nextStatus === "Not Applicable" && task.is_required) {
      throw Object.assign(new Error("Required checklist tasks cannot be marked Not Applicable."), { status: 400 });
    }
    await client.query(
      `UPDATE employee_lifecycle_tasks SET status=$1::text,
         completed_by=CASE WHEN $1::text='Completed' THEN $2::int ELSE NULL END,
         completed_at=CASE WHEN $1::text='Completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
         completion_notes=$3,updated_at=CURRENT_TIMESTAMP
       WHERE lifecycle_task_id=$4`,
      [nextStatus, req.lifecycleActor.user_id, String(req.body.notes || "").trim() || null, req.params.taskId]
    );
    await client.query(`UPDATE employee_lifecycle_cases SET updated_at=CURRENT_TIMESTAMP WHERE lifecycle_case_id=$1`, [req.params.id]);
    await addHistory(client, req.params.id, req.lifecycleActor.user_id, "task_updated", `${task.task_label} marked ${nextStatus}.`, null, null, { taskKey: task.task_key, taskStatus: nextStatus });
    await client.query("COMMIT");
    return res.json({ success: true, data: await loadCase(db, req.params.id) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[employee-lifecycle:task]", error.message);
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Failed to update checklist task." });
  } finally {
    client.release();
  }
});

router.patch("/cases/:id/status", async (req, res) => {
  const client = await db.rawPool.connect();
  try {
    const nextStatus = String(req.body.status || "");
    if (!CASE_STATUSES.includes(nextStatus)) return res.status(400).json({ success: false, message: "Invalid lifecycle status." });
    await client.query("BEGIN");
    if (!(await assertScopedCase(req, client, req.params.id, true))) throw Object.assign(new Error("Lifecycle case not found."), { status: 404 });
    const current = await client.query(`SELECT * FROM employee_lifecycle_cases WHERE lifecycle_case_id=$1 FOR UPDATE`, [req.params.id]);
    const lifecycleCase = current.rows[0];
    if (!canTransition(lifecycleCase.status, nextStatus)) {
      throw Object.assign(new Error(`Status cannot change from ${lifecycleCase.status} to ${nextStatus}.`), { status: 409 });
    }
    if (nextStatus === "Completed") {
      const pending = await client.query(
        `SELECT COUNT(*)::int count FROM employee_lifecycle_tasks
          WHERE lifecycle_case_id=$1 AND is_required AND status='Pending'`,
        [req.params.id]
      );
      if (!canCompleteCase({ requiredPending: pending.rows[0].count })) {
        throw Object.assign(new Error(`${pending.rows[0].count} required checklist task(s) are still pending.`), { status: 409 });
      }
    }
    await client.query(
      `UPDATE employee_lifecycle_cases SET status=$1::text,updated_at=CURRENT_TIMESTAMP,
         verified_by=CASE WHEN $1::text='Completed' THEN $2::int ELSE verified_by END,
         completed_at=CASE WHEN $1::text='Completed' THEN CURRENT_TIMESTAMP ELSE completed_at END,
         cancelled_at=CASE WHEN $1::text='Cancelled' THEN CURRENT_TIMESTAMP ELSE cancelled_at END
       WHERE lifecycle_case_id=$3`,
      [nextStatus, req.lifecycleActor.user_id, req.params.id]
    );
    await addHistory(client, req.params.id, req.lifecycleActor.user_id, "status_changed", `Status changed from ${lifecycleCase.status} to ${nextStatus}.`, lifecycleCase.status, nextStatus, { notes: String(req.body.notes || "").trim() || null });
    await client.query("COMMIT");
    return res.json({ success: true, data: await loadCase(db, req.params.id) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[employee-lifecycle:status]", error.message);
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Failed to update lifecycle status." });
  } finally {
    client.release();
  }
});

module.exports = router;
