-- Retail orders: creating an order, changing its payment, deleting orders and
-- the payment side of a restock each run inside the database, in one
-- transaction. Run once in each instance's Supabase SQL editor (Romdoul1,
-- Romdoul2, Romdoul3). Safe to re-run. Needs the helpers from
-- add_wholesale_procurement_functions.sql (the wp_internal schema), the
-- functions from add_order_status_function.sql, and the columns from
-- add_entry_status.sql, add_journal_entry_number.sql,
-- add_journal_entry_line_description.sql, add_transaction_order_link.sql and
-- add_transaction_reference_notes.sql (all three instances have them). The
-- "Deposit into" column (add_sales_deposit_account.sql) is added here too in
-- case an instance skipped it.
--
-- These used to be strings of separate writes from the browser. Creating a
-- paid order booked its income before the order existed, so a failed create
-- left revenue with no order and the retry booked it again; marking an order
-- Paid wrote the status, the income row and the journal entry as separate
-- requests, so a failure part-way left a half-saved payment; deleting a paid
-- order left its income and ledger entry on the books; and a restock cleaned
-- up income by customer name and amount, which could hit a different order of
-- the same customer. Each function here locks the order row(s) first, checks
-- the current state again, refuses with a plain message when the save no
-- longer fits (a stale screen, a double submit), and does every write in one
-- transaction: it happens completely or not at all.
--
-- They write the same rows, text, categories (លក់រាយ retail sale, កក់ប្រាក់
-- deposit, ថ្លៃដឹក delivery fee), entry numbers (JE-n-TYPE-ymd-nnn) and
-- account picks the app wrote before. Until this is run, creating an order
-- and saving a payment are refused with a message saying to run this file.
--
-- Journal entries on cleanup (one consistent rule, same as wholesale delete):
-- a Draft entry is deleted together with its income row; a POSTED entry is
-- final and stays, with a notice telling the user to record a reversing
-- entry manually. The income row itself is always removed.
--
-- Journal entries on a correction (LED-6): when a paid order's received
-- amount, settle date or riel details are corrected, or a deposit is
-- lowered, the income row's TX-<tx> entry follows it
-- (wp_internal.op_sync_tx_entry): a Draft is rewritten in place (same
-- entry number, COGS lines untouched); a POSTED one stays and the
-- difference is booked as ONE Draft TX-<tx>-ADJ (rewritten on later
-- corrections), with a notice. The app's riel details ride in
-- p_updates.money and are written to the row and its entries when the
-- store has the columns of add_khr_currency.sql.
--
-- Cash on delivery (add_cod_receivable.sql): a receipt the courier collected
-- (p_updates.cod_collected = true, the Settle form's "អ្នកដឹកប្រមូល (COD)"
-- box) debits 1210 COD receivable (courier) instead of the cash/bank account
-- — the money is not in the bank until the courier remits it (Accounting ›
-- COD remittances books Dr bank / Cr 1210 then). The flag is kept on
-- sales.cod_collected; flipping it on a paid order moves a Draft entry's
-- debit between 1210 and cash/bank (a POSTED one stays, with a notice).
-- Deposits and delivery fees are never COD.
--
-- COD payment methods (Sales Setup › Pay By): a Pay By listed in
-- app_config.data.codPaymentMethods (the key absent: a Method named COD)
-- means the courier collects, so a settlement paid by it is COD when the
-- save says nothing about cod_collected and the order was never marked
-- (wp_internal.op_cod_method — the app's forms start their box from the
-- same list). The save's own flag always wins. create_retail_order applies
-- the same default to a Paid checkout that sends no flag.
--
-- Get File booked as COD (Sales Setup › Shipping Company): for a courier
-- listed in app_config.data.codGetFileCompanies, Get File means the courier
-- collected the money and sent its settlement file, so entering Get File is
-- a settlement — the receipt (Dr 1210 / Cr 4000, plus COGS) is booked then,
-- for the full total, dated the user's local day, and sales.get_file_booked
-- is set (wp_internal.op_is_settled: the explicit marker, never inferred from
-- a date staff can edit). A later Paid books nothing more and keeps the
-- receipt's date; taking the Get File back to Unpaid / Cancel removes the
-- receipt like leaving Paid and clears the COD flag. A Paid order moved to
-- Get File for a ticked courier keeps its receipt (and is marked booked). A
-- Get File saved before its courier was ticked is not booked, so its Paid
-- books as usual.
--
-- Ordering with the shipping status: updateOrder runs the shipping change
-- (set_order_shipping_status, which owns stock) FIRST and the payment save
-- second. A refused shipping change therefore saves nothing at all, and a
-- refused payment save leaves a completed, consistent shipping change —
-- never a claimed payment without its stock move, which is the half-saved
-- state the old client-side ordering could leave.
--
-- FIFO costing. Settlement books COGS at each line's frozen FIFO cost
-- (sale_items.cogs_cost, taken when the goods shipped), or for a line that
-- has not shipped at a peek of the next layers (wp_internal.order_cogs_lines),
-- and records on each line what it booked (cogs_booked). A Draft entry that
-- carried COGS and is deleted (leaving Paid, deleting the order) takes its
-- amount off cogs_booked again. When booked COGS outlives its sale — an
-- order leaving Paid, a restocked order (apply_restock_payment_side) or a
-- deleted one whose COGS sits in a POSTED entry — a Draft
-- ORD-<id>-COGS-REV puts it back into Inventory. Deleting an order gives its lines' layers back to the pool.
-- RUN ORDER: add_fifo_costing.sql, fifo_rebuild_pool.sql, the four packs
-- (add_order_status_function.sql before this one), add_session_guards.sql;
-- this file refuses to load before the first two.
--
-- Retries after a lost reply: create_retail_order keeps the app's
-- client-generated order id, so the retry of a create whose reply was lost
-- finds the order already there and reports it as created instead of making
-- a second one (and a genuinely different order that collides on the id is
-- refused cleanly). set_order_payment takes the retry id the app picked for
-- the income row (p_updates.tx_id): when that row is already saved, the
-- income is not booked again.

-- FIFO costing must be in place (see add_order_status_function.sql for the
-- same check and its SET fifo.pool_ready override, which must NEVER be used
-- on Romdoul2 or Romdoul3).
DO $$
DECLARE
    v_rebuilt BOOLEAN := false;
BEGIN
    IF to_regprocedure('wp_internal.fifo_give_back_line(text,text,text)') IS NULL THEN
        RAISE EXCEPTION 'Run migrations/add_fifo_costing.sql first, then migrations/fifo_rebuild_pool.sql, then this file.';
    END IF;
    IF to_regclass('public.fifo_rebuild_log') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.fifo_rebuild_log)' INTO v_rebuilt;
    END IF;
    IF NOT v_rebuilt AND EXISTS (SELECT 1 FROM inventory_items)
       AND COALESCE(current_setting('fifo.pool_ready', true), '') <> 'on' THEN
        RAISE EXCEPTION 'Rebuild the FIFO pool first: run migrations/fifo_rebuild_pool.sql on this store, then this file.';
    END IF;
END $$;

-- "Deposit into" on sales — the account the settled amount landed in.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS deposit_account_id TEXT;
-- "The courier collected this order's money" (add_cod_receivable.sql owns
-- this column and the 1210 account; added here too so set_order_payment
-- never fails on a store that ran this pack first).
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cod_collected BOOLEAN NOT NULL DEFAULT false;
-- Who holds a COD order's money: 'courier' (default — the shipping
-- company, receivable 1210) or 'deliveryman' (the shop's own deliveryman,
-- receivable 1220). Chosen in the Collected popup; NULL means courier.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cod_holder TEXT;
-- A Get File whose receipt was booked as COD (Sales Setup's ticked couriers).
ALTER TABLE sales ADD COLUMN IF NOT EXISTS get_file_booked BOOLEAN NOT NULL DEFAULT false;

-- Deposits must survive delete+restore. full_schema.sql has these, but an
-- instance created before them may not (the standalone ALTER file never
-- shipped), and delete_retail_orders archives these columns unconditionally.
ALTER TABLE deleted_orders ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC DEFAULT 0;
ALTER TABLE deleted_orders ADD COLUMN IF NOT EXISTS deposit_date DATE;
ALTER TABLE deleted_orders ADD COLUMN IF NOT EXISTS deposit_method TEXT;
-- Sales Setup › Rejection Reasons: a deleted order keeps its reason (read
-- from sales through to_jsonb, so this works before add_sales_return_reason.sql).
ALTER TABLE deleted_orders ADD COLUMN IF NOT EXISTS return_reason TEXT;

-- The probe the app uses to ask whether this file has been run.
CREATE OR REPLACE FUNCTION order_payment_functions_ready()
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$ SELECT true $$;

-- ---------------------------------------------------------------------------
-- Helpers (wp_internal: not callable through the API on their own)
-- ---------------------------------------------------------------------------

-- An ISO timestamp as the app normalizes it: a plain YYYY-MM-DD day becomes
-- UTC midnight (new Date('…').toISOString()), anything else is taken as-is.
CREATE OR REPLACE FUNCTION wp_internal.op_norm_ts(p_raw TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE WHEN p_raw ~ '^\d{4}-\d{2}-\d{2}$' THEN (p_raw || 'T00:00:00Z')::timestamptz
                ELSE p_raw::timestamptz END;
$$;

-- The user's LOCAL calendar day of a stored instant (p_tz_min: minutes east
-- of UTC, e.g. 420 for ICT — the app sends -getTimezoneOffset()). A settle
-- stamped between midnight and 07:00 local lives on the previous UTC day, so
-- comparing UTC days would miss a genuine one-day correction (and move the
-- income row on a non-change). Port of the app's localDayOf.
CREATE OR REPLACE FUNCTION wp_internal.op_local_day(p_ts TIMESTAMPTZ, p_tz_min INT)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT ((p_ts AT TIME ZONE 'UTC') + make_interval(mins => COALESCE(p_tz_min, 0)))::date;
$$;

-- Same, for a raw value from the app: a plain YYYY-MM-DD day is already a
-- local day and passes through (as in localDayOf); a timestamp converts.
CREATE OR REPLACE FUNCTION wp_internal.op_local_day_of(p_raw TEXT, p_tz_min INT)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE WHEN p_raw ~ '^\d{4}-\d{2}-\d{2}$' THEN p_raw::date
                ELSE wp_internal.op_local_day(p_raw::timestamptz, p_tz_min) END;
$$;

-- One Income & Expense row, as the app writes it. Returns the row as jsonb
-- (the app adds it to its cached list).
CREATE OR REPLACE FUNCTION wp_internal.op_insert_income(
    p_id UUID, p_date TIMESTAMPTZ, p_category TEXT, p_amount NUMERIC, p_description TEXT,
    p_added_by TEXT, p_shipping_co TEXT, p_pay_by TEXT, p_reference TEXT, p_notes TEXT,
    p_order_id TEXT, p_customer_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    t transactions%ROWTYPE;
BEGIN
    INSERT INTO transactions (id, date, type, category, amount, description, added_by,
                              shipping_co, pay_by, reference, notes, order_id, customer_phone)
    VALUES (COALESCE(p_id, gen_random_uuid()), p_date, 'Income', p_category, p_amount, p_description,
            COALESCE(NULLIF(p_added_by, ''), 'System'), p_shipping_co, p_pay_by, p_reference, p_notes,
            p_order_id, p_customer_phone)
    RETURNING * INTO t;
    RETURN to_jsonb(t);
END;
$$;

-- ---------------------------------------------------------------------------
-- FIFO COGS bookkeeping: sale_items.cogs_booked is the COGS the ledger holds
-- for each line (every entry status, adjustments included), so the FIFO
-- check (wp_internal.fifo_inventory_check) can tie Inventory to the pool.
-- ---------------------------------------------------------------------------

-- What an entry moved out of Inventory: its Inventory (1300) credits minus
-- debits. The COGS an entry carried, for taking it off cogs_booked.
CREATE OR REPLACE FUNCTION wp_internal.op_entry_inventory_credit(p_entry UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(sum(COALESCE(l.credit, 0) - COALESCE(l.debit, 0)), 0)
      FROM journal_entry_lines l
     WHERE l.journal_entry_id = p_entry
       AND l.account_id = wp_internal.wp_account('1300', 'Asset', 'inventor|stock');
$$;

-- Adds a booking's per-line amounts ({sale_items.id: amount}, from
-- order_cogs_lines) to the lines' cogs_booked.
CREATE OR REPLACE FUNCTION wp_internal.op_mark_cogs_booked(p_order_id TEXT, p_lines JSONB)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE sale_items si SET cogs_booked = COALESCE(si.cogs_booked, 0) + (p_lines->>si.id::TEXT)::NUMERIC
     WHERE si.sale_id = p_order_id AND p_lines ? si.id::TEXT;
$$;

-- A Draft entry that carried p_amount of an order's COGS was deleted: the
-- amount comes off the lines' cogs_booked (all of it, NULL, when it is what
-- they hold; else split by what each holds, in cents). A deleted Draft
-- reversal (p_amount < 0, a COGS-REV) on an order that has nothing booked
-- puts its amount back on the product lines (os_spread_booked), whatever
-- the order's shipping status (a restocked order can be moved back to
-- Shipped before it is deleted): that COGS is booked again until another entry takes
-- it off or op_reverse_booked_cogs reverses it again. Callers drop a
-- reversal before the entries it reversed, so a Draft COGS plus its Draft
-- REV still net to nothing. Otherwise an order whose booking predates the
-- FIFO wiring (no line has cogs_booked) is adopted: while it holds its
-- goods, each line takes the cost of the layers it holds plus its missing
-- units at the fallback cost, as a shipped, unsettled FIFO order would.
-- Adoption does not re-base the history: deleting the old receipt gives
-- 1300 back its purchase-cost COGS X while the line adds its layer cost C
-- to the FIFO check's expected value, so the check moves by X - C, and
-- settling again at C keeps that difference.
CREATE OR REPLACE FUNCTION wp_internal.op_unbook_cogs(p_order_id TEXT, p_amount NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_total NUMERIC;
    v_n INTEGER;
    v_left NUMERIC := COALESCE(p_amount, 0);
    v_amt NUMERIC;
    r RECORD;
BEGIN
    IF COALESCE(p_amount, 0) = 0 THEN
        RETURN;
    END IF;
    SELECT COALESCE(sum(cogs_booked), 0), count(*)::int INTO v_total, v_n
      FROM sale_items WHERE sale_id = p_order_id AND cogs_booked IS NOT NULL;
    IF v_n = 0 THEN
        IF p_amount < 0 THEN
            PERFORM wp_internal.os_spread_booked(p_order_id, -p_amount);
        ELSIF order_status_holds_stock((SELECT shipping_status FROM sales WHERE id = p_order_id)) THEN
            UPDATE sale_items si SET
                cogs_cost = h.cost + GREATEST(COALESCE(si.quantity, 0) - h.n, 0) * wp_internal.fifo_fallback_cost(si.product_id),
                cogs_short_qty = GREATEST(COALESCE(si.quantity, 0) - h.n, 0)
              FROM (SELECT s2.id,
                           (SELECT count(*) FROM inventory_items ii
                             WHERE ii.status = 'sold' AND ii.consumer_kind = 'retail'
                               AND ii.consumer_id = p_order_id AND ii.consumer_line_id = s2.id::TEXT) AS n,
                           (SELECT COALESCE(sum(COALESCE(ii.cost_of_purchase, 0)), 0) FROM inventory_items ii
                             WHERE ii.status = 'sold' AND ii.consumer_kind = 'retail'
                               AND ii.consumer_id = p_order_id AND ii.consumer_line_id = s2.id::TEXT) AS cost
                      FROM sale_items s2 WHERE s2.sale_id = p_order_id) h
             WHERE si.id = h.id AND si.sale_id = p_order_id AND si.product_id IS NOT NULL
               AND si.cogs_cost IS NULL AND COALESCE(si.quantity, 0) > 0;
        END IF;
        RETURN;
    END IF;
    IF abs(v_total - p_amount) < 0.005 THEN
        UPDATE sale_items SET cogs_booked = NULL WHERE sale_id = p_order_id AND cogs_booked IS NOT NULL;
        RETURN;
    END IF;
    FOR r IN
        SELECT id, cogs_booked, row_number() OVER (ORDER BY abs(cogs_booked) DESC, id) AS rn
          FROM sale_items WHERE sale_id = p_order_id AND cogs_booked IS NOT NULL
         ORDER BY rn DESC
    LOOP
        v_amt := CASE WHEN r.rn = 1 THEN v_left
                      WHEN v_total <> 0 THEN round(p_amount * r.cogs_booked / v_total, 2)
                      ELSE 0 END;
        UPDATE sale_items SET cogs_booked = CASE WHEN abs(r.cogs_booked - v_amt) < 0.005 THEN NULL
                                                 ELSE r.cogs_booked - v_amt END
         WHERE id = r.id;
        v_left := v_left - v_amt;
    END LOOP;
END;
$$;

-- Deletes an order's Draft COGS-side entries with these references, taking
-- what each carried off cogs_booked (entries that put goods back into
-- Inventory first, so a reversal is undone before what it reversed).
-- Returns whether a non-Draft (Posted) one is left.
CREATE OR REPLACE FUNCTION wp_internal.op_drop_draft_cogs_entries(p_order_id TEXT, p_refs TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
    v_amt NUMERIC;
    v_posted BOOLEAN := false;
BEGIN
    FOR r IN SELECT id, COALESCE(status, 'Posted') AS status FROM journal_entries
              WHERE reference_id = ANY(p_refs)
              ORDER BY wp_internal.op_entry_inventory_credit(id) < 0 DESC, created_at, id FOR UPDATE
    LOOP
        IF r.status <> 'Draft' THEN
            v_posted := true;
        ELSE
            v_amt := wp_internal.op_entry_inventory_credit(r.id);
            DELETE FROM journal_entry_lines WHERE journal_entry_id = r.id;
            DELETE FROM journal_entries WHERE id = r.id;
            PERFORM wp_internal.op_unbook_cogs(p_order_id, v_amt);
        END IF;
    END LOOP;
    RETURN v_posted;
END;
$$;

-- Booked COGS whose goods are back (lines that hold no units but have
-- cogs_booked — a restocked or deleted order, once its Draft entries are
-- gone) goes back to Inventory: one Draft ORD-<id>-COGS-REV, Dr 1300 /
-- Cr 5000, and those lines' cogs_booked are cleared. Returns the amount
-- (0 when nothing was booked, or the chart lacks the accounts).
CREATE OR REPLACE FUNCTION wp_internal.op_reverse_booked_cogs(p_order_id TEXT, p_date DATE)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
    v_amt NUMERIC;
    v_n INTEGER;
BEGIN
    SELECT COALESCE(sum(cogs_booked), 0), count(*)::int INTO v_amt, v_n
      FROM sale_items WHERE sale_id = p_order_id AND cogs_cost IS NULL AND cogs_booked IS NOT NULL;
    IF v_n = 0 THEN
        RETURN 0;
    END IF;
    IF round(v_amt, 2) <> 0 AND NOT wp_internal.os_post_cogs_move(p_order_id, 'REV', -v_amt, p_date) THEN
        RETURN 0;
    END IF;
    UPDATE sale_items SET cogs_booked = NULL
     WHERE sale_id = p_order_id AND cogs_cost IS NULL AND cogs_booked IS NOT NULL;
    RETURN round(v_amt, 2);
END;
$$;

-- The retail receipt ledger entry (port of postRetailSaleToLedger): Dr the
-- cash/bank account, Cr Sales Revenue, and for an RCP entry with an order
-- also Dr Cost of Goods Sold / Cr Inventory at the items' FIFO cost
-- (order_cogs_lines: the frozen cost of what shipped, a peek of the next
-- layers for what has not), which each line then records as booked.
-- Numbered and described the way the app does ('Retail - RCP-… — Name').
-- Silently skipped (with a notice) when the chart of accounts can't resolve
-- both sides — the same no-op the app had.
-- p_cod (an RCP only): the courier collected the money, so the debit goes to
-- 1210 COD receivable (courier) instead of cash/bank (add_cod_receivable.sql);
-- a store without that account books cash/bank as before, with a notice.

-- The active COD receivable account: 1210, else an Asset whose name says so.
-- Get File booked as COD (Sales Setup › Shipping Company, "Get File books
-- the COD receipt"): for a courier ticked there, Get File means the courier
-- collected the customer's money and sent its settlement file, so entering
-- Get File books the receipt at once — Dr 1210 COD receivable (courier) /
-- Cr 4000 (plus COGS), dated that day — instead of waiting for Paid. The
-- ticked couriers live in app_config.data.codGetFileCompanies (names,
-- matched case- and space-insensitively).
CREATE OR REPLACE FUNCTION wp_internal.op_get_file_books_cod(p_company TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(btrim(p_company), '') <> '' AND EXISTS (
        SELECT 1
          FROM app_config c,
               jsonb_array_elements_text(CASE WHEN jsonb_typeof(c.data->'codGetFileCompanies') = 'array'
                                              THEN c.data->'codGetFileCompanies' ELSE '[]'::jsonb END) x
         WHERE c.id::TEXT = '1' AND lower(btrim(x)) = lower(btrim(p_company)));
$$;

-- Whether entering Collected books the COD receipt (Dr 1210/1220 / Cr
-- revenue) at once. Sales Setup › Sales Payment can turn that off
-- (salesSettings.collectedStatusOnly = true): Collected is then a plain
-- tracking status — nothing books until the order turns Paid — the
-- pre-Collected-booking behavior. Orders booked while it was on keep
-- their receipts (sales.cod_collected marks them) and settle the booked
-- way. The app's twin gate is utils/getFileSave getFileAsksAmount.
CREATE OR REPLACE FUNCTION wp_internal.op_collected_books_cod()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT NOT COALESCE((SELECT (c.data->'salesSettings'->>'collectedStatusOnly')::BOOLEAN
                           FROM app_config c WHERE c.id::TEXT = '1'), false);
$$;

-- Whether a Pay By is one of Sales Setup › Pay By's "COD payment methods"
-- (app_config.data.codPaymentMethods, names compared case- and
-- space-insensitively). With the key never saved, a Method named COD. The
-- app's twin is utils/cashBankAccounts isCodPaymentMethod /
-- defaultCodPaymentMethods.
CREATE OR REPLACE FUNCTION wp_internal.op_cod_method(p_method TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(btrim(p_method), '') <> '' AND EXISTS (
        SELECT 1
          FROM app_config c,
               jsonb_array_elements_text(CASE WHEN jsonb_typeof(c.data->'codPaymentMethods') = 'array'
                                              THEN c.data->'codPaymentMethods' ELSE '["COD"]'::jsonb END) x
         WHERE c.id::TEXT = '1' AND lower(btrim(x)) = lower(btrim(p_method)));
$$;

-- Whether an order at this payment status has its receipt on the books:
-- Paid / Settled / Paid/Settled, or a Get File booked as COD
-- (sales.get_file_booked).
DROP FUNCTION IF EXISTS wp_internal.op_is_settled(TEXT, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION wp_internal.op_is_settled(p_status TEXT, p_get_file_booked BOOLEAN)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COALESCE(p_status, '') IN ('Paid', 'Settled', 'Paid/Settled', 'Collected')
        OR (p_status = 'Get File' AND COALESCE(p_get_file_booked, false));
$$;

CREATE OR REPLACE FUNCTION wp_internal.op_cod_account()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT wp_internal.wp_account('1210', 'Asset', 'cod receivable');
$$;

-- The receivable a COD receipt debits, by who holds the money:
-- 'deliveryman' resolves 1220 COD receivable (Deliveryman); anything else,
-- or a store without a deliveryman account, resolves the courier's 1210.
-- The booking (op_post_receipt_entry) notices the deliveryman fallback;
-- everywhere else it is silent.
CREATE OR REPLACE FUNCTION wp_internal.op_cod_account(p_holder TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        CASE WHEN lower(COALESCE(p_holder, '')) = 'deliveryman'
             THEN wp_internal.wp_account('1220', 'Asset', 'receivable.*deliveryman|deliveryman.*receivable') END,
        wp_internal.op_cod_account());
$$;

-- The signature grew parameters with defaults; the old ones must go or a
-- shorter call would match several and be refused as ambiguous.
DROP FUNCTION IF EXISTS wp_internal.op_post_receipt_entry(TEXT, DATE, TEXT, UUID, NUMERIC, UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS wp_internal.op_post_receipt_entry(TEXT, DATE, TEXT, UUID, NUMERIC, UUID, TEXT, TEXT, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION wp_internal.op_post_receipt_entry(
    p_type TEXT, p_date DATE, p_name TEXT, p_tx UUID, p_amount NUMERIC,
    p_account_id UUID, p_pay_by TEXT, p_cogs_order TEXT, p_status TEXT DEFAULT 'Draft',
    p_cod BOOLEAN DEFAULT false, p_cod_holder TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_revenue UUID := wp_internal.wp_account('4000', 'Revenue', 'sales revenue', true);
    v_cash UUID := COALESCE(p_account_id, wp_internal.wp_cash_bank_account(p_pay_by, true));
    v_cod BOOLEAN := COALESCE(p_cod, false) AND p_type = 'RCP';
    v_desc TEXT := 'Receipt';
    v_notice TEXT;
    v_cogs UUID;
    v_inventory UUID;
    v_cost NUMERIC := 0;
    v_lines JSONB;
    v_number TEXT;
    v_entry UUID;
BEGIN
    IF v_cod THEN
        -- The courier (or the shop's own deliveryman, p_cod_holder
        -- 'deliveryman') holds the money: debit that receivable, not the
        -- bank. The picked cash/bank account is where it will land later.
        IF wp_internal.op_cod_account(p_cod_holder) IS NOT NULL THEN
            v_cash := wp_internal.op_cod_account(p_cod_holder);
            IF lower(COALESCE(p_cod_holder, '')) = 'deliveryman' AND v_cash = wp_internal.op_cod_account() THEN
                v_desc := 'COD held by courier';
                v_notice := 'There is no COD receivable (Deliveryman) account in the Chart of Accounts — add an Asset account with code 1220 named ''COD receivable (Deliveryman)''. The receipt was booked to the courier receivable (1210) instead.';
            ELSE
                v_desc := CASE WHEN lower(COALESCE(p_cod_holder, '')) = 'deliveryman'
                               THEN 'COD held by deliveryman' ELSE 'COD held by courier' END;
            END IF;
        ELSE
            v_notice := 'This payment was marked as collected by the courier, but there is no 1210 COD receivable (courier) account yet — run migrations/add_cod_receivable.sql. The receipt was booked to the cash/bank account instead.';
        END IF;
    END IF;
    IF v_revenue IS NULL OR v_cash IS NULL THEN
        RETURN 'Payment logged, but no Sales Revenue or cash/bank account could be resolved in the Chart of Accounts — no ledger entry was posted.';
    END IF;
    IF p_type = 'RCP' AND p_cogs_order IS NOT NULL THEN
        v_cogs := wp_internal.wp_account('5000', 'Expense', 'cost of goods|cogs');
        v_inventory := wp_internal.wp_account('1300', 'Asset', 'inventor|stock');
        IF v_cogs IS NOT NULL AND v_inventory IS NOT NULL THEN
            SELECT COALESCE(jsonb_object_agg(c.line_id, c.amount), '{}'::jsonb), COALESCE(sum(c.amount), 0)
              INTO v_lines, v_cost
              FROM wp_internal.order_cogs_lines(p_cogs_order) c;
        END IF;
    END IF;
    v_number := wp_internal.wp_next_entry_number(p_type, p_date);
    INSERT INTO journal_entries (date, description, reference_id, status, entry_number)
    VALUES (COALESCE(p_date, CURRENT_DATE), 'Retail - ' || regexp_replace(v_number, '^JE-\d+-', '') || ' — ' || p_name,
            'TX-' || p_tx, COALESCE(p_status, 'Draft'), v_number)
    RETURNING id INTO v_entry;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_entry, v_cash, p_amount, 0,
         -- v_desc says who holds COD money ('COD held by courier' /
         -- 'COD held by deliveryman'), or 'Receipt' when the money is on
         -- a cash/bank account (non-COD, or no receivable to book to).
         CASE WHEN p_type = 'DEP' THEN 'Deposit' ELSE v_desc END || ' — ' || p_name),
        (v_entry, v_revenue, 0, p_amount, 'Sales — ' || p_name);
    IF v_cost > 0 THEN
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
            (v_entry, v_cogs, v_cost, 0, 'Cost of goods sold'),
            (v_entry, v_inventory, 0, v_cost, 'Inventory at cost');
        PERFORM wp_internal.op_mark_cogs_booked(p_cogs_order, v_lines);
    END IF;
    RETURN v_notice;
END;
$$;

-- Moves a paid order's receipt debit between 1210 COD receivable and the
-- cash/bank account when the "collected by the courier" flag is flipped on
-- an order that is already Paid. The row's TX-<tx> entry and its Draft
-- TX-<tx>-ADJ are re-pointed while Draft; a POSTED TX-<tx> entry stays and
-- the notice says so. Nothing when the order has no receipt entry.
-- The signature grew p_cod_holder; the old one must go or a four-argument
-- call would match both and be refused as ambiguous.
DROP FUNCTION IF EXISTS wp_internal.op_repoint_receipt_debit(TEXT, BOOLEAN, UUID, TEXT);
CREATE OR REPLACE FUNCTION wp_internal.op_repoint_receipt_debit(p_order_id TEXT, p_cod BOOLEAN, p_account_id UUID, p_pay_by TEXT, p_cod_holder TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_tx UUID;
    v_main RECORD;
    v_target UUID;
    v_label TEXT := 'Receipt';
    v_inventory UUID := wp_internal.wp_account('1300', 'Asset', 'inventor|stock');
BEGIN
    SELECT id INTO v_tx FROM transactions
     WHERE type = 'Income' AND category IN ('លក់រាយ', 'លក់ឥវ៉ាន់') AND order_id = p_order_id
     ORDER BY created_at DESC, id DESC LIMIT 1;
    IF v_tx IS NULL THEN RETURN NULL; END IF;
    IF (SELECT count(*) FROM transactions
         WHERE type = 'Income' AND category IN ('លក់រាយ', 'លក់ឥវ៉ាន់') AND order_id = p_order_id) > 1 THEN
        -- A split settlement's two receipts stay where they were booked.
        RETURN 'This order was settled as a split payment: its receipts stay on their accounts — un-pay and settle again to change the COD side.';
    END IF;
    SELECT id, COALESCE(status, 'Posted') AS status, entry_number INTO v_main
      FROM journal_entries WHERE reference_id = 'TX-' || v_tx ORDER BY created_at, id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF p_cod THEN
        -- The receivable for who holds the money; a missing deliveryman
        -- account falls back to the courier's 1210 (op_cod_account).
        v_target := wp_internal.op_cod_account(p_cod_holder);
        IF v_target IS NULL THEN
            RETURN 'There is no 1210 COD receivable (courier) account yet — run migrations/add_cod_receivable.sql. The receipt stays on the cash/bank account.';
        END IF;
        v_label := CASE WHEN lower(COALESCE(p_cod_holder, '')) = 'deliveryman' AND v_target IS DISTINCT FROM wp_internal.op_cod_account()
                        THEN 'COD held by deliveryman' ELSE 'COD held by courier' END;
    ELSE
        v_target := COALESCE(p_account_id, wp_internal.wp_cash_bank_account(p_pay_by, true));
        IF v_target IS NULL THEN RETURN NULL; END IF;
    END IF;
    IF v_main.status <> 'Draft' THEN
        RETURN format('This payment''s ledger entry (%s) is POSTED, so its %s side was left as it is — book the move in Journal Entries (%s).',
                      COALESCE(v_main.entry_number, 'TX-' || v_tx),
                      CASE WHEN p_cod THEN 'cash/bank' ELSE 'COD receivable' END,
                      CASE WHEN p_cod THEN 'Dr 1210 COD receivable / Cr cash/bank' ELSE 'Dr cash/bank / Cr 1210 COD receivable' END);
    END IF;
    -- The money side of the Draft entry and of its Draft correction: the
    -- Asset lines that are not Inventory (COGS credits 1300).
    UPDATE journal_entry_lines l SET account_id = v_target
      FROM journal_entries e, chart_of_accounts a
     WHERE l.journal_entry_id = e.id AND a.id = l.account_id
       AND e.reference_id IN ('TX-' || v_tx, 'TX-' || v_tx || '-ADJ') AND COALESCE(e.status, 'Posted') = 'Draft'
       AND a.account_type = 'Asset' AND (v_inventory IS NULL OR a.id <> v_inventory) AND a.account_code IS DISTINCT FROM '1300';
    UPDATE journal_entry_lines l SET description = regexp_replace(l.description,
               '^(COD held by courier|COD held by deliveryman|Receipt)( — )', v_label || '\2')
      FROM journal_entries e
     WHERE l.journal_entry_id = e.id AND e.id = v_main.id AND l.account_id = v_target AND l.description ~ '^(COD held by courier|COD held by deliveryman|Receipt) — ';
    RETURN NULL;
END;
$$;

-- The COGS-only entry for an order whose deposit covered the whole total
-- (port of postRetailCogsOnlyEntry): Dr Cost of Goods Sold / Cr Inventory at
-- the items' FIFO cost (as op_post_receipt_entry), reference
-- 'ORD-<id>-COGS'. Skipped while the order's COGS entries net above 0
-- (os_order_cogs_net), so it is never booked twice; once a COGS-REV has
-- reversed it, settling again books it again.
CREATE OR REPLACE FUNCTION wp_internal.op_post_cogs_only(p_order_id TEXT, p_date DATE, p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_cogs UUID := wp_internal.wp_account('5000', 'Expense', 'cost of goods|cogs');
    v_inventory UUID := wp_internal.wp_account('1300', 'Asset', 'inventor|stock');
    v_cost NUMERIC;
    v_lines JSONB;
    v_number TEXT;
    v_entry UUID;
BEGIN
    IF round(wp_internal.os_order_cogs_net(p_order_id), 2) > 0 THEN RETURN; END IF;
    IF v_cogs IS NULL OR v_inventory IS NULL THEN RETURN; END IF;
    SELECT COALESCE(jsonb_object_agg(c.line_id, c.amount), '{}'::jsonb), COALESCE(sum(c.amount), 0)
      INTO v_lines, v_cost
      FROM wp_internal.order_cogs_lines(p_order_id) c;
    IF COALESCE(v_cost, 0) <= 0 THEN RETURN; END IF;
    v_number := wp_internal.wp_next_entry_number('RCP', p_date);
    INSERT INTO journal_entries (date, description, reference_id, status, entry_number)
    VALUES (COALESCE(p_date, CURRENT_DATE), 'Retail - ' || regexp_replace(v_number, '^JE-\d+-', '') || ' — ' || p_name || ' · cost of goods sold',
            'ORD-' || p_order_id || '-COGS', 'Draft', v_number)
    RETURNING id INTO v_entry;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_entry, v_cogs, v_cost, 0, 'Cost of goods sold'),
        (v_entry, v_inventory, 0, v_cost, 'Inventory at cost');
    PERFORM wp_internal.op_mark_cogs_booked(p_order_id, v_lines);
END;
$$;

-- Whether a table carries the riel columns of add_khr_currency.sql
-- (currency / original_amount / exchange_rate). A store that has not run
-- that file answers false, and the writes below are skipped.
CREATE OR REPLACE FUNCTION wp_internal.op_has_currency_cols(p_table TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (SELECT 1 FROM pg_attribute
                    WHERE attrelid = to_regclass('public.' || p_table) AND attname = 'exchange_rate' AND NOT attisdropped);
$$;

-- Writes a row's riel details (p_money: {"currency", "original_amount",
-- "exchange_rate"}, as the app's MoneyMeta) when the table has the columns:
-- KHR with its riel amount and rate, anything else back to NULL (= USD).
-- A KHR without a riel amount or a positive rate (which the check
-- constraint refuses) is left alone. Nothing with p_money NULL.
CREATE OR REPLACE FUNCTION wp_internal.op_set_currency(p_table TEXT, p_id UUID, p_money JSONB)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_orig NUMERIC := NULLIF(p_money->>'original_amount', '')::NUMERIC;
    v_rate NUMERIC := NULLIF(p_money->>'exchange_rate', '')::NUMERIC;
BEGIN
    IF p_money IS NULL OR p_id IS NULL OR NOT wp_internal.op_has_currency_cols(p_table) THEN RETURN; END IF;
    IF p_money->>'currency' = 'KHR' THEN
        IF v_orig IS NULL OR COALESCE(v_rate, 0) <= 0 THEN RETURN; END IF;
        EXECUTE format('UPDATE public.%I SET currency = $1, original_amount = $2, exchange_rate = $3 WHERE id = $4', p_table)
          USING 'KHR', v_orig, v_rate, p_id;
    ELSE
        EXECUTE format('UPDATE public.%I SET currency = NULL, original_amount = NULL, exchange_rate = NULL WHERE id = $1', p_table)
          USING p_id;
    END IF;
END;
$$;

-- Brings an income row's ledger entry (reference TX-<tx>: a Draft RCP or
-- DEP from op_post_receipt_entry) to the row's corrected amount and date —
-- LED-6: a paid order's corrected received amount or settle date used to
-- reach the income row and never its entry.
--   * A Draft entry is rewritten in place, same entry_number: its date,
--     its cash/bank debit and its revenue credit become p_amount; the COGS
--     lines (Dr 5000 / Cr 1300) stay as they are. With p_money, its riel
--     details follow. A Draft TX-<tx>-ADJ left from an earlier correction
--     is redundant then and is deleted.
--   * A POSTED entry is final and stays. The difference between what the
--     Posted entries of this row (TX-<tx> and any Posted TX-<tx>-ADJ) hold
--     in revenue and p_amount is booked as ONE Draft TX-<tx>-ADJ dated
--     p_adj_date — Dr cash/bank, Cr revenue for an increase, the reverse
--     for a decrease — reusing (rewriting) an existing Draft ADJ so repeated
--     corrections never stack. A riel row's ADJ carries the delta in riel at
--     the row's rate. A date-only change of a Posted entry books nothing and
--     the notice says the date was left.
-- p_date: the Draft entry's new date (NULL: keep it). p_money: the row's
-- riel details as sent by the app (NULL: the row's own currency columns).
-- Nothing when the row has no TX-<tx> entry (never posted to the ledger).
-- Returns the notice for the user, or NULL.
CREATE OR REPLACE FUNCTION wp_internal.op_sync_tx_entry(
    p_tx UUID, p_amount NUMERIC, p_date DATE, p_adj_date DATE, p_money JSONB DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_main RECORD;
    v_cash UUID;
    v_rev UUID;
    v_tx JSONB;
    v_rate NUMERIC;
    v_posted NUMERIC;
    v_target NUMERIC;
    v_delta NUMERIC;
    v_adj UUID;
    v_adj_number TEXT;
    v_adj_date DATE := COALESCE(p_adj_date, p_date, CURRENT_DATE);
    v_type TEXT;
    v_name TEXT;
    v_number TEXT;
    r RECORD;
BEGIN
    SELECT id, COALESCE(status, 'Posted') AS status, entry_number, description, date INTO v_main
      FROM journal_entries WHERE reference_id = 'TX-' || p_tx
     ORDER BY created_at, id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    -- The entry's cash side is its one Asset debit (the COGS debit is an
    -- Expense, the Inventory credit an Asset credit); its revenue side the
    -- one Revenue credit.
    SELECT l.account_id INTO v_cash FROM journal_entry_lines l JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE l.journal_entry_id = v_main.id AND COALESCE(l.debit, 0) > 0 AND a.account_type = 'Asset'
     ORDER BY l.debit DESC, l.created_at LIMIT 1;
    SELECT l.account_id INTO v_rev FROM journal_entry_lines l JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE l.journal_entry_id = v_main.id AND COALESCE(l.credit, 0) > 0 AND a.account_type = 'Revenue'
     ORDER BY l.credit DESC, l.created_at LIMIT 1;
    IF v_cash IS NULL OR v_rev IS NULL THEN
        RETURN format('This payment''s ledger entry (%s) has no plain cash and revenue lines, so it was left as it was — correct it in Journal Entries.',
                      COALESCE(v_main.entry_number, 'TX-' || p_tx));
    END IF;
    SELECT to_jsonb(t) INTO v_tx FROM transactions t WHERE t.id = p_tx;
    v_rate := CASE WHEN p_money IS NOT NULL
                   THEN CASE WHEN p_money->>'currency' = 'KHR' THEN NULLIF(p_money->>'exchange_rate', '')::NUMERIC END
                   WHEN v_tx->>'currency' = 'KHR' THEN NULLIF(v_tx->>'exchange_rate', '')::NUMERIC END;
    -- Revenue the POSTED entries of this row already hold.
    SELECT COALESCE(sum(COALESCE(l.credit, 0) - COALESCE(l.debit, 0)), 0) INTO v_posted
      FROM journal_entries e JOIN journal_entry_lines l ON l.journal_entry_id = e.id
     WHERE e.reference_id IN ('TX-' || p_tx, 'TX-' || p_tx || '-ADJ')
       AND COALESCE(e.status, 'Posted') <> 'Draft' AND l.account_id = v_rev;
    v_target := round(COALESCE(p_amount, 0), 2);

    IF v_main.status = 'Draft' THEN
        UPDATE journal_entries SET date = COALESCE(p_date, date) WHERE id = v_main.id;
        UPDATE journal_entry_lines SET debit = round(v_target - v_posted, 2)
         WHERE journal_entry_id = v_main.id AND account_id = v_cash AND COALESCE(debit, 0) > 0;
        UPDATE journal_entry_lines SET credit = round(v_target - v_posted, 2)
         WHERE journal_entry_id = v_main.id AND account_id = v_rev AND COALESCE(credit, 0) > 0;
        PERFORM wp_internal.op_set_currency('journal_entries', v_main.id, p_money);
        FOR r IN SELECT id FROM journal_entries
                  WHERE reference_id = 'TX-' || p_tx || '-ADJ' AND status = 'Draft' FOR UPDATE
        LOOP
            DELETE FROM journal_entry_lines WHERE journal_entry_id = r.id;
            DELETE FROM journal_entries WHERE id = r.id;
        END LOOP;
        RETURN NULL;
    END IF;

    v_delta := round(v_target - v_posted, 2);
    -- One Draft ADJ at most: the first is rewritten, any other deleted.
    FOR r IN SELECT id, entry_number FROM journal_entries
              WHERE reference_id = 'TX-' || p_tx || '-ADJ' AND status = 'Draft' ORDER BY created_at, id FOR UPDATE
    LOOP
        DELETE FROM journal_entry_lines WHERE journal_entry_id = r.id;
        IF v_adj IS NULL AND v_delta <> 0 THEN
            v_adj := r.id;
            v_adj_number := r.entry_number;
        ELSE
            DELETE FROM journal_entries WHERE id = r.id;
        END IF;
    END LOOP;
    IF v_delta = 0 THEN
        IF p_date IS NOT NULL AND p_date <> v_main.date THEN
            RETURN format('This payment''s ledger entry (%s) is POSTED, so its date was left as %s — correct it in Journal Entries.',
                          COALESCE(v_main.entry_number, 'TX-' || p_tx), to_char(v_main.date, 'YYYY-MM-DD'));
        END IF;
        RETURN NULL;
    END IF;
    v_type := COALESCE(substring(v_main.entry_number FROM '^JE-\d+-([A-Z]+)-'), 'RCP');
    v_name := COALESCE(NULLIF(substring(v_main.description FROM ' — (.*)$'), ''), NULLIF(v_tx->>'description', ''), 'Customer');
    IF v_adj IS NULL THEN
        v_number := wp_internal.wp_next_entry_number(v_type, v_adj_date);
        INSERT INTO journal_entries (date, description, reference_id, status, entry_number)
        VALUES (v_adj_date, 'Retail - ' || regexp_replace(v_number, '^JE-\d+-', '') || ' — ' || v_name
                || CASE WHEN v_type = 'DEP' THEN ' · deposit correction' ELSE ' · receipt correction' END,
                'TX-' || p_tx || '-ADJ', 'Draft', v_number)
        RETURNING id INTO v_adj;
        v_adj_number := v_number;
    ELSE
        UPDATE journal_entries SET date = v_adj_date WHERE id = v_adj;
    END IF;
    IF v_delta > 0 THEN
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
            (v_adj, v_cash, v_delta, 0, CASE WHEN v_type = 'DEP' THEN 'Deposit' ELSE 'Receipt' END || ' correction — ' || v_name),
            (v_adj, v_rev, 0, v_delta, 'Sales correction — ' || v_name);
    ELSE
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
            (v_adj, v_rev, -v_delta, 0, 'Sales correction — ' || v_name),
            (v_adj, v_cash, 0, -v_delta, CASE WHEN v_type = 'DEP' THEN 'Deposit' ELSE 'Receipt' END || ' correction — ' || v_name);
    END IF;
    PERFORM wp_internal.op_set_currency('journal_entries', v_adj,
        CASE WHEN COALESCE(v_rate, 0) > 0
             THEN jsonb_build_object('currency', 'KHR', 'original_amount', round(abs(v_delta) * v_rate), 'exchange_rate', v_rate)
             ELSE '{"currency": "USD"}'::jsonb END);
    RETURN format('This payment''s ledger entry (%s) is POSTED and stays as it is, so the correction ($%s %s) was booked as a Draft adjusting entry (%s).',
                  COALESCE(v_main.entry_number, 'TX-' || p_tx), to_char(abs(v_delta), 'FM999999999990.00'),
                  CASE WHEN v_delta > 0 THEN 'more' ELSE 'less' END, v_adj_number);
END;
$$;

-- Takes an income row's ledger entry off the books: a Draft one is deleted
-- (the COGS it carried comes off its order's cogs_booked); a Posted one is
-- final and stays, and the notice says so. A correction's TX-<tx>-ADJ
-- (op_sync_tx_entry) goes the same way.
CREATE OR REPLACE FUNCTION wp_internal.op_remove_tx_entry(p_tx UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
    v_notice TEXT;
    v_amt NUMERIC;
    v_order TEXT;
BEGIN
    SELECT order_id INTO v_order FROM transactions WHERE id = p_tx;
    FOR r IN SELECT id, COALESCE(status, 'Posted') AS status FROM journal_entries
              WHERE reference_id IN ('TX-' || p_tx, 'TX-' || p_tx || '-ADJ') FOR UPDATE
    LOOP
        IF r.status <> 'Draft' THEN
            v_notice := 'This payment has a POSTED ledger entry — record a reversing entry manually.';
        ELSE
            v_amt := wp_internal.op_entry_inventory_credit(r.id);
            DELETE FROM journal_entry_lines WHERE journal_entry_id = r.id;
            DELETE FROM journal_entries WHERE id = r.id;
            IF v_order IS NOT NULL THEN
                PERFORM wp_internal.op_unbook_cogs(v_order, v_amt);
            END IF;
        END IF;
    END LOOP;
    RETURN v_notice;
END;
$$;

-- The leaving-Paid cleanup: this order's booked sales income (matched by
-- order_id ONLY — never by customer name and amount, which could hit a
-- same-name same-amount sibling order) and its ledger entry, and the
-- order's COGS with it: once it is no longer Paid, its lines have nothing
-- booked and its COGS entries net to 0.
--   * With a receipt row: its Draft entry is deleted (with the COGS it
--     carried), and so are the Draft ship-time ORD-<id>-COGS-ADJ when no
--     ORD-<id>-COGS exists.
--   * Without one (a deposit covered the total): the order's Draft
--     ORD-<id>-COGS-REV, -COGS and -COGS-ADJ are deleted, reversals first.
--   * COGS still booked after that sits in POSTED entries: a Draft
--     ORD-<id>-COGS-REV reverses it, and the notice says to reverse only
--     the cash and revenue by hand.
--   * A POSTED COGS-REV left without the COGS it reversed is offset by a
--     Draft ORD-<id>-COGS-ADJ.
-- p_date dates the entries booked here (NULL: today).
-- Returns {"removed": [tx ids], "notices": […]}.
DROP FUNCTION IF EXISTS wp_internal.op_remove_paid_income(TEXT);
CREATE OR REPLACE FUNCTION wp_internal.op_remove_paid_income(p_order_id TEXT, p_date DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_date DATE := COALESCE(p_date, CURRENT_DATE);
    v_tx UUID;
    v_removed JSONB := '[]'::jsonb;
    v_notices TEXT[] := '{}';
    v_notice TEXT;
    v_posted BOOLEAN := false;
    v_rem NUMERIC;
    v_base NUMERIC;
    v_gap NUMERIC;
    -- Every linked retail income row: one for an ordinary settlement, two
    -- for a split (dollar + riel) one. All of them are taken back together.
    v_txs_all UUID[];
    v_notice2 TEXT;
BEGIN
    SELECT array_agg(id ORDER BY created_at, id) INTO v_txs_all FROM transactions
     WHERE type = 'Income' AND category IN ('លក់រាយ', 'លក់ឥវ៉ាន់') AND order_id = p_order_id;
    v_tx := CASE WHEN v_txs_all IS NOT NULL THEN v_txs_all[array_upper(v_txs_all, 1)] END;
    -- What the lines have booked less the COGS of the entries in view: the
    -- share held by a POSTED receipt whose income row an earlier un-pay
    -- removed. Taken before anything is removed, as delete_retail_orders does.
    v_base := COALESCE((SELECT sum(cogs_booked) FROM sale_items WHERE sale_id = p_order_id), 0)
              - wp_internal.os_order_cogs_net(p_order_id);
    IF v_txs_all IS NOT NULL THEN
        -- An order edited down to no product line carries a Draft COGS-REV
        -- of what this receipt booked (edit_order_items): when the receipt
        -- is a Draft too, the REV goes first so the two cancel out.
        IF NOT EXISTS (SELECT 1 FROM sale_items WHERE sale_id = p_order_id AND product_id IS NOT NULL)
           AND EXISTS (SELECT 1 FROM journal_entries je WHERE je.status = 'Draft'
                        AND je.reference_id IN (SELECT 'TX-' || t FROM unnest(v_txs_all) t)) THEN
            PERFORM wp_internal.op_drop_draft_cogs_entries(p_order_id, ARRAY['ORD-' || p_order_id || '-COGS-REV']);
        END IF;
        FOREACH v_tx IN ARRAY v_txs_all LOOP
            v_notice2 := wp_internal.op_remove_tx_entry(v_tx);
            IF v_notice2 IS NOT NULL THEN v_notice := COALESCE(v_notice, v_notice2); END IF;
        END LOOP;
        IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE reference_id = 'ORD-' || p_order_id || '-COGS') THEN
            -- The ship-time adjustments to the receipt's COGS.
            v_posted := wp_internal.op_drop_draft_cogs_entries(p_order_id, ARRAY['ORD-' || p_order_id || '-COGS-ADJ']);
        END IF;
    ELSE
        v_posted := wp_internal.op_drop_draft_cogs_entries(p_order_id, ARRAY[
            'ORD-' || p_order_id || '-COGS-REV', 'ORD-' || p_order_id || '-COGS', 'ORD-' || p_order_id || '-COGS-ADJ']);
    END IF;
    v_rem := COALESCE((SELECT sum(cogs_booked) FROM sale_items WHERE sale_id = p_order_id), 0);
    IF round(v_rem, 2) <> 0 AND wp_internal.os_post_cogs_move(p_order_id, 'REV', -v_rem, v_date) THEN
        UPDATE sale_items SET cogs_booked = NULL WHERE sale_id = p_order_id AND cogs_booked IS NOT NULL;
        v_notices := v_notices || CASE WHEN v_notice IS NOT NULL
            THEN format('This payment has a POSTED ledger entry: its cost of goods ($%s) was reversed by a Draft entry (ORD-%s-COGS-REV); reverse only its cash and revenue manually.',
                        to_char(round(v_rem, 2), 'FM999999999990.00'), p_order_id)
            ELSE format('This order''s cost of goods ($%s) was in a POSTED entry, so a Draft reversal (ORD-%s-COGS-REV) was booked.',
                        to_char(round(v_rem, 2), 'FM999999999990.00'), p_order_id) END;
    ELSIF v_notice IS NOT NULL THEN
        v_notices := v_notices || v_notice;
    ELSIF v_posted THEN
        v_notices := v_notices || 'This order has a POSTED cost-of-goods ledger entry — record a reversing entry manually.'::TEXT;
    END IF;
    -- A POSTED COGS-REV left without the COGS it reversed takes the order's
    -- COGS below what its lines have booked: the gap is booked back.
    IF EXISTS (SELECT 1 FROM journal_entries
                WHERE reference_id = 'ORD-' || p_order_id || '-COGS-REV' AND COALESCE(status, 'Posted') <> 'Draft') THEN
        v_gap := COALESCE((SELECT sum(cogs_booked) FROM sale_items WHERE sale_id = p_order_id), 0)
                 - (wp_internal.os_order_cogs_net(p_order_id) + v_base);
        IF round(v_gap, 2) > 0 AND wp_internal.os_post_cogs_move(p_order_id, 'ADJ', v_gap, v_date) THEN
            v_notices := v_notices || format('This order''s cost-of-goods reversal (ORD-%s-COGS-REV) is POSTED, so a Draft entry (ORD-%s-COGS-ADJ, $%s) was booked to offset it.',
                                             p_order_id, p_order_id, to_char(round(v_gap, 2), 'FM999999999990.00'));
        END IF;
    END IF;
    IF v_txs_all IS NOT NULL THEN
        FOREACH v_tx IN ARRAY v_txs_all LOOP
            DELETE FROM transactions WHERE id = v_tx;
            v_removed := v_removed || to_jsonb(v_tx);
        END LOOP;
    END IF;
    RETURN jsonb_build_object('removed', v_removed, 'notices', to_jsonb(v_notices));
END;
$$;

-- ---------------------------------------------------------------------------
-- Creating an order (POS checkout, order duplication, Inventory wholesale)
-- ---------------------------------------------------------------------------

-- Creates a retail/online order in one transaction: the sales row (with the
-- app's client-generated id), its sale_items, and — when it is born Paid /
-- Settled / Paid/Settled or with a Deposit — the income row(s) the app
-- logged at creation. No ledger entry is booked at creation (the app never
-- did; settling later books it). A failure creates nothing.
--
-- An id that already exists: when the stored order matches this one (same
-- total and customer), the first try's reply was lost and the save is
-- reported as already created; otherwise (two terminals colliding on the
-- millisecond clock) the create is refused with a plain message and the app
-- retries with a fresh id.
--
-- p_order: the sales columns as the app sends them. p_items: [{id, name,
-- price, quantity}]. p_fields: added_by (user name), tx_id / dep_tx_id (the
-- retry ids picked for the income rows).
-- Returns {"order_id", "already_created", "transactions": [rows]}.
CREATE OR REPLACE FUNCTION create_retail_order(p_order JSONB, p_items JSONB, p_fields JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_fields JSONB := COALESCE(p_fields, '{}'::jsonb);
    v_id TEXT := NULLIF(p_order->>'id', '');
    s sales%ROWTYPE;
    v_status TEXT := COALESCE(p_order->>'payment_status', '');
    v_name TEXT := COALESCE(NULLIF(p_order->'customer_snapshot'->>'name', ''), 'Customer');
    v_phone TEXT := NULLIF(p_order->'customer_snapshot'->>'phone', '');
    v_added_by TEXT := COALESCE(NULLIF(v_fields->>'added_by', ''), 'System');
    v_txs JSONB := '[]'::jsonb;
    v_amount NUMERIC;
    v_dep NUMERIC := COALESCE(NULLIF(p_order->>'deposit_amount', '')::NUMERIC, 0);
BEGIN
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'The order has no id.';
    END IF;
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'The order needs at least one item.';
    END IF;

    SELECT * INTO s FROM sales WHERE id = v_id FOR NO KEY UPDATE;
    IF FOUND THEN
        IF abs(COALESCE(s.total, 0) - COALESCE(NULLIF(p_order->>'total', '')::NUMERIC, 0)) <= 0.005
           AND COALESCE(s.customer_snapshot->>'name', '') = COALESCE(p_order->'customer_snapshot'->>'name', '') THEN
            -- The first try was saved but its reply was lost: report it done.
            SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_txs
              FROM transactions t WHERE t.order_id = v_id;
            RETURN jsonb_build_object('order_id', v_id, 'already_created', true, 'transactions', v_txs);
        END IF;
        RAISE EXCEPTION 'An order with this id already exists. Nothing was saved — try again.';
    END IF;

    -- Two terminals creating different orders in the same millisecond collide
    -- on the clock-generated id. The SELECT above can't see a row that isn't
    -- committed yet, so the loser lands on the primary key instead: give it
    -- the same plain message as the committed-row path (the app then mints a
    -- fresh id for the next try) rather than a raw "duplicate key" error.
    BEGIN
    INSERT INTO sales (id, total, discount, date, payment_method, type, salesman, customer_care,
                       amount_received, payment_status, deposit_amount, deposit_date, deposit_method,
                       customer_snapshot, order_status, page_source, shipping_company, tracking_number,
                       shipping_status, remark, cod_collected)
    VALUES (v_id,
            COALESCE(NULLIF(p_order->>'total', '')::NUMERIC, 0),
            COALESCE(NULLIF(p_order->>'discount', '')::NUMERIC, 0),
            COALESCE(NULLIF(p_order->>'date', '')::timestamptz, now()),
            NULLIF(p_order->>'payment_method', ''),
            'Online',
            p_order->>'salesman',
            p_order->>'customer_care',
            COALESCE(NULLIF(p_order->>'amount_received', '')::NUMERIC, 0),
            NULLIF(p_order->>'payment_status', ''),
            v_dep,
            NULLIF(p_order->>'deposit_date', '')::DATE,
            NULLIF(p_order->>'deposit_method', ''),
            p_order->'customer_snapshot',
            'Open',
            NULLIF(p_order->>'page_source', ''),
            p_order->>'shipping_company',
            p_order->>'tracking_number',
            p_order->>'shipping_status',
            p_order->>'remark',
            -- No flag sent: a Paid checkout by a COD payment method is COD
            -- (op_cod_method), anything else is not.
            COALESCE(NULLIF(p_order->>'cod_collected', '')::BOOLEAN,
                     v_status IN ('Paid', 'Settled', 'Paid/Settled') AND wp_internal.op_cod_method(NULLIF(p_order->>'payment_method', ''))));
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'An order with this id already exists. Nothing was saved — try again.';
    END;

    INSERT INTO sale_items (id, sale_id, product_id, name, price, quantity)
    SELECT gen_random_uuid(), v_id, NULLIF(i->>'id', ''), i->>'name',
           COALESCE(NULLIF(i->>'price', '')::NUMERIC, 0), COALESCE(NULLIF(i->>'quantity', '')::NUMERIC, 0)
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(i, n)
     ORDER BY n;

    IF v_status IN ('Paid', 'Settled', 'Paid/Settled') THEN
        -- Same row the app logged: amount received (or the total), the
        -- settle date (or now), no Pay By / shipping co at creation.
        v_amount := COALESCE(NULLIF(NULLIF(p_order->>'amount_received', '')::NUMERIC, 0),
                             NULLIF(p_order->>'total', '')::NUMERIC, 0);
        v_txs := v_txs || jsonb_build_array(wp_internal.op_insert_income(
            NULLIF(v_fields->>'tx_id', '')::UUID,
            COALESCE(wp_internal.op_norm_ts(NULLIF(p_order->>'settle_date', '')), now()),
            'លក់រាយ', v_amount, v_name, v_added_by, NULL, NULL, NULL, NULL, v_id, v_phone));
    ELSIF v_status = 'Deposit' AND v_dep > 0 THEN
        v_txs := v_txs || jsonb_build_array(wp_internal.op_insert_income(
            NULLIF(v_fields->>'dep_tx_id', '')::UUID,
            COALESCE(wp_internal.op_norm_ts(NULLIF(p_order->>'deposit_date', '')), now()),
            'កក់ប្រាក់', v_dep, v_name || ' #DEP-' || left(v_id, 8), v_added_by,
            NULLIF(p_order->>'shipping_company', ''),
            COALESCE(NULLIF(p_order->>'deposit_method', ''), 'Bank'),
            NULL, NULL, v_id, v_phone));
    END IF;

    RETURN jsonb_build_object('order_id', v_id, 'already_created', false, 'transactions', v_txs);
END;
$$;

-- The payment columns as saved, for the app's cached list.
CREATE OR REPLACE FUNCTION wp_internal.op_payment_of(s sales)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT jsonb_build_object(
        'payment_status', s.payment_status, 'amount_received', s.amount_received,
        'settle_date', s.settle_date, 'payment_method', s.payment_method,
        'deposit_amount', s.deposit_amount, 'deposit_date', s.deposit_date,
        'deposit_method', s.deposit_method, 'cod_collected', COALESCE(s.cod_collected, false),
        'cod_holder', s.cod_holder,
        'get_file_booked', COALESCE(s.get_file_booked, false));
$$;

-- A cancelled order's delivery-fee entry, Posted straight away (port of
-- postDeliveryFeeToLedger): Dr cash/bank, Cr Delivery Fee Revenue (4005) —
-- never Sales Revenue, since the order itself wasn't fulfilled.
CREATE OR REPLACE FUNCTION wp_internal.op_post_fee_entry(p_tx UUID, p_date DATE, p_name TEXT, p_amount NUMERIC, p_account_id UUID, p_pay_by TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_fee UUID := wp_internal.wp_account('4005', 'Revenue', 'delivery fee');
    v_cash UUID := COALESCE(p_account_id, wp_internal.wp_cash_bank_account(p_pay_by, true));
    v_number TEXT;
    v_entry UUID;
BEGIN
    IF v_fee IS NULL OR v_cash IS NULL THEN
        RETURN 'Delivery fee logged, but no Delivery Fee Revenue (4005) or cash/bank account could be resolved — no ledger entry was posted. Run migrations/add_delivery_fee_revenue_account.sql.';
    END IF;
    v_number := wp_internal.wp_next_entry_number('DLV', p_date);
    INSERT INTO journal_entries (date, description, reference_id, status, entry_number)
    VALUES (COALESCE(p_date, CURRENT_DATE), 'Retail - ' || regexp_replace(v_number, '^JE-\d+-', '') || ' — ' || p_name,
            'TX-' || p_tx, 'Posted', v_number)
    RETURNING id INTO v_entry;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_entry, v_cash, p_amount, 0, 'Delivery fee — ' || p_name),
        (v_entry, v_fee, 0, p_amount, 'Delivery fee — ' || p_name);
    RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Saving a payment (settle, deposit, delivery fee, cancel, corrections)
-- ---------------------------------------------------------------------------

-- The payment side of a retail order save, in one transaction: the payment
-- columns on sales, the income row(s), and the ledger entries — exactly the
-- rows the app wrote from the browser, with every decision made from the
-- LOCKED current row, never the screen's copy.
--
-- p_expected_status: the payment status the user's screen showed, or NULL to
-- skip that check. When the order has moved on since:
--   * the save re-sends the shown status unchanged (a form echo) -> the
--     payment part is skipped ("skipped": true) and the caller saves the rest;
--   * the save asks for the status the order ALREADY has (a double submit or
--     a retry whose first try won) -> nothing is booked again
--     ("already_applied": true);
--   * otherwise the save is refused with a plain message.
--
-- p_updates (a key present = write it): payment_status, amount_received,
-- settle_date, payment_method, deposit_amount, deposit_date, deposit_method,
-- deposit_account_id, deposit_account_name, post_to_ledger, reference, notes,
-- customer_name, customer_phone, shipping_company, cod_collected (the
-- courier collected this order's money: a receipt booked by this save
-- debits 1210 COD receivable instead of cash/bank, and on a paid order a
-- Draft receipt's debit is moved accordingly), tx_id (retry id for the
-- income row this save may create — if that row already exists, it is not
-- booked again).
-- p_updates may also carry expected_deposit_amount: the deposit the screen
-- decided from — when the stored deposit differs, the save is refused (or,
-- when it already equals what this save asks, reported as already applied).
-- p_fields: added_by, today (the user's local day, for deposit entry dates),
-- tz_offset_min (minutes east of UTC, for local-day comparisons).
--
-- What runs, mirroring the app:
--   * entering Paid/Settled: income for the amount minus any deposit already
--     taken (none when the deposit covered everything), and with
--     post_to_ledger a Draft RCP entry (Dr cash/bank, Cr Sales Revenue, plus
--     COGS at FIFO cost) — or a COGS-only entry when nothing is left to
--     collect;
--   * leaving Paid/Settled: that income row (found by order_id ONLY) and its
--     Draft entry are removed (a Posted entry stays, with a notice); the
--     received amount and settle date are reset unless the save sets them;
--   * into PdFee: the delivery fee income (ថ្លៃដឹក) and its Posted DLV entry
--     (Dr cash/bank, Cr Delivery Fee Revenue), unless a fee is already
--     booked for this order;
--   * any save into/within Deposit: the POSITIVE DELTA over the deposits
--     already booked for this order (#DEP marker) is logged as កក់ប្រាក់
--     income, and with post_to_ledger a Draft DEP entry — a retry or
--     re-save books nothing;
--   * a paid order's settle date / received amount / Pay By correction
--     reaches its income row (found by order_id first), healing a missing
--     row only on a real settle-day change.
--
-- Returns {"applied"|"skipped"|"already_applied", "payment": {columns as
-- saved}, "transactions_added": [rows], "transactions_removed": [tx ids],
-- "notices": […]}.
CREATE OR REPLACE FUNCTION set_order_payment(p_order_id TEXT, p_expected_status TEXT, p_updates JSONB, p_fields JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    u JSONB := COALESCE(p_updates, '{}'::jsonb);
    v_fields JSONB := COALESCE(p_fields, '{}'::jsonb);
    s sales%ROWTYPE;
    v_cur TEXT;
    v_target TEXT;
    v_target_given BOOLEAN := u ? 'payment_status';
    v_shown TEXT;
    v_added_by TEXT := COALESCE(NULLIF(v_fields->>'added_by', ''), 'System');
    v_today DATE := COALESCE(NULLIF(v_fields->>'today', '')::DATE, CURRENT_DATE);
    v_tz INT := COALESCE(NULLIF(v_fields->>'tz_offset_min', '')::INT, 0);
    v_txs JSONB := '[]'::jsonb;
    v_removed JSONB := '[]'::jsonb;
    v_notices TEXT[] := '{}';
    v_notice TEXT;
    v_res JSONB;
    v_name TEXT;
    v_phone TEXT;
    v_tx_id UUID := NULLIF(u->>'tx_id', '')::UUID;
    v_account_id UUID := NULLIF(u->>'deposit_account_id', '')::UUID;
    -- The "Deposited into" account's name. It is only a fallback for the
    -- payment row's Method (pay_by): the Method says HOW the customer paid
    -- (Bank / Cash / QR, from Settings), the account is WHERE it was booked,
    -- and that lives on the ledger entry (v_account_id). Storing the account
    -- name as the Method showed one bank as two ("Bank" and "Bank Account
    -- (ABA)") in Retail Payment, Income & Expense and the exports.
    v_account_name TEXT := NULLIF(u->>'deposit_account_name', '');
    v_post BOOLEAN := COALESCE((u->>'post_to_ledger')::BOOLEAN, false);
    v_amount_received NUMERIC;
    v_settle TEXT;
    v_dep_given NUMERIC := NULLIF(u->>'deposit_amount', '')::NUMERIC;
    v_deposit_paid NUMERIC;
    v_gross NUMERIC;
    v_to_record NUMERIC;
    v_date TIMESTAMPTZ;
    v_pay_by TEXT;
    v_shipping_co TEXT;
    v_fee NUMERIC;
    v_booked NUMERIC;
    v_prev_dep NUMERIC;
    v_delta NUMERIC;
    v_dep_date_raw TEXT;
    v_dep_ts TIMESTAMPTZ;
    v_match JSONB;
    v_has_linked BOOLEAN;
    v_settle_day_changed BOOLEAN;
    v_amount_changed BOOLEAN;
    v_method_changed BOOLEAN;
    v_riel_changed BOOLEAN;
    -- The riel details of the money this save books or corrects (p_updates
    -- .money: currency, original_amount, exchange_rate, and the income
    -- category they belong to), applied to the row of that category only.
    v_money JSONB := CASE WHEN jsonb_typeof(u->'money') = 'object' THEN u->'money' END;
    -- "The courier collected this order's money": sent by the Settle form
    -- (NULL when this save says nothing about it — the stored flag then
    -- stands, false for an order never marked).
    v_cod BOOLEAN := CASE WHEN u ? 'cod_collected' THEN COALESCE(NULLIF(u->>'cod_collected', '')::BOOLEAN, false) END;
    -- Who holds the COD money ('courier' / 'deliveryman'), set below.
    v_holder TEXT;
    -- A Collected order turning Paid: the arrival day, written to
    -- sales.settle_date only (never into u — see the flip section).
    v_stamp_settle TEXT;
    v_cut NUMERIC;
    -- Split settlement (p_updates.split, sent by the Settle form only): the
    -- receipt is taken part in dollars, part in riel. split.usd_amount is
    -- the dollar part; the riel part is v_to_record - usd_amount, booked to
    -- split.account_id (a riel cash/bank account, 1002/1011) with
    -- split.money's riel details and its own retry id split.tx_id. Both
    -- rows and both entries book in this one transaction, or neither.
    v_split JSONB := CASE WHEN jsonb_typeof(u->'split') = 'object' THEN u->'split' END;
    v_split_tx UUID;
    v_split_acc UUID;
    v_split_entry UUID;
    v_usd_part NUMERIC;
    v_khr_usd NUMERIC;
    v_entering_paid BOOLEAN;
    v_leaving_paid BOOLEAN;
    v_cur_settled BOOLEAN;
    v_tgt_settled BOOLEAN;
BEGIN
    SELECT * INTO s FROM sales WHERE id = p_order_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This order no longer exists.';
    END IF;
    v_cur := COALESCE(NULLIF(s.payment_status, ''), 'Unpaid');
    v_target := CASE WHEN v_target_given THEN COALESCE(NULLIF(u->>'payment_status', ''), 'Unpaid') ELSE v_cur END;

    -- The screen's status against the real one.
    IF p_expected_status IS NOT NULL AND v_target_given THEN
        v_shown := COALESCE(NULLIF(p_expected_status, ''), 'Unpaid');
        IF v_cur <> v_shown THEN
            IF v_target = v_shown THEN
                -- A form echoing what it showed; the payment made since is kept.
                RETURN jsonb_build_object('skipped', true, 'payment', wp_internal.op_payment_of(s),
                                          'transactions_added', v_txs, 'transactions_removed', v_removed,
                                          'notices', to_jsonb(v_notices));
            ELSIF v_target = v_cur AND (v_dep_given IS NULL OR abs(v_dep_given - COALESCE(s.deposit_amount, 0)) <= 0.005) THEN
                -- A double submit / a retry whose first try won: already saved.
                RETURN jsonb_build_object('already_applied', true, 'payment', wp_internal.op_payment_of(s),
                                          'transactions_added', v_txs, 'transactions_removed', v_removed,
                                          'notices', to_jsonb(v_notices));
            ELSIF v_cur IN ('Paid', 'Settled', 'Paid/Settled', 'Collected')
                  AND v_shown NOT IN ('Paid', 'Settled', 'Paid/Settled', 'Collected')
                  AND v_target NOT IN ('Paid', 'Settled', 'Paid/Settled', 'Collected') THEN
                RAISE EXCEPTION 'This order was just marked % by someone else, so your change wasn''t saved. The list has been refreshed. Please check the order and try again.', v_cur;
            ELSE
                RAISE EXCEPTION 'This order''s payment details were just changed by someone else, so your change wasn''t saved. The list has been refreshed. Please check the order and try again.';
            END IF;
        END IF;
    END IF;

    -- A retry whose income row is already saved must not book it again. A
    -- split save books both rows atomically, so either id found means the
    -- whole save landed.
    v_split_tx := CASE WHEN v_split ? 'tx_id' THEN NULLIF(v_split->>'tx_id', '')::UUID END;
    IF (v_tx_id IS NOT NULL AND EXISTS (SELECT 1 FROM transactions WHERE id = v_tx_id))
       OR (v_split_tx IS NOT NULL AND EXISTS (SELECT 1 FROM transactions WHERE id = v_split_tx)) THEN
        RETURN jsonb_build_object('already_applied', true, 'payment', wp_internal.op_payment_of(s),
                                  'transactions_added', v_txs, 'transactions_removed', v_removed,
                                  'notices', to_jsonb(v_notices));
    END IF;

    -- The deposit amount this save decided from (the app's fresh read), the
    -- compare-and-set the client used to run: two screens that both still
    -- show the old deposit must not quietly overwrite each other — the loser
    -- would lower the deposit column below the deposits actually booked, and
    -- the settle later books the remainder over the lowered figure, so
    -- revenue would overstate by exactly the clobbered delta.
    IF u ? 'expected_deposit_amount' AND u ? 'deposit_amount'
       AND abs(COALESCE(NULLIF(u->>'expected_deposit_amount', '')::NUMERIC, 0) - COALESCE(s.deposit_amount, 0)) > 0.005 THEN
        IF v_dep_given IS NOT NULL AND abs(v_dep_given - COALESCE(s.deposit_amount, 0)) <= 0.005 THEN
            -- A double submit / a retry whose first try won: already saved.
            RETURN jsonb_build_object('already_applied', true, 'payment', wp_internal.op_payment_of(s),
                                      'transactions_added', v_txs, 'transactions_removed', v_removed,
                                      'notices', to_jsonb(v_notices));
        END IF;
        RAISE EXCEPTION 'This order''s payment details were just changed by someone else, so your change wasn''t saved. The list has been refreshed. Please check the order and try again.';
    END IF;

    -- "Settled" = the receipt is on the books: Paid / Settled / Paid/Settled,
    -- or Get File for a courier ticked in Sales Setup (op_get_file_books_cod
    -- decides when an order ENTERS Get File; once booked, get_file_booked
    -- keeps it settled even if the courier is unticked later).
    -- A Collected order counts as settled only when its receipt was really
    -- booked — cod_collected marks that (every booking writes it below).
    -- With Collected bookings turned off in Sales Setup, new Collected
    -- orders carry false and stay unsettled; orders booked before the
    -- switch keep true and settle the booked way.
    v_cur_settled := wp_internal.op_is_settled(v_cur, s.get_file_booked)
        AND (v_cur <> 'Collected' OR COALESCE(s.cod_collected, false));
    -- Collected (the courier collected the customer's money) is booked as
    -- COD, whatever the courier's Sales Setup tick says — unless Sales
    -- Setup turned Collected bookings off (op_collected_books_cod).
    v_tgt_settled := v_target IN ('Paid', 'Settled', 'Paid/Settled')
        OR (v_target = 'Collected' AND wp_internal.op_collected_books_cod())
        OR (v_target = 'Get File' AND CASE WHEN v_cur = 'Get File' THEN v_cur_settled
                                           ELSE wp_internal.op_get_file_books_cod(COALESCE(NULLIF(u->>'shipping_company', ''), s.shipping_company)) END);
    -- A booked Collected re-saved as Collected while bookings are off: the
    -- receipt stands (only Paid, Unpaid or Cancel moves it) — settled, so a
    -- mere re-save never unbooks it.
    IF v_cur = 'Collected' AND v_target = 'Collected' AND v_cur_settled THEN
        v_tgt_settled := true;
    END IF;
    v_entering_paid := v_tgt_settled AND NOT v_cur_settled;
    v_leaving_paid := v_target_given AND NOT v_tgt_settled AND v_cur_settled;
    -- Only a settlement is ever COD: a deposit, a delivery fee or a cancel
    -- saying so is ignored (and the stored flag left alone).
    IF NOT v_tgt_settled THEN v_cod := NULL; END IF;
    -- A settlement paid by a COD payment method (Sales Setup › Pay By) is
    -- COD when the save says nothing and the order was never marked — the
    -- same default the Settle form's box starts from. Entering only: a
    -- settled order re-saved keeps whatever was decided with its receipt.
    IF v_cod IS NULL AND v_entering_paid AND NOT COALESCE(s.cod_collected, false)
       AND wp_internal.op_cod_method(COALESCE(NULLIF(u->>'payment_method', ''), s.payment_method)) THEN
        v_cod := true;
    END IF;
    IF v_target IN ('Get File', 'Collected') AND v_tgt_settled THEN
        IF v_entering_paid THEN
            -- Get File booked as COD (or Collected): the courier holds the whole order's
            -- money. Booked now, as a settlement of the full total (the app
            -- sends the deposit as Received and no settle date for Get File),
            -- dated today; get_file_booked (set by the UPDATE below) marks it
            -- booked. Collected records NO Settled Date — the money hasn't
            -- arrived; the date stamps when the order turns Paid (below).
            -- The receipt entry is still dated today (v_date falls to now).
            v_cod := true;
            v_post := true;
            u := u || jsonb_build_object('amount_received', COALESCE(s.total, 0));
            IF v_target = 'Get File' THEN
                u := u || jsonb_build_object('settle_date', COALESCE(NULLIF(v_fields->>'now', ''), now()::TEXT));
            END IF;
        ELSE
            -- Into Get File / Collected from a settled status (or a re-save): the receipt
            -- stands as booked — the app's Get File figures (deposit as
            -- Received, no settle date) must not rewrite it or clear the date.
            u := u - 'amount_received' - 'settle_date';
        END IF;
    ELSIF v_cur IN ('Get File', 'Collected') AND v_cur_settled AND v_tgt_settled THEN
        -- A booked Get File / Collected marked Paid: nothing more to book (the courier's
        -- remittance is Accounting › COD Remittances), and the receipt keeps
        -- its Get File date — the Paid save's settle date is not applied.
        -- EXCEPT a Collected order that stored no settle date (Collected
        -- stamps none): turning Paid records the day the money arrived —
        -- the save's date, else today. Held in v_stamp_settle and written
        -- straight to the sales column AFTER the correction section, so the
        -- Draft receipt's row and entry keep their Collected booking date
        -- (a date inside u would read as a LED-6 date correction and
        -- re-date them).
        IF v_cur = 'Collected' AND s.settle_date IS NULL
           AND v_target IN ('Paid', 'Settled', 'Paid/Settled') THEN
            v_stamp_settle := COALESCE(NULLIF(u->>'settle_date', ''), NULLIF(v_fields->>'now', ''), now()::TEXT);
        END IF;
        u := u - 'settle_date';
    END IF;
    IF v_leaving_paid AND (v_cur IN ('Get File', 'Collected') OR v_target = 'Collected') THEN
        -- A booked Get File / Collected taken back (Unpaid, Cancel, ...): its receipt is
        -- removed below and the order is no longer the courier's. Landing on
        -- an UNBOOKED Collected (bookings off) clears the flag too — the
        -- receipt is gone, so the marker must not read as still booked, or a
        -- later Paid would book nothing.
        v_cod := false;
    END IF;
    -- Who holds the COD money (p_updates.cod_holder: 'courier' /
    -- 'deliveryman' — the Collected popup's choice): the sent value, else
    -- the order's stored one, else the courier. A Get File booking is
    -- always the courier's: its tick is per shipping company.
    v_holder := CASE WHEN lower(COALESCE(NULLIF(u->>'cod_holder', ''), s.cod_holder, '')) = 'deliveryman'
                     THEN 'deliveryman' ELSE 'courier' END;
    IF v_target = 'Get File' AND v_entering_paid THEN v_holder := 'courier'; END IF;

    v_name := COALESCE(NULLIF(u->>'customer_name', ''), NULLIF(s.customer_snapshot->>'name', ''), 'Customer');
    v_phone := COALESCE(NULLIF(u->>'customer_phone', ''), NULLIF(s.customer_snapshot->>'phone', ''));
    v_shipping_co := COALESCE(NULLIF(u->>'shipping_company', ''), NULLIF(s.shipping_company, ''));
    v_amount_received := NULLIF(u->>'amount_received', '')::NUMERIC;
    v_settle := CASE WHEN u ? 'settle_date' THEN NULLIF(u->>'settle_date', '') ELSE NULL END;

    IF v_leaving_paid THEN
        -- Un-marking Paid takes back the Received amount and settle date,
        -- unless this save sets its own (Get File / Deposit keep a taken
        -- deposit visible).
        IF NOT u ? 'amount_received' THEN
            v_amount_received := CASE WHEN v_target IN ('Get File', 'Deposit') THEN COALESCE(s.deposit_amount, 0) ELSE 0 END;
            u := u || jsonb_build_object('amount_received', v_amount_received);
        END IF;
        IF NOT u ? 'settle_date' THEN
            u := u || jsonb_build_object('settle_date', '');
        END IF;
        v_res := wp_internal.op_remove_paid_income(p_order_id, v_today);
        v_removed := v_removed || (v_res->'removed');
        SELECT array_agg(x) INTO v_notices FROM (
            SELECT unnest(v_notices) x UNION ALL SELECT jsonb_array_elements_text(v_res->'notices')) t;
        v_notices := COALESCE(v_notices, '{}');
    END IF;

    IF v_entering_paid THEN
        -- A deposit was already logged when it was received, so only the
        -- remainder is booked here. With no explicit amount, a deposit order
        -- is treated as fully collected.
        v_deposit_paid := COALESCE(s.deposit_amount, 0);
        IF v_deposit_paid > 0 AND NOT u ? 'amount_received' THEN
            v_amount_received := COALESCE(s.total, 0);
            u := u || jsonb_build_object('amount_received', v_amount_received);
        END IF;
        v_gross := CASE WHEN u ? 'amount_received' THEN COALESCE(v_amount_received, 0)
                        ELSE COALESCE(NULLIF(s.amount_received, 0), s.total, 0) END;
        v_to_record := GREATEST(0, round(v_gross - v_deposit_paid, 2));
        v_date := COALESCE(wp_internal.op_norm_ts(COALESCE(v_settle, NULLIF(s.settle_date::TEXT, ''))), now());
        -- A courier-collected receipt with no Method and no picked account
        -- (a Get File booking) saves COD, so its row is never blank. Only a
        -- fallback: the debit still comes from the COD flag, never from this.
        v_pay_by := COALESCE(NULLIF(u->>'payment_method', ''), NULLIF(s.payment_method, ''), v_account_name,
                             CASE WHEN COALESCE(v_cod, s.cod_collected, false) THEN 'COD' END);
        -- A split settlement is validated here, before anything is written,
        -- so a refusal rolls the whole save back.
        IF v_split IS NOT NULL THEN
            IF v_to_record <= 0 THEN
                RAISE EXCEPTION 'This order''s deposit already covers it — there is nothing left to split.';
            END IF;
            IF COALESCE(v_cod, s.cod_collected, false) THEN
                RAISE EXCEPTION 'A courier-collected (COD) payment cannot be split: the courier hands the money over in one remittance.';
            END IF;
            v_usd_part := round(COALESCE(NULLIF(v_split->>'usd_amount', '')::NUMERIC, 0), 2);
            v_khr_usd := round(v_to_record - v_usd_part, 2);
            IF v_split_tx IS NULL OR v_usd_part <= 0 OR v_khr_usd <= 0 THEN
                RAISE EXCEPTION 'A split payment needs a dollar part and a riel part that together make the amount received.';
            END IF;
            IF jsonb_typeof(v_split->'money') <> 'object' OR v_split->'money'->>'currency' <> 'KHR'
               OR COALESCE(NULLIF(v_split->'money'->>'original_amount', '')::NUMERIC, 0) <= 0
               OR COALESCE(NULLIF(v_split->'money'->>'exchange_rate', '')::NUMERIC, 0) <= 0 THEN
                RAISE EXCEPTION 'The split''s riel part needs its riel amount and exchange rate.';
            END IF;
            IF abs(v_khr_usd - round((v_split->'money'->>'original_amount')::NUMERIC / (v_split->'money'->>'exchange_rate')::NUMERIC, 2)) > 0.05 THEN
                RAISE EXCEPTION 'The riel part no longer matches the amount still owed (this order''s money changed since the screen was opened). The list has been refreshed. Please check the order and try again.';
            END IF;
            SELECT id INTO v_split_acc FROM chart_of_accounts
             WHERE id = NULLIF(v_split->>'account_id', '')::UUID AND account_type = 'Asset' AND COALESCE(is_active, true);
            IF v_split_acc IS NULL THEN
                RAISE EXCEPTION 'The split''s riel account could not be found in the Chart of Accounts.';
            END IF;
        END IF;
        IF v_to_record > 0 AND v_split IS NOT NULL THEN
            -- The dollar part: the picked cash/bank account, and the FIFO
            -- cost of goods rides on this first entry.
            v_txs := v_txs || jsonb_build_array(wp_internal.op_insert_income(
                v_tx_id, v_date, 'លក់រាយ', v_usd_part, v_name, v_added_by, v_shipping_co, v_pay_by,
                NULLIF(u->>'reference', ''), NULLIF(u->>'notes', ''), p_order_id, v_phone));
            IF v_post THEN
                v_notice := wp_internal.op_post_receipt_entry('RCP', v_date::DATE, v_name,
                    ((v_txs->-1)->>'id')::UUID, v_usd_part, v_account_id, v_pay_by, p_order_id, 'Draft', false);
                IF v_notice IS NOT NULL THEN v_notices := v_notices || v_notice; END IF;
            END IF;
            -- The riel part: its own row and entry on the riel account, the
            -- riel details written with the save (the app also tags them,
            -- which is a no-op after this).
            v_txs := v_txs || jsonb_build_array(wp_internal.op_insert_income(
                v_split_tx, v_date, 'លក់រាយ', v_khr_usd, v_name, v_added_by, v_shipping_co, v_pay_by,
                NULLIF(u->>'reference', ''), NULLIF(u->>'notes', ''), p_order_id, v_phone));
            IF v_post THEN
                v_notice := wp_internal.op_post_receipt_entry('RCP', v_date::DATE, v_name,
                    v_split_tx, v_khr_usd, v_split_acc, v_pay_by, NULL, 'Draft', false);
                IF v_notice IS NOT NULL THEN v_notices := v_notices || v_notice; END IF;
            END IF;
            PERFORM wp_internal.op_set_currency('transactions', v_split_tx, v_split->'money');
            SELECT id INTO v_split_entry FROM journal_entries
             WHERE reference_id = 'TX-' || v_split_tx ORDER BY created_at DESC, id DESC LIMIT 1;
            IF v_split_entry IS NOT NULL THEN
                PERFORM wp_internal.op_set_currency('journal_entries', v_split_entry, v_split->'money');
            END IF;
        ELSIF v_to_record > 0 THEN
            v_txs := v_txs || jsonb_build_array(wp_internal.op_insert_income(
                v_tx_id, v_date, 'លក់រាយ', v_to_record, v_name, v_added_by, v_shipping_co, v_pay_by,
                NULLIF(u->>'reference', ''), NULLIF(u->>'notes', ''), p_order_id, v_phone));
            IF v_post THEN
                -- A courier-collected receipt debits 1210 COD receivable
                -- (the flag sent, else the one stored on the order).
                -- A Get File booking has no user-picked day: the local day of
                -- the stamp (a UTC day would be one early before 07:00).
                v_notice := wp_internal.op_post_receipt_entry('RCP',
                    CASE WHEN v_target IN ('Get File', 'Collected') THEN wp_internal.op_local_day(v_date, v_tz) ELSE v_date::DATE END, v_name,
                    ((v_txs->-1)->>'id')::UUID, v_to_record, v_account_id, v_pay_by, p_order_id, 'Draft',
                    COALESCE(v_cod, s.cod_collected, false), v_holder);
                IF v_notice IS NOT NULL THEN v_notices := v_notices || v_notice; END IF;
            END IF;
        ELSIF v_post THEN
            -- Deposit covered the whole order: book just the cost side, dated
            -- on the user's LOCAL day of the settle instant (as the app did).
            PERFORM wp_internal.op_post_cogs_only(p_order_id, wp_internal.op_local_day(v_date, v_tz), v_name);
        END IF;
    ELSIF v_target = 'PdFee' AND v_cur <> 'PdFee' THEN
        -- The order is treated as cancelled, but the delivery fee was paid:
        -- book just that fee (no COGS — nothing was sold).
        v_fee := COALESCE(v_amount_received, 0);
        IF v_fee > 0 THEN
            SELECT COALESCE(sum(amount), 0) INTO v_booked FROM transactions
             WHERE type = 'Income' AND category = 'ថ្លៃដឹក' AND order_id = p_order_id;
            IF v_booked > 0 THEN
                IF abs(v_booked - v_fee) > 0.005 THEN
                    v_notices := v_notices || format('A delivery fee of $%s is already booked for this order, so the $%s wasn''t added. To change the amount, correct it in Journal Entries.',
                                                     to_char(v_booked, 'FM999999999990.00'), to_char(v_fee, 'FM999999999990.00'));
                END IF;
                v_amount_received := v_booked;
                u := u || jsonb_build_object('amount_received', v_booked);
            ELSE
                v_date := COALESCE(wp_internal.op_norm_ts(v_settle), now());
                v_pay_by := COALESCE(NULLIF(u->>'payment_method', ''), v_account_name);
                v_txs := v_txs || jsonb_build_array(wp_internal.op_insert_income(
                    v_tx_id, v_date, 'ថ្លៃដឹក', v_fee, v_name, v_added_by, v_shipping_co, v_pay_by,
                    NULL, NULL, p_order_id, v_phone));
                v_notice := wp_internal.op_post_fee_entry(((v_txs->-1)->>'id')::UUID, v_date::DATE, v_name, v_fee, v_account_id, v_pay_by);
                IF v_notice IS NOT NULL THEN v_notices := v_notices || v_notice; END IF;
            END IF;
        END IF;
    ELSIF v_target = 'Deposit' THEN
        -- Any save into/within Deposit books the POSITIVE DELTA over what is
        -- already on the books for this order — a re-save or retry books 0.
        v_prev_dep := CASE WHEN v_cur = 'Deposit' THEN COALESCE(s.deposit_amount, 0) ELSE 0 END;
        IF COALESCE(v_dep_given, 0) > 0 THEN
            -- This order's deposits already on the books: linked rows by
            -- order_id, legacy unlinked rows by their #DEP marker.
            SELECT GREATEST(v_prev_dep, COALESCE(sum(amount), 0)) INTO v_prev_dep FROM transactions
             WHERE type = 'Income' AND category = 'កក់ប្រាក់'
               AND (order_id = p_order_id
                    OR (order_id IS NULL AND description LIKE '%#DEP-' || left(p_order_id, 8)));
        END IF;
        v_delta := GREATEST(0, round(COALESCE(v_dep_given, 0) - v_prev_dep, 2));
        IF v_delta > 0 THEN
            -- A top-up delta is money received TODAY; only a first deposit
            -- honors the passed date.
            v_dep_date_raw := CASE WHEN v_prev_dep > 0 THEN NULL ELSE NULLIF(u->>'deposit_date', '') END;
            v_dep_ts := COALESCE(wp_internal.op_norm_ts(v_dep_date_raw), now());
            v_pay_by := COALESCE(NULLIF(u->>'deposit_method', ''), v_account_name, 'Bank');
            v_txs := v_txs || jsonb_build_array(wp_internal.op_insert_income(
                v_tx_id, v_dep_ts, 'កក់ប្រាក់', v_delta, v_name || ' #DEP-' || left(p_order_id, 8),
                v_added_by, NULLIF(s.shipping_company, ''), v_pay_by, NULL, NULL, p_order_id, v_phone));
            IF v_post THEN
                v_notice := wp_internal.op_post_receipt_entry('DEP', CASE WHEN v_dep_date_raw IS NOT NULL THEN v_dep_ts::DATE ELSE v_today END,
                    (v_txs->-1)->>'description', ((v_txs->-1)->>'id')::UUID, v_delta, v_account_id, v_pay_by, NULL, 'Draft');
                IF v_notice IS NOT NULL THEN v_notices := v_notices || v_notice; END IF;
            END IF;
        ELSIF COALESCE(v_dep_given, 0) > 0 THEN
            -- A deposit LOWERED below what its income rows hold is a
            -- correction of the newest of them: the row's amount comes down
            -- by the difference and its ledger entry follows (LED-6: a Draft
            -- DEP rewritten in place, a POSTED one offset by a Draft
            -- TX-<tx>-ADJ dated today). A cut deeper than that row is not
            -- guessed at across rows: the books are left and the notice says
            -- where to correct them.
            SELECT round(COALESCE(sum(amount), 0) - v_dep_given, 2) INTO v_cut FROM transactions
             WHERE type = 'Income' AND category = 'កក់ប្រាក់'
               AND (order_id = p_order_id
                    OR (order_id IS NULL AND description LIKE '%#DEP-' || left(p_order_id, 8)));
            IF v_cut > 0 THEN
                SELECT to_jsonb(t) INTO v_match FROM transactions t
                 WHERE t.type = 'Income' AND t.category = 'កក់ប្រាក់'
                   AND (t.order_id = p_order_id
                        OR (t.order_id IS NULL AND t.description LIKE '%#DEP-' || left(p_order_id, 8)))
                 ORDER BY t.created_at DESC, t.id DESC LIMIT 1;
                IF round((v_match->>'amount')::NUMERIC - v_cut, 2) <= 0 THEN
                    v_notices := v_notices || format('The deposit was lowered by $%s, more than its latest income row holds ($%s), so Income & Expense and the ledger were left as they were — correct them there.',
                                                     to_char(v_cut, 'FM999999999990.00'), to_char((v_match->>'amount')::NUMERIC, 'FM999999999990.00'));
                ELSE
                    UPDATE transactions SET amount = round(amount - v_cut, 2)
                     WHERE id = (v_match->>'id')::UUID;
                    -- The riel details sent for the deposit (the whole
                    -- deposit as now typed, not a top-up difference).
                    IF v_money IS NOT NULL AND v_money->>'category' = 'កក់ប្រាក់' THEN
                        PERFORM wp_internal.op_set_currency('transactions', (v_match->>'id')::UUID, v_money);
                    ELSE
                        v_money := NULL;
                    END IF;
                    SELECT to_jsonb(t) INTO v_res FROM transactions t WHERE t.id = (v_match->>'id')::UUID;
                    v_txs := v_txs || jsonb_build_array(v_res);
                    v_notice := wp_internal.op_sync_tx_entry((v_res->>'id')::UUID, (v_res->>'amount')::NUMERIC, NULL, v_today, v_money);
                    IF v_notice IS NOT NULL THEN v_notices := v_notices || v_notice; END IF;
                END IF;
            END IF;
        END IF;
    ELSIF v_tgt_settled AND NOT v_leaving_paid THEN
        -- A paid order's settle date, received amount or Pay By was
        -- corrected without a transition: the income row follows.
        -- Compared as the user's LOCAL days (a settle stamped between midnight
        -- and 07:00 local lives on the previous UTC day — UTC days would miss
        -- a genuine one-day correction across that window).
        v_settle_day_changed := v_settle IS NOT NULL
            AND wp_internal.op_local_day_of(v_settle, v_tz)
                IS DISTINCT FROM wp_internal.op_local_day(s.settle_date, v_tz);
        v_method_changed := u ? 'payment_method' AND NULLIF(u->>'payment_method', '') IS DISTINCT FROM NULLIF(s.payment_method, '');
        -- The riel details sent for the sale's own row (not a deposit's).
        IF v_money IS NOT NULL AND COALESCE(v_money->>'category', 'លក់រាយ') <> 'លក់រាយ' THEN v_money := NULL; END IF;
        IF (SELECT count(*) FROM transactions
             WHERE type = 'Income' AND category IN ('លក់រាយ', 'លក់ឥវ៉ាន់') AND order_id = p_order_id) > 1 THEN
            -- A split settlement: two single-currency rows. The one-row
            -- correction below cannot tell which part a change belongs to,
            -- so nothing is corrected or re-pointed here.
            IF v_settle_day_changed OR v_method_changed OR v_money IS NOT NULL
               OR (u ? 'amount_received' AND COALESCE(v_amount_received, 0) > 0 AND v_amount_received IS DISTINCT FROM COALESCE(s.amount_received, 0))
               OR (v_cod IS NOT NULL AND v_cod IS DISTINCT FROM COALESCE(s.cod_collected, false)) THEN
                v_notices := v_notices || 'This order was settled as a split payment (dollars + riel). To change its amount, date, riel details or COD side, un-pay the order and settle it again.'::TEXT;
            END IF;
        ELSIF v_settle_day_changed
           OR (u ? 'amount_received' AND COALESCE(v_amount_received, 0) > 0 AND v_amount_received IS DISTINCT FROM COALESCE(s.amount_received, 0))
           OR v_method_changed
           OR v_money IS NOT NULL THEN
            v_deposit_paid := COALESCE(s.deposit_amount, 0);
            v_gross := CASE WHEN u ? 'amount_received' THEN COALESCE(v_amount_received, 0)
                            ELSE COALESCE(NULLIF(s.amount_received, 0), s.total, 0) END;
            v_to_record := GREATEST(0, round(v_gross - v_deposit_paid, 2));
            SELECT to_jsonb(t) INTO v_match FROM transactions t
             WHERE t.type = 'Income' AND t.category IN ('លក់រាយ', 'លក់ឥវ៉ាន់')
               AND (t.order_id = p_order_id
                    OR (t.order_id IS NULL AND t.description = NULLIF(s.customer_snapshot->>'name', '')
                        AND t.amount IN (NULLIF(COALESCE(s.amount_received, 0), 0), NULLIF(COALESCE(s.total, 0), 0),
                                         NULLIF(GREATEST(0, COALESCE(s.amount_received, 0) - v_deposit_paid), 0),
                                         NULLIF(GREATEST(0, COALESCE(s.total, 0) - v_deposit_paid), 0))))
             ORDER BY (t.order_id = p_order_id) DESC, t.created_at DESC LIMIT 1;
            IF v_match IS NOT NULL THEN
                -- What this save really changes on the row, so a re-save
                -- that only re-sends the same riel details writes nothing.
                v_amount_changed := v_to_record > 0 AND round(v_to_record, 2) <> round((v_match->>'amount')::NUMERIC, 2);
                v_riel_changed := v_money IS NOT NULL AND wp_internal.op_has_currency_cols('transactions') AND (
                    COALESCE(v_money->>'currency', 'USD') IS DISTINCT FROM COALESCE(v_match->>'currency', 'USD')
                    OR (v_money->>'currency' = 'KHR'
                        AND (NULLIF(v_money->>'original_amount', '')::NUMERIC IS DISTINCT FROM (v_match->>'original_amount')::NUMERIC
                             OR NULLIF(v_money->>'exchange_rate', '')::NUMERIC IS DISTINCT FROM (v_match->>'exchange_rate')::NUMERIC)));
                IF v_settle_day_changed OR v_amount_changed OR v_method_changed OR v_riel_changed THEN
                    UPDATE transactions SET
                        amount = CASE WHEN v_to_record > 0 THEN v_to_record ELSE amount END,
                        description = v_name,
                        date = CASE WHEN v_settle IS NOT NULL THEN wp_internal.op_norm_ts(v_settle) ELSE date END,
                        pay_by = CASE WHEN v_method_changed THEN u->>'payment_method' ELSE pay_by END
                     WHERE id = (v_match->>'id')::UUID;
                    IF v_riel_changed THEN
                        PERFORM wp_internal.op_set_currency('transactions', (v_match->>'id')::UUID, v_money);
                    END IF;
                    SELECT to_jsonb(t) INTO v_res FROM transactions t WHERE t.id = (v_match->>'id')::UUID;
                    v_txs := v_txs || jsonb_build_array(v_res);
                    -- LED-6: the row's ledger entry follows its amount and
                    -- date (a Draft is rewritten, a POSTED one gets a Draft
                    -- TX-<tx>-ADJ for the difference).
                    IF v_settle_day_changed OR v_amount_changed OR v_riel_changed THEN
                        v_notice := wp_internal.op_sync_tx_entry((v_res->>'id')::UUID, (v_res->>'amount')::NUMERIC,
                            (v_res->>'date')::TIMESTAMPTZ::DATE, (v_res->>'date')::TIMESTAMPTZ::DATE, v_money);
                        IF v_notice IS NOT NULL THEN v_notices := v_notices || v_notice; END IF;
                    END IF;
                END IF;
            ELSIF v_settle_day_changed AND v_settle IS NOT NULL AND v_to_record > 0 THEN
                -- Heal a row that was never logged — only on a real
                -- settle-day change, and never for a deposit-covered order.
                v_txs := v_txs || jsonb_build_array(wp_internal.op_insert_income(
                    v_tx_id, wp_internal.op_norm_ts(v_settle), 'លក់រាយ', v_to_record, v_name, v_added_by,
                    v_shipping_co, COALESCE(NULLIF(u->>'payment_method', ''), NULLIF(s.payment_method, ''), v_account_name),
                    NULL, NULL, p_order_id, v_phone));
            END IF;
        END IF;
        -- "Collected by the courier" flipped on a paid order: the receipt's
        -- debit moves between the COD receivable and cash/bank (a Draft is
        -- re-pointed, a POSTED entry stays with a notice). Never for a split
        -- settlement (guarded above and in op_repoint_receipt_debit itself).
        IF v_cod IS NOT NULL AND v_cod IS DISTINCT FROM COALESCE(s.cod_collected, false)
           AND (SELECT count(*) FROM transactions
                 WHERE type = 'Income' AND category IN ('លក់រាយ', 'លក់ឥវ៉ាន់') AND order_id = p_order_id) <= 1 THEN
            v_notice := wp_internal.op_repoint_receipt_debit(p_order_id, v_cod, v_account_id,
                COALESCE(NULLIF(u->>'payment_method', ''), NULLIF(s.payment_method, ''), v_account_name), v_holder);
            IF v_notice IS NOT NULL THEN v_notices := v_notices || v_notice; END IF;
        -- The holder changed on an order that stays COD (courier <->
        -- deliveryman): the Draft receipt's debit moves between the two
        -- receivables the same way.
        ELSIF COALESCE(v_cod, s.cod_collected, false) AND u ? 'cod_holder'
           AND v_holder IS DISTINCT FROM (CASE WHEN lower(COALESCE(s.cod_holder, '')) = 'deliveryman' THEN 'deliveryman' ELSE 'courier' END)
           AND (SELECT count(*) FROM transactions
                 WHERE type = 'Income' AND category IN ('លក់រាយ', 'លក់ឥវ៉ាន់') AND order_id = p_order_id) <= 1 THEN
            v_notice := wp_internal.op_repoint_receipt_debit(p_order_id, true, NULL,
                COALESCE(NULLIF(u->>'payment_method', ''), NULLIF(s.payment_method, ''), v_account_name), v_holder);
            IF v_notice IS NOT NULL THEN v_notices := v_notices || v_notice; END IF;
        END IF;
    END IF;

    -- A Collected order turning Paid stamps its settle date now, after the
    -- corrections above (which must not see it as a date change).
    IF v_stamp_settle IS NOT NULL THEN
        u := u || jsonb_build_object('settle_date', v_stamp_settle);
    END IF;

    -- The payment columns, from what this save (after the defaults above) asks.
    UPDATE sales SET
        payment_status = CASE WHEN v_target_given THEN NULLIF(u->>'payment_status', '') ELSE payment_status END,
        amount_received = CASE WHEN u ? 'amount_received' THEN COALESCE(NULLIF(u->>'amount_received', '')::NUMERIC, 0) ELSE amount_received END,
        settle_date = CASE WHEN u ? 'settle_date' THEN wp_internal.op_norm_ts(NULLIF(u->>'settle_date', '')) ELSE settle_date END,
        payment_method = CASE WHEN u ? 'payment_method' THEN NULLIF(u->>'payment_method', '') ELSE payment_method END,
        deposit_amount = CASE WHEN u ? 'deposit_amount' THEN COALESCE(v_dep_given, 0) ELSE deposit_amount END,
        deposit_date = CASE WHEN u ? 'deposit_date' THEN NULLIF(u->>'deposit_date', '')::DATE ELSE deposit_date END,
        deposit_method = CASE WHEN u ? 'deposit_method' THEN NULLIF(u->>'deposit_method', '') ELSE deposit_method END,
        deposit_account_id = CASE WHEN u ? 'deposit_account_id' THEN NULLIF(u->>'deposit_account_id', '') ELSE deposit_account_id END,
        cod_collected = COALESCE(v_cod, cod_collected, false),
        cod_holder = CASE WHEN u ? 'cod_holder' THEN lower(NULLIF(u->>'cod_holder', '')) ELSE cod_holder END,
        -- Booked at Get File: the order ends at Get File with its receipt on
        -- the books (entered, kept from Paid, or re-saved); any other end
        -- state clears it (Paid's own status says settled from then on).
        get_file_booked = (v_target = 'Get File' AND v_tgt_settled),
        last_edited_at = CASE WHEN v_fields ? 'last_edited_by' THEN COALESCE(NULLIF(v_fields->>'now', '')::timestamptz, now()) ELSE last_edited_at END,
        last_edited_by = CASE WHEN v_fields ? 'last_edited_by' THEN v_fields->>'last_edited_by' ELSE last_edited_by END
     WHERE id = p_order_id
     RETURNING * INTO s;

    RETURN jsonb_build_object('applied', true, 'payment', wp_internal.op_payment_of(s),
                              'transactions_added', v_txs, 'transactions_removed', v_removed,
                              'notices', to_jsonb(v_notices));
END;
$$;

-- ---------------------------------------------------------------------------
-- Deleting orders
-- ---------------------------------------------------------------------------

-- Deletes retail orders in one transaction: archives each to deleted_orders /
-- deleted_sale_items (deposit fields included), puts the stock of Shipped /
-- Delivered / Returned orders back (products.stock, the FIFO inventory items,
-- and the newest 'out' stock-movement generation is removed), removes the
-- orders' income rows — matched by order_id, plus the legacy #DEP deposit
-- marker — with their Draft ledger entries (a Posted entry stays, with a
-- notice), and deletes the sale_items and sales rows. An id that no longer
-- exists is skipped, so a retry after a lost reply deletes nothing twice.
--
-- Returns {"deleted": [ids], "stock": {product: stock},
-- "transactions_removed": [tx ids], "notices": […]}.
CREATE OR REPLACE FUNCTION delete_retail_orders(p_ids TEXT[], p_fields JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_ids TEXT[] := '{}';
    v_restock_ids TEXT[] := '{}';
    v_stock JSONB := '{}'::jsonb;
    v_removed JSONB := '[]'::jsonb;
    v_notices TEXT[] := '{}';
    v_notice TEXT;
    v_new NUMERIC;
    v_newest TIMESTAMPTZ;
    v_posted BOOLEAN;
    v_rev NUMERIC;
    v_gap NUMERIC;
    v_base NUMERIC;
    v_txrefs TEXT[];
    v_today DATE := COALESCE(NULLIF(p_fields->>'today', '')::DATE, CURRENT_DATE);
    r RECORD;
    t RECORD;
BEGIN
    FOR r IN SELECT id, shipping_status FROM sales WHERE id = ANY(p_ids) ORDER BY id FOR NO KEY UPDATE
    LOOP
        v_ids := v_ids || r.id;
        IF COALESCE(r.shipping_status, 'Pending') IN ('Shipped', 'Delivered', 'Returned') THEN
            v_restock_ids := v_restock_ids || r.id;
        END IF;
    END LOOP;
    IF cardinality(v_ids) = 0 THEN
        RETURN jsonb_build_object('deleted', '[]'::jsonb, 'stock', '{}'::jsonb,
                                  'transactions_removed', '[]'::jsonb, 'notices', '[]'::jsonb);
    END IF;

    -- Archive first, while everything is still there.
    INSERT INTO deleted_orders (id, total, discount, date, payment_method, type, salesman, customer_care,
                                remark, amount_received, settle_date, payment_status, order_status,
                                shipping_company, tracking_number, shipping_status, shipping_cost,
                                customer_snapshot, page_source, last_edited_at, last_edited_by,
                                created_at, daily_number, deposit_amount, deposit_date, deposit_method,
                                return_reason)
    SELECT s.id, s.total, s.discount, s.date, s.payment_method, s.type, s.salesman, s.customer_care,
           s.remark, s.amount_received, s.settle_date, s.payment_status, s.order_status,
           s.shipping_company, s.tracking_number, s.shipping_status, s.shipping_cost,
           s.customer_snapshot, s.page_source, s.last_edited_at, s.last_edited_by,
           s.created_at, s.daily_number, s.deposit_amount, s.deposit_date, s.deposit_method,
           NULLIF(btrim(to_jsonb(s)->>'return_reason'), '')
      FROM sales s WHERE s.id = ANY(v_ids)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO deleted_sale_items (id, sale_id, product_id, name, price, quantity, image, created_at)
    SELECT id, sale_id, product_id, name, price, quantity, image, created_at
      FROM sale_items WHERE sale_id = ANY(v_ids)
    ON CONFLICT (id) DO NOTHING;

    -- Stock back for orders whose goods were counted out.
    IF cardinality(v_restock_ids) > 0 THEN
        PERFORM 1 FROM products
         WHERE id IN (SELECT product_id FROM sale_items WHERE sale_id = ANY(v_restock_ids))
         ORDER BY id FOR NO KEY UPDATE;
        FOR r IN
            SELECT si.product_id, sum(COALESCE(si.quantity, 0)) AS qty
              FROM sale_items si
             WHERE si.sale_id = ANY(v_restock_ids) AND si.product_id IS NOT NULL
             GROUP BY si.product_id ORDER BY si.product_id
        LOOP
            UPDATE products SET stock = COALESCE(stock, 0) + r.qty WHERE id = r.product_id
            RETURNING stock INTO v_new;
            IF FOUND THEN
                v_stock := v_stock || jsonb_build_object(r.product_id, v_new);
            END IF;
        END LOOP;
        -- Each line's layers go back before the line goes (layers point at
        -- their line, which has no foreign key).
        FOR r IN SELECT si.id, si.sale_id FROM sale_items si
                  WHERE si.sale_id = ANY(v_restock_ids) AND si.product_id IS NOT NULL
                  ORDER BY si.sale_id, si.created_at, si.id
        LOOP
            PERFORM wp_internal.fifo_give_back_line('retail', r.sale_id, r.id::TEXT);
        END LOOP;
        FOR r IN SELECT unnest(v_restock_ids) AS id
        LOOP
            SELECT max(created_at) INTO v_newest FROM stock_movements WHERE reference_id = r.id AND type = 'out';
            IF v_newest IS NOT NULL THEN
                DELETE FROM stock_movements WHERE reference_id = r.id AND type = 'out' AND created_at = v_newest;
            END IF;
        END LOOP;
    END IF;

    -- The orders' income (ORD-7/OM2-9: a deleted paid order must not leave
    -- its revenue behind). Matched by order_id, plus the legacy #DEP marker
    -- deposits carried before the order link existed. The marker holds only
    -- the first 8 of the 13 clock digits, so every order of the same customer
    -- within a ~28-hour window carries the SAME marker: a legacy row is only
    -- deleted when no SURVIVING order of that customer shares it (it is left
    -- behind, with a notice, rather than risk a sibling order's deposit).
    FOR r IN SELECT s2.id, COALESCE(NULLIF(s2.customer_snapshot->>'name', ''), 'Customer') AS cname,
                    EXISTS (SELECT 1 FROM sales sib
                             WHERE sib.id <> s2.id AND NOT (sib.id = ANY(v_ids))
                               AND left(sib.id, 8) = left(s2.id, 8)
                               AND COALESCE(NULLIF(sib.customer_snapshot->>'name', ''), 'Customer')
                                   = COALESCE(NULLIF(s2.customer_snapshot->>'name', ''), 'Customer')) AS has_sibling
               FROM sales s2 WHERE s2.id = ANY(v_ids)
    LOOP
        -- A Draft reversal goes first: its amount is booked again
        -- (op_unbook_cogs), so the entries below take off what they carried
        -- and op_reverse_booked_cogs reverses whatever a POSTED entry keeps.
        -- What the order's lines have booked less the COGS its entries in
        -- view carry: the share held by entries no longer in view (a Posted
        -- receipt whose income row an earlier un-pay removed).
        v_base := COALESCE((SELECT sum(cogs_booked) FROM sale_items WHERE sale_id = r.id), 0)
                  - wp_internal.os_order_cogs_net(r.id);
        v_posted := wp_internal.op_drop_draft_cogs_entries(r.id, ARRAY['ORD-' || r.id || '-COGS-REV']);
        v_txrefs := '{}';
        FOR t IN SELECT id FROM transactions
                  WHERE type = 'Income'
                    AND (order_id = r.id
                         -- Legacy deposits from before the order link: the
                         -- exact description the app wrote for THIS order.
                         OR (NOT r.has_sibling AND category = 'កក់ប្រាក់' AND order_id IS NULL
                             AND description = r.cname || ' #DEP-' || left(r.id, 8)))
        LOOP
            v_notice := wp_internal.op_remove_tx_entry(t.id);
            IF v_notice IS NOT NULL THEN v_notices := v_notices || v_notice; END IF;
            DELETE FROM transactions WHERE id = t.id;
            v_removed := v_removed || to_jsonb(t.id);
            v_txrefs := v_txrefs || ('TX-' || t.id);
        END LOOP;
        IF r.has_sibling AND EXISTS (SELECT 1 FROM transactions
                                      WHERE type = 'Income' AND category = 'កក់ប្រាក់' AND order_id IS NULL
                                        AND description = r.cname || ' #DEP-' || left(r.id, 8)) THEN
            v_notices := v_notices || format('An older deposit row "%s" could belong to another order of this customer, so it was left in Income & Expense — remove it there if it was this order''s.',
                                             r.cname || ' #DEP-' || left(r.id, 8));
        END IF;
        -- The cost-side entries with no income row of their own (ORD-<id>-COGS
        -- of a deposit-covered order, and the FIFO ship-time adjustments and
        -- reversals): same rule as the TX- entries — a Draft one goes with
        -- the order.
        v_posted := wp_internal.op_drop_draft_cogs_entries(r.id, ARRAY[
            'ORD-' || r.id || '-COGS', 'ORD-' || r.id || '-COGS-ADJ', 'ORD-' || r.id || '-COGS-REV']) OR v_posted;
        -- COGS still booked after that sits in POSTED entries; the goods are
        -- back (or never left), so it is reversed by a Draft COGS-REV.
        v_rev := wp_internal.op_reverse_booked_cogs(r.id, v_today);
        IF v_rev <> 0 THEN
            v_notices := v_notices || format('This order''s cost of goods ($%s) was in a POSTED entry — a Draft reversal (ORD-%s-COGS-REV) was booked; reverse only the receipt''s cash and revenue manually.',
                                             to_char(v_rev, 'FM999999999990.00'), r.id);
        END IF;
        -- A deleted order's COGS nets to 0. A POSTED COGS-REV left without
        -- the COGS it reversed takes it below 0: the gap is booked back as a
        -- Draft COGS-ADJ. Its income rows are gone, so the entries of the
        -- ones just deleted (v_txrefs) are counted here.
        v_gap := -(v_base + wp_internal.os_order_cogs_net(r.id)
                   + COALESCE((SELECT sum(COALESCE(l.credit, 0) - COALESCE(l.debit, 0))
                                 FROM journal_entries e
                                 JOIN journal_entry_lines l ON l.journal_entry_id = e.id
                                WHERE e.reference_id = ANY(v_txrefs)
                                  AND l.account_id = wp_internal.wp_account('1300', 'Asset', 'inventor|stock')), 0));
        IF round(v_gap, 2) > 0
           AND EXISTS (SELECT 1 FROM journal_entries
                        WHERE reference_id = 'ORD-' || r.id || '-COGS-REV' AND COALESCE(status, 'Posted') <> 'Draft')
           AND wp_internal.os_post_cogs_move(r.id, 'ADJ', v_gap, v_today) THEN
            v_notices := v_notices || format('This order''s cost-of-goods reversal (ORD-%s-COGS-REV) is POSTED, so a Draft entry (ORD-%s-COGS-ADJ, $%s) was booked to offset it.',
                                             r.id, r.id, to_char(round(v_gap, 2), 'FM999999999990.00'));
        ELSIF v_rev = 0 AND v_posted THEN
            v_notices := v_notices || 'This order has a POSTED cost-of-goods ledger entry — record a reversing entry manually.'::TEXT;
        END IF;
    END LOOP;

    DELETE FROM sale_items WHERE sale_id = ANY(v_ids);
    DELETE FROM sales WHERE id = ANY(v_ids);

    RETURN jsonb_build_object('deleted', to_jsonb(v_ids), 'stock', v_stock,
                              'transactions_removed', v_removed, 'notices', to_jsonb(v_notices));
END;
$$;

-- ---------------------------------------------------------------------------
-- The payment side of a restock
-- ---------------------------------------------------------------------------

-- After restock_returned_orders has put the goods back: a previously-Paid
-- order's income row (matched by order_id ONLY — never by customer name and
-- amount, which could delete a sibling order's income) and its Draft ledger
-- entry are removed (a Posted one stays, with a notice), its Received amount
-- and settle date are reset (and its COD flag cleared; a Get File booked
-- as COD counts as previously-Paid), and every order's payment goes to Cancel — a
-- PdFee order keeps PdFee (the delivery fee was collected and stays booked).
-- A restocked order's COGS still booked after that (a Posted receipt entry,
-- a deposit-covered ORD-…-COGS) is reversed by a Draft ORD-<id>-COGS-REV.
--
-- Returns {"cancelled": [ids], "paid_reset": [ids],
-- "transactions_removed": [tx ids], "notices": […]}.
CREATE OR REPLACE FUNCTION apply_restock_payment_side(p_ids TEXT[], p_fields JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_cancel TEXT[] := '{}';
    v_paid TEXT[] := '{}';
    v_removed JSONB := '[]'::jsonb;
    v_notices TEXT[] := '{}';
    v_res JSONB;
    v_rev NUMERIC;
    v_today DATE := COALESCE(NULLIF(p_fields->>'today', '')::DATE, CURRENT_DATE);
    r RECORD;
BEGIN
    FOR r IN SELECT id, payment_status, get_file_booked, cod_collected FROM sales WHERE id = ANY(p_ids) ORDER BY id FOR NO KEY UPDATE
    LOOP
        -- Same marker rule as set_order_payment: a Collected order has
        -- income to remove only when its receipt was really booked.
        IF wp_internal.op_is_settled(r.payment_status, r.get_file_booked)
           AND (r.payment_status <> 'Collected' OR COALESCE(r.cod_collected, false)) THEN
            v_paid := v_paid || r.id;
            v_res := wp_internal.op_remove_paid_income(r.id, v_today);
            v_removed := v_removed || (v_res->'removed');
            SELECT COALESCE(array_agg(x), '{}') INTO v_notices FROM (
                SELECT unnest(v_notices) x UNION ALL SELECT jsonb_array_elements_text(v_res->'notices')) t;
        END IF;
        IF COALESCE(r.payment_status, '') <> 'PdFee' THEN
            v_cancel := v_cancel || r.id;
        END IF;
    END LOOP;

    IF cardinality(v_cancel) > 0 THEN
        UPDATE sales SET payment_status = 'Cancel' WHERE id = ANY(v_cancel);
    END IF;
    IF cardinality(v_paid) > 0 THEN
        -- Its receipt is gone, so the order is no longer the courier's money
        -- either: a later settle starts from the shipping-state default.
        UPDATE sales SET amount_received = 0, settle_date = NULL, cod_collected = false, get_file_booked = false WHERE id = ANY(v_paid);
    END IF;

    -- The goods are back in the pool (restock_returned_orders): COGS still
    -- booked for them (a POSTED receipt, a deposit-covered ORD-…-COGS) goes
    -- back to Inventory as a Draft COGS-REV.
    FOR r IN SELECT id FROM sales WHERE id = ANY(p_ids) AND shipping_status = 'ReStock' ORDER BY id
    LOOP
        v_rev := wp_internal.op_reverse_booked_cogs(r.id, v_today);
        IF v_rev <> 0 THEN
            v_notices := v_notices || format('The cost of goods ($%s) booked for this order was reversed by a Draft entry (ORD-%s-COGS-REV).',
                                             to_char(v_rev, 'FM999999999990.00'), r.id);
        END IF;
    END LOOP;

    RETURN jsonb_build_object('cancelled', to_jsonb(v_cancel), 'paid_reset', to_jsonb(v_paid),
                              'transactions_removed', v_removed, 'notices', to_jsonb(v_notices));
END;
$$;

GRANT EXECUTE ON FUNCTION order_payment_functions_ready() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_norm_ts(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_local_day(TIMESTAMPTZ, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_local_day_of(TEXT, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_insert_income(UUID, TIMESTAMPTZ, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_entry_inventory_credit(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_mark_cogs_booked(TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_unbook_cogs(TEXT, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_drop_draft_cogs_entries(TEXT, TEXT[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_reverse_booked_cogs(TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_cod_account() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_cod_account(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_cod_method(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_collected_books_cod() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_post_receipt_entry(TEXT, DATE, TEXT, UUID, NUMERIC, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_repoint_receipt_debit(TEXT, BOOLEAN, UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_post_cogs_only(TEXT, DATE, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_post_fee_entry(UUID, DATE, TEXT, NUMERIC, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_has_currency_cols(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_set_currency(TEXT, UUID, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_sync_tx_entry(UUID, NUMERIC, DATE, DATE, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_remove_tx_entry(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_remove_paid_income(TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_payment_of(sales) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_retail_order(JSONB, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_order_payment(TEXT, TEXT, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_retail_orders(TEXT[], JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_restock_payment_side(TEXT[], JSONB) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
