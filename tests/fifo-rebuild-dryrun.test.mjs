// Unit test of the planner in src/scripts/fifo-rebuild-dryrun.cjs (planStore)
// — the read-only FIFO pool rebuild plan. Synthetic data, no database; see
// tests/README.md.
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { planStore } = require('../src/scripts/fifo-rebuild-dryrun.cjs');

let pass = 0, fail = 0;
const check = (l, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l); };
const near = (a, b) => Math.abs(a - b) < 0.005;

const ts = (day, sec = 0) => `2026-10-${String(day).padStart(2, '0')}T00:00:${String(sec).padStart(2, '0')}+00:00`;
let seq = 0;
const row = (product_id, cost, day, status = 'in_stock', sale_id = null) =>
    ({ id: `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`, product_id, cost_of_purchase: cost, status, sale_id, created_at: ts(day) });

function run({ products, items, sales = [], saleItems = [], cogs = [], booked = {}, shipAt = {}, receipt = {}, B, basis, uStatuses, uFrom, basisSales }) {
    return planStore({
        products, items,
        sales: new Map(sales.map((s) => [s.id, s])),
        saleItems, cogsOrders: new Set(cogs), cogsBooked: new Map(Object.entries(booked)),
        shipAt: new Map(Object.entries(shipAt)),
        receiptCost: new Map(Object.entries(receipt).map(([k, v]) => [k, { cost: v, source: 'restock (last receipt)' }])),
        B, basis: basis ? new Map(Object.entries(basis)) : undefined,
        uStatuses: uStatuses ? new Set(uStatuses) : undefined, uFrom, basisSales,
    });
}
const byAction = (plan, pid, re) => plan.rowPlan.filter((r) => r.product_id === pid && re.test(r.action));

// 1. Pool larger than stock: the newest S rows stay, the rest are written off.
{
    const items = [row('A', 10, 1), row('A', 10, 2), row('A', 12, 3), row('A', 12, 4), row('A', 13, 5)];
    const p = run({ products: [{ id: 'A', name: 'A', stock: 2, purchase_cost: 10 }], items, B: 20 });
    const kept = byAction(p, 'A', /^keep in_stock/).map((r) => r.row_id);
    check('pool > stock: newest 2 rows kept in_stock', kept.length === 2 && kept.includes(items[4].id) && kept.includes(items[3].id));
    check('pool > stock: 3 surplus rows written off', p.totals.wo_surplus_in_stock === 3);
    check('pool > stock: V = 13 + 12', near(p.ledger.V, 25));
    check('pool > stock: D1 = 25 - 2x10 and the guard passes against B=20', near(p.ledger.D1, 5) && p.ledger.guard_pass);
}

// 2. Pool smaller than stock / no rows: fillers at the last receipt cost,
//    older than every kept row.
{
    const items = [row('A', 8, 5)];
    const p = run({ products: [{ id: 'A', name: 'A', stock: 3, purchase_cost: 9 }, { id: 'Z', name: 'Z', stock: 2, purchase_cost: 4 }], items, receipt: { A: 7.5 }, B: 35 });
    const a = p.productRows.find((r) => r.product_id === 'A');
    const z = p.productRows.find((r) => r.product_id === 'Z');
    check('pool < stock: 1 kept + 2 fillers at the restock cost', a.kept_in_stock === 1 && a.filler_in_stock === 2 && a.filler_cost === 7.5);
    check('no rows: 2 fillers at purchase_cost', z.filler_in_stock === 2 && z.filler_cost === 4 && near(z.value_in_stock, 8));
    check('pool < stock: value 8 + 2x7.5', near(a.value_in_stock, 23));
    check('pool < stock: D1 = (23-27) + (8-8)', near(p.ledger.D1, -4));
    check('guard: V-B = 31-35 = -4 = D1 -> PASS', near(p.ledger.V_minus_B, -4) && p.ledger.guard_pass);
}

// 3. Zero-cost rows are re-costed to the newest priced row's cost.
{
    const items = [row('A', 6, 1, 'sold', 'old'), row('A', 0, 2), row('A', 0, 3)];
    const p = run({ products: [{ id: 'A', name: 'A', stock: 2, purchase_cost: 5 }], items,
        sales: [{ id: 'old', shipping_status: 'Delivered', payment_status: 'Paid', date: ts(1) }], B: 10 });
    const a = p.productRows[0];
    check('cost-0 rows: both kept rows re-costed to 6 (newest priced row)', a.recosted_zero_rows === 2 && a.recost_cost === 6 && near(a.value_in_stock, 12));
    check('cost-0 rows: settled history row stays sold', a.history_sold === 1);
}

// 4. Sold rows on Pending / ReStock orders and null sale_id are written off;
//    rows of settled or COGS-booked holding orders stay as history.
{
    const items = [
        row('A', 5, 1, 'sold', 'pend'), row('A', 5, 1, 'sold', 'rst'), row('A', 5, 1, 'sold', null),
        row('A', 5, 1, 'sold', 'paid'), row('A', 5, 1, 'sold', 'booked'), row('A', 5, 9),
    ];
    const sales = [
        { id: 'pend', shipping_status: 'Pending', payment_status: 'Unpaid', date: ts(1) },
        { id: 'rst', shipping_status: 'ReStock', payment_status: 'Unpaid', date: ts(1) },
        { id: 'paid', shipping_status: 'Delivered', payment_status: 'Paid', date: ts(1) },
        { id: 'booked', shipping_status: 'Delivered', payment_status: 'Unpaid', date: ts(1) },
    ];
    const p = run({ products: [{ id: 'A', name: 'A', stock: 1, purchase_cost: 5 }], items, sales, cogs: ['booked'], B: 5 });
    const a = p.productRows[0];
    check('Pending + ReStock sold rows written off', a.wo_sold_not_holding === 2);
    check('null-sale sold row written off', a.wo_sold_null_sale === 1);
    check('settled and COGS-booked rows kept as history', a.history_sold === 2);
    check('booked unpaid order is not in U', a.U === 0);
}

// 5. Unsettled shipped orders take the next-newest rows; the oldest-shipped
//    line gets the oldest of them; fractional qty is costed as shortfall.
{
    const items = [row('A', 1, 1), row('A', 2, 2), row('A', 3, 3), row('A', 4, 4), row('A', 5, 5), row('A', 6, 6)];
    const sales = [
        { id: 'o1', shipping_status: 'Shipped', payment_status: 'Unpaid', date: ts(1) },
        { id: 'o2', shipping_status: 'Returned', payment_status: 'Unpaid', date: ts(1) },
        { id: 'o3', shipping_status: 'Delivered', payment_status: 'Paid', date: ts(1) },
    ];
    const saleItems = [
        { id: 'l2', sale_id: 'o2', product_id: 'A', quantity: 1.5 },
        { id: 'l1', sale_id: 'o1', product_id: 'A', quantity: 2 },
        { id: 'l3', sale_id: 'o3', product_id: 'A', quantity: 9 },
    ];
    const p = run({ products: [{ id: 'A', name: 'A', stock: 2, purchase_cost: 4 }], items, sales, saleItems,
        shipAt: { o1: ts(7, 1), o2: ts(7, 2) }, B: 4 * (2 + 3.5) });
    const l1 = p.linePlan.find((l) => l.line_id === 'l1');
    const l2 = p.linePlan.find((l) => l.line_id === 'l2');
    check('U = 2 + floor(1.5), settled order excluded', p.totals.U === 3 && p.linePlan.length === 2);
    check('in_stock = newest 2 (6 + 5)', near(p.ledger.V_in_stock, 11));
    check('oldest-shipped line l1 gets the oldest of the U slice (2 + 3)', near(l1.cogs_cost, 5));
    check('l2 gets the next (4) plus 0.5 short at the fallback (6)', near(l2.cogs_cost, 7) && l2.cogs_short_qty === 0.5);
    check('older rows written off', p.productRows[0].written_off === 1);
    check('D1 = 23 - 4x5.5', near(p.ledger.D1, 1) && p.ledger.guard_pass);
}

// 6. The guard fails when the ledger was built on another basis, and a
//    --basis override restores it.
{
    const items = [row('A', 9, 1), row('A', 9, 2)];
    const products = [{ id: 'A', name: 'A', stock: 2, purchase_cost: 9.3 }];
    const p = run({ products, items, B: 16 });
    check('guard fails when basis x units differs from B by more than $1', !p.ledger.guard_pass);
    const ok = run({ products, items, B: 18, basis: { A: 9 } });
    const bad = run({ products, items, B: 18 });
    check('basis 9.30 vs a ledger at 9: residual 0.60, D1 -0.60', near(bad.ledger.D1, -0.6) && near(bad.ledger.guard_diff, -0.6));
    check('basis override 9: D1 0 and residual 0', near(ok.ledger.D1, 0) && near(ok.ledger.guard_diff, 0));
}

// 7. Every plan ends with pool count = stock and assigned = U per line.
{
    const items = [row('A', 3, 1), row('A', 3, 2, 'sold', 'x')];
    const sales = [{ id: 'x', shipping_status: 'Shipped', payment_status: 'Unpaid', date: ts(1) }];
    const p = run({ products: [{ id: 'A', name: 'A', stock: 4, purchase_cost: 3 }], items, sales,
        saleItems: [{ id: 'lx', sale_id: 'x', product_id: 'A', quantity: 3 }], B: 21 });
    const inStock = p.rowPlan.filter((r) => r.new_status === 'in_stock').length;
    const assigned = p.rowPlan.filter((r) => r.consumer_line_id === 'lx').length;
    check('pool count after = stock (4)', inStock === 4);
    check('assigned units = U for the line (3)', assigned === 3);
}

// 8. COGS booked for an order whose goods are still on hand (SU): 1300 was
//    credited for units that are inside S, so the guard expects B = basis x
//    (S+U) - SU. Orders with no line or a 0 amount are left out.
{
    const items = [row('A', 5, 1), row('A', 5, 2), row('A', 5, 3)];
    const sales = [
        { id: 'rs', shipping_status: 'ReStock', payment_status: 'Paid', date: ts(1) },
        { id: 'pn', shipping_status: 'Pending', payment_status: 'Unpaid', date: ts(1) },
        { id: 'zero', shipping_status: 'Pending', payment_status: 'Paid', date: ts(1) },
        { id: 'nolines', shipping_status: 'Pending', payment_status: 'Paid', date: ts(1) },
        { id: 'shp', shipping_status: 'Shipped', payment_status: 'Paid', date: ts(1) },
    ];
    const saleItems = [
        { id: 'l1', sale_id: 'rs', product_id: 'A', quantity: 1 },
        { id: 'l2', sale_id: 'pn', product_id: null, quantity: 1 },
        { id: 'l3', sale_id: 'zero', product_id: 'A', quantity: 1 },
        { id: 'l4', sale_id: 'shp', product_id: 'A', quantity: 1 },
    ];
    const args = { products: [{ id: 'A', name: 'A', stock: 3, purchase_cost: 5 }], items, sales, saleItems,
        cogs: ['rs', 'pn', 'zero', 'nolines', 'shp'], booked: { rs: 5, pn: 2.5, zero: 0.001, nolines: 4, shp: 5 } };
    const p = run({ ...args, B: 15 - 7.5 });
    check('SU = 5 + 2.5 (holding, ~0 and line-less orders left out)', near(p.ledger.settled_unshipped_booked, 7.5)
        && JSON.stringify(p.settled_unshipped.map((o) => o.order_id)) === '["pn","rs"]');
    check('SU: expected B = 15 - 7.5 and the guard passes', near(p.ledger.expected_B, 7.5) && near(p.ledger.guard_diff, 0) && p.ledger.guard_pass);
    const without = run({ ...args, B: 15 });
    check('SU: a ledger that never booked it fails the guard by SU', near(without.ledger.guard_diff, 7.5) && !without.ledger.guard_pass);
}

// 9. Orders left out of U are listed by id.
{
    const sales = [
        { id: 'ret', shipping_status: 'Returned', payment_status: 'Unpaid', date: ts(25) },
        { id: 'old', shipping_status: 'Delivered', payment_status: 'Unpaid', date: ts(5) },
        { id: 'ok', shipping_status: 'Shipped', payment_status: 'Unpaid', date: ts(25) },
    ];
    const saleItems = [
        { id: 'a', sale_id: 'ret', product_id: 'A', quantity: 1 },
        { id: 'b', sale_id: 'old', product_id: 'A', quantity: 2 },
        { id: 'c', sale_id: 'ok', product_id: 'A', quantity: 1 },
        { id: 'd', sale_id: 'old', product_id: 'gone', quantity: 1 },
    ];
    const p = run({ products: [{ id: 'A', name: 'A', stock: 0, purchase_cost: 3 }], items: [], sales, saleItems, B: 3,
        uStatuses: ['Shipped', 'Delivered'], uFrom: '2026-10-21T00:00:00+07:00' });
    const X = p.excluded_from_u;
    check('excluded: Returned by status, the old order before the cutoff, with ids',
        JSON.stringify(X.by_status.order_ids) === '["ret"]' && JSON.stringify(X.before_u_from.order_ids) === '["old"]'
        && X.before_u_from.qty === 2 && near(X.before_u_from.basis_value, 6) && p.totals.U === 1);
}

// 10. E: NR-3026 at a 9.00 basis, purchase_cost 9.30. The true-up put
//     12 + 2 units in 1300 at 9.00 (126); 12 sales after it booked 9.30 each
//     (Cr 1300 111.60). Left: stock 2 at 9.30. Without E the guard is off
//     by -3.60 (Romdoul1 on 2026-11-13); with E = 12 x 0.30 it passes, and
//     the REVAL books D1 + E = 0.60 + 3.60 = V - B.
{
    const products = [{ id: 'N', name: 'NR-3026', stock: 2, purchase_cost: 9.3 }];
    const items = [row('N', 9.3, 1), row('N', 9.3, 2)];
    const sales = [], saleItems = [], subjects = [];
    for (let i = 1; i <= 12; i++) {
        sales.push({ id: `o${i}`, shipping_status: 'Delivered', payment_status: 'Paid', date: ts(20) });
        saleItems.push({ id: `l${i}`, sale_id: `o${i}`, product_id: 'N', quantity: 1 });
        subjects.push({ kind: 'retail', id: `o${i}`, c_pre: 0, c_post: 9.3, refs: [`TX-${i}`], lines: [{ product_id: 'N', q: 1 }] });
    }
    const base = { products, items, sales, saleItems, cogs: sales.map((s) => s.id), B: 126 - 111.6, basis: { N: 9 } };
    const bs = { basis_ref: 'TRUEUP-20261112', cutoff: '2026-11-12T14:51:05.206569+00:00', subjects };
    const off = run(base);
    check('E: without the basis entry the guard fails by -3.60', near(off.ledger.guard_diff, -3.6) && !off.ledger.guard_pass && off.ledger.E === 0);
    const p = run({ ...base, basisSales: bs });
    check('E: 12 sales at 9.30 against 9.00 -> E 3.60, guard 0, PASS', near(p.ledger.E, 3.6) && near(p.ledger.guard_diff, 0) && p.ledger.guard_pass);
    check('E: D1 stays V - basis value (0.60); REVAL = D1 + E = V - B (4.20)',
        near(p.ledger.D1, 0.6) && near(p.ledger.reval_amount, 4.2) && near(p.ledger.reval_amount, p.ledger.V - p.ledger.B));
    check('E: the per-order list carries each order at 0.30', p.basis_sales.subjects.length === 12 && p.basis_sales.subjects.every((x) => near(x.E, 0.3) && x.note === 'settled after the cutoff'));
    // Reversed after the cutoff (settled before it): the unit came back to S
    // at 9.00 but 1300 got 9.30 -> E -0.30. Held throughout and re-settled
    // at a new cost (REV 9.00, COGS 9.30) -> E 0.30. Settled and reversed
    // after the cutoff -> 0. A product that is not overridden adds nothing.
    const more = [
        { kind: 'retail', id: 'rev', c_pre: 9.3, c_post: -9.3, refs: ['ORD-rev-COGS-REV'], lines: [{ product_id: 'N', q: 1 }] },
        { kind: 'retail', id: 'held', c_pre: 9, c_post: 0.3, refs: ['ORD-held-COGS', 'ORD-held-COGS-REV'], lines: [{ product_id: 'N', q: 1 }] },
        { kind: 'retail', id: 'zero', c_pre: 0, c_post: 0, refs: ['ORD-zero-COGS-REV', 'TX-z'], lines: [{ product_id: 'N', q: 1 }] },
        { kind: 'retail', id: 'plain', c_pre: 0, c_post: 4, refs: ['TX-p'], lines: [{ product_id: 'X', q: 1 }] },
    ];
    const q = run({ ...base, products: [...products, { id: 'X', name: 'X', stock: 0, purchase_cost: 4 }], basisSales: { ...bs, subjects: [...subjects, ...more] } });
    const by = new Map(q.basis_sales.subjects.map((x) => [x.id, x]));
    check('E: reversed after the cutoff -0.30, held and re-costed +0.30, settled and reversed 0, not overridden left out',
        near(by.get('rev').E, -0.3) && by.get('rev').note === 'reversed after the cutoff'
        && near(by.get('held').E, 0.3) && near(by.get('zero').E, 0) && !by.has('plain') && near(q.ledger.E, 3.6));
    // An unexplained 1300 credit still fails.
    const bad = run({ ...base, B: base.B - 2, basisSales: bs });
    check('E: an unexplained 2.00 out of 1300 still fails the guard (-2.00)', near(bad.ledger.guard_diff, -2) && !bad.ledger.guard_pass);
    // An order in SU adds nothing (SU already counts its booked amount).
    const su = run({ ...base, sales: [...sales, { id: 'su', shipping_status: 'ReStock', payment_status: 'Paid', date: ts(20) }],
        saleItems: [...saleItems, { id: 'lsu', sale_id: 'su', product_id: 'N', quantity: 1 }],
        cogs: [...base.cogs, 'su'], booked: { su: 9.3 }, B: base.B - 9.3,
        basisSales: { ...bs, subjects: [...subjects, { kind: 'retail', id: 'su', c_pre: 0, c_post: 9.3, refs: ['TX-su'], lines: [{ product_id: 'N', q: 1 }] }] } });
    check('E: an order in SU adds 0 to E and the guard still passes', near(su.ledger.E, 3.6) && near(su.ledger.settled_unshipped_booked, 9.3) && su.ledger.guard_pass);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
