-- Phase 2.2: auditable work updates at every workflow stage

CREATE TABLE IF NOT EXISTS retainer_work_item_stage_updates (
  id SERIAL PRIMARY KEY,

  public_id TEXT NOT NULL UNIQUE,

  retainer_cycle_task_id INTEGER NOT NULL
    REFERENCES retainer_cycle_tasks(id)
    ON DELETE CASCADE,

  stage_index INTEGER NOT NULL,
  stage_name TEXT NOT NULL,

  next_stage_index INTEGER NOT NULL,
  next_stage_name TEXT NOT NULL,

  note TEXT NOT NULL,
  deliverable_url TEXT NOT NULL,

  created_by INTEGER NOT NULL
    REFERENCES users(id),

  created_at TEXT NOT NULL
    DEFAULT (now())::text
);

CREATE INDEX IF NOT EXISTS
  retainer_work_item_stage_updates_task_idx
ON retainer_work_item_stage_updates(
  retainer_cycle_task_id
);

CREATE INDEX IF NOT EXISTS
  retainer_work_item_stage_updates_task_stage_idx
ON retainer_work_item_stage_updates(
  retainer_cycle_task_id,
  stage_index
);
