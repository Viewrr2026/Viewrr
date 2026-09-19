-- Phase 2: individual work items inside retainer cycles

ALTER TABLE retainer_cycle_tasks
  ADD COLUMN IF NOT EXISTS retainer_deliverable_id INTEGER
  REFERENCES retainer_deliverables(id) ON DELETE SET NULL;

ALTER TABLE retainer_cycle_tasks
  ADD COLUMN IF NOT EXISTS item_number INTEGER;

ALTER TABLE retainer_cycle_tasks
  ADD COLUMN IF NOT EXISTS stage TEXT;

ALTER TABLE retainer_cycle_tasks
  ADD COLUMN IF NOT EXISTS stage_index INTEGER NOT NULL DEFAULT 0;

ALTER TABLE retainer_cycle_tasks
  ADD COLUMN IF NOT EXISTS stages JSONB NOT NULL DEFAULT '[]';

ALTER TABLE retainer_cycle_tasks
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS retainer_cycle_tasks_cycle_idx
  ON retainer_cycle_tasks(retainer_cycle_id);

CREATE INDEX IF NOT EXISTS retainer_cycle_tasks_deliverable_idx
  ON retainer_cycle_tasks(retainer_deliverable_id);

CREATE UNIQUE INDEX IF NOT EXISTS retainer_cycle_tasks_cycle_deliverable_item_idx
  ON retainer_cycle_tasks(
    retainer_cycle_id,
    retainer_deliverable_id,
    item_number
  )
  WHERE retainer_deliverable_id IS NOT NULL;
