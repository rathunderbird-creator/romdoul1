// PGlite sweep of every Pay Status transition the app offers — Unpaid,
// Deposit, Collected, Paid, PdFee, Cancel — on the real stack in deploy
// order (tests/fifo-test-db.mjs) plus add_cod_receivable.sql.
//
// For every ordered pair (a, b), a fresh order is taken Unpaid → a → b → a,
// each hop saved through public.set_order_payment with the payload the app
// sends for that target (badges/bulk edits after feat/collected-paid-to-bank):
//   Unpaid     amount_received 0, settle_date null
//   Deposit    deposit_amount 5, post_to_ledger (books the POSITIVE DELTA)
//   Collected  amount_received = deposit, settle_date null, cod_collected true
//   Paid       amount_received = total, settle, post_to_ledger,
//              cod_collected false when leaving Collected (the money arrived)
//   PdFee      the $3 delivery fee, settle
//   Cancel     amount_received 0, settle_date null
// After every hop the books are re-checked:
//   * at Paid/Collected: exactly one retail receipt for total − deposit,
//     its Draft entry debiting the bank (Paid) or 1210 (Collected), with
//     revenue and COGS; the COD flag mirrors the status;
//   * at Unpaid/Cancel/Deposit/PdFee: no retail receipt survives;
//   * a deposit, once booked, stays booked exactly once (money was taken);
//   * the $3 fee, once booked, stays booked exactly once;
//   * every ledger entry balances and the FIFO pool matches stock.
// See tests/README.md for how to run it.
import { makeDb, harness, mig, strip } from './fifo-test-db.mjs';
import { lineUuid as SI } from './live-schema.mjs';

const db = await makeDb();
const { q, one, num, near, check, seedLayers, checkBalanced, done } = harness(db);
const DAY = '2026-11-18';
const LATER = '2026-11-19';
const TOTAL = 17, DEP = 5, FEE = 3, COGS = 3;

await db.exec(strip(mig('add_cod_receivable.sql')));
await q(`INSERT INTO products (id, name, price, stock, purchase_cost) VALUES ('C', 'Cable', 17, 0, 2)`);
await seedLayers('C', 200, COGS, '2026-01-20T00:00:00Z');

const order = async id => {
    await q(`INSERT INTO sales (id, total, shipping_status, payment_status, shipping_company, customer_snapshot)
             VALUES ($1, $2, 'Delivered', 'Unpaid', 'J&T', jsonb_build_object('name', 'Cust ' || $1))`, [id, TOTAL]);
    await q(`INSERT INTO sale_items (id, sale_id, product_id, name, price, quantity) VALUES ($1, $2, 'C', 'Cable', $3, 1)`, [SI(id + '-a'), id, TOTAL]);
};
const pay = async (id, from, updates) => (await one(`SELECT public.set_order_payment(p_order_id => $1, p_expected_status => $2,
    p_updates => $3::jsonb, p_fields => jsonb_build_object('today', $4::text, 'tz_offset_min', 0)) AS r`, [id, from, JSON.stringify(updates), DAY])).r;
const rows = async (id, cat) => (await q(`SELECT t.id, t.amount FROM transactions t WHERE t.order_id = $1 AND t.type = 'Income' AND t.category = $2`, [id, cat])).rows;
const sale = async id => one(`SELECT payment_status, cod_collected, deposit_amount, amount_received, settle_date FROM sales WHERE id = $1`, [id]);
// The money debits of one receipt's entry, split 1210 / cash-bank, plus revenue and COGS.
const entryOf = async txId => one(`
    SELECT COALESCE(e.status, 'Posted') AS status,
           COALESCE(sum(l.debit)  FILTER (WHERE a.account_code = '1210'), 0) AS cod_dr,
           COALESCE(sum(l.debit)  FILTER (WHERE a.account_type = 'Asset' AND a.account_name ~* '(cash|bank)'), 0) AS bank_dr,
           COALESCE(sum(l.credit) FILTER (WHERE a.account_code = '4000'), 0) AS rev_cr,
           COALESCE(sum(l.debit)  FILTER (WHERE a.account_code = '5000'), 0) AS cogs
      FROM journal_entries e
      LEFT JOIN journal_entry_lines l ON l.journal_entry_id = e.id
      LEFT JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE e.reference_id = 'TX-' || $1
     GROUP BY e.id`, [txId]);

// What the app sends to enter each status, given the order's current state.
const payload = (target, cur, hasDeposit) => {
    const dep = hasDeposit ? DEP : 0;
    switch (target) {
        case 'Unpaid': return { payment_status: 'Unpaid', amount_received: 0, settle_date: null };
        case 'Cancel': return { payment_status: 'Cancel', amount_received: 0, settle_date: null };
        case 'Deposit': return { payment_status: 'Deposit', deposit_amount: DEP, deposit_date: DAY, post_to_ledger: true };
        case 'Collected': return { payment_status: 'Collected', amount_received: dep, settle_date: null, cod_collected: true };
        case 'Paid': return { payment_status: 'Paid', amount_received: TOTAL, settle_date: LATER, post_to_ledger: true,
            // defaultCodCollected(order, _, 'Paid'): a Collected order marked
            // Paid clears to the bank; otherwise no stored flag in this sweep.
            cod_collected: false };
        case 'PdFee': return { payment_status: 'PdFee', amount_received: FEE, settle_date: DAY };
    }
};

// What must be on the books at `status` for an order whose history is `ctx`.
const expectState = async (id, status, ctx, label) => {
    const s = await sale(id);
    const retail = await rows(id, 'លក់រាយ');
    const deps = await rows(id, 'កក់ប្រាក់');
    const fees = await rows(id, 'ថ្លៃដឹក');
    const settled = status === 'Paid' || status === 'Collected';
    const owed = TOTAL - (ctx.deposit ? DEP : 0);
    let ok = s.payment_status === status
        && retail.length === (settled ? 1 : 0)
        && deps.length === (ctx.deposit ? 1 : 0) && (!ctx.deposit || near(deps[0].amount, DEP))
        && fees.length === (ctx.fee ? 1 : 0) && (!ctx.fee || near(fees[0].amount, FEE))
        && (s.cod_collected === (status === 'Collected'));
    if (ok && settled) {
        const e = await entryOf(retail[0].id);
        ok = !!e && e.status === 'Draft' && near(retail[0].amount, owed) && near(num(e.rev_cr), owed) && num(e.cogs) > 0
            && (status === 'Collected' ? near(num(e.cod_dr), owed) && near(num(e.bank_dr), 0)
                                       : near(num(e.bank_dr), owed) && near(num(e.cod_dr), 0));
        check(label, ok, { sale: s, retail, entry: e });
    } else {
        check(label, ok, { sale: s, retail: retail.length, deps: deps.length, fees: fees.length });
    }
};

const STATUSES = ['Unpaid', 'Deposit', 'Collected', 'Paid', 'PdFee', 'Cancel'];
let n = 0;
for (const a of STATUSES) {
    for (const b of STATUSES) {
        if (a === b) continue;
        n++;
        const id = `M${n}`;
        await order(id);
        const ctx = { deposit: false, fee: false };
        const hop = async (from, to) => {
            const r = await pay(id, from, payload(to, from, ctx.deposit));
            if (to === 'Deposit') ctx.deposit = true;
            if (to === 'PdFee') ctx.fee = true;
            return r;
        };
        if (a !== 'Unpaid') await hop('Unpaid', a);
        await hop(a, b);
        await expectState(id, b, ctx, `${a} → ${b}`);
        await hop(b, a);
        await expectState(id, a, ctx, `${a} → ${b} → ${a}`);
    }
}
await checkBalanced('after all 30 round trips');
done();
