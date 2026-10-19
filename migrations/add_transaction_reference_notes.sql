-- Transactions: cheque/transfer reference and free-text notes captured by
-- the Record Receipt dialog. Run this in each instance's Supabase SQL editor.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notes TEXT;

-- Make PostgREST pick the new columns up immediately.
NOTIFY pgrst, 'reload schema';
