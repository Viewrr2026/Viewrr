-- PRD-019: Mobile Authentication Foundation & Session Security
-- Migration: 0007_prd019_auth_sessions.sql
-- Idempotent. Additive only. No existing data is modified or removed.

-- ─── Stage 1: Password algorithm discriminator ────────────────────────────────
-- Existing rows receive 'sha256_v1' (correct — they are all legacy SHA-256 hashes).
-- New Argon2id hashes will be written with password_algo = 'argon2id'.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_algo TEXT NOT NULL DEFAULT 'sha256_v1';

-- ─── Stage 2: DB-backed session table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_sessions (
  id               SERIAL      PRIMARY KEY,
  session_id       TEXT        NOT NULL UNIQUE,        -- public non-secret UUID; safe to log
  user_id          INTEGER     NOT NULL,               -- references users.id (intentional no FK)
  token_hash       TEXT        NOT NULL UNIQUE,        -- SHA-256(rawToken); raw token NEVER stored
  client_type      TEXT        NOT NULL DEFAULT 'web', -- 'web' | 'mobile'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL,               -- absolute expiry (web: +8h; mobile: +90d)
  idle_expires_at  TIMESTAMPTZ,                        -- idle expiry (mobile only: last_used_at + 30d)
  revoked_at       TIMESTAMPTZ,
  revoked_reason   TEXT                                -- 'logout'|'password_reset'|'user_deleted'
);

-- ─── Stage 3: Supporting indexes ──────────────────────────────────────────────
-- token_hash UNIQUE already provides the primary lookup index — no additional index.
-- user_id: for revoking all sessions on password reset.
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id
  ON auth_sessions(user_id);

-- expires_at: for background expiry-reaping jobs.
-- Static column index — no time-varying expression in predicate.
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
  ON auth_sessions(expires_at);

-- idle_expires_at: for background idle-reaping jobs (mobile only).
-- Static partial predicate: WHERE idle_expires_at IS NOT NULL (valid in PostgreSQL).
CREATE INDEX IF NOT EXISTS idx_auth_sessions_idle_expires_at
  ON auth_sessions(idle_expires_at)
  WHERE idle_expires_at IS NOT NULL;
