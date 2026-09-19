-- Phase 2.1: work submission history + client approval

CREATE TABLE IF NOT EXISTS retainer_work_item_submissions (
  id SERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,

  retainer_cycle_task_id INTEGER NOT NULL
    REFERENCES retainer_cycle_tasks(id)
    ON DELETE CASCADE,

  version INTEGER NOT NULL,

  submitted_by INTEGER NOT NULL
    REFERENCES users(id),

  note TEXT,
  deliverable_url TEXT,

  upload_object_id INTEGER
    REFERENCES upload_objects(id)
    ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'submitted',

  client_feedback TEXT,

  reviewed_by INTEGER
    REFERENCES users(id),

  submitted_at TEXT NOT NULL,
  reviewed_at TEXT,

  created_at TEXT NOT NULL DEFAULT (now())::text
);

CREATE UNIQUE INDEX IF NOT EXISTS
  retainer_work_item_submissions_task_version_idx
ON retainer_work_item_submissions(
  retainer_cycle_task_id,
  version
);

CREATE INDEX IF NOT EXISTS
  retainer_work_item_submissions_task_idx
ON retainer_work_item_submissions(
  retainer_cycle_task_id
);

CREATE INDEX IF NOT EXISTS
  retainer_work_item_submissions_status_idx
ON retainer_work_item_submissions(
  status
);
