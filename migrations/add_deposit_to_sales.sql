-- Deposit tracking on retail orders: customer pays a small amount upfront
-- (e.g. by bank transfer), the remainder is collected via COD.
-- Business rule: deposits are always kept, even if the order is later
-- cancelled or returned.
-- Safe to re-run.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS deposit_date DATE;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS deposit_method TEXT;
