-- Orders: shipping-status changes, restocks and item edits move stock inside
-- the database, in one transaction. Run once in each instance's Supabase SQL
-- editor (Romdoul1, Romdoul2, Romdoul3). Safe to re-run.
--
-- A status change used to be a string of separate writes from the browser:
-- read the status, take the stock out (or put it back), write the status, log
-- the stock-out. Two saves at once (a double click on Save or 'Mark shipped',
-- two tabs, a screen that was out of date) both took the stock out and both
-- logged an 'Order Shipped' movement, and a write that failed part-way left
-- stock moved for a status that never changed. Each function here locks the
-- order first (then its products, always in id order), checks the order is
-- still at the status the caller saw, and does the status, stock,
-- inventory_items, stock_movements and restocks writes together: all of them
-- happen or none do, and a second caller waits and is then refused.
--
-- The row locks are FOR NO KEY UPDATE (the lock a plain UPDATE takes), not
-- FOR UPDATE: every foreign-key check on sale_items, inventory_items and
-- restocks takes FOR KEY SHARE on the product (and order) it points at, and
-- FOR UPDATE conflicts with that, so two saves touching the same product (or
-- a new order being created at the same time) could deadlock, and every ship
-- would block new orders for its products until it committed.
--
-- Payment and income (transactions, sales journal entries, payment_status)
-- are not touched here; the app still handles those itself.
--
-- Until this is run, changing an order's shipping status, restocking a
-- returned order and editing the items of a shipped (or delivered, or
-- returned) order are refused, before anything is saved, with a message
-- saying to run this file. Tracking and courier saves, and item edits on an
-- order whose goods are still on hand, keep working without it.
--
-- FIFO costing. Goods leaving with an order take the oldest inventory
-- layers for each line (wp_internal.fifo_take_line), and the line keeps
-- their cost (sale_items.cogs_cost): that frozen cost is what settlement
-- books as COGS, whenever it happens. Goods coming back return the line's
-- own layers (fifo_give_back_line). An order whose COGS was booked before it
-- shipped (settled first, booked at a peek of the layers) gets a Draft
-- ORD-<id>-COGS-ADJ for the difference when it ships or is edited while
-- shipped. The 'out' and 'Customer Return' movements carry the FIFO
-- unit_cost next to the selling price.
--
-- RUN ORDER: add_fifo_costing.sql, then fifo_rebuild_pool.sql on this store,
-- then the four packs (this one, add_order_payment_functions.sql,
-- add_wholesale_procurement_functions.sql, add_stock_adjustment_posting.sql),
-- then add_session_guards.sql. This file refuses to load before the first
-- two (see the check below).

-- FIFO costing must be in place: this file calls the line helpers of
-- add_fifo_costing.sql, and taking layers only makes sense once the pool has
-- been rebuilt (fifo_rebuild_pool.sql leaves its inventory_items_bak_<date>
-- backup behind). A store with no layers at all needs no rebuild. For a
-- store whose pool is known to match its stock, run
--     SET fifo.pool_ready = 'on';
-- in the same SQL-editor run, before this file.
DO $$
BEGIN
    IF to_regprocedure('wp_internal.fifo_give_back_line(text,text,text)') IS NULL THEN
        RAISE EXCEPTION 'Run migrations/add_fifo_costing.sql first, then migrations/fifo_rebuild_pool.sql, then this file.';
    END IF;
    IF EXISTS (SELECT 1 FROM inventory_items)
       AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'inventory\_items\_bak\_%')
       AND COALESCE(current_setting('fifo.pool_ready', true), '') <> 'on' THEN
        RAISE EXCEPTION 'Rebuild the FIFO pool first: run migrations/fifo_rebuild_pool.sql on this store, then this file.';
    END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS wp_internal;
GRANT USAGE ON SCHEMA wp_internal TO anon, authenticated;

-- Books a Draft entry moving p_amount between Cost of Goods Sold (5000) and
-- Inventory (1300) for a retail order, reference ORD-<id>-COGS-<p_suffix>:
-- ADJ when the cost that actually shipped differs from what settlement
-- booked, REV for booked cost of goods that came back. p_amount > 0 is
-- Dr 5000 / Cr 1300, < 0 is Dr 1300 / Cr 5000. Numbered like the order's
-- other retail entries. Returns false, booking nothing, when the amount
-- rounds to 0 or the chart lacks either account.
CREATE OR REPLACE FUNCTION wp_internal.os_post_cogs_move(p_order_id TEXT, p_suffix TEXT, p_amount NUMERIC, p_date DATE)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_amount NUMERIC := round(COALESCE(p_amount, 0), 2);
    v_cogs UUID := wp_internal.wp_account('5000', 'Expense', 'cost of goods|cogs');
    v_inventory UUID := wp_internal.wp_account('1300', 'Asset', 'inventor|stock');
    v_name TEXT;
    v_number TEXT;
    v_entry UUID;
BEGIN
    IF v_amount = 0 OR v_cogs IS NULL OR v_inventory IS NULL THEN
        RETURN false;
    END IF;
    SELECT NULLIF(customer_snapshot->>'name', '') INTO v_name FROM sales WHERE id = p_order_id;
    v_number := wp_internal.wp_next_entry_number('RCP', COALESCE(p_date, CURRENT_DATE));
    INSERT INTO journal_entries (date, description, reference_id, status, entry_number)
    VALUES (COALESCE(p_date, CURRENT_DATE),
            'Retail - ' || regexp_replace(v_number, '^JE-\d+-', '') || ' — ' || COALESCE(v_name, 'Customer')
                || CASE WHEN p_suffix = 'REV' THEN ' · cost of goods returned' ELSE ' · cost of goods adjustment' END,
            'ORD-' || p_order_id || '-COGS-' || p_suffix, 'Draft', v_number)
    RETURNING id INTO v_entry;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_entry, v_cogs, GREATEST(v_amount, 0), GREATEST(-v_amount, 0),
         CASE WHEN v_amount > 0 THEN 'Cost of goods sold' ELSE 'Cost of goods returned' END),
        (v_entry, v_inventory, GREATEST(-v_amount, 0), GREATEST(v_amount, 0), 'Inventory at cost');
    RETURN true;
END;
$$;

-- Settle-before-ship: settlement books an order that has not shipped at a
-- peek of the layers (sale_items.cogs_booked). Once its lines hold units at
-- their actual cost (cogs_cost), the difference is booked as one Draft
-- ORD-<id>-COGS-ADJ, and those lines' cogs_booked become their cogs_cost.
-- Lines with nothing booked are left alone. Returns the amount booked.
CREATE OR REPLACE FUNCTION wp_internal.os_true_up_booked_cogs(p_order_id TEXT, p_date DATE)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
    v_diff NUMERIC;
BEGIN
    SELECT COALESCE(sum(cogs_cost - cogs_booked), 0) INTO v_diff FROM sale_items
     WHERE sale_id = p_order_id AND cogs_cost IS NOT NULL AND cogs_booked IS NOT NULL;
    IF round(v_diff, 2) <> 0 AND NOT wp_internal.os_post_cogs_move(p_order_id, 'ADJ', v_diff, p_date) THEN
        RETURN 0;
    END IF;
    UPDATE sale_items SET cogs_booked = cogs_cost
     WHERE sale_id = p_order_id AND cogs_cost IS NOT NULL AND cogs_booked IS NOT NULL;
    RETURN round(v_diff, 2);
END;
$$;

-- Puts p_total — the COGS already booked for an order whose lines were just
-- replaced — on its new product lines, by quantity, in cents (the first of
-- them, the largest, takes the remainder), so the order keeps what it has
-- booked. Lines with no product get NULL, as settlement books only product
-- lines (order_cogs_lines) and the true-up and the FIFO check only look at
-- lines with a cost. An order left with no product line keeps the whole
-- amount on its first line.
CREATE OR REPLACE FUNCTION wp_internal.os_spread_booked(p_order_id TEXT, p_total NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_tq NUMERIC;
    v_left NUMERIC := COALESCE(p_total, 0);
    v_amt NUMERIC;
    r RECORD;
BEGIN
    SELECT COALESCE(sum(GREATEST(COALESCE(quantity, 0), 0)), 0) INTO v_tq
      FROM sale_items WHERE sale_id = p_order_id AND product_id IS NOT NULL;
    FOR r IN
        SELECT id, GREATEST(COALESCE(quantity, 0), 0) AS q, product_id IS NOT NULL AS is_product,
               row_number() OVER (ORDER BY (product_id IS NULL), quantity DESC NULLS LAST, created_at, id) AS rn
          FROM sale_items WHERE sale_id = p_order_id
         ORDER BY rn DESC
    LOOP
        v_amt := CASE WHEN r.rn = 1 THEN v_left
                      WHEN NOT r.is_product THEN NULL
                      WHEN v_tq > 0 THEN round(COALESCE(p_total, 0) * r.q / v_tq, 2)
                      ELSE 0 END;
        UPDATE sale_items SET cogs_booked = v_amt WHERE id = r.id;
        v_left := v_left - COALESCE(v_amt, 0);
    END LOOP;
END;
$$;

-- Whether the ledger holds COGS for a retail order: one of its receipt
-- entries (TX-<income row of the order>) or its ORD-<id>-COGS moves
-- something out of Inventory (1300), whatever the entry's status.
CREATE OR REPLACE FUNCTION wp_internal.os_order_cogs_in_ledger(p_order_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM journal_entries e
          JOIN journal_entry_lines l ON l.journal_entry_id = e.id
         WHERE l.account_id = wp_internal.wp_account('1300', 'Asset', 'inventor|stock')
           AND COALESCE(l.credit, 0) > 0
           AND (e.reference_id = 'ORD-' || p_order_id || '-COGS'
                OR e.reference_id IN (SELECT 'TX-' || t.id FROM transactions t WHERE t.order_id = p_order_id)));
$$;

-- Statuses where the order's goods are counted out of stock: shipped,
-- delivered, or on their way back (Returned keeps them out until Restock).
CREATE OR REPLACE FUNCTION order_status_holds_stock(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$ SELECT COALESCE(p_status, '') IN ('Shipped', 'Delivered', 'Returned') $$;

-- Statuses where the goods are gone for good (Shipped -> Delivered moves
-- nothing).
CREATE OR REPLACE FUNCTION order_status_stock_consumed(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$ SELECT COALESCE(p_status, '') IN ('Shipped', 'Delivered') $$;

-- Restocks the orders in p_ids that are Returned right now (others are
-- skipped, the same as the app always did): puts their FIFO inventory items
-- back in stock, adds each product's returned quantity to products.stock,
-- writes one restocks row and one 'Customer Return' stock movement per
-- product (a product returned on several orders gets one row naming all of
-- them), and sets the orders to ReStock.
--
-- p_fields: now (timestamp for restocks.date and the edit stamp),
-- movement_date (the user's local day), created_by (user id), added_by (user
-- name), last_edited_by (user name; the edit stamp is written only when given).
--
-- Returns {"restocked": [order ids], "restocks": [rows], "stock": {product: stock}}.
CREATE OR REPLACE FUNCTION restock_returned_orders(p_ids TEXT[], p_fields JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_fields JSONB := COALESCE(p_fields, '{}'::jsonb);
    v_ids TEXT[] := '{}';
    v_now TIMESTAMPTZ := COALESCE(NULLIF(v_fields->>'now', '')::timestamptz, now());
    v_date DATE := COALESCE(NULLIF(v_fields->>'movement_date', '')::date, CURRENT_DATE);
    v_added_by TEXT := COALESCE(NULLIF(v_fields->>'added_by', ''), 'System');
    v_created_by TEXT := COALESCE(NULLIF(v_fields->>'created_by', ''), 'unknown');
    v_restocks JSONB := '[]'::jsonb;
    v_stock JSONB := '{}'::jsonb;
    v_new_stock NUMERIC;
    v_rid UUID;
    v_back NUMERIC;
    v_value JSONB := '{}'::jsonb;
    r RECORD;
BEGIN
    FOR r IN
        SELECT id, shipping_status FROM sales WHERE id = ANY(p_ids) ORDER BY id FOR NO KEY UPDATE
    LOOP
        IF r.shipping_status = 'Returned' THEN
            v_ids := v_ids || r.id;
        END IF;
    END LOOP;
    IF cardinality(v_ids) = 0 THEN
        RETURN jsonb_build_object('restocked', '[]'::jsonb, 'restocks', '[]'::jsonb, 'stock', '{}'::jsonb);
    END IF;

    -- Products before their inventory items, the same order the other
    -- functions take them in.
    PERFORM 1 FROM products
     WHERE id IN (SELECT product_id FROM sale_items WHERE sale_id = ANY(v_ids))
     ORDER BY id
       FOR NO KEY UPDATE;

    -- Each line's layers go back to the pool (units it held with no layer
    -- get one); v_value collects what each product gained, for the
    -- movement's unit cost. Booked COGS is reversed by
    -- apply_restock_payment_side, after the order's Draft income entry is
    -- gone.
    FOR r IN
        SELECT si.id, si.sale_id, si.product_id FROM sale_items si
         WHERE si.sale_id = ANY(v_ids) AND si.product_id IS NOT NULL
         ORDER BY si.sale_id, si.created_at, si.id
    LOOP
        v_back := wp_internal.fifo_give_back_line('retail', r.sale_id, r.id);
        v_value := v_value || jsonb_build_object(r.product_id, COALESCE((v_value->>r.product_id)::NUMERIC, 0) + v_back);
    END LOOP;

    FOR r IN
        WITH lines AS (
            SELECT si.product_id, si.quantity, si.sale_id
              FROM sale_items si
             WHERE si.sale_id = ANY(v_ids) AND si.product_id IS NOT NULL AND si.quantity > 0
        ), orders AS (
            -- Each contributing order once, in the order it was asked for.
            SELECT DISTINCT l.product_id, l.sale_id, array_position(p_ids, l.sale_id) AS pos,
                   NULLIF(s.customer_snapshot->>'name', '') AS cname,
                   NULLIF(s.customer_snapshot->>'phone', '') AS cphone
              FROM lines l JOIN sales s ON s.id = l.sale_id
        )
        SELECT p.id AS product_id, p.name AS product_name,
               (SELECT sum(quantity) FROM lines l WHERE l.product_id = p.id) AS qty,
               (SELECT string_agg('#' || left(o.sale_id, 8)
                                  || CASE WHEN concat_ws(' ', o.cname, o.cphone) <> ''
                                          THEN ' (' || concat_ws(' ', o.cname, o.cphone) || ')' ELSE '' END,
                                  ', ' ORDER BY o.pos, o.sale_id)
                  FROM orders o WHERE o.product_id = p.id) AS sources,
               (SELECT string_agg(n, ', ' ORDER BY first_pos) FROM (
                    SELECT o.cname AS n, min(o.pos) AS first_pos FROM orders o
                     WHERE o.product_id = p.id AND o.cname IS NOT NULL GROUP BY o.cname) x) AS names,
               (SELECT string_agg(n, ', ' ORDER BY first_pos) FROM (
                    SELECT o.cphone AS n, min(o.pos) AS first_pos FROM orders o
                     WHERE o.product_id = p.id AND o.cphone IS NOT NULL GROUP BY o.cphone) x) AS phones
          FROM products p
         WHERE p.id IN (SELECT product_id FROM lines)
         ORDER BY p.id
    LOOP
        UPDATE products SET stock = COALESCE(stock, 0) + r.qty WHERE id = r.product_id
        RETURNING stock INTO v_new_stock;
        v_stock := v_stock || jsonb_build_object(r.product_id, v_new_stock);

        v_rid := gen_random_uuid();
        INSERT INTO restocks (id, product_id, quantity, cost, date, added_by, note)
        VALUES (v_rid, r.product_id, r.qty, 0, v_now, v_added_by, 'Bulk restocked from ' || r.sources);
        v_restocks := v_restocks || jsonb_build_array(jsonb_build_object(
            'id', v_rid, 'product_id', r.product_id, 'quantity', r.qty, 'cost', 0,
            'date', v_now, 'added_by', v_added_by, 'note', 'Bulk restocked from ' || r.sources));

        INSERT INTO stock_movements (product_id, product_name, type, quantity, unit_price, unit_cost, source, shipping_co,
                                     note, movement_date, created_by, customer_name, customer_phone)
        VALUES (r.product_id, COALESCE(NULLIF(r.product_name, ''), r.product_id), 'in', r.qty::INTEGER, 0,
                round(COALESCE((v_value->>r.product_id)::NUMERIC, 0) / NULLIF(r.qty, 0), 4),
                'Customer Return', '', 'Bulk restocked from ' || r.sources, v_date, v_created_by,
                COALESCE(r.names, ''), COALESCE(r.phones, ''));
    END LOOP;

    UPDATE sales SET
        shipping_status = 'ReStock',
        last_edited_at = CASE WHEN v_fields ? 'last_edited_by' THEN v_now ELSE last_edited_at END,
        last_edited_by = CASE WHEN v_fields ? 'last_edited_by' THEN v_fields->>'last_edited_by' ELSE last_edited_by END
     WHERE id = ANY(v_ids);

    RETURN jsonb_build_object('restocked', to_jsonb(v_ids), 'restocks', v_restocks, 'stock', v_stock);
END;
$$;

-- Moves one order to p_new_status, with the stock that goes with it:
--   * goods leave stock (into Shipped, Delivered or Returned from a status
--     where they are on hand): each item's quantity comes off products.stock
--     (never below 0), each line takes the oldest inventory layers and keeps
--     their cost (an order settled before it ships gets a Draft COGS-ADJ for
--     the difference), and a new 'Order Shipped' stock-out generation is
--     logged at that cost;
--   * goods come back (from Shipped/Delivered, or Returned to a pre-ship
--     status; not into Returned or ReStock): stock is put back, each line's
--     layers return to the pool, and the newest stock-out generation
--     (the shipment being reversed) is deleted;
--   * Returned -> ReStock runs restock_returned_orders; ReStock from any
--     other status is refused (only returned goods can be restocked);
--   * a correction back to Shipped (from Delivered or Returned) relabels the
--     existing stock-out records without re-dating them.
-- Refused when the order is no longer at p_expected_status (NULL skips that
-- check), so a double click, a retry or a second device can't repeat it.
--
-- p_fields: tracking_number (written when the key is present, '' clears it),
-- shipping_company (written when not empty), last_edited_at/last_edited_by
-- (written when last_edited_by is present), customer_name/customer_phone (the
-- customer saved in the same edit), fallback_customer_name/_phone (used when
-- neither that nor the order has one), created_by, added_by, movement_date,
-- now.
--
-- Returns {"status", "previous", "stock": {product: stock}} plus, for a
-- restock, "restocked" and "restocks".
CREATE OR REPLACE FUNCTION set_order_shipping_status(p_order_id TEXT, p_expected_status TEXT, p_new_status TEXT, p_fields JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_fields JSONB := COALESCE(p_fields, '{}'::jsonb);
    s sales%ROWTYPE;
    v_old TEXT;
    v_new TEXT := NULLIF(p_new_status, '');
    v_deducted BOOLEAN := false;
    v_name TEXT;
    v_phone TEXT;
    v_info TEXT;
    v_company TEXT;
    v_newest TIMESTAMPTZ;
    v_stock JSONB;
    v_res JSONB;
    v_day DATE := COALESCE(NULLIF(v_fields->>'movement_date', '')::date, CURRENT_DATE);
    r RECORD;
BEGIN
    IF v_new IS NULL THEN
        RAISE EXCEPTION 'No shipping status was given.';
    END IF;

    SELECT * INTO s FROM sales WHERE id = p_order_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This order no longer exists.';
    END IF;
    v_old := COALESCE(NULLIF(s.shipping_status, ''), 'Pending');

    IF p_expected_status IS NOT NULL AND v_old <> COALESCE(NULLIF(p_expected_status, ''), 'Pending') THEN
        RAISE EXCEPTION 'This order is now "%": it was changed somewhere else, so your change was not saved. Refresh and check it before trying again.', v_old;
    END IF;

    IF v_new = 'ReStock' AND v_old <> 'ReStock' THEN
        IF v_old <> 'Returned' THEN
            RAISE EXCEPTION 'Only a Returned order can be restocked. This order is "%".', v_old;
        END IF;
        v_res := restock_returned_orders(ARRAY[p_order_id], v_fields);
        UPDATE sales SET
            tracking_number = CASE WHEN v_fields ? 'tracking_number' THEN v_fields->>'tracking_number' ELSE tracking_number END,
            shipping_company = COALESCE(NULLIF(v_fields->>'shipping_company', ''), shipping_company)
         WHERE id = p_order_id;
        RETURN v_res || jsonb_build_object('status', 'ReStock', 'previous', v_old);
    END IF;

    IF v_new <> v_old THEN
        PERFORM 1 FROM products
         WHERE id IN (SELECT product_id FROM sale_items WHERE sale_id = p_order_id)
         ORDER BY id
           FOR NO KEY UPDATE;
    END IF;

    IF order_status_holds_stock(v_new) AND NOT order_status_holds_stock(v_old) THEN
        -- The goods leave stock now.
        v_deducted := true;
        FOR r IN
            SELECT id, product_id, COALESCE(quantity, 0) AS quantity
              FROM sale_items WHERE sale_id = p_order_id AND product_id IS NOT NULL
             ORDER BY created_at, id
        LOOP
            UPDATE products SET stock = GREATEST(0, COALESCE(stock, 0) - r.quantity) WHERE id = r.product_id;
            -- The oldest layers go to this line; their cost is frozen on it.
            PERFORM wp_internal.fifo_take_line('retail', p_order_id, r.id);
        END LOOP;
        -- Settled before it shipped: book the actual cost's difference.
        PERFORM wp_internal.os_true_up_booked_cogs(p_order_id, v_day);
    ELSIF (order_status_stock_consumed(v_old) OR (v_old = 'Returned' AND v_new <> 'ReStock'))
          AND NOT order_status_stock_consumed(v_new) AND v_new <> 'Returned' THEN
        -- The shipment is reversed: the goods are back on hand, each line's
        -- own layers with them. Booked COGS stays booked (the order may
        -- still be settled); shipping again books any difference.
        FOR r IN
            SELECT id, product_id, COALESCE(quantity, 0) AS quantity
              FROM sale_items WHERE sale_id = p_order_id AND product_id IS NOT NULL
             ORDER BY created_at, id
        LOOP
            UPDATE products SET stock = COALESCE(stock, 0) + r.quantity WHERE id = r.product_id;
            PERFORM wp_internal.fifo_give_back_line('retail', p_order_id, r.id);
        END LOOP;
        -- Only the newest generation: a re-shipped order has one per shipment.
        SELECT max(created_at) INTO v_newest FROM stock_movements WHERE reference_id = p_order_id AND type = 'out';
        IF v_newest IS NOT NULL THEN
            DELETE FROM stock_movements WHERE reference_id = p_order_id AND type = 'out' AND created_at = v_newest;
        END IF;
    END IF;

    UPDATE sales SET
        shipping_status = v_new,
        tracking_number = CASE WHEN v_fields ? 'tracking_number' THEN v_fields->>'tracking_number' ELSE tracking_number END,
        shipping_company = COALESCE(NULLIF(v_fields->>'shipping_company', ''), shipping_company),
        last_edited_at = CASE WHEN v_fields ? 'last_edited_by'
                              THEN COALESCE(NULLIF(v_fields->>'last_edited_at', '')::timestamptz, now()) ELSE last_edited_at END,
        last_edited_by = CASE WHEN v_fields ? 'last_edited_by' THEN v_fields->>'last_edited_by' ELSE last_edited_by END
     WHERE id = p_order_id;

    -- The stock-out record: logged when the order ships (or when this change
    -- took the goods out); Delivery leaves the existing record alone.
    IF (v_new = 'Shipped' OR v_deducted) AND v_old <> v_new THEN
        v_name := COALESCE(NULLIF(v_fields->>'customer_name', ''), NULLIF(s.customer_snapshot->>'name', ''),
                           NULLIF(v_fields->>'fallback_customer_name', ''), '');
        v_phone := COALESCE(NULLIF(v_fields->>'customer_phone', ''), NULLIF(s.customer_snapshot->>'phone', ''),
                            NULLIF(v_fields->>'fallback_customer_phone', ''), '');
        IF NOT v_deducted AND EXISTS (SELECT 1 FROM stock_movements WHERE reference_id = p_order_id AND type = 'out') THEN
            -- A correction back to Shipped: same goods, same date.
            UPDATE stock_movements SET reason = 'Shipped', source = 'Order Shipped',
                   customer_name = v_name, customer_phone = v_phone
             WHERE reference_id = p_order_id AND type = 'out';
        ELSE
            v_company := COALESCE(NULLIF(v_fields->>'shipping_company', ''), CASE WHEN s.shipping_status IS NOT NULL AND s.shipping_status <> '' THEN s.shipping_company END, '');
            v_info := concat_ws(' | ', NULLIF(v_name, ''), NULLIF(v_phone, ''));
            INSERT INTO stock_movements (product_id, product_name, type, quantity, unit_price, unit_cost, reason, reference_id, source,
                                         shipping_co, note, movement_date, created_by, customer_name, customer_phone)
            SELECT si.product_id, COALESCE(NULLIF(si.name, ''), 'Unknown'), 'out', si.quantity::INTEGER, COALESCE(si.price, 0),
                   round(si.cogs_cost / NULLIF(si.quantity, 0), 4),
                   'Shipped', p_order_id, 'Order Shipped', v_company,
                   'Order #' || left(p_order_id, 8) || CASE WHEN v_info <> '' THEN ' — ' || v_info ELSE '' END,
                   COALESCE(NULLIF(v_fields->>'movement_date', '')::date, CURRENT_DATE),
                   COALESCE(NULLIF(v_fields->>'created_by', ''), 'unknown'), v_name, v_phone
              FROM sale_items si
             WHERE si.sale_id = p_order_id AND si.product_id IS NOT NULL AND si.quantity > 0
             ORDER BY si.created_at, si.id;
        END IF;
    END IF;

    SELECT COALESCE(jsonb_object_agg(id, stock), '{}'::jsonb) INTO v_stock
      FROM products WHERE id IN (SELECT product_id FROM sale_items WHERE sale_id = p_order_id);
    RETURN jsonb_build_object('status', v_new, 'previous', v_old, 'stock', v_stock);
END;
$$;

-- Replaces an order's items. When the order's goods are counted out of stock
-- right now (Shipped, Delivered, Returned), stock moves by the difference per
-- product (never below 0), the old lines give their layers back and the new
-- lines take theirs (a settled order gets a Draft COGS-ADJ for any cost
-- difference; COGS already booked moves to the new product lines, and an
-- order settled before the FIFO wiring counts as booked at the layer value
-- its old lines gave back; an edit that leaves no product line reverses
-- what was booked with a Draft COGS-REV), and the newest stock-out
-- generation (the shipment being edited) is changed to match, so a later
-- un-ship, delete or restock reverses exactly what left. A failure keeps the
-- old items: nothing is half-saved.
--
-- p_items: [{id (product id), name, price, quantity, image}], as the app
-- sends them. p_fields: created_by.
--
-- Returns {"held": whether stock moved with the edit, "stock": {product: stock},
-- "missing": [names of products that no longer exist, left unchanged]}.
CREATE OR REPLACE FUNCTION edit_order_items(p_order_id TEXT, p_items JSONB, p_fields JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_fields JSONB := COALESCE(p_fields, '{}'::jsonb);
    v_status TEXT;
    v_before JSONB;
    v_newest TIMESTAMPTZ;
    v_template stock_movements%ROWTYPE;
    v_stock JSONB := '{}'::jsonb;
    v_missing TEXT[] := '{}';
    v_applied JSONB := '[]'::jsonb;
    v_new_stock NUMERIC;
    v_remaining NUMERIC;
    v_take NUMERIC;
    v_holds BOOLEAN;
    v_had_booked BOOLEAN;
    v_booked NUMERIC;
    v_given NUMERIC := 0;
    r RECORD;
    m RECORD;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'The order needs at least one item.';
    END IF;

    SELECT COALESCE(NULLIF(shipping_status, ''), 'Pending') INTO v_status FROM sales WHERE id = p_order_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This order no longer exists.';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity, 'name', name)), '[]'::jsonb)
      INTO v_before FROM sale_items WHERE sale_id = p_order_id;
    -- COGS already booked for the order (settled): carried onto the new lines.
    SELECT bool_or(cogs_booked IS NOT NULL), COALESCE(sum(cogs_booked), 0) INTO v_had_booked, v_booked
      FROM sale_items WHERE sale_id = p_order_id;
    v_holds := order_status_holds_stock(v_status);

    IF v_holds THEN
        PERFORM 1 FROM products
         WHERE id IN (SELECT NULLIF(b->>'product_id', '') FROM jsonb_array_elements(v_before) b
                      UNION SELECT NULLIF(i->>'id', '') FROM jsonb_array_elements(p_items) i)
         ORDER BY id
           FOR NO KEY UPDATE;
        -- The old lines give their layers back before they go (layers point
        -- at their line, which has no foreign key); the new lines take theirs
        -- below, so the units come back to the same layers where they can.
        FOR r IN SELECT id FROM sale_items WHERE sale_id = p_order_id AND product_id IS NOT NULL ORDER BY created_at, id
        LOOP
            v_given := v_given + wp_internal.fifo_give_back_line('retail', p_order_id, r.id);
        END LOOP;
        -- An order settled before the FIFO wiring (COGS in the ledger, no
        -- line with cogs_booked) is taken as booked at the layer value its
        -- lines just gave back, so an edit that ships the same goods books
        -- no difference and the FIFO check does not count it as shipped
        -- and unbooked; a changed quantity books its difference as an ADJ.
        IF NOT COALESCE(v_had_booked, false) AND wp_internal.os_order_cogs_in_ledger(p_order_id) THEN
            v_had_booked := true;
            v_booked := v_given;
        END IF;
    END IF;

    DELETE FROM sale_items WHERE sale_id = p_order_id;
    INSERT INTO sale_items (id, sale_id, product_id, name, price, quantity, image)
    SELECT gen_random_uuid(), p_order_id, NULLIF(i->>'id', ''), i->>'name',
           (i->>'price')::NUMERIC, (i->>'quantity')::NUMERIC, i->>'image'
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(i, n)
     ORDER BY n;
    IF COALESCE(v_had_booked, false) THEN
        PERFORM wp_internal.os_spread_booked(p_order_id, v_booked);
        -- No product line is left: the booked COGS has no goods behind it
        -- (they are back in the pool, or will never ship), so it goes back
        -- to Inventory as a Draft COGS-REV.
        IF NOT EXISTS (SELECT 1 FROM sale_items WHERE sale_id = p_order_id AND product_id IS NOT NULL)
           AND (round(v_booked, 2) = 0
                OR wp_internal.os_post_cogs_move(p_order_id, 'REV', -v_booked,
                                                 COALESCE(NULLIF(v_fields->>'movement_date', '')::date, CURRENT_DATE))) THEN
            UPDATE sale_items SET cogs_booked = NULL WHERE sale_id = p_order_id;
        END IF;
    END IF;

    IF NOT v_holds THEN
        RETURN jsonb_build_object('held', false, 'stock', '{}'::jsonb, 'missing', '[]'::jsonb);
    END IF;

    FOR r IN SELECT id FROM sale_items WHERE sale_id = p_order_id AND product_id IS NOT NULL ORDER BY created_at, id
    LOOP
        PERFORM wp_internal.fifo_take_line('retail', p_order_id, r.id);
    END LOOP;
    -- A settled order: the edit's cost difference is booked.
    PERFORM wp_internal.os_true_up_booked_cogs(p_order_id, COALESCE(NULLIF(v_fields->>'movement_date', '')::date, CURRENT_DATE));

    FOR r IN
        WITH b AS (
            SELECT b->>'product_id' AS pid, sum(COALESCE((b->>'quantity')::NUMERIC, 0)) AS q, max(b->>'name') AS name
              FROM jsonb_array_elements(v_before) b WHERE NULLIF(b->>'product_id', '') IS NOT NULL GROUP BY 1
        ), a AS (
            SELECT i->>'id' AS pid, sum(COALESCE((i->>'quantity')::NUMERIC, 0)) AS q
              FROM jsonb_array_elements(p_items) i WHERE NULLIF(i->>'id', '') IS NOT NULL GROUP BY 1
        ), last_line AS (
            -- The last line for each product names the new record, as the app did.
            SELECT DISTINCT ON (i->>'id') i->>'id' AS pid, i->>'name' AS name, (i->>'price')::NUMERIC AS price
              FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(i, n)
             WHERE NULLIF(i->>'id', '') IS NOT NULL
             ORDER BY i->>'id', n DESC
        )
        SELECT COALESCE(a.pid, b.pid) AS pid, COALESCE(a.q, 0) - COALESCE(b.q, 0) AS d,
               COALESCE(l.name, b.name, COALESCE(a.pid, b.pid)) AS name, l.price, l.name AS line_name,
               EXISTS (SELECT 1 FROM products p WHERE p.id = COALESCE(a.pid, b.pid)) AS present
          FROM a FULL JOIN b ON a.pid = b.pid
          LEFT JOIN last_line l ON l.pid = COALESCE(a.pid, b.pid)
         WHERE COALESCE(a.q, 0) - COALESCE(b.q, 0) <> 0
         ORDER BY 1
    LOOP
        IF NOT r.present THEN
            v_missing := v_missing || r.name;
            CONTINUE;
        END IF;
        -- d > 0: more units left with this order; d < 0: units came back off it.
        UPDATE products SET stock = GREATEST(0, COALESCE(stock, 0) - r.d) WHERE id = r.pid
        RETURNING stock INTO v_new_stock;
        v_stock := v_stock || jsonb_build_object(r.pid, v_new_stock);
        v_applied := v_applied || jsonb_build_array(jsonb_build_object('pid', r.pid, 'd', r.d, 'name', r.line_name, 'price', r.price));
    END LOOP;

    -- The stock-out record. An order shipped before stock-out records existed
    -- has none; its stock is still corrected above.
    SELECT max(created_at) INTO v_newest FROM stock_movements WHERE reference_id = p_order_id AND type = 'out';
    IF v_newest IS NOT NULL THEN
        SELECT * INTO v_template FROM stock_movements
         WHERE reference_id = p_order_id AND type = 'out' AND created_at = v_newest
         ORDER BY id LIMIT 1;
        FOR r IN SELECT (x->>'pid') AS pid, (x->>'d')::NUMERIC AS d, x->>'name' AS name, (x->>'price')::NUMERIC AS price
                   FROM jsonb_array_elements(v_applied) x
        LOOP
            IF EXISTS (SELECT 1 FROM stock_movements WHERE reference_id = p_order_id AND type = 'out'
                        AND created_at = v_newest AND product_id = r.pid) THEN
                IF r.d > 0 THEN
                    UPDATE stock_movements SET quantity = quantity + r.d::INTEGER
                     WHERE id = (SELECT id FROM stock_movements WHERE reference_id = p_order_id AND type = 'out'
                                  AND created_at = v_newest AND product_id = r.pid ORDER BY id LIMIT 1);
                ELSE
                    -- Take the reduction off the rows one by one, removing any that reach 0.
                    v_remaining := -r.d;
                    FOR m IN SELECT id, quantity FROM stock_movements WHERE reference_id = p_order_id AND type = 'out'
                                AND created_at = v_newest AND product_id = r.pid ORDER BY id
                    LOOP
                        EXIT WHEN v_remaining <= 0;
                        v_take := LEAST(COALESCE(m.quantity, 0), v_remaining);
                        v_remaining := v_remaining - v_take;
                        IF COALESCE(m.quantity, 0) - v_take > 0 THEN
                            UPDATE stock_movements SET quantity = (m.quantity - v_take)::INTEGER WHERE id = m.id;
                        ELSE
                            DELETE FROM stock_movements WHERE id = m.id;
                        END IF;
                    END LOOP;
                END IF;
            ELSIF r.d > 0 THEN
                -- Same shipment: same day and same generation stamp, so a later
                -- un-ship removes it together with the rest of this shipment.
                INSERT INTO stock_movements (product_id, product_name, type, quantity, unit_price, reason, reference_id,
                                             source, shipping_co, note, movement_date, created_at, created_by,
                                             customer_name, customer_phone)
                VALUES (r.pid, COALESCE(NULLIF(r.name, ''), 'Unknown'), 'out', r.d::INTEGER, COALESCE(r.price, 0),
                        v_template.reason, p_order_id, v_template.source, v_template.shipping_co, v_template.note,
                        v_template.movement_date, v_template.created_at,
                        COALESCE(NULLIF(v_fields->>'created_by', ''), 'unknown'),
                        v_template.customer_name, v_template.customer_phone);
            END IF;
        END LOOP;
        -- That shipment's records carry each product's FIFO unit cost now.
        UPDATE stock_movements sm SET unit_cost = (
                   SELECT round(sum(si.cogs_cost) / NULLIF(sum(si.quantity), 0), 4)
                     FROM sale_items si WHERE si.sale_id = p_order_id AND si.product_id = sm.product_id)
         WHERE sm.reference_id = p_order_id AND sm.type = 'out' AND sm.created_at = v_newest;
    END IF;

    RETURN jsonb_build_object('held', true, 'stock', v_stock, 'missing', to_jsonb(v_missing));
END;
$$;

GRANT EXECUTE ON FUNCTION wp_internal.os_post_cogs_move(TEXT, TEXT, NUMERIC, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.os_true_up_booked_cogs(TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.os_spread_booked(TEXT, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.os_order_cogs_in_ledger(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION order_status_holds_stock(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION order_status_stock_consumed(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION restock_returned_orders(TEXT[], JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_order_shipping_status(TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION edit_order_items(TEXT, JSONB, JSONB) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
