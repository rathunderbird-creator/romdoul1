-- Indexes for the ledger tables.
-- Run once in each instance's Supabase SQL editor (Romdoul1, Romdoul2, Romdoul3).
-- Safe to re-run (IF NOT EXISTS); adds no data and changes no rows.
--
-- Postgres does not index a foreign key by itself, and none of these existed:
-- every "lines of this entry" lookup scanned the whole journal_entry_lines
-- table. Journal Entries, General Ledger, Cash In/Out and Retail Payment read
-- each entry's lines, so on a few thousand entries a page read took ~3s and hit
-- the statement timeout ("canceling statement due to statement timeout"). The
-- app now reads lines flat (it works without this file), but the database
-- functions that post, settle and rebuild entries look lines up by entry and
-- by account too, and the reports filter by date — all of it gets faster here.

CREATE INDEX IF NOT EXISTS journal_entry_lines_entry_idx   ON journal_entry_lines (journal_entry_id);
CREATE INDEX IF NOT EXISTS journal_entry_lines_account_idx ON journal_entry_lines (account_id);
CREATE INDEX IF NOT EXISTS journal_entries_date_id_idx     ON journal_entries (date, id);
CREATE INDEX IF NOT EXISTS journal_entries_reference_idx   ON journal_entries (reference_id);

ANALYZE journal_entries;
ANALYZE journal_entry_lines;
