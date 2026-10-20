/**
 * Sizes the duplicate-income pattern discovered while spot-checking the
 * order_id backfill: multiple 'Payment'-category (លក់រាយ) transactions
 * linked to the same order, whose combined amount exceeds what the order
 * itself says it actually received. This is read-only — it only reports,
 * never writes.
 *
 * Requires the backfill (backfill-transaction-order-links.cjs --commit) to
 * have run first, so transactions.order_id is populated — this groups by
 * that real link rather than re-deriving a fuzzy match, which is far more
 * reliable for sizing the problem precisely.
 *
 * Usage:
 *   node src/scripts/investigate-duplicate-income.cjs
 *   node src/scripts/investigate-duplicate-income.cjs --instance Romdoul2
 */
const { createClient } = require('@supabase/supabase-js');
const instances = require('../../migrations/db_instances.json').instances;

const PAYMENT_CATEGORY = 'លក់រាយ';

const args = process.argv.slice(2);
const instanceFilter = args.indexOf('--instance') !== -1 ? args[args.indexOf('--instance') + 1] : null;

function amountsClose(a, b, tolerance = 0.01) {
    return Math.abs(Number(a || 0) - Number(b || 0)) <= tolerance;
}

async function runInstance(instance) {
    console.log(`\n=== ${instance.name} (${instance.url}) ===`);
    const sb = createClient(instance.url, instance.anonKey);

    const { data: transactions, error: txErr } = await sb
        .from('transactions')
        .select('id, date, created_at, amount, description, added_by, order_id')
        .eq('category', PAYMENT_CATEGORY)
        .not('order_id', 'is', null);
    if (txErr) {
        if (/order_id/i.test(txErr.message || '')) { console.log('  SKIPPED — order_id column not present yet.'); return; }
        throw txErr;
    }

    const byOrder = new Map();
    for (const t of transactions) {
        if (!byOrder.has(t.order_id)) byOrder.set(t.order_id, []);
        byOrder.get(t.order_id).push(t);
    }
    const multi = [...byOrder.entries()].filter(([, ts]) => ts.length > 1);
    console.log(`  Orders with more than one linked Payment transaction: ${multi.length} (out of ${byOrder.size} linked orders)`);

    if (multi.length === 0) return { instance: instance.name, affectedOrders: 0, overbookedOrders: 0, phantomTotal: 0 };

    const orderIds = multi.map(([id]) => id);
    const { data: sales, error: salesErr } = await sb
        .from('sales')
        .select('id, total, amount_received, deposit_amount, customer_snapshot')
        .in('id', orderIds);
    if (salesErr) throw salesErr;
    const saleById = new Map(sales.map(s => [s.id, s]));

    let overbookedOrders = 0;
    let phantomTotal = 0;
    const examples = [];

    for (const [orderId, ts] of multi) {
        const sale = saleById.get(orderId);
        if (!sale) continue;
        const sum = ts.reduce((acc, t) => acc + Number(t.amount || 0), 0);
        // What the order itself says it actually received for the non-deposit
        // portion — the ground truth a correct single Payment row should sum to.
        const expected = Math.max(0, Number(sale.total || 0) - Number(sale.deposit_amount || 0));
        if (sum > expected + 0.01 && !amountsClose(sum, expected)) {
            overbookedOrders++;
            const phantom = sum - expected;
            phantomTotal += phantom;
            examples.push({ orderId, name: sale.customer_snapshot?.name, count: ts.length, sum, expected, phantom, ts });
        }
    }

    console.log(`  Orders where logged Payment total EXCEEDS what the order says it received: ${overbookedOrders}`);
    console.log(`  Total phantom (likely duplicate) income across those: $${phantomTotal.toFixed(2)}`);

    examples.sort((a, b) => b.phantom - a.phantom);
    if (examples.length) {
        console.log(`  Top ${Math.min(5, examples.length)} by phantom amount:`);
        examples.slice(0, 5).forEach(e => {
            console.log(`    order ${e.orderId}  "${e.name}"  ${e.count} rows sum $${e.sum.toFixed(2)} vs expected $${e.expected.toFixed(2)}  (+$${e.phantom.toFixed(2)})`);
            e.ts.forEach(t => console.log(`      ${t.id.slice(0, 8)}  $${t.amount}  created ${t.created_at}  by ${t.added_by || '—'}`));
        });
    }

    return { instance: instance.name, affectedOrders: multi.length, overbookedOrders, phantomTotal };
}

async function main() {
    const targetInstances = instanceFilter
        ? instances.filter(i => i.name.toLowerCase() === instanceFilter.toLowerCase())
        : instances;

    const results = [];
    for (const instance of targetInstances) {
        results.push(await runInstance(instance));
    }

    console.log('\n=== Summary ===');
    let grandTotal = 0;
    for (const r of results) {
        if (!r) continue;
        console.log(`${r.instance}: ${r.overbookedOrders} orders over-booked, ~$${r.phantomTotal.toFixed(2)} phantom income`);
        grandTotal += r.phantomTotal;
    }
    console.log(`Grand total phantom income across all instances: ~$${grandTotal.toFixed(2)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
