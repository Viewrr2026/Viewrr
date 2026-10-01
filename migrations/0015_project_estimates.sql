BEGIN;
CREATE TABLE IF NOT EXISTS project_estimate_versions (
  id BIGSERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL,
  proposed_by INTEGER NOT NULL REFERENCES users(id),
  snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','changes_requested','superseded')),
  feedback TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE(project_id,version)
);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS estimate_version_id BIGINT REFERENCES project_estimate_versions(id);
COMMIT;
