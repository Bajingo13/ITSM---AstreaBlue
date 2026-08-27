"use strict";

// Curated, read-only "how do I …" guidance for the core AstreaBlue workflows.
// This runs before Knowledge Base retrieval, so common task questions are
// answered accurately even when no OpenAI key is configured and the Knowledge
// Base is empty. Keep every step consistent with the actual product behaviour.

const TASK_GUIDES = [
  {
    key: "onboard_employee",
    keywords: [
      "onboard", "onboarding", "new employee", "new hire", "add an employee",
      "create an employee", "employee account", "hire someone", "add a staff",
    ],
    title: "Onboard a new employee",
    roles: ["superadmin", "admin", "hr"],
    steps: [
      "Open Employee Lifecycle and create an Onboarding case (choose the branch and enter the new hire's name, personal email, and department). This also creates a linked internal ticket and a checklist.",
      "On the case, choose \"Create account invitation\" and enter the company/login email. The employee receives a 48-hour activation link; an administrator can also copy the link from the case.",
      "The employee opens the link, sets a password, signs in, and reviews the RA 10173 privacy notice and monitoring consent.",
      "An authorized administrator reviews and approves the signed consent.",
      "Assign the managed laptop in Assets (open the asset, \"Mark as Borrowed\", pick the employee). The \"Assign managed asset\" checklist item then completes automatically.",
      "In Employee Technology Value, assign the required software-license seats to the employee.",
      "Install and enroll the monitoring agent on the laptop, then confirm the endpoint reports a heartbeat, inventory, and policy download.",
      "When every required checklist item has evidence, complete the final HR and IT verification to close the case.",
    ],
    note: "Employee accounts can only be created through this onboarding flow — not from Administration → Users.",
  },
  {
    key: "offboard_employee",
    keywords: [
      "offboard", "offboarding", "terminate", "termination", "departing employee",
      "employee leaving", "deactivate an employee", "disable an employee",
      "remove an employee", "employee exit", "resignation",
    ],
    title: "Offboard a departing employee",
    roles: ["superadmin", "admin", "hr"],
    steps: [
      "Open Employee Lifecycle and create an Offboarding case for the existing employee. A linked internal ticket and an offboarding checklist are created.",
      "Complete \"Disable AstreaBlue access\" — this deactivates the account and immediately stops endpoint monitoring.",
      "Complete \"Recover assigned assets\" — assigned assets are unassigned and returned to stock without deleting endpoint identity.",
      "Complete \"Release software licenses\" — all of the employee's active license seats are released.",
      "Record the internal data handover, classify each returned asset (redeploy, repair, or dispose), then have HR verify the checklist.",
      "Create the internal completion notifications and close the linked Service Desk ticket to finish the case.",
    ],
    note: "Completing an offboarding checklist item runs its internal action immediately and cannot be reopened.",
  },
  {
    key: "reset_password",
    keywords: [
      "reset a password", "reset password", "reset my password", "reset a user password",
      "reset user password", "reset the password", "reset an account", "forgot password",
      "forgot my password", "change password", "change a password", "password reset",
      "new password", "locked out", "cannot log in", "can't log in", "cannot sign in",
      "can't sign in",
    ],
    title: "Reset a password",
    steps: [
      "Self-service: on the sign-in page choose \"Forgot password\", enter your email, and follow the emailed link (valid for 30 minutes) to set a new password.",
      "Administrator: open Administration → Users, find the account, and use \"Reset password\". The user receives a reset email; if email delivery is unavailable, share the reset link directly.",
      "If the account shows as Inactive, re-activate it in Administration → Users before resetting the password.",
    ],
    note: "Password reset emails require a working SMTP configuration on the deployment.",
  },
  {
    key: "create_ticket",
    keywords: [
      "create a ticket", "file a ticket", "raise a ticket", "log a ticket",
      "open a ticket", "submit a ticket", "new ticket", "report an issue",
      "service request",
    ],
    title: "Create and assign a ticket",
    steps: [
      "Open Service Desk and choose New Ticket. Enter the title, description, category, and priority. Employees and HR can only file within their own branch; SuperAdmin can file for any branch.",
      "Save the ticket. The requester receives a confirmation email and SLA response and resolution targets are calculated from the priority.",
      "To assign it, open the ticket and choose Assign, then select a technician in the same branch. Branch admins can correct the priority; the change is audited.",
      "Record work, add comments, then move the ticket through In Progress to Resolved or Closed. Use Cancel (with a reason) instead of deleting.",
    ],
  },
  {
    key: "assign_asset",
    keywords: [
      "assign an asset", "assign a laptop", "assign hardware", "give a laptop",
      "hand out a laptop", "issue a device", "assign a device", "borrow an asset",
      "return an asset", "unassign an asset",
    ],
    title: "Assign or return a hardware asset",
    roles: ["superadmin", "admin"],
    steps: [
      "Open Assets and locate the asset (register it first with tag, type, manufacturer, model, serial number, and branch if it is new).",
      "Open the asset and choose \"Mark as Borrowed\", then select the employee and set the borrow and expected return dates. This records the assignment.",
      "To return it, open the asset and choose \"Mark as Returned\" and set the actual return date — the asset goes back to stock and any device-linked license references are detached.",
    ],
    note: "Assigning an asset this way also satisfies the \"Assign managed asset\" step on an onboarding case.",
  },
  {
    key: "software_license",
    keywords: [
      "add a license", "add a software license", "create a license", "assign a license",
      "assign a seat", "software seat", "license seat", "release a license",
      "revoke a license", "license expiry", "renew a license",
    ],
    title: "Manage software licenses and seats",
    roles: ["superadmin", "admin"],
    steps: [
      "Register the subscription in Software Licenses: name, vendor, type, total seats, used seats, annual cost, optional expiry date, and branch.",
      "Assign seats from Employee Technology Value (or from an onboarding case): pick the employee, optionally choose a device reference, and select the seats. Available seats are total minus used.",
      "Release a seat from Employee Technology Value → Release; released assignments are kept in history.",
      "Renewals preserve assignment history and update the expiry date and cost. Expiry reminders flag upcoming renewals.",
    ],
  },
  {
    key: "enroll_agent",
    keywords: [
      "enroll an agent", "enroll a laptop", "install the agent", "monitoring agent",
      "windows agent", "enrollment code", "register a device", "set up monitoring",
      "add a device to monitoring",
    ],
    title: "Install and enroll a monitoring agent",
    roles: ["superadmin", "admin"],
    steps: [
      "In Endpoint Management → Administration, generate a one-time enrollment code for the target branch.",
      "Copy the agent package to the Windows laptop and extract it. Open PowerShell as Administrator.",
      "Run the installer (native-install.ps1), supplying this deployment's HTTPS backend URL and the enrollment code. The installer stores a unique credential protected by Windows DPAPI and installs the automatic service.",
      "The service downloads its consent-aware policy and begins sending heartbeats. Confirm the device shows Online in Endpoint Management, then run .\\native-diagnostics.ps1 on the laptop if it does not.",
    ],
    note: "Monitoring categories (activity, screenshots, USB/DLP) only activate after the employee's consent is approved.",
  },
  {
    key: "integration_hub",
    keywords: [
      "integration hub", "register an integration", "external ticket api",
      "external system", "api key for tickets", "connect an external system",
      "centralized ticketing",
    ],
    title: "Register an external ticket integration",
    roles: ["superadmin"],
    steps: [
      "Open Integration Hub and register the external system, then generate a scoped API key for it.",
      "Configure the external system to POST ticket requests to /api/v1/external/tickets with the X-API-Key header.",
      "AstreaBlue validates, logs, labels, and stores each request as a centrally tracked ticket visible under normal RBAC.",
    ],
    note: "Integration Hub and external ticket intake are only available on the Main (MAIN_HUB) deployment. Standard deployments return a capability-disabled error.",
  },
  {
    key: "reports",
    keywords: [
      "run a report", "generate a report", "export a report", "custom report",
      "download a report", "analytics export", "executive dashboard", "reporting",
    ],
    title: "Run or export a report",
    steps: [
      "Open Analytics / Reports and choose the report type (service desk, SLA, assets, endpoints, governance, projects, or a custom report).",
      "Apply the period, branch, and any report-specific filters. Branch admins are limited to their own branch; a technician can only be filtered within their branch.",
      "View the results or export to TXT, Excel, or PDF. Exports use the same filtered dataset shown on screen.",
    ],
  },
  {
    key: "administration",
    keywords: [
      "create a branch", "add a branch", "create a user", "add a user",
      "invite an admin", "invite a technician", "manage roles", "assign a role",
      "deactivate a user", "user management", "branch management",
    ],
    title: "Manage branches, users, and roles",
    roles: ["superadmin", "admin"],
    steps: [
      "SuperAdmin manages branches in Administration → Branches (name, location, optional headquarters flag) and can assign a branch administrator.",
      "Create or invite non-employee accounts (Admin, HR, Technician, SuperAdmin) in Administration → Users. SuperAdmin can invite any of these; a branch Admin can invite Technicians in their branch.",
      "Set status to Inactive to disable an account immediately — the database state overrides any still-valid token.",
      "Employee accounts are never created here; use Employee Lifecycle onboarding.",
    ],
  },
  {
    key: "replacement",
    keywords: [
      "damaged laptop", "broken laptop", "damaged equipment", "broken device",
      "replacement request", "repair request", "replace a laptop", "send for repair",
    ],
    title: "Request a repair or replacement",
    steps: [
      "The employee (or an administrator on their behalf) submits a Replacement Request describing the damage and urgency, referencing the current assigned asset.",
      "An authorized reviewer assesses the request and records a diagnosis and recommendation.",
      "The asset moves to In Repair or is replaced; on completion the outcome is verified.",
      "The asset returns to its correct lifecycle status — an assigned laptop that was repaired returns to In Use with its condition updated.",
    ],
  },
];

const ACTION_HINT = /\b(how (do|can|to)|steps|guide|process|walk me through|instructions|procedure|set up|setup|create|add|assign|register|enroll|reset|release|onboard|offboard|file|raise|submit|generate|export|deactivate|manage)\b/i;

function normalize(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Returns the best-matching task guide for a "how do I …" style question, or null.
function findTaskGuide(message) {
  const text = normalize(message);
  if (!text) return null;
  if (!ACTION_HINT.test(text)) return null;

  let best = null;
  let bestScore = 0;
  for (const guide of TASK_GUIDES) {
    let score = 0;
    for (const keyword of guide.keywords) {
      if (text.includes(keyword)) score += keyword.includes(" ") ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = guide;
    }
  }
  return bestScore > 0 ? best : null;
}

function formatTaskGuide(guide, actor) {
  const lines = [guide.title];
  guide.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  if (guide.note) lines.push(`Note: ${guide.note}`);
  const actorRole = String(actor?.role_name || actor?.role || "").toLowerCase().replace(/[\s_-]/g, "");
  if (Array.isArray(guide.roles) && actorRole && !guide.roles.includes(actorRole)) {
    lines.push(`Access: this task is usually performed by ${guide.roles.join(", ")}. Ask an authorized colleague if you cannot see these options.`);
  }
  return lines.join("\n");
}

module.exports = { TASK_GUIDES, findTaskGuide, formatTaskGuide };
