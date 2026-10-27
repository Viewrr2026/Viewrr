-- A separate, server-encoded review copy for a hosted final delivery.
ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS preview_media_id INTEGER;
