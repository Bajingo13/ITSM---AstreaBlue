const { createNotification } = require("./notificationService");

const TASK_PREREQUISITES = Object.freeze({
  classify_assets: ["recover_assets"],
  verify_checklist: ["disable_access", "recover_assets", "audit_licenses", "secure_data", "classify_assets"],
  notify_parties: ["verify_checklist"],
  close_linked_ticket: ["notify_parties"],
});
const NOTE_REQUIRED_TASKS = new Set(["audit_licenses", "secure_data", "classify_assets"]);
const CLASSIFIED_ASSET_STATUSES = new Set(["available", "in stock", "in repair", "retired", "disposed"]);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function assertPrerequisites(queryable, lifecycleCaseId, taskKey) {
  const required = TASK_PREREQUISITES[taskKey] || [];
  if (!required.length) return;
  const result = await queryable.query(
    `SELECT task_key,task_label,status FROM employee_lifecycle_tasks
      WHERE lifecycle_case_id=$1 AND task_key=ANY($2::text[])`,
    [lifecycleCaseId, required]
  );
  const completed = new Set(result.rows.filter((row) => row.status === "Completed").map((row) => row.task_key));
  const missing = required.filter((key) => !completed.has(key));
  if (missing.length) {
    const labels = new Map(result.rows.map((row) => [row.task_key, row.task_label]));
    throw httpError(409, `Complete these prerequisite tasks first: ${missing.map((key) => labels.get(key) || key).join(", ")}.`);
  }
}

async function assignedAssets(queryable, employee) {
  const employeeNumber = String(employee.employee_number || "").trim();
  return queryable.query(
    `SELECT asset_id,asset_name,asset_tag,status,branch_id FROM hardware_assets
      WHERE assigned_to=$1 OR employee_id=$1::text OR ($2::text<>'' AND employee_id=$2::text)
      FOR UPDATE`,
    [employee.user_id, employeeNumber]
  );
}

async function disableAccess(queryable, context) {
  const result = await queryable.query(
    `UPDATE users SET is_active=FALSE,status='Inactive' WHERE user_id=$1
      RETURNING user_id`,
    [context.employee.user_id]
  );
  await queryable.query(
    "UPDATE password_resets SET used_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND used_at IS NULL",
    [context.employee.user_id]
  );
  return { action: "astreablue_account_deactivated", employeeId: context.employee.user_id, affected: result.rowCount };
}

async function recoverAssets(queryable, context) {
  const assets = await assignedAssets(queryable, context.employee);
  const assetIds = assets.rows.map((asset) => Number(asset.asset_id));
  if (assetIds.length) {
    await queryable.query(
      `UPDATE hardware_assets SET status='In Stock',assigned_to=NULL,employee_id=NULL,
         assigned_name=NULL,borrower_name=NULL,borrower_email=NULL,borrower_department=NULL,
         returned_name=$2,returned_date=CURRENT_DATE,actual_return_date=CURRENT_DATE,
         updated_at=CURRENT_TIMESTAMP WHERE asset_id=ANY($1::int[])`,
      [assetIds, context.employee.full_name]
    );
    for (const asset of assets.rows) {
      await queryable.query(
        `INSERT INTO asset_history(asset_id,event_type,event_data,branch_id,created_by)
         VALUES($1,'Employee Offboarding - Asset Recovered',$2::jsonb,$3,$4)`,
        [asset.asset_id, JSON.stringify({ lifecycleCaseId: context.lifecycleCase.lifecycle_case_id,
          caseNumber: context.lifecycleCase.case_number, previousStatus: asset.status,
          newStatus: "In Stock", employeeId: context.employee.user_id }),
        asset.branch_id, context.actor.user_id]
      );
    }
    // Monitoring identity, credentials, consent, policy, and history remain intact.
    await queryable.query(
      `UPDATE monitored_devices SET assigned_user_id=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE asset_id=ANY($1::int[]) AND assigned_user_id=$2`,
      [assetIds, context.employee.user_id]
    );
  }
  return { action: "internal_assets_recovered", affected: assetIds.length, assetIds, defaultClassification: "In Stock" };
}

async function releaseLicenses(queryable, context) {
  const released = await queryable.query(
    `UPDATE software_license_assignments SET status='Released',released_at=CURRENT_TIMESTAMP,
       released_by=$2,release_reason=$3,updated_at=CURRENT_TIMESTAMP
     WHERE user_id=$1 AND status='Active' RETURNING license_id`,
    [context.employee.user_id, context.actor.user_id, `Offboarding ${context.lifecycleCase.case_number}`]
  );
  const counts = new Map();
  for (const row of released.rows) counts.set(Number(row.license_id), (counts.get(Number(row.license_id)) || 0) + 1);
  for (const [licenseId, count] of counts) {
    await queryable.query(
      `UPDATE software_licenses SET used_licenses=GREATEST(used_licenses-$2,0),updated_at=CURRENT_TIMESTAMP
        WHERE license_id=$1`,
      [licenseId, count]
    );
  }
  return { action: "internal_license_assignments_released", affected: released.rowCount, licenseIds: [...counts.keys()] };
}

async function recordEvidence(_queryable, context) {
  return { action: "internal_evidence_recorded", notes: context.notes };
}

async function classifyAssets(queryable, context) {
  const recovery = await queryable.query(
    `SELECT automation_result FROM employee_lifecycle_tasks
      WHERE lifecycle_case_id=$1 AND task_key='recover_assets'`,
    [context.lifecycleCase.lifecycle_case_id]
  );
  const assetIds = (recovery.rows[0]?.automation_result?.assetIds || []).map(Number).filter(Boolean);
  if (!assetIds.length) return { action: "returned_assets_classified", affected: 0, assetIds: [], notes: context.notes };
  const assets = await queryable.query(
    `SELECT asset_id,status FROM hardware_assets WHERE asset_id=ANY($1::int[]) FOR UPDATE`,
    [assetIds]
  );
  const invalid = assets.rows.filter((asset) => !CLASSIFIED_ASSET_STATUSES.has(String(asset.status || "").trim().toLowerCase()));
  if (invalid.length) throw httpError(409, "Classify every recovered asset as In Stock, Available, In Repair, Retired, or Disposed in Asset Management first.");
  return { action: "returned_assets_classified", affected: assets.rowCount, assets: assets.rows, notes: context.notes };
}

async function verifyChecklist(queryable, context) {
  return { action: "internal_offboarding_verified", requiredPending: 0 };
}

async function notifyParties(queryable, context) {
  const recipients = await queryable.query(
    `SELECT DISTINCT u.user_id FROM users u JOIN system_roles r ON r.role_id=u.role_id
      WHERE u.user_id=ANY($1::int[])
         OR (LOWER(r.role_name)='hr' AND u.branch_id=$2 AND u.is_active=TRUE)`,
    [[context.employee.user_id, context.lifecycleCase.created_by], context.lifecycleCase.branch_id]
  );
  for (const recipient of recipients.rows) {
    await createNotification({
      userId: recipient.user_id,
      title: "AstreaBlue offboarding verified",
      message: `${context.lifecycleCase.case_number} for ${context.employee.full_name} has completed internal verification.`,
      type: "success",
      relatedEntityType: "employee_lifecycle_case",
      relatedEntityId: context.lifecycleCase.lifecycle_case_id,
      dedupeKey: `offboarding-complete:${context.lifecycleCase.lifecycle_case_id}:${recipient.user_id}`,
      queryable,
    });
  }
  return { action: "internal_notifications_created", affected: recipients.rowCount,
    recipientUserIds: recipients.rows.map((row) => row.user_id) };
}

async function closeTicket(queryable, context) {
  if (!context.lifecycleCase.related_ticket_id) throw httpError(409, "Link an AstreaBlue Service Desk ticket before completing this task.");
  const current = await queryable.query(`SELECT * FROM tickets WHERE id=$1 FOR UPDATE`, [context.lifecycleCase.related_ticket_id]);
  const ticket = current.rows[0];
  if (!ticket) throw httpError(409, "The linked AstreaBlue ticket no longer exists.");
  if (ticket.status !== "Closed") {
    const now = new Date();
    const responseAt = ticket.first_response_at || now;
    const resolutionAt = ticket.resolved_at || now;
    const responseStatus = ticket.response_sla_status && ticket.response_sla_status !== "Pending"
      ? ticket.response_sla_status : (ticket.response_due_at && responseAt <= ticket.response_due_at ? "Met" : "Breached");
    const resolutionStatus = ticket.resolution_sla_status && ticket.resolution_sla_status !== "Pending"
      ? ticket.resolution_sla_status : (ticket.resolution_due_at && resolutionAt <= ticket.resolution_due_at ? "Met" : "Breached");
    await queryable.query(
      `UPDATE tickets SET status='Closed',first_response_at=COALESCE(first_response_at,$2),
         resolved_at=COALESCE(resolved_at,$2),closed_at=COALESCE(closed_at,$2),
         response_sla_status=$3,resolution_sla_status=$4,
         resolution_notes=COALESCE(NULLIF(resolution_notes,''),$5),updated_at=CURRENT_TIMESTAMP
       WHERE id=$1`,
      [ticket.id, now, responseStatus, resolutionStatus, `Closed by internal offboarding ${context.lifecycleCase.case_number}.`]
    );
    await queryable.query(
      `INSERT INTO ticket_history(ticket_id,changed_by,action,old_value,new_value)
       VALUES($1,$2,'Closed by Employee Offboarding',$3,'Closed')`,
      [ticket.id, context.actor.user_id, ticket.status]
    );
  }
  return { action: "linked_astreablue_ticket_closed", ticketId: ticket.id,
    ticketNumber: ticket.ticket_number, previousStatus: ticket.status };
}

const ACTIONS = Object.freeze({
  disable_access: disableAccess,
  recover_assets: recoverAssets,
  audit_licenses: releaseLicenses,
  secure_data: recordEvidence,
  classify_assets: classifyAssets,
  verify_checklist: verifyChecklist,
  notify_parties: notifyParties,
  close_linked_ticket: closeTicket,
});

async function executeInternalOffboardingTask({ queryable, lifecycleCase, task, employee, actor, notes = "" }) {
  if (lifecycleCase.lifecycle_type !== "Offboarding") return { action: "manual_checklist_completion" };
  if (NOTE_REQUIRED_TASKS.has(task.task_key) && String(notes).trim().length < 5) {
    throw httpError(400, "Completion evidence must contain at least 5 non-whitespace characters.");
  }
  await assertPrerequisites(queryable, lifecycleCase.lifecycle_case_id, task.task_key);
  const action = ACTIONS[task.task_key];
  return action ? action(queryable, { lifecycleCase, task, employee, actor, notes: String(notes).trim() })
    : { action: "manual_checklist_completion" };
}

module.exports = { TASK_PREREQUISITES, NOTE_REQUIRED_TASKS, executeInternalOffboardingTask };
