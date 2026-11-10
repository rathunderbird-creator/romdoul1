-- Wholesale orders, customer and supplier payments, and receiving purchase
-- orders: each save runs inside the database, in one transaction.
-- Run once in each instance's Supabase SQL editor (Romdoul1, Romdoul2,
-- Romdoul3). Safe to re-run. Needs the columns from add_entry_status.sql,
-- add_journal_entry_number.sql, add_journal_entry_line_description.sql,
-- add_customer_payment_account.sql and add_supplier_payment_account.sql
-- (all three instances have them).
--
-- These used to be strings of separate writes from the browser. A failure
-- part-way left stock or money half moved, and the retry the app invited
-- moved it a second time; two clicks, two tabs or an out-of-date screen
-- could return the same stock twice or bring a cancelled order back. Each
-- function here locks the rows it changes first (the order or purchase
-- order, then its products in id order, then warehouse rows), checks the
-- current state again, refuses with a plain message when the action no
-- longer fits, and does every write in one transaction: it happens
-- completely or not at all, and a second caller waits and then sees the
-- result of the first.
--
-- They write the same rows, text, accounts and entry numbers the app wrote
-- before. Until this is run, these actions are refused with a message
-- saying to run this file.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- An active account: the one with p_code, else one of p_type whose name
-- matches p_name_re (or, with p_any_of_type, any account of that type,
-- preferring a name match). Same picks the app made in the browser.
CREATE OR REPLACE FUNCTION wp_account(p_code TEXT, p_type TEXT, p_name_re TEXT, p_any_of_type BOOLEAN DEFAULT false)
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT id FROM chart_of_accounts
     WHERE is_active
       AND (account_code = p_code
            OR (account_type = p_type AND (p_any_of_type OR account_name ~* p_name_re)))
     ORDER BY COALESCE(account_code = p_code, false) DESC,
              COALESCE(account_name ~* p_name_re, false) DESC,
              account_code
     LIMIT 1;
$$;

-- First active cash/bank account whose lower-case name matches p_re.
CREATE OR REPLACE FUNCTION wp_cash_bank_match(p_re TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT id FROM chart_of_accounts
     WHERE is_active AND account_type = 'Asset' AND account_name ~* '(cash|bank)'
       AND lower(account_name) ~ p_re
     ORDER BY COALESCE(account_code, '')
     LIMIT 1;
$$;

-- The cash/bank account a payment lands in when none was picked: the same
-- rules as src/utils/cashBankAccounts.ts (exact name, then bank for revenue,
-- then the hint's family, then Cash on Hand, then the lowest code).
CREATE OR REPLACE FUNCTION wp_cash_bank_account(p_pay_by TEXT, p_prefer_bank BOOLEAN)
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_hint TEXT := lower(btrim(COALESCE(p_pay_by, '')));
    v_id UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE is_active AND account_type = 'Asset' AND account_name ~* '(cash|bank)') THEN
        RETURN NULL;
    END IF;
    IF v_hint <> '' THEN
        SELECT id INTO v_id FROM chart_of_accounts
         WHERE is_active AND account_type = 'Asset' AND account_name ~* '(cash|bank)' AND lower(account_name) = v_hint
         ORDER BY COALESCE(account_code, '') LIMIT 1;
        IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    END IF;
    IF p_prefer_bank THEN
        v_id := COALESCE(wp_cash_bank_match('aba'), wp_cash_bank_match('bank'));
        IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    END IF;
    IF v_hint <> '' THEN
        IF position('aba' IN v_hint) > 0 THEN
            v_id := COALESCE(wp_cash_bank_match('aba'), wp_cash_bank_match('bank'));
        ELSIF position('acleda' IN v_hint) > 0 THEN
            v_id := COALESCE(wp_cash_bank_match('acleda'), wp_cash_bank_match('bank'));
        ELSIF v_hint ~ '(bank|transfer|card|cheque)' THEN
            v_id := wp_cash_bank_match('bank');
        ELSIF position('cash' IN v_hint) > 0 THEN
            v_id := COALESCE(wp_cash_bank_match('cash on hand'), wp_cash_bank_match('cash'));
        END IF;
        IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    END IF;
    RETURN COALESCE(wp_cash_bank_match('cash on hand'), wp_cash_bank_match('.'));
END;
$$;

-- Same numbering as src/utils/journalEntryNumber.ts:
-- JE-<entries so far + 1>-<TYPE>-<yyyymmdd>-<nnn>.
CREATE OR REPLACE FUNCTION wp_next_entry_number(p_type TEXT, p_date DATE)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_ymd TEXT := to_char(p_date, 'YYYYMMDD');
    v_global INT;
    v_daily INT;
BEGIN
    SELECT count(*) + 1 INTO v_global FROM journal_entries;
    SELECT count(*) + 1 INTO v_daily FROM journal_entries WHERE entry_number LIKE 'JE-%-' || p_type || '-' || v_ymd || '-%';
    RETURN 'JE-' || v_global || '-' || p_type || '-' || v_ymd || '-' || lpad(v_daily::TEXT, 3, '0');
END;
$$;

-- Books one Draft entry with a debit and a credit line of p_amount, numbered
-- and described the way the app does ('Wholesale - WSP-20261110-001 — Name').
CREATE OR REPLACE FUNCTION wp_post_entry(
    p_type TEXT, p_date DATE, p_name TEXT, p_reference TEXT, p_amount NUMERIC,
    p_debit_account UUID, p_debit_description TEXT,
    p_credit_account UUID, p_credit_description TEXT)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_number TEXT := wp_next_entry_number(p_type, p_date);
    v_area TEXT := CASE p_type WHEN 'WSP' THEN 'Wholesale' WHEN 'SPP' THEN 'Payment' WHEN 'GRN' THEN 'Purchase' END;
    v_entry UUID;
BEGIN
    INSERT INTO journal_entries (date, description, reference_id, status, entry_number)
    VALUES (p_date, v_area || ' - ' || regexp_replace(v_number, '^JE-\d+-', '') || ' — ' || p_name,
            p_reference, 'Draft', v_number)
    RETURNING id INTO v_entry;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_entry, p_debit_account, p_amount, 0, p_debit_description),
        (v_entry, p_credit_account, 0, p_amount, p_credit_description);
    RETURN v_entry;
END;
$$;

-- Removes the journal entries (and their lines) behind the Income/Expense
-- rows tagged with p_marker ('#WSP-1a2b3c4d' / '#SPP-…'), then those rows.
CREATE OR REPLACE FUNCTION wp_remove_tagged_transactions(p_marker TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM journal_entry_lines WHERE journal_entry_id IN (
        SELECT e.id FROM journal_entries e
         WHERE e.reference_id IN (SELECT 'TX-' || t.id FROM transactions t WHERE t.description LIKE '%' || p_marker || '%'));
    DELETE FROM journal_entries
     WHERE reference_id IN (SELECT 'TX-' || t.id FROM transactions t WHERE t.description LIKE '%' || p_marker || '%');
    DELETE FROM transactions WHERE description LIKE '%' || p_marker || '%';
END;
$$;

-- ---------------------------------------------------------------------------
-- Stock
-- ---------------------------------------------------------------------------

-- Adds p_quantity units of a product: inventory_items (one row per unit, at
-- p_cost or else the product's purchase cost), products.stock, the restocks
-- row and the 'in' stock movement. Returns the new stock. The caller has
-- normally locked the product already; this locks it again (a no-op then).
CREATE OR REPLACE FUNCTION wp_add_stock(
    p_product_id TEXT, p_quantity INTEGER, p_cost NUMERIC, p_note TEXT, p_supplier TEXT,
    p_added_by TEXT, p_created_by TEXT, p_today DATE)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
    v_name TEXT;
    v_purchase_cost NUMERIC;
    v_unit_cost NUMERIC;
    v_stock NUMERIC;
BEGIN
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'Enter an amount greater than zero';
    END IF;
    SELECT name, purchase_cost INTO v_name, v_purchase_cost FROM products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found';
    END IF;
    v_unit_cost := COALESCE(NULLIF(p_cost, 0), NULLIF(v_purchase_cost, 0), 0);

    INSERT INTO inventory_items (product_id, cost_of_purchase, status)
    SELECT p_product_id, v_unit_cost, 'in_stock' FROM generate_series(1, p_quantity);

    UPDATE products SET stock = COALESCE(stock, 0) + p_quantity WHERE id = p_product_id
    RETURNING stock INTO v_stock;

    INSERT INTO restocks (id, product_id, quantity, cost, date, added_by, note)
    VALUES (gen_random_uuid(), p_product_id, p_quantity, COALESCE(p_cost, 0), now(),
            COALESCE(NULLIF(p_added_by, ''), 'Unknown'), COALESCE(p_note, ''));

    INSERT INTO stock_movements (product_id, product_name, type, quantity, unit_price, source, supplier, note, movement_date, created_by)
    VALUES (p_product_id, COALESCE(v_name, 'Unknown'), 'in', p_quantity, v_unit_cost,
            CASE WHEN COALESCE(p_note, '') LIKE 'Received from PO%' THEN 'Purchase Order' ELSE 'Inventory Adjustment' END,
            COALESCE(p_supplier, ''), COALESCE(p_note, ''), p_today, COALESCE(p_created_by, 'unknown'));

    RETURN v_stock;
END;
$$;

-- Inventory › Add Stock. Returns the product's new stock.
CREATE OR REPLACE FUNCTION add_product_stock(
    p_product_id TEXT, p_quantity INTEGER, p_cost NUMERIC DEFAULT 0, p_note TEXT DEFAULT '',
    p_supplier TEXT DEFAULT '', p_added_by TEXT DEFAULT NULL, p_created_by TEXT DEFAULT NULL,
    p_today DATE DEFAULT CURRENT_DATE)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN wp_add_stock(p_product_id, p_quantity, p_cost, p_note, p_supplier, p_added_by, p_created_by, p_today);
END;
$$;

-- Receives a purchase order: adds whatever of each product has not arrived
-- yet (counted from the restocks carrying 'Received from PO-xxxxxxxx', so a
-- part-received order only gets the rest), marks it Received and books its
-- purchase (Draft, Dr Inventory / Cr Accounts Payable at the PO total,
-- reference 'PO-<id>'; a Draft entry already there follows the total, a
-- Posted one is left alone with a notice). A cancelled or already received
-- order is refused.
--
-- Returns {"stock": {product_id: new stock, …}, "notices": […]}.
CREATE OR REPLACE FUNCTION receive_purchase_order(
    p_po_id UUID, p_added_by TEXT DEFAULT NULL, p_created_by TEXT DEFAULT NULL,
    p_today DATE DEFAULT CURRENT_DATE)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    po purchase_orders%ROWTYPE;
    v_marker TEXT := 'Received from PO-' || left(p_po_id::TEXT, 8);
    v_supplier TEXT;
    v_stock JSONB := '{}'::JSONB;
    v_notices TEXT[] := '{}';
    r RECORD;
    v_new NUMERIC;
    v_amount NUMERIC;
    v_entry_id UUID;
    v_entry_status TEXT;
    v_current NUMERIC;
    v_inventory UUID;
    v_ap UUID;
    v_inventory_desc TEXT;
    v_ap_desc TEXT;
BEGIN
    SELECT * INTO po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This purchase order no longer exists.';
    END IF;
    IF po.status = 'Cancelled' THEN
        RAISE EXCEPTION 'This purchase order has been cancelled, so it can''t be received.';
    END IF;
    IF po.status = 'Received' THEN
        RAISE EXCEPTION 'This purchase order has already been received.';
    END IF;
    SELECT name INTO v_supplier FROM suppliers WHERE id = po.supplier_id;

    PERFORM 1 FROM products
     WHERE id IN (SELECT product_id FROM purchase_order_items WHERE purchase_order_id = p_po_id)
     ORDER BY id FOR UPDATE;

    FOR r IN
        WITH ordered AS (
            SELECT product_id, sum(quantity) AS qty, sum(quantity * COALESCE(unit_price, 0)) AS value
              FROM purchase_order_items
             WHERE purchase_order_id = p_po_id AND product_id IS NOT NULL AND COALESCE(quantity, 0) > 0
             GROUP BY product_id
        ), arrived AS (
            SELECT product_id, sum(COALESCE(quantity, 0)) AS qty
              FROM restocks
             WHERE note LIKE '%' || v_marker || '%' AND product_id IN (SELECT product_id FROM ordered)
             GROUP BY product_id
        )
        SELECT o.product_id, GREATEST(0, o.qty - COALESCE(a.qty, 0)) AS missing, round(o.value / o.qty, 2) AS unit_cost
          FROM ordered o LEFT JOIN arrived a ON a.product_id = o.product_id
         ORDER BY o.product_id
    LOOP
        IF r.missing > 0 THEN
            v_new := wp_add_stock(r.product_id, ceil(r.missing)::INTEGER, r.unit_cost, v_marker, COALESCE(v_supplier, ''),
                                  p_added_by, p_created_by, p_today);
            v_stock := v_stock || jsonb_build_object(r.product_id, v_new);
        END IF;
    END LOOP;

    UPDATE purchase_orders SET status = 'Received' WHERE id = p_po_id;

    -- The purchase in the books (port of postPurchaseReceiptEntry).
    v_amount := round(COALESCE(po.total_amount, 0), 2);
    v_inventory := wp_account('1300', 'Asset', 'inventor|stock');
    v_ap := wp_account('2000', 'Liability', 'payable');
    SELECT id, COALESCE(status, 'Posted') INTO v_entry_id, v_entry_status
      FROM journal_entries WHERE reference_id = 'PO-' || p_po_id
     ORDER BY created_at LIMIT 1 FOR UPDATE;
    IF v_entry_id IS NOT NULL THEN
        SELECT round(COALESCE(sum(debit), 0), 2) INTO v_current FROM journal_entry_lines WHERE journal_entry_id = v_entry_id;
        IF v_current <> v_amount AND v_amount > 0 THEN
            IF v_entry_status <> 'Draft' THEN
                v_notices := v_notices || format('This PO''s posted inventory entry is $%s but the PO total is now $%s — adjust the ledger manually.',
                                                 to_char(v_current, 'FM999999999990.00'), to_char(v_amount, 'FM999999999990.00'));
            ELSIF v_inventory IS NOT NULL AND v_ap IS NOT NULL THEN
                -- Rebuild the amounts, keeping each line's description.
                SELECT description INTO v_inventory_desc FROM journal_entry_lines
                 WHERE journal_entry_id = v_entry_id AND account_id = v_inventory ORDER BY created_at LIMIT 1;
                SELECT description INTO v_ap_desc FROM journal_entry_lines
                 WHERE journal_entry_id = v_entry_id AND account_id = v_ap ORDER BY created_at LIMIT 1;
                DELETE FROM journal_entry_lines WHERE journal_entry_id = v_entry_id;
                INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
                    (v_entry_id, v_inventory, v_amount, 0, v_inventory_desc),
                    (v_entry_id, v_ap, 0, v_amount, v_ap_desc);
            END IF;
        END IF;
    ELSIF v_amount > 0 THEN
        IF v_inventory IS NULL OR v_ap IS NULL THEN
            v_notices := v_notices || 'PO received, but no Inventory or Accounts Payable account exists in the Chart of Accounts — no ledger entry was posted.'::TEXT;
        ELSE
            PERFORM wp_post_entry('GRN', p_today, COALESCE(v_supplier, 'Supplier'), 'PO-' || p_po_id, v_amount,
                                  v_inventory, 'Stock received — ' || COALESCE(v_supplier, 'Supplier'),
                                  v_ap, 'Payable — ' || COALESCE(v_supplier, 'Supplier'));
        END IF;
    END IF;

    RETURN jsonb_build_object('stock', v_stock, 'notices', to_jsonb(v_notices));
END;
$$;

-- ---------------------------------------------------------------------------
-- Wholesale orders
-- ---------------------------------------------------------------------------

-- The lines a wholesale save was given, in order.
CREATE OR REPLACE FUNCTION wp_items(p_items JSONB)
RETURNS TABLE (ord BIGINT, product_id TEXT, product_name TEXT, quantity NUMERIC, unit_price NUMERIC)
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT t.ord,
           NULLIF(t.l->>'product_id', ''),
           COALESCE(t.l->>'product_name', ''),
           COALESCE(NULLIF(t.l->>'quantity', '')::NUMERIC, 0),
           COALESCE(NULLIF(t.l->>'unit_price', '')::NUMERIC, 0)
      FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) WITH ORDINALITY AS t(l, ord);
$$;

-- Moves the stock an order's lines hold: p_sign -1 takes it out, +1 puts it
-- back. Never below zero. A warehouse row is only touched when it exists
-- (a missing row means the product isn't tracked in that warehouse).
CREATE OR REPLACE FUNCTION wp_move_order_stock(p_order_id UUID, p_warehouse TEXT, p_sign INTEGER)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT product_id, quantity FROM wholesale_order_items
         WHERE wholesale_order_id = p_order_id AND product_id IS NOT NULL AND COALESCE(quantity, 0) <> 0
         ORDER BY created_at, id
    LOOP
        UPDATE products SET stock = GREATEST(0, COALESCE(stock, 0) + p_sign * r.quantity) WHERE id = r.product_id;
        IF NULLIF(p_warehouse, '') IS NOT NULL THEN
            UPDATE warehouse_stock SET quantity = GREATEST(0, COALESCE(quantity, 0) + p_sign * r.quantity)
             WHERE warehouse_id::TEXT = p_warehouse AND product_id = r.product_id;
        END IF;
    END LOOP;
END;
$$;

-- The 'out' stock movements for an order's lines (one per line).
CREATE OR REPLACE FUNCTION wp_log_order_movements(p_order_id UUID, p_by TEXT, p_today DATE)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO stock_movements (product_id, product_name, type, quantity, unit_price, source, reason, reference_id,
                                 customer_name, customer_phone, note, movement_date, created_by, warehouse_id)
    SELECT i.product_id, COALESCE(i.product_name, ''), 'out', i.quantity, COALESCE(i.unit_price, 0),
           'Wholesale Order', 'Wholesale Sale', o.id::TEXT,
           COALESCE(o.customer_name, ''), COALESCE(o.customer_phone, ''),
           'Wholesale ' || COALESCE(NULLIF(o.invoice_number, ''), 'WO-' || left(o.id::TEXT, 8)),
           p_today, COALESCE(NULLIF(p_by, ''), 'System'), NULLIF(o.warehouse_id::TEXT, '')
      FROM wholesale_order_items i JOIN wholesale_orders o ON o.id = i.wholesale_order_id
     WHERE i.wholesale_order_id = p_order_id AND i.product_id IS NOT NULL AND COALESCE(i.quantity, 0) <> 0
     ORDER BY i.created_at, i.id;
END;
$$;

-- 'Customer · WO-0001' (or 'WO-1A2B3C4D' without an invoice number).
CREATE OR REPLACE FUNCTION wp_order_label(p_order_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(NULLIF(customer_name, ''), 'Wholesale') || ' · '
           || COALESCE(NULLIF(invoice_number, ''), 'WO-' || upper(left(id::TEXT, 8)))
      FROM wholesale_orders WHERE id = p_order_id;
$$;

-- Dr Cost of Goods Sold / Cr Inventory at the lines' purchase cost,
-- reference 'WSO-<id>-COGS'. Nothing when one already exists, the cost is
-- zero or the accounts are missing.
CREATE OR REPLACE FUNCTION wp_post_order_cogs(p_order_id UUID, p_today DATE)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_cost NUMERIC;
    v_cogs UUID := wp_account('5000', 'Expense', 'cost of goods|cogs');
    v_inventory UUID := wp_account('1300', 'Asset', 'inventor|stock');
BEGIN
    IF EXISTS (SELECT 1 FROM journal_entries WHERE reference_id = 'WSO-' || p_order_id || '-COGS') THEN RETURN; END IF;
    SELECT round(COALESCE(sum(COALESCE(p.purchase_cost, 0) * COALESCE(i.quantity, 0)), 0), 2) INTO v_cost
      FROM wholesale_order_items i JOIN products p ON p.id = i.product_id
     WHERE i.wholesale_order_id = p_order_id;
    IF v_cost <= 0 OR v_cogs IS NULL OR v_inventory IS NULL THEN RETURN; END IF;
    PERFORM wp_post_entry('WSP', p_today, wp_order_label(p_order_id) || ' · COGS', 'WSO-' || p_order_id || '-COGS', v_cost,
                          v_cogs, 'Cost of goods sold', v_inventory, 'Inventory at cost');
END;
$$;

-- Dr Accounts Receivable / Cr Sales Revenue at the order total, reference
-- 'WSO-<id>-INV'. Nothing when one already exists, the total is zero or the
-- accounts are missing.
CREATE OR REPLACE FUNCTION wp_post_order_invoice(p_order_id UUID, p_date DATE)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    o wholesale_orders%ROWTYPE;
    v_amount NUMERIC;
    v_ar UUID := wp_account('1200', 'Asset', 'receivable');
    v_revenue UUID := wp_account('4000', 'Revenue', 'sales revenue', true);
    v_name TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM journal_entries WHERE reference_id = 'WSO-' || p_order_id || '-INV') THEN RETURN; END IF;
    SELECT * INTO o FROM wholesale_orders WHERE id = p_order_id;
    v_amount := round(COALESCE(o.total_amount, 0), 2);
    IF v_amount <= 0 OR v_ar IS NULL OR v_revenue IS NULL THEN RETURN; END IF;
    v_name := COALESCE(NULLIF(o.customer_name, ''), 'Wholesale');
    PERFORM wp_post_entry('WSP', p_date, wp_order_label(p_order_id) || ' · Invoice', 'WSO-' || p_order_id || '-INV', v_amount,
                          v_ar, 'Invoice — ' || v_name, v_revenue, 'Sales — ' || v_name);
END;
$$;

-- Takes an order's COGS or invoice entry off the books: a Draft one is
-- deleted; a Posted one is final and stays, and the notice says so.
CREATE OR REPLACE FUNCTION wp_remove_order_entry(p_order_id UUID, p_suffix TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
    v_notice TEXT;
BEGIN
    FOR r IN SELECT id, COALESCE(status, 'Posted') AS status FROM journal_entries
              WHERE reference_id = 'WSO-' || p_order_id || '-' || p_suffix FOR UPDATE
    LOOP
        IF r.status <> 'Draft' THEN
            v_notice := 'This order has a POSTED ' || CASE p_suffix WHEN 'COGS' THEN 'cost-of-goods' ELSE 'invoice' END
                        || ' entry — record a reversing entry manually.';
        ELSE
            DELETE FROM journal_entry_lines WHERE journal_entry_id = r.id;
            DELETE FROM journal_entries WHERE id = r.id;
        END IF;
    END LOOP;
    RETURN v_notice;
END;
$$;

-- Checks the stock for an order's new lines (summed per product) before
-- anything moves. p_reserved_order: the order being edited, whose current
-- lines count as available again (they're about to be put back) — in the
-- warehouse only when it stays the same. Locks the products and rows.
CREATE OR REPLACE FUNCTION wp_check_order_stock(p_items JSONB, p_warehouse TEXT, p_reserved_order UUID, p_reserved_warehouse TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
    v_reserved NUMERIC;
    v_name TEXT;
    v_stock NUMERIC;
    v_ws NUMERIC;
    v_ws_found BOOLEAN;
BEGIN
    IF EXISTS (SELECT 1 FROM wp_items(p_items) WHERE product_id IS NOT NULL AND quantity < 0) THEN
        RAISE EXCEPTION 'Quantities must be above zero.';
    END IF;
    PERFORM 1 FROM products
     WHERE id IN (SELECT product_id FROM wp_items(p_items)
                  UNION SELECT product_id FROM wholesale_order_items WHERE wholesale_order_id = p_reserved_order)
     ORDER BY id FOR UPDATE;
    FOR r IN
        SELECT product_id, sum(quantity) AS qty, (array_agg(NULLIF(product_name, '') ORDER BY ord))[1] AS item_name
          FROM wp_items(p_items)
         WHERE product_id IS NOT NULL AND quantity <> 0
         GROUP BY product_id ORDER BY product_id
    LOOP
        SELECT COALESCE(sum(quantity), 0) INTO v_reserved FROM wholesale_order_items
         WHERE wholesale_order_id = p_reserved_order AND product_id = r.product_id AND COALESCE(quantity, 0) <> 0;
        v_name := NULL; v_stock := NULL;
        SELECT name, stock INTO v_name, v_stock FROM products WHERE id = r.product_id;
        v_name := COALESCE(v_name, r.item_name, 'product');
        IF r.qty > COALESCE(v_stock, 0) + v_reserved THEN
            RAISE EXCEPTION 'Insufficient stock for %: have %, need %', v_name, COALESCE(v_stock, 0) + v_reserved, r.qty;
        END IF;
        IF NULLIF(p_warehouse, '') IS NOT NULL THEN
            SELECT quantity, true INTO v_ws, v_ws_found FROM warehouse_stock
             WHERE warehouse_id::TEXT = p_warehouse AND product_id = r.product_id FOR UPDATE;
            IF FOUND THEN
                v_ws := COALESCE(v_ws, 0) + CASE WHEN COALESCE(p_reserved_warehouse, '') = p_warehouse THEN v_reserved ELSE 0 END;
                IF r.qty > v_ws THEN
                    RAISE EXCEPTION 'Insufficient warehouse stock for %: have %, need %', v_name, v_ws, r.qty;
                END IF;
            END IF;
        END IF;
    END LOOP;
END;
$$;

-- Creates a wholesale credit sale: the order and its lines, the stock taken
-- out (company-wide and from the warehouse), the 'out' movements, and the
-- Draft COGS and invoice entries. Returns the new order's id.
CREATE OR REPLACE FUNCTION create_wholesale_order(p_order JSONB, p_items JSONB, p_created_by TEXT DEFAULT NULL, p_today DATE DEFAULT CURRENT_DATE)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_id UUID;
    v_wh TEXT := NULLIF(p_order->>'warehouse_id', '');
    v_total NUMERIC;
BEGIN
    IF NULLIF(btrim(COALESCE(p_order->>'customer_name', '')), '') IS NULL THEN
        RAISE EXCEPTION 'Enter the customer name';
    END IF;
    PERFORM wp_check_order_stock(p_items, v_wh, NULL, NULL);
    SELECT COALESCE(sum(quantity * unit_price), 0) INTO v_total FROM wp_items(p_items);

    INSERT INTO wholesale_orders (invoice_number, customer_name, customer_phone, warehouse_id, order_date, due_date,
                                  status, total_amount, amount_paid, payment_status, notes, created_by)
    VALUES (NULLIF(p_order->>'invoice_number', ''), p_order->>'customer_name', NULLIF(p_order->>'customer_phone', ''), v_wh,
            COALESCE(NULLIF(p_order->>'order_date', '')::DATE, p_today), NULLIF(p_order->>'due_date', '')::DATE,
            COALESCE(NULLIF(p_order->>'status', ''), 'Open'), v_total, 0, 'Unpaid', NULLIF(p_order->>'notes', ''),
            COALESCE(NULLIF(p_created_by, ''), 'System'))
    RETURNING id INTO v_id;

    INSERT INTO wholesale_order_items (wholesale_order_id, product_id, product_name, quantity, unit_price)
    SELECT v_id, product_id, product_name, quantity, unit_price FROM wp_items(p_items) ORDER BY ord;

    PERFORM wp_move_order_stock(v_id, v_wh, -1);
    PERFORM wp_log_order_movements(v_id, p_created_by, p_today);
    PERFORM wp_post_order_cogs(v_id, p_today);
    PERFORM wp_post_order_invoice(v_id, COALESCE(NULLIF(p_order->>'order_date', '')::DATE, p_today));
    RETURN v_id;
END;
$$;

-- Edits an order (header and lines) from what the database holds now, not
-- the screen's copy: puts the current lines' stock back, takes the edited
-- lines out, re-logs the movements and re-books the COGS entry, and the
-- invoice entry as before (a Draft one re-booked at the new total — in place
-- once payments exist; a Posted one only while the total is unchanged).
-- Refused for a cancelled order. Returns {"notices": […]}.
CREATE OR REPLACE FUNCTION update_wholesale_order(p_id UUID, p_updates JSONB, p_items JSONB, p_edited_by TEXT DEFAULT NULL, p_today DATE DEFAULT CURRENT_DATE)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    o wholesale_orders%ROWTYPE;
    v_wh TEXT := NULLIF(p_updates->>'warehouse_id', '');
    v_total NUMERIC;
    v_paid NUMERIC;
    v_inv_id UUID;
    v_inv_status TEXT;
    v_inv_number TEXT;
    v_rebook BOOLEAN;
    v_in_place BOOLEAN;
    v_notices TEXT[] := '{}';
    v_notice TEXT;
    v_date DATE := COALESCE(NULLIF(p_updates->>'order_date', '')::DATE, p_today);
    v_ar UUID;
    v_revenue UUID;
    v_name TEXT;
    v_label TEXT;
    v_amount NUMERIC;
BEGIN
    SELECT * INTO o FROM wholesale_orders WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This order no longer exists.';
    END IF;
    IF o.status = 'Cancelled' THEN
        RAISE EXCEPTION 'Cannot edit a cancelled order';
    END IF;
    IF p_updates->>'status' = 'Cancelled' THEN
        RAISE EXCEPTION 'Use Cancel to cancel an order, so its stock is returned.';
    END IF;
    IF NULLIF(btrim(COALESCE(p_updates->>'customer_name', '')), '') IS NULL THEN
        RAISE EXCEPTION 'Enter the customer name';
    END IF;

    SELECT COALESCE(sum(quantity * unit_price), 0) INTO v_total FROM wp_items(p_items);
    v_paid := COALESCE(o.amount_paid, 0);

    SELECT id, COALESCE(status, 'Posted'), COALESCE(entry_number, '') INTO v_inv_id, v_inv_status, v_inv_number
      FROM journal_entries WHERE reference_id = 'WSO-' || p_id || '-INV' ORDER BY created_at LIMIT 1 FOR UPDATE;
    IF v_inv_id IS NOT NULL AND v_inv_status <> 'Draft' AND abs(v_total - COALESCE(o.total_amount, 0)) > 0.005 THEN
        RAISE EXCEPTION 'This order''s invoice entry is already POSTED at the old total — unpost it in Journal Entries, then edit the order.';
    END IF;
    IF v_inv_id IS NOT NULL AND v_paid > 0.005 AND v_total < v_paid - 0.005 THEN
        RAISE EXCEPTION 'The edited total (%) is below what this order has already been paid (%) — delete its payments first.',
            to_char(v_total, 'FM999999999990.00'), to_char(v_paid, 'FM999999999990.00');
    END IF;
    v_rebook := (v_inv_id IS NULL OR v_inv_status = 'Draft') AND v_paid <= 0.005;
    v_in_place := v_inv_id IS NOT NULL AND v_inv_status = 'Draft' AND v_paid > 0.005;

    PERFORM wp_check_order_stock(p_items, v_wh, p_id, NULLIF(o.warehouse_id::TEXT, ''));

    -- Put back what the order holds now.
    PERFORM wp_move_order_stock(p_id, NULLIF(o.warehouse_id::TEXT, ''), 1);
    DELETE FROM stock_movements WHERE reference_id = p_id::TEXT AND type = 'out';
    v_notice := wp_remove_order_entry(p_id, 'COGS');
    IF v_notice IS NOT NULL THEN v_notices := v_notices || v_notice; END IF;
    IF v_rebook THEN
        v_notice := wp_remove_order_entry(p_id, 'INV');
        IF v_notice IS NOT NULL THEN v_notices := v_notices || v_notice; END IF;
    END IF;

    UPDATE wholesale_orders SET
        customer_name = p_updates->>'customer_name',
        customer_phone = NULLIF(p_updates->>'customer_phone', ''),
        warehouse_id = v_wh,
        order_date = NULLIF(p_updates->>'order_date', '')::DATE,
        due_date = NULLIF(p_updates->>'due_date', '')::DATE,
        status = COALESCE(NULLIF(p_updates->>'status', ''), o.status),
        invoice_number = NULLIF(p_updates->>'invoice_number', ''),
        notes = NULLIF(p_updates->>'notes', ''),
        total_amount = v_total,
        payment_status = CASE WHEN v_paid <= 0.005 THEN 'Unpaid' WHEN v_paid >= v_total - 0.005 THEN 'Paid' ELSE 'Partial' END
     WHERE id = p_id;

    DELETE FROM wholesale_order_items WHERE wholesale_order_id = p_id;
    INSERT INTO wholesale_order_items (wholesale_order_id, product_id, product_name, quantity, unit_price)
    SELECT p_id, product_id, product_name, quantity, unit_price FROM wp_items(p_items)
     WHERE product_id IS NOT NULL AND quantity <> 0 ORDER BY ord;

    -- Take the edited lines out.
    PERFORM wp_move_order_stock(p_id, v_wh, -1);
    PERFORM wp_log_order_movements(p_id, p_edited_by, p_today);
    PERFORM wp_post_order_cogs(p_id, p_today);

    IF v_rebook THEN
        PERFORM wp_post_order_invoice(p_id, v_date);
    ELSIF v_in_place THEN
        -- Re-book the paid order's Draft invoice entry where it is, so the
        -- payments' A/R credits keep their invoice.
        v_amount := round(v_total, 2);
        IF v_amount <= 0 THEN
            RAISE EXCEPTION 'The invoice entry needs a total above zero';
        END IF;
        v_ar := wp_account('1200', 'Asset', 'receivable');
        v_revenue := wp_account('4000', 'Revenue', 'sales revenue', true);
        IF v_ar IS NULL OR v_revenue IS NULL THEN
            RAISE EXCEPTION 'No active Accounts Receivable / Sales Revenue account found';
        END IF;
        v_label := wp_order_label(p_id);
        v_name := COALESCE(NULLIF(p_updates->>'customer_name', ''), 'Wholesale');
        UPDATE journal_entries SET
            date = v_date,
            description = CASE WHEN v_inv_number <> ''
                               THEN 'Wholesale - ' || regexp_replace(v_inv_number, '^JE-\d+-', '') || ' — ' || v_label || ' · Invoice'
                               ELSE v_label || ' · invoice' END
         WHERE id = v_inv_id AND status = 'Draft';
        DELETE FROM journal_entry_lines WHERE journal_entry_id = v_inv_id;
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
            (v_inv_id, v_ar, v_amount, 0, 'Invoice — ' || v_name),
            (v_inv_id, v_revenue, 0, v_amount, 'Sales — ' || v_name);
    END IF;

    RETURN jsonb_build_object('notices', to_jsonb(v_notices));
END;
$$;

-- Changes an order's status. Cancelling puts its stock back, removes its
-- 'out' movements and takes its COGS and invoice entries off the books; an
-- order whose payments settle its invoice must have them deleted first. A
-- cancelled order stays cancelled. Returns {"notices": […]}.
CREATE OR REPLACE FUNCTION set_wholesale_order_status(p_id UUID, p_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    o wholesale_orders%ROWTYPE;
    v_notices TEXT[] := '{}';
    v_notice TEXT;
BEGIN
    SELECT * INTO o FROM wholesale_orders WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This order no longer exists.';
    END IF;
    IF o.status = 'Cancelled' THEN
        IF p_status = 'Cancelled' THEN
            RAISE EXCEPTION 'This order is already cancelled — its stock has been returned.';
        END IF;
        RAISE EXCEPTION 'This order has been cancelled and its stock returned, so it can''t be marked %.', p_status;
    END IF;
    IF p_status = 'Cancelled' THEN
        IF COALESCE(o.amount_paid, 0) > 0.005
           AND EXISTS (SELECT 1 FROM journal_entries WHERE reference_id = 'WSO-' || p_id || '-INV') THEN
            RAISE EXCEPTION 'This order has recorded payments — delete its payments first, then cancel (or delete the whole order).';
        END IF;
        PERFORM 1 FROM products
         WHERE id IN (SELECT product_id FROM wholesale_order_items WHERE wholesale_order_id = p_id)
         ORDER BY id FOR UPDATE;
        PERFORM wp_move_order_stock(p_id, NULLIF(o.warehouse_id::TEXT, ''), 1);
        DELETE FROM stock_movements WHERE reference_id = p_id::TEXT AND type = 'out';
        v_notice := wp_remove_order_entry(p_id, 'COGS');
        IF v_notice IS NOT NULL THEN v_notices := v_notices || v_notice; END IF;
        v_notice := wp_remove_order_entry(p_id, 'INV');
        IF v_notice IS NOT NULL THEN v_notices := v_notices || v_notice; END IF;
    END IF;
    UPDATE wholesale_orders SET status = p_status WHERE id = p_id;
    RETURN jsonb_build_object('notices', to_jsonb(v_notices));
END;
$$;

-- Deletes an order: puts its stock back (unless it was cancelled, which
-- already did), removes its movements, its payments with their Income rows
-- and ledger entries, and its COGS and invoice entries. Deleting an order
-- that is already gone is not an error. Returns
-- {"deleted": true|false, "notices": […]}.
CREATE OR REPLACE FUNCTION delete_wholesale_order(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    o wholesale_orders%ROWTYPE;
    r RECORD;
    v_notices TEXT[] := '{}';
    v_notice TEXT;
BEGIN
    SELECT * INTO o FROM wholesale_orders WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('deleted', false, 'notices', '[]'::JSONB);
    END IF;
    IF COALESCE(o.status, '') <> 'Cancelled' THEN
        PERFORM 1 FROM products
         WHERE id IN (SELECT product_id FROM wholesale_order_items WHERE wholesale_order_id = p_id)
         ORDER BY id FOR UPDATE;
        PERFORM wp_move_order_stock(p_id, NULLIF(o.warehouse_id::TEXT, ''), 1);
        DELETE FROM stock_movements WHERE reference_id = p_id::TEXT AND type = 'out';
    END IF;
    FOR r IN SELECT id FROM customer_payments WHERE wholesale_order_id = p_id LOOP
        PERFORM wp_remove_tagged_transactions('#WSP-' || left(r.id::TEXT, 8));
    END LOOP;
    DELETE FROM customer_payments WHERE wholesale_order_id = p_id;
    DELETE FROM wholesale_order_items WHERE wholesale_order_id = p_id;
    DELETE FROM wholesale_orders WHERE id = p_id;
    v_notice := wp_remove_order_entry(p_id, 'COGS');
    IF v_notice IS NOT NULL THEN v_notices := v_notices || v_notice; END IF;
    v_notice := wp_remove_order_entry(p_id, 'INV');
    IF v_notice IS NOT NULL THEN v_notices := v_notices || v_notice; END IF;
    RETURN jsonb_build_object('deleted', true, 'notices', to_jsonb(v_notices));
END;
$$;

-- ---------------------------------------------------------------------------
-- Customer payments (wholesale)
-- ---------------------------------------------------------------------------

-- Records a customer payment: the payment row, the order's amount paid and
-- payment status, the Income row (category 'លក់ដុំ', tagged '#WSP-<id>') and
-- its Draft ledger entry (Dr cash/bank / Cr A/R when the order has an
-- invoice entry, else Cr Sales). More than the balance still owed, or a
-- payment on a cancelled order, is refused. Returns
-- {"payment_id": …, "notices": […]}.
CREATE OR REPLACE FUNCTION record_customer_payment(
    p_order_id UUID, p_amount NUMERIC, p_method TEXT, p_notes TEXT, p_pay_date DATE,
    p_received_by TEXT DEFAULT NULL, p_account_id UUID DEFAULT NULL, p_account_name TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    o wholesale_orders%ROWTYPE;
    v_payment UUID;
    v_paid NUMERIC;
    v_balance NUMERIC;
    v_name TEXT;
    v_description TEXT;
    v_tx UUID := gen_random_uuid();
    v_has_invoice BOOLEAN;
    v_ar UUID;
    v_credit UUID;
    v_cash UUID;
    v_notices TEXT[] := '{}';
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Enter a valid amount';
    END IF;
    SELECT * INTO o FROM wholesale_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found';
    END IF;
    IF o.status = 'Cancelled' THEN
        RAISE EXCEPTION 'This order has been cancelled, so it can''t take a payment.';
    END IF;
    v_balance := COALESCE(o.total_amount, 0) - COALESCE(o.amount_paid, 0);
    IF p_amount > v_balance + 0.005 THEN
        RAISE EXCEPTION 'This payment (%) is more than the % still owed on this order.',
            to_char(p_amount, 'FM999999999990.00'), to_char(GREATEST(v_balance, 0), 'FM999999999990.00');
    END IF;

    INSERT INTO customer_payments (wholesale_order_id, amount, payment_date, payment_method, notes, received_in_account_id)
    VALUES (p_order_id, p_amount, p_pay_date, p_method, NULLIF(p_notes, ''), p_account_id)
    RETURNING id INTO v_payment;

    v_paid := COALESCE(o.amount_paid, 0) + p_amount;
    UPDATE wholesale_orders SET
        amount_paid = v_paid,
        payment_status = CASE WHEN v_paid >= o.total_amount THEN 'Paid' WHEN v_paid > 0 THEN 'Partial' ELSE 'Unpaid' END
     WHERE id = p_order_id;

    v_name := COALESCE(NULLIF(o.customer_name, ''), 'Wholesale');
    v_description := v_name || ' · ' || COALESCE(NULLIF(o.invoice_number, ''), 'WO-' || upper(left(p_order_id::TEXT, 8)))
                     || ' #WSP-' || left(v_payment::TEXT, 8);
    INSERT INTO transactions (id, date, type, category, amount, description, pay_by, added_by)
    VALUES (v_tx, p_pay_date::TIMESTAMP AT TIME ZONE 'UTC', 'Income', 'លក់ដុំ', p_amount, v_description,
            COALESCE(NULLIF(p_account_name, ''), NULLIF(p_method, '')), COALESCE(NULLIF(p_received_by, ''), 'Wholesale'));

    v_has_invoice := EXISTS (SELECT 1 FROM journal_entries WHERE reference_id = 'WSO-' || p_order_id || '-INV');
    IF v_has_invoice THEN
        v_ar := wp_account('1200', 'Asset', 'receivable');
        v_credit := v_ar;
        IF v_ar IS NULL THEN
            v_notices := v_notices || 'Payment and Income logged, but no active Accounts Receivable account exists — the ledger entry was skipped. Re-activate account 1200 in the Chart of Accounts.'::TEXT;
        END IF;
    ELSE
        v_credit := wp_account('4000', 'Revenue', 'sales revenue', true);
    END IF;
    v_cash := COALESCE(p_account_id, wp_cash_bank_account(COALESCE(NULLIF(p_account_name, ''), p_method), true));
    IF v_credit IS NOT NULL AND v_cash IS NOT NULL THEN
        PERFORM wp_post_entry('WSP', p_pay_date, v_name, 'TX-' || v_tx, p_amount,
                              v_cash, 'Receipt — ' || v_name,
                              v_credit, CASE WHEN v_ar IS NOT NULL THEN 'Settle receivable' ELSE 'Sales' END || ' — ' || v_name);
    END IF;

    RETURN jsonb_build_object('payment_id', v_payment, 'notices', to_jsonb(v_notices));
END;
$$;

-- Deletes a customer payment: takes it off the order's amount paid, and
-- removes its Income row and ledger entry. A payment that is already gone
-- is not an error. Returns {"deleted": true|false}.
CREATE OR REPLACE FUNCTION delete_customer_payment(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_order_id UUID;
    v_amount NUMERIC;
    o wholesale_orders%ROWTYPE;
    v_paid NUMERIC;
BEGIN
    SELECT wholesale_order_id INTO v_order_id FROM customer_payments WHERE id = p_payment_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('deleted', false);
    END IF;
    -- The order first (the same lock order as recording a payment), then the payment.
    IF v_order_id IS NOT NULL THEN
        SELECT * INTO o FROM wholesale_orders WHERE id = v_order_id FOR UPDATE;
    END IF;
    SELECT amount INTO v_amount FROM customer_payments WHERE id = p_payment_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('deleted', false);
    END IF;
    IF o.id IS NOT NULL THEN
        v_paid := GREATEST(0, COALESCE(o.amount_paid, 0) - COALESCE(v_amount, 0));
        UPDATE wholesale_orders SET
            amount_paid = v_paid,
            payment_status = CASE WHEN v_paid = 0 THEN 'Unpaid' WHEN v_paid >= o.total_amount THEN 'Paid' ELSE 'Partial' END
         WHERE id = o.id;
    END IF;
    DELETE FROM customer_payments WHERE id = p_payment_id;
    PERFORM wp_remove_tagged_transactions('#WSP-' || left(p_payment_id::TEXT, 8));
    RETURN jsonb_build_object('deleted', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- Supplier payments
-- ---------------------------------------------------------------------------

-- Records one supplier payment across one or more of the supplier's bills
-- (p_allocations: [{"po_id": …, "amount": …}, …]) — all of them or none. Per
-- bill: the payment row, the PO's amount paid and payment status, the
-- Expense row (category 'ទិញឥវ៉ាន់', tagged '#SPP-<id>') and its Draft
-- ledger entry (Dr A/P when the PO's receive entry exists, else the purchase
-- expense / Cr cash/bank). More than a bill's balance is refused. Returns
-- {"payment_ids": […]}.
CREATE OR REPLACE FUNCTION record_supplier_payments(
    p_supplier_id UUID, p_allocations JSONB, p_method TEXT, p_notes TEXT, p_pay_date DATE,
    p_paid_by TEXT DEFAULT NULL, p_account_id UUID DEFAULT NULL, p_account_name TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    a RECORD;
    po purchase_orders%ROWTYPE;
    v_supplier TEXT;
    v_payment UUID;
    v_paid NUMERIC;
    v_balance NUMERIC;
    v_tx UUID;
    v_ap UUID;
    v_debit UUID;
    v_cash UUID;
    v_ids JSONB := '[]'::JSONB;
BEGIN
    IF p_allocations IS NULL OR jsonb_array_length(p_allocations) = 0 THEN
        RAISE EXCEPTION 'Apply the payment to at least one bill';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_allocations) l
                WHERE COALESCE(NULLIF(l->>'amount', '')::NUMERIC, 0) <= 0) THEN
        RAISE EXCEPTION 'Enter a valid amount';
    END IF;
    IF (SELECT count(DISTINCT l->>'po_id') FROM jsonb_array_elements(p_allocations) l) <> jsonb_array_length(p_allocations) THEN
        RAISE EXCEPTION 'A bill is listed twice in this payment.';
    END IF;
    -- Every bill, in id order, before anything is written.
    PERFORM 1 FROM purchase_orders
     WHERE id IN (SELECT (l->>'po_id')::UUID FROM jsonb_array_elements(p_allocations) l)
     ORDER BY id FOR UPDATE;
    SELECT name INTO v_supplier FROM suppliers WHERE id = p_supplier_id;
    v_supplier := COALESCE(NULLIF(v_supplier, ''), 'Supplier');
    v_cash := COALESCE(p_account_id, wp_cash_bank_account(COALESCE(NULLIF(p_account_name, ''), p_method), false));

    FOR a IN SELECT (l->>'po_id')::UUID AS po_id, (l->>'amount')::NUMERIC AS amount
               FROM jsonb_array_elements(p_allocations) WITH ORDINALITY AS t(l, ord) ORDER BY ord
    LOOP
        SELECT * INTO po FROM purchase_orders WHERE id = a.po_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PO not found';
        END IF;
        v_balance := COALESCE(po.total_amount, 0) - COALESCE(po.amount_paid, 0);
        IF a.amount > v_balance + 0.005 THEN
            RAISE EXCEPTION '%: this payment (%) is more than the % still owed.',
                COALESCE(NULLIF(po.invoice_number, ''), 'PO-' || upper(left(po.id::TEXT, 8))),
                to_char(a.amount, 'FM999999999990.00'), to_char(GREATEST(v_balance, 0), 'FM999999999990.00');
        END IF;

        INSERT INTO supplier_payments (purchase_order_id, supplier_id, amount, payment_date, payment_method, notes, paid_from_account_id)
        VALUES (a.po_id, p_supplier_id, a.amount, p_pay_date, p_method, p_notes, p_account_id)
        RETURNING id INTO v_payment;
        v_ids := v_ids || to_jsonb(v_payment);

        v_paid := COALESCE(po.amount_paid, 0) + a.amount;
        UPDATE purchase_orders SET
            amount_paid = v_paid,
            payment_status = CASE WHEN v_paid >= po.total_amount THEN 'Paid' ELSE 'Partial' END
         WHERE id = a.po_id;

        v_tx := gen_random_uuid();
        INSERT INTO transactions (id, date, type, category, amount, description, pay_by, added_by)
        VALUES (v_tx, p_pay_date::TIMESTAMP AT TIME ZONE 'UTC', 'Expense', 'ទិញឥវ៉ាន់', a.amount,
                v_supplier || ' · PO-' || upper(left(a.po_id::TEXT, 8)) || ' #SPP-' || left(v_payment::TEXT, 8),
                COALESCE(NULLIF(p_account_name, ''), NULLIF(p_method, '')), COALESCE(NULLIF(p_paid_by, ''), 'Purchasing'));

        v_ap := NULL;
        IF EXISTS (SELECT 1 FROM journal_entries WHERE reference_id = 'PO-' || a.po_id) THEN
            v_ap := wp_account('2000', 'Liability', 'payable');
        END IF;
        v_debit := COALESCE(v_ap, wp_account('5000', 'Expense', 'cost of goods|cogs|purchas', true));
        IF v_debit IS NOT NULL AND v_cash IS NOT NULL THEN
            PERFORM wp_post_entry('SPP', p_pay_date, v_supplier, 'TX-' || v_tx, a.amount,
                                  v_debit, CASE WHEN v_ap IS NOT NULL THEN 'Settle payable — ' ELSE 'Purchase — ' END || v_supplier,
                                  v_cash, 'Payment — ' || v_supplier);
        END IF;
    END LOOP;

    RETURN jsonb_build_object('payment_ids', v_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION wp_account(TEXT, TEXT, TEXT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_cash_bank_match(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_cash_bank_account(TEXT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_next_entry_number(TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_post_entry(TEXT, DATE, TEXT, TEXT, NUMERIC, UUID, TEXT, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_remove_tagged_transactions(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_add_stock(TEXT, INTEGER, NUMERIC, TEXT, TEXT, TEXT, TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION add_product_stock(TEXT, INTEGER, NUMERIC, TEXT, TEXT, TEXT, TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION receive_purchase_order(UUID, TEXT, TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_items(JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_move_order_stock(UUID, TEXT, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_log_order_movements(UUID, TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_order_label(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_post_order_cogs(UUID, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_post_order_invoice(UUID, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_remove_order_entry(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_check_order_stock(JSONB, TEXT, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_wholesale_order(JSONB, JSONB, TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_wholesale_order(UUID, JSONB, JSONB, TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_wholesale_order_status(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_wholesale_order(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION record_customer_payment(UUID, NUMERIC, TEXT, TEXT, DATE, TEXT, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_customer_payment(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION record_supplier_payments(UUID, JSONB, TEXT, TEXT, DATE, TEXT, UUID, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
