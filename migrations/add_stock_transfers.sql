-- Warehouses › Move Stock: move products from one warehouse to another.
-- Run once in each instance's Supabase SQL editor (Romdoul1, Romdoul2,
-- Romdoul3). Safe to re-run. Until it is run, the Move Stock button on the
-- Warehouses page answers with a message naming this file.
--
-- A move only changes WHERE stock is, never how much the company has, so:
--   * products.stock is untouched;
--   * the FIFO cost layers are untouched (they are company-wide, not per
--     warehouse), so there is no ledger entry;
--   * nothing is written to stock_movements: every report there reads an
--     'out' as sold and an 'in' as bought, so a move pair would show up as a
--     sale plus a purchase. Moves are kept in their own tables below instead.
--
-- The source may be a warehouse, or NULL for "Unassigned": the part of
-- products.stock that no warehouse_stock row accounts for (the same
-- remainder Inventory Reports › Stock on Hand shows). Moving from Unassigned
-- is how stock that was received without a warehouse gets placed in one.

CREATE TABLE IF NOT EXISTS stock_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
    from_warehouse_id TEXT,              -- NULL = Unassigned
    to_warehouse_id TEXT NOT NULL,
    note TEXT,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_transfer_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    product_name TEXT,
    quantity INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_date ON stock_transfers(transfer_date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_lines_transfer ON stock_transfer_lines(transfer_id);

-- Match the rest of the app, which runs with RLS disabled. The app only
-- reads these tables; every write goes through the function below.
ALTER TABLE stock_transfers DISABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_lines DISABLE ROW LEVEL SECURITY;

-- Moves p_lines ([{product_id, quantity}, ...]) from p_from (a warehouse id,
-- or NULL / '' for Unassigned) to the warehouse p_to, in one transaction:
-- every line moves or none does. Moving more than the source holds is
-- refused, naming each short product. A source warehouse with no
-- warehouse_stock row for a product holds none of it.
--
-- p_session: the SEC-1 session (migrations/add_session_guards.sql). When
-- that file has been run the caller needs manage_inventory; before it, the
-- call is let through like every other pack function.
--
-- Returns {"transfer_id", "lines"}.
CREATE OR REPLACE FUNCTION transfer_warehouse_stock(
    p_from TEXT, p_to TEXT, p_lines JSONB,
    p_date DATE DEFAULT NULL, p_note TEXT DEFAULT NULL, p_by TEXT DEFAULT NULL,
    p_session JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_from TEXT := NULLIF(btrim(COALESCE(p_from, '')), '');
    v_to TEXT := NULLIF(btrim(COALESCE(p_to, '')), '');
    v_short TEXT := '';
    v_dup TEXT;
    v_have NUMERIC;
    v_transfer UUID;
    v_count INT;
    r RECORD;
BEGIN
    IF to_regprocedure('sg_internal.sg_check(jsonb,text[],text)') IS NOT NULL THEN
        PERFORM sg_internal.sg_check(p_session, ARRAY['manage_inventory'], 'move stock between warehouses');
    END IF;

    IF v_to IS NULL THEN
        RAISE EXCEPTION 'Choose the warehouse to move the stock to.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM warehouses WHERE id::TEXT = v_to) THEN
        RAISE EXCEPTION 'The destination warehouse no longer exists.';
    END IF;
    IF v_from IS NOT NULL AND NOT EXISTS (SELECT 1 FROM warehouses WHERE id::TEXT = v_from) THEN
        RAISE EXCEPTION 'The source warehouse no longer exists.';
    END IF;
    IF v_from = v_to THEN
        RAISE EXCEPTION 'The source and destination must be different warehouses.';
    END IF;

    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'Add at least one product to move.';
    END IF;

    -- The lines are read with jsonb_to_recordset(p_lines) AS
    -- l(product_id TEXT, quantity NUMERIC) wherever they are needed, and
    -- checked here before anything is locked.
    IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_lines) AS l(product_id TEXT, quantity NUMERIC)
               WHERE NULLIF(btrim(COALESCE(l.product_id, '')), '') IS NULL) THEN
        RAISE EXCEPTION 'Every line needs a product.';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_lines) AS l(product_id TEXT, quantity NUMERIC)
               WHERE l.quantity IS NULL OR l.quantity <= 0 OR l.quantity <> trunc(l.quantity)) THEN
        RAISE EXCEPTION 'Quantities must be whole numbers above zero.';
    END IF;
    SELECT COALESCE(p.name, l.product_id) INTO v_dup
      FROM jsonb_to_recordset(p_lines) AS l(product_id TEXT, quantity NUMERIC)
      LEFT JOIN products p ON p.id = l.product_id
     GROUP BY l.product_id, p.name
    HAVING count(*) > 1
     LIMIT 1;
    IF v_dup IS NOT NULL THEN
        RAISE EXCEPTION '% is on more than one line. Combine them into one line.', v_dup;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_lines) AS l(product_id TEXT, quantity NUMERIC)
               WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.id = l.product_id)) THEN
        RAISE EXCEPTION 'A product on this move no longer exists. Remove that line.';
    END IF;

    -- Lock the products (fixed order, so two moves can't deadlock; stock
    -- adjustments lock products first too) and their warehouse rows, then
    -- check every line before anything changes.
    FOR r IN
        SELECT l.product_id, l.quantity, p.name, COALESCE(p.stock, 0) AS stock
          FROM jsonb_to_recordset(p_lines) AS l(product_id TEXT, quantity NUMERIC)
          JOIN products p ON p.id = l.product_id
         ORDER BY l.product_id
           FOR UPDATE OF p
    LOOP
        PERFORM 1 FROM warehouse_stock WHERE product_id = r.product_id ORDER BY id FOR UPDATE;
        IF v_from IS NULL THEN
            SELECT r.stock - COALESCE(sum(quantity), 0) INTO v_have
              FROM warehouse_stock WHERE product_id = r.product_id;
        ELSE
            SELECT COALESCE(sum(quantity), 0) INTO v_have
              FROM warehouse_stock WHERE warehouse_id::TEXT = v_from AND product_id = r.product_id;
        END IF;
        IF r.quantity > GREATEST(v_have, 0) THEN
            v_short := v_short || format('%s: moving %s, only %s %s; ', r.name, r.quantity,
                                         GREATEST(v_have, 0),
                                         CASE WHEN v_from IS NULL THEN 'unassigned' ELSE 'in that warehouse' END);
        END IF;
    END LOOP;
    IF v_short <> '' THEN
        RAISE EXCEPTION 'Not enough stock to move. %', rtrim(v_short, '; ');
    END IF;

    INSERT INTO stock_transfers (transfer_date, from_warehouse_id, to_warehouse_id, note, created_by)
    VALUES (COALESCE(p_date, CURRENT_DATE), v_from, v_to, NULLIF(btrim(COALESCE(p_note, '')), ''), NULLIF(p_by, ''))
    RETURNING id INTO v_transfer;

    FOR r IN
        SELECT l.product_id, l.quantity, p.name
          FROM jsonb_to_recordset(p_lines) AS l(product_id TEXT, quantity NUMERIC)
          JOIN products p ON p.id = l.product_id
         ORDER BY l.product_id
    LOOP
        IF v_from IS NOT NULL THEN
            UPDATE warehouse_stock SET quantity = COALESCE(quantity, 0) - r.quantity, updated_at = NOW()
             WHERE warehouse_id::TEXT = v_from AND product_id = r.product_id;
        END IF;

        UPDATE warehouse_stock SET quantity = COALESCE(quantity, 0) + r.quantity, updated_at = NOW()
         WHERE warehouse_id::TEXT = v_to AND product_id = r.product_id;
        IF NOT FOUND THEN
            INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
            -- warehouse_stock.warehouse_id is uuid on the live stores, text
            -- in create_warehouses.sql; the uuid casts to either.
            VALUES (v_to::UUID, r.product_id, r.quantity);
        END IF;

        INSERT INTO stock_transfer_lines (transfer_id, product_id, product_name, quantity)
        VALUES (v_transfer, r.product_id, r.name, r.quantity::INTEGER);
    END LOOP;

    v_count := jsonb_array_length(p_lines);
    RETURN jsonb_build_object('transfer_id', v_transfer, 'lines', v_count);
END;
$$;

GRANT SELECT ON stock_transfers, stock_transfer_lines TO anon, authenticated;
GRANT EXECUTE ON FUNCTION transfer_warehouse_stock(TEXT, TEXT, JSONB, DATE, TEXT, TEXT, JSONB) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
