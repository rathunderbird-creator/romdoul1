-- Stock Adjustments: post and edit inside the database, in one transaction.
-- Run once in each instance's Supabase SQL editor (Romdoul1, Romdoul2,
-- Romdoul3), after create_stock_adjustments.sql. Safe to re-run.
--
-- Posting used to be a string of separate writes from the browser, so two
-- tabs could both post one draft, a failed write could leave stock half
-- moved, and an edit could slip in between. Each function here locks the
-- adjustment row first and does all of its work in one transaction: it
-- either happens completely or not at all, and a second caller waits and
-- then sees the result of the first.
--
-- Until this is run, the Adjust Stock page saves drafts as before but
-- refuses to post them, and says to run this file.

-- Returns the first problem with an adjustment's lines, or NULL when fine.
-- Quantities must be whole numbers other than zero (stock_movements.quantity
-- is an INTEGER), unit cost can't be negative (it would flip the ledger
-- entry), and each product may appear on one line only.
CREATE OR REPLACE FUNCTION stock_adjustment_line_problem(p_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_dup TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM stock_adjustment_lines WHERE adjustment_id = p_id) THEN
        RETURN 'This adjustment has no lines.';
    END IF;
    IF EXISTS (SELECT 1 FROM stock_adjustment_lines WHERE adjustment_id = p_id AND product_id IS NULL) THEN
        RETURN 'A product on this adjustment no longer exists. Edit the draft and remove that line.';
    END IF;
    IF EXISTS (SELECT 1 FROM stock_adjustment_lines WHERE adjustment_id = p_id
               AND (quantity IS NULL OR quantity = 0 OR quantity <> trunc(quantity))) THEN
        RETURN 'Quantities must be whole numbers other than zero.';
    END IF;
    IF EXISTS (SELECT 1 FROM stock_adjustment_lines WHERE adjustment_id = p_id AND COALESCE(unit_cost, 0) < 0) THEN
        RETURN 'Unit cost can''t be negative.';
    END IF;
    SELECT COALESCE(p.name, l.product_id) INTO v_dup
      FROM stock_adjustment_lines l LEFT JOIN products p ON p.id = l.product_id
     WHERE l.adjustment_id = p_id
     GROUP BY l.product_id, p.name
    HAVING count(*) > 1
     LIMIT 1;
    IF v_dup IS NOT NULL THEN
        RETURN v_dup || ' is on more than one line. Combine them into one line.';
    END IF;
    RETURN NULL;
END;
$$;

-- Replaces a Draft's header and lines. Refused once the adjustment is no
-- longer a Draft; a bad line rolls the whole save back, so the draft keeps
-- its old lines.
CREATE OR REPLACE FUNCTION save_stock_adjustment(p_id UUID, p_header JSONB, p_lines JSONB)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_status TEXT;
    v_problem TEXT;
BEGIN
    SELECT status INTO v_status FROM stock_adjustments WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This adjustment no longer exists.';
    END IF;
    IF v_status <> 'Draft' THEN
        RAISE EXCEPTION 'This adjustment has been posted, so your changes were not saved.';
    END IF;

    UPDATE stock_adjustments SET
        warehouse_id = p_header->>'warehouse_id',
        adjustment_date = (p_header->>'adjustment_date')::DATE,
        reason = p_header->>'reason',
        notes = NULLIF(p_header->>'notes', '')
     WHERE id = p_id;

    DELETE FROM stock_adjustment_lines WHERE adjustment_id = p_id;
    INSERT INTO stock_adjustment_lines (adjustment_id, product_id, bin, quantity, unit_cost, batch)
    SELECT p_id,
           l->>'product_id',
           COALESCE(NULLIF(l->>'bin', ''), 'Default'),
           (l->>'quantity')::NUMERIC,
           COALESCE((l->>'unit_cost')::NUMERIC, 0),
           NULLIF(l->>'batch', '')
      FROM jsonb_array_elements(p_lines) AS l;

    v_problem := stock_adjustment_line_problem(p_id);
    IF v_problem IS NOT NULL THEN
        RAISE EXCEPTION '%', v_problem;
    END IF;
END;
$$;

-- Posts a Draft: moves each line's quantity into products.stock and, when
-- the warehouse tracks the product, warehouse_stock (a missing row means
-- "not tracked here", the same rule wholesale uses: a removal leaves it
-- alone, an addition starts tracking it); writes one stock_movements row per
-- line; books the ledger entry (Draft, like every auto-posted entry); and
-- marks the adjustment Posted. Removing more than is on hand is refused.
--
-- Ledger: Dr Inventory (1300) / Cr Owner Capital (3000) for corrective
-- reasons (Opening balance, Stock correction, Other), Dr Cost of Goods Sold
-- (5000) / Cr Inventory for losses; a net in the other direction swaps the
-- pair. With no such accounts, the stock still posts and the result says so.
--
-- Returns {"ledger": "booked" | "zero" | "no_accounts"}.
CREATE OR REPLACE FUNCTION post_stock_adjustment(p_id UUID, p_created_by TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    adj stock_adjustments%ROWTYPE;
    v_problem TEXT;
    v_short TEXT := '';
    r RECORD;
    v_ws_qty NUMERIC;
    v_net NUMERIC;
    v_amount NUMERIC;
    v_corrective BOOLEAN;
    v_inventory UUID;
    v_balancing UUID;
    v_ymd TEXT;
    v_global INT;
    v_daily INT;
    v_number TEXT;
    v_entry UUID;
    v_debit_inv NUMERIC;
    v_credit_inv NUMERIC;
BEGIN
    SELECT * INTO adj FROM stock_adjustments WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This adjustment no longer exists.';
    END IF;
    IF adj.status <> 'Draft' THEN
        RAISE EXCEPTION 'This adjustment has already been posted.';
    END IF;

    v_problem := stock_adjustment_line_problem(p_id);
    IF v_problem IS NOT NULL THEN
        RAISE EXCEPTION '%', v_problem;
    END IF;

    -- Lock the products (in a fixed order, so two posts can't deadlock) and
    -- check every removal before anything changes.
    FOR r IN
        SELECT l.product_id, l.quantity, p.name, p.stock
          FROM stock_adjustment_lines l
          JOIN products p ON p.id = l.product_id
         WHERE l.adjustment_id = p_id
         ORDER BY l.product_id
           FOR UPDATE OF p
    LOOP
        IF r.quantity < 0 THEN
            IF COALESCE(r.stock, 0) < -r.quantity THEN
                v_short := v_short || format('%s: removing %s, only %s in stock; ', r.name, -r.quantity, COALESCE(r.stock, 0));
            ELSIF adj.warehouse_id IS NOT NULL AND adj.warehouse_id <> '' THEN
                SELECT quantity INTO v_ws_qty FROM warehouse_stock
                 WHERE warehouse_id = adj.warehouse_id AND product_id = r.product_id FOR UPDATE;
                IF FOUND AND COALESCE(v_ws_qty, 0) < -r.quantity THEN
                    v_short := v_short || format('%s: removing %s, only %s in this warehouse; ', r.name, -r.quantity, COALESCE(v_ws_qty, 0));
                END IF;
            END IF;
        END IF;
    END LOOP;
    IF (SELECT count(*) FROM stock_adjustment_lines l JOIN products p ON p.id = l.product_id WHERE l.adjustment_id = p_id)
       <> (SELECT count(*) FROM stock_adjustment_lines WHERE adjustment_id = p_id) THEN
        RAISE EXCEPTION 'A product on this adjustment no longer exists. Edit the draft and remove that line.';
    END IF;
    IF v_short <> '' THEN
        RAISE EXCEPTION 'Not enough stock to remove. %', rtrim(v_short, '; ');
    END IF;

    FOR r IN
        SELECT l.product_id, l.quantity, COALESCE(l.unit_cost, 0) AS unit_cost, p.name
          FROM stock_adjustment_lines l
          JOIN products p ON p.id = l.product_id
         WHERE l.adjustment_id = p_id
         ORDER BY l.product_id
    LOOP
        UPDATE products SET stock = COALESCE(stock, 0) + r.quantity WHERE id = r.product_id;

        IF adj.warehouse_id IS NOT NULL AND adj.warehouse_id <> '' THEN
            UPDATE warehouse_stock SET quantity = COALESCE(quantity, 0) + r.quantity
             WHERE warehouse_id = adj.warehouse_id AND product_id = r.product_id;
            IF NOT FOUND AND r.quantity > 0 THEN
                INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
                VALUES (adj.warehouse_id, r.product_id, r.quantity);
            END IF;
        END IF;

        INSERT INTO stock_movements (product_id, product_name, type, quantity, unit_price, source, reason,
                                     reference_id, note, movement_date, created_by, warehouse_id)
        VALUES (r.product_id, COALESCE(r.name, ''), CASE WHEN r.quantity > 0 THEN 'in' ELSE 'out' END,
                abs(r.quantity)::INTEGER, r.unit_cost, 'Stock Adjustment', adj.reason,
                'ADJ-' || p_id, COALESCE(adj.notes, ''), adj.adjustment_date, p_created_by,
                NULLIF(adj.warehouse_id, ''));
    END LOOP;

    UPDATE stock_adjustments SET status = 'Posted' WHERE id = p_id;

    -- Ledger entry for the net value moved.
    SELECT COALESCE(sum(quantity * COALESCE(unit_cost, 0)), 0) INTO v_net
      FROM stock_adjustment_lines WHERE adjustment_id = p_id;
    v_amount := round(abs(v_net), 2);
    IF v_amount = 0 THEN
        RETURN jsonb_build_object('ledger', 'zero');
    END IF;
    IF EXISTS (SELECT 1 FROM journal_entries WHERE reference_id = 'ADJ-' || p_id) THEN
        RETURN jsonb_build_object('ledger', 'booked');
    END IF;

    v_corrective := adj.reason IN ('Opening balance', 'Stock correction', 'Other');
    SELECT id INTO v_inventory FROM chart_of_accounts
     WHERE is_active AND (account_code = '1300' OR (account_type = 'Asset' AND account_name ~* '(inventor|stock)'))
     ORDER BY (account_code = '1300') DESC LIMIT 1;
    IF v_corrective THEN
        SELECT id INTO v_balancing FROM chart_of_accounts
         WHERE is_active AND (account_code = '3000' OR account_type = 'Equity')
         ORDER BY (account_code = '3000') DESC LIMIT 1;
    ELSE
        SELECT id INTO v_balancing FROM chart_of_accounts
         WHERE is_active AND (account_code = '5000' OR account_type = 'Expense')
         ORDER BY (account_code = '5000') DESC, (account_name ~* '(cost of goods|cogs)') DESC LIMIT 1;
    END IF;
    IF v_inventory IS NULL OR v_balancing IS NULL THEN
        RETURN jsonb_build_object('ledger', 'no_accounts');
    END IF;

    -- Same numbering the app uses: JE-<count+1>-ADJ-<yyyymmdd>-<nnn>.
    v_ymd := to_char(adj.adjustment_date, 'YYYYMMDD');
    SELECT count(*) + 1 INTO v_global FROM journal_entries;
    SELECT count(*) + 1 INTO v_daily FROM journal_entries WHERE entry_number LIKE 'JE-%-ADJ-' || v_ymd || '-%';
    v_number := 'JE-' || v_global || '-ADJ-' || v_ymd || '-' || lpad(v_daily::TEXT, 3, '0');

    INSERT INTO journal_entries (date, description, reference_id, status, entry_number)
    VALUES (adj.adjustment_date,
            'Inventory - ' || regexp_replace(v_number, '^JE-\d+-', '') || ' — ' || adj.reason,
            'ADJ-' || p_id, 'Draft', v_number)
    RETURNING id INTO v_entry;

    v_debit_inv := CASE WHEN v_net > 0 THEN v_amount ELSE 0 END;
    v_credit_inv := CASE WHEN v_net > 0 THEN 0 ELSE v_amount END;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_entry, v_inventory, v_debit_inv, v_credit_inv, 'Inventory adjustment — ' || adj.reason),
        (v_entry, v_balancing, v_credit_inv, v_debit_inv,
         CASE WHEN v_corrective THEN 'Stock adjustment — ' ELSE 'Inventory write-off — ' END || adj.reason);

    RETURN jsonb_build_object('ledger', 'booked');
END;
$$;

GRANT EXECUTE ON FUNCTION stock_adjustment_line_problem(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION save_stock_adjustment(UUID, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION post_stock_adjustment(UUID, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
