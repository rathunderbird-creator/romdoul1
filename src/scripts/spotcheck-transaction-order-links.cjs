/**
 * Spot-check for backfill-transaction-order-links.cjs — prints detailed
 * side-by-side comparisons for a random sample of resolved matches (plus any
 * suspicious cases) so a human can eyeball them before --commit is run. Uses
 * the exact same matching logic (./lib/matchTransactionOrders.cjs) the
 * backfill script would commit — this is not a separate implementation.
 *
 * Usage:
 *   node src/scripts/spotcheck-transaction-order-links.cjs                     // all instances, 8 samples each
 *   node src/scripts/spotcheck-transaction-order-links.cjs --instance Romdoul2
 *   node src/scripts/spotcheck-transaction-order-links.cjs --n 15
 */
const { createClient } = require('@supabase/supabase-js');
const instances = require('../../migrations/db_instances.json').instances;
const { PAYMENT_CATEGORY, DEPOSIT_CATEGORY, matchTransactionsToSales } = require('./lib/matchTransactionOrders.cjs');

const args = process.argv.slice(2);
const instanceFilter = args.indexOf('--instance') !== -1 ? args[args.indexOf('--instance') + 1] : null;
const sampleSize = args.indexOf('--n') !== -1 ? Number(args[args.indexOf('--n') + 1]) : 8;

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function printMatch({ t, sale, matchedOn }) {
    const name = sale.customer_snapshot?.name || '(no name)';
    const phone = sale.customer_snapshot?.phone || '(no phone)';
    console.log(`  TX ${t.id.slice(0, 8)}  [${t.category === DEPOSIT_CATEGORY ? 'Deposit' : 'Payment'}]  matched on: ${matchedOn}`);
    console.log(`    transaction:  "${t.description}"  $${t.amount}  on ${String(t.date).slice(0, 10)}`);
    console.log(`    order ${sale.id}:  "${name}" (${phone})  total=$${sale.total}  deposit=$${sale.deposit_amount || 0}  received=$${sale.amount_received || 0}`);
    console.log(`      settle_date=${sale.settle_date ? String(sale.settle_date).slice(0, 10) : '—'}  deposit_date=${sale.deposit_date ? String(sale.deposit_date).slice(0, 10) : '—'}  order_date=${String(sale.date).slice(0, 10)}`);
}

async function runInstance(instance) {
    console.log(`\n=== ${instance.name} (${instance.url}) ===`);
    const sb = createClient(instance.url, instance.anonKey);

    const { data: transactions, error: txErr } = await sb
        .from('transactions')
        .select('id, date, category, amount, description, order_id')
        .in('category', [PAYMENT_CATEGORY, DEPOSIT_CATEGORY])
        .is('order_id', null);
    if (txErr) {
        if (/order_id/i.test(txErr.message || '')) { console.log('  SKIPPED — migration not applied yet.'); return; }
        throw txErr;
    }
    const { data: sales, error: salesErr } = await sb
        .from('sales')
        .select('id, total, amount_received, deposit_amount, settle_date, deposit_date, date, customer_snapshot');
    if (salesErr) throw salesErr;

    const { resolvedDeposit, resolvedPayment } = matchTransactionsToSales(transactions, sales);
    const all = [...resolvedDeposit, ...resolvedPayment];
    console.log(`  ${all.length} resolved matches available to sample from (${resolvedDeposit.length} deposit, ${resolvedPayment.length} payment).`);

    // Random sample, biased to include at least a few of each type if both exist.
    const depositSample = shuffle(resolvedDeposit).slice(0, Math.ceil(sampleSize / 3));
    const paymentSample = shuffle(resolvedPayment).slice(0, sampleSize - depositSample.length);
    const sample = shuffle([...depositSample, ...paymentSample]);

    console.log(`\n  --- Random sample (${sample.length}) ---`);
    sample.forEach(printMatch);

    // Aggregate sanity check: does any single order get claimed by more than
    // 2 transactions? (one deposit + one final settle is normal; more than
    // that across resolved matches is worth a human look.)
    const bySale = new Map();
    for (const m of all) {
        if (!bySale.has(m.sale.id)) bySale.set(m.sale.id, []);
        bySale.get(m.sale.id).push(m);
    }
    const overclaimed = [...bySale.entries()].filter(([, ms]) => ms.length > 2);
    if (overclaimed.length) {
        console.log(`\n  --- ${overclaimed.length} order(s) matched by more than 2 transactions (worth a look) ---`);
        overclaimed.slice(0, 5).forEach(([saleId, ms]) => {
            console.log(`  order ${saleId} claimed by ${ms.length} transactions:`);
            ms.forEach(printMatch);
        });
    } else {
        console.log('\n  No order was matched by more than 2 transactions — no over-claiming detected.');
    }
}

async function main() {
    const targetInstances = instanceFilter
        ? instances.filter(i => i.name.toLowerCase() === instanceFilter.toLowerCase())
        : instances;
    for (const instance of targetInstances) {
        await runInstance(instance);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
