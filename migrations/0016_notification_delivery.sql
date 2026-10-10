-- Durable channel delivery for payout and retainer notifications.
CREATE TABLE IF NOT EXISTS notification_delivery_outbox (
 id BIGSERIAL PRIMARY KEY,
 event_key TEXT NOT NULL,
 recipient_id INTEGER NOT NULL REFERENCES users(id),
 message TEXT NOT NULL,
 type TEXT NOT NULL,
 link TEXT NOT NULL,
 email_preference TEXT NOT NULL,
 notification_id INTEGER REFERENCES notifications(id),
 target_project_id INTEGER REFERENCES projects(id),
 email_done BOOLEAN NOT NULL DEFAULT FALSE,
 push_done BOOLEAN NOT NULL DEFAULT FALSE,
 accepted_push_tokens JSONB NOT NULL DEFAULT '[]',
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(event_key,recipient_id)
);
CREATE INDEX IF NOT EXISTS notification_delivery_pending ON notification_delivery_outbox(next_attempt_at) WHERE NOT email_done OR NOT push_done;
