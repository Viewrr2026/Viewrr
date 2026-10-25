BEGIN;
-- Existing rows are preserved; INTEGER overflows above 2 GiB.
ALTER TABLE upload_objects ALTER COLUMN size_bytes TYPE BIGINT;
ALTER TABLE retainer_media ALTER COLUMN size_bytes TYPE BIGINT;
ALTER TABLE upload_objects ADD COLUMN IF NOT EXISTS multipart_upload_id TEXT;
ALTER TABLE upload_objects ADD COLUMN IF NOT EXISTS upload_context JSONB;
COMMIT;
