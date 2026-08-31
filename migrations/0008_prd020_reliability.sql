-- ============================================================
-- Migration 0008: PRD-020 Reliability — WS-A + WS-B
-- ============================================================

-- WS-A: Stripe stale-event recovery — new columns on stripe_events
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS processing_started_at TEXT;
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS last_attempt_at TEXT;
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5;
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS raw_payload TEXT;

-- WS-B: Schema migrations tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum TEXT
);

-- Record existing migrations as applied (idempotent)
INSERT INTO schema_migrations (migration_name) VALUES
  ('0001_accreditation_system'),
  ('0002_notification_prefs'),
  ('0003_prd007_payment_ledger'),
  ('0004_prd008_operations'),
  ('0005_prd012_retainer_reimagined'),
  ('0006_prd018_security'),
  ('0007_prd019_auth_sessions'),
  ('0008_prd020_reliability')
ON CONFLICT DO NOTHING;

-- PRD-020 WS-D + WS-E migration
-- WS-D: upload_objects — durable record for every uploaded file
CREATE TABLE IF NOT EXISTS upload_objects (
  id SERIAL PRIMARY KEY,
  owner_user_id INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  resource_type TEXT NOT NULL,        -- portfolio | profile | project | deliverable | message
  resource_id INTEGER,                -- nullable — set after resource is created
  mime_type TEXT NOT NULL,
  size_bytes INTEGER,
  original_filename TEXT,             -- stored as metadata only (never used as path)
  status TEXT NOT NULL DEFAULT 'pending', -- pending | uploaded | ready | deleted
  upload_intent_expires_at TEXT NOT NULL, -- when presigned PUT URL expires
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT NOW()::text
);
CREATE INDEX IF NOT EXISTS idx_upload_objects_owner ON upload_objects(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_upload_objects_resource ON upload_objects(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_upload_objects_status ON upload_objects(status);

-- WS-E: verification_codes — DB-backed, restart-safe
CREATE TABLE IF NOT EXISTS verification_codes (
  id SERIAL PRIMARY KEY,
  purpose TEXT NOT NULL,              -- email_verification | sms_verification
  destination_hash TEXT NOT NULL,     -- SHA-256(lowercased destination)
  code_hash TEXT NOT NULL,            -- SHA-256(code + destination + purpose)
  created_at TEXT NOT NULL DEFAULT NOW()::text,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  invalidated_at TEXT                 -- set when resend invalidates this code
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_verification_active ON verification_codes(destination_hash, purpose)
  WHERE used_at IS NULL AND invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_verification_dest ON verification_codes(destination_hash, purpose);

-- PRD-020 WS-C + WS-F migration
-- WS-C: Database integrity constraints
-- All preflight checks passed — 0 orphan rows found.

-- FK: auth_sessions → users (sessions die with user)
ALTER TABLE auth_sessions DROP CONSTRAINT IF EXISTS fk_auth_sessions_user;
ALTER TABLE auth_sessions ADD CONSTRAINT fk_auth_sessions_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- FK: profiles → users (restrict — profile should not outlive user)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS fk_profiles_user;
ALTER TABLE profiles ADD CONSTRAINT fk_profiles_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

-- FK: payment_audit_log → payments (restrict — never lose audit trail)
ALTER TABLE payment_audit_log DROP CONSTRAINT IF EXISTS fk_payment_audit_payment;
ALTER TABLE payment_audit_log ADD CONSTRAINT fk_payment_audit_payment
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT;

-- UNIQUE: connections (prevent duplicate connections)
-- First check if table and columns exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'connections') THEN
    BEGIN
      ALTER TABLE connections DROP CONSTRAINT IF EXISTS uq_connection_pair;
      -- Only add if unique columns exist
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='connections' AND column_name='user_id')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='connections' AND column_name='connected_user_id') THEN
        ALTER TABLE connections ADD CONSTRAINT uq_connection_pair UNIQUE (user_id, connected_user_id);
      END IF;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

-- Index: support the new FK lookups
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_payment_id ON payment_audit_log(payment_id);
