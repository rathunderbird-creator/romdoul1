-- Get File marks the order courier-collected (COD). Run once in each
-- instance's Supabase SQL editor (Romdoul1, Romdoul2, Romdoul3), AFTER
-- add_cod_receivable.sql (it needs sales.cod_collected). Safe to re-run.
--
-- Why: "Get File" means the delivery company has collected the customer's
-- money and sent its settlement file, confirming the money will be remitted
-- as listed in the file. From that moment the money is with the courier, so
-- the order's receipt must debit 1210 COD receivable (courier), not the
-- cash/bank account. Until now sales.cod_collected was set only from the
-- Settle form's "អ្នកដឹកប្រមូល (COD)" box when the order was marked Paid —
-- set_order_payment ignores the flag on any other status — so the flag
-- stayed false through Get File, and a later Paid save that did not send
-- the box (the stored flag then decides) booked the bank.
--
-- What this file does:
--   A. a BEFORE INSERT / UPDATE OF payment_status trigger on sales:
--      * entering Get File (a row created at Get File, or one whose
--        payment_status changes to it, from any screen, bulk edit or
--        import) sets cod_collected = true, whatever the save sent;
--      * leaving Get File for a status that is not settled (Unpaid,
--        Deposit, PdFee, Cancel: a Get File set by mistake and taken back)
--        sets it false again, so the stored flag is the column default and
--        the app's shipping-state default decides once more;
--      * Get File -> Paid / Settled / Paid/Settled is left to the save: the
--        Settle form sends its box (ticked by default), and a save without
--        it books with the stored true;
--   B. backfills: every order at Get File now gets cod_collected = true
--      (nothing is booked by this — receipts already in the ledger keep
--      their debit).

CREATE SCHEMA IF NOT EXISTS wp_internal;

-- A. The trigger ------------------------------------------------------------
CREATE OR REPLACE FUNCTION wp_internal.sales_cod_on_get_file()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.payment_status = 'Get File'
       AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM 'Get File') THEN
        NEW.cod_collected := true;
    ELSIF TG_OP = 'UPDATE' AND OLD.payment_status = 'Get File'
          AND COALESCE(NEW.payment_status, '') NOT IN ('Get File', 'Paid', 'Settled', 'Paid/Settled') THEN
        NEW.cod_collected := false;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_cod_on_get_file ON public.sales;
CREATE TRIGGER sales_cod_on_get_file
    BEFORE INSERT OR UPDATE OF payment_status ON public.sales
    FOR EACH ROW EXECUTE FUNCTION wp_internal.sales_cod_on_get_file();

-- B. The orders already at Get File -----------------------------------------
UPDATE public.sales SET cod_collected = true
 WHERE payment_status = 'Get File' AND cod_collected IS DISTINCT FROM true;

-- Make PostgREST pick the change up immediately.
NOTIFY pgrst, 'reload schema';
