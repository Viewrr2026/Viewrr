-- Preserve the user's confirmed Pro deletion choice across retries/restarts.
-- Apply before deploying the corresponding server/mobile release.
ALTER TABLE account_deletion_requests
  ADD COLUMN IF NOT EXISTS pro_deletion_timing TEXT
    CHECK (pro_deletion_timing IN ('immediate', 'pro_period_end')),
  ADD COLUMN IF NOT EXISTS pro_delete_after TIMESTAMPTZ;
