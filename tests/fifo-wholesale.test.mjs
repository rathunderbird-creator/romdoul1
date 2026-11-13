// PGlite test of FIFO phase 3 on wholesale orders and stock receipts
// (add_wholesale_procurement_functions.sql wired to add_fifo_costing.sql),
// through the guarded public functions. Every step asserts the FIFO check
// (wp_internal.fifo_inventory_check): 1300 ties to the pool, and the pool
// count to products.stock.
//   * create takes the oldest layers per line (cogs_cost, movement
//     unit_cost) and books WSO-<id>-COGS at their sum, not purchase_cost;
//   * edit with a Draft COGS entry: the lines give their layers back, take
//     them again (same rows), and the entry is re-booked at the new cost;
//   * edit with a POSTED COGS entry: a Draft WSO-<id>-COGS-ADJ-<n> for the
//     difference; cancel then reverses what was posted (WSO-<id>-COGS-REV),
//     and the Draft adjustment goes;
//   * delete with a Posted COGS entry reverses it; with a Draft one, it goes;
//   * an order backfilled by the rebuild (cogs_cost = booked, every unit
//     short): an edit gives the units back as layers at the booked cost and
//     takes them again (no adjustment), a cancel reverses at that cost;
//   * Add Stock and a PO receipt lay layers at the receipt cost, set
//     purchase_cost, and name the receipt (RST- / PO-); PO layers add up to
//     the line value to the cent, and the GRN books exactly that.
// See tests/README.md for how to run it.
import { makeDb, harness } from './fifo-test-db.mjs';

const db = await makeDb();
const { q, one, num, near, check, seedLayers, bookOpening, checkBalanced, entries, done } = harness(db);
const DAY = '2026-11-13';

await q(`INSERT INTO products (id, name, price, stock, purchase_cost) VALUES ('W', 'Speaker', 20, 0, 4), ('V', 'Mic', 30, 0, 9)`);
await seedLayers('W', 4, 5, '2026-01-10T00:00:00Z');
await seedLayers('W', 4, 7, '2026-02-10T00:00:00Z');
await checkBalanced('seeded');

const items = (qty, pid = 'W') => JSON.stringify([{ product_id: pid, product_name: pid, quantity: qty, unit_price: 20 }]);
const create = async qty => (await one(`SELECT public.create_wholesale_order(p_order => $1::jsonb, p_items => $2::jsonb,
    p_created_by => 'tester', p_today => '${DAY}') AS id`, [JSON.stringify({ customer_name: 'Shop', status: 'Open' }), items(qty)])).id;
const update = async (id, qty, pid = 'W') => (await one(`SELECT public.update_wholesale_order(p_id => $1::uuid, p_updates => $2::jsonb,
    p_items => $3::jsonb, p_edited_by => 'tester', p_today => '${DAY}') AS r`,
    [id, JSON.stringify({ customer_name: 'Shop', status: 'Open' }), items(qty, pid)])).r;
const lineOf = async id => one(`SELECT id, cogs_cost, cogs_short_qty FROM wholesale_order_items WHERE wholesale_order_id = $1`, [id]);
const held = async id => (await q(`SELECT id FROM inventory_items WHERE status = 'sold' AND consumer_kind = 'wholesale'
    AND consumer_id = $1 ORDER BY received_at, id`, [id])).rows.map(r => r.id);
const pool = async p => num((await one(`SELECT count(*) AS n FROM inventory_items WHERE product_id = $1 AND status = 'in_stock'`, [p])).n);

// ---------------------------------------------------------------------------
// 1. Create, edit (Draft COGS), edit (Posted COGS), cancel
// ---------------------------------------------------------------------------
const o1 = await create(3);
let l1 = await lineOf(o1);
check('create: the line takes the three oldest layers (15)', near(l1.cogs_cost, 15) && near(l1.cogs_short_qty, 0), l1);
let cogs = await entries(`WSO-${o1}-COGS%`);
check('create: WSO-COGS books the layers (15), not purchase_cost (12)', cogs.length === 1 && near(cogs[0].cogs, 15) && cogs[0].status === 'Draft', cogs);
const mv = await one(`SELECT unit_cost, unit_price FROM stock_movements WHERE reference_id = $1 AND type = 'out'`, [o1]);
check('create: the movement carries the FIFO unit cost next to the selling price', near(mv.unit_cost, 5) && near(mv.unit_price, 20), mv);
await checkBalanced('created');
const firstRows = await held(o1);

const up1 = await update(o1, 5);
l1 = await lineOf(o1);
const rows5 = await held(o1);
check('edit (Draft COGS): 5 units, the first three are the same rows', near(l1.cogs_cost, 27) && rows5.length === 5
    && firstRows.every(r => rows5.includes(r)), { l1, rows5 });
cogs = await entries(`WSO-${o1}-COGS%`);
check('edit (Draft COGS): the entry is re-booked at 27, no adjustment', cogs.length === 1 && cogs[0].ref === `WSO-${o1}-COGS`
    && near(cogs[0].cogs, 27), { cogs, up1 });
await checkBalanced('edited with a Draft COGS entry');

await q(`UPDATE journal_entries SET status = 'Posted' WHERE reference_id = $1`, [`WSO-${o1}-COGS`]);
const up2 = await update(o1, 2);
l1 = await lineOf(o1);
cogs = await entries(`WSO-${o1}-COGS%`);
const adj = cogs.find(e => e.ref === `WSO-${o1}-COGS-ADJ-1`);
check('edit (Posted COGS): 2 units at 10; the Posted 27 stays', near(l1.cogs_cost, 10) && cogs.some(e => e.status === 'Posted' && near(e.cogs, 27)), cogs);
check('edit (Posted COGS): a Draft WSO-COGS-ADJ-1 of -17 (Dr 1300 / Cr 5000), and a notice',
    adj && adj.status === 'Draft' && near(adj.cogs, -17) && near(adj.inv_out, -17) && JSON.stringify(up2.notices).includes('ADJ-1'), { adj, up2 });
await checkBalanced('edited with a Posted COGS entry');

const can = (await one(`SELECT public.set_wholesale_order_status(p_id => $1::uuid, p_status => 'Cancelled') AS r`, [o1])).r;
cogs = await entries(`WSO-${o1}-COGS%`);
check('cancel (Posted COGS): the Draft ADJ goes, a Draft WSO-COGS-REV reverses the posted 27',
    cogs.length === 2 && !cogs.some(e => /-ADJ-/.test(e.ref)) && cogs.some(e => e.ref === `WSO-${o1}-COGS-REV` && near(e.cogs, -27)),
    { cogs, can });
check('cancel: the line holds nothing, the pool has all 8 again', (await lineOf(o1)).cogs_cost === null && await pool('W') === 8);
await checkBalanced('cancelled');
await q(`SELECT public.delete_wholesale_order(p_id => $1::uuid)`, [o1]);
cogs = await entries(`WSO-${o1}-COGS%`);
check('deleting the cancelled order keeps the books at zero (Posted 27, Draft REV 27)',
    cogs.length === 2 && near(cogs.reduce((s, e) => s + num(e.cogs), 0), 0), cogs);
await checkBalanced('cancelled order deleted');

// ---------------------------------------------------------------------------
// 2. Delete with a Posted COGS entry, and with a Draft one
// ---------------------------------------------------------------------------
const o2 = await create(2);
await q(`UPDATE journal_entries SET status = 'Posted' WHERE reference_id = $1`, [`WSO-${o2}-COGS`]);
const d2 = (await one(`SELECT public.delete_wholesale_order(p_id => $1::uuid) AS r`, [o2])).r;
cogs = await entries(`WSO-${o2}-COGS%`);
check('delete (Posted COGS): a Draft WSO-COGS-REV for it, and a notice', cogs.length === 2
    && cogs.some(e => e.ref === `WSO-${o2}-COGS-REV` && near(e.cogs, -10)) && JSON.stringify(d2.notices).includes('REV'), { cogs, d2 });
check('delete: no layer left held by the deleted lines', (await held(o2)).length === 0 && await pool('W') === 8);
await checkBalanced('deleted with a Posted COGS entry');
const o3 = await create(1);
await q(`SELECT public.delete_wholesale_order(p_id => $1::uuid)`, [o3]);
check('delete (Draft COGS): the entry goes, nothing reversed', (await entries(`WSO-${o3}-COGS%`)).length === 0);
await checkBalanced('deleted with a Draft COGS entry');

// ---------------------------------------------------------------------------
// 3. An order backfilled by the rebuild: cogs_cost = booked, all units short
// ---------------------------------------------------------------------------
// It shipped before the pool existed: 3 units of X booked at 12 (Posted),
// stock already without them; the opening balance held them.
await q(`INSERT INTO products (id, name, price, stock, purchase_cost) VALUES ('X', 'Lamp', 9, 0, 3)`);
await seedLayers('X', 2, 6, '2026-03-01T00:00:00Z');
await bookOpening(12);
const ob = (await one(`INSERT INTO wholesale_orders (customer_name, status, total_amount) VALUES ('Old shop', 'Open', 60) RETURNING id`)).id;
await q(`INSERT INTO wholesale_order_items (wholesale_order_id, product_id, product_name, quantity, unit_price, cogs_cost, cogs_short_qty)
         VALUES ($1, 'X', 'Lamp', 3, 20, 12, 3)`, [ob]);
const bje = (await one(`INSERT INTO journal_entries (date, description, reference_id, status) VALUES ('2026-11-01', 'old COGS', $1, 'Posted') RETURNING id`, [`WSO-${ob}-COGS`])).id;
await q(`INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
         SELECT $1, id, CASE WHEN account_code = '5000' THEN 12 ELSE 0 END, CASE WHEN account_code = '1300' THEN 12 ELSE 0 END
           FROM chart_of_accounts WHERE account_code IN ('5000', '1300')`, [bje]);
await checkBalanced('backfilled order in place');
const upb = await update(ob, 3, 'X');
const lb = await lineOf(ob);
const xr = (await q(`SELECT cost_of_purchase, receipt_ref, status FROM inventory_items WHERE product_id = 'X' ORDER BY received_at, id`)).rows;
check('edit a backfilled order: its 3 short units come back as RET- layers at 4.00 (12 / 3), ahead of the pool, and are taken again',
    near(lb.cogs_cost, 12) && near(lb.cogs_short_qty, 0) && xr.filter(r => r.receipt_ref === `RET-${ob}` && near(r.cost_of_purchase, 4) && r.status === 'sold').length === 3, { lb, xr });
check('edit a backfilled order: same cost, so no adjustment', (await entries(`WSO-${ob}-COGS-ADJ%`)).length === 0, upb);
await checkBalanced('backfilled order edited');
await q(`SELECT public.set_wholesale_order_status(p_id => $1::uuid, p_status => 'Cancelled')`, [ob]);
check('cancel a backfilled order: REV at the booked 12, the units in the pool at 4.00',
    (await entries(`WSO-${ob}-COGS-REV`)).some(e => near(e.cogs, -12)) && await pool('X') === 5);
await checkBalanced('backfilled order cancelled');

// ---------------------------------------------------------------------------
// 4. Receipts: Add Stock and a PO
// ---------------------------------------------------------------------------
const rid = '00000000-0000-0000-0000-00000000abcd';
await q(`SELECT public.add_product_stock(p_product_id => 'V', p_quantity => 3, p_cost => 8.5, p_restock_id => $1::uuid)`, [rid]);
await bookOpening(25.5); // Add Stock books no entry; the bill would
const vr = (await q(`SELECT cost_of_purchase, receipt_ref FROM inventory_items WHERE product_id = 'V'`)).rows;
check('Add Stock: 3 layers at 8.50 named RST-<restock id>; purchase_cost becomes 8.50',
    vr.length === 3 && vr.every(r => near(r.cost_of_purchase, 8.5) && r.receipt_ref === `RST-${rid}`)
    && near((await one(`SELECT purchase_cost FROM products WHERE id = 'V'`)).purchase_cost, 8.5), vr);
await checkBalanced('stock added');
await q(`SELECT public.add_product_stock(p_product_id => 'V', p_quantity => 1, p_cost => 0)`);
await bookOpening(8.5);
check('Add Stock at no cost: the last receipt cost (8.50)',
    num((await one(`SELECT count(*) AS n FROM inventory_items WHERE product_id = 'V' AND cost_of_purchase = 8.5`)).n) === 4);
const sup = (await one(`INSERT INTO suppliers (name) VALUES ('Supplier') RETURNING id`)).id;
const po = (await one(`INSERT INTO purchase_orders (supplier_id, order_date, status, total_amount) VALUES ($1, '2026-11-01', 'Ordered', 40) RETURNING id`, [sup])).id;
await q(`INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_price) VALUES ($1, 'V', 4, 10)`, [po]);
await q(`SELECT public.receive_purchase_order(p_po_id => $1::uuid, p_today => '${DAY}')`, [po]);
const pr = (await q(`SELECT cost_of_purchase FROM inventory_items WHERE product_id = 'V' AND receipt_ref = $1`, [`PO-${po}`])).rows;
check('PO receipt: 4 layers at 10.00 named PO-<id>; purchase_cost becomes 10.00', pr.length === 4 && pr.every(r => near(r.cost_of_purchase, 10))
    && near((await one(`SELECT purchase_cost FROM products WHERE id = 'V'`)).purchase_cost, 10), pr);
await checkBalanced('PO received (GRN Dr 1300 at the PO total)');
const o4 = (await one(`SELECT public.create_wholesale_order(p_order => $1::jsonb, p_items => $2::jsonb,
    p_created_by => 'tester', p_today => '${DAY}') AS id`, [JSON.stringify({ customer_name: 'Shop', status: 'Open' }), items(5, 'V')])).id;
check('an order across receipts: the four 8.50 layers, then one at 10.00 (44)', near((await lineOf(o4)).cogs_cost, 44));
await checkBalanced('order across receipts');

// PO unit prices that do not divide into cents: the layers add up to the
// line value, and the GRN entry books exactly that.
await q(`INSERT INTO products (id, name, price, stock, purchase_cost) VALUES ('P8', 'Pin', 1, 0, 0.1), ('P9', 'Clip', 2, 0, 1)`);
const receivePo = async (total, lines) => {
    const id = (await one(`INSERT INTO purchase_orders (supplier_id, order_date, status, total_amount) VALUES ($1, '2026-11-01', 'Ordered', $2) RETURNING id`, [sup, total])).id;
    for (const [pid, qty, price] of lines) {
        await q(`INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)`, [id, pid, qty, price]);
    }
    const r = (await one(`SELECT public.receive_purchase_order(p_po_id => $1::uuid, p_today => '${DAY}') AS r`, [id])).r;
    const layers = await one(`SELECT count(*) AS n, COALESCE(sum(cost_of_purchase), 0) AS v FROM inventory_items WHERE receipt_ref = $1`, [`PO-${id}`]);
    const grn = await entries(`PO-${id}`);
    return { r, layers, grn };
};
const p8 = await receivePo(125, [['P8', 1000, 0.125]]);
check('PO 1000 x 0.125: 1000 layers worth 125.00, GRN Dr 1300 125.00',
    num(p8.layers.n) === 1000 && near(p8.layers.v, 125) && p8.grn.length === 1 && near(-p8.grn[0].inv_out, 125), p8);
await checkBalanced('PO at 0.125');
const p9 = await receivePo(4, [['P9', 2, 1], ['P9', 1, 2]]);
check('PO 2 x 1 + 1 x 2 of one product: 3 layers worth 4.00, GRN 4.00',
    num(p9.layers.n) === 3 && near(p9.layers.v, 4) && near(-p9.grn[0].inv_out, 4), p9);
await checkBalanced('PO with two prices');
const pn = await receivePo(50, [['P9', 2, 5], [null, 4, 10]]);
check('PO with a line whose product is gone: GRN at the stocked value (10.00), a notice names the 50.00 total',
    near(pn.layers.v, 10) && near(-pn.grn[0].inv_out, 10)
    && /total is \$50\.00 but its lines with a product in stock come to \$10\.00/.test(JSON.stringify(pn.r.notices)), pn);
await checkBalanced('PO with a product-less line');

done();
