-- Sales (retail/COD orders): which cash/bank ledger account the settled
-- amount was deposited into ("Deposit into" in the Settle Payment dialog).
-- Run this in each instance's Supabase SQL editor.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS deposit_account_id TEXT;

-- Make PostgREST pick the new column up immediately.
NOTIFY pgrst, 'reload schema';
