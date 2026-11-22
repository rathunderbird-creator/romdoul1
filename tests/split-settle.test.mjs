// PGlite test of split settlements (part USD + part KHR) through the real
// stack in deploy order (tests/fifo-test-db.mjs) + add_cod_receivable.sql +
// add_khr_currency.sql. A split settle (p_updates.split) books TWO retail
// income rows and TWO Draft RCP entries in ONE transaction: the dollar part
// on the picked cash/bank account carrying the FIFO COGS, the riel part on
// a riel account (1002/1011) with its riel details on the row AND entry.
// Covers the 15-case checklist of the split-payments plan.
// Run: node tests/split-settle.test.mjs
import { randomUUID } from 'crypto';
import { makeDb, harness, mig, strip } from './fifo-test-db.mjs';
import { lineUuid as SI } from './live-schema.mjs';

const db = await makeDb();
const { q, one, num, near, check, acct, seedLayers, checkBalanced, done } = harness(db);
const DAY = '2026-11-18', LATER = '2026-11-19';
const TOTAL = 17, COGS = 3;

await db.exec(strip(mig('add_cod_receivable.sql')));
await q(`INSERT INTO chart_of_accounts (account_code, account_name, account_type)
         SELECT '1010', 'Bank Account ABA (USD)', 'Asset'
          WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '1010')`);
await q(`INSERT INTO products (id, name, price, stock, purchase_cost) VALUES ('C', 'Cable', 17, 0, 2)`);
await seedLayers('C', 100, COGS, '2026-01-20T00:00:00Z');

const order = async id => {
    await q(`INSERT INTO sales (id, total, shipping_status, payment_status, shipping_company, customer_snapshot)
             VALUES ($1, $2, 'Delivered', 'Unpaid', 'J&T', jsonb_build_object('name', 'Cust ' || $1))`, [id, TOTAL]);
    await q(`INSERT INTO sale_items (id, sale_id, product_id, name, price, quantity) VALUES ($1, $2, 'C', 'Cable', $3, 1)`, [SI(id + '-a'), id, TOTAL]);
};
const pay = async (id, from, updates) => (await one(`SELECT public.set_order_payment(p_order_id => $1, p_expected_status => $2,
    p_updates => $3::jsonb, p_fields => jsonb_build_object('today', $4::text, 'tz_offset_min', 0)) AS r`, [id, from, JSON.stringify(updates), DAY])).r;
const payErr = async (id, from, updates) => { try { await pay(id, from, updates); return null; } catch (e) { return String(e.message || e); } };
const khr = (riel, rate = 4100) => ({ currency: 'KHR', original_amount: riel, exchange_rate: rate });
const split = async (usdAcc, khrAcc, usd, money, extra = {}) => ({
    payment_status: 'Paid', amount_received: extra.gross ?? TOTAL, settle_date: LATER, post_to_ledger: true,
    cod_collected: false, deposit_account_id: usdAcc, tx_id: randomUUID(),
    split: { usd_amount: usd, tx_id: randomUUID(), account_id: khrAcc, money }, ...extra.u,
});
const rows = async (id, cols = 'id, amount, currency, original_amount, exchange_rate') =>
    (await q(`SELECT ${cols} FROM transactions WHERE order_id = $1 AND type = 'Income' AND category = 'លក់រាយ' ORDER BY created_at, id`, [id])).rows;
// Both rows share the transaction timestamp, so they come back in id order:
// tell the parts apart by their currency tag instead.
const parts = rs => ({ usd: rs.find(r => r.currency !== 'KHR'), khr: rs.find(r => r.currency === 'KHR') });
const entryFor = async txId => one(`
    SELECT e.id, COALESCE(e.status, 'Posted') AS status, e.currency, e.original_amount, e.exchange_rate,
           COALESCE(sum(l.debit) FILTER (WHERE a.account_code = '1010'), 0) AS bank_dr,
           COALESCE(sum(l.debit) FILTER (WHERE a.account_code IN ('1002', '1011')), 0) AS khr_dr,
           COALESCE(sum(l.debit) FILTER (WHERE a.account_code = '1210'), 0) AS cod_dr,
           COALESCE(sum(l.credit) FILTER (WHERE a.account_code = '4000'), 0) AS rev_cr,
           COALESCE(sum(l.debit) FILTER (WHERE a.account_code = '5000'), 0) AS cogs
      FROM journal_entries e LEFT JOIN journal_entry_lines l ON l.journal_entry_id = e.id
      LEFT JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE e.reference_id = 'TX-' || $1::uuid GROUP BY e.id`, [txId]);

// ── 15 (runs FIRST, before add_khr_currency.sql): a store without the
// currency columns still books both rows; op_set_currency no-ops. ────────
{
    const usdAcc = await acct('1010');
    await order('S15');
    const u = await split(usdAcc, usdAcc, 5, khr(49200));
    const r = await pay('S15', 'Unpaid', u);
    const amts = (await rows('S15', 'id, amount')).map(x => num(x.amount)).sort((a, b) => a - b);
    check('15 no currency columns: split still books two rows (5 + 12)',
        r.applied === true && amts.length === 2 && near(amts[0], 5) && near(amts[1], 12), amts);
    await checkBalanced('15');
}

await db.exec(strip(mig('add_khr_currency.sql')));
const USD_ACC = await acct('1010');
const KHR_ACC = await acct('1002');

// ── 1. Plain split, sum == due: $5 + ៛49,200 (= $12 @4100) on $17. ──────
{
    await order('S1');
    const u = await split(USD_ACC, KHR_ACC, 5, khr(49200));
    const r = await pay('S1', 'Unpaid', u);
    const rs = await rows('S1');
    const pp = parts(rs);
    check('1 two rows: 5 USD-plain and 12 KHR-tagged', rs.length === 2
        && !!pp.usd && near(num(pp.usd.amount), 5) && pp.usd.currency === null
        && !!pp.khr && near(num(pp.khr.amount), 12) && num(pp.khr.original_amount) === 49200 && num(pp.khr.exchange_rate) === 4100, rs);
    const e1 = await entryFor(pp.usd.id), e2 = await entryFor(pp.khr.id);
    check('1 entry 1: Draft, Dr 1010 5 / Cr 4000 5, carries COGS',
        e1.status === 'Draft' && near(num(e1.bank_dr), 5) && near(num(e1.rev_cr), 5) && near(num(e1.cogs), COGS) && near(num(e1.khr_dr), 0), e1);
    check('1 entry 2: Draft, Dr 1002 12 / Cr 4000 12, no COGS, riel meta on the entry',
        e2.status === 'Draft' && near(num(e2.khr_dr), 12) && near(num(e2.rev_cr), 12) && near(num(e2.cogs), 0)
        && e2.currency === 'KHR' && num(e2.original_amount) === 49200, e2);
    check('1 sale Paid, received = total', (await one(`SELECT payment_status, amount_received FROM sales WHERE id = 'S1'`)).payment_status === 'Paid');
    check('1 applied without notices', r.applied === true && (r.notices || []).length === 0, r);
    await checkBalanced('1');
}

// ── 2. Split over a deposit: dep 5, remainder 12 = $2 + ៛41,000. ────────
{
    await order('S2');
    await pay('S2', 'Unpaid', { payment_status: 'Deposit', deposit_amount: 5, deposit_date: DAY, post_to_ledger: true });
    const u = await split(USD_ACC, KHR_ACC, 2, khr(41000));
    await pay('S2', 'Deposit', u);
    const rs = await rows('S2');
    check('2 deposit kept, split books 2 + 10', rs.length === 2 && near(num(parts(rs).usd.amount), 2) && near(num(parts(rs).khr.amount), 10)
        && num((await one(`SELECT count(*) AS n FROM transactions WHERE order_id = 'S2' AND category = 'កក់ប្រាក់'`)).n) === 1, rs);
    await checkBalanced('2');
}

// ── 3. Sum ≠ due: gross 20 on a 17 order → parts 5 + 15. ────────────────
{
    await order('S3');
    const u = await split(USD_ACC, KHR_ACC, 5, khr(61500), { gross: 20 });
    await pay('S3', 'Unpaid', u);
    const rs = await rows('S3');
    check('3 parts follow the sent amount: 5 + 15', rs.length === 2 && near(num(parts(rs).usd.amount), 5) && near(num(parts(rs).khr.amount), 15), rs);
    await checkBalanced('3');
}

// ── 4. Retry with the same two ids → already_applied, still two rows. ───
{
    await order('S4');
    const u = await split(USD_ACC, KHR_ACC, 5, khr(49200));
    await pay('S4', 'Unpaid', u);
    const again = await pay('S4', 'Unpaid', u);
    check('4 retry: already_applied, two rows, two entries', again.already_applied === true
        && (await rows('S4')).length === 2, again);
}

// ── 5. Atomicity: a bad riel account books NOTHING. ─────────────────────
{
    await order('S5');
    const u = await split(USD_ACC, randomUUID(), 5, khr(49200));
    const err = await payErr('S5', 'Unpaid', u);
    const g = await one(`SELECT payment_status FROM sales WHERE id = 'S5'`);
    check('5 bad account: exception, zero rows, order still Unpaid',
        /riel account/.test(err || '') && (await rows('S5', 'id')).length === 0 && g.payment_status === 'Unpaid', err);
}

// ── 6. Split + COD refused; the same via Collected. ─────────────────────
{
    await order('S6');
    const u = await split(USD_ACC, KHR_ACC, 5, khr(49200), { u: { cod_collected: true } });
    const e1 = await payErr('S6', 'Unpaid', u);
    const u2 = await split(USD_ACC, KHR_ACC, 5, khr(49200), { u: { payment_status: 'Collected', cod_collected: true } });
    const e2 = await payErr('S6', 'Unpaid', u2);
    check('6 split + COD refused, also via Collected', /COD/.test(e1 || '') && /COD/.test(e2 || '') && (await rows('S6', 'id')).length === 0, [e1, e2]);
}

// ── 7. Deposit-covered order: nothing left to split. ────────────────────
{
    await order('S7');
    await pay('S7', 'Unpaid', { payment_status: 'Deposit', deposit_amount: TOTAL, deposit_date: DAY, post_to_ledger: true });
    const err = await payErr('S7', 'Deposit', await split(USD_ACC, KHR_ACC, 5, khr(49200)));
    check('7 deposit covers the order → refused', /nothing left to split/.test(err || ''), err);
}

// ── 8. Bad parts refused. ───────────────────────────────────────────────
{
    await order('S8');
    const z = await payErr('S8', 'Unpaid', await split(USD_ACC, KHR_ACC, 0, khr(69700)));
    const full = await payErr('S8', 'Unpaid', await split(USD_ACC, KHR_ACC, TOTAL, khr(100)));
    const noMoney = await payErr('S8', 'Unpaid', await split(USD_ACC, KHR_ACC, 5, undefined));
    check('8 zero / full USD part and missing riel details refused',
        /dollar part and a riel part/.test(z || '') && /dollar part and a riel part/.test(full || '')
        && /riel amount and exchange rate/.test(noMoney || '') && (await rows('S8', 'id')).length === 0, [z, full, noMoney]);
}

// ── 9. Riel far from the derived part → tolerance refusal. ──────────────
{
    await order('S9');
    const err = await payErr('S9', 'Unpaid', await split(USD_ACC, KHR_ACC, 5, khr(50000)));
    check('9 ៛50,000 ≠ $12 part by > $0.05 → refused', /no longer matches/.test(err || ''), err);
}

// ── 10. Un-pay a split order removes BOTH rows and entries. ─────────────
{
    await order('S10');
    await pay('S10', 'Unpaid', await split(USD_ACC, KHR_ACC, 5, khr(49200)));
    const r = await pay('S10', 'Paid', { payment_status: 'Unpaid', amount_received: 0, settle_date: null });
    const left = num((await one(`SELECT count(*) AS n FROM journal_entries WHERE reference_id LIKE 'TX-%' AND reference_id IN (
        SELECT 'TX-' || t.id FROM transactions t WHERE t.order_id = 'S10')`)).n);
    check('10 un-pay: both rows gone, no entries left, COGS unwound',
        (await rows('S10', 'id')).length === 0 && left === 0 && (r.transactions_removed || []).length === 2
        && num((await one(`SELECT COALESCE(sum(cogs_booked), 0) AS c FROM sale_items WHERE sale_id = 'S10'`)).c) === 0, r);
    await checkBalanced('10');
    await pay('S10', 'Unpaid', { payment_status: 'Paid', amount_received: TOTAL, settle_date: LATER, post_to_ledger: true, cod_collected: false });
    check('10 re-settle single-currency works: one row', (await rows('S10', 'id')).length === 1);
    await checkBalanced('10b');
}

// ── 11. Correction on a split order → notice, books untouched. ──────────
{
    await order('S11');
    await pay('S11', 'Unpaid', await split(USD_ACC, KHR_ACC, 5, khr(49200)));
    const before = JSON.stringify(await rows('S11'));
    const r = await pay('S11', 'Paid', { payment_status: 'Paid', amount_received: 19, settle_date: '2026-11-20', post_to_ledger: true });
    check('11 correction: split notice, rows unchanged', (r.notices || []).join(' ').includes('split payment')
        && JSON.stringify(await rows('S11')) === before, r.notices);
    await checkBalanced('11');
}

// ── 12. COD flip on a split order → notice, no repoint. ─────────────────
{
    await order('S12');
    await pay('S12', 'Unpaid', await split(USD_ACC, KHR_ACC, 5, khr(49200)));
    const r = await pay('S12', 'Paid', { payment_status: 'Paid', cod_collected: true });
    const rs = await rows('S12');
    const e1 = await entryFor(parts(rs).usd.id), e2 = await entryFor(parts(rs).khr.id);
    check('12 flip: split notice, debits still 1010/1002, nothing on 1210',
        (r.notices || []).join(' ').includes('split payment')
        && near(num(e1.bank_dr), 5) && near(num(e2.khr_dr), 12) && near(num(e1.cod_dr) + num(e2.cod_dr), 0), [r.notices, e1, e2]);
    await checkBalanced('12');
}

// ── 13. Single-currency settle through the new pack: unchanged shape. ───
{
    await order('S13');
    const r = await pay('S13', 'Unpaid', { payment_status: 'Paid', amount_received: TOTAL, settle_date: LATER, post_to_ledger: true,
        cod_collected: false, deposit_account_id: USD_ACC, tx_id: randomUUID() });
    const rs = await rows('S13');
    const e = await entryFor(rs[0].id);
    check('13 regression pin: one row, Draft Dr 1010 17 + COGS', r.applied === true && rs.length === 1
        && e.status === 'Draft' && near(num(e.bank_dr), 17) && near(num(e.cogs), COGS), e);
    await checkBalanced('13');
}

// ── 14. delete_retail_orders removes both rows of a split-paid order. ───
{
    // Born Pending and shipped through the real status function, so the
    // stock-out and its layers exist for the delete to give back.
    await q(`INSERT INTO sales (id, total, shipping_status, payment_status, shipping_company, customer_snapshot)
             VALUES ('S14', $1, 'Pending', 'Unpaid', 'J&T', jsonb_build_object('name', 'Cust S14'))`, [TOTAL]);
    await q(`INSERT INTO sale_items (id, sale_id, product_id, name, price, quantity) VALUES ($1, 'S14', 'C', 'Cable', $2, 1)`, [SI('S14-a'), TOTAL]);
    await one(`SELECT public.set_order_shipping_status('S14', 'Pending', 'Delivered', jsonb_build_object('today', $1::text)) AS r`, [DAY]);
    await pay('S14', 'Unpaid', await split(USD_ACC, KHR_ACC, 5, khr(49200)));
    await one(`SELECT public.delete_retail_orders(ARRAY['S14'], jsonb_build_object('today', $1::text, 'tz_offset_min', 0)) AS r`, [DAY]);
    check('14 delete removes both rows', (await rows('S14', 'id')).length === 0
        && num((await one(`SELECT count(*) AS n FROM sales WHERE id = 'S14'`)).n) === 0);
    await checkBalanced('14');
}

done();
