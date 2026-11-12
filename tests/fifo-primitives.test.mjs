// PGlite test of migrations/add_fifo_costing.sql (FIFO phase 1): the schema
// and the wp_internal FIFO primitives, on top of the real stack —
// full_schema.sql, auth guards, the packs, then add_fifo_costing.sql and
// add_session_guards.sql (each run twice). Checks:
//   * the migration on a pre-FIFO inventory_items (received_at backfilled
//     from created_at, the old status CHECK widened, a re-run keeps an
//     explicit received_at), the new columns and indexes;
//   * fifo_fallback_cost tiers and fifo_add_layers;
//   * fifo_consume takes layers by received_at, id; partial fifo_return gives
//     back the newest first; a shortfall is costed at the last receipt cost
//     and a later return gives the short units back first; a return then a
//     consume picks the same rows; written_off rows never return;
//   * fifo_peek_cost / fifo_peek, order_cogs, fifo_inventory_valuation,
//     fifo_inventory_check;
//   * the guarded public read RPCs (permissions, enforcement, the "run
//     add_fifo_costing.sql" answer when the implementation is missing);
//   * inert: the existing ship path still works and fills no FIFO column.
// See tests/README.md for how to run it.
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const { PGlite } = await import(process.env.PGLITE_DIST || '@electric-sql/pglite');

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mig = f => path.join(repo, 'migrations', f);
const db = new PGlite();
const q = (s, p) => db.query(s, p);
let pass = 0, fail = 0;
const check = (label, cond, extra) => {
    if (cond) { pass++; console.log('PASS', label); }
    else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); }
};
const errOf = async (sql, params) => {
    try { await q(sql, params); return ''; } catch (e) { return String(e.message || e); }
};
const one = async (sql, params) => (await q(sql, params)).rows[0];
const num = v => Number(v);
const near = (a, b) => Math.abs(num(a) - num(b)) < 1e-9;
const strip = f => fs.readFileSync(f, 'utf8').replace(/NOTIFY[^;]*;/g, '');

// ---------------------------------------------------------------------------
// Build the store as it is live today (pre-FIFO inventory_items), then FIFO.
// ---------------------------------------------------------------------------
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;`);
await db.exec(`CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid LANGUAGE sql AS 'SELECT gen_random_uuid()';`);
let schema = strip(mig('full_schema.sql')).replace(/CREATE EXTENSION[^;]*;/g, '');
schema = schema.replace(/INSERT INTO storage[\s\S]*?END \$\$;/, '');
await db.exec(schema);
await db.exec(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;`);
await db.exec(strip(mig('add_auth_guards.sql')));
for (const f of ['add_transaction_order_link.sql', 'add_transaction_reference_notes.sql',
                 'add_purchase_order_bill_date.sql',
                 'add_wholesale_procurement_functions.sql',
                 'add_order_status_function.sql', 'add_order_payment_functions.sql',
                 'add_stock_adjustment_posting.sql',
                 'add_config_functions.sql']) {
    await db.exec(strip(mig(f)));
}
await db.exec(strip(mig('add_session_guards.sql')));

// Turn inventory_items back into the live (pre-FIFO) table: no FIFO
// columns, the original unnamed-style narrow status CHECK.
await db.exec(`
    DROP INDEX IF EXISTS inventory_items_fifo_idx;
    DROP INDEX IF EXISTS inventory_items_consumer_idx;
    DROP INDEX IF EXISTS inventory_items_sale_idx;
    ALTER TABLE inventory_items DROP COLUMN received_at, DROP COLUMN receipt_ref,
        DROP COLUMN consumer_kind, DROP COLUMN consumer_id, DROP COLUMN consumer_line_id,
        DROP COLUMN consumed_at;
    ALTER TABLE inventory_items DROP CONSTRAINT inventory_items_status_check;
    ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_status_check1
        CHECK (status IN ('in_stock', 'sold', 'returned'));
    ALTER TABLE sale_items DROP COLUMN cogs_cost, DROP COLUMN cogs_short_qty, DROP COLUMN cogs_booked;
    ALTER TABLE wholesale_order_items DROP COLUMN cogs_cost, DROP COLUMN cogs_short_qty;
    ALTER TABLE stock_movements DROP COLUMN unit_cost;
`);
await q(`INSERT INTO products (id, name) VALUES ('tmp', 'tmp')`);
check('pre-FIFO table refuses written_off',
    /check constraint/i.test(await errOf(`INSERT INTO inventory_items (product_id, status) VALUES ('tmp', 'written_off')`)));
await q(`DELETE FROM products WHERE id = 'tmp'`);

await q(`INSERT INTO products (id, name, price, stock, purchase_cost) VALUES
    ('legacy', 'Legacy', 10, 2, 3)`);
await q(`INSERT INTO inventory_items (id, product_id, cost_of_purchase, status, created_at) VALUES
    ('00000000-0000-0000-0000-0000000000a1', 'legacy', 3, 'in_stock', '2026-01-05T10:00:00Z'),
    ('00000000-0000-0000-0000-0000000000a2', 'legacy', 3, 'in_stock', '2026-02-05T10:00:00Z')`);

await db.exec(strip(mig('add_fifo_costing.sql')));
const legacyRows = (await q(`SELECT id, received_at = created_at AS same FROM inventory_items WHERE product_id = 'legacy' ORDER BY id`)).rows;
check('received_at backfilled from created_at', legacyRows.length === 2 && legacyRows.every(r => r.same));
// A rebuild sets received_at explicitly; a re-run must not undo it.
await q(`UPDATE inventory_items SET received_at = '2025-12-01T00:00:00Z' WHERE id = '00000000-0000-0000-0000-0000000000a2'`);
await db.exec(strip(mig('add_fifo_costing.sql')));
await db.exec(strip(mig('add_session_guards.sql')));
await db.exec(strip(mig('add_session_guards.sql')));
check('migration runs twice (with the guards re-run after it)', true);
const kept = await one(`SELECT received_at = '2025-12-01T00:00:00Z'::timestamptz AS ok FROM inventory_items WHERE id = '00000000-0000-0000-0000-0000000000a2'`);
check('re-run keeps an explicit received_at', kept.ok === true);
const statusChecks = (await q(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'inventory_items'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%status%'`)).rows;
check('one status CHECK left, named, with written_off',
    statusChecks.length === 1 && statusChecks[0].conname === 'inventory_items_status_check' && /written_off/.test(statusChecks[0].def), statusChecks);
check('a bogus status is still refused',
    /check constraint/i.test(await errOf(`INSERT INTO inventory_items (product_id, status) VALUES ('legacy', 'gone')`)));
check('a bogus consumer_kind is refused',
    /check constraint/i.test(await errOf(`INSERT INTO inventory_items (product_id, consumer_kind) VALUES ('legacy', 'gift')`)));
const cols = new Set((await q(`SELECT table_name || '.' || column_name AS c FROM information_schema.columns
    WHERE table_schema = 'public'`)).rows.map(r => r.c));
for (const c of ['inventory_items.received_at', 'inventory_items.receipt_ref', 'inventory_items.consumer_kind',
                 'inventory_items.consumer_id', 'inventory_items.consumer_line_id', 'inventory_items.consumed_at',
                 'sale_items.cogs_cost', 'sale_items.cogs_short_qty', 'sale_items.cogs_booked',
                 'wholesale_order_items.cogs_cost', 'wholesale_order_items.cogs_short_qty', 'stock_movements.unit_cost']) {
    check(`column ${c}`, cols.has(c));
}
const idx = new Set((await q(`SELECT indexname FROM pg_indexes WHERE tablename = 'inventory_items'`)).rows.map(r => r.indexname));
for (const i of ['inventory_items_fifo_idx', 'inventory_items_consumer_idx', 'inventory_items_sale_idx']) check(`index ${i}`, idx.has(i));
const nd = await one(`SELECT is_nullable, column_default FROM information_schema.columns
    WHERE table_name = 'inventory_items' AND column_name = 'received_at'`);
check('received_at NOT NULL DEFAULT now()', nd.is_nullable === 'NO' && /now\(\)/.test(nd.column_default || ''), nd);
check('nothing FIFO was created in public by add_fifo_costing.sql',
    (await one(`SELECT to_regprocedure('public.fifo_consume(text,integer,text,text,text)') IS NULL AS a`)).a === true);

// ---------------------------------------------------------------------------
// Seed. p1 has three receipts: t1 5.00 x3 (inserted out of id order, so
// only the id tie-break orders them), t2 6.00 x2, t3 7.00 x2; p2 is the shortfall
// product; p3 has only zero-cost rows; p4 has nothing.
// ---------------------------------------------------------------------------
await q(`INSERT INTO products (id, name, price, stock, purchase_cost) VALUES
    ('p1', 'Speaker', 20, 7, 4.00),
    ('p2', 'Mic', 15, 2, 3.00),
    ('p3', 'Cable', 2, 0, 0.80),
    ('p4', 'Stand', 9, 0, 0)`);
const L = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
await q(`INSERT INTO inventory_items (id, product_id, cost_of_purchase, status, received_at, receipt_ref) VALUES
    ('${L(13)}', 'p1', 5, 'in_stock', '2026-03-01T00:00:00Z', 'PO-1'),
    ('${L(11)}', 'p1', 5, 'in_stock', '2026-03-01T00:00:00Z', 'PO-1'),
    ('${L(12)}', 'p1', 5, 'in_stock', '2026-03-01T00:00:00Z', 'PO-1'),
    ('${L(22)}', 'p1', 6, 'in_stock', '2026-04-01T00:00:00Z', 'PO-2'),
    ('${L(21)}', 'p1', 6, 'in_stock', '2026-04-01T00:00:00Z', 'PO-2'),
    ('${L(31)}', 'p1', 7, 'in_stock', '2026-05-01T00:00:00Z', 'PO-3'),
    ('${L(32)}', 'p1', 7, 'in_stock', '2026-05-01T00:00:00Z', 'PO-3'),
    ('${L(41)}', 'p2', 4, 'in_stock', '2026-03-01T00:00:00Z', 'PO-1'),
    ('${L(42)}', 'p2', 4.5, 'in_stock', '2026-04-01T00:00:00Z', 'PO-2'),
    ('${L(51)}', 'p3', 0, 'in_stock', '2026-03-01T00:00:00Z', 'OPEN')`);
await q(`INSERT INTO sales (id, total, shipping_status, payment_status) VALUES
    ('S1', 100, 'Shipped', 'Unpaid'), ('S2', 50, 'Shipped', 'Unpaid'), ('S3', 30, 'Pending', 'Unpaid')`);
await q(`INSERT INTO sale_items (id, sale_id, product_id, name, price, quantity) VALUES
    ('S1-a', 'S1', 'p1', 'Speaker', 20, 4),
    ('S2-a', 'S2', 'p2', 'Mic', 15, 5),
    ('S3-a', 'S3', 'p1', 'Speaker', 20, 1),
    ('S3-b', 'S3', 'p1', 'Speaker', 20, 1),
    ('S3-c', 'S3', 'p2', 'Mic', 15, 1)`);

const consume = (prod, qty, kind, consumer, line) =>
    one(`SELECT cost, short_qty FROM wp_internal.fifo_consume($1, $2, $3, $4, $5)`, [prod, qty, kind, consumer, line]);
const giveBack = (kind, consumer, line, qty = null) =>
    one(`SELECT cost, short_qty FROM wp_internal.fifo_return($1, $2, $3, $4)`, [kind, consumer, line, qty]);
const heldBy = async (kind, consumer, line) => (await q(
    `SELECT id FROM inventory_items WHERE status = 'sold' AND consumer_kind = $1 AND consumer_id = $2 AND consumer_line_id = $3 ORDER BY id`,
    [kind, consumer, line])).rows.map(r => r.id);
// What a caller does with the result: add / subtract on the line.
const lineAdd = (line, cost, short) => q(
    `UPDATE sale_items SET cogs_cost = COALESCE(cogs_cost, 0) + $2, cogs_short_qty = COALESCE(cogs_short_qty, 0) + $3 WHERE id = $1`,
    [line, cost, short]);
const lineSub = (line, cost, short) => q(
    `UPDATE sale_items SET cogs_short_qty = cogs_short_qty - $3,
            cogs_cost = CASE WHEN cogs_cost - $2 = 0 AND cogs_short_qty - $3 = 0 THEN NULL ELSE cogs_cost - $2 END
      WHERE id = $1`, [line, cost, short]);

// ---------------------------------------------------------------------------
// fifo_fallback_cost / fifo_add_layers
// ---------------------------------------------------------------------------
const fb = async p => num((await one(`SELECT wp_internal.fifo_fallback_cost($1) AS c`, [p])).c);
check('fallback: newest-received priced layer (p1 -> 7)', await fb('p1') === 7);
check('fallback: only zero-cost layers -> purchase_cost (p3 -> 0.80)', await fb('p3') === 0.8);
check('fallback: nothing at all -> 0 (p4)', await fb('p4') === 0);

await q(`INSERT INTO products (id, name, purchase_cost) VALUES ('p5', 'Bag', 2.5)`);
const addCost = num((await one(`SELECT wp_internal.fifo_add_layers('p5', 3, 0, '2026-06-01T00:00:00Z', 'RST-x') AS c`)).c);
check('add_layers: cost 0 falls back (purchase_cost 2.5)', addCost === 2.5);
const p5 = (await q(`SELECT cost_of_purchase, status, receipt_ref, received_at = '2026-06-01T00:00:00Z'::timestamptz AS at
    FROM inventory_items WHERE product_id = 'p5'`)).rows;
check('add_layers: 3 in_stock rows with ref and received_at',
    p5.length === 3 && p5.every(r => num(r.cost_of_purchase) === 2.5 && r.status === 'in_stock' && r.receipt_ref === 'RST-x' && r.at));
await q(`SELECT wp_internal.fifo_add_layers('p5', 2, 3.1, NULL, 'PO-9')`);
check('add_layers: a priced receipt becomes the fallback', await fb('p5') === 3.1);
await q(`SELECT wp_internal.fifo_add_layers('p5', 0, 9, NULL, 'PO-0')`);
check('add_layers: qty 0 adds nothing', num((await one(`SELECT count(*) AS n FROM inventory_items WHERE product_id = 'p5'`)).n) === 5);
check('add_layers: products.stock untouched', num((await one(`SELECT COALESCE(stock, 0) AS s FROM products WHERE id = 'p5'`)).s) === 0);

// ---------------------------------------------------------------------------
// Consume order by received_at, id
// ---------------------------------------------------------------------------
const c1 = await consume('p1', 4, 'retail', 'S1', 'S1-a');
check('consume 4: cost 5+5+5+6 = 21, no shortfall', near(c1.cost, 21) && c1.short_qty === 0, c1);
await lineAdd('S1-a', c1.cost, c1.short_qty);
const s1Rows = await heldBy('retail', 'S1', 'S1-a');
check('consume: oldest received first, ties by id (11, 12, 13 of t1, then 21 of t2)',
    JSON.stringify(s1Rows) === JSON.stringify([L(11), L(12), L(13), L(21)]), s1Rows);
const s1Meta = await one(`SELECT bool_and(sale_id = 'S1') AS sid, bool_and(consumed_at IS NOT NULL) AS at
    FROM inventory_items WHERE consumer_id = 'S1'`);
check('consume retail: sale_id kept, consumed_at set', s1Meta.sid && s1Meta.at);
check('consume: L22 (same t2, larger id) still in stock',
    (await one(`SELECT status FROM inventory_items WHERE id = '${L(22)}'`)).status === 'in_stock');

// ---------------------------------------------------------------------------
// Partial return gives back the newest first
// ---------------------------------------------------------------------------
const r1 = await giveBack('retail', 'S1', 'S1-a', 1);
check('partial return 1: gives back the t2 layer (6), no short units', near(r1.cost, 6) && num(r1.short_qty) === 0, r1);
await lineSub('S1-a', r1.cost, r1.short_qty);
check('partial return: the three oldest stay consumed',
    JSON.stringify(await heldBy('retail', 'S1', 'S1-a')) === JSON.stringify([L(11), L(12), L(13)]));
const back = await one(`SELECT status, sale_id, consumer_kind, consumer_id, consumer_line_id, consumed_at FROM inventory_items WHERE id = '${L(21)}'`);
check('returned row is clean in_stock', back.status === 'in_stock' && back.sale_id === null && back.consumer_kind === null
    && back.consumer_id === null && back.consumer_line_id === null && back.consumed_at === null, back);
check('line cost follows (15 left)', near((await one(`SELECT cogs_cost FROM sale_items WHERE id = 'S1-a'`)).cogs_cost, 15));

// ---------------------------------------------------------------------------
// Round trip: return everything, take it again -> same rows, same cost
// ---------------------------------------------------------------------------
const r2 = await giveBack('retail', 'S1', 'S1-a');
check('full return: cost 15', near(r2.cost, 15) && num(r2.short_qty) === 0, r2);
await lineSub('S1-a', r2.cost, r2.short_qty);
check('full return: line holds nothing (cogs_cost NULL)', (await one(`SELECT cogs_cost FROM sale_items WHERE id = 'S1-a'`)).cogs_cost === null);
const c2 = await consume('p1', 4, 'retail', 'S1', 'S1-a');
await lineAdd('S1-a', c2.cost, c2.short_qty);
check('re-consume: same rows as the first time',
    JSON.stringify(await heldBy('retail', 'S1', 'S1-a')) === JSON.stringify(s1Rows));
check('re-consume: same cost (21)', near(c2.cost, 21));

// ---------------------------------------------------------------------------
// Shortfall at the last receipt cost; a later return gives short units back first
// ---------------------------------------------------------------------------
const c3 = await consume('p2', 5, 'retail', 'S2', 'S2-a');
check('shortfall: 2 layers (4 + 4.5) + 3 short at the last receipt cost 4.5 = 22',
    near(c3.cost, 22) && c3.short_qty === 3, c3);
await lineAdd('S2-a', c3.cost, c3.short_qty);
check('shortfall: no phantom rows', num((await one(`SELECT count(*) AS n FROM inventory_items WHERE product_id = 'p2'`)).n) === 2);
const r3 = await giveBack('retail', 'S2', 'S2-a', 2);
check('return 2 of a short line: both are short units at 4.5 (9), no rows back',
    near(r3.cost, 9) && num(r3.short_qty) === 2, r3);
await lineSub('S2-a', r3.cost, r3.short_qty);
check('return of short units leaves the layers consumed', (await heldBy('retail', 'S2', 'S2-a')).length === 2);
const r4 = await giveBack('retail', 'S2', 'S2-a', 2);
check('return 2 more: last short unit (4.5) then the newest layer (4.5) = 9',
    near(r4.cost, 9) && num(r4.short_qty) === 1, r4);
await lineSub('S2-a', r4.cost, r4.short_qty);
check('the oldest layer (4) is what stays', JSON.stringify(await heldBy('retail', 'S2', 'S2-a')) === JSON.stringify([L(41)]));
const r5 = await giveBack('retail', 'S2', 'S2-a');
check('full return of the rest: 4', near(r5.cost, 4) && num(r5.short_qty) === 0, r5);
await lineSub('S2-a', r5.cost, r5.short_qty);
check('total released = total charged (22)', near(num(r3.cost) + num(r4.cost) + num(r5.cost), 22));
const s2line = await one(`SELECT cogs_cost, cogs_short_qty FROM sale_items WHERE id = 'S2-a'`);
check('line back to empty', s2line.cogs_cost === null && num(s2line.cogs_short_qty) === 0, s2line);

const c4 = await consume('p4', 2, 'wholesale', 'W1', 'line-1');
check('empty pool, no costs anywhere: short 2 at 0, never raises', near(c4.cost, 0) && c4.short_qty === 2, c4);
const c5 = await consume('p3', 3, 'wholesale', 'W1', 'line-2');
check('zero-cost layer + 2 short at purchase_cost 0.80 = 1.60', near(c5.cost, 1.6) && c5.short_qty === 2, c5);
check('wholesale consume leaves sale_id NULL',
    (await one(`SELECT sale_id, status FROM inventory_items WHERE id = '${L(51)}'`)).sale_id === null);
check('unknown consumer kind is refused', /unknown consumer kind/.test(await errOf(
    `SELECT * FROM wp_internal.fifo_consume('p1', 1, 'gift', 'x', 'y')`)));
const c0 = await consume('p1', 0, 'retail', 'S1', 'S1-a');
check('consume 0: nothing', near(c0.cost, 0) && c0.short_qty === 0);

// ---------------------------------------------------------------------------
// written_off rows never return
// ---------------------------------------------------------------------------
const adj = await consume('p5', 2, 'adjustment', 'ADJ1', 'ADJ1-l');
check('adjustment consume: the two oldest p5 layers (2.5 each) = 5', near(adj.cost, 5) && adj.short_qty === 0, adj);
const woIds = (await q(`SELECT id FROM inventory_items WHERE consumer_kind = 'adjustment' AND status = 'written_off'`)).rows.map(r => r.id);
check('adjustment rows are written_off', woIds.length === 2);
const ra = await giveBack('adjustment', 'ADJ1', 'ADJ1-l');
check('fifo_return(adjustment) gives back nothing', near(ra.cost, 0) && num(ra.short_qty) === 0);
const rr = await giveBack('retail', 'ADJ1', 'ADJ1-l');
check('fifo_return under another kind gives back nothing', near(rr.cost, 0));
await q(`UPDATE inventory_items SET consumer_kind = 'retail' WHERE id = $1`, [woIds[0]]);
const rw = await giveBack('retail', 'ADJ1', 'ADJ1-l');
check('a written_off row is never returned, whatever its consumer columns', near(rw.cost, 0)
    && (await one(`SELECT status FROM inventory_items WHERE id = $1`, [woIds[0]])).status === 'written_off');
const c6 = await consume('p5', 10, 'retail', 'S1', 'S1-x');
check('a later consume never picks written_off rows (3 left: 2.5 + 3.1 + 3.1, 7 short at 3.1)',
    near(c6.cost, 2.5 + 3.1 + 3.1 + 7 * 3.1) && c6.short_qty === 7, c6);
await giveBack('retail', 'S1', 'S1-x');
check('...and returning them puts back only the 3 real rows',
    num((await one(`SELECT count(*) AS n FROM inventory_items WHERE product_id = 'p5' AND status = 'in_stock'`)).n) === 3);

// ---------------------------------------------------------------------------
// fifo_peek_cost / fifo_peek
// ---------------------------------------------------------------------------
// S1 holds L11, L12, L13, L21, so p1 in stock is L22 (6), L31 (7), L32 (7).
const p1Stock = (await q(`SELECT id FROM inventory_items WHERE product_id = 'p1' AND status = 'in_stock' ORDER BY received_at, id`)).rows.map(r => r.id);
check('p1 pool after S1 holds 11/12/13/21', JSON.stringify(p1Stock) === JSON.stringify([L(22), L(31), L(32)]), p1Stock);
const peek = async (p, n) => num((await one(`SELECT wp_internal.fifo_peek_cost($1, $2) AS c`, [p, n])).c);
check('peek 2 of p1: 6 + 7 = 13', await peek('p1', 2) === 13);
check('peek 6 of p1: 6+7+7 + 3 short at 7 = 41', await peek('p1', 6) === 41);
check('peek 1.5 of p1: 6 + 0.5 at fallback 7 = 9.5', await peek('p1', 1.5) === 9.5);
check('peek 0 / NULL = 0', await peek('p1', 0) === 0 && await peek('p1', null) === 0);
check('peek takes nothing', num((await one(`SELECT count(*) AS n FROM inventory_items WHERE product_id = 'p1' AND status = 'in_stock'`)).n) === 3);
const pk = (await one(`SELECT wp_internal.fifo_peek('p1', 6) AS j`)).j;
check('fifo_peek JSON', num(pk.cost) === 41 && num(pk.unit_cost) === 6.8333 && num(pk.available) === 3
    && num(pk.short_qty) === 3 && num(pk.fallback_cost) === 7, pk);

// ---------------------------------------------------------------------------
// order_cogs: frozen where frozen, one peek per product otherwise
// ---------------------------------------------------------------------------
const oc = async o => num((await one(`SELECT wp_internal.order_cogs($1) AS c`, [o])).c);
check('order_cogs S1: frozen 21', await oc('S1') === 21);
// S3: two unfrozen p1 lines of 1 each -> one peek of 2 (6 + 7), plus p2 x1 peek (4).
check('order_cogs S3: lines of one product priced together (6 + 7) + p2 4 = 17', await oc('S3') === 17);
check('order_cogs unknown order: 0', await oc('nope') === 0);

// ---------------------------------------------------------------------------
// fifo_inventory_valuation
// ---------------------------------------------------------------------------
const val = new Map((await q(`SELECT * FROM wp_internal.fifo_inventory_valuation()`)).rows.map(r => [r.product_id, r]));
const v1 = val.get('p1');
check('valuation p1: 3 units, 20.00, avg 6.6667, next 6, last 7, stock 7',
    num(v1.qty) === 3 && num(v1.value) === 20 && num(v1.avg_cost) === 6.6667 && num(v1.next_cost) === 6
    && num(v1.last_cost) === 7 && num(v1.stock) === 7, v1);
const v4 = val.get('p4');
check('valuation lists products with no layers (p4: 0, no avg, no next)',
    num(v4.qty) === 0 && num(v4.value) === 0 && v4.avg_cost === null && v4.next_cost === null, v4);

// ---------------------------------------------------------------------------
// fifo_inventory_check
// ---------------------------------------------------------------------------
// Make the stock match the pool for every product, and book a 1300 balance
// equal to pool + the shipped-unbooked S1 line.
await q(`UPDATE products p SET stock = (SELECT count(*) FROM inventory_items i WHERE i.product_id = p.id AND i.status = 'in_stock')`);
const poolValue = num((await one(`SELECT COALESCE(sum(cost_of_purchase), 0) AS v FROM inventory_items WHERE status = 'in_stock'`)).v);
const inv = (await one(`SELECT id FROM chart_of_accounts WHERE account_code = '1300'`)).id;
const eq = (await one(`SELECT id FROM chart_of_accounts WHERE account_code = '3000'`)).id;
const je = (await one(`INSERT INTO journal_entries (description, reference_id, status) VALUES ('Opening', 'OPENING-INV', 'Posted') RETURNING id`)).id;
await q(`INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0), ($1, $4, 0, $3)`,
    [je, inv, poolValue + 21, eq]);
let chk = (await one(`SELECT wp_internal.fifo_inventory_check() AS j`)).j;
check('check: pool value', near(chk.pool_value, poolValue), chk);
check('check: shipped-unbooked S1 = 21', near(chk.retail_out_unbooked, 21));
check('check: variance 0 when 1300 = pool + shipped-unbooked', near(chk.variance, 0), chk);
check('check: no product mismatches', chk.product_mismatches === 0, chk.products);
check('check: p3 shortfall line is wholesale, so retail short lines = 0', num(chk.shortfall.retail_lines) === 0);
// Settled before ship: COGS booked on S3 (17), goods still in the pool.
const je2 = (await one(`INSERT INTO journal_entries (description, reference_id, status) VALUES ('S3 COGS', 'ORD-S3-COGS', 'Draft') RETURNING id`)).id;
const cogsAcc = (await one(`SELECT id FROM chart_of_accounts WHERE account_code = '5000'`)).id;
await q(`INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 17, 0), ($1, $3, 0, 17)`, [je2, cogsAcc, inv]);
await q(`UPDATE sale_items SET cogs_booked = CASE id WHEN 'S3-a' THEN 6 WHEN 'S3-b' THEN 7 ELSE 4 END WHERE sale_id = 'S3'`);
chk = (await one(`SELECT wp_internal.fifo_inventory_check() AS j`)).j;
check('check: settled-unshipped booked 17 counted, variance still 0',
    near(chk.retail_booked_not_out, 17) && near(chk.variance, 0) && near(chk.ledger_1300_posted, poolValue + 21), chk);
// Ship S3-a at a different cost than booked, without the COGS-ADJ: variance shows it.
const c7 = await consume('p1', 1, 'retail', 'S3', 'S3-a');
await lineAdd('S3-a', c7.cost, c7.short_qty);
await q(`UPDATE sale_items SET cogs_booked = 5 WHERE id = 'S3-a'`); // booked 5, actual 6
chk = (await one(`SELECT wp_internal.fifo_inventory_check() AS j`)).j;
check('check: booked-vs-actual difference without its ADJ shows as variance (-1 = ledger short of the 1 not yet booked)',
    near(chk.retail_booked_out_diff, 1) && near(chk.variance, -1) && chk.product_mismatches === 1, chk);
check('check: lists the product whose pool no longer matches stock',
    chk.products.length === 1 && chk.products[0].product_id === 'p1' && num(chk.products[0].pool_qty) === 2 && num(chk.products[0].stock) === 3, chk.products);

// ---------------------------------------------------------------------------
// Guarded public read RPCs
// ---------------------------------------------------------------------------
const ROLES = [
    { id: 'salesman', name: 'Salesman', permissions: ['create_orders', 'view_orders'] },
    { id: 'stocker', name: 'Stocker', permissions: ['manage_inventory'] },
    { id: 'viewer', name: 'Viewer', permissions: ['view_inventory_stock'] },
    { id: 'payrollist', name: 'Payroll', permissions: ['manage_payroll'] },
];
await q(`UPDATE app_config SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{roles}', $1::jsonb, true) WHERE id = 1`, [JSON.stringify(ROLES)]);
await q(`INSERT INTO users (id, name, email, role_id, pin) VALUES
    ('sal','Sok','s@x.com','salesman','3333'), ('stk','Stody','k@x.com','stocker','4444'),
    ('vw','Vy','v@x.com','viewer','5555'), ('pay','Pel','p@x.com','payrollist','6666')
    ON CONFLICT (id) DO NOTHING`);
const login = async (id, pin) => {
    const { rows: [r] } = await q(`SELECT * FROM login_with_pin($1,$2)`, [pin, id]);
    return JSON.stringify({ user_id: id, token: r.session_token });
};
const S = { sal: await login('sal', '3333'), stk: await login('stk', '4444'), vw: await login('vw', '5555'), pay: await login('pay', '6666') };
const noPerm = m => /do not have permission/i.test(m);
const expired = m => /session has expired/i.test(m);
const rpcs = [
    ['fifo_peek', `SELECT public.fifo_peek(p_product_id => 'p1', p_qty => 2, p_session => $1::jsonb)`, S.sal, S.stk],
    ['fifo_inventory_valuation', `SELECT * FROM public.fifo_inventory_valuation(p_session => $1::jsonb)`, S.sal, S.vw],
    ['fifo_inventory_check', `SELECT public.fifo_inventory_check(p_session => $1::jsonb)`, S.pay, S.vw],
    ['order_cogs', `SELECT public.order_cogs(p_order_id => 'S1', p_session => $1::jsonb)`, S.stk, S.sal],
];
for (const [name, sql, wrong, right] of rpcs) {
    check(`${name}: null session passes while enforcement is off`, await errOf(sql, [null]) === '');
    const w = await errOf(sql, [wrong]);
    check(`${name}: wrong permission refused`, noPerm(w), w);
    check(`${name}: right permission passes`, await errOf(sql, [right]) === '');
    check(`${name}: invalid session refused`, expired(await errOf(sql, [JSON.stringify({ user_id: 'stk', token: 'bad' })])));
}
const viaRpc = await one(`SELECT public.order_cogs('S1', $1::jsonb) AS c`, [S.sal]);
check('order_cogs RPC returns the implementation result (21)', num(viaRpc.c) === 21);
const viaVal = (await q(`SELECT * FROM public.fifo_inventory_valuation($1::jsonb) WHERE product_id = 'p1'`, [S.stk])).rows[0];
check('valuation RPC returns the rows', num(viaVal.qty) === 2);
await q(`UPDATE security_settings SET enforce_sessions = true WHERE id = 1`);
check('enforcement on: null session refused', expired(await errOf(`SELECT public.fifo_inventory_check(NULL)`)));
await q(`UPDATE security_settings SET enforce_sessions = false WHERE id = 1`);
await q(`ALTER FUNCTION wp_internal.fifo_peek(TEXT, NUMERIC) RENAME TO fifo_peek_hidden`);
check('without add_fifo_costing.sql the RPC names the file to run',
    /run migrations\/add_fifo_costing\.sql/.test(await errOf(`SELECT public.fifo_peek('p1', 1, $1::jsonb)`, [S.stk])));
await q(`ALTER FUNCTION wp_internal.fifo_peek_hidden(TEXT, NUMERIC) RENAME TO fifo_peek`);

// ---------------------------------------------------------------------------
// Inert: the existing ship path still runs and fills no FIFO column
// ---------------------------------------------------------------------------
await q(`INSERT INTO products (id, name, price, stock, purchase_cost) VALUES ('p9', 'Lamp', 12, 0, 2)`);
const addErr = await errOf(`SELECT add_product_stock(p_product_id => 'p9', p_quantity => 2, p_cost => 2)`);
check('add_product_stock still works (layers get received_at by default)', addErr === '', addErr);
await q(`INSERT INTO sales (id, total, shipping_status, payment_status) VALUES ('S9', 12, 'Pending', 'Unpaid')`);
await q(`INSERT INTO sale_items (id, sale_id, product_id, name, price, quantity) VALUES ('S9-a', 'S9', 'p9', 'Lamp', 12, 1)`);
const shipErr = await errOf(`SELECT set_order_shipping_status(p_order_id => 'S9', p_expected_status => 'Pending', p_new_status => 'Shipped')`);
check('existing ship path still works', shipErr === '', shipErr);
const s9 = await one(`SELECT (SELECT cogs_cost FROM sale_items WHERE id = 'S9-a') AS cogs,
    (SELECT count(*) FROM inventory_items WHERE sale_id = 'S9' AND consumer_kind IS NULL) AS legacy_sold,
    (SELECT count(*) FROM stock_movements WHERE order_id = 'S9' AND unit_cost IS NOT NULL) AS costed`);
check('inert: ship marks rows the old way, no cogs_cost, no movement unit_cost',
    s9.cogs === null && num(s9.legacy_sold) === 1 && num(s9.costed) === 0, s9);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
