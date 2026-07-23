const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const db = require("../../config/db");
const {
  CASE_STATUSES,
  TERMINAL_STATUSES,
  normalizeLifecycleType,
  getDefaultTasks,
  canTransition,
  canCompleteCase,
  calculateLifecycleTicketPriority,
  deriveOffboardingStatusAfterTask,
  canUpdateLifecycleTask,
} = require("../services/employeeLifecycleService");
const { executeInternalOffboardingTask } = require("../services/internalOffboardingService");
const {
  AUTOMATED_ONBOARDING_TASK_KEYS,
  reconcileOnboardingCase,
} = require("../services/onboardingReconciliationService");
const { createServiceDeskTicket } = require("../services/serviceDeskTicketService");
const { emitTicketChanged } = require("../services/socketService");
const {
  getMissingSmtpConfig,
  sendInvitationEmail,
  sendInvitationReminderEmail,
} = require("../services/emailService");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
const ACCESS_ROLES = new Set(["superadmin", "admin", "hr"]);

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]/g, "");
}

function normalizeOptionalText(value, maxLength = 255) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeOptionalEmail(value) {
  const normalized = normalizeOptionalText(value, 255)?.toLowerCase() || null;
  if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw Object.assign(new Error("Enter a valid email address."), { status: 400 });
  }
  return normalized;
}

function buildInviteLink(req, token) {
  const configuredOrigin = String(process.env.FRONTEND_URL || req.get("origin") || "http://localhost:5173").trim();
  const origin = /^https?:\/\//i.test(configuredOrigin)
    ? configuredOrigin
    : `${/^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(configuredOrigin) ? "http" : "https"}://${configuredOrigin}`;
  return `${origin.replace(/\/$/, "")}/invite/${token}`;
}

async function deliverLifecycleInvitation({ companyEmail, personalEmail, fullName, branchName, inviteLink }) {
  const primaryEmail = String(companyEmail || personalEmail || "").trim().toLowerCase();
  const reminderEmail = String(personalEmail || "").trim().toLowerCase();
  if (process.env.NODE_ENV === "test") {
    return {
      email_sent: false,
      email_recipients: [],
      primary_email: primaryEmail || null,
      primary_email_sent: false,
      reminder_email: reminderEmail && reminderEmail !== primaryEmail ? reminderEmail : null,
      reminder_email_sent: false,
      email_warning: "Invitation email delivery is disabled during automated tests.",
    };
  }
  const missingConfig = getMissingSmtpConfig();
  if (missingConfig.length) {
    return {
      email_sent: false,
      email_recipients: [],
      email_warning: `Invitation created, but email was not sent. Missing SMTP configuration: ${missingConfig.join(", ")}.`,
    };
  }

  const primaryResult = await sendInvitationEmail({
      to: primaryEmail,
      fullName,
      roleName: "Employee",
      branchName,
      inviteLink,
      expiresInHours: 48,
    });
  const shouldSendReminder = Boolean(reminderEmail && reminderEmail !== primaryEmail);
  const reminderResult = shouldSendReminder
    ? await sendInvitationReminderEmail({
        to: reminderEmail,
        fullName,
        companyEmail: primaryEmail,
        expiresInHours: 48,
      })
    : null;
  const delivered = [
    primaryResult?.success && primaryEmail,
    reminderResult?.success && reminderEmail,
  ].filter(Boolean);
  const failures = [
    !primaryResult?.success && `${primaryEmail}: ${primaryResult?.error || "delivery failed"}`,
    shouldSendReminder && !reminderResult?.success && `${reminderEmail}: ${reminderResult?.error || "delivery failed"}`,
  ].filter(Boolean);
  return {
    email_sent: Boolean(primaryResult?.success),
    email_recipients: delivered,
    primary_email: primaryEmail,
    primary_email_sent: Boolean(primaryResult?.success),
    reminder_email: shouldSendReminder ? reminderEmail : null,
    reminder_email_sent: Boolean(reminderResult?.success),
    email_warning: failures.length ? `Email delivery failed for ${failures.join("; ")}.` : null,
  };
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
    `SELECT lc.*,COALESCE(employee.full_name,lc.subject_full_name) employee_name,
            COALESCE(employee.personal_email,employee.email,lc.subject_contact_email) employee_email,
            COALESCE(employee.employee_number,lc.subject_employee_number) employee_number,
            COALESCE(employee.department,lc.subject_department) employee_department,
            employee.is_active employee_is_active,employee.invite_status employee_invite_status,
            b.branch_name,
            creator.full_name created_by_name,verifier.full_name verified_by_name,
            t.ticket_number related_ticket_number,t.title related_ticket_title,
            COUNT(lt.lifecycle_task_id)::int task_count,
            COUNT(lt.lifecycle_task_id) FILTER (WHERE lt.status='Completed')::int completed_task_count,
            COUNT(lt.lifecycle_task_id) FILTER (WHERE lt.is_required AND lt.status='Pending')::int required_pending_count
       FROM employee_lifecycle_cases lc
       LEFT JOIN users employee ON employee.user_id=lc.employee_id
       JOIN branches b ON b.branch_id=lc.branch_id
       JOIN users creator ON creator.user_id=lc.created_by
       LEFT JOIN users verifier ON verifier.user_id=lc.verified_by
       LEFT JOIN tickets t ON t.id=lc.related_ticket_id
       LEFT JOIN employee_lifecycle_tasks lt ON lt.lifecycle_case_id=lc.lifecycle_case_id
      WHERE lc.lifecycle_case_id=$1 AND lc.deleted_at IS NULL
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
      WHERE lc.lifecycle_case_id=$1 AND lc.deleted_at IS NULL AND ${scope}${lock ? " FOR UPDATE" : ""}`,
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

router.get("/branches", async (req, res) => {
  try {
    const params = [];
    const scope = req.lifecycleActor.role === "superadmin"
      ? "1=1"
      : (params.push(Number(req.lifecycleActor.branch_id)), `branch_id=$${params.length}`);
    const result = await db.query(
      `SELECT branch_id,branch_name FROM branches WHERE ${scope} ORDER BY branch_name`,
      params
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("[employee-lifecycle:branches]", error.message);
    return res.status(500).json({ success: false, message: "Failed to load lifecycle branches." });
  }
});

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
         FROM employee_lifecycle_cases lc WHERE lc.deleted_at IS NULL AND ${scope}`,
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
    const clauses = ["lc.deleted_at IS NULL", addCaseScope(req, "lc", params, req.query.branch_id)];
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
      clauses.push(`(lc.case_number ILIKE $${params.length}
        OR COALESCE(employee.full_name,lc.subject_full_name) ILIKE $${params.length}
        OR COALESCE(employee.personal_email,employee.email,lc.subject_contact_email,'') ILIKE $${params.length}
        OR COALESCE(employee.employee_number,lc.subject_employee_number,'') ILIKE $${params.length})`);
    }
    const result = await db.query(
      `SELECT lc.*,COALESCE(employee.full_name,lc.subject_full_name) employee_name,
              COALESCE(employee.personal_email,employee.email,lc.subject_contact_email) employee_email,
              employee.is_active employee_is_active,employee.invite_status employee_invite_status,
              b.branch_name,
              t.ticket_number related_ticket_number,
              COUNT(lt.lifecycle_task_id)::int task_count,
              COUNT(lt.lifecycle_task_id) FILTER (WHERE lt.status='Completed')::int completed_task_count,
              COUNT(lt.lifecycle_task_id) FILTER (WHERE lt.is_required AND lt.status='Pending')::int required_pending_count
         FROM employee_lifecycle_cases lc
         LEFT JOIN users employee ON employee.user_id=lc.employee_id
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
  let createdLifecycleTicket = null;
  try {
    const type = normalizeLifecycleType(req.body.lifecycle_type);
    const employeeId = Number(req.body.employee_id) || null;
    const preHire = type === "Onboarding" && !employeeId;
    const subjectFullName = normalizeOptionalText(req.body.subject_full_name);
    const subjectContactEmail = normalizeOptionalEmail(req.body.subject_contact_email);
    const requestedBranchId = Number(req.body.branch_id) || null;
    if (!type) return res.status(400).json({ success: false, message: "Lifecycle type is required." });
    if (type === "Offboarding" && !employeeId) {
      return res.status(400).json({ success: false, message: "Offboarding requires an existing employee." });
    }
    if (preHire && (!subjectFullName || !requestedBranchId)) {
      return res.status(400).json({ success: false, message: "Employee name and branch are required for new onboarding." });
    }
    await client.query("BEGIN");
    let employee = null;
    let branchId = requestedBranchId;
    if (employeeId) {
      const employeeResult = await client.query(
        `SELECT u.user_id,u.branch_id,u.full_name,u.personal_email,u.email,u.employee_number,u.department,r.role_name
           FROM users u JOIN system_roles r ON r.role_id=u.role_id
          WHERE u.user_id=$1 FOR UPDATE OF u`,
        [employeeId]
      );
      employee = employeeResult.rows[0];
      if (!employee || normalizeRole(employee.role_name) !== "employee") {
        throw Object.assign(new Error("The selected employee does not exist."), { status: 404 });
      }
      branchId = Number(employee.branch_id);
    } else {
      const branch = await client.query(`SELECT branch_id FROM branches WHERE branch_id=$1`, [branchId]);
      if (!branch.rows.length) throw Object.assign(new Error("The selected branch does not exist."), { status: 404 });
      const duplicate = await client.query(
        `SELECT lifecycle_case_id FROM employee_lifecycle_cases
          WHERE employee_id IS NULL AND lifecycle_type='Onboarding'
            AND branch_id=$1 AND LOWER(subject_full_name)=LOWER($2)
            AND COALESCE(subject_start_date,DATE '1900-01-01')=COALESCE($3::date,DATE '1900-01-01')
            AND status NOT IN ('Completed','Cancelled') LIMIT 1`,
        [branchId, subjectFullName, req.body.subject_start_date || null]
      );
      if (duplicate.rows.length) {
        throw Object.assign(new Error("This new employee already has an active onboarding case."), { status: 409 });
      }
    }
    if (req.lifecycleActor.role !== "superadmin" && Number(branchId) !== Number(req.lifecycleActor.branch_id)) {
      throw Object.assign(new Error("The selected employee or branch is outside your branch."), { status: 403 });
    }
    let relatedTicketId = Number(req.body.related_ticket_id) || null;
    if (relatedTicketId) {
      const ticket = await client.query(`SELECT id,branch_id FROM tickets WHERE id=$1`, [Number(req.body.related_ticket_id)]);
      if (!ticket.rows.length || Number(ticket.rows[0].branch_id) !== Number(branchId)) {
        throw Object.assign(new Error("The linked ticket must exist in the employee branch."), { status: 400 });
      }
    }
    const caseNumber = await nextCaseNumber(client, type);
    if (!relatedTicketId) {
      const subjectName = employee?.full_name || subjectFullName;
      const lifecyclePriority = calculateLifecycleTicketPriority({
        lifecycleType: type,
        targetDate: req.body.target_date,
        startDate: req.body.subject_start_date,
      });
      const ticketResult = await createServiceDeskTicket({
        client,
        emitAfterCreate: false,
        title: `${type} Request — ${subjectName}`,
        description: `${type} lifecycle request for ${subjectName}. Complete and verify the operational checklist in lifecycle case ${caseNumber}.`,
        priority: lifecyclePriority,
        status: "Open Queue",
        requesterId: req.lifecycleActor.user_id,
        branchId,
        source: "employee_lifecycle",
        impact: "Medium",
        urgency: "Medium",
        actorId: req.lifecycleActor.user_id,
        requireBranch: true,
        metadata: {
          origin_module: "Employee Lifecycle",
          origin_feature: type,
          created_via: "Lifecycle Workflow",
          lifecycle_target_date: req.body.target_date || null,
          lifecycle_start_date: req.body.subject_start_date || null,
        },
        auditEvent: `${type} Lifecycle Ticket Created`,
        requestMethod: req.method,
        requestPath: req.originalUrl,
        sourceIp: req.ip,
      });
      createdLifecycleTicket = ticketResult.ticket;
      relatedTicketId = createdLifecycleTicket.id;
    }
    const created = await client.query(
      `INSERT INTO employee_lifecycle_cases
         (case_number,lifecycle_type,employee_id,branch_id,related_ticket_id,target_date,notes,created_by,
          subject_full_name,subject_contact_email,subject_employee_number,subject_department,
          subject_job_title,subject_start_date)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING lifecycle_case_id`,
      [caseNumber, type, employeeId, branchId, relatedTicketId,
        req.body.target_date || null, normalizeOptionalText(req.body.notes, 5000), req.lifecycleActor.user_id,
        employee?.full_name || subjectFullName,
        employee?.personal_email || employee?.email || subjectContactEmail,
        employee?.employee_number || normalizeOptionalText(req.body.subject_employee_number, 100),
        employee?.department || normalizeOptionalText(req.body.subject_department),
        normalizeOptionalText(req.body.subject_job_title), req.body.subject_start_date || null]
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
    if (type === "Onboarding") {
      await reconcileOnboardingCase(client, caseId);
    }
    await client.query("COMMIT");
    if (createdLifecycleTicket) {
      emitTicketChanged({
        action: "created",
        ticket_id: createdLifecycleTicket.id,
        ticket_number: createdLifecycleTicket.ticket_number,
        branch_id: createdLifecycleTicket.branch_id,
        requester_id: createdLifecycleTicket.requester_id,
        assigned_to: createdLifecycleTicket.assigned_to,
        status: createdLifecycleTicket.status,
      });
    }
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

router.post("/cases/:id/account-invitation", async (req, res) => {
  if (!["superadmin", "admin"].includes(req.lifecycleActor.role)) {
    return res.status(403).json({ success: false, message: "You do not have permission to create employee accounts." });
  }
  const client = await db.rawPool.connect();
  try {
    const personalEmail = normalizeOptionalEmail(req.body.personal_email);
    const companyEmail = normalizeOptionalEmail(req.body.company_email);
    await client.query("BEGIN");
    if (!(await assertScopedCase(req, client, req.params.id, true))) {
      throw Object.assign(new Error("Lifecycle case not found."), { status: 404 });
    }
    const caseResult = await client.query(
      `SELECT * FROM employee_lifecycle_cases WHERE lifecycle_case_id=$1 FOR UPDATE`,
      [req.params.id]
    );
    const lifecycleCase = caseResult.rows[0];
    if (lifecycleCase.lifecycle_type !== "Onboarding") {
      throw Object.assign(new Error("Account invitations can only be created from onboarding cases."), { status: 409 });
    }
    if (TERMINAL_STATUSES.has(lifecycleCase.status)) {
      throw Object.assign(new Error("A completed or cancelled case cannot create an account."), { status: 409 });
    }
    if (lifecycleCase.employee_id) {
      throw Object.assign(new Error("This onboarding case is already linked to an employee account."), { status: 409 });
    }
    const personalRecipient = personalEmail || normalizeOptionalEmail(lifecycleCase.subject_contact_email);
    if (!companyEmail) throw Object.assign(new Error("A company/login email is required for the secure account invitation."), { status: 400 });
    if (!personalRecipient) throw Object.assign(new Error("A personal email is required for the invitation reminder."), { status: 400 });
    const loginEmail = companyEmail;
    const existing = await client.query(
      `SELECT user_id FROM users
        WHERE LOWER(email)=LOWER($1)
           OR ($2::text IS NOT NULL AND LOWER(personal_email)=LOWER($2))
           OR ($3::text IS NOT NULL AND LOWER(company_email)=LOWER($3))
        LIMIT 1`,
      [loginEmail, personalRecipient, companyEmail]
    );
    if (existing.rows.length) {
      throw Object.assign(new Error("An AstreaBlue account already uses this email. Create the case using Existing employee instead."), { status: 409 });
    }
    const roleResult = await client.query(
      `SELECT role_id FROM system_roles WHERE LOWER(role_name)='employee' LIMIT 1`
    );
    if (!roleResult.rows.length) throw new Error("Employee role is not configured.");
    const token = crypto.randomBytes(32).toString("hex");
    const employeeNumber = normalizeOptionalText(req.body.employee_number || lifecycleCase.subject_employee_number, 100);
    const department = normalizeOptionalText(req.body.department || lifecycleCase.subject_department);
    const created = await client.query(
      `INSERT INTO users
         (full_name,email,personal_email,company_email,password_hash,role_id,company_name,branch_id,
          status,is_active,invite_status,invite_token,invite_expires_at,invited_by,invited_at,
          onboarding_status,onboarding_required,employee_number,department)
       VALUES($1,$2,$3,$4,'INVITE_PENDING',$5,'AstreaBlue',$6,
          'Inactive',FALSE,'Pending',$7,CURRENT_TIMESTAMP + INTERVAL '48 hours',$8,CURRENT_TIMESTAMP,
          'Invited',TRUE,$9,$10)
       RETURNING user_id,full_name,email,personal_email,company_email,branch_id,invite_status,invite_expires_at`,
      [lifecycleCase.subject_full_name, loginEmail, personalRecipient, companyEmail,
        roleResult.rows[0].role_id, lifecycleCase.branch_id, token, req.lifecycleActor.user_id,
        employeeNumber, department]
    );
    const user = created.rows[0];
    await client.query(
      `UPDATE employee_lifecycle_cases
          SET employee_id=$1,subject_contact_email=COALESCE($2,subject_contact_email),
              subject_employee_number=COALESCE($3,subject_employee_number),
              subject_department=COALESCE($4,subject_department),
              account_provisioned_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE lifecycle_case_id=$5`,
      [user.user_id, personalRecipient, employeeNumber, department, req.params.id]
    );
    await client.query(
      `UPDATE employee_lifecycle_tasks
          SET status='Completed',completed_by=$1,completed_at=CURRENT_TIMESTAMP,
              completion_notes='AstreaBlue account invitation created and linked.',
              automation_result=$2::jsonb,automation_completed_at=CURRENT_TIMESTAMP,
              updated_at=CURRENT_TIMESTAMP
        WHERE lifecycle_case_id=$3 AND task_key='create_account'`,
      [req.lifecycleActor.user_id, JSON.stringify({ action: "account_invitation_created", userId: user.user_id }), req.params.id]
    );
    await addHistory(client, req.params.id, req.lifecycleActor.user_id, "account_invitation_created",
      `AstreaBlue account invitation created and linked to ${lifecycleCase.case_number}.`, null, null,
      { userId: user.user_id, inviteStatus: user.invite_status });
    await client.query("COMMIT");
    const inviteLink = buildInviteLink(req, token);
    const caseData = await loadCase(db, req.params.id);
    const delivery = await deliverLifecycleInvitation({
      companyEmail,
      personalEmail: personalRecipient,
      fullName: lifecycleCase.subject_full_name,
      branchName: caseData?.branch_name,
      inviteLink,
    });
    return res.status(201).json({
      success: true,
      data: {
        case: caseData,
        invitation: user,
        invite_link: inviteLink,
        ...delivery,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[employee-lifecycle:account-invitation]", error.message);
    if (error.code === "23505") {
      return res.status(409).json({ success: false, message: "An account already uses the supplied email or employee number." });
    }
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Failed to create the account invitation." });
  } finally {
    client.release();
  }
});

router.post("/cases/:id/account-invitation/resend", async (req, res) => {
  if (!["superadmin", "admin"].includes(req.lifecycleActor.role)) {
    return res.status(403).json({ success: false, message: "You do not have permission to resend employee invitations." });
  }
  const client = await db.rawPool.connect();
  try {
    await client.query("BEGIN");
    if (!(await assertScopedCase(req, client, req.params.id, true))) {
      throw Object.assign(new Error("Lifecycle case not found."), { status: 404 });
    }
    const result = await client.query(
      `SELECT lc.lifecycle_case_id,lc.case_number,lc.lifecycle_type,lc.status,lc.subject_full_name,
              u.user_id,u.full_name,u.email,u.personal_email,u.company_email,u.invite_status,u.is_active,
              b.branch_name
         FROM employee_lifecycle_cases lc
         JOIN users u ON u.user_id=lc.employee_id
         JOIN branches b ON b.branch_id=lc.branch_id
        WHERE lc.lifecycle_case_id=$1
        FOR UPDATE OF lc,u`,
      [req.params.id]
    );
    const record = result.rows[0];
    if (!record || record.lifecycle_type !== "Onboarding") {
      throw Object.assign(new Error("An onboarding invitation was not found."), { status: 404 });
    }
    if (TERMINAL_STATUSES.has(record.status)) {
      throw Object.assign(new Error("A completed or cancelled onboarding case cannot resend an invitation."), { status: 409 });
    }
    if (record.is_active || String(record.invite_status).toLowerCase() === "accepted") {
      throw Object.assign(new Error("The employee account is already active."), { status: 409 });
    }
    if (String(record.invite_status).toLowerCase() === "revoked") {
      throw Object.assign(new Error("This invitation was revoked. Reactivate it from User & Role Management first."), { status: 409 });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const updated = await client.query(
      `UPDATE users
          SET invite_status='Pending',invite_token=$1,
              invite_expires_at=CURRENT_TIMESTAMP + INTERVAL '48 hours',invite_used_at=NULL
        WHERE user_id=$2
        RETURNING user_id,full_name,email,personal_email,company_email,branch_id,invite_status,invite_expires_at`,
      [token, record.user_id]
    );
    await addHistory(client, req.params.id, req.lifecycleActor.user_id, "account_invitation_resent",
      `AstreaBlue account invitation regenerated for ${record.case_number}.`, null, null,
      { userId: record.user_id, inviteStatus: "Pending" });
    await client.query("COMMIT");

    const inviteLink = buildInviteLink(req, token);
    const delivery = await deliverLifecycleInvitation({
      companyEmail: record.company_email || record.email,
      personalEmail: record.personal_email,
      fullName: record.full_name || record.subject_full_name,
      branchName: record.branch_name,
      inviteLink,
    });
    return res.status(200).json({
      success: true,
      data: {
        case: await loadCase(db, req.params.id),
        invitation: updated.rows[0],
        invite_link: inviteLink,
        ...delivery,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[employee-lifecycle:account-invitation-resend]", error.message);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to resend the account invitation.",
    });
  } finally {
    client.release();
  }
});

router.delete("/cases/:id", async (req, res) => {
  if (req.lifecycleActor.role !== "superadmin") {
    return res.status(403).json({ success: false, message: "Only SuperAdmin can delete lifecycle cases." });
  }
  const client = await db.rawPool.connect();
  try {
    await client.query("BEGIN");
    if (!(await assertScopedCase(req, client, req.params.id, true))) {
      throw Object.assign(new Error("Lifecycle case not found."), { status: 404 });
    }
    const result = await client.query(
      `SELECT lifecycle_case_id,case_number,status,related_ticket_id
         FROM employee_lifecycle_cases
        WHERE lifecycle_case_id=$1 AND deleted_at IS NULL
        FOR UPDATE`,
      [req.params.id]
    );
    const lifecycleCase = result.rows[0];
    if (lifecycleCase.status === "Completed") {
      throw Object.assign(new Error("Completed lifecycle cases are protected audit records and cannot be deleted."), { status: 409 });
    }
    const reason = normalizeOptionalText(req.body?.reason, 1000) || "Removed from the lifecycle workspace by SuperAdmin.";
    await client.query(
      `UPDATE employee_lifecycle_cases
          SET status='Cancelled',cancelled_at=COALESCE(cancelled_at,CURRENT_TIMESTAMP),
              deleted_at=CURRENT_TIMESTAMP,deleted_by=$1,deletion_reason=$2,updated_at=CURRENT_TIMESTAMP
        WHERE lifecycle_case_id=$3`,
      [req.lifecycleActor.user_id, reason, req.params.id]
    );
    await addHistory(
      client,
      req.params.id,
      req.lifecycleActor.user_id,
      "case_deleted",
      `Lifecycle case ${lifecycleCase.case_number} was removed from the active workspace.`,
      lifecycleCase.status,
      "Cancelled",
      { reason, relatedTicketId: lifecycleCase.related_ticket_id, softDelete: true }
    );
    await client.query("COMMIT");
    return res.json({
      success: true,
      data: {
        lifecycle_case_id: Number(lifecycleCase.lifecycle_case_id),
        case_number: lifecycleCase.case_number,
        deleted: true,
        linked_ticket_preserved: Boolean(lifecycleCase.related_ticket_id),
      },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[employee-lifecycle:delete]", error.message);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to delete lifecycle case.",
    });
  } finally {
    client.release();
  }
});

router.get("/cases/:id", async (req, res) => {
  try {
    if (!(await assertScopedCase(req, db, req.params.id))) return res.status(404).json({ success: false, message: "Lifecycle case not found." });
    await reconcileOnboardingCase(db, req.params.id);
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
      `SELECT lt.*,lc.status case_status,lc.lifecycle_type,lc.case_number,lc.employee_id,
              lc.branch_id,lc.related_ticket_id,lc.created_by,
              COALESCE(employee.full_name,lc.subject_full_name) employee_name,
              COALESCE(employee.personal_email,employee.email,lc.subject_contact_email) employee_email,
              employee.employee_number,employee.is_active employee_is_active
       FROM employee_lifecycle_tasks lt
       JOIN employee_lifecycle_cases lc ON lc.lifecycle_case_id=lt.lifecycle_case_id
       LEFT JOIN users employee ON employee.user_id=lc.employee_id
       WHERE lt.lifecycle_case_id=$1 AND lt.lifecycle_task_id=$2 FOR UPDATE OF lt`,
      [req.params.id, req.params.taskId]
    );
    const task = taskResult.rows[0];
    if (!task) throw Object.assign(new Error("Checklist task not found."), { status: 404 });
    if (TERMINAL_STATUSES.has(task.case_status)) throw Object.assign(new Error("A completed or cancelled case cannot be edited."), { status: 409 });
    if (!canUpdateLifecycleTask(req.lifecycleActor.role, task.assigned_role)) {
      throw Object.assign(new Error("You do not have permission to complete this checklist item."), { status: 403 });
    }
    if (task.lifecycle_type === "Onboarding" && AUTOMATED_ONBOARDING_TASK_KEYS.has(task.task_key)) {
      throw Object.assign(new Error("This onboarding item is synchronized automatically from system evidence and cannot be checked manually."), { status: 409 });
    }
    if (nextStatus === "Completed" && task.lifecycle_type === "Onboarding" && !task.employee_id) {
      if (task.task_key === "create_account") {
        throw Object.assign(new Error("Use Create account invitation to complete this checklist item."), { status: 409 });
      }
      if (task.task_key !== "confirm_employment") {
        throw Object.assign(new Error("Create and link the employee account before completing this checklist item."), { status: 409 });
      }
    }
    if (nextStatus === "Completed" && task.lifecycle_type === "Onboarding" && task.employee_id
        && task.employee_is_active === false && !["confirm_employment", "create_account"].includes(task.task_key)) {
      throw Object.assign(new Error("The employee must activate the AstreaBlue account before this checklist item can be completed."), { status: 409 });
    }
    if (nextStatus === "Not Applicable" && task.is_required) {
      throw Object.assign(new Error("Required checklist tasks cannot be marked Not Applicable."), { status: 400 });
    }
    if (nextStatus === "Completed" && task.lifecycle_type === "Onboarding" && task.task_key === "final_verification") {
      await reconcileOnboardingCase(client, req.params.id);
      const remaining = await client.query(
        `SELECT COUNT(*)::int count FROM employee_lifecycle_tasks
          WHERE lifecycle_case_id=$1 AND is_required AND status='Pending' AND task_key<>'final_verification'`,
        [req.params.id]
      );
      if (remaining.rows[0].count > 0) {
        throw Object.assign(new Error(`${remaining.rows[0].count} required onboarding item(s) still need evidence before final verification.`), { status: 409 });
      }
    }
    if (task.lifecycle_type === "Offboarding" && task.status === "Completed" && nextStatus !== "Completed") {
      throw Object.assign(new Error("Completed offboarding actions cannot be reopened because their internal changes are already committed."), { status: 409 });
    }
    let automationResult = task.automation_result || {};
    if (nextStatus === "Completed" && task.status !== "Completed") {
      automationResult = await executeInternalOffboardingTask({
        queryable: client,
        lifecycleCase: {
          lifecycle_case_id: Number(req.params.id),
          lifecycle_type: task.lifecycle_type,
          case_number: task.case_number,
          employee_id: task.employee_id,
          branch_id: task.branch_id,
          related_ticket_id: task.related_ticket_id,
          created_by: task.created_by,
        },
        task,
        employee: {
          user_id: task.employee_id,
          full_name: task.employee_name,
          email: task.employee_email,
          employee_number: task.employee_number,
        },
        actor: req.lifecycleActor,
        notes: req.body.notes,
      });
    }
    await client.query(
      `UPDATE employee_lifecycle_tasks SET status=$1::text,
         completed_by=CASE WHEN $1::text='Completed' THEN $2::int ELSE NULL END,
         completed_at=CASE WHEN $1::text='Completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
         completion_notes=$3,automation_result=$4::jsonb,
         automation_completed_at=CASE WHEN $1::text='Completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
         updated_at=CURRENT_TIMESTAMP
       WHERE lifecycle_task_id=$5`,
      [nextStatus, req.lifecycleActor.user_id, String(req.body.notes || "").trim() || null,
        JSON.stringify(automationResult), req.params.taskId]
    );
    let automaticallyDerivedCaseStatus = task.case_status;
    if (task.lifecycle_type === "Offboarding") {
      const remaining = await client.query(
        `SELECT COUNT(*)::int count FROM employee_lifecycle_tasks
          WHERE lifecycle_case_id=$1 AND is_required AND status='Pending'`,
        [req.params.id]
      );
      automaticallyDerivedCaseStatus = deriveOffboardingStatusAfterTask({
        lifecycleType: task.lifecycle_type,
        currentStatus: task.case_status,
        taskStatus: nextStatus,
        requiredPending: remaining.rows[0].count,
      });
    }
    await client.query(
      `UPDATE employee_lifecycle_cases SET status=$1::text,updated_at=CURRENT_TIMESTAMP
        WHERE lifecycle_case_id=$2`,
      [automaticallyDerivedCaseStatus, req.params.id]
    );
    await addHistory(client, req.params.id, req.lifecycleActor.user_id, "task_updated", `${task.task_label} marked ${nextStatus}.`, null, null,
      { taskKey: task.task_key, taskStatus: nextStatus, automation: automationResult });
    if (automaticallyDerivedCaseStatus !== task.case_status) {
      await addHistory(
        client,
        req.params.id,
        req.lifecycleActor.user_id,
        "status_changed",
        `Status automatically changed from ${task.case_status} to ${automaticallyDerivedCaseStatus}.`,
        task.case_status,
        automaticallyDerivedCaseStatus,
        { source: "offboarding_task_progression", taskKey: task.task_key }
      );
    }
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
      if (lifecycleCase.lifecycle_type === "Onboarding") {
        await reconcileOnboardingCase(client, req.params.id);
      }
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
