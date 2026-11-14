-- Riel (KHR) payments, phases 1-2. The books stay in USD: a riel payment
-- keeps the riel amount it was entered in (original_amount) and the shop
-- rate it used (exchange_rate); its USD amount = round(original / rate, 2).
-- NULL currency = USD (every row written before this file). Adds two riel
-- cash/bank accounts, 1002 "Cash on Hand (KHR)" and 1011 "Bank Account ABA
-- (KHR)".
--
-- Needs no FIFO pack and is safe to run on every store (Romdoul1/2/3), more
-- than once. Run it in each instance's Supabase SQL editor AFTER the app
-- version that understands it is deployed (the app writes the new columns
-- itself and skips them silently on a store that has not run this file).
--
-- The one function it touches, wp_internal.wp_cash_bank_match, is replaced
-- with the same signature and body plus a riel exclusion, so a payment sent
-- without an account (an old cached app version) never lands on a riel
-- account. add_wholesale_procurement_functions.sql carries the same body, so
-- a later pack re-run keeps it.

-- A. Currency columns ------------------------------------------------------
ALTER TABLE IF EXISTS transactions      ADD COLUMN IF NOT EXISTS currency TEXT;
ALTER TABLE IF EXISTS transactions      ADD COLUMN IF NOT EXISTS original_amount NUMERIC;
ALTER TABLE IF EXISTS transactions      ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC;
ALTER TABLE IF EXISTS customer_payments ADD COLUMN IF NOT EXISTS currency TEXT;
ALTER TABLE IF EXISTS customer_payments ADD COLUMN IF NOT EXISTS original_amount NUMERIC;
ALTER TABLE IF EXISTS customer_payments ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC;
ALTER TABLE IF EXISTS supplier_payments ADD COLUMN IF NOT EXISTS currency TEXT;
ALTER TABLE IF EXISTS supplier_payments ADD COLUMN IF NOT EXISTS original_amount NUMERIC;
ALTER TABLE IF EXISTS supplier_payments ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC;
ALTER TABLE IF EXISTS journal_entries   ADD COLUMN IF NOT EXISTS currency TEXT;
ALTER TABLE IF EXISTS journal_entries   ADD COLUMN IF NOT EXISTS original_amount NUMERIC;
ALTER TABLE IF EXISTS journal_entries   ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC;

-- One check per table: currency is USD / KHR / NULL, and a KHR row carries
-- its riel amount and a positive rate.
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['transactions','customer_payments','supplier_payments','journal_entries'] LOOP
        IF to_regclass('public.' || t) IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM pg_constraint
             WHERE conname = t || '_currency_check' AND conrelid = to_regclass('public.' || t)) THEN
            EXECUTE format(
                'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK ('
                || 'currency IS NULL OR currency = ''USD'' '
                || 'OR (currency = ''KHR'' AND original_amount IS NOT NULL AND COALESCE(exchange_rate, 0) > 0))',
                t, t || '_currency_check');
        END IF;
    END LOOP;
END $$;

-- B. The automatic cash/bank pick never lands on a riel account ------------
-- Same body as add_wholesale_procurement_functions.sql (mirrored there),
-- plus the riel exclusion. A riel account is still reachable by picking it:
-- wp_cash_bank_account's exact-name step does not use this function.
-- Skipped on a store without the server payment functions.
DO $$
BEGIN
    IF to_regprocedure('wp_internal.wp_cash_bank_match(text)') IS NOT NULL THEN
        EXECUTE $f$
            CREATE OR REPLACE FUNCTION wp_internal.wp_cash_bank_match(p_re TEXT)
            RETURNS UUID
            LANGUAGE sql
            STABLE
            AS $b$
                SELECT id FROM chart_of_accounts
                 WHERE is_active AND account_type = 'Asset' AND account_name ~* '(cash|bank)'
                   AND account_name !~* '(\mkhr\M|riel|៛)'
                   AND lower(account_name) ~ p_re
                 ORDER BY COALESCE(account_code, '')
                 LIMIT 1;
            $b$
        $f$;
    END IF;
END $$;

-- C. Riel accounts (only when the code is free) ----------------------------
INSERT INTO chart_of_accounts (account_code, account_name, account_type, is_active)
SELECT '1002', 'Cash on Hand (KHR)', 'Asset', true
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '1002');
INSERT INTO chart_of_accounts (account_code, account_name, account_type, is_active)
SELECT '1011', 'Bank Account ABA (KHR)', 'Asset', true
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '1011');
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'chart_of_accounts' AND column_name = 'sub_type') THEN
        UPDATE chart_of_accounts SET sub_type = 'Current Asset'
         WHERE account_code IN ('1002','1011') AND account_name ~* '\mkhr\M' AND sub_type IS NULL;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
