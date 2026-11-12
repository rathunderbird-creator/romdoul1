-- FIFO costing: the schema, the FIFO primitives and the line helpers the
-- stock paths call. Run once in each instance's Supabase SQL editor
-- (Romdoul1 first; Romdoul2 / Romdoul3 only after their count and
-- true-up). Safe to re-run.
--
-- RUN ORDER (per store, in one quiet window)
--   1. THIS file;
--   2. fifo_rebuild_pool.sql (the one-time pool rebuild; see its RUN block);
--   3. the four packs, which call the helpers below and refuse to load
--      without this file and the rebuild: add_wholesale_procurement_functions.sql,
--      add_order_status_function.sql, add_order_payment_functions.sql,
--      add_stock_adjustment_posting.sql;
--   4. add_session_guards.sql: it moves the re-created pack functions back
--      behind the guards and holds the guarded public read RPCs (fifo_peek,
--      fifo_inventory_valuation, fifo_inventory_check, order_cogs). Until it
--      is run on a store those answer "run add_fifo_costing.sql" there (or
--      do not exist yet).
--   This file creates nothing in public, so re-running it on its own never
--   needs the guards' mover block.
--
-- WHAT THIS DOES
--   inventory_items stays the per-unit layer table (one row per unit, with
--   its cost). It gains the FIFO key (received_at), where the unit came
--   from (receipt_ref) and who holds it (consumer_kind / consumer_id /
--   consumer_line_id / consumed_at). Order lines gain a frozen cost
--   (cogs_cost, cogs_short_qty, sale_items.cogs_booked) and stock movements
--   a unit_cost next to the selling price they already carry.
--
--   The wp_internal primitives below take and give back layers inside the
--   CALLER's transaction. Retail shipping, wholesale orders, stock
--   adjustments, Add Stock / PO receipts and retail settlement call them
--   (through fifo_take_line / fifo_give_back_line for order lines). They are
--   only meaningful once the pool is rebuilt per store
--   (fifo_rebuild_pool.sql) — on a store whose pool is not rebuilt the
--   layers do not match products.stock — which is why the packs refuse to
--   load before the rebuild.
--
-- CONSTRAINTS THE PRIMITIVES RELY ON
--   * The caller locks the products row (FOR NO KEY UPDATE) before
--     fifo_consume / fifo_return, as every stock path already does; the
--     layer rows are then locked FOR NO KEY UPDATE here.
--   * fifo_consume never raises on a short pool: units it cannot find are
--     costed at fifo_fallback_cost and reported as short_qty, which the
--     caller stores in the line's cogs_short_qty. No phantom rows.
--   * consumer_line_id has no foreign key. A caller that deletes or
--     replaces a sale_items / wholesale_order_items row must fifo_return
--     its layers first, or they stay 'sold' to a line that no longer exists.
--   * 'written_off' (adjustment removals, rebuild drops) is permanent:
--     fifo_return only ever gives back 'sold' rows.
--   * The line columns are maintained by the CALLER: it adds fifo_consume's
--     cost / short_qty to cogs_cost / cogs_short_qty and subtracts
--     fifo_return's. cogs_cost is NULL whenever the line holds no units
--     (never consumed, or fully returned), so order_cogs falls back to a
--     peek for it. fifo_take_line / fifo_give_back_line do this for a whole
--     order line, and are what the packs call.
--   * products.stock moves by the full line quantity, so every unit given
--     back must land in the pool: fifo_give_back_line adds a layer for each
--     whole unit that comes back with no row (a shortfall, or a line from
--     before the FIFO wiring that holds fewer rows than its quantity).

-- ---------------------------------------------------------------------------
-- 1) Schema
-- ---------------------------------------------------------------------------

-- The FIFO key. Existing rows take their created_at; the rebuild and the
-- receipt paths set it explicitly. Backfilled only where NULL so a re-run
-- never undoes a rebuild.
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
UPDATE inventory_items SET received_at = COALESCE(created_at, now()) WHERE received_at IS NULL;
ALTER TABLE inventory_items ALTER COLUMN received_at SET DEFAULT now();
ALTER TABLE inventory_items ALTER COLUMN received_at SET NOT NULL;
-- 'PO-<id>', 'RST-<restock id>', 'ADJ-<id>', 'OPEN', 'FIFO-REBUILD', or
-- 'RET-<order id>' (units an order gave back that had no row).
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS receipt_ref TEXT;
-- Who holds a 'sold' / 'written_off' row: retail = sales.id + sale_items.id,
-- wholesale = wholesale_orders.id + wholesale_order_items.id, adjustment =
-- stock_adjustments.id + stock_adjustment_lines.id, reconcile = the rebuild.
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS consumer_kind TEXT
    CHECK (consumer_kind IN ('retail', 'wholesale', 'adjustment', 'reconcile'));
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS consumer_id TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS consumer_line_id TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

-- Status gains 'written_off'. The original inline CHECK has no fixed name
-- across instances, so every status CHECK that lacks the new value is
-- dropped and the named one added.
DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'public.inventory_items'::regclass AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%status%'
           AND pg_get_constraintdef(oid) NOT ILIKE '%written_off%'
    LOOP
        EXECUTE format('ALTER TABLE inventory_items DROP CONSTRAINT %I', c.conname);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.inventory_items'::regclass
                      AND conname = 'inventory_items_status_check') THEN
        ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_status_check
            CHECK (status IN ('in_stock', 'sold', 'returned', 'written_off'));
    END IF;
END $$;

-- The consume path, the return path, and the legacy retail link.
CREATE INDEX IF NOT EXISTS inventory_items_fifo_idx
    ON inventory_items (product_id, received_at, id) WHERE status = 'in_stock';
CREATE INDEX IF NOT EXISTS inventory_items_consumer_idx
    ON inventory_items (consumer_kind, consumer_id, consumer_line_id);
CREATE INDEX IF NOT EXISTS inventory_items_sale_idx
    ON inventory_items (sale_id) WHERE sale_id IS NOT NULL;

-- Frozen per-line cost: the FIFO cost of the units the line holds now (NULL
-- when it holds none), and how many of those units the pool could not
-- supply (costed at fifo_fallback_cost). Settlement and reports read these
-- and never recompute them.
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS cogs_cost NUMERIC;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS cogs_short_qty NUMERIC DEFAULT 0;
-- Total COGS booked to the ledger for this line, adjustments included
-- (NULL = none booked). fifo_inventory_check uses cogs_cost - cogs_booked.
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS cogs_booked NUMERIC;
ALTER TABLE wholesale_order_items ADD COLUMN IF NOT EXISTS cogs_cost NUMERIC;
ALTER TABLE wholesale_order_items ADD COLUMN IF NOT EXISTS cogs_short_qty NUMERIC DEFAULT 0;
-- FIFO unit cost of the movement. unit_price keeps what it carries today
-- (the selling price on retail and wholesale outs).
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS unit_cost NUMERIC;

-- ---------------------------------------------------------------------------
-- 2) Primitives (wp_internal: not exposed by the API)
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS wp_internal;
GRANT USAGE ON SCHEMA wp_internal TO anon, authenticated;

-- The cost a unit the pool cannot supply is charged at: the newest-received
-- layer of the product with a cost above 0 (any status — the last receipt
-- cost), else products.purchase_cost when above 0, else 0.
CREATE OR REPLACE FUNCTION wp_internal.fifo_fallback_cost(p_product_id TEXT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        (SELECT cost_of_purchase FROM inventory_items
          WHERE product_id = p_product_id AND cost_of_purchase > 0
          ORDER BY received_at DESC, id DESC LIMIT 1),
        (SELECT purchase_cost FROM products WHERE id = p_product_id AND purchase_cost > 0),
        0);
$$;

-- Adds p_qty in_stock layers of a product at p_cost (0 or NULL: the
-- fallback cost), received at p_received (NULL: now). Returns the unit cost
-- used. Touches neither products.stock nor movements: the caller does.
-- p_qty of 0 or less adds nothing.
CREATE OR REPLACE FUNCTION wp_internal.fifo_add_layers(
    p_product_id TEXT, p_qty INTEGER, p_cost NUMERIC, p_received TIMESTAMPTZ, p_ref TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
    v_cost NUMERIC := COALESCE(NULLIF(p_cost, 0), wp_internal.fifo_fallback_cost(p_product_id));
BEGIN
    IF COALESCE(p_qty, 0) > 0 THEN
        INSERT INTO inventory_items (product_id, cost_of_purchase, status, received_at, receipt_ref)
        SELECT p_product_id, v_cost, 'in_stock', COALESCE(p_received, now()), p_ref
          FROM generate_series(1, p_qty);
    END IF;
    RETURN v_cost;
END;
$$;

-- Takes the p_qty oldest in_stock layers of a product (received_at, id) for
-- a consumer line: retail / wholesale rows become 'sold', adjustment /
-- reconcile rows 'written_off'; retail also keeps writing sale_id. Returns
-- the total cost of the units, shortfall included, and the shortfall count.
-- Never raises on a short pool (see the header). p_qty of 0 or less takes
-- nothing.
CREATE OR REPLACE FUNCTION wp_internal.fifo_consume(
    p_product_id TEXT, p_qty INTEGER, p_kind TEXT, p_consumer TEXT, p_line TEXT,
    OUT cost NUMERIC, OUT short_qty INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
    v_found INTEGER;
    v_status TEXT;
BEGIN
    cost := 0;
    short_qty := 0;
    IF p_kind IS NULL OR p_kind NOT IN ('retail', 'wholesale', 'adjustment', 'reconcile') THEN
        RAISE EXCEPTION 'fifo_consume: unknown consumer kind %', COALESCE(p_kind, 'NULL');
    END IF;
    IF COALESCE(p_qty, 0) <= 0 THEN
        RETURN;
    END IF;
    v_status := CASE WHEN p_kind IN ('retail', 'wholesale') THEN 'sold' ELSE 'written_off' END;

    WITH picked AS (
        SELECT ii.id FROM inventory_items ii
         WHERE ii.product_id = p_product_id AND ii.status = 'in_stock'
         ORDER BY ii.received_at, ii.id
         LIMIT p_qty
           FOR NO KEY UPDATE
    ), taken AS (
        UPDATE inventory_items i
           SET status = v_status,
               consumer_kind = p_kind,
               consumer_id = p_consumer,
               consumer_line_id = p_line,
               consumed_at = now(),
               sale_id = CASE WHEN p_kind = 'retail' THEN p_consumer ELSE NULL END
          FROM picked
         WHERE i.id = picked.id
        RETURNING i.cost_of_purchase
    )
    SELECT count(*)::int, COALESCE(sum(COALESCE(taken.cost_of_purchase, 0)), 0)
      INTO v_found, cost
      FROM taken;

    short_qty := p_qty - v_found;
    IF short_qty > 0 THEN
        cost := cost + short_qty * wp_internal.fifo_fallback_cost(p_product_id);
    END IF;
END;
$$;

-- Gives back a retail / wholesale line's units: all of them (p_qty NULL), or
-- p_qty of them. The line's shortfall units go back first, at the cost they
-- were charged (the line's cogs_cost minus its layers' cost; the fallback
-- cost when cogs_cost is NULL) — a partial return gives back whole short
-- units only, a full return all of them. Then layers go back newest-received
-- first, so what stays consumed is the oldest; they keep their received_at,
-- so taking them again picks the same rows. Returns the cost released and
-- the short units given back; the caller subtracts both from the line.
-- Other kinds return nothing: written-off rows never come back.
CREATE OR REPLACE FUNCTION wp_internal.fifo_return(
    p_kind TEXT, p_consumer TEXT, p_line TEXT, p_qty INTEGER DEFAULT NULL,
    OUT cost NUMERIC, OUT short_qty NUMERIC)
LANGUAGE plpgsql
AS $$
DECLARE
    v_line_cost NUMERIC;
    v_line_short NUMERIC := 0;
    v_product TEXT;
    v_held NUMERIC;
    v_short_total NUMERIC;
    v_short_cost NUMERIC := 0;
    v_rows INTEGER;
    v_rows_cost NUMERIC;
BEGIN
    cost := 0;
    short_qty := 0;
    IF p_kind IS NULL OR p_kind NOT IN ('retail', 'wholesale') THEN
        RETURN;
    END IF;
    IF p_qty IS NOT NULL AND p_qty <= 0 THEN
        RETURN;
    END IF;

    IF p_kind = 'retail' THEN
        SELECT si.cogs_cost, COALESCE(si.cogs_short_qty, 0), si.product_id
          INTO v_line_cost, v_line_short, v_product
          FROM sale_items si WHERE si.id = p_line;
    ELSIF p_line ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT wi.cogs_cost, COALESCE(wi.cogs_short_qty, 0), wi.product_id
          INTO v_line_cost, v_line_short, v_product
          FROM wholesale_order_items wi WHERE wi.id = p_line::uuid;
    END IF;
    v_line_short := GREATEST(COALESCE(v_line_short, 0), 0);

    IF v_line_short > 0 THEN
        SELECT COALESCE(sum(COALESCE(ii.cost_of_purchase, 0)), 0) INTO v_held
          FROM inventory_items ii
         WHERE ii.status = 'sold' AND ii.consumer_kind = p_kind
           AND ii.consumer_id = p_consumer AND ii.consumer_line_id = p_line;
        v_short_total := CASE WHEN v_line_cost IS NULL
                              THEN v_line_short * wp_internal.fifo_fallback_cost(v_product)
                              ELSE GREATEST(v_line_cost - v_held, 0) END;
        short_qty := CASE WHEN p_qty IS NULL THEN v_line_short
                          ELSE LEAST(p_qty::numeric, floor(v_line_short)) END;
        v_short_cost := CASE WHEN short_qty = v_line_short THEN v_short_total
                             ELSE round(v_short_total * short_qty / v_line_short, 2) END;
    END IF;

    v_rows := CASE WHEN p_qty IS NULL THEN NULL ELSE p_qty - short_qty::int END;
    IF v_rows IS NULL OR v_rows > 0 THEN
        WITH picked AS (
            SELECT ii.id FROM inventory_items ii
             WHERE ii.status = 'sold' AND ii.consumer_kind = p_kind
               AND ii.consumer_id = p_consumer AND ii.consumer_line_id = p_line
             ORDER BY ii.received_at DESC, ii.id DESC
             LIMIT v_rows
               FOR NO KEY UPDATE
        ), back AS (
            UPDATE inventory_items i
               SET status = 'in_stock',
                   consumer_kind = NULL,
                   consumer_id = NULL,
                   consumer_line_id = NULL,
                   consumed_at = NULL,
                   sale_id = NULL
              FROM picked
             WHERE i.id = picked.id
            RETURNING i.cost_of_purchase
        )
        SELECT COALESCE(sum(COALESCE(back.cost_of_purchase, 0)), 0) INTO v_rows_cost FROM back;
    END IF;

    cost := v_short_cost + COALESCE(v_rows_cost, 0);
END;
$$;

-- The cost of the next p_qty in_stock layers of a product, without taking
-- them; units beyond the pool (and any fractional part) at the fallback
-- cost. Settle-before-ship books this estimate.
CREATE OR REPLACE FUNCTION wp_internal.fifo_peek_cost(p_product_id TEXT, p_qty NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_qty NUMERIC := GREATEST(COALESCE(p_qty, 0), 0);
    v_found INTEGER;
    v_sum NUMERIC;
BEGIN
    IF v_qty = 0 THEN
        RETURN 0;
    END IF;
    SELECT count(*)::int, COALESCE(sum(COALESCE(t.cost_of_purchase, 0)), 0) INTO v_found, v_sum
      FROM (SELECT ii.cost_of_purchase FROM inventory_items ii
             WHERE ii.product_id = p_product_id AND ii.status = 'in_stock'
             ORDER BY ii.received_at, ii.id
             LIMIT floor(v_qty)::int) t;
    IF v_qty > v_found THEN
        v_sum := v_sum + (v_qty - v_found) * wp_internal.fifo_fallback_cost(p_product_id);
    END IF;
    RETURN v_sum;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2b) Order-line helpers (what the packs call)
-- ---------------------------------------------------------------------------

-- Takes an order line's whole quantity for it: floor(quantity) units from
-- the oldest layers (fifo_consume), a fractional part as shortfall at the
-- fallback cost, and adds the cost and the shortfall to the line's
-- cogs_cost / cogs_short_qty. p_kind 'retail' (sale_items; p_consumer =
-- sales.id) or 'wholesale' (wholesale_order_items; p_consumer =
-- wholesale_orders.id). Returns the cost added (0 for a line with no
-- product or no quantity). The caller has locked the product and moves
-- products.stock itself.
CREATE OR REPLACE FUNCTION wp_internal.fifo_take_line(p_kind TEXT, p_consumer TEXT, p_line TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
    v_product TEXT;
    v_qty NUMERIC;
    v_whole INTEGER;
    v_cost NUMERIC;
    v_short NUMERIC;
BEGIN
    IF p_kind = 'retail' THEN
        SELECT product_id, COALESCE(quantity, 0) INTO v_product, v_qty FROM sale_items WHERE id = p_line;
    ELSIF p_kind = 'wholesale' THEN
        SELECT product_id, COALESCE(quantity, 0) INTO v_product, v_qty FROM wholesale_order_items WHERE id = p_line::uuid;
    ELSE
        RAISE EXCEPTION 'fifo_take_line: unknown line kind %', COALESCE(p_kind, 'NULL');
    END IF;
    IF v_product IS NULL OR COALESCE(v_qty, 0) <= 0 THEN
        RETURN 0;
    END IF;

    v_whole := floor(v_qty)::int;
    SELECT c.cost, c.short_qty INTO v_cost, v_short
      FROM wp_internal.fifo_consume(v_product, v_whole, p_kind, p_consumer, p_line) c;
    IF v_qty > v_whole THEN
        v_cost := v_cost + (v_qty - v_whole) * wp_internal.fifo_fallback_cost(v_product);
        v_short := v_short + (v_qty - v_whole);
    END IF;

    IF p_kind = 'retail' THEN
        UPDATE sale_items SET cogs_cost = COALESCE(cogs_cost, 0) + v_cost,
                              cogs_short_qty = COALESCE(cogs_short_qty, 0) + v_short
         WHERE id = p_line;
    ELSE
        UPDATE wholesale_order_items SET cogs_cost = COALESCE(cogs_cost, 0) + v_cost,
                                         cogs_short_qty = COALESCE(cogs_short_qty, 0) + v_short
         WHERE id = p_line::uuid;
    END IF;
    RETURN v_cost;
END;
$$;

-- Gives back everything an order line holds. Its layers return to the pool
-- (fifo_return; they keep their received_at), and each whole unit of the
-- line that comes back with no row gets a new layer, because the caller
-- puts products.stock back by the full quantity:
--   * shortfall units, at the cost the line was charged for them (split
--     into cents that add up to it);
--   * on a line from before the FIFO wiring (cogs_cost NULL) that holds
--     fewer rows than its quantity, the missing units at fifo_fallback_cost.
-- Those layers are received just before the product's oldest in_stock
-- layer, so the next stock-out takes them first (an order taken again in
-- the same transaction, as an edit does, gets the same units back). A
-- fractional unit gets no layer. The line ends holding nothing:
-- cogs_cost NULL, cogs_short_qty 0; cogs_booked is the caller's. Returns
-- the value the pool gained.
CREATE OR REPLACE FUNCTION wp_internal.fifo_give_back_line(p_kind TEXT, p_consumer TEXT, p_line TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
    v_product TEXT;
    v_qty NUMERIC;
    v_line_cost NUMERIC;
    v_rows INTEGER;
    v_rows_cost NUMERIC;
    v_cost NUMERIC;
    v_short NUMERIC;
    v_short_cost NUMERIC;
    v_whole_cost NUMERIC;
    v_missing NUMERIC;
    v_n INTEGER;
    v_unit NUMERIC;
    v_at TIMESTAMPTZ;
    v_added NUMERIC := 0;
BEGIN
    IF p_kind = 'retail' THEN
        SELECT product_id, COALESCE(quantity, 0), cogs_cost INTO v_product, v_qty, v_line_cost
          FROM sale_items WHERE id = p_line;
    ELSIF p_kind = 'wholesale' THEN
        SELECT product_id, COALESCE(quantity, 0), cogs_cost INTO v_product, v_qty, v_line_cost
          FROM wholesale_order_items WHERE id = p_line::uuid;
    ELSE
        RAISE EXCEPTION 'fifo_give_back_line: unknown line kind %', COALESCE(p_kind, 'NULL');
    END IF;
    IF v_product IS NULL THEN
        RETURN 0;
    END IF;

    SELECT count(*)::int, COALESCE(sum(COALESCE(cost_of_purchase, 0)), 0) INTO v_rows, v_rows_cost
      FROM inventory_items
     WHERE status = 'sold' AND consumer_kind = p_kind AND consumer_id = p_consumer AND consumer_line_id = p_line;
    SELECT r.cost, r.short_qty INTO v_cost, v_short
      FROM wp_internal.fifo_return(p_kind, p_consumer, p_line, NULL) r;
    v_short := COALESCE(v_short, 0);
    v_short_cost := GREATEST(COALESCE(v_cost, 0) - v_rows_cost, 0);
    v_missing := CASE WHEN v_line_cost IS NULL THEN GREATEST(v_qty - v_rows - v_short, 0) ELSE 0 END;

    IF floor(v_short) + floor(v_missing) >= 1 THEN
        SELECT min(received_at) - interval '1 millisecond' INTO v_at
          FROM inventory_items WHERE product_id = v_product AND status = 'in_stock';
        v_at := LEAST(COALESCE(v_at, now()), now());
    END IF;

    v_n := floor(v_short)::int;
    IF v_n > 0 THEN
        v_whole_cost := round(v_short_cost * v_n / v_short, 2);
        INSERT INTO inventory_items (product_id, cost_of_purchase, status, received_at, receipt_ref)
        SELECT v_product, round(v_whole_cost * g / v_n, 2) - round(v_whole_cost * (g - 1) / v_n, 2),
               'in_stock', v_at, 'RET-' || p_consumer
          FROM generate_series(1, v_n) g;
        v_added := v_added + v_whole_cost;
    END IF;

    v_n := floor(v_missing)::int;
    IF v_n > 0 THEN
        v_unit := wp_internal.fifo_add_layers(v_product, v_n, NULL, v_at, 'RET-' || p_consumer);
        v_added := v_added + v_n * v_unit;
    END IF;

    IF p_kind = 'retail' THEN
        UPDATE sale_items SET cogs_cost = NULL, cogs_short_qty = 0 WHERE id = p_line;
    ELSE
        UPDATE wholesale_order_items SET cogs_cost = NULL, cogs_short_qty = 0 WHERE id = p_line::uuid;
    END IF;
    RETURN v_rows_cost + v_added;
END;
$$;

-- An order's retail COGS at FIFO, per line: the frozen cogs_cost where the
-- line holds units, else a peek of the product's next layers — the order's
-- lines of one product take consecutive layers in line order (created_at,
-- id), so two lines never price the same layers. Each amount is rounded to
-- cents; settlement books these and order_cogs adds them up.
CREATE OR REPLACE FUNCTION wp_internal.order_cogs_lines(p_order_id TEXT)
RETURNS TABLE (line_id TEXT, product_id TEXT, amount NUMERIC)
LANGUAGE sql
STABLE
AS $$
    SELECT si.id, si.product_id, round(si.cogs_cost, 2)
      FROM sale_items si
     WHERE si.sale_id = p_order_id AND si.product_id IS NOT NULL AND si.cogs_cost IS NOT NULL
    UNION ALL
    SELECT x.id, x.product_id,
           round(wp_internal.fifo_peek_cost(x.product_id, x.upto)
                 - wp_internal.fifo_peek_cost(x.product_id, x.upto - x.qty), 2)
      FROM (SELECT si.id, si.product_id, GREATEST(COALESCE(si.quantity, 0), 0) AS qty,
                   sum(GREATEST(COALESCE(si.quantity, 0), 0))
                       OVER (PARTITION BY si.product_id ORDER BY si.created_at, si.id) AS upto
              FROM sale_items si
             WHERE si.sale_id = p_order_id AND si.product_id IS NOT NULL AND si.cogs_cost IS NULL) x;
$$;

-- ---------------------------------------------------------------------------
-- 3) Read implementations (the guarded public RPCs are in
--    add_session_guards.sql)
-- ---------------------------------------------------------------------------

-- What taking p_qty of a product would cost now: {product_id, qty, cost,
-- unit_cost, available, short_qty, fallback_cost}. Amounts rounded to 2
-- places (unit_cost to 4).
CREATE OR REPLACE FUNCTION wp_internal.fifo_peek(p_product_id TEXT, p_qty NUMERIC)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    WITH a AS (
        SELECT GREATEST(COALESCE(p_qty, 0), 0) AS qty,
               wp_internal.fifo_peek_cost(p_product_id, p_qty) AS cost,
               (SELECT count(*) FROM inventory_items
                 WHERE product_id = p_product_id AND status = 'in_stock') AS available
    )
    SELECT jsonb_build_object(
        'product_id', p_product_id,
        'qty', a.qty,
        'cost', round(a.cost, 2),
        'unit_cost', CASE WHEN a.qty > 0 THEN round(a.cost / a.qty, 4) ELSE NULL END,
        'available', a.available,
        'short_qty', GREATEST(a.qty - a.available, 0),
        'fallback_cost', wp_internal.fifo_fallback_cost(p_product_id))
      FROM a;
$$;

-- Per product: the in_stock layers' count and value, their average, the
-- next layer's cost (what the next unit out costs), the last receipt cost
-- and products.stock for comparison. Every product, layers or not.
CREATE OR REPLACE FUNCTION wp_internal.fifo_inventory_valuation()
RETURNS TABLE (product_id TEXT, product_name TEXT, is_active BOOLEAN, stock NUMERIC,
               qty BIGINT, value NUMERIC, avg_cost NUMERIC, next_cost NUMERIC, last_cost NUMERIC)
LANGUAGE sql
STABLE
AS $$
    SELECT p.id, p.name, COALESCE(p.is_active, true), COALESCE(p.stock, 0),
           COALESCE(l.qty, 0), round(COALESCE(l.value, 0), 2),
           CASE WHEN COALESCE(l.qty, 0) > 0 THEN round(l.value / l.qty, 4) END,
           (SELECT ii.cost_of_purchase FROM inventory_items ii
             WHERE ii.product_id = p.id AND ii.status = 'in_stock'
             ORDER BY ii.received_at, ii.id LIMIT 1),
           wp_internal.fifo_fallback_cost(p.id)
      FROM products p
      LEFT JOIN (SELECT ii.product_id, count(*) AS qty, sum(COALESCE(ii.cost_of_purchase, 0)) AS value
                   FROM inventory_items ii WHERE ii.status = 'in_stock'
                  GROUP BY ii.product_id) l ON l.product_id = p.id
     ORDER BY p.name, p.id;
$$;

-- An order's retail COGS at FIFO: the sum of order_cogs_lines (each line's
-- frozen cogs_cost where it has one, else a peek of the product's next
-- layers), which is exactly what settling it now books.
CREATE OR REPLACE FUNCTION wp_internal.order_cogs(p_order_id TEXT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
    SELECT round(COALESCE(sum(amount), 0), 2) FROM wp_internal.order_cogs_lines(p_order_id);
$$;

-- The store's FIFO health check, as JSONB:
--   pool_units / pool_value      in_stock layers
--   ledger_1300 (+ _posted)      1300 balance, Dr - Cr, every entry status
--                                (Posted + Draft, as the true-up measured it)
--   retail_out_unbooked          Σ cogs_cost of lines holding units with no
--                                COGS booked (shipped, not settled)
--   retail_booked_not_out        Σ cogs_booked of lines holding no units
--                                (settled before ship)
--   retail_booked_out_diff       Σ (cogs_cost - cogs_booked) of lines with
--                                both (0 once the COGS-ADJ is booked)
--   expected_1300                pool_value + out_unbooked - booked_not_out
--                                + booked_out_diff
--   variance                     ledger_1300 - expected_1300
--   product_mismatches / products  products whose in_stock layer count is
--                                not products.stock
--   short_lines / short_qty      retail and wholesale lines holding a
--                                shortfall
-- Wholesale COGS posts from the same frozen cost at stock-out, and stock
-- adjustments at the cost they take, so neither adds a term. Lines from
-- before the FIFO wiring (cogs_cost and cogs_booked both NULL) add nothing.
CREATE OR REPLACE FUNCTION wp_internal.fifo_inventory_check()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_inv UUID := wp_internal.wp_account('1300', 'Asset', 'inventor|stock');
    v_pool_units BIGINT;
    v_pool_value NUMERIC;
    v_ledger NUMERIC := 0;
    v_ledger_posted NUMERIC := 0;
    v_out_unbooked NUMERIC;
    v_booked_not_out NUMERIC;
    v_booked_diff NUMERIC;
    v_expected NUMERIC;
    v_products JSONB;
    v_mismatches INTEGER;
    v_short JSONB;
BEGIN
    SELECT count(*), COALESCE(sum(COALESCE(cost_of_purchase, 0)), 0)
      INTO v_pool_units, v_pool_value
      FROM inventory_items WHERE status = 'in_stock';

    IF v_inv IS NOT NULL THEN
        SELECT COALESCE(sum(COALESCE(l.debit, 0) - COALESCE(l.credit, 0)), 0),
               COALESCE(sum(COALESCE(l.debit, 0) - COALESCE(l.credit, 0))
                        FILTER (WHERE COALESCE(e.status, 'Posted') = 'Posted'), 0)
          INTO v_ledger, v_ledger_posted
          FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
         WHERE l.account_id = v_inv;
    END IF;

    SELECT COALESCE(sum(cogs_cost) FILTER (WHERE cogs_cost IS NOT NULL AND cogs_booked IS NULL), 0),
           COALESCE(sum(cogs_booked) FILTER (WHERE cogs_booked IS NOT NULL AND cogs_cost IS NULL), 0),
           COALESCE(sum(cogs_cost - cogs_booked) FILTER (WHERE cogs_cost IS NOT NULL AND cogs_booked IS NOT NULL), 0)
      INTO v_out_unbooked, v_booked_not_out, v_booked_diff
      FROM sale_items;
    v_expected := v_pool_value + v_out_unbooked - v_booked_not_out + v_booked_diff;

    SELECT count(*)::int,
           COALESCE(jsonb_agg(jsonb_build_object('product_id', m.id, 'name', m.name,
                                                 'stock', m.stock, 'pool_qty', m.pool_qty)
                              ORDER BY m.name, m.id), '[]'::jsonb)
      INTO v_mismatches, v_products
      FROM (SELECT p.id, p.name, COALESCE(p.stock, 0) AS stock, COALESCE(c.n, 0) AS pool_qty
              FROM products p
              LEFT JOIN (SELECT product_id, count(*) AS n FROM inventory_items
                          WHERE status = 'in_stock' GROUP BY product_id) c ON c.product_id = p.id
             WHERE COALESCE(c.n, 0) <> COALESCE(p.stock, 0)) m;

    SELECT jsonb_build_object(
        'retail_lines', (SELECT count(*) FROM sale_items WHERE COALESCE(cogs_short_qty, 0) > 0),
        'retail_qty', (SELECT COALESCE(sum(cogs_short_qty), 0) FROM sale_items WHERE COALESCE(cogs_short_qty, 0) > 0),
        'wholesale_lines', (SELECT count(*) FROM wholesale_order_items WHERE COALESCE(cogs_short_qty, 0) > 0),
        'wholesale_qty', (SELECT COALESCE(sum(cogs_short_qty), 0) FROM wholesale_order_items WHERE COALESCE(cogs_short_qty, 0) > 0))
      INTO v_short;

    RETURN jsonb_build_object(
        'pool_units', v_pool_units,
        'pool_value', round(v_pool_value, 2),
        'ledger_1300', round(v_ledger, 2),
        'ledger_1300_posted', round(v_ledger_posted, 2),
        'inventory_account_found', v_inv IS NOT NULL,
        'retail_out_unbooked', round(v_out_unbooked, 2),
        'retail_booked_not_out', round(v_booked_not_out, 2),
        'retail_booked_out_diff', round(v_booked_diff, 2),
        'expected_1300', round(v_expected, 2),
        'variance', round(v_ledger - v_expected, 2),
        'product_mismatches', v_mismatches,
        'products', v_products,
        'shortfall', v_short);
END;
$$;

-- The pack functions and the guarded wrappers are SECURITY INVOKER and run
-- as the API role, so it needs EXECUTE here (the schema itself is never
-- exposed by the API).
GRANT EXECUTE ON FUNCTION wp_internal.fifo_fallback_cost(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.fifo_add_layers(TEXT, INTEGER, NUMERIC, TIMESTAMPTZ, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.fifo_consume(TEXT, INTEGER, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.fifo_return(TEXT, TEXT, TEXT, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.fifo_peek_cost(TEXT, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.fifo_peek(TEXT, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.fifo_inventory_valuation() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.fifo_take_line(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.fifo_give_back_line(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.order_cogs_lines(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.order_cogs(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION wp_internal.fifo_inventory_check() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
