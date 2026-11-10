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

    -- Shipping marked these orders' FIFO items sold; return them to the pool.
    UPDATE inventory_items SET status = 'in_stock', sale_id = NULL
     WHERE sale_id = ANY(v_ids) AND status = 'sold';

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

        INSERT INTO stock_movements (product_id, product_name, type, quantity, unit_price, source, shipping_co,
                                     note, movement_date, created_by, customer_name, customer_phone)
        VALUES (r.product_id, COALESCE(NULLIF(r.product_name, ''), r.product_id), 'in', r.qty::INTEGER, 0,
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
--     (never below 0), the oldest in-stock inventory items are marked sold to
--     this order, and a new 'Order Shipped' stock-out generation is logged;
--   * goods come back (from Shipped/Delivered, or Returned to a pre-ship
--     status; not into Returned or ReStock): stock is put back, the order's
--     inventory items return to stock, and the newest stock-out generation
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
            SELECT product_id, COALESCE(quantity, 0) AS quantity
              FROM sale_items WHERE sale_id = p_order_id AND product_id IS NOT NULL
             ORDER BY created_at, id
        LOOP
            UPDATE products SET stock = GREATEST(0, COALESCE(stock, 0) - r.quantity) WHERE id = r.product_id;
            UPDATE inventory_items SET status = 'sold', sale_id = p_order_id
             WHERE id IN (SELECT id FROM inventory_items
                           WHERE product_id = r.product_id AND status = 'in_stock'
                           ORDER BY created_at, id
                           LIMIT GREATEST(0, floor(r.quantity))::INTEGER);
        END LOOP;
    ELSIF (order_status_stock_consumed(v_old) OR (v_old = 'Returned' AND v_new <> 'ReStock'))
          AND NOT order_status_stock_consumed(v_new) AND v_new <> 'Returned' THEN
        -- The shipment is reversed: the goods are back on hand.
        FOR r IN
            SELECT product_id, COALESCE(quantity, 0) AS quantity
              FROM sale_items WHERE sale_id = p_order_id AND product_id IS NOT NULL
             ORDER BY created_at, id
        LOOP
            UPDATE products SET stock = COALESCE(stock, 0) + r.quantity WHERE id = r.product_id;
            UPDATE inventory_items SET status = 'in_stock', sale_id = NULL
             WHERE sale_id = p_order_id AND product_id = r.product_id;
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
            INSERT INTO stock_movements (product_id, product_name, type, quantity, unit_price, reason, reference_id, source,
                                         shipping_co, note, movement_date, created_by, customer_name, customer_phone)
            SELECT si.product_id, COALESCE(NULLIF(si.name, ''), 'Unknown'), 'out', si.quantity::INTEGER, COALESCE(si.price, 0),
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
-- product (never below 0), inventory items follow, and the newest stock-out
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

    DELETE FROM sale_items WHERE sale_id = p_order_id;
    INSERT INTO sale_items (id, sale_id, product_id, name, price, quantity, image)
    SELECT gen_random_uuid(), p_order_id, NULLIF(i->>'id', ''), i->>'name',
           (i->>'price')::NUMERIC, (i->>'quantity')::NUMERIC, i->>'image'
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(i, n)
     ORDER BY n;

    IF NOT order_status_holds_stock(v_status) THEN
        RETURN jsonb_build_object('held', false, 'stock', '{}'::jsonb, 'missing', '[]'::jsonb);
    END IF;

    PERFORM 1 FROM products
     WHERE id IN (SELECT NULLIF(b->>'product_id', '') FROM jsonb_array_elements(v_before) b
                  UNION SELECT NULLIF(i->>'id', '') FROM jsonb_array_elements(p_items) i)
     ORDER BY id
       FOR NO KEY UPDATE;

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
        IF r.d > 0 THEN
            UPDATE inventory_items SET status = 'sold', sale_id = p_order_id
             WHERE id IN (SELECT id FROM inventory_items WHERE product_id = r.pid AND status = 'in_stock'
                           ORDER BY created_at, id LIMIT floor(r.d)::INTEGER);
        ELSE
            UPDATE inventory_items SET status = 'in_stock', sale_id = NULL
             WHERE id IN (SELECT id FROM inventory_items WHERE sale_id = p_order_id AND product_id = r.pid
                           ORDER BY created_at, id LIMIT floor(-r.d)::INTEGER);
        END IF;
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
    END IF;

    RETURN jsonb_build_object('held', true, 'stock', v_stock, 'missing', to_jsonb(v_missing));
END;
$$;

GRANT EXECUTE ON FUNCTION order_status_holds_stock(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION order_status_stock_consumed(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION restock_returned_orders(TEXT[], JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_order_shipping_status(TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION edit_order_items(TEXT, JSONB, JSONB) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
