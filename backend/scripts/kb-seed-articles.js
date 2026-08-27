"use strict";

// Starter Knowledge Base pack for the Odysseus assistant.
//
// These articles are AstreaBlue-ITSM-specific (derived from the product's actual
// behaviour) rather than generic IT troubleshooting, so they are accurate without
// knowing a customer's mail/VPN/AD environment. Retrieval is full-text ranked with
// title weighted highest, then category+tags, then symptoms+resolution — so the
// searchable keywords live in `title` and `tags`, `symptoms` holds the phrasings a
// user would type, and `resolution` holds the steps.
//
// Every article is prefixed "[Guide]" so the set is easy to find and remove.
// Consumed by scripts/seed-kb.js.

const PREFIX = "[Guide] ";

const ARTICLES = [
  {
    title: "Employee cannot sign in after onboarding",
    category: "Onboarding",
    tags: "onboarding, login, activation, invite, employee access, cannot sign in, account inactive",
    symptoms: "A newly onboarded employee cannot log in, or is stuck on the onboarding screen and cannot reach their dashboard.",
    resolution:
      "1. Confirm the employee opened their 48-hour activation link and set a password. If it expired, open the lifecycle case and use Resend invitation.\n" +
      "2. In Administration > Users, check the account is Active (not Inactive).\n" +
      "3. Employee accounts must finish onboarding before full access: the employee reviews the privacy notice and signs the monitoring consent, then an administrator approves the consent.\n" +
      "4. Until consent is approved the employee is limited to the onboarding screens by design.",
  },
  {
    title: "Monitoring consent is stuck pending approval",
    category: "Consent",
    tags: "consent, RA 10173, privacy, approval, pending, monitoring authorization",
    symptoms: "The employee signed the consent but it still shows pending, or endpoint monitoring is not collecting data.",
    resolution:
      "1. An authorized IT administrator must open the consent record and approve it after the employee signs.\n" +
      "2. Approval generates the effective device policy; the agent then enables only the categories the employee approved.\n" +
      "3. If the employee changed their preferences, the newest approved consent becomes the baseline automatically.\n" +
      "4. Activity, screenshots, and USB/DLP monitoring never run before an approved consent exists.",
  },
  {
    title: "Endpoint shows offline in Endpoint Management",
    category: "Endpoint",
    tags: "endpoint, offline, heartbeat, agent, monitoring, device not reporting, stale",
    symptoms: "A device shows Offline or a stale last-seen time, or an endpoint is not reporting heartbeats.",
    resolution:
      "1. Online/Offline is derived from heartbeat freshness. Confirm the laptop is powered on and has internet.\n" +
      "2. On the laptop, run 'sc.exe query AstreaBlueMonitoringAgent' in an Administrator Command Prompt; the service should be RUNNING. Start it with 'sc.exe start AstreaBlueMonitoringAgent' if not.\n" +
      "3. Run '.\\native-diagnostics.ps1' from the agent folder to check configuration, identity, credential, and heartbeat.\n" +
      "4. If it stays offline, file a Service Desk ticket with the device name and the time it was last online.",
  },
  {
    title: "Agent will not install or enroll on a laptop",
    category: "Endpoint",
    tags: "agent install, enrollment, enroll, enrollment code, native-install, DPAPI, monitoring setup",
    symptoms: "native-install.ps1 fails, the enrollment code is rejected, or the service does not appear after install.",
    resolution:
      "1. Enrollment codes are one-time and expire. Generate a fresh code in Endpoint Management > Administration for the correct branch.\n" +
      "2. Run PowerShell as Administrator and pass this deployment's HTTPS backend URL to the installer.\n" +
      "3. .NET Framework must be present (it is on standard Windows 10/11).\n" +
      "4. If a previous pilot agent exists, uninstall it first; the installer preserves an existing device UUID.\n" +
      "5. After install, the service downloads its consent-aware policy and starts sending heartbeats.",
  },
  {
    title: "Screenshots or USB monitoring are not being captured",
    category: "Endpoint",
    tags: "screenshots, USB, DLP, monitoring not working, policy, consent, capture",
    symptoms: "No screenshots appear for a device, or USB file activity is not recorded, even though the agent is online.",
    resolution:
      "1. These categories only run when the employee's approved consent AND the effective endpoint policy both allow them.\n" +
      "2. Check the device is assigned to an employee and that employee has an approved consent.\n" +
      "3. A SuperAdmin screenshot pause overrides everything - check Endpoint Management for a screenshot suspension on that employee.\n" +
      "4. USB monitoring only covers drives Windows reports as Removable; external USB hard disks reported as fixed disks are excluded in the pilot.",
  },
  {
    title: "What the SLA statuses mean and why a ticket breached",
    category: "SLA",
    tags: "SLA, service level, first response, resolution target, breached, pending, met, cancelled",
    symptoms: "A ticket shows Breached, or someone asks what Pending, Met, Breached, or Cancelled means on an SLA target.",
    resolution:
      "1. Each ticket gets a first-response deadline and a resolution deadline from its priority.\n" +
      "2. Pending = the clock is running; Met = the response or resolution happened in time; Breached = the deadline passed without it; Cancelled = the ticket was cancelled so the target no longer applies.\n" +
      "3. When a ticket is cancelled, both response and resolution SLA move to Cancelled.\n" +
      "4. On breach, an email goes to the assigned technician. Reassign or escalate promptly; the breach record stays for reporting.",
  },
  {
    title: "Cannot change a ticket priority or a ticket is in the wrong branch",
    category: "Service Desk",
    tags: "ticket, priority, branch, RBAC, permission denied, cannot edit ticket, cross branch",
    symptoms: "An employee cannot change priority after filing, or a ticket appears under the wrong branch, or someone cannot see a ticket.",
    resolution:
      "1. Employees may suggest a priority when filing but cannot change it afterward; a branch administrator can correct it and the change is audited.\n" +
      "2. Tickets are branch-scoped. Employees and HR only see and file within their own branch; SuperAdmin sees all branches.\n" +
      "3. Branch is taken from the requester's account, not from a form field, so a forged branch value is ignored.\n" +
      "4. If a ticket truly needs to move branches, a SuperAdmin should handle it.",
  },
  {
    title: "Assign a laptop or return it to stock",
    category: "Assets",
    tags: "asset, laptop, assign, borrow, return, hardware, in stock, assigned to wrong person",
    symptoms: "How to give a laptop to an employee, take it back, or fix an asset that shows the wrong assignee.",
    resolution:
      "1. In Assets, open the asset and choose Mark as Borrowed, then pick the employee and set borrow and expected return dates.\n" +
      "2. To take it back, choose Mark as Returned and set the actual return date; the asset returns to stock and any device-linked license references are detached.\n" +
      "3. A wrong assignee is fixed the same way: return it, then mark it borrowed to the correct employee.\n" +
      "4. Assigning a laptop this way also completes the 'Assign managed asset' step on an onboarding case.",
  },
  {
    title: "Software license has no available seats or has expired",
    category: "Software Licenses",
    tags: "license, seat, no seats available, expired, renewal, subscription, allocation",
    symptoms: "A license cannot be assigned because no seats are available, or a license shows expired.",
    resolution:
      "1. Available seats = total seats minus used seats. Release unused assignments from Employee Technology Value, or increase total seats on the license.\n" +
      "2. Expired licenses (past the expiry date) are not offered for assignment. Renew the license - renewals keep the assignment history and update the expiry date and cost.\n" +
      "3. Expiry reminders flag upcoming renewals before they lapse.\n" +
      "4. Seats always belong to the employee; the optional device reference is only an installation note.",
  },
  {
    title: "Returned or repaired asset still shows the old status",
    category: "Assets",
    tags: "asset status, replacement, repair, in use, in repair, condition, lifecycle",
    symptoms: "After a repair or return, an asset still shows In Use or In Repair, or a replacement request is not updating the asset.",
    resolution:
      "1. Replacement requests move an asset through assessment, repair or replacement, and verification.\n" +
      "2. A repaired laptop that was assigned returns to In Use with its condition updated once the repair is verified as complete.\n" +
      "3. If the status looks wrong, open the replacement request and confirm the current step is completed and verified.\n" +
      "4. Returning the asset in Assets (Mark as Returned) is the manual way to force it back to stock.",
  },
  {
    title: "Access denied for your role, or cannot see other branches",
    category: "Administration",
    tags: "access denied, RBAC, role, permission, branch scope, forbidden, cannot see",
    symptoms: "A user gets Access denied for your role, or an admin cannot see records outside their branch.",
    resolution:
      "1. Roles and branch scope are read from the database on every request; a token cannot grant more than the current account has.\n" +
      "2. Branch admins, HR, and technicians are limited to their assigned branch. Only SuperAdmin works across all branches.\n" +
      "3. If a role is wrong, a SuperAdmin updates it in Administration > Users; the user should sign out and back in.\n" +
      "4. Setting an account to Inactive blocks it immediately even if it still holds a valid token.",
  },
  {
    title: "Password reset and locked accounts",
    category: "Administration",
    tags: "password, reset, forgot password, locked out, cannot log in, account inactive, temporary password",
    symptoms: "A user forgot their password, is locked out, or an admin needs to reset someone's password.",
    resolution:
      "1. Self-service: on the sign-in page choose Forgot password and use the emailed link (valid 30 minutes).\n" +
      "2. Administrator: Administration > Users > select the user > Reset password. The user gets a reset email; if email is down, share the link directly.\n" +
      "3. If the account is Inactive, re-activate it before resetting.\n" +
      "4. Password reset and activation emails need a working SMTP configuration on the deployment.",
  },
  {
    title: "A report or export is empty or fails",
    category: "Reporting",
    tags: "report, export, empty report, no rows, txt, excel, pdf, analytics, date range",
    symptoms: "A custom report returns no rows, an export fails, or a date filter is rejected.",
    resolution:
      "1. Check the filters: a From date later than the To date is rejected; a technician filter must be within the selected branch.\n" +
      "2. A branch admin only sees their own branch; a forged branch filter is ignored.\n" +
      "3. If no records match the filters, exports return a clear 'no records match' message instead of an empty file.\n" +
      "4. Exports (TXT, Excel, PDF) always use the same filtered dataset shown on screen.",
  },
  {
    title: "Invitation, reset, or notification emails are not arriving",
    category: "Administration",
    tags: "email, smtp, not sending, invitation email, notification, gmail, app password, delivery failed",
    symptoms: "Employees are not receiving invitation, password-reset, or lifecycle emails.",
    resolution:
      "1. The deployment needs valid SMTP settings: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM_EMAIL.\n" +
      "2. For Gmail, SMTP_PASS must be a 16-character Google App Password (not the account password) with 2-Step Verification enabled on the sender address.\n" +
      "3. The workflow still completes without email: copy the activation or reset link from the lifecycle case or the Users screen and share it directly.\n" +
      "4. A SuperAdmin can run the built-in Email Test to see the exact provider error.",
  },
  {
    title: "External ticket was rejected or Integration Hub is missing",
    category: "Integrations",
    tags: "integration hub, external ticket, api key, 403, capability disabled, centralized ticketing, external system",
    symptoms: "An external system's ticket request is rejected, or Integration Hub does not appear in the menu.",
    resolution:
      "1. Integration Hub and external ticket intake only exist on the Main deployment. On a Standard deployment they return 'This function is not available on this deployment.' - this is expected.\n" +
      "2. On Main, the external system must send a valid X-API-Key generated in Integration Hub for a registered system.\n" +
      "3. Each request is validated, logged, and stored as a centrally tracked ticket visible under normal RBAC.\n" +
      "4. Duplicate requests with the same external reference are treated as idempotent replays, not new tickets.",
  },
  {
    title: "Ask Odysseus for live counts and record summaries",
    category: "Assistant",
    tags: "odysseus, assistant, ai, how many, summary, counts, knowledge base, help",
    symptoms: "How to get useful answers from the in-app assistant, or the assistant says it cannot find an article.",
    resolution:
      "1. Ask 'how many ...' for live totals it is allowed to see: tickets, assets, endpoints, licenses, SLA, replacements, lifecycle cases, consent, configuration items.\n" +
      "2. Ask 'how do I ...' for built-in step-by-step guidance on onboarding, offboarding, tickets, assets, licenses, agent enrollment, reports, and administration.\n" +
      "3. Ask 'what does the <module> module do' for a purpose and workflow summary.\n" +
      "4. For anything else it searches the Knowledge Base you are allowed to read - if it finds nothing, add an article for that issue so the next person gets an answer.",
  },
];

module.exports = {
  PREFIX,
  ARTICLES: ARTICLES.map((a) => ({ ...a, title: PREFIX + a.title })),
};
