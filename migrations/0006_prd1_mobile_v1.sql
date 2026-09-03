-- ============================================================================
-- Migration 0006_prd1_mobile_v1 — PRD 1 (Mobile V1)
--
-- Authored by agent B2. NEVER run against production without review.
-- All statements are idempotent (IF NOT EXISTS / IF EXISTS) so the file can be
-- re-applied safely.
--
-- NOTE ON FILE NUMBERING: the contract (§E) mandates the filename
-- `0006_prd1_mobile_v1.sql`. `migrations/0006_prd018_security.sql` already
-- exists, so the `0006` prefix is now duplicated. Migrations in this repo are
-- applied by hand (there is no drizzle `migrations/meta` journal), so this is
-- cosmetic — but apply this file LAST, after 0009_prd021_scale_legal_trust.sql.
--
-- Contract references: §E (migration spec), Decision 4 (grandfathering),
-- Decision 6 (scheduled deferral), Decision 8 (content flags),
-- Decision 14 (notification targeting), Decision 15 (push).
-- ============================================================================

BEGIN;

-- ─── users: email verification (Decision 4) ─────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP NULL;

-- GRANDFATHERING BACKFILL — Decision 4.
-- On the FIRST application of Mobile V1, every account that already exists is
-- considered verified. Email verification applies only to accounts created
-- after this migration is in place.
--
-- Guarding the backfill with schema_migrations keeps the file safely
-- re-runnable: a later re-run must never accidentally verify genuinely new,
-- still-unverified accounts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM schema_migrations
    WHERE migration_name = '0006_prd1_mobile_v1'
  ) THEN
    UPDATE users
    SET email_verified = TRUE,
        email_verified_at = NOW()
    WHERE email_verified = FALSE;
  END IF;
END
$$;

-- After the first run, verify manually:
--   SELECT COUNT(*) FROM users WHERE email_verified = FALSE;
-- Existing users should be verified. New registrations made after migration
-- remain subject to the normal verification flow.

-- ─── account_deletion_requests: scheduled deferral (Decision 6) ─────────────
ALTER TABLE account_deletion_requests ADD COLUMN IF NOT EXISTS scheduled_for   TIMESTAMP NULL;
ALTER TABLE account_deletion_requests ADD COLUMN IF NOT EXISTS deferred_reason TEXT NULL;
ALTER TABLE account_deletion_requests ADD COLUMN IF NOT EXISTS state           TEXT NOT NULL DEFAULT 'pending';
-- state: 'pending' | 'scheduled' | 'processing' | 'anonymised' | 'cancelled'
-- `status` (the pre-existing column) is left untouched for web compatibility.

CREATE INDEX IF NOT EXISTS account_deletion_requests_user_state_idx
  ON account_deletion_requests (user_id, state);

-- ─── notifications: structured targeting (Decision 14, additive) ────────────
-- `link` is deliberately untouched — web still routes off it.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_type TEXT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_id   INTEGER NULL;
-- target_type: 'project' | 'brief' | 'conversation' | 'post' | 'profile' | NULL

-- ─── push_tokens (new — Decision 15) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_tokens (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  platform     TEXT NOT NULL,             -- 'ios' | 'android'
  device_id    TEXT NULL,
  app_version  TEXT NULL,
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_user_id_token_key ON push_tokens (user_id, token);
CREATE INDEX        IF NOT EXISTS push_tokens_user_id_idx       ON push_tokens (user_id);

-- ─── push_preferences (new — Decision 15) ───────────────────────────────────
-- DISTINCT from the 8 email keys in notification_preferences.
CREATE TABLE IF NOT EXISTS push_preferences (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  push_messages        BOOLEAN NOT NULL DEFAULT TRUE,
  push_project_updates BOOLEAN NOT NULL DEFAULT TRUE,
  push_interests       BOOLEAN NOT NULL DEFAULT TRUE,
  push_payments        BOOLEAN NOT NULL DEFAULT TRUE,
  push_social          BOOLEAN NOT NULL DEFAULT FALSE
);

-- ─── content_flags (new — Decision 8, tier 2) ───────────────────────────────
CREATE TABLE IF NOT EXISTS content_flags (
  id             SERIAL PRIMARY KEY,
  subject_type   TEXT NOT NULL,                     -- 'post' | 'comment'
  subject_id     INTEGER NOT NULL,
  author_user_id INTEGER NOT NULL,
  reason         TEXT NOT NULL,                     -- matched rule key
  excerpt        TEXT NULL,
  state          TEXT NOT NULL DEFAULT 'pending',   -- pending | cleared | removed
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  reviewed_by    INTEGER NULL,
  reviewed_at    TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS content_flags_state_created_at_idx ON content_flags (state, created_at);

-- ─── moderation_audit_log (new) ─────────────────────────────────────────────
-- DEVIATION FROM §E, deliberately documented in /tmp/prd1/impl-B2.md.
-- trust-service.ts previously wrote user_suspended / user_unsuspended rows into
-- `payment_audit_log` with payment_id = NULL. That corrupts the financial audit
-- trail (which is a reconciliation source and must stay payment-only) and it is
-- unqueryable for moderation. Moderation needs its own append-only log; there is
-- no existing generic admin audit table in this schema.
CREATE TABLE IF NOT EXISTS moderation_audit_log (
  id           SERIAL PRIMARY KEY,
  actor_type   TEXT NOT NULL,          -- 'admin' | 'system'
  actor_id     INTEGER NULL,
  action       TEXT NOT NULL,          -- user_suspended | user_unsuspended | content_flag_cleared | content_flag_removed | content_rejected
  subject_type TEXT NOT NULL,          -- 'user' | 'post' | 'comment' | 'content_flag'
  subject_id   INTEGER NULL,
  reason       TEXT NULL,
  detail       TEXT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS moderation_audit_log_subject_idx    ON moderation_audit_log (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS moderation_audit_log_created_at_idx ON moderation_audit_log (created_at DESC);

-- ─── messages: read receipt + paging indexes ────────────────────────────────
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP NULL;

-- Live DB has ONLY messages_pkey (§A). Both indexes below are new.
CREATE INDEX IF NOT EXISTS messages_from_to_id_idx ON messages (from_id, to_id, id);
CREATE INDEX IF NOT EXISTS messages_to_read_idx    ON messages (to_id, read);

-- ─── user_blocks ────────────────────────────────────────────────────────────
-- NO CHANGE. `user_blocks_blocker_user_id_blocked_user_id_key` already exists in
-- production (§A), which is what makes the ON CONFLICT in trust-service.ts safe.
-- It is declared in shared/schema.ts only, so Drizzle matches reality.
-- Deliberately NOT created here.

-- ─── Migration tracking ──────────────────────────────────────────────────────

INSERT INTO schema_migrations (migration_name)
VALUES ('0006_prd1_mobile_v1')
ON CONFLICT DO NOTHING;

COMMIT;
