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

-- Deposits must survive delete+restore. full_schema.sql has these, but an
-- instance created before them may not (the standalone ALTER file never
-- shipped), and delete_retail_orders archives these columns unconditionally.
ALTER TABLE deleted_orders ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC DEFAULT 0;
ALTER TABLE deleted_orders ADD COLUMN IF NOT EXISTS deposit_date DATE;
ALTER TABLE deleted_orders ADD COLUMN IF NOT EXISTS deposit_method TEXT;

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
    UPDATE sale_items si SET cogs_booked = COALESCE(si.cogs_booked, 0) + (p_lines->>si.id)::NUMERIC
     WHERE si.sale_id = p_order_id AND p_lines ? si.id;
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
                               AND ii.consumer_id = p_order_id AND ii.consumer_line_id = s2.id) AS n,
                           (SELECT COALESCE(sum(COALESCE(ii.cost_of_purchase, 0)), 0) FROM inventory_items ii
                             WHERE ii.status = 'sold' AND ii.consumer_kind = 'retail'
                               AND ii.consumer_id = p_order_id AND ii.consumer_line_id = s2.id) AS cost
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
CREATE OR REPLACE FUNCTION wp_internal.op_post_receipt_entry(
    p_type TEXT, p_date DATE, p_name TEXT, p_tx UUID, p_amount NUMERIC,
    p_account_id UUID, p_pay_by TEXT, p_cogs_order TEXT, p_status TEXT DEFAULT 'Draft')
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_revenue UUID := wp_internal.wp_account('4000', 'Revenue', 'sales revenue', true);
    v_cash UUID := COALESCE(p_account_id, wp_internal.wp_cash_bank_account(p_pay_by, true));
    v_cogs UUID;
    v_inventory UUID;
    v_cost NUMERIC := 0;
    v_lines JSONB;
    v_number TEXT;
    v_entry UUID;
BEGIN
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
    VALUES (p_date, 'Retail - ' || regexp_replace(v_number, '^JE-\d+-', '') || ' — ' || p_name,
            'TX-' || p_tx, COALESCE(p_status, 'Draft'), v_number)
    RETURNING id INTO v_entry;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_entry, v_cash, p_amount, 0, CASE WHEN p_type = 'DEP' THEN 'Deposit' ELSE 'Receipt' END || ' — ' || p_name),
        (v_entry, v_revenue, 0, p_amount, 'Sales — ' || p_name);
    IF v_cost > 0 THEN
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
            (v_entry, v_cogs, v_cost, 0, 'Cost of goods sold'),
            (v_entry, v_inventory, 0, v_cost, 'Inventory at cost');
        PERFORM wp_internal.op_mark_cogs_booked(p_cogs_order, v_lines);
    END IF;
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
    VALUES (p_date, 'Retail - ' || regexp_replace(v_number, '^JE-\d+-', '') || ' — ' || p_name || ' · cost of goods sold',
            'ORD-' || p_order_id || '-COGS', 'Draft', v_number)
    RETURNING id INTO v_entry;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_entry, v_cogs, v_cost, 0, 'Cost of goods sold'),
        (v_entry, v_inventory, 0, v_cost, 'Inventory at cost');
    PERFORM wp_internal.op_mark_cogs_booked(p_order_id, v_lines);
END;
$$;

-- Takes an income row's ledger entry off the books: a Draft one is deleted
-- (the COGS it carried comes off its order's cogs_booked); a Posted one is
-- final and stays, and the notice says so.
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
              WHERE reference_id = 'TX-' || p_tx FOR UPDATE
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
BEGIN
    SELECT id INTO v_tx FROM transactions
     WHERE type = 'Income' AND category IN ('លក់រាយ', 'លក់ឥវ៉ាន់') AND order_id = p_order_id
     ORDER BY created_at DESC LIMIT 1;
    -- What the lines have booked less the COGS of the entries in view: the
    -- share held by a POSTED receipt whose income row an earlier un-pay
    -- removed. Taken before anything is removed, as delete_retail_orders does.
    v_base := COALESCE((SELECT sum(cogs_booked) FROM sale_items WHERE sale_id = p_order_id), 0)
              - wp_internal.os_order_cogs_net(p_order_id);
    IF v_tx IS NOT NULL THEN
        -- An order edited down to no product line carries a Draft COGS-REV
        -- of what this receipt booked (edit_order_items): when the receipt
        -- is a Draft too, the REV goes first so the two cancel out.
        IF NOT EXISTS (SELECT 1 FROM sale_items WHERE sale_id = p_order_id AND product_id IS NOT NULL)
           AND EXISTS (SELECT 1 FROM journal_entries WHERE reference_id = 'TX-' || v_tx AND status = 'Draft') THEN
            PERFORM wp_internal.op_drop_draft_cogs_entries(p_order_id, ARRAY['ORD-' || p_order_id || '-COGS-REV']);
        END IF;
        v_notice := wp_internal.op_remove_tx_entry(v_tx);
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
    IF v_tx IS NOT NULL THEN
        DELETE FROM transactions WHERE id = v_tx;
        v_removed := v_removed || to_jsonb(v_tx);
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
                       shipping_status, remark)
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
            p_order->>'remark');
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
        'deposit_method', s.deposit_method);
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
    VALUES (p_date, 'Retail - ' || regexp_replace(v_number, '^JE-\d+-', '') || ' — ' || p_name,
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
-- customer_name, customer_phone, shipping_company, tx_id (retry id for the
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
    v_match RECORD;
    v_has_linked BOOLEAN;
    v_settle_day_changed BOOLEAN;
    v_entering_paid BOOLEAN;
    v_leaving_paid BOOLEAN;
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
            ELSIF v_cur IN ('Paid', 'Settled', 'Paid/Settled')
                  AND v_shown NOT IN ('Paid', 'Settled', 'Paid/Settled')
                  AND v_target NOT IN ('Paid', 'Settled', 'Paid/Settled') THEN
                RAISE EXCEPTION 'This order was just marked % by someone else, so your change wasn''t saved. The list has been refreshed. Please check the order and try again.', v_cur;
            ELSE
                RAISE EXCEPTION 'This order''s payment details were just changed by someone else, so your change wasn''t saved. The list has been refreshed. Please check the order and try again.';
            END IF;
        END IF;
    END IF;

    -- A retry whose income row is already saved must not book it again.
    IF v_tx_id IS NOT NULL AND EXISTS (SELECT 1 FROM transactions WHERE id = v_tx_id) THEN
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

    v_entering_paid := v_target IN ('Paid', 'Settled', 'Paid/Settled') AND v_cur NOT IN ('Paid', 'Settled', 'Paid/Settled');
    v_leaving_paid := v_target_given AND v_target NOT IN ('Paid', 'Settled', 'Paid/Settled') AND v_cur IN ('Paid', 'Settled', 'Paid/Settled');

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
        v_pay_by := COALESCE(v_account_name, NULLIF(u->>'payment_method', ''), NULLIF(s.payment_method, ''));
        IF v_to_record > 0 THEN
            v_txs := v_txs || jsonb_build_array(wp_internal.op_insert_income(
                v_tx_id, v_date, 'លក់រាយ', v_to_record, v_name, v_added_by, v_shipping_co, v_pay_by,
                NULLIF(u->>'reference', ''), NULLIF(u->>'notes', ''), p_order_id, v_phone));
            IF v_post THEN
                v_notice := wp_internal.op_post_receipt_entry('RCP', v_date::DATE, v_name,
                    ((v_txs->-1)->>'id')::UUID, v_to_record, v_account_id, v_pay_by, p_order_id, 'Draft');
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
                v_pay_by := COALESCE(v_account_name, NULLIF(u->>'payment_method', ''));
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
            v_pay_by := COALESCE(v_account_name, NULLIF(u->>'deposit_method', ''), 'Bank');
            v_txs := v_txs || jsonb_build_array(wp_internal.op_insert_income(
                v_tx_id, v_dep_ts, 'កក់ប្រាក់', v_delta, v_name || ' #DEP-' || left(p_order_id, 8),
                v_added_by, NULLIF(s.shipping_company, ''), v_pay_by, NULL, NULL, p_order_id, v_phone));
            IF v_post THEN
                v_notice := wp_internal.op_post_receipt_entry('DEP', CASE WHEN v_dep_date_raw IS NOT NULL THEN v_dep_ts::DATE ELSE v_today END,
                    (v_txs->-1)->>'description', ((v_txs->-1)->>'id')::UUID, v_delta, v_account_id, v_pay_by, NULL, 'Draft');
                IF v_notice IS NOT NULL THEN v_notices := v_notices || v_notice; END IF;
            END IF;
        END IF;
    ELSIF v_target IN ('Paid', 'Settled', 'Paid/Settled') AND NOT v_leaving_paid THEN
        -- A paid order's settle date, received amount or Pay By was
        -- corrected without a transition: the income row follows.
        -- Compared as the user's LOCAL days (a settle stamped between midnight
        -- and 07:00 local lives on the previous UTC day — UTC days would miss
        -- a genuine one-day correction across that window).
        v_settle_day_changed := v_settle IS NOT NULL
            AND wp_internal.op_local_day_of(v_settle, v_tz)
                IS DISTINCT FROM wp_internal.op_local_day(s.settle_date, v_tz);
        IF v_settle_day_changed
           OR (u ? 'amount_received' AND COALESCE(v_amount_received, 0) > 0 AND v_amount_received IS DISTINCT FROM COALESCE(s.amount_received, 0))
           OR (u ? 'payment_method' AND NULLIF(u->>'payment_method', '') IS DISTINCT FROM NULLIF(s.payment_method, '')) THEN
            v_deposit_paid := COALESCE(s.deposit_amount, 0);
            v_gross := CASE WHEN u ? 'amount_received' THEN COALESCE(v_amount_received, 0)
                            ELSE COALESCE(NULLIF(s.amount_received, 0), s.total, 0) END;
            v_to_record := GREATEST(0, round(v_gross - v_deposit_paid, 2));
            SELECT t.id, t.amount INTO v_match FROM transactions t
             WHERE t.type = 'Income' AND t.category IN ('លក់រាយ', 'លក់ឥវ៉ាន់')
               AND (t.order_id = p_order_id
                    OR (t.order_id IS NULL AND t.description = NULLIF(s.customer_snapshot->>'name', '')
                        AND t.amount IN (NULLIF(COALESCE(s.amount_received, 0), 0), NULLIF(COALESCE(s.total, 0), 0),
                                         NULLIF(GREATEST(0, COALESCE(s.amount_received, 0) - v_deposit_paid), 0),
                                         NULLIF(GREATEST(0, COALESCE(s.total, 0) - v_deposit_paid), 0))))
             ORDER BY (t.order_id = p_order_id) DESC, t.created_at DESC LIMIT 1;
            IF v_match.id IS NOT NULL THEN
                UPDATE transactions SET
                    amount = CASE WHEN v_to_record > 0 THEN v_to_record ELSE amount END,
                    description = v_name,
                    date = CASE WHEN v_settle IS NOT NULL THEN wp_internal.op_norm_ts(v_settle) ELSE date END,
                    pay_by = CASE WHEN u ? 'payment_method' AND NULLIF(u->>'payment_method', '') IS DISTINCT FROM NULLIF(s.payment_method, '')
                                  THEN u->>'payment_method' ELSE pay_by END
                 WHERE id = v_match.id
                 RETURNING to_jsonb(transactions.*) INTO v_res;
                v_txs := v_txs || jsonb_build_array(v_res);
            ELSIF v_settle_day_changed AND v_settle IS NOT NULL AND v_to_record > 0 THEN
                -- Heal a row that was never logged — only on a real
                -- settle-day change, and never for a deposit-covered order.
                v_txs := v_txs || jsonb_build_array(wp_internal.op_insert_income(
                    v_tx_id, wp_internal.op_norm_ts(v_settle), 'លក់រាយ', v_to_record, v_name, v_added_by,
                    v_shipping_co, COALESCE(v_account_name, NULLIF(u->>'payment_method', ''), NULLIF(s.payment_method, '')),
                    NULL, NULL, p_order_id, v_phone));
            END IF;
        END IF;
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
                                created_at, daily_number, deposit_amount, deposit_date, deposit_method)
    SELECT id, total, discount, date, payment_method, type, salesman, customer_care,
           remark, amount_received, settle_date, payment_status, order_status,
           shipping_company, tracking_number, shipping_status, shipping_cost,
           customer_snapshot, page_source, last_edited_at, last_edited_by,
           created_at, daily_number, deposit_amount, deposit_date, deposit_method
      FROM sales WHERE id = ANY(v_ids)
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
            PERFORM wp_internal.fifo_give_back_line('retail', r.sale_id, r.id);
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
-- and settle date are reset, and every order's payment goes to Cancel — a
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
    FOR r IN SELECT id, payment_status FROM sales WHERE id = ANY(p_ids) ORDER BY id FOR NO KEY UPDATE
    LOOP
        IF COALESCE(r.payment_status, '') IN ('Paid', 'Settled', 'Paid/Settled') THEN
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
        UPDATE sales SET amount_received = 0, settle_date = NULL WHERE id = ANY(v_paid);
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
GRANT EXECUTE ON FUNCTION wp_internal.op_post_receipt_entry(TEXT, DATE, TEXT, UUID, NUMERIC, UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_post_cogs_only(TEXT, DATE, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_post_fee_entry(UUID, DATE, TEXT, NUMERIC, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_remove_tx_entry(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_remove_paid_income(TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.op_payment_of(sales) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_retail_order(JSONB, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_order_payment(TEXT, TEXT, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_retail_orders(TEXT[], JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_restock_payment_side(TEXT[], JSONB) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
