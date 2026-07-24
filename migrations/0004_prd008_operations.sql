-- PRD-008: Payments Operations, Retainers, Payouts & User Experience
-- Run once against Neon production database
-- Non-destructive: all tables use CREATE TABLE IF NOT EXISTS

-- ─── retainer_agreements ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainer_agreements (
  id SERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  freelancer_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  currency TEXT NOT NULL DEFAULT 'gbp',
  billing_frequency TEXT NOT NULL DEFAULT 'monthly', -- monthly | weekly | fortnightly | quarterly
  agreed_cycle_amount_pence INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active | paused | terminated | completed
  terms_version TEXT,
  client_accepted_at TEXT,
  freelancer_accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  updated_at TEXT NOT NULL DEFAULT NOW()::TEXT
);

-- ─── retainer_cycles (extended — new columns, preserving existing table) ─────
-- Existing retainer_cycles table has: id, project_id, cycle_number, status, start_date, end_date, freelancer_note, payment_status, created_at
-- Add new columns non-destructively:
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS public_id TEXT UNIQUE;
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS retainer_agreement_id INTEGER;
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS sequence_number INTEGER;
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS period_start TEXT;
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS period_end TEXT;
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS due_at TEXT;
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS amount_pence INTEGER;
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'gbp';
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS invoice_id INTEGER;
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS payment_id INTEGER;
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS paid_at TEXT;
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS cancelled_at TEXT;
-- Backfill public_ids for existing cycles
UPDATE retainer_cycles SET public_id = 'rc_legacy_' || id::TEXT WHERE public_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS retainer_cycles_public_id_idx ON retainer_cycles(public_id);

-- ─── finance_permissions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance_permissions (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL,   -- founder | admin | payments_manager | support
  permission TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  UNIQUE(role, permission)
);

-- Seed the permission matrix
INSERT INTO finance_permissions (role, permission) VALUES
  ('founder', 'finance.dashboard.view'),
  ('founder', 'finance.payment.view'),
  ('founder', 'finance.audit.view'),
  ('founder', 'finance.export'),
  ('founder', 'finance.reconcile.run'),
  ('founder', 'finance.webhook.replay'),
  ('founder', 'finance.refund.request'),
  ('founder', 'finance.refund.approve.standard'),
  ('founder', 'finance.refund.approve.high_value'),
  ('founder', 'finance.dispute.manage'),
  ('founder', 'finance.settings.payout'),
  ('founder', 'finance.connected_account.view'),
  ('admin', 'finance.dashboard.view'),
  ('admin', 'finance.payment.view'),
  ('admin', 'finance.audit.view'),
  ('admin', 'finance.export'),
  ('admin', 'finance.reconcile.run'),
  ('admin', 'finance.webhook.replay'),
  ('admin', 'finance.refund.request'),
  ('admin', 'finance.refund.approve.standard'),
  ('admin', 'finance.dispute.manage'),
  ('admin', 'finance.connected_account.view'),
  ('payments_manager', 'finance.dashboard.view'),
  ('payments_manager', 'finance.payment.view'),
  ('payments_manager', 'finance.audit.view'),
  ('payments_manager', 'finance.export'),
  ('payments_manager', 'finance.reconcile.run'),
  ('payments_manager', 'finance.webhook.replay'),
  ('payments_manager', 'finance.refund.request'),
  ('payments_manager', 'finance.refund.approve.standard'),
  ('payments_manager', 'finance.dispute.manage'),
  ('payments_manager', 'finance.connected_account.view'),
  ('support', 'finance.dashboard.view'),
  ('support', 'finance.payment.view'),
  ('support', 'finance.refund.request'),
  ('support', 'finance.dispute.manage')
ON CONFLICT (role, permission) DO NOTHING;

-- ─── background_jobs (pg-backed durable queue) ───────────────────────────────
CREATE TABLE IF NOT EXISTS background_jobs (
  id SERIAL PRIMARY KEY,
  job_type TEXT NOT NULL,
  dedupe_key TEXT UNIQUE,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  -- queued | running | succeeded | retry_scheduled | failed | dead_letter
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_after TEXT NOT NULL DEFAULT NOW()::TEXT,
  locked_at TEXT,
  locked_by TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS background_jobs_status_run_after_idx ON background_jobs(status, run_after);
CREATE INDEX IF NOT EXISTS background_jobs_job_type_idx ON background_jobs(job_type);

-- ─── finance_exceptions (reconciliation exception queue) ─────────────────────
CREATE TABLE IF NOT EXISTS finance_exceptions (
  id SERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  payment_id INTEGER,
  connected_account_id INTEGER,
  type TEXT NOT NULL,
  -- payment_succeeded_internal_pending | internal_paid_stripe_not_succeeded |
  -- amount_mismatch | currency_mismatch | missing_charge | missing_balance_transaction |
  -- missing_transfer | duplicate_transfer | refund_without_reversal | reversal_without_refund |
  -- unexpected_application_fee | payout_failed | connected_account_restricted |
  -- negative_platform_balance | negative_connected_balance | webhook_failed | orphan_stripe_object
  severity TEXT NOT NULL DEFAULT 'monitor',
  -- critical | action_required | monitor | informational
  status TEXT NOT NULL DEFAULT 'open',
  -- open | investigating | action_required | resolved | ignored_with_reason
  amount_pence INTEGER,
  summary TEXT NOT NULL,
  technical_details JSONB NOT NULL DEFAULT '{}',
  assigned_to INTEGER,
  detected_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  resolved_at TEXT,
  resolution_note TEXT
);
CREATE INDEX IF NOT EXISTS finance_exceptions_status_idx ON finance_exceptions(status);
CREATE INDEX IF NOT EXISTS finance_exceptions_type_idx ON finance_exceptions(type);
CREATE INDEX IF NOT EXISTS finance_exceptions_payment_id_idx ON finance_exceptions(payment_id);

-- ─── payment_timeline_events ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_timeline_events (
  id SERIAL PRIMARY KEY,
  payment_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  -- payment_requested | payment_processing | payment_confirmed | payment_failed |
  -- earnings_held | earnings_allocated | payout_scheduled | payout_in_transit |
  -- payout_paid | payout_failed | refund_requested | refund_processing |
  -- refund_confirmed | dispute_opened | dispute_resolved
  visibility TEXT NOT NULL DEFAULT 'both', -- client | freelancer | both | admin
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_pence INTEGER,
  occurred_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  source_type TEXT NOT NULL DEFAULT 'system', -- system | webhook | admin | user
  source_id TEXT,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT
);
CREATE INDEX IF NOT EXISTS payment_timeline_events_payment_id_idx ON payment_timeline_events(payment_id);
CREATE INDEX IF NOT EXISTS payment_timeline_events_occurred_at_idx ON payment_timeline_events(occurred_at);

-- ─── finance_daily_summaries ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance_daily_summaries (
  date TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'gbp',
  gross_volume_pence BIGINT NOT NULL DEFAULT 0,
  platform_fee_pence BIGINT NOT NULL DEFAULT 0,
  stripe_fee_pence BIGINT NOT NULL DEFAULT 0,
  net_revenue_pence BIGINT NOT NULL DEFAULT 0,
  freelancer_earnings_pence BIGINT NOT NULL DEFAULT 0,
  refunds_pence BIGINT NOT NULL DEFAULT 0,
  payouts_pence BIGINT NOT NULL DEFAULT 0,
  failed_payment_count INTEGER NOT NULL DEFAULT 0,
  dispute_count INTEGER NOT NULL DEFAULT 0,
  exception_count INTEGER NOT NULL DEFAULT 0,
  calculated_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  PRIMARY KEY (date, currency)
);

-- ─── terms_versions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS terms_versions (
  id SERIAL PRIMARY KEY,
  document TEXT NOT NULL,
  -- platform_terms | client_terms | freelancer_terms | payments_refunds_policy |
  -- privacy_notice | cookie_notice | stripe_connect_disclosure | complaints |
  -- retainer_terms
  version TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  UNIQUE(document, version)
);

-- ─── terms_acceptances ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS terms_acceptances (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  terms_version_id INTEGER NOT NULL REFERENCES terms_versions(id),
  document TEXT NOT NULL,
  version TEXT NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  context TEXT NOT NULL DEFAULT 'signup', -- signup | checkout | retainer | manual
  ip_address TEXT,
  user_agent TEXT,
  UNIQUE(user_id, terms_version_id)
);
CREATE INDEX IF NOT EXISTS terms_acceptances_user_id_idx ON terms_acceptances(user_id);
