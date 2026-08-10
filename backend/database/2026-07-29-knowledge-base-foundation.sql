-- Knowledge intelligence migrations extend this compatibility-era table.
CREATE TABLE IF NOT EXISTS knowledge_base (
  kb_id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  tags TEXT,
  symptoms TEXT,
  resolution TEXT,
  branch_id INTEGER REFERENCES branches(branch_id),
  created_by INTEGER REFERENCES users(user_id),
  related_ticket_id INTEGER REFERENCES tickets(id),
  views INTEGER DEFAULT 0,
  helpful_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
