const test = require("node:test");
const assert = require("node:assert/strict");
const {
  enforceConsentGates,
} = require("../src/services/endpointConsentPolicyService");

const optionalFeaturesEnabled = {
  activity_monitoring_enabled: true,
  screenshot_monitoring_enabled: true,
  browser_monitoring_enabled: true,
  usb_monitoring_enabled: true,
  location_tracking_enabled: true,
  heartbeat_enabled: true,
  hardware_inventory_enabled: true,
};

test("unchecked optional consent features remain disabled without affecting baseline agent features", () => {
  const result = enforceConsentGates({
    config: optionalFeaturesEnabled,
    consentDocument: {
      monitoring_preferences: ["application_monitoring"],
    },
    employeeAssigned: true,
  });

  assert.equal(result.effectiveConfig.activity_monitoring_enabled, true);
  assert.equal(result.effectiveConfig.screenshot_monitoring_enabled, false);
  assert.equal(result.effectiveConfig.browser_monitoring_enabled, false);
  assert.equal(result.effectiveConfig.usb_monitoring_enabled, false);
  assert.equal(result.effectiveConfig.location_tracking_enabled, false);
  assert.equal(result.effectiveConfig.heartbeat_enabled, true);
  assert.equal(result.effectiveConfig.hardware_inventory_enabled, true);
  assert.match(result.reasons.usb_monitoring_enabled, /consent excludes USB & DLP/i);
});

test("all approved aliases enable their matching optional features", () => {
  const result = enforceConsentGates({
    config: optionalFeaturesEnabled,
    consentDocument: {
      monitoring_preferences: [
        "window_title",
        "screenshot",
        "network_domains",
        "usb",
        "location_tracking",
      ],
    },
    employeeAssigned: true,
  });

  assert.equal(result.effectiveConfig.activity_monitoring_enabled, true);
  assert.equal(result.effectiveConfig.screenshot_monitoring_enabled, true);
  assert.equal(result.effectiveConfig.browser_monitoring_enabled, true);
  assert.equal(result.effectiveConfig.usb_monitoring_enabled, true);
  assert.equal(result.effectiveConfig.location_tracking_enabled, true);
  assert.deepEqual(result.reasons, {});
});

test("an endpoint policy can disable an allowed feature with an accurate reason", () => {
  const result = enforceConsentGates({
    config: {
      ...optionalFeaturesEnabled,
      usb_monitoring_enabled: false,
    },
    consentDocument: {
      monitoring_preferences: ["application_monitoring", "screenshot", "network_domains", "usb", "location_tracking"],
    },
    featureSources: {
      usb_monitoring_enabled: "Device",
    },
    employeeAssigned: true,
  });

  assert.equal(result.effectiveConfig.usb_monitoring_enabled, false);
  assert.equal(result.reasons.usb_monitoring_enabled, "Disabled by Device policy.");
});

test("missing approved consent disables only consent-gated features", () => {
  const result = enforceConsentGates({
    config: optionalFeaturesEnabled,
    consentDocument: null,
    employeeAssigned: true,
  });

  assert.equal(result.effectiveConfig.activity_monitoring_enabled, false);
  assert.equal(result.effectiveConfig.screenshot_monitoring_enabled, false);
  assert.equal(result.effectiveConfig.browser_monitoring_enabled, false);
  assert.equal(result.effectiveConfig.usb_monitoring_enabled, false);
  assert.equal(result.effectiveConfig.location_tracking_enabled, false);
  assert.equal(result.effectiveConfig.heartbeat_enabled, true);
  assert.equal(result.effectiveConfig.hardware_inventory_enabled, true);
});
