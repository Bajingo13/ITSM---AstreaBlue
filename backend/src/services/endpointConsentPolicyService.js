const CONSENT_GATED_FEATURES = {
  activity_monitoring_enabled: {
    aliases: ["application_monitoring", "applications", "activity_monitoring", "app_usage", "window_title", "idle_time"],
    label: "Application/window activity",
  },
  screenshot_monitoring_enabled: {
    aliases: ["screenshot_monitoring", "screenshot"],
    label: "Screenshot Monitoring",
  },
  browser_monitoring_enabled: {
    aliases: ["web_monitoring", "website_monitoring", "network_domains", "browser"],
    label: "Browser/domain monitoring",
  },
  usb_monitoring_enabled: {
    aliases: ["usb_monitoring", "usb"],
    label: "USB & DLP monitoring",
  },
  location_tracking_enabled: {
    aliases: ["location_tracking"],
    label: "Location tracking",
  },
};

function normalizedPreferenceSet(preferences = []) {
  return new Set(
    (Array.isArray(preferences) ? preferences : [])
      .map((preference) => String(preference || "").trim().toLowerCase())
      .filter(Boolean)
  );
}

function consentAllows(preferences, aliases) {
  const selected = preferences instanceof Set ? preferences : normalizedPreferenceSet(preferences);
  return aliases.some((alias) => selected.has(alias));
}

function enforceConsentGates({
  config,
  consentDocument,
  featureSources = {},
  employeeAssigned = false,
}) {
  const effectiveConfig = { ...config };
  const reasons = {};
  const selected = normalizedPreferenceSet(consentDocument?.monitoring_preferences);

  for (const [featureKey, definition] of Object.entries(CONSENT_GATED_FEATURES)) {
    if (!consentDocument) {
      effectiveConfig[featureKey] = false;
      reasons[featureKey] = employeeAssigned
        ? "No active approved consent."
        : "Device is not assigned to an employee.";
      continue;
    }

    if (!consentAllows(selected, definition.aliases)) {
      effectiveConfig[featureKey] = false;
      reasons[featureKey] = `Employee consent excludes ${definition.label}.`;
      continue;
    }

    if (!effectiveConfig[featureKey]) {
      reasons[featureKey] = `Disabled by ${featureSources[featureKey] || "endpoint"} policy.`;
    }
  }

  return { effectiveConfig, reasons };
}

module.exports = {
  CONSENT_GATED_FEATURES,
  consentAllows,
  enforceConsentGates,
  normalizedPreferenceSet,
};
