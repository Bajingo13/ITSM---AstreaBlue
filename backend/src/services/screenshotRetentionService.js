const cron = require("node-cron");
const db = require("../../config/db");
const { deletePrivateObject } = require("./r2StorageService");

async function purgeExpiredScreenshots() {
  let removed = 0;
  const expired = await db.query(
    `SELECT id, object_key
     FROM laptop_screenshots
     WHERE expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP
     ORDER BY expires_at
     LIMIT 100`
  );

  for (const screenshot of expired.rows) {
    try {
      if (screenshot.object_key) await deletePrivateObject(screenshot.object_key);
      const result = await db.query(
        `WITH deleted AS (
           DELETE FROM laptop_screenshots
           WHERE id=$1 AND expires_at <= CURRENT_TIMESTAMP
           RETURNING device_id
         )
         INSERT INTO laptop_activity_logs (device_id,event_type,app_name,window_title)
         SELECT device_id,'system_audit','Screenshot retention','Expired encrypted screenshot was permanently deleted.'
         FROM deleted
         RETURNING id`,
        [screenshot.id]
      );
      if (result.rowCount) removed += 1;
    } catch (error) {
      console.error(`[screenshot-retention:${screenshot.id}]`, error.message);
    }
  }
  return removed;
}

function startScreenshotRetentionJob() {
  return cron.schedule("17 */6 * * *", () => {
    purgeExpiredScreenshots()
      .then((count) => { if (count) console.log(`[screenshot-retention] removed=${count}`); })
      .catch((error) => console.error("[screenshot-retention]", error.message));
  });
}

module.exports = { purgeExpiredScreenshots, startScreenshotRetentionJob };
