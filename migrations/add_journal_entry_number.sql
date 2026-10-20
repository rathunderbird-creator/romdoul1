-- Journal entries: human-readable display ID (JE-{globalSeq}-{TYPE}-
-- {YYYYMMDD}-{dailySeq}, e.g. JE-37-RCP-20261019-001), additive to and never
-- a replacement for reference_id — other code still reads/writes
-- reference_id for dedup and cleanup exactly as before. Existing rows are
-- left NULL (not backfilled) and keep displaying via their old fallback.
-- Run this in each instance's Supabase SQL editor.
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS entry_number TEXT;

-- Make PostgREST pick the new column up immediately.
NOTIFY pgrst, 'reload schema';
