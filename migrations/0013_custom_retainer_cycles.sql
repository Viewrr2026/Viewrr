-- Additive custom-cycle model. Existing agreements retain workflow_version = 0.
BEGIN;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS workflow_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS proposal_creator_id INTEGER REFERENCES users(id);
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS proposal_feedback TEXT;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS creation_key UUID;
CREATE UNIQUE INDEX IF NOT EXISTS retainer_creation_key ON retainer_agreements(proposal_creator_id,creation_key) WHERE creation_key IS NOT NULL;
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS plan_key UUID;
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS cycle_name TEXT;
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS revision_allowance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS payment_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS accepted_at TEXT;
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS started_at TEXT;
ALTER TABLE retainer_cycles ADD COLUMN IF NOT EXISTS freeze_notified_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS retainer_custom_plan_key ON retainer_cycles(retainer_agreement_id, plan_key) WHERE plan_key IS NOT NULL;
ALTER TABLE retainer_deliverables ADD COLUMN IF NOT EXISTS cycle_id INTEGER REFERENCES retainer_cycles(id);
ALTER TABLE retainer_deliverables ADD COLUMN IF NOT EXISTS plan_key UUID;
CREATE TABLE IF NOT EXISTS retainer_media (
  id UUID PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES retainer_cycle_tasks(id),
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  original_key TEXT NOT NULL UNIQUE,
  preview_key TEXT UNIQUE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','ready','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE retainer_work_item_submissions ADD COLUMN IF NOT EXISTS media_id UUID REFERENCES retainer_media(id);
CREATE UNIQUE INDEX IF NOT EXISTS retainer_submission_version ON retainer_work_item_submissions(retainer_cycle_task_id, version);
CREATE TABLE IF NOT EXISTS retainer_events (
  id BIGSERIAL PRIMARY KEY,
  agreement_id INTEGER NOT NULL REFERENCES retainer_agreements(id),
  actor_id INTEGER,
  event_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS retainer_notice_outbox (
  id BIGSERIAL PRIMARY KEY,
  agreement_id INTEGER NOT NULL REFERENCES retainer_agreements(id),
  recipient_id INTEGER NOT NULL REFERENCES users(id),
  event_key TEXT NOT NULL UNIQUE,
  message TEXT NOT NULL,
  delivered_at TIMESTAMPTZ,
  email_delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Stripe request parameters must survive process failure and idempotent retries.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS retainer_intent_params JSONB;
COMMIT;
