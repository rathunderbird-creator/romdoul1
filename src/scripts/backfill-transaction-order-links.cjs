/**
 * One-time backfill: tries to recover `order_id` / `customer_phone` on retail
 * payment/deposit `transactions` rows that predate migrations/add_transaction_order_link.sql,
 * so the Customer Payment page's "View" button works on older records too.
 *
 * Matching strategy lives in ./lib/matchTransactionOrders.cjs (shared with
 * spotcheck-transaction-order-links.cjs so a spot-check verifies the exact
 * same resolution this script would commit — see that file for the rules).
 *
 * Runs against every instance listed in migrations/db_instances.json (same
 * convention as migrations/sync_database.cjs), skipping any instance that
 * hasn't run add_transaction_order_link.sql yet rather than failing the
 * whole run.
 *
 * Usage:
 *   node src/scripts/backfill-transaction-order-links.cjs                     // dry run, all instances
 *   node src/scripts/backfill-transaction-order-links.cjs --commit            // write, all instances
 *   node src/scripts/backfill-transaction-order-links.cjs --instance Romdoul2 // one instance only
 */
const { createClient } = require('@supabase/supabase-js');
const instances = require('../../migrations/db_instances.json').instances;
const { PAYMENT_CATEGORY, DEPOSIT_CATEGORY, matchTransactionsToSales } = require('./lib/matchTransactionOrders.cjs');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const instanceFilter = args.indexOf('--instance') !== -1 ? args[args.indexOf('--instance') + 1] : null;

async function runInstance(instance) {
    console.log(`\n=== ${instance.name} (${instance.url}) ===`);
    const sb = createClient(instance.url, instance.anonKey);

    const { data: transactions, error: txErr } = await sb
        .from('transactions')
        .select('id, date, category, amount, description, order_id')
        .in('category', [PAYMENT_CATEGORY, DEPOSIT_CATEGORY])
        .is('order_id', null);
    if (txErr) {
        if (/order_id/i.test(txErr.message || '')) {
            console.log('  SKIPPED — order_id column not present yet. Run migrations/add_transaction_order_link.sql on this instance first.');
            return { instance: instance.name, skipped: true };
        }
        throw txErr;
    }

    const { data: sales, error: salesErr } = await sb
        .from('sales')
        .select('id, total, amount_received, deposit_amount, settle_date, deposit_date, date, customer_snapshot');
    if (salesErr) throw salesErr;

    console.log(`  Transactions needing a link: ${transactions.length}`);
    console.log(`  Sales available to match against: ${sales.length}`);

    const { resolvedDeposit, resolvedPayment, unresolved } = matchTransactionsToSales(transactions, sales);

    console.log(`  Resolved via #DEP- marker (deposits): ${resolvedDeposit.length}`);
    console.log(`  Resolved via name + date (+ amount) (payments): ${resolvedPayment.length}`);
    console.log(`  Left unresolved: ${unresolved.length}`);

    const sample = (arr, n = 5) => arr.slice(0, n).map(({ t, sale }) => `    ${t.id.slice(0, 8)}  "${t.description}"  $${t.amount}  ->  order ${sale.id}`);
    if (resolvedDeposit.length) { console.log('  Sample deposit matches:'); sample(resolvedDeposit).forEach(l => console.log(l)); }
    if (resolvedPayment.length) { console.log('  Sample payment matches:'); sample(resolvedPayment).forEach(l => console.log(l)); }
    if (unresolved.length) {
        console.log('  Sample unresolved (left untouched):');
        unresolved.slice(0, 5).forEach(({ t, reason }) => console.log(`    ${t.id.slice(0, 8)}  "${t.description}"  $${t.amount}  — ${reason}`));
    }

    const toWrite = [...resolvedDeposit, ...resolvedPayment];
    if (!COMMIT) {
        console.log(`  DRY RUN — ${toWrite.length} row(s) would be updated. Re-run with --commit to write.`);
        return { instance: instance.name, skipped: false, resolved: toWrite.length, unresolved: unresolved.length };
    }

    console.log(`  Committing ${toWrite.length} update(s)...`);
    let ok = 0, failed = 0;
    for (const { t, sale } of toWrite) {
        const phone = sale.customer_snapshot?.phone || null;
        const { error } = await sb.from('transactions').update({ order_id: sale.id, customer_phone: phone }).eq('id', t.id);
        if (error) { failed++; console.error(`    FAILED ${t.id}: ${error.message}`); }
        else ok++;
    }
    console.log(`  Done. ${ok} updated, ${failed} failed.`);
    return { instance: instance.name, skipped: false, updated: ok, failed };
}

async function main() {
    console.log(`Mode: ${COMMIT ? 'COMMIT (will write)' : 'DRY RUN (report only, pass --commit to write)'}`);

    const targetInstances = instanceFilter
        ? instances.filter(i => i.name.toLowerCase() === instanceFilter.toLowerCase())
        : instances;

    if (targetInstances.length === 0) {
        console.error(`Instance "${instanceFilter}" not found. Available: ${instances.map(i => i.name).join(', ')}`);
        process.exit(1);
    }

    const results = [];
    for (const instance of targetInstances) {
        try {
            results.push(await runInstance(instance));
        } catch (err) {
            console.error(`  ERROR on ${instance.name}: ${err.message}`);
            results.push({ instance: instance.name, error: err.message });
        }
    }

    console.log('\n=== Summary ===');
    for (const r of results) {
        if (r.error) console.log(`${r.instance}: ERROR — ${r.error}`);
        else if (r.skipped) console.log(`${r.instance}: SKIPPED (migration not applied yet)`);
        else if (COMMIT) console.log(`${r.instance}: ${r.updated} updated, ${r.failed} failed`);
        else console.log(`${r.instance}: ${r.resolved} resolvable, ${r.unresolved} unresolved`);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
