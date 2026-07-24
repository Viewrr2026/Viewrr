-- PRD-007: Payment Ledger & UK Compliance Hardening
-- Run once against Neon production database

-- payments table (source of truth for all money movement)
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL,
  invoice_id INTEGER,
  retainer_cycle_id INTEGER,
  client_id INTEGER NOT NULL,
  freelancer_id INTEGER NOT NULL,
  payment_kind TEXT NOT NULL DEFAULT 'one_off',
  currency TEXT NOT NULL DEFAULT 'gbp',
  gross_pence INTEGER NOT NULL,
  platform_fee_pence INTEGER NOT NULL,
  freelancer_pence INTEGER NOT NULL,
  stripe_fee_pence INTEGER,
  net_platform_revenue_pence INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  transfer_strategy TEXT NOT NULL DEFAULT 'platform_held',
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_charge_id TEXT,
  stripe_balance_transaction_id TEXT,
  stripe_application_fee_id TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  authorised_at TEXT,
  succeeded_at TEXT,
  failed_at TEXT,
  cancelled_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

-- payment_transfers table
CREATE TABLE IF NOT EXISTS payment_transfers (
  id SERIAL PRIMARY KEY,
  payment_id INTEGER NOT NULL,
  stripe_transfer_id TEXT NOT NULL UNIQUE,
  destination_account_id TEXT NOT NULL,
  amount_pence INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  failure_code TEXT,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  reversed_pence INTEGER NOT NULL DEFAULT 0,
  last_reconciled_at TEXT
);

-- payment_refunds table
CREATE TABLE IF NOT EXISTS payment_refunds (
  id SERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  payment_id INTEGER NOT NULL,
  stripe_refund_id TEXT UNIQUE,
  amount_pence INTEGER NOT NULL,
  reason_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  reverse_transfer INTEGER NOT NULL DEFAULT 1,
  refund_application_fee INTEGER NOT NULL DEFAULT 0,
  requested_by INTEGER NOT NULL,
  approved_by INTEGER,
  internal_note TEXT,
  failure_code TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  succeeded_at TEXT
);

-- payment_payouts table (synced from Stripe payout events)
CREATE TABLE IF NOT EXISTS payment_payouts (
  id SERIAL PRIMARY KEY,
  freelancer_id INTEGER NOT NULL,
  stripe_payout_id TEXT NOT NULL UNIQUE,
  amount_pence INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'gbp',
  status TEXT NOT NULL DEFAULT 'pending',
  arrival_date TEXT,
  failure_code TEXT,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  paid_at TEXT
);

-- stripe_events table (idempotent event store)
CREATE TABLE IF NOT EXISTS stripe_events (
  stripe_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  livemode INTEGER NOT NULL DEFAULT 0,
  api_version TEXT,
  processing_status TEXT NOT NULL DEFAULT 'received',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  processed_at TEXT,
  error_code TEXT,
  error_summary TEXT
);

-- payment_audit_log table (immutable, never delete rows)
CREATE TABLE IF NOT EXISTS payment_audit_log (
  id SERIAL PRIMARY KEY,
  payment_id INTEGER,
  actor_type TEXT NOT NULL,
  actor_id INTEGER,
  action TEXT NOT NULL,
  before_state TEXT,
  after_state TEXT,
  reason TEXT,
  correlation_id TEXT,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT
);

-- stripe_connect_accounts table (richer Connect readiness model)
CREATE TABLE IF NOT EXISTS stripe_connect_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  stripe_account_id TEXT NOT NULL UNIQUE,
  readiness_state TEXT NOT NULL DEFAULT 'not_created',
  details_submitted INTEGER NOT NULL DEFAULT 0,
  charges_enabled INTEGER NOT NULL DEFAULT 0,
  payouts_enabled INTEGER NOT NULL DEFAULT 0,
  transfers_capability TEXT DEFAULT 'inactive',
  currently_due TEXT NOT NULL DEFAULT '[]',
  eventually_due TEXT NOT NULL DEFAULT '[]',
  past_due TEXT NOT NULL DEFAULT '[]',
  pending_verification TEXT NOT NULL DEFAULT '[]',
  disabled_reason TEXT,
  payout_schedule TEXT,
  terms_accepted_at TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_payments_project ON payments(project_id);
CREATE INDEX IF NOT EXISTS idx_payments_intent ON payments(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payment_transfers_payment ON payment_transfers(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_payment ON payment_refunds(payment_id);
CREATE INDEX IF NOT EXISTS idx_audit_payment ON payment_audit_log(payment_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON payment_audit_log(created_at);
