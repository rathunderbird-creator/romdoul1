-- FIFO costing, phase 2: the ONE-TIME rebuild of a store's inventory_items
-- pool from its counted stock, plus the Draft FIFO revaluation entry. Run it
-- once in the Supabase SQL editor of ONE store (Romdoul1 first; Romdoul2 /
-- Romdoul3 only after their count and true-up). The whole file is one
-- transaction: any failed check raises and nothing is kept.
--
-- RUN ORDER (per store)
--   1. add_fifo_costing.sql, then add_session_guards.sql again (phase 1);
--   2. src/scripts/fifo-rebuild-dryrun.cjs --store=<store> with the SAME
--      options as the call at the bottom of this file. Its summary is what
--      this file will do (same S, U, V, B and D1) — read it first;
--   3. THIS file, in a quiet window: the current client's manual stock edits,
--      wholesale orders and adjustments do not keep the pool in step yet;
--   4. the phase 3 SQL straight after, on the same store.
--
-- WHAT IT DOES (design section 4). Per product P:
--   S = products.stock (whole units; a fractional or negative stock is
--       floored at 0 and listed under "anomalies").
--   U = whole units on retail lines of orders that hold stock (Shipped /
--       Delivered / Returned, narrowed by p_u_statuses and p_u_from), are not
--       settled (payment_status Paid / Settled / Paid/Settled) and have no
--       COGS entry (an entry with a 5000 line whose reference is
--       ORD-<order>-COGS, or TX-<tx> of a transaction linked to the order).
--   The rows of P, any status, newest first (received_at DESC, id DESC):
--   1. rows in the first S+U places whose cost is 0 / NULL are re-costed to
--      wp_internal.fifo_fallback_cost(P) as it stands before the rebuild;
--   2. the newest S rows become in_stock, every link cleared;
--   3. the next U rows go to the U lines: the oldest-shipped line (its newest
--      'out' movement, else the order date) takes the oldest of them. They
--      become 'sold' to that line (consumer_kind 'retail'), and the line's
--      sale_items.cogs_cost is set to their cost plus any fractional part of
--      its quantity at the fallback cost (that part is its cogs_short_qty);
--   4. older rows stay 'sold' when their order holds stock and is settled or
--      has a COGS entry (history). They are stamped retail / order / line
--      (lines of that order and product in id order, up to floor(qty) each)
--      so a later return can give them back; rows beyond the lines' quantity
--      stay unstamped. Every other older row is written_off, consumer_kind
--      'reconcile', consumer_id 'FIFO-REBUILD-<yyyymmdd>', sale_id cleared;
--   5. when the rows run out before S+U, filler rows (receipt_ref
--      'FIFO-REBUILD') take the oldest places, received just before P's
--      oldest row, at the last receipt cost (newest restock with cost > 0,
--      else newest line of a Received PO with unit_price > 0), else the
--      fallback cost;
--   6. lines of wholesale orders that are not Cancelled get cogs_cost = their
--      WSO-<order>-COGS amount (5000 debit - credit, every status, 0 when
--      none) allocated by purchase_cost x quantity (by quantity when that is
--      all 0), and cogs_short_qty = quantity: they hold no rows, so a later
--      cancel gives back exactly the cost that was booked.
--   Rows are never deleted. inventory_items is copied first to
--   inventory_items_bak_<yyyymmdd>.
--
-- LEDGER AND THE GUARD
--   V  = in_stock layer value + the U lines' cogs_cost.
--   B  = 1300 balance over every entry (Posted + Draft).
--   D1 = over the same S+U units, layer cost - basis cost; the basis cost is
--        products.purchase_cost unless p_basis gives the cost the ledger
--        carries (for example the true-up's cost).
--   When |D1 - (V - B)| > 1 the run RAISES with the numbers: the ledger does
--   not match the counted stock at the basis cost, and booking D1 would be
--   wrong. When it passes and D1 is not 0, ONE Draft entry is booked:
--   reference 'FIFO-REVAL-<yyyymmdd>', numbered JE-<n>-MAN-<yyyymmdd>-<nnn>,
--   Dr 1300 / Cr 5000 for a positive D1 (Dr 5000 / Cr 1300 for a negative
--   one). The owner Posts it.
--
-- IT REFUSES TO RUN (nothing changed) WHEN
--   * phase 1 (add_fifo_costing.sql) is missing;
--   * inventory_items_bak_<today> exists, or any FIFO-REVAL-* entry exists;
--   * the pool already carries FIFO state (a FIFO-REBUILD filler, a
--     written_off row or any consumer_kind) or a line already has a cogs_cost
--     or cogs_short_qty — the rebuild has run, or phase 3 is already live;
--   * the store has not exactly one 1300 and one 5000 account;
--   * a p_basis entry does not match exactly one product (by id or name).
--
-- AFTER THE WRITES IT CHECKS (and raises on failure): per product the
-- in_stock count is S; every U line holds exactly floor(qty) rows and its
-- cogs_cost is the planned one; no in_stock row keeps a link; every 'sold'
-- row is a U row or history; rows = before + fillers; the table's V is the
-- planned V.
--
-- UNDO (only before phase 3 runs), as one transaction:
--   UPDATE inventory_items i SET cost_of_purchase = b.cost_of_purchase, status = b.status,
--          sale_id = b.sale_id, received_at = b.received_at, receipt_ref = b.receipt_ref,
--          consumer_kind = b.consumer_kind, consumer_id = b.consumer_id,
--          consumer_line_id = b.consumer_line_id, consumed_at = b.consumed_at
--     FROM inventory_items_bak_<yyyymmdd> b WHERE b.id = i.id;
--   DELETE FROM inventory_items WHERE receipt_ref = 'FIFO-REBUILD';
--   UPDATE sale_items SET cogs_cost = NULL, cogs_short_qty = 0 WHERE cogs_cost IS NOT NULL;
--   UPDATE wholesale_order_items SET cogs_cost = NULL, cogs_short_qty = 0 WHERE cogs_cost IS NOT NULL;
--   DELETE FROM journal_entries WHERE reference_id = 'FIFO-REVAL-<yyyymmdd>' AND status = 'Draft';
--   (and DROP the backup table to allow another run).
--
-- The function lives in pg_temp: it exists only for this session and leaves
-- nothing behind.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.fifo_rebuild_pool(
    p_basis JSONB DEFAULT '{}'::JSONB,
    p_u_statuses TEXT[] DEFAULT NULL,
    p_u_from DATE DEFAULT NULL,
    p_run_date DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
AS $fn$
DECLARE
    c_holds CONSTANT TEXT[] := ARRAY['Shipped', 'Delivered', 'Returned'];
    c_settled CONSTANT TEXT[] := ARRAY['Paid', 'Settled', 'Paid/Settled'];
    v_u_statuses TEXT[] := COALESCE(p_u_statuses, ARRAY['Shipped', 'Delivered', 'Returned']);
    v_date DATE := COALESCE(p_run_date, (now() AT TIME ZONE 'Asia/Phnom_Penh')::DATE);
    v_ymd TEXT;
    v_bak TEXT;
    v_tag TEXT;
    v_ref TEXT;
    -- Store-local (UTC+7) midnight of p_u_from, as the dry run takes it.
    v_u_from TIMESTAMPTZ := CASE WHEN p_u_from IS NULL THEN NULL
                                 ELSE (to_char(p_u_from, 'YYYY-MM-DD') || 'T00:00:00+07:00')::TIMESTAMPTZ END;
    v_inv UUID;
    v_cogs UUID;
    v_n BIGINT;
    v_txt TEXT;
    v_spec RECORD;
    v_rows_before BIGINT;
    v_B NUMERIC;
    v_V NUMERIC;
    v_V_stock NUMERIC;
    v_V_u NUMERIC;
    v_V_raw NUMERIC;
    v_basis_total NUMERIC;
    v_D1 NUMERIC;
    v_VmB NUMERIC;
    v_guard NUMERIC;
    v_number TEXT;
    v_entry UUID;
    v_amount NUMERIC;
    v_totals JSONB;
    v_wholesale JSONB;
    v_anomalies JSONB;
BEGIN
    v_ymd := to_char(v_date, 'YYYYMMDD');
    v_bak := 'inventory_items_bak_' || v_ymd;
    v_tag := 'FIFO-REBUILD-' || v_ymd;
    v_ref := 'FIFO-REVAL-' || v_ymd;

    -- -----------------------------------------------------------------------
    -- Refusals
    -- -----------------------------------------------------------------------
    IF to_regprocedure('wp_internal.fifo_fallback_cost(text)') IS NULL
       OR to_regprocedure('wp_internal.wp_next_entry_number(text,date)') IS NULL
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'inventory_items' AND column_name = 'consumer_kind')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'wholesale_order_items' AND column_name = 'cogs_short_qty') THEN
        RAISE EXCEPTION 'FIFO rebuild: run migrations/add_fifo_costing.sql on this store first.';
    END IF;
    IF to_regclass('public.' || v_bak) IS NOT NULL THEN
        RAISE EXCEPTION 'FIFO rebuild: % already exists — the rebuild has run today. Nothing was changed.', v_bak;
    END IF;
    SELECT string_agg(reference_id, ', ') INTO v_txt FROM journal_entries WHERE reference_id LIKE 'FIFO-REVAL-%';
    IF v_txt IS NOT NULL THEN
        RAISE EXCEPTION 'FIFO rebuild: the revaluation entry % already exists — the rebuild has run. Nothing was changed.', v_txt;
    END IF;

    -- Nothing may move stock, the pool or the ledger while the plan is made
    -- and written.
    LOCK TABLE products, inventory_items, sales, sale_items, wholesale_orders, wholesale_order_items,
               journal_entries, journal_entry_lines IN SHARE ROW EXCLUSIVE MODE;

    IF EXISTS (SELECT 1 FROM inventory_items
                WHERE receipt_ref = 'FIFO-REBUILD' OR status = 'written_off' OR consumer_kind IS NOT NULL) THEN
        RAISE EXCEPTION 'FIFO rebuild: the pool already carries FIFO state (rebuild fillers, written_off rows or consumer links) — the rebuild has run or phase 3 is live. Nothing was changed.';
    END IF;
    IF EXISTS (SELECT 1 FROM sale_items WHERE cogs_cost IS NOT NULL OR COALESCE(cogs_short_qty, 0) <> 0)
       OR EXISTS (SELECT 1 FROM wholesale_order_items WHERE cogs_cost IS NOT NULL OR COALESCE(cogs_short_qty, 0) <> 0) THEN
        RAISE EXCEPTION 'FIFO rebuild: order lines already carry a FIFO cost — the rebuild has run or phase 3 is live. Nothing was changed.';
    END IF;

    SELECT count(*), min(id::TEXT)::UUID INTO v_n, v_inv FROM chart_of_accounts WHERE account_code = '1300';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FIFO rebuild: expected one 1300 account, found %.', v_n;
    END IF;
    SELECT count(*), min(id::TEXT)::UUID INTO v_n, v_cogs FROM chart_of_accounts WHERE account_code = '5000';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FIFO rebuild: expected one 5000 account, found %.', v_n;
    END IF;

    SELECT string_agg(x, ', ') INTO v_txt FROM unnest(v_u_statuses) x WHERE x IS NULL OR NOT (x = ANY (c_holds));
    IF v_txt IS NOT NULL THEN
        RAISE EXCEPTION 'FIFO rebuild: p_u_statuses "%" do not hold stock (use Shipped, Delivered, Returned).', v_txt;
    END IF;

    -- -----------------------------------------------------------------------
    -- Plan
    -- -----------------------------------------------------------------------
    DROP TABLE IF EXISTS _fr_basis, _fr_p, _fr_booked, _fr_orders, _fr_lines, _fr_rows, _fr_pp, _fr_units;

    CREATE TEMP TABLE _fr_basis (product_id TEXT PRIMARY KEY, cost NUMERIC NOT NULL) ON COMMIT DROP;
    FOR v_spec IN SELECT b.key, b.value FROM jsonb_each_text(COALESCE(p_basis, '{}'::JSONB)) b ORDER BY b.key LOOP
        IF v_spec.value IS NULL OR v_spec.value !~ '^[0-9]+(\.[0-9]+)?$' THEN
            RAISE EXCEPTION 'FIFO rebuild: basis "%" has a bad cost "%".', v_spec.key, v_spec.value;
        END IF;
        SELECT count(*), min(id) INTO v_n, v_txt FROM products WHERE id = v_spec.key OR name = v_spec.key;
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'FIFO rebuild: basis "%" matches % products.', v_spec.key, v_n;
        END IF;
        IF EXISTS (SELECT 1 FROM _fr_basis WHERE product_id = v_txt) THEN
            RAISE EXCEPTION 'FIFO rebuild: basis names product % twice.', v_txt;
        END IF;
        INSERT INTO _fr_basis VALUES (v_txt, v_spec.value::NUMERIC);
    END LOOP;

    -- Per product: S, the basis cost, the fallback cost (before any change)
    -- and the last receipt cost for fillers.
    CREATE TEMP TABLE _fr_p ON COMMIT DROP AS
    SELECT p.id, p.name,
           COALESCE(p.purchase_cost, 0) AS pc,
           COALESCE(p.stock, 0) AS raw_stock,
           GREATEST(0, floor(COALESCE(p.stock, 0)))::INT AS s,
           COALESCE(b.cost, COALESCE(p.purchase_cost, 0)) AS basis_cost,
           wp_internal.fifo_fallback_cost(p.id) AS fallback,
           COALESCE(rs.cost, po.cost, wp_internal.fifo_fallback_cost(p.id)) AS filler_cost
      FROM products p
      LEFT JOIN _fr_basis b ON b.product_id = p.id
      LEFT JOIN (SELECT DISTINCT ON (x.product_id) x.product_id, x.cost
                   FROM restocks x
                  WHERE x.product_id IS NOT NULL AND x.cost > 0
                  ORDER BY x.product_id, x.date DESC NULLS LAST, x.id) rs ON rs.product_id = p.id
      LEFT JOIN (SELECT DISTINCT ON (i.product_id) i.product_id, i.unit_price AS cost
                   FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.purchase_order_id
                  WHERE o.status = 'Received' AND i.product_id IS NOT NULL AND i.unit_price > 0
                  ORDER BY i.product_id, i.created_at DESC NULLS LAST, i.id) po ON po.product_id = p.id;

    -- Orders with a COGS entry: an entry with a 5000 line, referenced
    -- ORD-<order>-COGS or TX-<tx of the order>.
    CREATE TEMP TABLE _fr_booked ON COMMIT DROP AS
    SELECT DISTINCT x.order_id
      FROM (SELECT CASE
                     WHEN e.reference_id ~ '^ORD-.+-COGS$' THEN substring(e.reference_id FROM '^ORD-(.+)-COGS$')
                     WHEN e.reference_id ~ '^TX-.+$' THEN
                         (SELECT t.order_id FROM transactions t
                           WHERE t.order_id IS NOT NULL AND t.id::TEXT = substring(e.reference_id FROM '^TX-(.+)$'))
                   END AS order_id
              FROM journal_entries e
             WHERE EXISTS (SELECT 1 FROM journal_entry_lines l WHERE l.journal_entry_id = e.id AND l.account_id = v_cogs)) x
     WHERE x.order_id IS NOT NULL;

    CREATE TEMP TABLE _fr_orders ON COMMIT DROP AS
    SELECT s.id, s.shipping_status, s.date,
           COALESCE(s.shipping_status, '') = ANY (c_holds) AS holds,
           COALESCE(s.payment_status, '') = ANY (c_settled) AS settled,
           EXISTS (SELECT 1 FROM _fr_booked b WHERE b.order_id = s.id) AS booked
      FROM sales s;
    ALTER TABLE _fr_orders ADD PRIMARY KEY (id);

    -- The U lines, with where each one's units start in its product's U slice
    -- (oldest-shipped line first).
    CREATE TEMP TABLE _fr_lines ON COMMIT DROP AS
    WITH l AS (
        SELECT si.id AS line_id, si.sale_id AS order_id, si.product_id,
               GREATEST(COALESCE(si.quantity, 0), 0) AS qty,
               COALESCE((SELECT max(m.created_at) FROM stock_movements m
                          WHERE m.reference_id = o.id AND m.type = 'out'), o.date) AS ship_at
          FROM sale_items si
          JOIN _fr_orders o ON o.id = si.sale_id
          JOIN _fr_p p ON p.id = si.product_id
         WHERE o.holds AND NOT o.settled AND NOT o.booked
           AND GREATEST(COALESCE(si.quantity, 0), 0) > 0
           AND COALESCE(o.shipping_status, '') = ANY (v_u_statuses)
           AND NOT (v_u_from IS NOT NULL AND (o.date IS NULL OR o.date < v_u_from))
    )
    SELECT l.*, floor(l.qty)::INT AS pool_units, round(l.qty - floor(l.qty), 4) AS frac,
           (sum(floor(l.qty)::INT) OVER (PARTITION BY l.product_id
                                          ORDER BY l.ship_at ASC NULLS FIRST, l.order_id COLLATE "C", l.line_id COLLATE "C"
                                          ROWS UNBOUNDED PRECEDING) - floor(l.qty)::INT)::INT AS j_start
      FROM l;

    -- Every row of every product, newest first.
    CREATE TEMP TABLE _fr_rows ON COMMIT DROP AS
    SELECT i.id, i.product_id, i.status, i.sale_id, i.cost_of_purchase, i.received_at,
           (row_number() OVER (PARTITION BY i.product_id ORDER BY i.received_at DESC, i.id DESC) - 1)::INT AS pos
      FROM inventory_items i JOIN _fr_p p ON p.id = i.product_id;
    SELECT count(*) INTO v_rows_before FROM inventory_items;

    CREATE TEMP TABLE _fr_pp ON COMMIT DROP AS
    SELECT p.id, p.s,
           COALESCE(u.u, 0) AS u,
           COALESCE(u.frac_u, 0) AS frac_u,
           p.s + COALESCE(u.u, 0) AS need,
           COALESCE(rw.n, 0)::INT AS n_rows,
           GREATEST(0, p.s + COALESCE(u.u, 0) - COALESCE(rw.n, 0))::INT AS n_fill,
           COALESCE(rw.oldest, now()) AS filler_base
      FROM _fr_p p
      LEFT JOIN (SELECT product_id, sum(pool_units)::INT AS u, round(sum(frac), 4) AS frac_u
                   FROM _fr_lines GROUP BY product_id) u ON u.product_id = p.id
      LEFT JOIN (SELECT product_id, count(*) AS n, min(received_at) AS oldest
                   FROM _fr_rows GROUP BY product_id) rw ON rw.product_id = p.id;

    -- The S+U units of each product, newest first: existing rows, then the
    -- fillers in the oldest places. j counts the U slice from its oldest unit.
    CREATE TEMP TABLE _fr_units ON COMMIT DROP AS
    SELECT x.*,
           x.pos < pp.s AS in_stock,
           CASE WHEN x.pos >= pp.s THEN pp.need - 1 - x.pos END AS j,
           NULL::TEXT AS line_id, NULL::TEXT AS order_id, NULL::TIMESTAMPTZ AS ship_at
      FROM (SELECT r.product_id, r.pos, r.id AS row_id, NULL::INT AS filler_k,
                   CASE WHEN COALESCE(r.cost_of_purchase, 0) > 0 THEN r.cost_of_purchase ELSE p.fallback END AS cost,
                   NOT (COALESCE(r.cost_of_purchase, 0) > 0) AS recost,
                   r.status AS old_status, r.sale_id AS old_sale_id,
                   r.received_at
              FROM _fr_rows r JOIN _fr_pp pp ON pp.id = r.product_id JOIN _fr_p p ON p.id = r.product_id
             WHERE r.pos < pp.need
            UNION ALL
            SELECT pp.id, pp.n_rows + k - 1, NULL, k, p.filler_cost, false, NULL, NULL,
                   pp.filler_base - k * INTERVAL '1 millisecond'
              FROM _fr_pp pp JOIN _fr_p p ON p.id = pp.id
             CROSS JOIN LATERAL generate_series(1, pp.n_fill) k) x
      JOIN _fr_pp pp ON pp.id = x.product_id;

    UPDATE _fr_units u
       SET line_id = l.line_id, order_id = l.order_id, ship_at = l.ship_at
      FROM _fr_lines l
     WHERE NOT u.in_stock AND l.product_id = u.product_id
       AND u.j >= l.j_start AND u.j < l.j_start + l.pool_units;
    IF EXISTS (SELECT 1 FROM _fr_units WHERE NOT in_stock AND line_id IS NULL) THEN
        RAISE EXCEPTION 'FIFO rebuild: internal error, a U unit has no line.';
    END IF;

    -- Ledger numbers, rounded per product as the dry run rounds them.
    SELECT round(COALESCE(sum(COALESCE(l.debit, 0) - COALESCE(l.credit, 0)), 0), 2) INTO v_B
      FROM journal_entry_lines l WHERE l.account_id = v_inv;
    WITH pv AS (
        SELECT pp.id,
               COALESCE((SELECT sum(u.cost) FROM _fr_units u WHERE u.product_id = pp.id AND u.in_stock), 0) AS vis,
               COALESCE((SELECT sum(u.cost) FROM _fr_units u WHERE u.product_id = pp.id AND NOT u.in_stock), 0)
             + COALESCE((SELECT sum(l.frac * p.fallback) FROM _fr_lines l WHERE l.product_id = pp.id), 0) AS vu,
               p.basis_cost * (pp.s + pp.u + pp.frac_u) AS vb
          FROM _fr_pp pp JOIN _fr_p p ON p.id = pp.id
    )
    SELECT round(sum(round(vis, 2)), 2), round(sum(round(vu, 2)), 2), sum(vis + vu),
           round(sum(round(vb, 2)), 2), round(sum(round(vis + vu, 2)) - sum(round(vb, 2)), 2)
      INTO v_V_stock, v_V_u, v_V_raw, v_basis_total, v_D1
      FROM pv;
    v_V := round(v_V_stock + v_V_u, 2);
    v_VmB := round(v_V - v_B, 2);
    v_guard := round(v_D1 - v_VmB, 2);

    IF abs(v_guard) > 1 THEN
        RAISE EXCEPTION 'FIFO rebuild stopped, nothing was changed: D1 = % but V - B = % (V %, B %, basis value of S+U %); |D1 - (V - B)| = % is over $1, so the ledger does not hold the counted stock at the basis cost. Run src/scripts/fifo-rebuild-dryrun.cjs with the same options for the breakdown.',
            v_D1, v_VmB, v_V, v_B, v_basis_total, abs(v_guard);
    END IF;

    -- Plan counts (before the writes change the rows they read).
    SELECT jsonb_build_object(
        'S', (SELECT COALESCE(sum(s), 0) FROM _fr_pp),
        'U', (SELECT COALESCE(sum(u), 0) FROM _fr_pp),
        'u_frac_qty', (SELECT round(COALESCE(sum(frac_u), 0), 4) FROM _fr_pp),
        'u_lines', (SELECT count(*) FROM _fr_lines),
        'u_orders', (SELECT count(DISTINCT order_id) FROM _fr_lines),
        'rows_total', v_rows_before,
        'kept_in_stock', (SELECT count(*) FROM _fr_units WHERE in_stock AND row_id IS NOT NULL),
        'assigned_rows', (SELECT count(*) FROM _fr_units WHERE NOT in_stock AND row_id IS NOT NULL),
        'filler_in_stock', (SELECT count(*) FROM _fr_units WHERE in_stock AND row_id IS NULL),
        'filler_assigned', (SELECT count(*) FROM _fr_units WHERE NOT in_stock AND row_id IS NULL),
        'recosted_zero_rows', (SELECT count(*) FROM _fr_units WHERE row_id IS NOT NULL AND recost),
        'pulled_from_history', (SELECT count(*) FROM _fr_units u JOIN _fr_orders o ON o.id = u.old_sale_id
                                 WHERE u.row_id IS NOT NULL AND u.old_status = 'sold' AND o.holds AND (o.settled OR o.booked)),
        'history_sold', (SELECT count(*) FROM _fr_rows r JOIN _fr_pp pp ON pp.id = r.product_id
                           JOIN _fr_orders o ON o.id = r.sale_id
                          WHERE r.pos >= pp.need AND r.status = 'sold' AND o.holds AND (o.settled OR o.booked)),
        'written_off', (SELECT count(*) FROM _fr_rows r JOIN _fr_pp pp ON pp.id = r.product_id
                          LEFT JOIN _fr_orders o ON o.id = r.sale_id
                         WHERE r.pos >= pp.need
                           AND NOT (r.status = 'sold' AND COALESCE(o.holds AND (o.settled OR o.booked), false))),
        'wo_surplus_in_stock', (SELECT count(*) FROM _fr_rows r JOIN _fr_pp pp ON pp.id = r.product_id
                                 WHERE r.pos >= pp.need AND r.status = 'in_stock'),
        'wo_returned', (SELECT count(*) FROM _fr_rows r JOIN _fr_pp pp ON pp.id = r.product_id
                         WHERE r.pos >= pp.need AND r.status = 'returned'),
        'wo_sold_null_sale', (SELECT count(*) FROM _fr_rows r JOIN _fr_pp pp ON pp.id = r.product_id
                               WHERE r.pos >= pp.need AND r.status = 'sold' AND r.sale_id IS NULL),
        'wo_sold_unsettled_unassigned', (SELECT count(*) FROM _fr_rows r JOIN _fr_pp pp ON pp.id = r.product_id
                                          JOIN _fr_orders o ON o.id = r.sale_id
                                         WHERE r.pos >= pp.need AND r.status = 'sold'
                                           AND o.holds AND NOT o.settled AND NOT o.booked),
        'wo_sold_not_holding', (SELECT count(*) FROM _fr_rows r JOIN _fr_pp pp ON pp.id = r.product_id
                                 JOIN _fr_orders o ON o.id = r.sale_id
                                WHERE r.pos >= pp.need AND r.status = 'sold' AND NOT o.holds))
      INTO v_totals;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id', id, 'name', name, 'stock', raw_stock, 'planned_as', s)
                              ORDER BY name, id), '[]'::JSONB)
      INTO v_anomalies FROM _fr_p WHERE raw_stock <> s;

    -- -----------------------------------------------------------------------
    -- Write
    -- -----------------------------------------------------------------------
    EXECUTE format('CREATE TABLE public.%I AS SELECT * FROM public.inventory_items', v_bak);

    -- 2) the newest S rows: in stock, nothing linked.
    UPDATE inventory_items i
       SET status = 'in_stock', cost_of_purchase = u.cost, sale_id = NULL,
           consumer_kind = NULL, consumer_id = NULL, consumer_line_id = NULL, consumed_at = NULL
      FROM _fr_units u
     WHERE u.row_id = i.id AND u.in_stock;

    -- 3) the next U rows: sold to their line.
    UPDATE inventory_items i
       SET status = 'sold', cost_of_purchase = u.cost, sale_id = u.order_id,
           consumer_kind = 'retail', consumer_id = u.order_id, consumer_line_id = u.line_id,
           consumed_at = COALESCE(u.ship_at, now())
      FROM _fr_units u
     WHERE u.row_id = i.id AND NOT u.in_stock;

    -- 4) older rows: history stays sold (stamped to its line where one has
    --    room), everything else is written off.
    WITH h AS (
        SELECT r.id, r.product_id, r.sale_id,
               row_number() OVER (PARTITION BY r.sale_id, r.product_id ORDER BY r.received_at, r.id) - 1 AS k
          FROM _fr_rows r JOIN _fr_pp pp ON pp.id = r.product_id JOIN _fr_orders o ON o.id = r.sale_id
         WHERE r.pos >= pp.need AND r.status = 'sold' AND o.holds AND (o.settled OR o.booked)
    ), hl AS (
        SELECT si.id AS line_id, si.sale_id, si.product_id,
               floor(GREATEST(COALESCE(si.quantity, 0), 0))::INT AS units,
               sum(floor(GREATEST(COALESCE(si.quantity, 0), 0))::INT)
                   OVER (PARTITION BY si.sale_id, si.product_id ORDER BY si.id COLLATE "C" ROWS UNBOUNDED PRECEDING) AS cum
          FROM sale_items si
         WHERE si.sale_id IN (SELECT sale_id FROM h) AND si.product_id IS NOT NULL
    )
    UPDATE inventory_items i
       SET consumer_kind = 'retail', consumer_id = h.sale_id, consumer_line_id = hl.line_id
      FROM h JOIN hl ON hl.sale_id = h.sale_id AND hl.product_id = h.product_id
                    AND h.k >= hl.cum - hl.units AND h.k < hl.cum
     WHERE i.id = h.id;

    UPDATE inventory_items i
       SET status = 'written_off', sale_id = NULL,
           consumer_kind = 'reconcile', consumer_id = v_tag, consumer_line_id = NULL, consumed_at = now()
      FROM _fr_rows r JOIN _fr_pp pp ON pp.id = r.product_id LEFT JOIN _fr_orders o ON o.id = r.sale_id
     WHERE r.id = i.id AND r.pos >= pp.need
       AND NOT (r.status = 'sold' AND COALESCE(o.holds AND (o.settled OR o.booked), false));

    -- 5) fillers.
    INSERT INTO inventory_items (product_id, cost_of_purchase, status, sale_id, received_at, receipt_ref,
                                 consumer_kind, consumer_id, consumer_line_id, consumed_at)
    SELECT u.product_id, u.cost,
           CASE WHEN u.in_stock THEN 'in_stock' ELSE 'sold' END,
           u.order_id, u.received_at, 'FIFO-REBUILD',
           CASE WHEN u.in_stock THEN NULL ELSE 'retail' END,
           u.order_id, u.line_id,
           CASE WHEN u.in_stock THEN NULL ELSE COALESCE(u.ship_at, now()) END
      FROM _fr_units u
     WHERE u.row_id IS NULL
     ORDER BY u.product_id, u.pos;

    -- 3) the U lines' frozen cost.
    UPDATE sale_items si
       SET cogs_cost = c.cost, cogs_short_qty = l.frac
      FROM _fr_lines l
      JOIN _fr_p p ON p.id = l.product_id
      JOIN LATERAL (SELECT COALESCE(sum(u.cost), 0) + l.frac * p.fallback AS cost
                      FROM _fr_units u WHERE u.line_id = l.line_id AND u.product_id = l.product_id) c ON true
     WHERE si.id = l.line_id;

    -- 6) open wholesale lines: the booked COGS, held as shortfall units.
    WITH held AS (
        SELECT wi.id, wi.wholesale_order_id AS oid, wi.quantity AS qty,
               COALESCE(p.purchase_cost, 0) * wi.quantity AS w
          FROM wholesale_order_items wi
          JOIN wholesale_orders o ON o.id = wi.wholesale_order_id
          LEFT JOIN products p ON p.id = wi.product_id
         WHERE COALESCE(o.status, 'Open') <> 'Cancelled'
           AND wi.product_id IS NOT NULL AND COALESCE(wi.quantity, 0) > 0
    ), booked AS (
        SELECT substring(e.reference_id FROM '^WSO-(.+)-COGS$') AS oid,
               sum(COALESCE(l.debit, 0) - COALESCE(l.credit, 0)) AS amt
          FROM journal_entries e JOIN journal_entry_lines l ON l.journal_entry_id = e.id AND l.account_id = v_cogs
         WHERE e.reference_id ~ '^WSO-.+-COGS$'
         GROUP BY 1
    ), share AS (
        SELECT h.id, h.oid, h.qty, COALESCE(b.amt, 0) AS amt,
               round(COALESCE(b.amt, 0) * CASE WHEN sum(h.w) OVER (PARTITION BY h.oid) > 0
                                               THEN h.w / sum(h.w) OVER (PARTITION BY h.oid)
                                               ELSE h.qty / sum(h.qty) OVER (PARTITION BY h.oid) END, 4) AS part,
               row_number() OVER (PARTITION BY h.oid ORDER BY h.w DESC, h.id) AS rn
          FROM held h LEFT JOIN booked b ON b.oid = h.oid::TEXT
    ), fixed AS (
        -- The largest line takes the rounding remainder, so the lines add up
        -- to the booked amount exactly.
        SELECT s.id, s.qty,
               s.part + CASE WHEN s.rn = 1 THEN s.amt - sum(s.part) OVER (PARTITION BY s.oid) ELSE 0 END AS cost
          FROM share s
    )
    UPDATE wholesale_order_items wi
       SET cogs_cost = f.cost, cogs_short_qty = f.qty
      FROM fixed f
     WHERE wi.id = f.id;
    SELECT jsonb_build_object('lines', count(*), 'orders', count(DISTINCT wholesale_order_id),
                              'cogs_cost', round(COALESCE(sum(cogs_cost), 0), 2), 'short_qty', COALESCE(sum(cogs_short_qty), 0))
      INTO v_wholesale FROM wholesale_order_items WHERE cogs_cost IS NOT NULL;

    -- -----------------------------------------------------------------------
    -- Check what was written
    -- -----------------------------------------------------------------------
    SELECT string_agg(format('%s (in_stock %s, S %s)', pp.id, COALESCE(c.n, 0), pp.s), ', ') INTO v_txt
      FROM _fr_pp pp
      LEFT JOIN (SELECT product_id, count(*) AS n FROM inventory_items WHERE status = 'in_stock' GROUP BY product_id) c
        ON c.product_id = pp.id
     WHERE COALESCE(c.n, 0) <> pp.s;
    IF v_txt IS NOT NULL THEN
        RAISE EXCEPTION 'FIFO rebuild check failed, nothing was changed: in_stock count is not S for %', v_txt;
    END IF;

    SELECT string_agg(format('%s (holds %s, expected %s)', l.line_id, COALESCE(c.n, 0), l.pool_units), ', ') INTO v_txt
      FROM _fr_lines l
      LEFT JOIN (SELECT consumer_line_id, count(*) AS n FROM inventory_items
                  WHERE status = 'sold' AND consumer_kind = 'retail' GROUP BY consumer_line_id) c
        ON c.consumer_line_id = l.line_id
     WHERE COALESCE(c.n, 0) <> l.pool_units;
    IF v_txt IS NOT NULL THEN
        RAISE EXCEPTION 'FIFO rebuild check failed, nothing was changed: U lines hold the wrong number of rows: %', v_txt;
    END IF;

    SELECT string_agg(l.line_id, ', ') INTO v_txt
      FROM _fr_lines l JOIN sale_items si ON si.id = l.line_id JOIN _fr_p p ON p.id = l.product_id
     WHERE si.cogs_cost IS DISTINCT FROM
           (SELECT COALESCE(sum(i.cost_of_purchase), 0) FROM inventory_items i
             WHERE i.status = 'sold' AND i.consumer_kind = 'retail' AND i.consumer_line_id = l.line_id) + l.frac * p.fallback;
    IF v_txt IS NOT NULL THEN
        RAISE EXCEPTION 'FIFO rebuild check failed, nothing was changed: cogs_cost does not match the rows held for %', v_txt;
    END IF;

    IF EXISTS (SELECT 1 FROM inventory_items WHERE status = 'in_stock'
                 AND (sale_id IS NOT NULL OR consumer_kind IS NOT NULL OR consumer_id IS NOT NULL
                      OR consumer_line_id IS NOT NULL OR consumed_at IS NOT NULL)) THEN
        RAISE EXCEPTION 'FIFO rebuild check failed, nothing was changed: an in_stock row keeps a link.';
    END IF;

    SELECT count(*) INTO v_n
      FROM inventory_items i
     WHERE i.status = 'sold'
       AND NOT (i.consumer_kind = 'retail' AND EXISTS (SELECT 1 FROM _fr_lines l WHERE l.line_id = i.consumer_line_id))
       AND NOT EXISTS (SELECT 1 FROM _fr_orders o WHERE o.id = i.sale_id AND o.holds AND (o.settled OR o.booked));
    IF v_n > 0 THEN
        RAISE EXCEPTION 'FIFO rebuild check failed, nothing was changed: % sold rows are neither U rows nor history.', v_n;
    END IF;
    IF EXISTS (SELECT 1 FROM inventory_items WHERE status = 'returned') THEN
        RAISE EXCEPTION 'FIFO rebuild check failed, nothing was changed: returned rows are left.';
    END IF;

    SELECT count(*) INTO v_n FROM inventory_items;
    IF v_n <> v_rows_before + (SELECT count(*) FROM _fr_units WHERE row_id IS NULL) THEN
        RAISE EXCEPTION 'FIFO rebuild check failed, nothing was changed: % rows, expected % + fillers.', v_n, v_rows_before;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', v_bak) INTO v_n;
    IF v_n <> v_rows_before THEN
        RAISE EXCEPTION 'FIFO rebuild check failed, nothing was changed: the backup holds % rows, expected %.', v_n, v_rows_before;
    END IF;

    SELECT (SELECT COALESCE(sum(cost_of_purchase), 0) FROM inventory_items WHERE status = 'in_stock')
         + (SELECT COALESCE(sum(si.cogs_cost), 0) FROM sale_items si WHERE si.id IN (SELECT line_id FROM _fr_lines))
      INTO v_amount;
    IF v_amount <> v_V_raw THEN
        RAISE EXCEPTION 'FIFO rebuild check failed, nothing was changed: the table value % is not the planned V %.', v_amount, v_V_raw;
    END IF;

    -- -----------------------------------------------------------------------
    -- The revaluation entry (D1 only; the quantity correction is not repeated)
    -- -----------------------------------------------------------------------
    v_amount := abs(v_D1);
    IF v_amount > 0 THEN
        v_number := wp_internal.wp_next_entry_number('MAN', v_date);
        INSERT INTO journal_entries (date, description, reference_id, status, entry_number)
        VALUES (v_date, 'FIFO revaluation of on-hand and shipped-unsettled stock', v_ref, 'Draft', v_number)
        RETURNING id INTO v_entry;
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
            (v_entry, v_inv, CASE WHEN v_D1 > 0 THEN v_amount ELSE 0 END, CASE WHEN v_D1 > 0 THEN 0 ELSE v_amount END,
             'Inventory restated at FIFO layer cost'),
            (v_entry, v_cogs, CASE WHEN v_D1 > 0 THEN 0 ELSE v_amount END, CASE WHEN v_D1 > 0 THEN v_amount ELSE 0 END,
             'Cost of goods sold — FIFO revaluation');
    END IF;

    RETURN jsonb_build_object(
        'run_date', v_date,
        'backup_table', v_bak,
        'options', jsonb_build_object('basis', COALESCE(p_basis, '{}'::JSONB), 'u_statuses', to_jsonb(v_u_statuses), 'u_from', p_u_from),
        'totals', v_totals,
        'ledger', jsonb_build_object(
            'V_in_stock', v_V_stock, 'V_unsettled', v_V_u, 'V', v_V, 'B', v_B, 'V_minus_B', v_VmB,
            'basis_value_S_plus_U', v_basis_total, 'D1', v_D1,
            'guard_diff_D1_minus_VminusB', v_guard, 'guard_pass', true),
        'entry', CASE WHEN v_entry IS NULL THEN NULL ELSE jsonb_build_object(
            'reference_id', v_ref, 'entry_number', v_number, 'status', 'Draft', 'amount', v_amount,
            'debit', CASE WHEN v_D1 > 0 THEN '1300' ELSE '5000' END,
            'credit', CASE WHEN v_D1 > 0 THEN '5000' ELSE '1300' END) END,
        'wholesale_backfill', v_wholesale,
        'anomalies', v_anomalies);
END;
$fn$;

-- >>> RUN — set the options for THIS store (the same as the dry run's):
--   p_basis       {"<product id or name>": <cost the ledger carries>, ...}
--   p_u_statuses  which holding statuses form U (NULL: Shipped, Delivered, Returned)
--   p_u_from      orders dated before this local day are left out of U (NULL: none)
--   p_run_date    names the backup / tag / entry (NULL: today in Cambodia)
-- Romdoul1, aligned with the 2026-11-12 true-up:
--   p_basis => '{"NR-3026": 9}', p_u_statuses => ARRAY['Shipped','Delivered'], p_u_from => '2026-10-21'
SELECT pg_temp.fifo_rebuild_pool(
    p_basis => '{}'::JSONB,
    p_u_statuses => NULL,
    p_u_from => NULL,
    p_run_date => NULL) AS fifo_rebuild;
-- <<< RUN

COMMIT;
