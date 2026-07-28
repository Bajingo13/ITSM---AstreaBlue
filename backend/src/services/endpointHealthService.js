function minutesSince(value) {
  if (!value) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
}

function healthItem(label, timestamp, warningMinutes, criticalMinutes, missingStatus = "Warning") {
  const ageMinutes = minutesSince(timestamp);
  if (ageMinutes === null) {
    return {
      label,
      status: missingStatus,
      last_seen_at: null,
      age_minutes: null,
      message: `${label} has not reported yet.`,
    };
  }
  if (criticalMinutes && ageMinutes > criticalMinutes) {
    return {
      label,
      status: "Critical",
      last_seen_at: timestamp,
      age_minutes: ageMinutes,
      message: `${label} is stale for ${ageMinutes} minutes.`,
    };
  }
  if (warningMinutes && ageMinutes > warningMinutes) {
    return {
      label,
      status: "Warning",
      last_seen_at: timestamp,
      age_minutes: ageMinutes,
      message: `${label} is stale for ${ageMinutes} minutes.`,
    };
  }
  return {
    label,
    status: "Healthy",
    last_seen_at: timestamp,
    age_minutes: ageMinutes,
    message: `${label} is current.`,
  };
}

function consentHealth(status) {
  const normalized = String(status || "").toLowerCase();
  if (["signed", "approved", "granted", "consented"].includes(normalized)) {
    return { label: "Consent", status: "Healthy", consent_status: status, message: "Consent is active." };
  }
  if (["pending", "pending_employee", "pending_approval", ""].includes(normalized)) {
    return {
      label: "Consent",
      status: "Information",
      consent_status: status || "Pending",
      message: "Consent is pending.",
    };
  }
  return {
    label: "Consent",
    status: "Warning",
    consent_status: status || "Pending",
    message: "Consent needs review.",
  };
}

function buildEndpointHealth(row) {
  const policyJson = row.policy_json || {};
  const heartbeat = healthItem("Heartbeat", row.last_seen_at, 2, 5, "Offline");
  const activityFeature = policyJson.features?.activity_monitoring_enabled;
  const activityEnabled = activityFeature?.enabled === true || policyJson.activity_monitoring_enabled === true;
  const disabledActivityReason =
    activityFeature?.reason ||
    policyJson.reasons?.activity_monitoring_enabled ||
    "Activity monitoring is not enabled by the effective policy.";
  const activity = activityEnabled
    ? healthItem("Activity", row.last_activity_at, 10, null, "Warning")
    : {
        label: "Activity",
        status: "Disabled",
        last_seen_at: row.last_activity_at || null,
        age_minutes: null,
        message: disabledActivityReason,
      };
  const idleDetection = activityEnabled
    ? healthItem("Idle Detection", row.last_idle_detection_at || row.last_activity_at, 10, null, "Warning")
    : {
        label: "Idle Detection",
        status: "Disabled",
        last_seen_at: row.last_idle_detection_at || row.last_activity_at || null,
        age_minutes: null,
        message: disabledActivityReason,
      };
  const hardwareInventory = healthItem("Hardware Inventory", row.last_hardware_inventory_at, 24 * 60, null, "Warning");
  const softwareInventory = healthItem("Software Inventory", row.last_software_inventory_at, 24 * 60, null, "Warning");
  const policy = healthItem("Policy Sync", row.last_policy_sync_at, 24 * 60, null, "Warning");
  policy.current_policy_version = row.current_policy_version || policyJson.policy_version || "Unknown";
  policy.generated_at = row.policy_generated_at || null;
  policy.policy_name = policyJson.policy_name || "Unknown";
  policy.feature_permissions = policyJson.features || {};
  policy.disabled_reasons = policyJson.reasons || {};
  const consent = consentHealth(row.consent_approved ? "approved" : row.consent_status);

  const components = [heartbeat, activity, idleDetection, hardwareInventory, softwareInventory, policy, consent];
  let overall = "Healthy";
  if (heartbeat.status === "Offline") overall = "Offline";
  else if (components.some((item) => item.status === "Critical")) overall = "Critical";
  else if (components.some((item) => item.status === "Warning")) overall = "Warning";

  const failureReasons = components
    .filter((item) => ["Offline", "Critical", "Warning", "Information"].includes(item.status))
    .map((item) => ({
      area: item.label,
      severity: item.status === "Information" ? "Info" : item.status,
      message: item.message,
    }));

  const recommendedActions = [];
  if (heartbeat.status === "Offline" || heartbeat.status === "Critical") {
    recommendedActions.push("Verify the endpoint agent is running and can reach the Railway API.");
  }
  if (activity.status === "Warning") {
    recommendedActions.push("Confirm activity telemetry is enabled and the user session is active.");
  }
  if (hardwareInventory.status === "Warning") {
    recommendedActions.push("Wait for the next inventory cycle or restart the agent after local validation.");
  }
  if (softwareInventory.status === "Warning") {
    recommendedActions.push("Confirm the 24-hour software inventory task completed successfully.");
  }
  if (policy.status === "Warning") {
    recommendedActions.push("Regenerate the effective policy and confirm the agent downloads it.");
  }
  if (consent.status === "Information") {
    recommendedActions.push("Complete employee consent before enabling sensitive monitoring.");
  }
  if (!recommendedActions.length) recommendedActions.push("No corrective action required.");

  const timeline = [
    { event_type: "Heartbeat", occurred_at: row.last_seen_at, status: heartbeat.status },
    { event_type: "Activity", occurred_at: row.last_activity_at, status: activity.status },
    {
      event_type: "Idle Detection",
      occurred_at: row.last_idle_detection_at || row.last_activity_at,
      status: idleDetection.status,
    },
    {
      event_type: "Hardware Inventory",
      occurred_at: row.last_hardware_inventory_at,
      status: hardwareInventory.status,
    },
    {
      event_type: "Software Inventory",
      occurred_at: row.last_software_inventory_at,
      status: softwareInventory.status,
    },
    { event_type: "Policy Sync", occurred_at: row.last_policy_sync_at, status: policy.status },
  ];

  // Monitoring is active only when user-session activity is both enabled and fresh.
  const monitoringActive = Boolean(
    activityEnabled &&
      heartbeat.status === "Healthy" &&
      policy.status === "Healthy" &&
      activity.status === "Healthy" &&
      idleDetection.status === "Healthy"
  );
  const checklist = [
    { step: "Asset Linked", status: row.asset_id ? "Complete" : "Pending" },
    { step: "Employee Assigned", status: row.assigned_user_id ? "Complete" : "Pending" },
    { step: "Consent Requested", status: row.consent_id ? "Complete" : "Pending" },
    { step: "Consent Submitted", status: row.consent_submitted ? "Complete" : "Pending" },
    { step: "Consent Approved", status: row.consent_approved ? "Complete" : "Pending" },
    { step: "Effective Policy Generated", status: row.policy_generated_at ? "Complete" : "Pending" },
    { step: "Agent Policy Downloaded", status: row.last_policy_sync_at ? "Complete" : "Pending" },
    {
      step: "Monitoring Active",
      status: monitoringActive ? "Complete" : activityEnabled ? "Pending" : "Not Applicable",
    },
  ];

  return {
    device_uuid: row.device_uuid,
    device_id: row.device_id,
    hostname: row.hostname,
    device_name: row.device_name,
    assigned_employee: row.assigned_employee,
    branch_name: row.branch_name,
    department: row.department,
    overall_health: overall,
    endpoint_status: overall,
    heartbeat,
    activity,
    idle_detection: idleDetection,
    hardware_inventory: hardwareInventory,
    software_inventory: softwareInventory,
    policy,
    consent,
    checklist,
    agent_sync: {
      last_communication_at: row.last_seen_at,
      last_api_response: row.last_api_response || null,
      last_error: row.last_error || null,
      last_sync_time: row.last_policy_sync_at || row.last_seen_at || null,
    },
    timeline,
    failure_reasons: failureReasons,
    recommended_actions: recommendedActions,
    debug: {
      device_uuid: row.device_uuid,
      asset_id: row.asset_id,
      employee: row.assigned_employee,
      branch: row.branch_name,
      department: row.department,
      policy_version: row.current_policy_version || policyJson.policy_version || "Unknown",
      consent_version: row.consent_version || "Unknown",
      last_api_response: row.last_api_response || null,
      last_error: row.last_error || null,
      last_sync_time: row.last_policy_sync_at || row.last_seen_at || null,
      agent_version: row.agent_version,
      os_build: row.os_build,
      windows_version: row.windows_version,
      feature_permissions: policyJson.features || {},
      disabled_reasons: policyJson.reasons || {},
    },
  };
}

module.exports = {
  buildEndpointHealth,
  consentHealth,
  healthItem,
  minutesSince,
};
