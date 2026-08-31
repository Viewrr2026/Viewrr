-- PRD-021: Scale, Legal, Product & Trust Hardening
-- All statements idempotent (IF NOT EXISTS / DROP CONSTRAINT IF EXISTS)

-- ─── WS-A: Fix ON CONFLICT in terms_acceptances to be append-only ─────────────
-- Remove the unique constraint that allowed UPDATE (overwriting accepted_at)
-- Replace with a plain index so multiple acceptances of the same version are blocked at app layer
-- but the original timestamp is never overwritten
-- NOTE: The existing UNIQUE(user_id, terms_version_id) correctly prevents duplicates.
-- The bug was the ON CONFLICT DO UPDATE SET accepted_at in routes.ts — fix is in code, not schema.
-- Add version columns to terms_acceptances for audit completeness:
ALTER TABLE terms_acceptances ADD COLUMN IF NOT EXISTS acceptance_method TEXT DEFAULT 'explicit';
-- 'explicit' = user clicked accept | 'implicit' = implied by action (legacy)

-- ─── WS-B: Data export requests ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_export_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | ready | expired | failed
  requested_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  completed_at TEXT,
  expires_at TEXT,  -- export link expires after 24h
  export_size_bytes INTEGER,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_data_export_user ON data_export_requests(user_id);

-- ─── WS-B: Account deletion requests ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,  -- NOT a FK — must survive after anonymisation
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending | blocked_active_project | blocked_unpaid | processing | anonymised | rejected
  requested_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  processed_at TEXT,
  blocker_reason TEXT,  -- human-readable reason if blocked
  processed_by INTEGER,  -- admin user id if manually processed
  anonymised_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_user ON account_deletion_requests(user_id);

-- ─── WS-F: User reports (moderation) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_reports (
  id SERIAL PRIMARY KEY,
  reporter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL,  -- user | profile | post | message | brief | project
  subject_id INTEGER NOT NULL,
  reason TEXT NOT NULL,  -- spam | harassment | fake | inappropriate | other
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',  -- open | under_review | resolved | dismissed
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  reviewed_at TEXT,
  reviewed_by INTEGER,  -- admin user id
  resolution_note TEXT,
  moderator_action TEXT  -- warned | suspended | dismissed | no_action
);
CREATE INDEX IF NOT EXISTS idx_user_reports_reporter ON user_reports(reporter_user_id);
CREATE INDEX IF NOT EXISTS idx_user_reports_subject ON user_reports(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_user_reports_status ON user_reports(status);

-- ─── WS-F: Account suspension ─────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active';
-- active | suspended | restricted | anonymised
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_by INTEGER;  -- admin user id

-- ─── WS-F: User blocking ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_blocks (
  id SERIAL PRIMARY KEY,
  blocker_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  UNIQUE(blocker_user_id, blocked_user_id)
);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_user_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_user_id);

-- ─── WS-E: Performance indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_projects_freelancer_id ON projects(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_briefs_status ON briefs(status);
CREATE INDEX IF NOT EXISTS idx_briefs_created_at ON briefs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brief_interests_brief_id ON brief_interests(brief_id);
CREATE INDEX IF NOT EXISTS idx_brief_interests_freelancer_id ON brief_interests(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_messages_from_to ON messages(from_id, to_id);
CREATE INDEX IF NOT EXISTS idx_messages_to_from ON messages(to_id, from_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_views_user ON profile_views(profile_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_profile_id ON reviews(profile_id);
CREATE INDEX IF NOT EXISTS idx_connection_requests_sender ON connection_requests(sender_id);
CREATE INDEX IF NOT EXISTS idx_connection_requests_recipient ON connection_requests(recipient_id);

-- ─── WS-A: Seed initial terms versions (idempotent) ───────────────────────────
INSERT INTO terms_versions (document, version, effective_date, content_hash)
VALUES 
  ('platform_terms', 'v1.0', '2026-01-01', 'initial'),
  ('privacy_notice', 'v1.0', '2026-01-01', 'initial'),
  ('cookie_notice', 'v1.0', '2026-01-01', 'initial')
ON CONFLICT (document, version) DO NOTHING;

-- ─── Migration tracking ────────────────────────────────────────────────────────
INSERT INTO schema_migrations (migration_name)
VALUES ('0009_prd021_scale_legal_trust')
ON CONFLICT DO NOTHING;
