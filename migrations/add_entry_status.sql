-- Journal entries: Posted / Draft status, used by the Revenue and Expense
-- pages (new entries default to Posted). Run this in each instance's
-- Supabase SQL editor.
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Posted';

-- Make PostgREST pick the new column up immediately.
NOTIFY pgrst, 'reload schema';
