const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { createNotification } = require("../services/notificationService");
const {
  DEFAULT_HIGH_RISK_EXTENSIONS,
  DEFAULT_SENSITIVE_FILENAME_KEYWORDS,
  resolveDlpRules,
} = require("../services/dlpRiskService");
const { buildEndpointHealth } = require("../services/endpointHealthService");
const { enforceConsentGates } = require("../services/endpointConsentPolicyService");
const {
  endpointMonitoringTablesReady,
} = require("../services/endpointMonitoringSchemaService");
const endpointMonitoringRepository = require("../repositories/endpointMonitoringRepository");
const { registerEndpointScreenshotRoutes } = require("./endpointScreenshotRoutes");
const { registerEndpointEnrollmentRoutes } = require("./endpointEnrollmentRoutes");
const { registerEndpointInventoryRoutes } = require("./endpointInventoryRoutes");
const { registerEndpointScreenshotControlRoutes } = require("./endpointScreenshotControlRoutes");
const { registerEndpointPolicyRoutes } = require("./endpointPolicyRoutes");
const { registerEndpointDeviceRoutes } = require("./endpointDeviceRoutes");
const { registerEndpointUsbDlpRoutes } = require("./endpointUsbDlpRoutes");
const { registerEndpointTelemetryRoutes } = require("./endpointTelemetryRoutes");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";

router.use(async (_req, res, next) => {
  if (await endpointMonitoringTablesReady) return next();
  return res.status(503).json({ success: false, message: "Laptop monitoring storage is unavailable." });
});

function safeEqual(value, expected) {
  const left = Buffer.from(String(value || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function secretHash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function randomCredential(prefix, bytes = 32) {
  return `${prefix}-${crypto.randomBytes(bytes).toString("base64url")}`;
}

function requestIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0].trim().slice(0, 80) || null;
}

async function recordEnrollmentAudit(eventType, {
  codeId = null,
  deviceId = null,
  actorId = null,
  req = null,
  details = {},
} = {}, client) {
  await endpointMonitoringRepository.insertEnrollmentAudit({
    eventType,
    codeId,
    deviceId,
    actorId,
    sourceIp: req ? requestIp(req) : null,
    details,
    client,
  });
}

async function requireAgent(req, res, next) {
  const expected = process.env.MONITORING_AGENT_TOKEN;
  const supplied = String(req.headers["x-agent-token"] || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "")).trim();
  if (!supplied) return res.status(401).json({ success: false, message: "Monitoring agent authentication is required." });

  try {
    if (supplied.startsWith("ABDEV-")) {
      const device = await endpointMonitoringRepository.findActiveDeviceCredential(secretHash(supplied));
      if (!device) {
        return res.status(401).json({ success: false, message: "Invalid or revoked device credential." });
      }
      const claimedUuid = String(req.body?.device_uuid || req.query?.device_uuid || "").trim().toLowerCase();
      const isMultipartUpload = String(req.headers["content-type"] || "").toLowerCase().startsWith("multipart/form-data");
      if (!claimedUuid && !isMultipartUpload) {
        return res.status(400).json({ success: false, message: "device_uuid is required with a device credential." });
      }
      if (claimedUuid && claimedUuid !== String(device.device_uuid || "").toLowerCase()) {
        await recordEnrollmentAudit("credential_device_mismatch", {
          deviceId: device.device_id,
          req,
          details: { claimed_device_uuid: claimedUuid },
        }).catch(() => null);
        return res.status(403).json({ success: false, message: "Device credential does not match the requested device." });
      }
      await endpointMonitoringRepository.touchDeviceCredential(
        device.device_credential_id,
        device.device_id
      );
      req.agentDevice = device;
      req.agentAuthentication = "device_credential";
      return next();
    }

    if (expected && safeEqual(supplied, expected)) {
      req.agentAuthentication = "legacy_global_token";
      return next();
    }
    if (!expected) {
      return res.status(503).json({ success: false, message: "Legacy monitoring-agent authentication is not configured." });
    }
    return res.status(401).json({ success: false, message: "Invalid monitoring agent token." });
  } catch (error) {
    console.error("[laptop-monitoring:agent-auth]", error.message);
    return res.status(503).json({ success: false, message: "Monitoring agent authentication is temporarily unavailable." });
  }
}

function requireAdmin(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";
    if (!authorization.startsWith("Bearer ")) throw new Error("Authentication required.");
    const user = jwt.verify(authorization.slice(7), JWT_SECRET);
    const role = String(user.role || "").toLowerCase().replace(/[\s_-]/g, "");
    if (!["superadmin", "admin", "technician", "employee"].includes(role)) return res.status(403).json({ success: false, message: "Monitoring access required." });
    req.monitoringUser = user;
    req.monitoringRole = role;
    req.monitoringUserId = user.userId || user.user_id || null;
    req.monitoringIsSuperAdmin = role === "superadmin";
    req.monitoringIsEmployee = role === "employee";
    req.monitoringBranchId = (role === "admin" || role === "technician") ? user.branchId : null;
    return next();
  } catch (_error) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
}

function requireSuperAdmin(req, res, next) {
  return requireAdmin(req, res, () => {
    if (!req.monitoringIsSuperAdmin) {
      return res.status(403).json({ success: false, error: "SuperAdmin access required." });
    }
    return next();
  });
}

function requireEnrollmentAdmin(req, res, next) {
  return requireAdmin(req, res, () => {
    if (!req.monitoringIsSuperAdmin && req.monitoringRole !== "admin") {
      return res.status(403).json({ success: false, message: "Administrator access is required." });
    }
    if (req.monitoringRole === "admin" && !req.monitoringBranchId) {
      return res.status(403).json({ success: false, message: "Administrator branch assignment is required." });
    }
    return next();
  });
}

registerEndpointEnrollmentRoutes(router, {
  requireEnrollmentAdmin,
  randomCredential,
  secretHash,
  recordEnrollmentAudit,
});

function hasPreference(prefs, ...names) {
  return Array.isArray(prefs) && names.some((name) => prefs.includes(name));
}

async function ensureConsentRequestForDevice(device, actorId) {
  if (!device?.assigned_user_id || !device?.device_uuid) return null;

  const existing = await endpointMonitoringRepository.findCurrentConsentRequest(
    device.assigned_user_id,
    device.device_uuid
  );
  if (existing) return existing;

  const employee = await endpointMonitoringRepository.findEmployeeProfile(device.assigned_user_id);
  if (!employee) return null;

  const created = await endpointMonitoringRepository.createGeneralConsentRequest(
    device,
    employee,
    actorId
  );

  await endpointMonitoringRepository.createConsentRequestAudit(
    created.consent_id,
    device.assigned_user_id,
    actorId
  ).catch((error) => console.error("[laptop-monitoring:consent-audit]", error.message));

  if (typeof createNotification === "function") {
    await createNotification({
      userId: device.assigned_user_id,
      title: "Monitoring agreement required",
      message: "Complete the general monitoring agreement once to cover your assigned company devices.",
      type: "privacy_consent",
      metadata: { consentId: created.consent_id, consentScope: "general" },
      dedupeKey: `general-consent-request-${device.assigned_user_id}`,
    }).catch((error) => console.error("[laptop-monitoring:consent-notification]", error.message));
  }

  return created;
}

async function getApprovedConsentPreferences(device) {
  if (!device?.assigned_user_id || !device?.device_uuid) return [];
  const preferences = await endpointMonitoringRepository.findApprovedConsentPreferences(
    device.assigned_user_id,
    device.device_uuid
  );
  if (preferences) return preferences;

  const legacy = await endpointMonitoringRepository.findLegacyConsentPreferences(
    device.assigned_user_id
  );

  if (legacy) {
    const l = legacy;
    const prefs = [];
    if (l.application_monitoring) prefs.push("application_monitoring");
    if (l.web_monitoring) prefs.push("website_monitoring");
    if (l.device_telemetry) prefs.push("device_telemetry");
    if (l.email_header_monitoring) prefs.push("email_header_monitoring");
    return prefs;
  }

  return [];
}

async function findDevice(body) {
  const deviceUuid = String(body.device_uuid || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceUuid)) return null;
  return endpointMonitoringRepository.findDeviceByUuid(deviceUuid);
}

function normalizeSoftwareItem(item) {
  const name = String(item?.software_name || item?.name || "").replace(/\0/g, '').trim().slice(0, 500);
  if (!name) return null;
  return {
    software_name: name,
    version: String(item?.version || "").replace(/\0/g, '').trim().slice(0, 255) || null,
    publisher: String(item?.publisher || "").replace(/\0/g, '').trim().slice(0, 255) || null,
    install_date: String(item?.install_date || "").replace(/\0/g, '').trim().slice(0, 80) || null,
    install_location: String(item?.install_location || "").replace(/\0/g, '').trim().slice(0, 2000) || null,
    source: String(item?.source || "registry").replace(/\0/g, '').trim().slice(0, 80) || "registry",
  };
}

registerEndpointTelemetryRoutes(router, {
  requireAgent,
  findDevice,
  getApprovedConsentPreferences,
  hasPreference,
  generateEffectivePolicy,
  logPolicyAudit,
  resolveConsentGatedFeature,
});

async function resolveConsentGatedFeature(device, featureFlag) {
  if (!device?.assigned_user_id) {
    return {
      allowed: false,
      policy: null,
      reason: "Device must be assigned to an employee before monitoring.",
    };
  }

  const policy = await generateEffectivePolicy(device.device_uuid, null);
  if (!policy) {
    return { allowed: false, policy: null, reason: "Effective endpoint policy is unavailable." };
  }

  const feature = policy.features?.[featureFlag];
  const allowed = Boolean(policy[featureFlag]) && feature?.enabled !== false;
  return {
    allowed,
    policy,
    reason: allowed ? null : (feature?.reason || policy.reasons?.[featureFlag] || "Feature is disabled by the effective endpoint policy."),
  };
}

registerEndpointDeviceRoutes(router, {
  requireAdmin,
  ensureConsentRequestForDevice,
});


registerEndpointUsbDlpRoutes(router, {
  requireAgent,
  requireAdmin,
  findDevice,
  resolveConsentGatedFeature,
});

// Keep website monitoring authorization aligned with the canonical effective
// policy. This applies employee consent, endpoint policy, assignment, and all
// supported browser/domain consent aliases in one place.
router.get("/website-monitoring-permission", requireAgent, async (req, res) => {
  try {
    const device = await findDevice(req.query || {});
    if (!device) return res.status(404).json({ success: false, message: "Device not registered. Send a heartbeat first." });
    const permission = await resolveConsentGatedFeature(device, "browser_monitoring_enabled");
    return res.json({
      success: true,
      data: {
        allowed: permission.allowed,
        feature: "website_monitoring",
        policy_version: permission.policy?.policy_version || null,
        consent_id: permission.policy?.consent_id || null,
        reason: permission.reason,
      },
    });
  } catch (error) {
    console.error("[laptop-monitoring:website-monitoring-permission]", error.message);
    return res.status(500).json({ success: false, message: "Failed to verify website monitoring consent." });
  }
});

registerEndpointScreenshotRoutes(router, { requireAdmin });

registerEndpointInventoryRoutes(router, {
  requireAgent,
  requireAdmin,
  normalizeSoftwareItem,
});

// Endpoint Policy Engine APIs

async function logPolicyAudit(userId, action, targetId, details) {
  try {
    await endpointMonitoringRepository.insertPolicyAudit(userId, action, targetId, details);
  } catch (err) {
    console.error("[laptop-monitoring] policy audit error:", err.message);
  }
}

const policyFeatureMap = {
  heartbeat: "heartbeat_enabled",
  activity: "activity_monitoring_enabled",
  screenshots: "screenshot_monitoring_enabled",
  hardware_inventory: "hardware_inventory_enabled",
  software_inventory: "software_inventory_enabled",
  browser: "browser_monitoring_enabled",
  usb: "usb_monitoring_enabled",
  location: "location_tracking_enabled",
  auto_incident: "auto_incident_enabled",
};

function normalizePolicyConfig(body = {}) {
  const suppliedConfig = body.config_json && typeof body.config_json === "object" && !Array.isArray(body.config_json)
    ? body.config_json
    : {};
  const config = { ...suppliedConfig };
  if (body.features_enabled && typeof body.features_enabled === "object") {
    for (const [clientKey, enabled] of Object.entries(body.features_enabled)) {
      const policyKey = policyFeatureMap[clientKey] || clientKey;
      config[policyKey] = !!enabled;
    }
  }
  if (body.collection_interval_seconds && typeof body.collection_interval_seconds === "object") {
    config.intervals = { ...(config.intervals || {}), ...body.collection_interval_seconds };
  }
  if (config.usb_scan_interval_seconds !== undefined) {
    config.usb_scan_interval_seconds = Math.min(3600, Math.max(10, Number(config.usb_scan_interval_seconds) || 15));
  }
  if (config.dlp_large_transfer_mb !== undefined) {
    config.dlp_large_transfer_mb = Math.min(102400, Math.max(1, Number(config.dlp_large_transfer_mb) || 100));
  }
  if (config.dlp_high_risk_extensions !== undefined) {
    config.dlp_high_risk_extensions = resolveDlpRules({
      dlp_high_risk_extensions: config.dlp_high_risk_extensions,
    }).highRiskExtensions;
  }
  if (config.dlp_sensitive_filename_keywords !== undefined) {
    config.dlp_sensitive_filename_keywords = resolveDlpRules({
      dlp_sensitive_filename_keywords: config.dlp_sensitive_filename_keywords,
    }).sensitiveFilenameKeywords;
  }
  return config;
}

function policyForClient(row) {
  const config = row.config_json && typeof row.config_json === "object" ? row.config_json : {};
  const features = {};
  for (const [clientKey, policyKey] of Object.entries(policyFeatureMap)) features[clientKey] = !!config[policyKey];
  return {
    ...row,
    policy_name: row.name,
    features_enabled: features,
    collection_interval_seconds: config.intervals || {},
    version: `${row.priority || 0}.${row.id}`,
  };
}

// Device calculation
async function generateEffectivePolicy(deviceUuid, actorId) {
  const device = await endpointMonitoringRepository.findPolicyDevice(deviceUuid);
  if (!device) return null;

  const assignments = await endpointMonitoringRepository.listActivePolicyAssignments();

  let highestPriority = -9999;
  let effectiveConfig = {
    heartbeat_enabled: true,
    telemetry_enabled: true,
    hardware_inventory_enabled: true,
    software_inventory_enabled: true,
    policy_sync_enabled: true,
    activity_monitoring_enabled: false,
    screenshot_monitoring_enabled: false,
    usb_monitoring_enabled: false,
    browser_monitoring_enabled: false,
    location_tracking_enabled: false,
    auto_incident_enabled: false,
    screenshot_interval_minutes: 15,
    screenshot_retention_days: 30,
    usb_scan_interval_seconds: 15,
    dlp_large_transfer_mb: 100,
    dlp_high_risk_extensions: DEFAULT_HIGH_RISK_EXTENSIONS,
    dlp_sensitive_filename_keywords: DEFAULT_SENSITIVE_FILENAME_KEYWORDS,
    intervals: { heartbeat: 60, activity: 60 },
    retention: { logs_days: 30 }
  };
  let effectivePolicyName = "Default (Safe)";
  let effectivePolicyVersion = "1.0";
  const featureSources = {};
  let consentDoc = null;
  let screenshotOverride = null;

  // The approved consent document is the canonical source of employee choices.
  // endpoint_monitoring_policies is a materialized audit record and can be stale
  // after a preference change, so it must not decide the effective flags.
  if (device.assigned_user_id) {
    consentDoc = await endpointMonitoringRepository.findApprovedPolicyConsent(
      device.assigned_user_id,
      device.device_uuid
    );
    if (consentDoc) {
      const prefs = consentDoc.monitoring_preferences || [];
      const consentBaseline = {
        telemetry_enabled: true,
        activity_monitoring_enabled: hasPreference(prefs, "application_monitoring", "applications", "activity_monitoring", "app_usage", "window_title", "idle_time"),
        screenshot_monitoring_enabled: hasPreference(prefs, "screenshot_monitoring", "screenshot"),
        usb_monitoring_enabled: hasPreference(prefs, "usb_monitoring", "usb"),
        browser_monitoring_enabled: hasPreference(prefs, "web_monitoring", "website_monitoring", "network_domains", "browser"),
        location_tracking_enabled: hasPreference(prefs, "location_tracking"),
      };
      effectiveConfig = { ...effectiveConfig, ...consentBaseline };
      effectivePolicyName = "Approved Consent Policy";
      effectivePolicyVersion = `consent-${consentDoc.consent_version || consentDoc.consent_id}`;
      for (const key of Object.keys(consentBaseline)) featureSources[key] = "Approved Consent";
    }
  }

  const targetPriorities = { 'Employee': 6, 'Device': 5, 'Asset': 4, 'Department': 3, 'Branch': 2, 'Global': 1 };

  for (const row of assignments) {
    let matches = false;
    const targetType = String(row.target_type || '').toLowerCase();
    if (targetType === 'device' && row.target_id === String(device.device_uuid)) matches = true;
    else if (targetType === 'asset' && row.target_id === String(device.asset_id)) matches = true;
    else if (targetType === 'employee' && row.target_id === String(device.assigned_user_id)) matches = true;
    else if (targetType === 'department' && (row.target_id === String(device.department) || row.target_id === String(device.employee_department))) matches = true;
    else if (targetType === 'branch' && row.target_id === String(device.branch_id)) matches = true;
    else if (targetType === 'global') matches = true;

    if (matches) {
      const canonicalTargetType = targetType.charAt(0).toUpperCase() + targetType.slice(1);
      const typePriority = targetPriorities[canonicalTargetType] || 0;
      const totalPriority = row.priority * 100 + typePriority;
      if (totalPriority > highestPriority) {
        highestPriority = totalPriority;
        effectiveConfig = { ...effectiveConfig, ...row.config_json };
        effectivePolicyName = `Policy ID ${row.policy_id}`;
        effectivePolicyVersion = `${row.priority}.${row.id}`;
        for (const key of Object.keys(row.config_json || {})) featureSources[key] = canonicalTargetType;
      }
    }
  }

  const consentGateResult = enforceConsentGates({
    config: effectiveConfig,
    consentDocument: consentDoc,
    featureSources,
    employeeAssigned: !!device.assigned_user_id,
  });
  effectiveConfig = consentGateResult.effectiveConfig;
  const reasons = consentGateResult.reasons;

  if (device.assigned_user_id) {
    screenshotOverride = await endpointMonitoringRepository.findScreenshotOverride(
      device.assigned_user_id
    );
    if (screenshotOverride?.suspended) {
      effectiveConfig.screenshot_monitoring_enabled = false;
      featureSources.screenshot_monitoring_enabled = "SuperAdmin Override";
      reasons.screenshot_monitoring_enabled = screenshotOverride.reason || "Screenshot capture paused by SuperAdmin.";
      const overrideVersion = new Date(screenshotOverride.updated_at || Date.now()).getTime();
      effectivePolicyVersion = `${effectivePolicyVersion}-screenshot-paused-${overrideVersion}`;
    }
  }

  const features = {};
  for (const key of [
    "heartbeat_enabled", "telemetry_enabled", "hardware_inventory_enabled", "software_inventory_enabled", "policy_sync_enabled",
    "activity_monitoring_enabled", "screenshot_monitoring_enabled", "browser_monitoring_enabled", "usb_monitoring_enabled",
    "location_tracking_enabled", "auto_incident_enabled",
  ]) {
    const consentRequired = ["activity_monitoring_enabled", "screenshot_monitoring_enabled", "browser_monitoring_enabled", "usb_monitoring_enabled", "location_tracking_enabled"].includes(key);
    features[key] = {
      enabled: !!effectiveConfig[key],
      source_policy: featureSources[key] || effectivePolicyName,
      consent_required: consentRequired,
      reason: effectiveConfig[key] ? null : (reasons[key] || "No endpoint policy assigned."),
    };
  }

  const policyJson = {
    device_uuid: device.device_uuid,
    policy_version: effectivePolicyVersion,
    policy_name: effectivePolicyName,
    consent_id: consentDoc?.consent_id || null,
    superadmin_overrides: screenshotOverride?.suspended ? {
      screenshot_monitoring_enabled: {
        suspended: true,
        reason: screenshotOverride.reason || "Screenshot capture paused by SuperAdmin.",
        updated_by: screenshotOverride.updated_by || null,
        updated_at: screenshotOverride.updated_at || null,
      },
    } : {},
    consent_version: consentDoc?.consent_version || null,
    ...effectiveConfig,
    features,
    reasons,
    generated_at: new Date().toISOString()
  };

  await endpointMonitoringRepository.saveEffectivePolicy(deviceUuid, policyJson);

  if (actorId) {
    await logPolicyAudit(actorId, 'effective_policy_generated', deviceUuid, { policy_name: effectivePolicyName });
  }

  return policyJson;
}

registerEndpointScreenshotControlRoutes(router, {
  requireSuperAdmin,
  generateEffectivePolicy,
  logPolicyAudit,
});

registerEndpointPolicyRoutes(router, {
  requireAdmin,
  requireAgent,
  normalizePolicyConfig,
  policyForClient,
  logPolicyAudit,
  generateEffectivePolicy,
});

router._test = { buildEndpointHealth };
module.exports = router;
