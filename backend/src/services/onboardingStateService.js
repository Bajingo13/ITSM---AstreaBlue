function normalizeUserId(value) {
  const userId = Number(value);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

async function findActiveOnboardingCase(queryable, employeeId) {
  const userId = normalizeUserId(employeeId);
  if (!userId) return null;
  const result = await queryable.query(
    `SELECT lifecycle_case_id,case_number,status
       FROM employee_lifecycle_cases
      WHERE employee_id=$1
        AND lifecycle_type='Onboarding'
        AND status NOT IN ('Completed','Cancelled')
        AND deleted_at IS NULL
      ORDER BY created_at DESC,lifecycle_case_id DESC
      LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function updateUserOnboardingState(queryable, {
  employeeId,
  consentId = null,
  changedBy = null,
  status,
  required,
  completed = false,
  reason,
}) {
  const userId = normalizeUserId(employeeId);
  if (!userId) return { changed: false, user: null };
  const currentResult = await queryable.query(
    `SELECT onboarding_status,onboarding_required,onboarding_consent_id
       FROM users WHERE user_id=$1`,
    [userId]
  );
  const current = currentResult.rows[0];
  if (!current) return { changed: false, user: null };
  const normalizedConsentId = consentId ? Number(consentId) : null;
  const unchanged = current.onboarding_status === status
    && Boolean(current.onboarding_required) === Boolean(required)
    && (!normalizedConsentId || Number(current.onboarding_consent_id) === normalizedConsentId);
  if (unchanged) return { changed: false, user: current };

  const updated = await queryable.query(
    `UPDATE users
        SET onboarding_status=$1,
            onboarding_required=$2,
            onboarding_completed_at=CASE
              WHEN $3::boolean THEN COALESCE(onboarding_completed_at,CURRENT_TIMESTAMP)
              ELSE NULL
            END,
            onboarding_consent_id=COALESCE($4,onboarding_consent_id)
      WHERE user_id=$5
      RETURNING onboarding_status,onboarding_required,onboarding_completed_at,onboarding_consent_id`,
    [status, Boolean(required), Boolean(completed), normalizedConsentId, userId]
  );
  await queryable.query(
    `INSERT INTO user_onboarding_history
       (user_id,previous_status,new_status,consent_id,changed_by,reason)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [userId, current.onboarding_status || null, status, normalizedConsentId, normalizeUserId(changedBy), reason]
  );
  return { changed: true, user: updated.rows[0] };
}

async function applyApprovedConsentOnboardingState(queryable, {
  employeeId,
  consentId,
  changedBy = null,
  reconciliation = false,
}) {
  const activeCase = await findActiveOnboardingCase(queryable, employeeId);
  if (activeCase) {
    const result = await updateUserOnboardingState(queryable, {
      employeeId,
      consentId,
      changedBy,
      status: "Consent Approved",
      required: true,
      completed: false,
      reason: reconciliation
        ? `Approved consent reconciled; onboarding case ${activeCase.case_number} still requires endpoint and final verification.`
        : `Consent approved; onboarding case ${activeCase.case_number} remains active until authorized final verification.`,
    });
    return { ...result, lifecycleManaged: true, activeCase };
  }

  const result = await updateUserOnboardingState(queryable, {
    employeeId,
    consentId,
    changedBy,
    status: "Completed",
    required: false,
    completed: true,
    reason: reconciliation
      ? "Reconciled from active approved consent during status refresh."
      : "Consent approved; legacy consent-only onboarding completed.",
  });
  return { ...result, lifecycleManaged: false, activeCase: null };
}

async function completeLifecycleOnboarding(queryable, {
  lifecycleCaseId,
  employeeId,
  changedBy,
}) {
  const userId = normalizeUserId(employeeId);
  if (!userId) {
    throw Object.assign(new Error("The onboarding case must be linked to an employee account before completion."), { status: 409 });
  }
  const consent = await queryable.query(
    `SELECT consent_id
       FROM consent_documents
      WHERE employee_id=$1 AND status='approved' AND active=true
      ORDER BY approved_at DESC NULLS LAST,created_at DESC
      LIMIT 1`,
    [userId]
  );
  if (!consent.rows.length) {
    throw Object.assign(new Error("Approved active consent is required before onboarding completion."), { status: 409 });
  }
  return updateUserOnboardingState(queryable, {
    employeeId: userId,
    consentId: consent.rows[0].consent_id,
    changedBy,
    status: "Completed",
    required: false,
    completed: true,
    reason: `Authorized final verification completed for lifecycle case ${lifecycleCaseId}.`,
  });
}

async function canAssignEmployeeDuringOnboarding(queryable, employeeId) {
  return Boolean(await findActiveOnboardingCase(queryable, employeeId));
}

module.exports = {
  findActiveOnboardingCase,
  applyApprovedConsentOnboardingState,
  completeLifecycleOnboarding,
  canAssignEmployeeDuringOnboarding,
};
