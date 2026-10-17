-- Supplier payments: which cash/bank ledger account the payment was made
-- from ("Paid from" in the Record Payment dialog). Run this in each
-- instance's Supabase SQL editor.
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS paid_from_account_id TEXT;

-- Make PostgREST pick the new column up immediately.
NOTIFY pgrst, 'reload schema';
