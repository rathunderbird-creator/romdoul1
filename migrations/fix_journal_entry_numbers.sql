-- Journal entries: every entry_number unique, from now on and for the
-- entries already saved. Run once in each instance's Supabase SQL editor
-- (Romdoul1, Romdoul2, Romdoul3). Safe to re-run.
--
-- The number JE-<global>-<TYPE>-<yyyymmdd>-<nnn> was worked out before the
-- insert by COUNTING the entries already there (src/utils/journalEntryNumber.ts
-- and wp_internal.wp_next_entry_number). That gave the same number twice in
-- two ways:
--   * after a deletion. An un-pay, a deleted order or a deleted entry lowers
--     the count, so the next entry gets a number that is still in use (on
--     Romdoul1, RCP-20261115-019 went to two receipts two minutes apart);
--   * when several entries are saved at once. A bulk settle or bulk post,
--     two devices, or one database function booking several entries all
--     count the same rows and get the same number.
--
-- Fix: a BEFORE INSERT trigger checks every new entry's number. A number
-- nobody has (the usual case, and every row of a backup being restored)
-- is kept as it is. A number whose <TYPE>-<yyyymmdd>-<nnn> is already in
-- use gets the next free one of the same type and day, and the ref in its
-- description is swapped too ('Retail - RCP-20261115-019 — Name'). NULL and
-- non-standard numbers are left alone. The counters (one for the global
-- number, one for each type and day) live in journal_entry_number_counters
-- and only ever go up, so a deletion never frees a number. Each one starts
-- at the highest number already in use and is raised to every number that
-- is kept. Each insert locks the global counter row and then its day's row
-- (always in that order, so two inserts cannot deadlock) until it commits.
-- Entries saved at the same moment therefore wait their turn, and the
-- second one sees the first. Only the <TYPE>-<yyyymmdd>-<nnn> is checked,
-- the part the descriptions show. The global number before it can still
-- repeat when a caller guesses one in use (Romdoul1 already has such
-- pairs, each with a different ref). The entry_number as a whole stays
-- unique.
--
-- Callers that want the number actually saved read it back
-- (RETURNING entry_number / .select()); the one they worked out is only a
-- guess.
--
-- The entries saved before this keep their numbers. Where two or more
-- share the same <TYPE>-<yyyymmdd>-<nnn>, the oldest keeps it and each of
-- the others gets the next free number of its own type and day, with its
-- description updated the same way. Nothing else changes: amounts, status,
-- reference_id and lines stay as they are. The numbers appear nowhere else
-- (not in lines, not in transactions).
--
-- This file does not change the four packs (add_order_status_function.sql,
-- add_order_payment_functions.sql, add_wholesale_procurement_functions.sql,
-- add_stock_adjustment_posting.sql). It only adds the trigger in front of
-- the journal_entries inserts they (and the app) make, so it is fine on
-- Romdoul2 and Romdoul3 too.

CREATE SCHEMA IF NOT EXISTS wp_internal;

CREATE TABLE IF NOT EXISTS public.journal_entry_number_counters (
    k TEXT PRIMARY KEY,           -- 'global', or '<TYPE>-<yyyymmdd>'
    last_value INTEGER NOT NULL
);
-- Only the SECURITY DEFINER functions below touch it.
ALTER TABLE public.journal_entry_number_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.journal_entry_number_counters FROM anon, authenticated;

-- Counter p_key ('global' or '<TYPE>-<yyyymmdd>'): with p_next, its next
-- value; without it, it is raised to at least p_at_least and its value is
-- returned. A counter not seen before starts at the highest number in use
-- (for 'global', at least the number of entries, as old entries without an
-- entry_number were counted too). Its row stays locked until the caller's
-- transaction ends.
CREATE OR REPLACE FUNCTION wp_internal.je_counter(p_key TEXT, p_at_least INTEGER, p_next BOOLEAN)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v INTEGER;
    v_floor INTEGER;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.journal_entry_number_counters WHERE k = p_key) THEN
        IF p_key = 'global' THEN
            SELECT GREATEST(
                       (SELECT count(*) FROM public.journal_entries),
                       COALESCE((SELECT max((substring(entry_number FROM '^JE-(\d+)-'))::INTEGER)
                                   FROM public.journal_entries WHERE entry_number ~ '^JE-\d+-'), 0))::INTEGER
              INTO v_floor;
        ELSE
            SELECT COALESCE(max((substring(entry_number FROM '-(\d+)$'))::INTEGER), 0)
              INTO v_floor
              FROM public.journal_entries
             WHERE entry_number ~ ('^JE-\d+-' || p_key || '-\d+$');
        END IF;
        -- Two first-time callers at once: the second one's row is skipped.
        INSERT INTO public.journal_entry_number_counters (k, last_value) VALUES (p_key, v_floor)
        ON CONFLICT (k) DO NOTHING;
    END IF;
    UPDATE public.journal_entry_number_counters
       SET last_value = CASE WHEN p_next THEN last_value + 1 ELSE GREATEST(last_value, COALESCE(p_at_least, 0)) END
     WHERE k = p_key
    RETURNING last_value INTO v;
    RETURN v;
END;
$$;
DROP FUNCTION IF EXISTS wp_internal.je_next_counter(TEXT);

-- A fresh number of the same type and day as p_entry_number, or NULL when
-- p_entry_number is NULL or not JE-<n>-<TYPE>-<yyyymmdd>-<n>.
CREATE OR REPLACE FUNCTION wp_internal.je_fresh_number(p_entry_number TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    m TEXT[] := regexp_match(COALESCE(p_entry_number, ''), '^JE-\d+-([A-Z]+)-(\d{8})-\d+$');
    v_global INTEGER;
    v_daily INTEGER;
BEGIN
    IF m IS NULL THEN
        RETURN NULL;
    END IF;
    v_global := wp_internal.je_counter('global', NULL, true);
    v_daily := wp_internal.je_counter(m[1] || '-' || m[2], NULL, true);
    RETURN 'JE-' || v_global || '-' || m[1] || '-' || m[2] || '-' || lpad(v_daily::TEXT, 3, '0');
END;
$$;

-- p_description with p_old's <TYPE>-<yyyymmdd>-<nnn> replaced by p_new's.
CREATE OR REPLACE FUNCTION wp_internal.je_swap_ref(p_description TEXT, p_old TEXT, p_new TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE WHEN p_description IS NULL OR p_old IS NULL OR p_new IS NULL THEN p_description
                ELSE replace(p_description, regexp_replace(p_old, '^JE-\d+-', ''), regexp_replace(p_new, '^JE-\d+-', ''))
           END;
$$;

-- The <TYPE>-<yyyymmdd>-<nnn> a number is checked on (indexed).
CREATE OR REPLACE FUNCTION wp_internal.je_ref(p_entry_number TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$ SELECT regexp_replace(p_entry_number, '^JE-\d+-', '') $$;

CREATE INDEX IF NOT EXISTS journal_entries_entry_ref_idx
    ON public.journal_entries (wp_internal.je_ref(entry_number));

CREATE OR REPLACE FUNCTION wp_internal.je_assign_entry_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    m TEXT[] := regexp_match(COALESCE(NEW.entry_number, ''), '^JE-(\d+)-([A-Z]+)-(\d{8})-(\d+)$');
    v_new TEXT;
BEGIN
    IF m IS NULL THEN
        RETURN NEW;
    END IF;
    -- Lock the counters (global first, then the day's), raised to this
    -- number. An insert with the same ref waits here until this one commits.
    PERFORM wp_internal.je_counter('global', m[1]::INTEGER, false);
    PERFORM wp_internal.je_counter(m[2] || '-' || m[3], m[4]::INTEGER, false);
    IF NOT EXISTS (SELECT 1 FROM public.journal_entries
                    WHERE wp_internal.je_ref(entry_number) = wp_internal.je_ref(NEW.entry_number)) THEN
        RETURN NEW;
    END IF;
    v_new := wp_internal.je_fresh_number(NEW.entry_number);
    NEW.description := wp_internal.je_swap_ref(NEW.description, NEW.entry_number, v_new);
    NEW.entry_number := v_new;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS journal_entries_assign_number ON public.journal_entries;
CREATE TRIGGER journal_entries_assign_number
    BEFORE INSERT ON public.journal_entries
    FOR EACH ROW EXECUTE FUNCTION wp_internal.je_assign_entry_number();

-- The entries already saved: in each group sharing <TYPE>-<yyyymmdd>-<nnn>,
-- the oldest keeps its number and the others get fresh ones.
DO $$
DECLARE
    r RECORD;
    v_new TEXT;
    v_n INTEGER := 0;
BEGIN
    -- No new entry can take a number while the duplicates are renumbered.
    LOCK TABLE public.journal_entries IN SHARE ROW EXCLUSIVE MODE;
    FOR r IN
        SELECT id, entry_number, description
          FROM (SELECT id, entry_number, description, created_at,
                       row_number() OVER (PARTITION BY regexp_replace(entry_number, '^JE-\d+-', '')
                                          ORDER BY created_at, id) AS rn
                  FROM public.journal_entries
                 WHERE entry_number ~ '^JE-\d+-[A-Z]+-\d{8}-\d+$') x
         WHERE rn > 1
         ORDER BY created_at, id
    LOOP
        v_new := wp_internal.je_fresh_number(r.entry_number);
        UPDATE public.journal_entries
           SET entry_number = v_new,
               description = wp_internal.je_swap_ref(r.description, r.entry_number, v_new)
         WHERE id = r.id;
        v_n := v_n + 1;
    END LOOP;
    RAISE NOTICE 'Renumbered % journal entries that shared a number.', v_n;
END $$;
