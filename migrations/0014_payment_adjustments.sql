-- Preserve original invoice/payment amounts; record verified Stripe adjustments separately.
BEGIN;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_pence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fee_refunded_pence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS transfer_reversed_pence INTEGER NOT NULL DEFAULT 0;
COMMIT;
