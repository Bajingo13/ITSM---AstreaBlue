const CASE_STATUSES = Object.freeze([
  "Draft",
  "In Progress",
  "Awaiting Employee",
  "Awaiting IT",
  "Ready for Verification",
  "Completed",
  "Cancelled",
]);

const TERMINAL_STATUSES = new Set(["Completed", "Cancelled"]);

const VALID_TRANSITIONS = Object.freeze({
  Draft: ["In Progress", "Cancelled"],
  "In Progress": ["Awaiting Employee", "Awaiting IT", "Ready for Verification", "Cancelled"],
  "Awaiting Employee": ["In Progress", "Awaiting IT", "Ready for Verification", "Cancelled"],
  "Awaiting IT": ["In Progress", "Awaiting Employee", "Ready for Verification", "Cancelled"],
  "Ready for Verification": ["In Progress", "Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
});

const ONBOARDING_TASKS = Object.freeze([
  ["confirm_employment", "Confirm employment details", "Verify employee identity, role, branch, department, and start date.", "HR"],
  ["create_account", "Create or activate ITSM account", "Issue the employee invitation and confirm account activation.", "IT"],
  ["complete_profile", "Complete employee profile", "Employee reviews their branch, role, and profile details.", "Employee"],
  ["privacy_notice", "Review privacy notice", "Employee acknowledges the RA 10173 privacy notice.", "Employee"],
  ["general_consent", "Sign general monitoring consent", "Obtain one employee consent record used for assigned managed devices.", "Employee"],
  ["approve_consent", "Review and approve consent", "Authorized IT administrator validates the signed consent.", "IT"],
  ["assign_asset", "Assign managed asset", "Link the employee to the intended hardware asset without changing device identity.", "IT"],
  ["verify_endpoint", "Verify endpoint diagnostics", "Confirm heartbeat, inventory, policy synchronization, and required monitoring health.", "IT"],
  ["final_verification", "Complete HR and IT verification", "Confirm all required onboarding tasks are complete before closure.", "HR"],
]);

const OFFBOARDING_TASKS = Object.freeze([
  ["disable_access", "Disable AstreaBlue access", "Deactivate the employee's AstreaBlue account. This does not call external systems.", "IT"],
  ["recover_assets", "Recover assigned assets", "Unassign returned AstreaBlue assets and place them in stock without deleting endpoint identity.", "IT"],
  ["audit_licenses", "Release software licenses", "Release software-license assignments recorded inside AstreaBlue.", "IT"],
  ["secure_data", "Record internal data handover", "Record the completed company-data handover as internal audit evidence; no external storage is accessed.", "IT"],
  ["classify_assets", "Classify returned assets", "Mark each returned asset for redeployment, repair, or disposal after inspection.", "IT"],
  ["verify_checklist", "Verify required offboarding tasks", "HR verifies that all required internal IT actions and evidence are complete.", "HR"],
  ["notify_parties", "Create internal completion notifications", "Notify the employee record, branch HR, and case creator inside AstreaBlue only.", "HR"],
  ["close_linked_ticket", "Close the linked AstreaBlue ticket", "Close the associated AstreaBlue Service Desk ticket after verification.", "IT"],
]);

function normalizeLifecycleType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "onboarding") return "Onboarding";
  if (normalized === "offboarding") return "Offboarding";
  return null;
}

function getDefaultTasks(type) {
  const normalized = normalizeLifecycleType(type);
  const source = normalized === "Onboarding" ? ONBOARDING_TASKS : normalized === "Offboarding" ? OFFBOARDING_TASKS : [];
  return source.map(([taskKey, label, description, assignedRole], index) => ({
    taskKey,
    label,
    description,
    assignedRole,
    required: true,
    sortOrder: (index + 1) * 10,
  }));
}

function canTransition(currentStatus, nextStatus) {
  return Boolean(VALID_TRANSITIONS[currentStatus]?.includes(nextStatus));
}

function canCompleteCase({ requiredPending = 0 }) {
  return Number(requiredPending) === 0;
}

function normalizeActorRole(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]/g, "");
}

function canUpdateLifecycleTask(actorRole, assignedRole) {
  const actor = normalizeActorRole(actorRole);
  const owner = normalizeActorRole(assignedRole);
  if (actor === "superadmin" || actor === "admin") return true;
  return actor === "hr" && owner === "hr";
}

function lifecycleTaskOwnerLabel(assignedRole) {
  return normalizeActorRole(assignedRole) === "it" ? "IT Administrator" : String(assignedRole || "authorized staff");
}

module.exports = {
  CASE_STATUSES,
  TERMINAL_STATUSES,
  VALID_TRANSITIONS,
  normalizeLifecycleType,
  getDefaultTasks,
  canTransition,
  canCompleteCase,
  canUpdateLifecycleTask,
  lifecycleTaskOwnerLabel,
};
