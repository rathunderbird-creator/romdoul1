-- Customer payments (wholesale receipts): which cash/bank ledger account the
-- money was received into ("Received into" in the Record Payment dialog).
-- Run this in each instance's Supabase SQL editor.
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS received_in_account_id TEXT;

-- Make PostgREST pick the new column up immediately.
NOTIFY pgrst, 'reload schema';
