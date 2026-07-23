-- PRD-006: notification preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  email_project_invitations BOOLEAN NOT NULL DEFAULT true,
  email_new_offers BOOLEAN NOT NULL DEFAULT true,
  email_counter_offers BOOLEAN NOT NULL DEFAULT true,
  email_messages BOOLEAN NOT NULL DEFAULT true,
  email_stage_updates BOOLEAN NOT NULL DEFAULT true,
  email_payment_updates BOOLEAN NOT NULL DEFAULT true,
  email_review_requests BOOLEAN NOT NULL DEFAULT true,
  email_product_updates BOOLEAN NOT NULL DEFAULT false,
  updated_at TEXT NOT NULL DEFAULT NOW()::TEXT
);
