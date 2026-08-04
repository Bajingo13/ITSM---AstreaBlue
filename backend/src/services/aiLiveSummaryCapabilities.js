function normalize(value) {
  return String(value || "").toLowerCase();
}

function asksForLiveSummary(message) {
  return /\b(how many|count|total|summary|breakdown|currently|right now|latest|last|recent|today|status|where|locations?|located|addresses?|enabled|disabled|pending|approved|value|cost|depreciat(?:ion|ed|ing)?|warrant(?:y|ies)|end of life|healthy|warning|critical|offline|attention|breached|compliance|due soon|response time|resolution time|submitted|assessment|issued|repaired|completed|cancelled|waiting|final review|risks?|relationships?|dependencies|connected|isolated|milestones?|budget|utilization|overdue|progress|analytics|reports?|sending|reporting|captured|activity)\b/.test(
    normalize(message)
  );
}

function formatTimestamp(value) {
  if (!value) return "No activity recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown time";
  return parsed.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function readableUsbEvent(eventType) {
  return {
    device_connected: "USB device connected",
    device_disconnected: "USB device disconnected",
    file_written: "File written to USB",
  }[eventType] || "USB activity";
}

function screenshotMetric(message) {
  const text = normalize(message);
  if (/\b(last|latest|most recent)\b/.test(text)) return "latest";
  if (/\b(today|today's)\b/.test(text) && /\bscreenshots?\b/.test(text)) {
    return "screenshots_today";
  }
  if (/\b(storage|space|size)\b/.test(text)) return "storage";
  if (/\b(devices?|laptops?|endpoints?).*(sending|reporting|captur)/.test(text)
    || /\b(sending|reporting).*\bscreenshots?\b/.test(text)) {
    return "devices_reporting_recently";
  }
  return null;
}

function usbDlpMetric(message) {
  const text = normalize(message);
  if (/\b(last|latest|most recent)\b/.test(text)) return "latest";
  if (/\bhigh risk\b|\bcritical\b/.test(text)) return "high_risk_today";
  if (/\bincidents?\b/.test(text)) return "incidents_today";
  if (/\btransfers?\b|\bfiles? written\b/.test(text)) return "transfers_today";
  if (/\bdevices?\b/.test(text)) return "devices_today";
  if (/\btoday\b/.test(text)) return "events_today";
  return null;
}

function assetFinanceMetric(message) {
  const text = normalize(message);
  if (/\b(current )?book value\b|\bcurrent value\b/.test(text)) {
    return ["current_book_value", "currency", "current book value"];
  }
  if (/\baccumulated depreciation\b/.test(text)) {
    return ["accumulated_depreciation", "currency", "accumulated depreciation"];
  }
  if (/\bmonthly depreciation\b/.test(text)) {
    return ["monthly_depreciation_expense", "currency", "monthly depreciation expense"];
  }
  if (/\b(purchase|acquisition|original)\s+(cost|value)\b|\btotal asset value\b/.test(text)) {
    return ["total_asset_value", "currency", "capitalized purchase value"];
  }
  if (/\bfully depreciated\b/.test(text)) {
    return ["fully_depreciated_assets", "count", "fully depreciated asset"];
  }
  if (/\bnear(?:ing)? end of life\b|\bnear eol\b/.test(text)) {
    return ["assets_near_end_of_life", "count", "asset near or at end of life"];
  }
  if (/\bend of life\b|\beol\b/.test(text)) {
    return ["end_of_life_assets", "count", "end-of-life asset"];
  }
  if (/\bexpired warrant(?:y|ies)\b|\bwarrant(?:y|ies).*(?:expired|overdue)\b/.test(text)) {
    return ["warranties_expired", "count", "asset with an expired warranty"];
  }
  if (/\bwarrant(?:y|ies).*(?:expir|soon|next 30 days)\b|\bexpiring warrant(?:y|ies)\b/.test(text)) {
    return ["warranties_expiring_30_days", "count", "asset with a warranty expiring in the next 30 days"];
  }
  if (/\bmissing\b.*\b(financial|purchase|finance)\b|\bincomplete financial\b/.test(text)) {
    return ["missing_financial_information", "count", "asset with missing financial information"];
  }
  if (/\bexpense items?\b/.test(text)) {
    return ["expense_items", "count", "expense item"];
  }
  if (/\bdepreciable assets?\b/.test(text)) {
    return ["depreciable_assets", "count", "depreciable asset"];
  }
  if (/\bhow many\b|\bcount\b|\bnumber of\b/.test(text)) {
    return ["total_assets", "count", "asset financial record"];
  }
  return null;
}

function assetFinanceFilters(message) {
  const text = normalize(message);
  let assetType = null;
  if (/\blaptops?\b/.test(text)) assetType = "Laptop";
  else if (/\bdesktops?\b/.test(text)) assetType = "Desktop";
  else if (/\bcomputers?\b/.test(text)) assetType = "Computer";

  const statuses = [
    ["In Repair", /\b(?:in|under) repair\b/],
    ["In Use", /\bin use\b/],
    ["Available", /\bavailable\b/],
    ["Borrowed", /\bborrowed\b/],
    ["Retired", /\bretired\b/],
    ["Disposed", /\bdisposed\b/],
  ];
  const status = statuses.find(([, pattern]) => pattern.test(text))?.[0] || null;
  return { assetType, status };
}

function formatCurrency(value) {
  return `PHP ${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function financeScopeLabel(data) {
  const parts = [];
  if (data.filters?.asset_type) parts.push(data.filters.asset_type);
  if (data.filters?.status) parts.push(data.filters.status);
  return parts.length ? ` for ${parts.join(", ")}` : "";
}

function assetDiscoveryMetric(message) {
  const text = normalize(message);
  if (/\bmismatched?\b/.test(text)) return ["mismatched", "mismatched"];
  if (/\bpending verification\b/.test(text)) return ["pending_verification", "pending verification"];
  if (/\bunmanaged\b/.test(text)) return ["unmanaged", "unmanaged"];
  if (/\bduplicates?\b/.test(text)) return ["duplicates", "duplicate"];
  if (/\boffline\b/.test(text)) return ["offline", "offline"];
  if (/\bunlinked\b/.test(text)) return ["unlinked", "unlinked"];
  if (/\blinked\b/.test(text)) return ["linked", "linked"];
  if (/\bmatched?\b/.test(text)) return ["matched", "matched"];
  return null;
}

function consentMetric(message) {
  const text = normalize(message);
  if (/\bawaiting (?:the )?employee\b|\bpending employee\b|\bunsigned\b/.test(text)) {
    return ["awaiting_employee", "awaiting employee action"];
  }
  if (/\bawaiting approval\b|\bpending approval\b|\bsubmitted\b/.test(text)) {
    return ["awaiting_approval", "awaiting approval"];
  }
  if (/\brevision(?:s)? requested\b/.test(text)) {
    return ["revision_requested", "with a requested revision"];
  }
  if (/\brejected\b/.test(text)) return ["rejected", "rejected"];
  if (/\bwithdrawn\b/.test(text)) return ["withdrawn", "withdrawn"];
  if (/\bexpired\b/.test(text)) return ["expired", "expired"];
  if (/\bsuperseded\b/.test(text)) return ["superseded", "superseded"];
  if (/\bdevice[- ]specific\b/.test(text)) return ["device_specific", "device-specific"];
  if (/\bgeneral consent\b|\bgeneral privacy\b/.test(text)) return ["general", "general"];
  if (/\bapproved\b/.test(text)) return ["approved", "active and approved"];
  return null;
}

function endpointPolicyMetric(message) {
  const text = normalize(message);
  if (/\bwithout (?:an? )?(?:active )?approved consent\b|\bno approved consent\b/.test(text)) {
    return ["devices_without_approved_consent", "assigned device without active approved consent"];
  }
  if (/\bapproved consent\b/.test(text)) {
    return ["consent_approved_devices", "device covered by active approved consent"];
  }
  if (/\bpending (?:policy )?(?:download|sync)\b|\bnot (?:downloaded|synced)\b/.test(text)) {
    return ["policies_pending_download", "effective policy pending agent download"];
  }
  if (/\bdownloaded\b|\bsynced\b/.test(text)) {
    return ["policies_downloaded", "effective policy downloaded by the agent"];
  }
  if (/\bactivit(?:y|ies)\b/.test(text)) {
    return ["activity_enabled", "effective policy with activity monitoring enabled"];
  }
  if (/\bscreenshots?\b/.test(text)) {
    return ["screenshot_enabled", "effective policy with screenshot monitoring enabled"];
  }
  if (/\busb\b|\bdlp\b/.test(text)) {
    return ["usb_enabled", "effective policy with USB monitoring enabled"];
  }
  if (/\bbrowser\b|\bweb monitoring\b/.test(text)) {
    return ["browser_enabled", "effective policy with browser monitoring enabled"];
  }
  if (/\blocation\b/.test(text)) {
    return ["location_enabled", "effective policy with location tracking enabled"];
  }
  if (/\bnot generated\b|\bmissing effective polic(?:y|ies)\b/.test(text)) {
    return ["policies_not_generated", "device without a generated effective policy"];
  }
  if (/\bgenerated\b|\beffective polic(?:y|ies)\b/.test(text)) {
    return ["generated_policies", "device with a generated effective policy"];
  }
  return null;
}

function endpointHealthMetric(message) {
  const text = normalize(message);
  if (/\brequir(?:e|es|ing) attention\b|\bneeds? attention\b/.test(text)) {
    return ["requiring_attention", "endpoint requiring attention"];
  }
  if (/\bmonitoring active\b|\bactive monitoring\b/.test(text)) {
    return ["monitoring_active", "endpoint with active monitoring"];
  }
  if (/\bhardware inventory\b/.test(text)) {
    return ["hardware_inventory_healthy", "endpoint with healthy hardware inventory"];
  }
  if (/\bsoftware inventory\b/.test(text)) {
    return ["software_inventory_healthy", "endpoint with healthy software inventory"];
  }
  if (/\bpolicy sync\b/.test(text)) {
    return ["policy_sync_healthy", "endpoint with healthy policy synchronization"];
  }
  if (/\bactive consent\b|\bconsent health\b/.test(text)) {
    return ["consent_active", "endpoint with active consent"];
  }
  if (/\bactivity\b/.test(text)) {
    return ["activity_healthy", "endpoint with healthy activity telemetry"];
  }
  if (/\bheartbeat\b/.test(text)) {
    return ["heartbeat_healthy", "endpoint with a healthy heartbeat"];
  }
  if (/\boffline\b/.test(text)) return ["offline", "offline endpoint"];
  if (/\bcritical\b/.test(text)) return ["critical", "critical endpoint"];
  if (/\bwarning\b/.test(text)) return ["warning", "endpoint in warning state"];
  if (/\bhealthy\b/.test(text)) return ["healthy", "healthy endpoint"];
  return null;
}

function slaMetric(message) {
  const text = normalize(message);
  if (/\bcompliance\b/.test(text)) return ["compliance_percent", "percent", "SLA compliance"];
  if (/\baverage\b.*\bfirst response\b|\bavg\b.*\bresponse\b|\bresponse time\b/.test(text)) {
    return ["avg_response_time_minutes", "duration", "average first-response time"];
  }
  if (/\baverage\b.*\bresolution\b|\bavg\b.*\bresolution\b|\bresolution time\b/.test(text)) {
    return ["avg_resolution_time_minutes", "duration", "average resolution time"];
  }
  if (/\bdue soon\b|\bnear(?:ing)? (?:the )?(?:sla )?deadline\b/.test(text)) {
    return ["due_soon", "count", "SLA ticket due within four hours"];
  }
  if (/\bbreach(?:ed|es)?\b/.test(text)) return ["breached", "count", "SLA-breached ticket"];
  if (/\bmet\b|\bcompliant\b/.test(text)) return ["met", "count", "ticket that met its applicable SLA target"];
  if (/\bpending\b/.test(text)) return ["pending", "count", "ticket with a pending SLA result"];
  if (/\bactive\b/.test(text)) return ["active", "count", "active SLA-tracked ticket"];
  return null;
}

function replacementMetric(message) {
  const text = normalize(message);
  const metrics = [
    ["repair_recommended", "repair-recommended request", /\brepair recommended\b/],
    ["under_assessment", "request under assessment", /\bunder assessment\b|\bassessing\b/],
    ["awaiting_approval", "request awaiting approval", /\bawaiting approval\b|\bpending approval\b/],
    ["reserved", "request with a reserved replacement", /\breplacement reserved\b|\breserved\b/],
    ["in_repair", "request currently in repair", /\bin repair\b/],
    ["submitted", "submitted request", /\bsubmitted\b/],
    ["approved", "approved request", /\bapproved\b/],
    ["issued", "issued replacement request", /\bissued\b/],
    ["repaired", "repaired request", /\brepaired\b/],
    ["completed", "completed replacement request", /\bcompleted\b/],
    ["rejected", "rejected replacement request", /\brejected\b/],
    ["cancelled", "cancelled replacement request", /\bcancel(?:led|ed)\b/],
    ["active", "active replacement request", /\bactive\b/],
  ];
  const match = metrics.find(([, , pattern]) => pattern.test(text));
  return match ? match.slice(0, 2) : null;
}

function lifecycleMetric(message) {
  const text = normalize(message);
  if (/\brequired\b.*\bpending\b|\bpending (?:required )?(?:checklist )?tasks?\b/.test(text)) {
    return ["required_pending_tasks", "required checklist task still pending"];
  }
  if (/\bcases?\b.*\bpending tasks?\b|\bincomplete checklist\b/.test(text)) {
    return ["cases_with_pending_tasks", "lifecycle case with pending required tasks"];
  }
  if (/\bactive onboarding\b/.test(text)) {
    return ["active_onboarding", "active onboarding case"];
  }
  if (/\bactive offboarding\b/.test(text)) {
    return ["active_offboarding", "active offboarding case"];
  }
  if (/\bready (?:for )?(?:final )?(?:review|verification)\b/.test(text)) {
    return ["ready_for_verification", "case ready for authorized final review"];
  }
  if (/\bawaiting employee\b|\bwaiting for employee\b/.test(text)) {
    return ["awaiting_employee", "case awaiting employee action"];
  }
  if (/\bawaiting (?:it|administrator)\b|\bwaiting for (?:it|administrator)\b/.test(text)) {
    return ["awaiting_administrator", "case awaiting administrator action"];
  }
  if (/\bin progress\b/.test(text)) return ["in_progress", "lifecycle case in progress"];
  if (/\bdrafts?\b/.test(text)) return ["draft", "draft lifecycle case"];
  if (/\bcompleted\b/.test(text)) return ["completed", "completed lifecycle case"];
  if (/\bcancel(?:led|ed)\b/.test(text)) return ["cancelled", "cancelled lifecycle case"];
  if (/\bonboarding\b/.test(text) && !/\boffboarding\b/.test(text)) {
    return ["onboarding_total", "onboarding case"];
  }
  if (/\boffboarding\b/.test(text) && !/\bonboarding\b/.test(text)) {
    return ["offboarding_total", "offboarding case"];
  }
  return null;
}

function cmdbMetric(message) {
  const text = normalize(message);
  if (/\bcritical\b.*\bimpact\b|\bcritical risk\b/.test(text)) {
    return ["impact_critical", "configuration item with critical change impact"];
  }
  if (/\bhigh\b.*\bimpact\b|\bhigh risk\b/.test(text)) {
    return ["impact_high", "configuration item with high change impact"];
  }
  if (/\bmedium\b.*\bimpact\b|\bmedium risk\b/.test(text)) {
    return ["impact_medium", "configuration item with medium change impact"];
  }
  if (/\blow\b.*\bimpact\b|\blow risk\b/.test(text)) {
    return ["impact_low", "configuration item with low change impact"];
  }
  if (/\bisolated\b|\bwithout (?:a )?(?:dependency|relationship)\b/.test(text)) {
    return ["isolated", "isolated configuration item"];
  }
  if (/\bconnected\b/.test(text)) return ["connected", "connected configuration item"];
  if (/\brelationships?\b|\bdependencies\b|\bdependency links?\b/.test(text)) {
    return ["relationships", "CMDB relationship"];
  }
  if (/\bproduction\b/.test(text)) return ["production", "production configuration item"];
  if (/\binactive\b/.test(text)) return ["inactive", "inactive configuration item"];
  if (/\bactive\b/.test(text)) return ["active", "active configuration item"];
  if (/\btypes?\b|\bcategories\b/.test(text)) return ["types", "distinct CI type"];
  return null;
}

function projectMetric(message) {
  const text = normalize(message);
  if (/\bresource utilization\b|\butilization\b/.test(text)) {
    return ["resource_utilization_percent", "percent", "project resource utilization"];
  }
  if (/\baverage\b.*\bcompletion\b|\bcompletion percentage\b|\bprogress\b/.test(text)) {
    return ["average_completion_percent", "percent", "average project completion"];
  }
  if (/\bhealth score\b|\bproject health\b/.test(text)) {
    return ["average_health_score", "number", "average project health score"];
  }
  if (/\bbudget variance\b/.test(text)) {
    return ["budget_variance", "currency", "project budget variance"];
  }
  if (/\bactual cost\b|\bspent\b|\bspending\b/.test(text)) {
    return ["actual_cost", "currency", "total project actual cost"];
  }
  if (/\btotal budget\b|\bproject budget\b/.test(text)) {
    return ["total_budget", "currency", "total project budget"];
  }
  if (/\bover budget\b/.test(text)) return ["over_budget", "count", "over-budget project"];
  if (/\boverdue (?:project )?milestones?\b/.test(text)) {
    return ["milestones_overdue", "count", "overdue project milestone"];
  }
  if (/\bcompleted milestones?\b/.test(text)) {
    return ["milestones_completed", "count", "completed project milestone"];
  }
  if (/\bremaining milestones?\b|\bopen milestones?\b/.test(text)) {
    return ["milestones_remaining", "count", "remaining project milestone"];
  }
  if (/\bmilestones?\b/.test(text)) {
    return ["milestones_total", "count", "project milestone"];
  }
  if (/\bhigh risks?\b|\bcritical risks?\b/.test(text)) {
    return ["high_risks", "count", "high or critical open project risk"];
  }
  if (/\bopen risks?\b|\bproject risks?\b/.test(text)) {
    return ["open_risks", "count", "open project risk"];
  }
  if (/\bon track\b/.test(text)) return ["on_track", "count", "on-track project"];
  if (/\bat risk\b/.test(text)) return ["at_risk", "count", "at-risk project"];
  if (/\bdelayed\b/.test(text)) return ["delayed", "count", "delayed project"];
  if (/\bcompleted\b/.test(text)) return ["completed", "count", "completed project"];
  return null;
}

function reportingMetric(message) {
  const text = normalize(message);
  if (/\bcritical\b/.test(text)) return ["critical_active", "critical active ticket"];
  if (/\buncategorized\b/.test(text)) return ["uncategorized_tickets", "uncategorized ticket"];
  if (/\broot causes?\b/.test(text)) return ["root_causes_recorded", "ticket with a recorded root cause"];
  if (/\bassigned\b/.test(text)) return ["assigned_tickets", "assigned ticket"];
  if (/\bcompleted\b|\bresolved\b|\bclosed\b/.test(text)) {
    return ["completed_tickets", "completed ticket"];
  }
  if (/\bactive\b|\bopen\b/.test(text)) return ["active_tickets", "active ticket"];
  if (/\bbranches?\b/.test(text)) return ["represented_branches", "represented branch"];
  return null;
}

function reportingDays(message) {
  const text = normalize(message);
  if (/\blast year\b|\b365 days?\b/.test(text)) return 365;
  if (/\b6 months?\b|\b180 days?\b/.test(text)) return 180;
  if (/\b90 days?\b|\b3 months?\b/.test(text)) return 90;
  return 30;
}

function formatDuration(minutes) {
  const value = Math.max(0, Math.round(Number(minutes || 0)));
  if (value < 60) return `${value} minute${value === 1 ? "" : "s"}`;
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return `${hours} hour${hours === 1 ? "" : "s"}${remainder ? ` ${remainder} minute${remainder === 1 ? "" : "s"}` : ""}`;
}

function countLabel(label, count) {
  if (Number(count) === 1) return label;
  const plurals = {
    endpoint: "endpoints",
    ticket: "tickets",
    request: "requests",
    case: "cases",
    task: "tasks",
    record: "records",
    asset: "assets",
    milestone: "milestones",
    relationship: "relationships",
  };
  return String(label).replace(
    /\b(endpoint|ticket|request|case|task|record|asset|milestone|relationship)\b/,
    (word) => plurals[word]
  );
}

const CAPABILITIES = [
  {
    key: "branches",
    matches: (text) => /\b(branches|branch offices?|office branches?)\b/.test(text),
    repositoryMethod: "getAuthorizedBranchSummary",
    outcome: "live_branch_summary",
    notice: "Branch visibility rules were applied.",
    format: (data, message) => {
      const total = Number(data.total || 0);
      if (/\b(where|locations?|located|addresses?)\b/.test(normalize(message))) {
        const branches = Array.isArray(data.branches) ? data.branches : [];
        if (!branches.length) return "No branch locations are currently available.";
        return [
          "Branch locations:",
          ...branches.map((branch) => {
            const name = branch.branch_name || "Unnamed branch";
            const location = branch.branch_location || "Location not recorded";
            const headquarters = branch.is_headquarters ? " (Headquarters)" : "";
            return `- ${name}${headquarters}: ${location}`;
          }),
        ].join("\n");
      }
      return `There ${total === 1 ? "is" : "are"} ${total} branch${total === 1 ? "" : "es"}. Active: ${Number(data.active || 0)}, Inactive: ${Number(data.inactive || 0)}.`;
    },
  },
  {
    key: "users",
    matches: (text) =>
      /\b(users?|user accounts?|system accounts?|employees?)\b/.test(text)
      && !/\b(employee lifecycle|onboarding|offboarding)\b/.test(text),
    repositoryMethod: "getAuthorizedUserSummary",
    outcome: "live_user_summary",
    notice: "User Management visibility rules were applied.",
    format: (data, message) => {
      const total = Number(data.total || 0);
      const active = Number(data.active || 0);
      const inactive = Number(data.inactive || 0);
      if (/\bactive\b/.test(normalize(message)) && !/\binactive\b/.test(normalize(message))) {
        return `There ${active === 1 ? "is" : "are"} ${active} active user account${active === 1 ? "" : "s"}.`;
      }
      if (/\b(inactive|deactivated|disabled)\b/.test(normalize(message))) {
        return `There ${inactive === 1 ? "is" : "are"} ${inactive} inactive user account${inactive === 1 ? "" : "s"}.`;
      }
      const roles = Object.entries(data.by_role || {})
        .map(([role, count]) => `${role}: ${Number(count || 0)}`)
        .join(", ");
      return [
        `There ${total === 1 ? "is" : "are"} ${total} user account${total === 1 ? "" : "s"}. Active: ${active}, Inactive: ${inactive}.`,
        roles ? `By role: ${roles}.` : null,
      ].filter(Boolean).join("\n");
    },
  },
  {
    key: "screenshot monitoring",
    matches: (text) =>
      /\b(screenshots?|screen captures?|screenshot monitoring|screenshot gallery)\b/.test(text)
      && !/\b(endpoint polic(?:y|ies)|effective polic(?:y|ies)|consent)\b/.test(text),
    repositoryMethod: "getAuthorizedScreenshotSummary",
    outcome: "live_screenshot_summary",
    sourceLabel: "Endpoint Monitoring - Screenshots",
    notice: "Screenshot Monitoring role, employee ownership, and branch scope were applied. No protected image content was opened.",
    format: (data, message) => {
      const metric = screenshotMetric(message);
      if (metric === "latest") {
      if (!data.latest) return "No consent-approved screenshot is available.";
        const endpoint = data.latest.hostname || data.latest.device_name || "an endpoint";
        const employee = data.latest.assigned_user ? ` assigned to ${data.latest.assigned_user}` : "";
        return `The latest screenshot was received from ${endpoint}${employee} on ${formatTimestamp(data.latest.captured_at)}.`;
      }
      if (metric === "screenshots_today") {
        return `${Number(data.screenshots_today || 0)} consent-approved screenshot${Number(data.screenshots_today || 0) === 1 ? "" : "s"} have been received today from ${Number(data.devices_today || 0)} device${Number(data.devices_today || 0) === 1 ? "" : "s"}.`;
      }
      if (metric === "storage") {
        const megabytes = Number(data.storage_bytes || 0) / (1024 * 1024);
        return `Protected screenshots currently use ${megabytes.toFixed(1)} MB of object storage metadata tracked by AstreaBlue.`;
      }
      if (metric === "devices_reporting_recently") {
        const count = Number(data.devices_reporting_recently || 0);
        return `${count} device${count === 1 ? " is" : "s are"} currently sending screenshots, based on screenshot activity within the last 30 minutes. Today, ${Number(data.devices_today || 0)} device${Number(data.devices_today || 0) === 1 ? " has" : "s have"} reported.`;
      }
      return [
        `Screenshot Monitoring has received ${Number(data.screenshots_today || 0)} screenshot${Number(data.screenshots_today || 0) === 1 ? "" : "s"} today from ${Number(data.devices_today || 0)} device${Number(data.devices_today || 0) === 1 ? "" : "s"}.`,
        `Currently reporting (last 30 minutes): ${Number(data.devices_reporting_recently || 0)} device${Number(data.devices_reporting_recently || 0) === 1 ? "" : "s"}.`,
        `Latest screenshot: ${formatTimestamp(data.last_screenshot_at)}.`,
      ].join("\n");
    },
  },
  {
    key: "USB and DLP monitoring",
    matches: (text) =>
      /\b(usb|dlp|data loss prevention|removable (?:device|media)|file transfer)\b/.test(text)
      && !/\b(endpoint polic(?:y|ies)|effective polic(?:y|ies)|consent)\b/.test(text),
    repositoryMethod: "getAuthorizedUsbDlpSummary",
    outcome: "live_usb_dlp_summary",
    sourceLabel: "Endpoint Monitoring - USB & DLP",
    notice: "USB/DLP event role, employee ownership, and branch scope were applied. Only collected metadata is summarized.",
    format: (data, message) => {
      const metric = usbDlpMetric(message);
      if (metric === "latest") {
      if (!data.latest) return "No USB or DLP activity is available.";
        const event = data.latest;
        const subject = event.file_name
          ? ` for "${event.file_name}"`
          : event.volume_label
            ? ` on ${event.volume_label}`
            : "";
        const endpoint = event.hostname || event.device_name || "an endpoint";
        const risk = event.risk_level
          ? ` Risk: ${event.risk_level} (${Number(event.risk_score || 0)}/100).`
          : "";
        return `The latest USB/DLP activity was "${readableUsbEvent(event.event_type)}"${subject} on ${endpoint} at ${formatTimestamp(event.occurred_at)}.${risk}`;
      }
      if (metric) {
        const labels = {
          high_risk_today: "high-risk USB/DLP event",
          incidents_today: "automatic DLP incident",
          transfers_today: "USB file-transfer event",
          devices_today: "device reporting USB/DLP activity",
          events_today: "USB/DLP event",
        };
        const count = Number(data[metric] || 0);
        return `You currently have ${count} ${labels[metric]}${count === 1 ? "" : "s"} today.`;
      }
      return [
        `USB & DLP Monitoring recorded ${Number(data.events_today || 0)} event${Number(data.events_today || 0) === 1 ? "" : "s"} today across ${Number(data.devices_today || 0)} device${Number(data.devices_today || 0) === 1 ? "" : "s"}.`,
        `File transfers: ${Number(data.transfers_today || 0)}. High/Critical risk: ${Number(data.high_risk_today || 0)}. Automatic incidents: ${Number(data.incidents_today || 0)}.`,
        `Latest event: ${formatTimestamp(data.last_event_at)}.`,
      ].join("\n");
    },
  },
  {
    key: "endpoint health",
    matches: (text) =>
      /\b(endpoint health|device health|endpoint diagnostics?|monitoring health|health of (?:our )?(?:endpoints?|devices?))\b/
        .test(text),
    repositoryMethod: "getAuthorizedEndpointHealthSummary",
    outcome: "live_endpoint_health_summary",
    notice: "Endpoint diagnostics role and branch scope were applied; no device or policy state was changed.",
    format: (data, message) => {
      const metric = endpointHealthMetric(message);
      if (metric) {
        const [key, label] = metric;
        const count = Number(data[key] || 0);
        return `You currently have ${count} ${countLabel(label, count)}.`;
      }
      return [
        `You have ${Number(data.registered_endpoints || 0)} registered endpoint${Number(data.registered_endpoints || 0) === 1 ? "" : "s"}.`,
        `Overall health: Healthy: ${Number(data.healthy || 0)}, Warning: ${Number(data.warning || 0)}, Critical: ${Number(data.critical || 0)}, Offline: ${Number(data.offline || 0)}.`,
        `Requiring attention: ${Number(data.requiring_attention || 0)}. Monitoring active: ${Number(data.monitoring_active || 0)}.`,
        `Healthy components: Heartbeat: ${Number(data.heartbeat_healthy || 0)}, Activity: ${Number(data.activity_healthy || 0)}, Hardware inventory: ${Number(data.hardware_inventory_healthy || 0)}, Software inventory: ${Number(data.software_inventory_healthy || 0)}, Policy sync: ${Number(data.policy_sync_healthy || 0)}, Consent: ${Number(data.consent_active || 0)}.`,
      ].join("\n");
    },
  },
  {
    key: "endpoint policy",
    matches: (text) =>
      /\b(endpoint polic(?:y|ies)|effective polic(?:y|ies)|policy sync|policy download|monitoring polic(?:y|ies))\b/
        .test(text),
    repositoryMethod: "getAuthorizedEndpointPolicySummary",
    outcome: "live_endpoint_policy_summary",
    notice: "Endpoint Policy administration role and branch scope were applied. Counts use the saved effective policy last generated for each device; no policy was regenerated.",
    format: (data, message) => {
      const metric = endpointPolicyMetric(message);
      if (metric) {
        const [key, label] = metric;
        const count = Number(data[key] || 0);
        return `You currently have ${count} device${count === 1 ? "" : "s"} matching "${label}".`;
      }
      return [
        `Endpoint Policy covers ${Number(data.total_devices || 0)} monitored device${Number(data.total_devices || 0) === 1 ? "" : "s"} (${Number(data.assigned_devices || 0)} assigned, ${Number(data.unassigned_devices || 0)} unassigned).`,
        `Effective policies: ${Number(data.generated_policies || 0)} generated, ${Number(data.policies_not_generated || 0)} not generated, ${Number(data.policies_downloaded || 0)} downloaded by agents, ${Number(data.policies_pending_download || 0)} pending download.`,
        `Consent coverage: ${Number(data.consent_approved_devices || 0)} device${Number(data.consent_approved_devices || 0) === 1 ? "" : "s"} covered; ${Number(data.devices_without_approved_consent || 0)} assigned device${Number(data.devices_without_approved_consent || 0) === 1 ? "" : "s"} without active approved consent.`,
        `Enabled effective monitoring: Activity ${Number(data.activity_enabled || 0)}, Screenshots ${Number(data.screenshot_enabled || 0)}, USB ${Number(data.usb_enabled || 0)}, Browser ${Number(data.browser_enabled || 0)}, Location ${Number(data.location_enabled || 0)}.`,
      ].join("\n");
    },
  },
  {
    key: "knowledge_base",
    matches: (text) =>
      /\b(knowledge base|kb articles?|knowledge articles?|articles?)\b/.test(text),
    repositoryMethod: "getAuthorizedKnowledgeBaseSummary",
    outcome: "live_knowledge_base_summary",
    notice: "Knowledge Base visibility and publication rules were applied.",
    sourceLabel: "Service Desk - Knowledge Base",
    format: (data) => [
      `There are ${Number(data.total || 0)} Knowledge Base article${Number(data.total || 0) === 1 ? "" : "s"}.`,
      `Published: ${Number(data.published || 0)}, Draft: ${Number(data.draft || 0)}, Archived: ${Number(data.archived || 0)}.`,
      `Categories represented: ${Number(data.categories || 0)}.`,
    ].join("\n"),
  },
  {
    key: "consent",
    matches: (text) =>
      /\b(consent records?|consent documents?|privacy consent|monitoring consent|general consent|device[- ]specific consent)\b/
        .test(text),
    repositoryMethod: "getAuthorizedConsentSummary",
    outcome: "live_consent_summary",
    notice: "Existing Consent Management role, employee ownership, and branch access rules were applied.",
    format: (data, message) => {
      const metric = consentMetric(message);
      if (metric) {
        const [key, label] = metric;
        const count = Number(data[key] || 0);
        return `There ${count === 1 ? "is" : "are"} ${count} ${label} consent record${count === 1 ? "" : "s"}.`;
      }
      return [
        `There are ${Number(data.total || 0)} consent record${Number(data.total || 0) === 1 ? "" : "s"} for ${Number(data.employees || 0)} employee${Number(data.employees || 0) === 1 ? "" : "s"}.`,
        `Workflow: Approved ${Number(data.approved || 0)}, Awaiting employee ${Number(data.awaiting_employee || 0)}, Awaiting approval ${Number(data.awaiting_approval || 0)}, Revision requested ${Number(data.revision_requested || 0)}, Rejected ${Number(data.rejected || 0)}, Withdrawn ${Number(data.withdrawn || 0)}.`,
        `Scope: General ${Number(data.general || 0)}, Device-specific ${Number(data.device_specific || 0)}. Historical: Expired ${Number(data.expired || 0)}, Superseded ${Number(data.superseded || 0)}.`,
      ].join("\n");
    },
  },
  {
    key: "asset finance",
    matches: (text) =>
      /\b(asset finance|asset financials?|financial tracking|depreciat(?:ion|ed|ing)?|book value|purchase cost|asset value|capitalized|expense items?|end of life|eol|warrant(?:y|ies))\b/
        .test(text)
      && !/\bsoftware licen[cs]es?\b/.test(text),
    repositoryMethod: "getAuthorizedAssetFinanceSummary",
    repositoryArgs: (message) => ({ filters: assetFinanceFilters(message) }),
    outcome: "live_asset_finance_summary",
    notice: "Asset Finance role and branch scope, straight-line depreciation, and the PHP 5,000 capitalization threshold were applied.",
    format: (data, message) => {
      const metric = assetFinanceMetric(message);
      const scope = financeScopeLabel(data);
      if (metric) {
        const [key, type, label] = metric;
        const value = Number(data[key] || 0);
        if (type === "currency") {
          return `The ${label}${scope} is ${formatCurrency(value)}.`;
        }
        return `You currently have ${value} ${label}${value === 1 ? "" : "s"}${scope}.`;
      }
      return [
        `Asset Finance${scope}: ${Number(data.total_assets || 0)} record${Number(data.total_assets || 0) === 1 ? "" : "s"}, including ${Number(data.depreciable_assets || 0)} depreciable asset${Number(data.depreciable_assets || 0) === 1 ? "" : "s"} and ${Number(data.expense_items || 0)} expense item${Number(data.expense_items || 0) === 1 ? "" : "s"}.`,
        `Capitalized purchase value: ${formatCurrency(data.total_asset_value)}. Current book value: ${formatCurrency(data.current_book_value)}. Accumulated depreciation: ${formatCurrency(data.accumulated_depreciation)}.`,
        `Monthly depreciation: ${formatCurrency(data.monthly_depreciation_expense)}. Fully depreciated: ${Number(data.fully_depreciated_assets || 0)}. Near or at end of life: ${Number(data.assets_near_end_of_life || 0)}.`,
        `Warranty: ${Number(data.warranties_expired || 0)} expired, ${Number(data.warranties_expiring_30_days || 0)} expiring in 30 days. Missing financial information: ${Number(data.missing_financial_information || 0)}.`,
      ].join("\n");
    },
  },
  {
    key: "asset discovery",
    matches: (text) =>
      /\b(asset discovery|discovery inventory|discovered (?:assets?|devices?)|reconciliation|reconciled|mismatched?|unmanaged|pending verification|duplicates?)\b/
        .test(text),
    repositoryMethod: "getAuthorizedAssetDiscoverySummary",
    outcome: "live_asset_discovery_summary",
    notice: "Asset Discovery role, branch scope, and identity-verification logic were applied.",
    format: (data, message) => {
      const metric = assetDiscoveryMetric(message);
      if (metric) {
        const [key, label] = metric;
        const count = Number(data[key] || 0);
        return `You currently have ${count} ${label} discovery record${count === 1 ? "" : "s"}.`;
      }
      return [
        `You have ${Number(data.total || 0)} Asset Discovery record${Number(data.total || 0) === 1 ? "" : "s"}.`,
        `Verification: Matched: ${Number(data.matched || 0)}, Mismatched: ${Number(data.mismatched || 0)}, Pending Verification: ${Number(data.pending_verification || 0)}, Unmanaged: ${Number(data.unmanaged || 0)}, Duplicates: ${Number(data.duplicates || 0)}.`,
        `Operational status: Offline: ${Number(data.offline || 0)}. Asset linkage: Linked: ${Number(data.linked || 0)}, Unlinked: ${Number(data.unlinked || 0)}.`,
      ].join("\n");
    },
  },
  {
    key: "sla",
    matches: (text) => /\b(sla|service level|first response|resolution target)\b/.test(text),
    repositoryMethod: "getAuthorizedSlaSummary",
    outcome: "live_sla_summary",
    notice: "Existing ticket RBAC was applied to the SLA summary.",
    format: (data, message) => {
      const metric = slaMetric(message);
      if (metric) {
        const [key, type, label] = metric;
        const value = Number(data[key] || 0);
        if (type === "percent") return `Your current ${label} is ${value}%.`;
        if (type === "duration") return `Your current ${label} is ${formatDuration(value)}.`;
        return `You currently have ${value} ${countLabel(label, value)}.`;
      }
      return [
        `You have ${Number(data.total || 0)} SLA-tracked ticket${Number(data.total || 0) === 1 ? "" : "s"}.`,
        `Active: ${Number(data.active || 0)}, Due within four hours: ${Number(data.due_soon || 0)}, Met: ${Number(data.met || 0)}, Breached: ${Number(data.breached || 0)}, Pending result: ${Number(data.pending || 0)}.`,
        `Compliance: ${Number(data.compliance_percent || 0)}%. Average first response: ${formatDuration(data.avg_response_time_minutes)}. Average resolution: ${formatDuration(data.avg_resolution_time_minutes)}.`,
      ].join("\n");
    },
  },
  {
    key: "replacement",
    matches: (text) => /\b(replacement requests?|replacement management|repair requests?)\b/.test(text),
    repositoryMethod: "getAuthorizedReplacementSummary",
    outcome: "live_replacement_summary",
    notice: "Replacement Management role, ownership, and branch access rules were applied.",
    format: (data, message) => {
      const metric = replacementMetric(message);
      if (metric) {
        const [key, label] = metric;
        const count = Number(data[key] || 0);
        return `You currently have ${count} ${countLabel(label, count)}.`;
      }
      return [
        `You have ${Number(data.total || 0)} replacement request${Number(data.total || 0) === 1 ? "" : "s"}.`,
        `Active: ${Number(data.active || 0)}. Submitted: ${Number(data.submitted || 0)}, Under assessment: ${Number(data.under_assessment || 0)}, Awaiting approval: ${Number(data.awaiting_approval || 0)}, Approved: ${Number(data.approved || 0)}, Reserved: ${Number(data.reserved || 0)}, Issued: ${Number(data.issued || 0)}.`,
        `Repair path: Recommended: ${Number(data.repair_recommended || 0)}, In repair: ${Number(data.in_repair || 0)}, Repaired: ${Number(data.repaired || 0)}. Terminal: Completed: ${Number(data.completed || 0)}, Rejected: ${Number(data.rejected || 0)}, Cancelled: ${Number(data.cancelled || 0)}.`,
      ].join("\n");
    },
  },
  {
    key: "lifecycle",
    matches: (text) => /\b(employee lifecycle|onboarding|offboarding|lifecycle(?: cases?)?)\b/.test(text),
    repositoryMethod: "getAuthorizedLifecycleSummary",
    outcome: "live_lifecycle_summary",
    notice: "Employee Lifecycle role and branch access rules were applied.",
    format: (data, message) => {
      const metric = lifecycleMetric(message);
      if (metric) {
        const [key, label] = metric;
        const count = Number(data[key] || 0);
        return `You currently have ${count} ${countLabel(label, count)}.`;
      }
      return [
        `You have ${Number(data.total || 0)} employee lifecycle case${Number(data.total || 0) === 1 ? "" : "s"}.`,
        `Active onboarding: ${Number(data.active_onboarding || 0)}, Active offboarding: ${Number(data.active_offboarding || 0)}, Awaiting employee: ${Number(data.awaiting_employee || 0)}, Awaiting administrator: ${Number(data.awaiting_administrator || 0)}, Ready for final review: ${Number(data.ready_for_verification || 0)}.`,
        `Required checklist tasks still pending: ${Number(data.required_pending_tasks || 0)} across ${Number(data.cases_with_pending_tasks || 0)} case${Number(data.cases_with_pending_tasks || 0) === 1 ? "" : "s"}. Completed: ${Number(data.completed || 0)}, Cancelled: ${Number(data.cancelled || 0)}.`,
      ].join("\n");
    },
  },
  {
    key: "cmdb",
    matches: (text) =>
      /\b(configuration items?|cmdb|config items?|dependency map|dependencies|ci relationships?|change impact)\b/
        .test(text),
    repositoryMethod: "getAuthorizedCmdbSummary",
    outcome: "live_cmdb_summary",
    notice: "Configuration Management role and branch access rules were applied. Change-impact counts use the live dependency graph and the same production/affected-CI thresholds as Change Impact Analysis.",
    format: (data, message) => {
      const metric = cmdbMetric(message);
      if (metric) {
        const [key, label] = metric;
        const count = Number(data[key] || 0);
        return `You currently have ${count} ${countLabel(label, count)}.`;
      }
      const typeBreakdown = Object.entries(data.by_type || {})
        .map(([type, count]) => `${type}: ${Number(count || 0)}`)
        .join(", ");
      return [
        `You have ${Number(data.total || 0)} configuration item${Number(data.total || 0) === 1 ? "" : "s"}.`,
        `Active: ${Number(data.active || 0)}, Inactive: ${Number(data.inactive || 0)}, Production: ${Number(data.production || 0)}, Non-production: ${Number(data.non_production || 0)}.`,
        `Dependency map: ${Number(data.relationships || 0)} relationship${Number(data.relationships || 0) === 1 ? "" : "s"}, ${Number(data.connected || 0)} connected CIs, ${Number(data.isolated || 0)} isolated CIs.`,
        `Change impact: Low ${Number(data.impact_low || 0)}, Medium ${Number(data.impact_medium || 0)}, High ${Number(data.impact_high || 0)}, Critical ${Number(data.impact_critical || 0)}.`,
        typeBreakdown ? `CI types: ${typeBreakdown}.` : "CI types: none recorded.",
      ].join("\n");
    },
  },
  {
    key: "projects",
    matches: (text) => /\b(projects?|project forecasting|project portfolio)\b/.test(text),
    repositoryMethod: "getAuthorizedProjectSummary",
    outcome: "live_project_summary",
    notice: "Project Analytics role and branch access rules were applied.",
    format: (data, message) => {
      const metric = projectMetric(message);
      if (metric) {
        const [key, type, label] = metric;
        const value = Number(data[key] || 0);
        if (type === "currency") {
          return `The ${label} is ${formatCurrency(value)}.`;
        }
        if (type === "percent") {
          return `The ${label} is ${value}%.`;
        }
        if (type === "number") {
          return `The ${label} is ${value}.`;
        }
        return `You currently have ${value} ${countLabel(label, value)}.`;
      }
      return [
        `You have ${Number(data.total || 0)} active project record${Number(data.total || 0) === 1 ? "" : "s"}.`,
        `Portfolio: On track ${Number(data.on_track || 0)}, At risk ${Number(data.at_risk || 0)}, Delayed ${Number(data.delayed || 0)}, Completed ${Number(data.completed || 0)}; average completion ${Number(data.average_completion_percent || 0)}%.`,
        `Milestones: ${Number(data.milestones_completed || 0)} completed, ${Number(data.milestones_remaining || 0)} remaining, ${Number(data.milestones_overdue || 0)} overdue. Open risks: ${Number(data.open_risks || 0)} (${Number(data.high_risks || 0)} high/critical).`,
        `Financials: Budget ${formatCurrency(data.total_budget)}, Actual cost ${formatCurrency(data.actual_cost)}, Variance ${formatCurrency(data.budget_variance)}. Resource utilization: ${Number(data.resource_utilization_percent || 0)}%.`,
      ].join("\n");
    },
  },
  {
    key: "reporting",
    matches: (text) =>
      /\b(reporting analytics|operational analytics|executive dashboard|custom reports?|service desk reports?)\b/
        .test(text),
    repositoryMethod: "getAuthorizedReportingSummary",
    repositoryArgs: (message) => ({ days: reportingDays(message) }),
    outcome: "live_reporting_summary",
    notice: "Reporting & Analytics administrator and branch scope were applied. This is a read-only operational summary.",
    format: (data, message) => {
      const metric = reportingMetric(message);
      if (metric) {
        const [key, label] = metric;
        const count = Number(data[key] || 0);
        return `The ${Number(data.days || 30)}-day report contains ${count} ${countLabel(label, count)}.`;
      }
      return [
        `The ${Number(data.days || 30)}-day operational report contains ${Number(data.total_tickets || 0)} ticket${Number(data.total_tickets || 0) === 1 ? "" : "s"}.`,
        `Active: ${Number(data.active_tickets || 0)}, Completed: ${Number(data.completed_tickets || 0)}, Critical active: ${Number(data.critical_active || 0)}, Assigned: ${Number(data.assigned_tickets || 0)}.`,
        `Data quality: ${Number(data.uncategorized_tickets || 0)} uncategorized and ${Number(data.root_causes_recorded || 0)} with a recorded root cause.`,
      ].join("\n");
    },
  },
];

function findLiveSummaryCapability(message) {
  const text = normalize(message);
  if (!asksForLiveSummary(text)) return null;
  return CAPABILITIES.find((capability) => capability.matches(text)) || null;
}

function formatCapabilityResult(capability, data, message = "", actor = null) {
  if (data?.authorized === false) {
    return `You do not have access to ${capability.key} live data under your current role or branch.`;
  }
  return capability.format(data || {}, message, actor);
}

module.exports = {
  CAPABILITIES,
  assetFinanceFilters,
  assetFinanceMetric,
  assetDiscoveryMetric,
  consentMetric,
  cmdbMetric,
  endpointHealthMetric,
  endpointPolicyMetric,
  findLiveSummaryCapability,
  formatCapabilityResult,
  lifecycleMetric,
  projectMetric,
  reportingDays,
  reportingMetric,
  replacementMetric,
  slaMetric,
};
