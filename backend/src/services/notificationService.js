const db = require("../../config/db");

async function createNotification({
  userId,
  title,
  message,
  type = "info",
  ticketId = null,
  relatedEntityType = null,
  relatedEntityId = null,
  metadata = {},
  dedupeKey = null,
}) {
  if (!userId) return null;

  await db.query(`
    ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS related_entity_type VARCHAR(80),
    ADD COLUMN IF NOT EXISTS related_entity_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  `).catch(() => {});

  const payload = {
    ...metadata,
    ...(ticketId ? { ticketId: Number(ticketId) } : {}),
    ...(relatedEntityType ? { relatedEntityType } : {}),
    ...(relatedEntityId ? { relatedEntityId } : {}),
    ...(dedupeKey ? { dedupeKey } : {}),
  };

  const result = await db.query(
    `
    INSERT INTO notifications
      (user_id, title, message, type, related_ticket_id, related_entity_type, related_entity_id, metadata)
    SELECT $1, $2, $3, $4, $5, $6, $7, $8::jsonb
    WHERE $9::text IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM notifications
         WHERE user_id = $1
           AND metadata->>'dedupeKey' = $9
       )
    RETURNING *
    `,
    [userId, title, message, type, ticketId, relatedEntityType, relatedEntityId ? String(relatedEntityId) : null, JSON.stringify(payload), dedupeKey]
  );

  return result.rows[0] || null;
}

module.exports = { createNotification };
