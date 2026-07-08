const db = require("../../config/db");

async function createNotification({
  userId,
  title,
  message,
  type = "info",
  ticketId = null,
  metadata = {},
  dedupeKey = null,
}) {
  if (!userId) return null;

  const payload = {
    ...metadata,
    ...(ticketId ? { ticketId: Number(ticketId) } : {}),
    ...(dedupeKey ? { dedupeKey } : {}),
  };

  const result = await db.query(
    `
    INSERT INTO notifications
      (user_id, title, message, type, related_ticket_id, metadata)
    SELECT $1, $2, $3, $4, $5, $6::jsonb
    WHERE $7::text IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM notifications
         WHERE user_id = $1
           AND metadata->>'dedupeKey' = $7
       )
    RETURNING *
    `,
    [userId, title, message, type, ticketId, JSON.stringify(payload), dedupeKey]
  );

  return result.rows[0] || null;
}

module.exports = { createNotification };
