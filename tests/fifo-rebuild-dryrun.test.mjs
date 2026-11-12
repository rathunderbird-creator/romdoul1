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

function run({ products, items, sales = [], saleItems = [], cogs = [], shipAt = {}, receipt = {}, B, basis }) {
    return planStore({
        products, items,
        sales: new Map(sales.map((s) => [s.id, s])),
        saleItems, cogsOrders: new Set(cogs),
        shipAt: new Map(Object.entries(shipAt)),
        receiptCost: new Map(Object.entries(receipt).map(([k, v]) => [k, { cost: v, source: 'restock (last receipt)' }])),
        B, basis: basis ? new Map(Object.entries(basis)) : undefined,
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
    check('basis 9.30 vs a ledger at 9: residual 0.60, D1 -0.60', near(bad.ledger.D1, -0.6) && near(bad.ledger.guard_diff_D1_minus_VminusB, -0.6));
    check('basis override 9: D1 0 and residual 0', near(ok.ledger.D1, 0) && near(ok.ledger.guard_diff_D1_minus_VminusB, 0));
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
