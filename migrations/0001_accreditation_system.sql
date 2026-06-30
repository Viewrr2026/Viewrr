-- ─── Viewrr Accreditation System — Migration 0001 ─────────────────────────────
-- Adds accreditation columns to profiles and creates accreditation_history table.
-- Designed for unlimited future levels: level stored as text, not a pg enum.

-- 1. Extend profiles table with accreditation columns
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS accreditation_level            TEXT,
  ADD COLUMN IF NOT EXISTS accreditation_approved_by      INTEGER,
  ADD COLUMN IF NOT EXISTS accreditation_approved_by_name TEXT,
  ADD COLUMN IF NOT EXISTS accreditation_approved_date    TEXT,
  ADD COLUMN IF NOT EXISTS accreditation_notes            TEXT,
  ADD COLUMN IF NOT EXISTS accreditation_last_reviewed    TEXT,
  ADD COLUMN IF NOT EXISTS review_average                 REAL    DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verified_review_count          INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_project_count        INTEGER DEFAULT 0;

-- 2. Create accreditation_history audit log
CREATE TABLE IF NOT EXISTS accreditation_history (
  id                  SERIAL PRIMARY KEY,
  freelancer_user_id  INTEGER NOT NULL,
  action_date         TEXT    NOT NULL,
  founder_user_id     INTEGER NOT NULL,
  founder_name        TEXT    NOT NULL,
  previous_level      TEXT,
  new_level           TEXT,
  action              TEXT    NOT NULL,  -- granted | promoted | demoted | removed | rejected | changes_requested
  reason              TEXT    NOT NULL DEFAULT '',
  internal_notes      TEXT    NOT NULL DEFAULT ''
);

-- 3. Index for fast founder-panel lookups
CREATE INDEX IF NOT EXISTS idx_accreditation_history_freelancer
  ON accreditation_history (freelancer_user_id);

CREATE INDEX IF NOT EXISTS idx_profiles_accreditation_level
  ON profiles (accreditation_level);
