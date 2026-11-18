-- COD receivable (courier): the money a delivery company has collected from
-- customers and not yet remitted to the shop. Run once in each instance's
-- Supabase SQL editor (Romdoul1, Romdoul2, Romdoul3). Safe to re-run. Needs
-- nothing but the base schema — NOT the FIFO packs — so every store can run
-- it today.
--
-- Why: most retail orders are cash on delivery. The courier collects from the
-- customer and remits the day's takings to the shop's ABA account one or two
-- days later, in lumps. Staff mark an order Paid when the courier confirms
-- the money, and the receipt debited the bank account at once — so the
-- ledger's bank balance ran ahead of the real ABA balance by exactly what the
-- couriers still held (the 18 Nov 2026 bank reconciliation). The standard
-- fix, approved by the owner:
--   * a courier-collected payment debits 1210 COD receivable (courier)
--     instead of cash/bank (Dr 1210 / Cr 4000 Sales Revenue, plus COGS);
--   * the courier's remittance is booked when it lands: Dr 1011 Bank
--     Account ABA (KHR) (or 1010 for dollars) / Cr 1210 — Accounting ›
--     COD remittances, one Draft COD-REMIT-<n> entry per bank credit.
-- The 1210 balance is then "what the couriers still hold" and the bank
-- account agrees with the statement.
--
-- What this file does:
--   A. inserts 1210 "COD receivable (courier)" (Asset / Current Asset) when
--      the code is free; names it so it never matches the /cash|bank/
--      filters the reports use for cash;
--   B. adds sales.cod_collected (true = the courier collected this order's
--      money). The payment pack (add_order_payment_functions.sql) reads it
--      from the Settle form's "អ្នកដឹកប្រមូល (COD)" checkbox and books the
--      receipt to 1210 when it is set. The pack also adds this column itself
--      in case a store runs the pack first.
-- Nothing retroactive: receipts already booked keep their bank debit. On the
-- cutover day the owner books ONE opening entry by hand in Journal Entries,
-- Dr 1210 / Cr 1011, for the COD the couriers held at that moment (the sum
-- of the orders settled before cutover whose money had not yet reached ABA),
-- so the bank account agrees with the statement from then on.

-- A. The receivable account (only when the code is free) --------------------
INSERT INTO chart_of_accounts (account_code, account_name, account_type, description, is_active)
SELECT '1210', 'COD receivable (courier)', 'Asset',
       'Cash on delivery collected by the courier and not yet remitted to the shop', true
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '1210');

-- Its sub-type, where the chart has that column (add_account_subtype.sql).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'chart_of_accounts' AND column_name = 'sub_type') THEN
        UPDATE chart_of_accounts SET sub_type = 'Current Asset'
         WHERE account_code = '1210' AND sub_type IS NULL;
    END IF;
END $$;

-- B. The order flag ---------------------------------------------------------
-- (Not archived to deleted_orders: a deleted paid order loses its income row
-- and Draft entry anyway, and a restored one is settled again by hand.)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cod_collected BOOLEAN NOT NULL DEFAULT false;

-- Make PostgREST pick the new column up immediately.
NOTIFY pgrst, 'reload schema';
