CREATE TABLE IF NOT EXISTS ticket_history (
    history_id SERIAL PRIMARY KEY,
    ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
    changed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    action VARCHAR(255) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ticket_comments (
    comment_id SERIAL PRIMARY KEY,
    ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
    comment_text TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sla_policies (
    policy_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    priority VARCHAR(50) NOT NULL,
    category_id UUID,
    response_target_mins INTEGER NOT NULL,
    resolution_target_mins INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO sla_policies (name, priority, response_target_mins, resolution_target_mins, is_active)
SELECT 'P1 Critical', 'P1-Critical', 15, 120, true
WHERE NOT EXISTS (SELECT 1 FROM sla_policies WHERE priority = 'P1-Critical');

INSERT INTO sla_policies (name, priority, response_target_mins, resolution_target_mins, is_active)
SELECT 'P2 High', 'P2-High', 30, 240, true
WHERE NOT EXISTS (SELECT 1 FROM sla_policies WHERE priority = 'P2-High');

INSERT INTO sla_policies (name, priority, response_target_mins, resolution_target_mins, is_active)
SELECT 'P3 Medium', 'P3-Medium', 120, 480, true
WHERE NOT EXISTS (SELECT 1 FROM sla_policies WHERE priority = 'P3-Medium');

INSERT INTO sla_policies (name, priority, response_target_mins, resolution_target_mins, is_active)
SELECT 'P4 Low', 'P4-Low', 240, 1440, true
WHERE NOT EXISTS (SELECT 1 FROM sla_policies WHERE priority = 'P4-Low');
