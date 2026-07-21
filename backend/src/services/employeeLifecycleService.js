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
  ["disable_access", "Disable system access", "Revoke access to approved company systems and remote services.", "IT"],
  ["recover_assets", "Recover physical assets", "Collect and record all assigned company equipment.", "IT"],
  ["audit_licenses", "Audit software licenses", "Revoke, transfer, or return assigned licenses to the available pool.", "IT"],
  ["secure_data", "Secure and transfer company data", "Back up required business data and transfer ownership to the designated custodian.", "IT"],
  ["classify_assets", "Classify returned assets", "Mark each returned asset for redeployment, repair, or disposal after inspection.", "IT"],
  ["verify_checklist", "Verify required offboarding tasks", "HR and IT verify that no required task remains pending.", "HR"],
  ["notify_parties", "Notify employee and HR", "Record formal completion notification after verification.", "HR"],
  ["close_linked_ticket", "Close the linked Service Desk ticket", "Close the associated ticket only after lifecycle verification.", "IT"],
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

module.exports = {
  CASE_STATUSES,
  TERMINAL_STATUSES,
  VALID_TRANSITIONS,
  normalizeLifecycleType,
  getDefaultTasks,
  canTransition,
  canCompleteCase,
};

