const AUTOMATED_ONBOARDING_TASK_KEYS = new Set([
  "create_account",
  "complete_profile",
  "privacy_notice",
  "general_consent",
  "approve_consent",
  "assign_asset",
  "verify_endpoint",
]);

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

function isRecent(value, maximumAgeMs, now = Date.now()) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && now - timestamp <= maximumAgeMs;
}

function deriveOnboardingEvidence({ lifecycleCase, consent, assets, devices, now = Date.now() }) {
  const employeeLinked = Boolean(lifecycleCase?.employee_id);
  const accountActive = employeeLinked && lifecycleCase?.employee_is_active !== false;
  const profileComplete = accountActive && Boolean(
    String(lifecycleCase?.employee_name || "").trim()
    && String(lifecycleCase?.employee_email || "").trim()
    && lifecycleCase?.branch_id
    && lifecycleCase?.employee_role_id
  );
  const consentStatus = String(consent?.status || "").toLowerCase();
  const consentSigned = Boolean(consent?.submitted_at || consent?.signed_at)
    && ["signed", "pending_approval", "approved"].includes(consentStatus);
  const consentApproved = consentStatus === "approved" && consent?.active !== false;
  const privacyNoticeReviewed = Boolean(lifecycleCase?.privacy_notice_viewed_at) || consentSigned;
  const assetAssigned = Boolean(assets?.hardware_asset_count || assets?.linked_device_asset_count);
  const verifiedDevice = (devices || []).find((device) => {
    const heartbeatHealthy = isRecent(device.last_seen_at, FIVE_MINUTES_MS, now);
    const hardwareHealthy = isRecent(device.last_hardware_inventory_at, TWENTY_FOUR_HOURS_MS, now);
    const softwareHealthy = isRecent(device.last_software_inventory_at, TWENTY_FOUR_HOURS_MS, now);
    const policyDownloaded = Boolean(device.policy_generated_at && device.last_policy_downloaded_at)
      && new Date(device.last_policy_downloaded_at).getTime() >= new Date(device.policy_generated_at).getTime();
    return heartbeatHealthy && hardwareHealthy && softwareHealthy && policyDownloaded;
  });

  return {
    create_account: {
      complete: employeeLinked,
      note: employeeLinked
        ? "Existing or invited AstreaBlue employee account is linked to this case."
        : "No AstreaBlue employee account is linked yet.",
      evidence: { employeeId: lifecycleCase?.employee_id || null },
    },
    complete_profile: {
      complete: profileComplete,
      note: profileComplete
        ? "The active employee account has the required identity, login, role, and branch fields."
        : "Waiting for an active account with complete identity, login, role, and branch fields.",
      evidence: { accountActive, profileComplete },
    },
    privacy_notice: {
      complete: privacyNoticeReviewed,
      note: privacyNoticeReviewed
        ? "Privacy-notice review is recorded by the onboarding or signed-consent workflow."
        : "No privacy-notice review evidence is recorded.",
      evidence: { privacyNoticeViewedAt: lifecycleCase?.privacy_notice_viewed_at || null },
    },
    general_consent: {
      complete: consentSigned,
      note: consentSigned
        ? "A submitted general monitoring consent is recorded for the employee."
        : "Waiting for the employee to submit a general monitoring consent.",
      evidence: { consentId: consent?.consent_id || null, consentStatus: consent?.status || null },
    },
    approve_consent: {
      complete: consentApproved,
      note: consentApproved
        ? "The employee's general monitoring consent is approved and active."
        : "Waiting for an authorized administrator to approve the submitted general consent.",
      evidence: { consentId: consent?.consent_id || null, consentStatus: consent?.status || null },
    },
    assign_asset: {
      complete: assetAssigned,
      note: assetAssigned
        ? "A managed hardware asset is assigned to the employee."
        : "No managed hardware asset is currently assigned to the employee.",
      evidence: {
        hardwareAssetCount: Number(assets?.hardware_asset_count || 0),
        linkedDeviceAssetCount: Number(assets?.linked_device_asset_count || 0),
      },
    },
    verify_endpoint: {
      complete: Boolean(verifiedDevice),
      note: verifiedDevice
        ? `Endpoint ${verifiedDevice.hostname || verifiedDevice.device_uuid} has a recent heartbeat, inventories, and policy download.`
        : "Waiting for one assigned endpoint to report a recent heartbeat, hardware inventory, software inventory, and current policy download.",
      evidence: verifiedDevice ? {
        deviceId: verifiedDevice.device_id,
        deviceUuid: verifiedDevice.device_uuid,
        hostname: verifiedDevice.hostname,
        lastSeenAt: verifiedDevice.last_seen_at,
        hardwareInventoryAt: verifiedDevice.last_hardware_inventory_at,
        softwareInventoryAt: verifiedDevice.last_software_inventory_at,
        policyDownloadedAt: verifiedDevice.last_policy_downloaded_at,
      } : { verifiedDevice: false },
    },
  };
}

async function loadOnboardingEvidence(queryable, caseId) {
  const caseResult = await queryable.query(
    `SELECT lc.lifecycle_case_id,lc.lifecycle_type,lc.status,lc.employee_id,lc.branch_id,
            u.full_name employee_name,u.email employee_email,u.role_id employee_role_id,
            u.is_active employee_is_active,u.privacy_notice_viewed_at
       FROM employee_lifecycle_cases lc
       LEFT JOIN users u ON u.user_id=lc.employee_id
      WHERE lc.lifecycle_case_id=$1`,
    [caseId]
  );
  const lifecycleCase = caseResult.rows[0];
  if (!lifecycleCase || lifecycleCase.lifecycle_type !== "Onboarding") return null;

  const employeeId = lifecycleCase.employee_id;
  if (!employeeId) {
    return { lifecycleCase, consent: null, assets: null, devices: [] };
  }

  const consentResult = await queryable.query(
      `SELECT consent_id,status,active,signed_at,submitted_at,approved_at
         FROM consent_documents
        WHERE employee_id=$1 AND device_uuid IS NULL
          AND status IN ('signed','pending_approval','approved')
        ORDER BY approved_at DESC NULLS LAST,submitted_at DESC NULLS LAST,signed_at DESC NULLS LAST,created_at DESC
        LIMIT 1`,
      [employeeId]
    );
  const assetResult = await queryable.query(
      `SELECT
         (SELECT COUNT(*)::int FROM hardware_assets WHERE assigned_to=$1) hardware_asset_count,
         (SELECT COUNT(*)::int FROM monitored_devices WHERE assigned_user_id=$1 AND asset_id IS NOT NULL) linked_device_asset_count`,
      [employeeId]
    );
  const deviceResult = await queryable.query(
      `SELECT d.device_id,d.device_uuid,d.hostname,d.asset_id,d.last_seen_at,
              (SELECT MAX(hi.scanned_at) FROM endpoint_hardware_inventory hi WHERE hi.device_id=d.device_id) last_hardware_inventory_at,
              (SELECT MAX(si.last_seen_at) FROM endpoint_software_inventory si WHERE si.device_id=d.device_id) last_software_inventory_at,
              ep.generated_at policy_generated_at,
              (SELECT MAX(pa.created_at) FROM endpoint_policy_audit_logs pa
                WHERE pa.target_id=d.device_uuid::text AND pa.action='policy_downloaded') last_policy_downloaded_at
         FROM monitored_devices d
         LEFT JOIN endpoint_effective_policies ep ON ep.device_uuid=d.device_uuid
        WHERE d.assigned_user_id=$1`,
      [employeeId]
    );

  return {
    lifecycleCase,
    consent: consentResult.rows[0] || null,
    assets: assetResult.rows[0] || null,
    devices: deviceResult.rows,
  };
}

async function reconcileOnboardingCase(queryable, caseId) {
  const source = await loadOnboardingEvidence(queryable, caseId);
  if (!source || ["Completed", "Cancelled"].includes(source.lifecycleCase.status)) {
    return { changed: 0, evidence: null };
  }
  const evidence = deriveOnboardingEvidence(source);
  const tasksResult = await queryable.query(
    `SELECT lifecycle_task_id,task_key,status,completion_notes,automation_result
       FROM employee_lifecycle_tasks
      WHERE lifecycle_case_id=$1 AND task_key=ANY($2::text[])
      ORDER BY sort_order`,
    [caseId, Array.from(AUTOMATED_ONBOARDING_TASK_KEYS)]
  );

  let changed = 0;
  for (const task of tasksResult.rows) {
    const taskEvidence = evidence[task.task_key];
    if (!taskEvidence) continue;
    const nextStatus = taskEvidence.complete ? "Completed" : "Pending";
    const wasAutomatic = task.automation_result?.source === "onboarding_reconciliation";
    if (task.status === nextStatus && wasAutomatic && task.completion_notes === taskEvidence.note) continue;
    if (task.status === "Completed" && !wasAutomatic && task.task_key === "create_account") continue;

    const automationResult = {
      action: taskEvidence.complete ? "evidence_verified" : "evidence_pending",
      source: "onboarding_reconciliation",
      automatic: true,
      evidence: taskEvidence.evidence,
    };
    await queryable.query(
      `UPDATE employee_lifecycle_tasks
          SET status=$1::text,completed_by=NULL,
              completed_at=CASE WHEN $1::text='Completed' THEN COALESCE(completed_at,CURRENT_TIMESTAMP) ELSE NULL END,
              completion_notes=$2,automation_result=$3::jsonb,
              automation_completed_at=CASE WHEN $1::text='Completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
              updated_at=CURRENT_TIMESTAMP
        WHERE lifecycle_task_id=$4`,
      [nextStatus, taskEvidence.note, JSON.stringify(automationResult), task.lifecycle_task_id]
    );
    changed += 1;
  }

  if (changed) {
    await queryable.query(
      `UPDATE employee_lifecycle_cases SET updated_at=CURRENT_TIMESTAMP WHERE lifecycle_case_id=$1`,
      [caseId]
    );
    await queryable.query(
      `INSERT INTO employee_lifecycle_history
         (lifecycle_case_id,event_type,message,metadata,changed_by)
       VALUES($1,'onboarding_reconciled',$2,$3::jsonb,NULL)`,
      [caseId, `Onboarding evidence synchronized for ${changed} checklist item(s).`, JSON.stringify({ changed })]
    );
  }
  return { changed, evidence };
}

module.exports = {
  AUTOMATED_ONBOARDING_TASK_KEYS,
  deriveOnboardingEvidence,
  reconcileOnboardingCase,
};
