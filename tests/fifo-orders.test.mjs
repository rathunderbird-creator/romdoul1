// PGlite test of FIFO phase 3 on retail orders: the packs
// (add_order_status_function.sql, add_order_payment_functions.sql) wired to
// the FIFO helpers of add_fifo_costing.sql, called through the guarded
// public functions. Every step asserts the FIFO check
// (wp_internal.fifo_inventory_check): 1300 ties to the pool, and the pool
// count to products.stock.
//   * ship takes the oldest layers per line and freezes their cost
//     (sale_items.cogs_cost, the movement's unit_cost);
//   * ship then settle books the layer cost, not purchase_cost, and records
//     cogs_booked; order_cogs agrees;
//   * unship returns the exact rows; a re-ship takes the same rows, same
//     cost, no adjustment;
//   * settle before ship books a peek, and the later ship posts the Draft
//     ORD-<id>-COGS-ADJ difference; leaving Paid drops it with the receipt;
//   * a deposit-covered order's ORD-<id>-COGS is at FIFO;
//   * restock: a Draft receipt goes with its COGS (no reversal), a Posted
//     one gets a Draft ORD-<id>-COGS-REV;
//   * edit_order_items on a shipped settled order (rows given back, taken
//     again, the difference as an ADJ) and on an unshipped settled one
//     (booked COGS carried to the new lines);
//   * delete_retail_orders gives the rows back, and reverses COGS left in
//     a Posted entry;
//   * a shortfall line, and a pre-FIFO line restocked with no rows, give
//     units back as new layers so the pool keeps up with stock.
// See tests/README.md for how to run it.
import { makeDb, harness } from './fifo-test-db.mjs';

const db = await makeDb();
const { q, one, num, near, check, errOf, seedLayers, checkBalanced, entries, done } = harness(db);
const DAY = '2026-11-13';

await q(`INSERT INTO products (id, name, price, stock, purchase_cost) VALUES
    ('A', 'Speaker', 20, 0, 4), ('B', 'Mic', 30, 0, 8), ('C', 'Cable', 5, 0, 2), ('D', 'Stand', 15, 0, 7)`);
await seedLayers('A', 3, 5, '2026-01-10T00:00:00Z');
await seedLayers('A', 3, 6, '2026-02-10T00:00:00Z');
await seedLayers('B', 3, 10, '2026-01-15T00:00:00Z');
await seedLayers('C', 1, 3, '2026-01-20T00:00:00Z');
await seedLayers('D', 1, 7, '2026-01-25T00:00:00Z');
await checkBalanced('seeded');

const order = async (id, lines, status = 'Pending', total = 50) => {
    await q(`INSERT INTO sales (id, total, shipping_status, payment_status, customer_snapshot)
             VALUES ($1, $2, $3, 'Unpaid', jsonb_build_object('name', 'Cust ' || $1))`, [id, total, status]);
    for (const [lid, pid, qty] of lines) {
        await q(`INSERT INTO sale_items (id, sale_id, product_id, name, price, quantity) VALUES ($1, $2, $3, $3, 10, $4)`, [lid, id, pid, qty]);
    }
};
const ship = (id, from, to) => q(`SELECT public.set_order_shipping_status(p_order_id => $1, p_expected_status => $2, p_new_status => $3,
    p_fields => jsonb_build_object('movement_date', '${DAY}')) AS r`, [id, from, to]);
const pay = async (id, from, updates) => (await one(`SELECT public.set_order_payment(p_order_id => $1, p_expected_status => $2,
    p_updates => $3::jsonb, p_fields => jsonb_build_object('today', '${DAY}')) AS r`, [id, from, JSON.stringify(updates)])).r;
const settle = (id, total = 50) => pay(id, 'Unpaid', { payment_status: 'Paid', amount_received: total, settle_date: DAY, post_to_ledger: true });
const line = async id => one(`SELECT cogs_cost, cogs_short_qty, cogs_booked FROM sale_items WHERE id = $1`, [id]);
const heldRows = async order => (await q(`SELECT id FROM inventory_items WHERE status = 'sold' AND consumer_kind = 'retail'
    AND consumer_id = $1 ORDER BY id`, [order])).rows.map(r => r.id);
const poolCount = async p => num((await one(`SELECT count(*) AS n FROM inventory_items WHERE product_id = $1 AND status = 'in_stock'`, [p])).n);
const txCogs = async order => {
    const r = await one(`SELECT COALESCE(sum(l.debit), 0) AS c FROM transactions t
        JOIN journal_entries e ON e.reference_id = 'TX-' || t.id
        JOIN journal_entry_lines l ON l.journal_entry_id = e.id
        JOIN chart_of_accounts a ON a.id = l.account_id AND a.account_code = '5000'
       WHERE t.order_id = $1`, [order]);
    return num(r.c);
};

// ---------------------------------------------------------------------------
// 1. Ship, settle, unship, re-ship
// ---------------------------------------------------------------------------
await order('O1', [['o1-a', 'A', 2], ['o1-b', 'B', 1]]);
await ship('O1', 'Pending', 'Shipped');
let la = await line('o1-a'), lb = await line('o1-b');
check('ship: A line takes the two oldest layers (5 + 5)', near(la.cogs_cost, 10) && near(la.cogs_short_qty, 0), la);
check('ship: B line takes its oldest layer (10)', near(lb.cogs_cost, 10), lb);
const firstRows = await heldRows('O1');
check('ship: three layers held by the order, linked by line and sale_id', firstRows.length === 3
    && num((await one(`SELECT count(*) AS n FROM inventory_items WHERE sale_id = 'O1' AND consumer_line_id IN ('o1-a', 'o1-b')`)).n) === 3);
const mv = (await q(`SELECT product_id, unit_cost, unit_price FROM stock_movements WHERE reference_id = 'O1' AND type = 'out' ORDER BY product_id`)).rows;
check('ship: movements carry the FIFO unit cost next to the selling price',
    mv.length === 2 && near(mv[0].unit_cost, 5) && near(mv[1].unit_cost, 10) && near(mv[0].unit_price, 10), mv);
check('ship: stock and pool both down', num((await one(`SELECT stock FROM products WHERE id = 'A'`)).stock) === 4 && await poolCount('A') === 4);
let c = await checkBalanced('shipped, unsettled');
check('check: shipped-unbooked = 20', near(c.retail_out_unbooked, 20), c);
check('order_cogs = the frozen cost (20)', near((await one(`SELECT public.order_cogs('O1') AS v`)).v, 20));

await settle('O1');
check('settle: the receipt books COGS at the layers (20), not purchase_cost (16)', near(await txCogs('O1'), 20));
la = await line('o1-a'); lb = await line('o1-b');
check('settle: each line records what it booked', near(la.cogs_booked, 10) && near(lb.cogs_booked, 10), [la, lb]);
await checkBalanced('settled');

await ship('O1', 'Shipped', 'Pending');
check('unship: the order holds no rows; the same rows are back in stock', (await heldRows('O1')).length === 0
    && num((await one(`SELECT count(*) AS n FROM inventory_items WHERE id = ANY($1) AND status = 'in_stock' AND consumer_kind IS NULL AND sale_id IS NULL`, [firstRows])).n) === 3);
la = await line('o1-a');
check('unship: line holds nothing (cogs_cost NULL), booked kept', la.cogs_cost === null && near(la.cogs_booked, 10), la);
c = await checkBalanced('unshipped, settled');
check('check: booked-not-out = 20', near(c.retail_booked_not_out, 20), c);

await ship('O1', 'Pending', 'Shipped');
check('re-ship: the same rows again', JSON.stringify(await heldRows('O1')) === JSON.stringify(firstRows));
check('re-ship: same cost, no adjustment entry', near((await line('o1-a')).cogs_cost, 10) && (await entries('ORD-O1-COGS-ADJ')).length === 0);
await checkBalanced('re-shipped');

// ---------------------------------------------------------------------------
// 2. Settle before ship: peek, then the ADJ on ship; leaving Paid drops it
// ---------------------------------------------------------------------------
// A now: one 5.00 layer, three 6.00.
await order('O2', [['o2-a', 'A', 1]]);
await settle('O2');
check('settle before ship: books a peek of the next layer (5)', near(await txCogs('O2'), 5) && near((await line('o2-a')).cogs_booked, 5));
c = await checkBalanced('settled before ship');
check('check: booked-not-out includes 5', near(c.retail_booked_not_out, 5), c);
await order('O3', [['o3-a', 'A', 1]]);
await ship('O3', 'Pending', 'Shipped');
check('another order ships first and takes that 5.00 layer', near((await line('o3-a')).cogs_cost, 5));
await ship('O2', 'Pending', 'Shipped');
const adj = await entries('ORD-O2-COGS-ADJ');
check('ship after settle: actual 6, booked 5 → one Draft ORD-O2-COGS-ADJ of 1.00 (Dr 5000 / Cr 1300)',
    adj.length === 1 && adj[0].status === 'Draft' && near(adj[0].cogs, 1) && near(adj[0].inv_out, 1) && /-RCP-/.test(adj[0].entry_number), adj);
check('ship after settle: booked becomes the actual cost', near((await line('o2-a')).cogs_booked, 6));
await checkBalanced('ADJ booked');

const unpaid = await pay('O2', 'Paid', { payment_status: 'Unpaid' });
check('leaving Paid: the Draft receipt and its Draft ADJ go, booked cleared',
    (await entries('ORD-O2-COGS-ADJ')).length === 0 && await txCogs('O2') === 0 && (await line('o2-a')).cogs_booked === null, unpaid);
await checkBalanced('left Paid');
await settle('O2');
check('settling again books the frozen 6', near(await txCogs('O2'), 6) && near((await line('o2-a')).cogs_booked, 6));
await checkBalanced('settled again');

// ---------------------------------------------------------------------------
// 3. Deposit-covered order: ORD-<id>-COGS at FIFO
// ---------------------------------------------------------------------------
await order('O4', [['o4-a', 'B', 1]], 'Pending', 30);
await pay('O4', 'Unpaid', { payment_status: 'Deposit', deposit_amount: 30, post_to_ledger: true });
await pay('O4', 'Deposit', { payment_status: 'Paid', settle_date: DAY, post_to_ledger: true });
const oc = await entries('ORD-O4-COGS');
check('deposit-covered: ORD-O4-COGS at the next B layer (10), not purchase_cost (8)', oc.length === 1 && near(oc[0].cogs, 10), oc);
await ship('O4', 'Pending', 'Shipped');
check('deposit-covered then shipped at the same cost: no ADJ', (await entries('ORD-O4-COGS-ADJ')).length === 0);
await checkBalanced('deposit-covered shipped');

// ---------------------------------------------------------------------------
// 4. Restock: Draft receipt (no reversal) and Posted receipt (COGS-REV)
// ---------------------------------------------------------------------------
await ship('O1', 'Shipped', 'Returned');
await ship('O1', 'Returned', 'ReStock');
await checkBalanced('restocked, payment side not yet run (booked, nothing held)');
const side1 = (await one(`SELECT public.apply_restock_payment_side(p_ids => ARRAY['O1'], p_fields => '{}'::jsonb) AS r`)).r;
check('restock with a Draft receipt: receipt deleted with its COGS, no COGS-REV',
    await txCogs('O1') === 0 && (await entries('ORD-O1-COGS-REV')).length === 0 && (await line('o1-a')).cogs_booked === null, side1);
check('restock: the rows are back in stock', num((await one(`SELECT count(*) AS n FROM inventory_items WHERE id = ANY($1) AND status = 'in_stock'`, [firstRows])).n) === 3);
const ret = (await q(`SELECT product_id, unit_cost FROM stock_movements WHERE source = 'Customer Return' ORDER BY product_id`)).rows;
check('restock: Customer Return movements carry the returned cost', ret.length === 2 && near(ret[0].unit_cost, 5) && near(ret[1].unit_cost, 10), ret);
await checkBalanced('restocked (Draft receipt)');

await order('O5', [['o5-a', 'A', 1]]);
await ship('O5', 'Pending', 'Shipped');
const o5cost = num((await line('o5-a')).cogs_cost);
await settle('O5');
await q(`UPDATE journal_entries SET status = 'Posted' WHERE reference_id IN (SELECT 'TX-' || id FROM transactions WHERE order_id = 'O5')`);
await ship('O5', 'Shipped', 'Returned');
await ship('O5', 'Returned', 'ReStock');
const side2 = (await one(`SELECT public.apply_restock_payment_side(p_ids => ARRAY['O5'], p_fields => '{"today": "${DAY}"}'::jsonb) AS r`)).r;
const rev = await entries('ORD-O5-COGS-REV');
check('restock with a Posted receipt: Draft ORD-O5-COGS-REV at the returned cost (Dr 1300 / Cr 5000)',
    rev.length === 1 && rev[0].status === 'Draft' && near(rev[0].cogs, -o5cost) && near(rev[0].inv_out, -o5cost), rev);
check('restock with a Posted receipt: the notices name the reversal', JSON.stringify(side2.notices).includes('COGS-REV'), side2);
await checkBalanced('restocked (Posted receipt)');

// ---------------------------------------------------------------------------
// 5. Editing items
// ---------------------------------------------------------------------------
await order('O6', [['o6-a', 'A', 1]]);
await ship('O6', 'Pending', 'Shipped');
const o6first = num((await line('o6-a')).cogs_cost);
await settle('O6');
const ed = (await one(`SELECT public.edit_order_items(p_order_id => 'O6',
    p_items => '[{"id": "A", "name": "Speaker", "price": 10, "quantity": 2}]'::jsonb, p_fields => '{}'::jsonb) AS r`)).r;
const o6 = (await q(`SELECT id, cogs_cost, cogs_booked FROM sale_items WHERE sale_id = 'O6'`)).rows;
const o6adj = await entries('ORD-O6-COGS-ADJ');
check('edit shipped: the new line holds 2 units and their cost', ed.held === true && o6.length === 1
    && (await heldRows('O6')).length === 2, o6);
check('edit shipped settled: the extra unit\'s cost is booked as an ADJ, booked = cost',
    o6adj.length === 1 && near(o6adj[0].cogs, num(o6[0].cogs_cost) - o6first) && near(o6[0].cogs_booked, o6[0].cogs_cost), { o6, o6adj });
check('edit: no layer is left held by a line that no longer exists',
    num((await one(`SELECT count(*) AS n FROM inventory_items i WHERE i.consumer_kind = 'retail'
        AND NOT EXISTS (SELECT 1 FROM sale_items s WHERE s.id = i.consumer_line_id)`)).n) === 0);
await checkBalanced('edited shipped settled order');

await order('O7', [['o7-a', 'B', 1]]);
await settle('O7');
await q(`SELECT public.edit_order_items(p_order_id => 'O7',
    p_items => '[{"id": "B", "name": "Mic", "price": 10, "quantity": 2}]'::jsonb, p_fields => '{}'::jsonb)`);
const o7 = (await q(`SELECT cogs_cost, cogs_booked FROM sale_items WHERE sale_id = 'O7'`)).rows;
check('edit unshipped settled: booked COGS carried to the new line, nothing taken', o7.length === 1 && o7[0].cogs_cost === null
    && near(o7[0].cogs_booked, 10), o7);
await checkBalanced('edited unshipped settled order');
await ship('O7', 'Pending', 'Shipped');
const o7adj = await entries('ORD-O7-COGS-ADJ');
check('then shipped: the second unit is booked as the ADJ (10)', o7adj.length === 1 && near(o7adj[0].cogs, 10), o7adj);
await checkBalanced('edited order shipped');

// ---------------------------------------------------------------------------
// 6. Deleting orders
// ---------------------------------------------------------------------------
await seedLayers('A', 4, 6.5, '2026-03-01T00:00:00Z');
await order('O8', [['o8-a', 'A', 1]]);
await ship('O8', 'Pending', 'Shipped');
const o8rows = await heldRows('O8');
await q(`SELECT public.delete_retail_orders(p_ids => ARRAY['O8'], p_fields => '{}'::jsonb)`);
check('delete shipped: its row is back in stock', num((await one(`SELECT count(*) AS n FROM inventory_items WHERE id = ANY($1) AND status = 'in_stock'`, [o8rows])).n) === 1);
await checkBalanced('deleted shipped unsettled order');

await order('O9', [['o9-a', 'A', 1]]);
await ship('O9', 'Pending', 'Shipped');
const o9cost = num((await line('o9-a')).cogs_cost);
await settle('O9');
await q(`UPDATE journal_entries SET status = 'Posted' WHERE reference_id IN (SELECT 'TX-' || id FROM transactions WHERE order_id = 'O9')`);
const del9 = (await one(`SELECT public.delete_retail_orders(p_ids => ARRAY['O9'], p_fields => '{"today": "${DAY}"}'::jsonb) AS r`)).r;
const rev9 = await entries('ORD-O9-COGS-REV');
check('delete with a Posted receipt: Draft COGS-REV at what it booked, notice says so',
    rev9.length === 1 && near(rev9[0].cogs, -o9cost) && JSON.stringify(del9.notices).includes('ORD-O9-COGS-REV'), { rev9, del9 });
await checkBalanced('deleted order with a Posted receipt');

await order('O10', [['o10-a', 'B', 1]]);
await settle('O10');
await q(`SELECT public.delete_retail_orders(p_ids => ARRAY['O10'], p_fields => '{}'::jsonb)`);
check('delete unshipped settled (Draft receipt): receipt goes, no reversal', (await entries('ORD-O10-COGS%')).length === 0);
await checkBalanced('deleted unshipped settled order');

// ---------------------------------------------------------------------------
// 7. Units with no row come back as layers
// ---------------------------------------------------------------------------
await order('O11', [['o11-a', 'C', 2]]);
await ship('O11', 'Pending', 'Shipped');
const o11 = await line('o11-a');
check('shortfall: one layer + one unit at the last receipt cost (3 + 3), short 1', near(o11.cogs_cost, 6) && near(o11.cogs_short_qty, 1), o11);
// The short unit was never in the pool or the books: 1300 is 3 short of
// the identity until stock is corrected — the check shows it.
c = await checkBalanced('oversold (shortfall)', -3);
check('check: the shortfall is reported', num(c.shortfall.retail_qty) === 1, c.shortfall);
await ship('O11', 'Shipped', 'Pending');
const ret11 = (await q(`SELECT cost_of_purchase, receipt_ref FROM inventory_items WHERE product_id = 'C' AND status = 'in_stock' ORDER BY received_at, id`)).rows;
check('unship a shortfall line: the short unit comes back as a RET- layer at the cost charged, ahead of the pool',
    ret11.length === 2 && ret11[0].receipt_ref === 'RET-O11' && near(ret11[0].cost_of_purchase, 3), ret11);
await checkBalanced('shortfall given back', -3);

// A line from before the FIFO wiring (no rows: left out of the rebuild),
// Returned, then restocked: its units come back at the last receipt cost.
await order('O12', [['o12-a', 'D', 2]], 'Returned');
await ship('O12', 'Returned', 'ReStock');
const d = (await q(`SELECT cost_of_purchase, receipt_ref FROM inventory_items WHERE product_id = 'D' AND status = 'in_stock' ORDER BY received_at, id`)).rows;
check('pre-FIFO line restocked: 2 RET- layers at the fallback cost (7), pool = stock',
    d.length === 3 && d[0].receipt_ref === 'RET-O12' && near(d[0].cost_of_purchase, 7) && num((await one(`SELECT stock FROM products WHERE id = 'D'`)).stock) === 3, d);
// No COGS was ever booked for it, so Inventory gains 14 the books never
// held (the true-up left such orders out): the check shows it.
await checkBalanced('pre-FIFO order restocked', -3 - 14);

// A pre-FIFO settled order (history: its row stamped by the rebuild, COGS
// booked at purchase_cost 4 in a Draft receipt, cogs_booked NULL) leaves
// Paid: the receipt goes, and the line is adopted at the cost of the row it
// holds (5), as a shipped unsettled order. On a store the rebuild trued
// this order counts 0; adoption moves the check by X - C (4 - 5 = -1.00)
// and settling again at C keeps it — the test's +1 start stands for that 0.
await q(`INSERT INTO products (id, name, price, stock, purchase_cost) VALUES ('E', 'Lamp', 12, 0, 4)`);
await seedLayers('E', 1, 5, '2026-01-05T00:00:00Z');
await order('O13', [['o13-a', 'E', 1]], 'Shipped', 12);
await q(`UPDATE inventory_items SET status = 'sold', sale_id = 'O13', consumer_kind = 'retail', consumer_id = 'O13', consumer_line_id = 'o13-a'
          WHERE product_id = 'E'`);
await q(`UPDATE products SET stock = 0 WHERE id = 'E'`);
await q(`UPDATE sales SET payment_status = 'Paid', amount_received = 12 WHERE id = 'O13'`);
const tx13 = (await one(`INSERT INTO transactions (date, type, category, amount, description, order_id)
    VALUES (now(), 'Income', 'លក់រាយ', 12, 'Cust O13', 'O13') RETURNING id`)).id;
const je13 = (await one(`INSERT INTO journal_entries (description, reference_id, status) VALUES ('old receipt', $1, 'Draft') RETURNING id`, ['TX-' + tx13])).id;
await q(`INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
         SELECT $1, id, CASE account_code WHEN '1000' THEN 12 WHEN '5000' THEN 4 ELSE 0 END,
                        CASE account_code WHEN '4000' THEN 12 WHEN '1300' THEN 4 ELSE 0 END
           FROM chart_of_accounts WHERE account_code IN ('1000', '4000', '5000', '1300')`, [je13]);
await checkBalanced('pre-FIFO settled order (booked at purchase_cost 4, row at 5)', -17 + 1);
await pay('O13', 'Paid', { payment_status: 'Unpaid' });
const l13 = await line('o13-a');
check('pre-FIFO order leaves Paid: the line is adopted at its row\'s cost (5), nothing booked',
    near(l13.cogs_cost, 5) && near(l13.cogs_short_qty, 0) && l13.cogs_booked === null, l13);
await checkBalanced('pre-FIFO order unsettled', -17);
await settle('O13', 12);
check('settled again: books the row cost (5)', near(await txCogs('O13'), 5));
await checkBalanced('pre-FIFO order settled at FIFO', -17);

// ---------------------------------------------------------------------------
// 8. Deleting a restocked order, lines with no product, pre-FIFO edits
// ---------------------------------------------------------------------------
await q(`INSERT INTO products (id, name, price, stock, purchase_cost) VALUES ('F', 'Tripod', 20, 0, 3)`);
await seedLayers('F', 8, 5, '2026-01-07T00:00:00Z');
const V = -17;

// Posted receipt, restocked (Draft REV), then deleted: the REV is booked
// again, the COGS the Posted receipt keeps stays reversed.
await order('R1', [['r1-a', 'F', 1]]);
await ship('R1', 'Pending', 'Shipped');
await settle('R1');
await q(`UPDATE journal_entries SET status = 'Posted' WHERE reference_id IN (SELECT 'TX-' || id FROM transactions WHERE order_id = 'R1')`);
await ship('R1', 'Shipped', 'Returned');
await ship('R1', 'Returned', 'ReStock');
await q(`SELECT public.apply_restock_payment_side(p_ids => ARRAY['R1'], p_fields => '{"today": "${DAY}"}'::jsonb)`);
check('restocked with a Posted receipt: one Draft REV of 5', (await entries('ORD-R1-COGS-REV')).length === 1);
await checkBalanced('restocked R1 (Posted receipt + Draft REV)', V);
const delR1 = (await one(`SELECT public.delete_retail_orders(p_ids => ARRAY['R1'], p_fields => '{"today": "${DAY}"}'::jsonb) AS r`)).r;
const revR1 = await entries('ORD-R1-COGS-REV');
check('delete restocked R1: the Posted receipt\'s COGS is still reversed by one Draft REV of 5, notice says so',
    revR1.length === 1 && revR1[0].status === 'Draft' && near(revR1[0].cogs, -5) && JSON.stringify(delR1.notices).includes('ORD-R1-COGS-REV'),
    { revR1, delR1 });
await checkBalanced('deleted restocked R1', V);

// Deposit-covered (Draft ORD-COGS), shipped, restocked (Draft REV), deleted:
// both entries go and nothing is reversed again.
await order('R2', [['r2-a', 'F', 1]], 'Pending', 20);
await pay('R2', 'Unpaid', { payment_status: 'Deposit', deposit_amount: 20, post_to_ledger: true });
await pay('R2', 'Deposit', { payment_status: 'Paid', settle_date: DAY, post_to_ledger: true });
await ship('R2', 'Pending', 'Shipped');
await ship('R2', 'Shipped', 'Returned');
await ship('R2', 'Returned', 'ReStock');
await q(`SELECT public.apply_restock_payment_side(p_ids => ARRAY['R2'], p_fields => '{"today": "${DAY}"}'::jsonb)`);
check('deposit-covered restocked: Draft ORD-COGS and Draft REV', (await entries('ORD-R2-COGS')).length === 1
    && (await entries('ORD-R2-COGS-REV')).length === 1);
await checkBalanced('restocked R2 (deposit-covered)', V);
await q(`SELECT public.delete_retail_orders(p_ids => ARRAY['R2'], p_fields => '{"today": "${DAY}"}'::jsonb)`);
check('delete deposit-covered restocked R2: no COGS entry left', (await entries('ORD-R2-COGS%')).length === 0);
await checkBalanced('deleted restocked R2', V);

// A line with no product (gift wrap) added to a shipped settled order: the
// booked COGS stays on the product line, no ADJ.
await order('E1', [['e1-a', 'F', 1]]);
await ship('E1', 'Pending', 'Shipped');
await settle('E1');
await q(`SELECT public.edit_order_items(p_order_id => 'E1', p_items => '[{"id": "F", "name": "Tripod", "price": 10, "quantity": 1},
    {"id": "", "name": "Gift wrap", "price": 1, "quantity": 3}]'::jsonb, p_fields => '{}'::jsonb)`);
const e1l = (await q(`SELECT product_id, cogs_cost, cogs_booked FROM sale_items WHERE sale_id = 'E1' ORDER BY product_id NULLS LAST`)).rows;
check('edit adds a no-product line: product line keeps booked 5, the other gets none, no ADJ',
    e1l.length === 2 && near(e1l[0].cogs_booked, 5) && near(e1l[0].cogs_cost, 5) && e1l[1].cogs_booked === null
    && (await entries('ORD-E1-COGS-ADJ')).length === 0, e1l);
await checkBalanced('edited E1 with a no-product line', V);

// Posted receipt, restocked (Draft REV), moved back to Shipped, then
// deleted: the dropped REV is booked again whatever the shipping status.
await order('R3', [['r3-a', 'F', 1]]);
await ship('R3', 'Pending', 'Shipped');
await settle('R3');
await q(`UPDATE journal_entries SET status = 'Posted' WHERE reference_id IN (SELECT 'TX-' || id FROM transactions WHERE order_id = 'R3')`);
await ship('R3', 'Shipped', 'Returned');
await ship('R3', 'Returned', 'ReStock');
await q(`SELECT public.apply_restock_payment_side(p_ids => ARRAY['R3'], p_fields => '{"today": "${DAY}"}'::jsonb)`);
await ship('R3', 'ReStock', 'Shipped');
check('R3 re-shipped after the restock: holds its layer again, nothing booked on the line',
    near((await line('r3-a')).cogs_cost, 5) && (await line('r3-a')).cogs_booked === null && (await entries('ORD-R3-COGS-REV')).length === 1);
await checkBalanced('restocked then re-shipped R3', V);
const delR3 = (await one(`SELECT public.delete_retail_orders(p_ids => ARRAY['R3'], p_fields => '{"today": "${DAY}"}'::jsonb) AS r`)).r;
const revR3 = await entries('ORD-R3-COGS-REV');
check('delete re-shipped R3: the Posted receipt\'s COGS is reversed by one Draft REV of 5, notice says so',
    revR3.length === 1 && revR3[0].status === 'Draft' && near(revR3[0].cogs, -5) && JSON.stringify(delR3.notices).includes('ORD-R3-COGS-REV'),
    { revR3, delR3 });
await checkBalanced('deleted re-shipped R3', V);

// A shipped settled order edited down to a no-product line: its goods go
// back to the pool and the booked COGS is reversed by a Draft REV.
const cogsOf = async o => num((await one(`SELECT COALESCE(sum(l.debit - l.credit), 0) AS c FROM journal_entries e
    JOIN journal_entry_lines l ON l.journal_entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id AND a.account_code = '5000'
   WHERE e.reference_id LIKE 'ORD-' || $1 || '-COGS%'
      OR e.reference_id IN (SELECT 'TX-' || t.id FROM transactions t WHERE t.order_id = $1)`, [o])).c);
const serviceOnly = `'[{"id": "", "name": "Service", "price": 10, "quantity": 1}]'::jsonb`;
await order('E2', [['e2-a', 'F', 1]]);
await ship('E2', 'Pending', 'Shipped');
await settle('E2');
await q(`SELECT public.edit_order_items(p_order_id => 'E2', p_items => ${serviceOnly}, p_fields => '{"movement_date": "${DAY}"}'::jsonb)`);
const e2rev = await entries('ORD-E2-COGS-REV');
const e2l = (await q(`SELECT cogs_cost, cogs_booked FROM sale_items WHERE sale_id = 'E2'`)).rows;
check('edit to no product line: Draft REV of the booked 5, 5000 nets to 0, nothing left booked',
    e2rev.length === 1 && e2rev[0].status === 'Draft' && near(e2rev[0].cogs, -5) && near(await cogsOf('E2'), 0)
    && e2l.length === 1 && e2l[0].cogs_cost === null && e2l[0].cogs_booked === null, { e2rev, e2l });
await checkBalanced('E2 edited to a no-product line', V);
await pay('E2', 'Paid', { payment_status: 'Unpaid' });
check('then leaving Paid: the Draft receipt and its REV both go', (await entries('ORD-E2-COGS%')).length === 0 && await txCogs('E2') === 0);
await checkBalanced('E2 unpaid', V);

// The same with a Posted receipt, then deleted: the REV is booked again.
await order('E3', [['e3-a', 'F', 1]]);
await ship('E3', 'Pending', 'Shipped');
await settle('E3');
await q(`UPDATE journal_entries SET status = 'Posted' WHERE reference_id IN (SELECT 'TX-' || id FROM transactions WHERE order_id = 'E3')`);
await q(`SELECT public.edit_order_items(p_order_id => 'E3', p_items => ${serviceOnly}, p_fields => '{}'::jsonb)`);
check('E3 (Posted receipt) edited to no product line: 5000 nets to 0', near(await cogsOf('E3'), 0) && (await entries('ORD-E3-COGS-REV')).length === 1);
await checkBalanced('E3 edited to a no-product line', V);
await q(`SELECT public.delete_retail_orders(p_ids => ARRAY['E3'], p_fields => '{"today": "${DAY}"}'::jsonb)`);
const e3rev = await entries('ORD-E3-COGS-REV');
check('E3 deleted: one Draft REV of 5 against the Posted receipt', e3rev.length === 1 && e3rev[0].status === 'Draft' && near(e3rev[0].cogs, -5), e3rev);
await checkBalanced('E3 deleted', V);

// A pre-FIFO settled shipped order (its row held, COGS booked at
// purchase_cost 3 in a Posted receipt, cogs_booked NULL). On a trued store
// it counts 0: the hand-made history below starts at V + 2 (5 opened, 3
// booked) and must stay there through edits.
await order('P1', [['p1-a', 'F', 1]], 'Shipped', 20);
await q(`UPDATE inventory_items SET status = 'sold', sale_id = 'P1', consumer_kind = 'retail', consumer_id = 'P1', consumer_line_id = 'p1-a'
          WHERE id = (SELECT id FROM inventory_items WHERE product_id = 'F' AND status = 'in_stock' ORDER BY received_at, id LIMIT 1)`);
await q(`UPDATE products SET stock = stock - 1 WHERE id = 'F'`);
await q(`UPDATE sales SET payment_status = 'Paid', amount_received = 20 WHERE id = 'P1'`);
const txP1 = (await one(`INSERT INTO transactions (date, type, category, amount, description, order_id)
    VALUES (now(), 'Income', 'លក់រាយ', 20, 'Cust P1', 'P1') RETURNING id`)).id;
const jeP1 = (await one(`INSERT INTO journal_entries (description, reference_id, status) VALUES ('old receipt', $1, 'Posted') RETURNING id`, ['TX-' + txP1])).id;
await q(`INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
         SELECT $1, id, CASE account_code WHEN '1000' THEN 20 WHEN '5000' THEN 3 ELSE 0 END,
                        CASE account_code WHEN '4000' THEN 20 WHEN '1300' THEN 3 ELSE 0 END
           FROM chart_of_accounts WHERE account_code IN ('1000', '4000', '5000', '1300')`, [jeP1]);
await checkBalanced('pre-FIFO settled P1', V + 2);
await q(`SELECT public.edit_order_items(p_order_id => 'P1', p_items => '[{"id": "F", "name": "Tripod", "price": 25, "quantity": 1}]'::jsonb,
    p_fields => '{}'::jsonb)`);
const p1 = await one(`SELECT cogs_cost, cogs_booked FROM sale_items WHERE sale_id = 'P1'`);
check('price-only edit of a pre-FIFO settled order: booked = the row cost (5), no ADJ',
    near(p1.cogs_cost, 5) && near(p1.cogs_booked, 5) && (await entries('ORD-P1-COGS-ADJ')).length === 0, p1);
await checkBalanced('pre-FIFO P1 price edit', V + 2);
await q(`SELECT public.edit_order_items(p_order_id => 'P1', p_items => '[{"id": "F", "name": "Tripod", "price": 25, "quantity": 2}]'::jsonb,
    p_fields => '{}'::jsonb)`);
const p1adj = await entries('ORD-P1-COGS-ADJ');
check('quantity edit of it: the extra unit is booked as an ADJ (5)', p1adj.length === 1 && near(p1adj[0].cogs, 5), p1adj);
await checkBalanced('pre-FIFO P1 quantity edit', V + 2);

// Un-shipping an oversold line: the short units come back as RET- layers
// (pool = stock), and the variance stays — 1300 never held them.
await q(`INSERT INTO products (id, name, price, stock, purchase_cost) VALUES ('G', 'Bag', 9, 0, 10)`);
await seedLayers('G', 2, 10, '2026-01-08T00:00:00Z');
await order('S1', [['s1-a', 'G', 4]]);
await ship('S1', 'Pending', 'Shipped');
check('oversold: 40 with 2 short', near((await line('s1-a')).cogs_cost, 40) && near((await line('s1-a')).cogs_short_qty, 2));
await checkBalanced('oversold S1', V + 2 - 20);
await ship('S1', 'Shipped', 'Pending');
check('un-shipped: pool 4 = stock 4', await poolCount('G') === 4
    && num((await one(`SELECT stock FROM products WHERE id = 'G'`)).stock) === 4);
await checkBalanced('un-shipped S1: the shortfall variance stays', V + 2 - 20);

// The packs refuse to load before add_fifo_costing.sql and the rebuild.
check('nothing left without a consumer link while sold',
    num((await one(`SELECT count(*) AS n FROM inventory_items WHERE status = 'sold' AND consumer_kind IS NULL`)).n) === 0);
const e1 = await errOf(`ALTER FUNCTION wp_internal.fifo_give_back_line(TEXT, TEXT, TEXT) RENAME TO fgbl_hidden`);
const { strip, mig } = await import('./fifo-test-db.mjs');
let eLoad = '';
try { await db.exec(strip(mig('add_order_status_function.sql'))); } catch (e) { eLoad = String(e.message); }
check('a pack refuses to load without add_fifo_costing.sql', e1 === '' && /run migrations\/add_fifo_costing\.sql first/i.test(eLoad), eLoad);
await q(`ALTER FUNCTION wp_internal.fgbl_hidden(TEXT, TEXT, TEXT) RENAME TO fifo_give_back_line`);
eLoad = '';
try { await db.exec(strip(mig('add_order_payment_functions.sql'))); } catch (e) { eLoad = String(e.message); }
check('a pack refuses to load on a store with layers but no rebuild', /Rebuild the FIFO pool first/.test(eLoad), eLoad);
await q(`CREATE TABLE inventory_items_bak_20261113 AS SELECT * FROM inventory_items`);
eLoad = '';
try { await db.exec(strip(mig('add_order_payment_functions.sql'))); } catch (e) { eLoad = String(e.message); }
check('... and loads once the rebuild backup exists', eLoad === '', eLoad);

done();
