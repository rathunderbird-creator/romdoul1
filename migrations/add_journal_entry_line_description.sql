-- Per-line description on journal entries — the Create Journal Entry form's
-- line Description column. Additive: until an instance runs this, the form
-- saves lines without their descriptions (and says so).
ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS description TEXT;

NOTIFY pgrst, 'reload schema';
