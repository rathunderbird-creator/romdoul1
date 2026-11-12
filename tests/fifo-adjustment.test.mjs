// PGlite test of FIFO phase 3 on stock adjustments
// (add_stock_adjustment_posting.sql wired to add_fifo_costing.sql), through
// the guarded public functions. Every step asserts the FIFO check
// (wp_internal.fifo_inventory_check): 1300 ties to the pool, and the pool
// count to products.stock.
//   * a removal writes off the oldest layers (consumer 'adjustment', never
//     returned), its line unit_cost and movement become their average, and
//     the ADJ entry equals their cost — whatever cost the draft carried;
//   * an addition becomes layers at its cost, received on the adjustment
//     date; with no cost, at the last receipt cost (the line follows);
//   * a mixed adjustment books the net of both;
//   * removing more than is on hand is still refused, and changes nothing.
// See tests/README.md for how to run it.
import { makeDb, harness } from './fifo-test-db.mjs';

const db = await makeDb();
const { q, one, num, near, check, errOf, seedLayers, checkBalanced, entries, done } = harness(db);

await q(`INSERT INTO products (id, name, price, stock, purchase_cost) VALUES ('X', 'Speaker', 20, 0, 9), ('Y', 'Mic', 15, 0, 4)`);
await seedLayers('X', 2, 3, '2026-01-10T00:00:00Z');
await seedLayers('X', 3, 4, '2026-02-10T00:00:00Z');
await seedLayers('Y', 2, 5, '2026-01-10T00:00:00Z');
await checkBalanced('seeded');

const adjust = async (reason, lines, date = '2026-11-13') => {
    const id = (await one(`INSERT INTO stock_adjustments (reason, adjustment_date) VALUES ($1, $2) RETURNING id`, [reason, date])).id;
    await q(`SELECT public.save_stock_adjustment(p_id => $1::uuid, p_header => $2::jsonb, p_lines => $3::jsonb)`,
        [id, JSON.stringify({ warehouse_id: '', adjustment_date: date, reason }), JSON.stringify(lines)]);
    return id;
};
const post = async id => (await one(`SELECT public.post_stock_adjustment(p_id => $1::uuid, p_created_by => 'tester') AS r`, [id])).r;
const lineOf = async (id, pid) => one(`SELECT id, unit_cost FROM stock_adjustment_lines WHERE adjustment_id = $1 AND product_id = $2`, [id, pid]);

// 1. Removal: the oldest layers, at their cost.
const a1 = await adjust('Damaged', [{ product_id: 'X', quantity: -3, unit_cost: 9 }]);
const r1 = await post(a1);
const l1 = await lineOf(a1, 'X');
const off = (await q(`SELECT cost_of_purchase, consumer_line_id FROM inventory_items WHERE status = 'written_off' ORDER BY received_at, id`)).rows;
check('removal: the three oldest layers are written off to the line (3 + 3 + 4)',
    off.length === 3 && off.reduce((s, r) => s + num(r.cost_of_purchase), 0) === 10 && off.every(r => r.consumer_line_id === l1.id), off);
check('removal: the line unit_cost is their average (3.3333), not the 9 the draft carried', near(l1.unit_cost, 3.3333), l1);
const e1 = await entries(`ADJ-${a1}`);
check('removal: the ADJ entry equals the layers\' cost (Dr 5000 / Cr 1300 10.00)',
    r1.ledger === 'booked' && e1.length === 1 && near(e1[0].cogs, 10) && near(e1[0].inv_out, 10), { r1, e1 });
const m1 = await one(`SELECT unit_cost, unit_price FROM stock_movements WHERE reference_id = $1`, [`ADJ-${a1}`]);
check('removal: the movement carries the FIFO unit cost', near(m1.unit_cost, 3.3333) && near(m1.unit_price, 3.3333), m1);
await checkBalanced('removal posted');

// 2. Addition: layers at its cost, received on the adjustment date.
const a2 = await adjust('Stock correction', [{ product_id: 'X', quantity: 2, unit_cost: 5 }], '2026-11-01');
await post(a2);
const added = (await q(`SELECT cost_of_purchase, receipt_ref, received_at FROM inventory_items WHERE receipt_ref = $1`, [`ADJ-${a2}`])).rows;
check('addition: two layers at 5.00, named ADJ-<id>, received on the adjustment date',
    added.length === 2 && added.every(r => near(r.cost_of_purchase, 5) && new Date(r.received_at).toISOString().startsWith('2026-11-01')), added);
const e2 = await entries(`ADJ-${a2}`);
check('addition: Dr 1300 10.00 (against equity, corrective reason)', e2.length === 1 && near(e2[0].inv_out, -10) && near(e2[0].cogs, 0), e2);
await checkBalanced('addition posted');

// 3. Addition with no cost: the last receipt cost, and the line follows.
const a3 = await adjust('Stock correction', [{ product_id: 'Y', quantity: 1, unit_cost: 0 }], '2026-11-02');
await post(a3);
check('addition at no cost: the last receipt cost (5), written back to the line', near((await lineOf(a3, 'Y')).unit_cost, 5));
check('addition at no cost: booked at 5', near((await entries(`ADJ-${a3}`))[0].inv_out, -5));
await checkBalanced('addition at the fallback cost');

// 4. Mixed: the net of what the layers moved.
// X pool now: 2 x 4.00 (Feb), then the two 5.00 adjustment layers (Nov).
const a4 = await adjust('Damaged', [{ product_id: 'X', quantity: -3, unit_cost: 0 }, { product_id: 'Y', quantity: 2, unit_cost: 6 }]);
await post(a4);
const e4 = await entries(`ADJ-${a4}`);
check('mixed: -13 out of X (4 + 4 + 5), +12 into Y → net 1.00 out of Inventory', e4.length === 1 && near(e4[0].inv_out, 1), e4);
check('mixed: X line at 4.3333', near((await lineOf(a4, 'X')).unit_cost, 4.3333));
await checkBalanced('mixed posted');

// 5. Removing more than is on hand: refused, nothing changes.
const before = JSON.stringify((await q(`SELECT id, status FROM inventory_items ORDER BY id`)).rows);
const a5 = await adjust('Damaged', [{ product_id: 'X', quantity: -5, unit_cost: 0 }]);
const e5 = await errOf(`SELECT public.post_stock_adjustment(p_id => $1::uuid)`, [a5]);
check('removing more than on hand is refused', /Not enough stock to remove/.test(e5), e5);
check('... and no layer moved', JSON.stringify((await q(`SELECT id, status FROM inventory_items ORDER BY id`)).rows) === before);
check('written-off layers never come back to stock', num((await one(`SELECT count(*) AS n FROM inventory_items WHERE status = 'written_off'`)).n) === 6);
await checkBalanced('after the refusal');

done();
