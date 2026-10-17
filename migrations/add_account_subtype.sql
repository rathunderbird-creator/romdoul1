-- Chart of Accounts: optional sub-category per ledger account (e.g.
-- Current Asset, Fixed Asset, Operating Expense), shown next to the
-- account name. Run this in each instance's Supabase SQL editor.
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS sub_type TEXT;

-- Make PostgREST pick the new column up immediately.
NOTIFY pgrst, 'reload schema';
