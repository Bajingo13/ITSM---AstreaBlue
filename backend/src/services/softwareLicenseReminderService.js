const cron = require("node-cron");
const db = require("../../config/db");
const { createNotification } = require("./notificationService");

const REMINDER_DAYS = [30, 14, 7, 1, 0];

function reminderMessage(license, daysRemaining) {
  if (daysRemaining === 0) return `${license.license_name} expires today.`;
  return `${license.license_name} expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}.`;
}

async function runSoftwareLicenseReminders(queryable = db) {
  const licenses = await queryable.query(
    `SELECT sl.license_id,sl.license_name,sl.expiry_date,sl.branch_id,b.branch_name,
            (sl.expiry_date-CURRENT_DATE)::int AS days_remaining
     FROM software_licenses sl
     LEFT JOIN branches b ON b.branch_id=sl.branch_id
     WHERE sl.expiry_date IS NOT NULL
       AND (sl.expiry_date-CURRENT_DATE)::int=ANY($1::int[])`,
    [REMINDER_DAYS]
  );

  for (const license of licenses.rows) {
    const recipients = await queryable.query(
      `SELECT DISTINCT u.user_id
       FROM users u
       LEFT JOIN system_roles r ON r.role_id=u.role_id
       WHERE LOWER(REPLACE(REPLACE(COALESCE(r.role_name,''),'_',''),' ',''))='superadmin'
          OR (
            LOWER(REPLACE(REPLACE(COALESCE(r.role_name,''),'_',''),' ',''))='admin'
            AND u.branch_id=$1
          )`,
      [license.branch_id]
    );
    for (const recipient of recipients.rows) {
      await createNotification({
        userId: recipient.user_id,
        title: license.days_remaining === 0 ? "Software License Expires Today" : "Software License Renewal Reminder",
        message: `${reminderMessage(license, Number(license.days_remaining))}${license.branch_name ? ` Branch: ${license.branch_name}.` : ""}`,
        type: "warning",
        relatedEntityType: "software_license",
        relatedEntityId: license.license_id,
        metadata: { event: "software_license_expiry", daysRemaining: Number(license.days_remaining) },
        dedupeKey: `software-license-expiry:${license.license_id}:${String(license.expiry_date).slice(0, 10)}:${license.days_remaining}`,
        queryable,
      });
    }
  }
  return licenses.rows.length;
}

function startSoftwareLicenseReminderJob() {
  return cron.schedule("0 8 * * *", () => {
    runSoftwareLicenseReminders().catch((error) => {
      console.error("Software license reminder job failed:", error.message);
    });
  }, { timezone: "Asia/Manila" });
}

module.exports = {
  REMINDER_DAYS,
  reminderMessage,
  runSoftwareLicenseReminders,
  startSoftwareLicenseReminderJob,
};
