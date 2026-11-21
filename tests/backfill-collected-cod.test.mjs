// PGlite test of migrations/backfill_collected_cod.sql on the real stack
// (tests/fifo-test-db.mjs, deploy order):
//   * an order the OLD set_order_payment left at Collected with nothing
//     booked gets one Draft RCP: Dr 1210 for its total / Cr 4000, plus COGS;
//     the COD flag and settle date are set, the status stays Collected;
//   * one with a deposit books only the remainder on 1210 (the DEP entry
//     stays on the bank);
//   * a Collected order already booked by the new function is left alone;
//   * a second run books nothing; the FIFO check stays balanced.
// Run: node tests/backfill-collected-cod.test.mjs
import { makeDb, harness, mig, strip } from './fifo-test-db.mjs';
import { lineUuid as SI } from './live-schema.mjs';

const db = await makeDb();
const { q, one, num, near, check, seedLayers, checkBalanced, done } = harness(db);
const DAY = '2026-11-18';

await db.exec(strip(mig('add_cod_receivable.sql')));
await q(`INSERT INTO products (id, name, price, stock, purchase_cost) VALUES ('C', 'Cable', 17, 0, 2)`);
await seedLayers('C', 20, 3, '2026-01-20T00:00:00Z');

const order = async (id, total) => {
    await q(`INSERT INTO sales (id, total, shipping_status, payment_status, shipping_company, customer_snapshot)
             VALUES ($1, $2, 'Delivered', 'Unpaid', 'J&T', jsonb_build_object('name', 'Cust ' || $1))`, [id, total]);
    await q(`INSERT INTO sale_items (id, sale_id, product_id, name, price, quantity) VALUES ($1, $2, 'C', 'Cable', $3, 1)`, [SI(id + '-a'), id, total]);
};
const pay = async (id, from, updates) => (await one(`SELECT public.set_order_payment(p_order_id => $1, p_expected_status => $2,
    p_updates => $3::jsonb, p_fields => jsonb_build_object('today', $4::text, 'tz_offset_min', 0)) AS r`, [id, from, JSON.stringify(updates), DAY])).r;
const receipts = async id => (await q(`SELECT t.id, t.amount FROM transactions t WHERE t.order_id = $1 AND t.type = 'Income' AND t.category = 'លក់រាយ'`, [id])).rows;
const onAcct = async (ref, code, side) => num((await one(`SELECT COALESCE(sum(l.${side}), 0) AS v FROM journal_entries e
    JOIN journal_entry_lines l ON l.journal_entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
    WHERE e.reference_id = $1 AND a.account_code = $2`, [ref, code])).v);
const codBalance = async () => num((await one(`SELECT COALESCE(sum(l.debit - l.credit), 0) AS b FROM journal_entry_lines l
    JOIN chart_of_accounts a ON a.id = l.account_id WHERE a.account_code = '1210'`)).b);
const row = async id => one(`SELECT payment_status, cod_collected, settle_date, amount_received FROM sales WHERE id = $1`, [id]);

// What the old function left: the status saved, nothing booked.
await order('OLD1', 17);
await q(`UPDATE sales SET payment_status = 'Collected' WHERE id = 'OLD1'`);
// A deposit taken (booked to the bank), then Collected under the old function.
await order('OLD2', 17);
await pay('OLD2', 'Unpaid', { payment_status: 'Deposit', deposit_amount: 5, deposit_date: DAY, post_to_ledger: true });
await q(`UPDATE sales SET payment_status = 'Collected' WHERE id = 'OLD2'`);
// Collected through the new function: already booked.
await order('NEW1', 17);
await pay('NEW1', 'Unpaid', { payment_status: 'Collected', amount_received: 0, settle_date: null });
const newBefore = await receipts('NEW1');
const balBefore = await codBalance();
check('setup: NEW1 booked 17 to 1210 by the new function', newBefore.length === 1 && near(balBefore, 17), balBefore);

await db.exec(strip(mig('backfill_collected_cod.sql')));

const r1 = await receipts('OLD1');
const ref1 = 'TX-' + r1[0]?.id;
const s1 = await row('OLD1');
check('OLD1: one receipt of 17', r1.length === 1 && near(r1[0].amount, 17), r1);
check('OLD1: Draft entry Dr 1210 17 / Cr 4000 17, COGS 3',
    near(await onAcct(ref1, '1210', 'debit'), 17) && near(await onAcct(ref1, '4000', 'credit'), 17) && near(await onAcct(ref1, '5000', 'debit'), 3)
    && (await one(`SELECT status FROM journal_entries WHERE reference_id = $1`, [ref1])).status === 'Draft');
check('OLD1: still Collected, COD flag on, settle date set, Received 17',
    s1.payment_status === 'Collected' && s1.cod_collected === true && s1.settle_date !== null && near(s1.amount_received, 17), s1);

const r2 = await receipts('OLD2');
const ref2 = 'TX-' + r2[0]?.id;
check('OLD2 (deposit 5): receipt of the remainder 12, Dr 1210 12',
    r2.length === 1 && near(r2[0].amount, 12) && near(await onAcct(ref2, '1210', 'debit'), 12), r2);
check('OLD2: still Collected with the COD flag', (await row('OLD2')).payment_status === 'Collected' && (await row('OLD2')).cod_collected === true);

check('NEW1: untouched (same single receipt)', JSON.stringify(await receipts('NEW1')) === JSON.stringify(newBefore));
check('1210 up by exactly 17 + 12', near(await codBalance(), balBefore + 29), await codBalance());
await checkBalanced('after backfill');

// Re-run: nothing more.
await db.exec(strip(mig('backfill_collected_cod.sql')));
check('re-run books nothing', (await receipts('OLD1')).length === 1 && (await receipts('OLD2')).length === 1 && near(await codBalance(), balBefore + 29));

done();
