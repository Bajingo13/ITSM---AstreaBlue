const { createNotification } = require("./notificationService");
const endpointMonitoringRepository = require("../repositories/endpointMonitoringRepository");

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
  ).catch((error) => console.error("[endpoint-consent-request:audit]", error.message));

  await createNotification({
    userId: device.assigned_user_id,
    title: "Monitoring agreement required",
    message: "Complete the general monitoring agreement once to cover your assigned company devices.",
    type: "privacy_consent",
    metadata: { consentId: created.consent_id, consentScope: "general" },
    dedupeKey: `general-consent-request-${device.assigned_user_id}`,
  }).catch((error) => console.error("[endpoint-consent-request:notification]", error.message));

  return created;
}

module.exports = { ensureConsentRequestForDevice };
