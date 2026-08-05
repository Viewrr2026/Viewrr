-- PRD-012: Retainer Workflow Reimagined
-- Adds 12 new tables on top of existing retainer_agreements + retainer_cycles

-- ─── retainer_templates ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainer_templates (
  id SERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  freelancer_id INTEGER,                        -- NULL = system template
  name TEXT NOT NULL,
  category TEXT NOT NULL,                       -- monthly_content | social_media | video_production | photography | design_support | website_support | marketing_support | custom
  commercial_model TEXT NOT NULL DEFAULT 'fixed_deliverables', -- fixed_deliverables | reserved_capacity | credits | hybrid | bespoke
  description TEXT,
  suggested_deliverables JSONB DEFAULT '[]',
  suggested_workflow JSONB DEFAULT '[]',
  suggested_boundaries JSONB DEFAULT '{}',
  suggested_billing_frequency TEXT DEFAULT 'monthly',
  is_system BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT
);

-- ─── retainer_deliverables ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainer_deliverables (
  id SERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  retainer_agreement_id INTEGER NOT NULL REFERENCES retainer_agreements(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  frequency TEXT NOT NULL DEFAULT 'per_cycle',  -- per_week | per_month | per_quarter | per_cycle
  turnaround_days INTEGER,
  approval_required BOOLEAN DEFAULT TRUE,
  rollover_rule TEXT NOT NULL DEFAULT 'none',   -- none | limited | full
  rollover_limit INTEGER,
  item_type TEXT NOT NULL DEFAULT 'included',   -- included | optional | out_of_scope
  add_on_price_pence INTEGER,
  notes TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT
);

-- ─── retainer_workstreams ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainer_workstreams (
  id SERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  retainer_agreement_id INTEGER NOT NULL REFERENCES retainer_agreements(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  stages JSONB DEFAULT '[]',                    -- [{label, description}]
  is_default BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT
);

-- ─── retainer_cycle_tasks ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainer_cycle_tasks (
  id SERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  retainer_cycle_id INTEGER NOT NULL,
  workstream_id INTEGER REFERENCES retainer_workstreams(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending | in_progress | review | approved | complete
  assigned_to INTEGER,                          -- user id
  due_date TEXT,
  recurs_each_cycle BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  completed_at TEXT
);

-- ─── retainer_requests ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainer_requests (
  id SERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  retainer_agreement_id INTEGER NOT NULL REFERENCES retainer_agreements(id) ON DELETE CASCADE,
  retainer_cycle_id INTEGER,
  submitted_by INTEGER NOT NULL,               -- client user id
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',     -- low | normal | high | urgent
  due_date TEXT,
  related_deliverable_id INTEGER REFERENCES retainer_deliverables(id),
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | accepted | scheduled | clarification | out_of_scope | cancelled | complete
  creative_response TEXT,
  out_of_scope_quote_pence INTEGER,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT,
  updated_at TEXT NOT NULL DEFAULT NOW()::TEXT
);

-- ─── retainer_usage_entries ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainer_usage_entries (
  id SERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  retainer_agreement_id INTEGER NOT NULL REFERENCES retainer_agreements(id) ON DELETE CASCADE,
  retainer_cycle_id INTEGER,
  deliverable_id INTEGER REFERENCES retainer_deliverables(id),
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit TEXT DEFAULT 'item',                    -- item | hour | credit
  recorded_by INTEGER NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT NOW()::TEXT
);

-- ─── retainer_amendments ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainer_amendments (
  id SERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  retainer_agreement_id INTEGER NOT NULL REFERENCES retainer_agreements(id) ON DELETE CASCADE,
  proposed_by INTEGER NOT NULL,
  changes JSONB NOT NULL,                      -- {field: {from, to}}
  effective_from TEXT,                         -- NULL = immediate
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | accepted | rejected | withdrawn
  accepted_at TEXT,
  rejected_at TEXT,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT
);

-- ─── retainer_agreement_versions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainer_agreement_versions (
  id SERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  retainer_agreement_id INTEGER NOT NULL REFERENCES retainer_agreements(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL DEFAULT 1,
  snapshot JSONB NOT NULL,                     -- full agreement state at this version
  created_by INTEGER NOT NULL,
  accepted_by_client_at TEXT,
  accepted_by_freelancer_at TEXT,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT
);

-- ─── retainer_cycle_reviews ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainer_cycle_reviews (
  id SERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  retainer_cycle_id INTEGER NOT NULL,
  retainer_agreement_id INTEGER NOT NULL REFERENCES retainer_agreements(id) ON DELETE CASCADE,
  completed_deliverables JSONB DEFAULT '[]',
  outstanding_items JSONB DEFAULT '[]',
  capacity_used NUMERIC,
  capacity_total NUMERIC,
  outcomes_summary TEXT,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT
);

-- ─── retainer_satisfaction_pulses ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainer_satisfaction_pulses (
  id SERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  retainer_agreement_id INTEGER NOT NULL REFERENCES retainer_agreements(id) ON DELETE CASCADE,
  retainer_cycle_id INTEGER,
  submitted_by INTEGER NOT NULL,
  role TEXT NOT NULL,                          -- client | freelancer
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT
);

-- ─── retainer_pause_requests ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainer_pause_requests (
  id SERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  retainer_agreement_id INTEGER NOT NULL REFERENCES retainer_agreements(id) ON DELETE CASCADE,
  requested_by INTEGER NOT NULL,
  reason TEXT,
  effective_from_cycle INTEGER,
  fees_continue BOOLEAN DEFAULT FALSE,
  deliverables_continue BOOLEAN DEFAULT FALSE,
  rollover_continues BOOLEAN DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | rejected | active | ended
  approved_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT
);

-- ─── retainer_renewal_events ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainer_renewal_events (
  id SERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  retainer_agreement_id INTEGER NOT NULL REFERENCES retainer_agreements(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,                   -- renewed | extended | upgraded | downgraded | cancelled | ended
  new_terms JSONB,
  effective_from TEXT,
  initiated_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT NOW()::TEXT
);

-- ─── Extend retainer_agreements with PRD-012 fields ──────────────────────────
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS commercial_model TEXT DEFAULT 'fixed_deliverables';
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS template_id INTEGER;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS retainer_goal TEXT;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS success_measures TEXT;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS key_channels TEXT;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS priority_outcomes TEXT;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS minimum_term_cycles INTEGER;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS notice_period_cycles INTEGER DEFAULT 1;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS renewal_mode TEXT DEFAULT 'rolling'; -- rolling | fixed | trial
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS trial_cycles INTEGER;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS intro_price_pence INTEGER;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS intro_cycles INTEGER;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS setup_fee_pence INTEGER;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS max_revisions INTEGER;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS response_time_hours INTEGER;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS client_input_deadline_days INTEGER;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS excluded_work TEXT;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS capacity_hours NUMERIC;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS capacity_credits NUMERIC;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS draft_step INTEGER DEFAULT 0;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS draft_data JSONB;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS proposal_sent_at TEXT;
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS renewal_health INTEGER; -- 0-100
ALTER TABLE retainer_agreements ADD COLUMN IF NOT EXISTS current_version INTEGER DEFAULT 1;

-- ─── System retainer templates (seed) ────────────────────────────────────────
INSERT INTO retainer_templates (public_id, name, category, commercial_model, description, suggested_deliverables, suggested_workflow, suggested_billing_frequency, is_system)
VALUES
  ('tpl_monthly_content', 'Monthly Content', 'monthly_content', 'fixed_deliverables', 'Ongoing monthly content creation for social, web or brand.', '[{"name":"Social posts","quantity":8,"frequency":"per_cycle"},{"name":"Blog articles","quantity":2,"frequency":"per_cycle"},{"name":"Email newsletter","quantity":1,"frequency":"per_cycle"}]', '[{"label":"Brief/Requests"},{"label":"Production"},{"label":"Client Review"},{"label":"Revisions"},{"label":"Approved"},{"label":"Cycle Complete"}]', 'monthly', TRUE),
  ('tpl_social_media', 'Social Media', 'social_media', 'fixed_deliverables', 'Dedicated social media management and content creation.', '[{"name":"Feed posts","quantity":12,"frequency":"per_cycle"},{"name":"Stories","quantity":4,"frequency":"per_cycle"},{"name":"Reel/short video","quantity":2,"frequency":"per_cycle"}]', '[{"label":"Content Calendar"},{"label":"Production"},{"label":"Scheduling"},{"label":"Reporting"}]', 'monthly', TRUE),
  ('tpl_video_production', 'Video Production', 'video_production', 'fixed_deliverables', 'Regular video production for brand, social or marketing.', '[{"name":"Short-form videos","quantity":4,"frequency":"per_cycle"},{"name":"Long-form video","quantity":1,"frequency":"per_cycle"}]', '[{"label":"Brief"},{"label":"Shoot/Capture"},{"label":"Edit"},{"label":"Review"},{"label":"Revisions"},{"label":"Deliver"}]', 'monthly', TRUE),
  ('tpl_photography', 'Photography', 'photography', 'fixed_deliverables', 'Regular photography sessions and edited image delivery.', '[{"name":"Edited images","quantity":30,"frequency":"per_cycle"},{"name":"Photography session","quantity":1,"frequency":"per_cycle"}]', '[{"label":"Brief"},{"label":"Session"},{"label":"Culling"},{"label":"Editing"},{"label":"Delivery"}]', 'monthly', TRUE),
  ('tpl_design_support', 'Design Support', 'design_support', 'reserved_capacity', 'On-demand design work with reserved monthly hours.', '[{"name":"Design hours","quantity":20,"frequency":"per_cycle"}]', '[{"label":"Request"},{"label":"Design"},{"label":"Review"},{"label":"Revisions"},{"label":"Sign-off"}]', 'monthly', TRUE),
  ('tpl_website_support', 'Website Support', 'website_support', 'reserved_capacity', 'Ongoing website maintenance, updates and improvements.', '[{"name":"Development hours","quantity":10,"frequency":"per_cycle"},{"name":"Update tasks","quantity":5,"frequency":"per_cycle"}]', '[{"label":"Request"},{"label":"Development"},{"label":"Testing"},{"label":"Deploy"},{"label":"Sign-off"}]', 'monthly', TRUE),
  ('tpl_marketing_support', 'Marketing Support', 'marketing_support', 'hybrid', 'Strategic marketing support with defined monthly deliverables.', '[{"name":"Strategy sessions","quantity":2,"frequency":"per_cycle"},{"name":"Campaign briefs","quantity":1,"frequency":"per_cycle"},{"name":"Performance reports","quantity":1,"frequency":"per_cycle"}]', '[{"label":"Planning"},{"label":"Execution"},{"label":"Review"},{"label":"Reporting"}]', 'monthly', TRUE),
  ('tpl_custom', 'Custom Retainer', 'custom', 'bespoke', 'Build your own retainer from scratch.', '[]', '[{"label":"Brief/Requests"},{"label":"Production"},{"label":"Client Review"},{"label":"Revisions"},{"label":"Approved"},{"label":"Cycle Complete"}]', 'monthly', TRUE)
ON CONFLICT (public_id) DO NOTHING;
