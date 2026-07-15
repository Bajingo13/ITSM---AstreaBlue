CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'info',
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS related_ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_notifications_related_ticket
  ON notifications (related_ticket_id);

CREATE INDEX IF NOT EXISTS idx_notifications_dedupe_key
  ON notifications ((metadata->>'dedupeKey'));

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS sla_due_soon_notified_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS sla_breach_notification_sent_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS sla_breach_email_sent_at TIMESTAMP;
