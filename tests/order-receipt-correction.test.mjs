// PGlite test of LED-6 in migrations/add_order_payment_functions.sql: a
// correction to a paid retail order's receipt (received amount, settle
// date, riel details) or to a deposit reaches the row's TX-<tx> ledger
// entry (wp_internal.op_sync_tx_entry), on the real stack in deploy order
// (tests/fifo-test-db.mjs) and the live column types.
//   * the live case (Romdoul1 order 1794841334117): a 17.00 receipt
//     corrected to 19.44 (79,700 riel at 4,100) — the Draft entry is
//     rewritten in place, same entry number, COGS lines untouched, riel
//     columns on the row and the entry;
//   * a settle-date correction moves the Draft entry's date;
//   * no change (the same save again, or a Pay By change) writes nothing
//     to the entry;
//   * a POSTED entry stays; the difference is ONE Draft TX-<tx>-ADJ
//     (Dr revenue / Cr cash for a decrease, the reverse for an increase),
//     rewritten on later corrections, deleted when the correction nets to
//     0, removed with the row when the order leaves Paid; a date-only
//     change of a Posted entry books nothing and the notice says so;
//   * riel: a riel-only change (same USD) rewrites the riel columns; a
//     riel decrease on a Posted entry books the ADJ with the riel delta;
//   * deposits: a lowered deposit rewrites the newest DEP row and its
//     Draft entry (or books an ADJ for a Posted one); a top-up still books a
//     new row; a cut deeper than the newest row leaves the books with a
//     notice;
//   * a store without the riel columns (add_khr_currency.sql not run) takes
//     the same corrections without error;
//   * the FIFO check stays at variance 0 throughout (COGS never moves).
// See tests/README.md for how to run it.
import { makeDb, harness } from './fifo-test-db.mjs';
import { lineUuid as SI } from './live-schema.mjs';

const db = await makeDb();
const { q, one, num, near, check, seedLayers, checkBalanced, done } = harness(db);
const DAY = '2026-11-17';
const EARLIER = '2026-11-15';
const TODAY = '2026-11-18';

await q(`INSERT INTO products (id, name, price, stock, purchase_cost) VALUES ('C', 'Cable', 17, 0, 2)`);
await seedLayers('C', 10, 3, '2026-01-20T00:00:00Z');
await checkBalanced('seeded');

const order = async (id, total, qty = 1) => {
    await q(`INSERT INTO sales (id, total, shipping_status, payment_status, customer_snapshot)
             VALUES ($1, $2, 'Pending', 'Unpaid', jsonb_build_object('name', 'Cust ' || $1))`, [id, total]);
    if (qty > 0) {
        await q(`INSERT INTO sale_items (id, sale_id, product_id, name, price, quantity) VALUES ($1, $2, 'C', 'Cable', $3, $4)`,
            [SI(id + '-a'), id, total / qty, qty]);
    }
};
const pay = async (id, from, updates, today = DAY) => (await one(`SELECT public.set_order_payment(p_order_id => $1, p_expected_status => $2,
    p_updates => $3::jsonb, p_fields => jsonb_build_object('today', $4::text, 'tz_offset_min', 0)) AS r`, [id, from, JSON.stringify(updates), today])).r;
const payErr = async (...a) => { try { await pay(...a); return ''; } catch (e) { return String(e.message || e); } };
const tx = async (id, cat = 'លក់រាយ') => one(`SELECT to_jsonb(t) AS j FROM transactions t WHERE order_id = $1 AND category = $2
    ORDER BY created_at DESC, id DESC LIMIT 1`, [id, cat]).then(r => r && r.j);
// One entry by reference with its sides summed: the cash/bank side (an
// Asset that is not Inventory), the revenue side (4000) and the COGS debit.
const entry = async ref => one(`
    SELECT e.id, e.entry_number, e.date::text AS date, COALESCE(e.status, 'Posted') AS status, e.description,
           to_jsonb(e) AS row, count(l.id) AS nlines,
           COALESCE(sum(l.debit)  FILTER (WHERE a.account_type = 'Asset' AND a.account_code <> '1300'), 0) AS cash_dr,
           COALESCE(sum(l.credit) FILTER (WHERE a.account_type = 'Asset' AND a.account_code <> '1300'), 0) AS cash_cr,
           COALESCE(sum(l.credit) FILTER (WHERE a.account_code = '4000'), 0) AS rev_cr,
           COALESCE(sum(l.debit)  FILTER (WHERE a.account_code = '4000'), 0) AS rev_dr,
           COALESCE(sum(l.debit)  FILTER (WHERE a.account_code = '5000'), 0) AS cogs,
           COALESCE(sum(l.credit) FILTER (WHERE a.account_code = '1300'), 0) AS inv
      FROM journal_entries e
      LEFT JOIN journal_entry_lines l ON l.journal_entry_id = e.id
      LEFT JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE e.reference_id = $1
     GROUP BY e.id`, [ref]);
const entryCount = async like => num((await one(`SELECT count(*) AS n FROM journal_entries WHERE reference_id LIKE $1`, [like])).n);
// The whole ledger of one reference prefix, as text, to prove nothing moved.
const snapshot = async like => JSON.stringify((await q(`
    SELECT to_jsonb(e) AS e, (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at, l.id) FROM journal_entry_lines l WHERE l.journal_entry_id = e.id) AS lines
      FROM journal_entries e WHERE e.reference_id LIKE $1 ORDER BY e.created_at, e.id`, [like])).rows);
const post = async ref => q(`UPDATE journal_entries SET status = 'Posted' WHERE reference_id = $1`, [ref]);
const khr = (riel, rate = 4100, category = 'លក់រាយ') => ({ currency: 'KHR', original_amount: riel, exchange_rate: rate, category });
const usd = category => ({ currency: 'USD', original_amount: 0, exchange_rate: 1, category });
const amounts = (e, cashDr, revCr, cogs) => near(e.cash_dr, cashDr) && near(e.rev_cr, revCr) && near(e.cogs, cogs) && near(e.inv, cogs)
    && near(e.cash_cr, 0) && near(e.rev_dr, 0);

// ---------------------------------------------------------------------------
// 1. The live case: a Draft receipt rewritten in place.
// ---------------------------------------------------------------------------
{
    await order('L1', 17);
    const r = await pay('L1', 'Unpaid', { payment_status: 'Paid', amount_received: 17, settle_date: DAY, post_to_ledger: true });
    check('L1 settle applied', r.applied === true, r);
    let t = await tx('L1');
    let e = await entry('TX-' + t.id);
    check('L1 settle: Draft RCP 17.00 with COGS 3', e && e.status === 'Draft' && amounts(e, 17, 17, 3) && num(e.nlines) === 4, e);
    const before = { id: e.id, number: e.entry_number };
    check('L1 settle: a Draft RCP number', /^JE-\d+-RCP-20261117-\d+$/.test(e.entry_number), e.entry_number);

    // The selling price corrected to 79,700 riel = 19.44 (a negative discount
    // on the order): the same save the app sends from Settle.
    const c = await pay('L1', 'Paid', { payment_status: 'Paid', amount_received: 19.44, settle_date: DAY, post_to_ledger: true, money: khr(79700) });
    check('L1 correct: applied, no notice', c.applied === true && (c.notices || []).length === 0, c);
    t = await tx('L1');
    check('L1 correct: the income row is 19.44 in riel 79,700 @ 4,100', near(t.amount, 19.44) && t.currency === 'KHR' && near(t.original_amount, 79700) && near(t.exchange_rate, 4100), t);
    check('L1 correct: the corrected row is returned to the app', (c.transactions_added || []).some(x => x.id === t.id && near(x.amount, 19.44)), c.transactions_added);
    e = await entry('TX-' + t.id);
    check('L1 correct: the SAME Draft entry (id, entry number) now books 19.44 / 19.44, COGS 3 untouched',
        e.id === before.id && e.entry_number === before.number && e.status === 'Draft' && amounts(e, 19.44, 19.44, 3) && num(e.nlines) === 4, e);
    check('L1 correct: the entry carries the riel details', e.row.currency === 'KHR' && near(e.row.original_amount, 79700) && near(e.row.exchange_rate, 4100), e.row);
    check('L1 correct: no adjusting entry for a Draft', (await entryCount('TX-' + t.id + '-ADJ')) === 0);
    check('L1 correct: sales.amount_received = 19.44', near((await one(`SELECT amount_received FROM sales WHERE id = 'L1'`)).amount_received, 19.44));
    await checkBalanced('L1 corrected');

    // The settle date corrected two days back: the Draft entry moves with
    // the row.
    const d = await pay('L1', 'Paid', { payment_status: 'Paid', settle_date: EARLIER });
    check('L1 date: applied, no notice', d.applied === true && (d.notices || []).length === 0, d);
    t = await tx('L1');
    e = await entry('TX-' + t.id);
    check('L1 date: the row and its entry are dated ' + EARLIER, String(t.date).startsWith(EARLIER) && e.date === EARLIER && e.id === before.id, [t.date, e.date]);
    check('L1 date: amounts unchanged', amounts(e, 19.44, 19.44, 3), e);

    // ---------------------------------------------------------------------
    // 2. No change: nothing is written to the entry.
    // ---------------------------------------------------------------------
    const snap = await snapshot('TX-' + t.id + '%');
    const again = await pay('L1', 'Paid', { payment_status: 'Paid', amount_received: 19.44, settle_date: EARLIER, post_to_ledger: true, money: khr(79700) });
    check('L1 same save again: applied, nothing added, no notice', again.applied === true && (again.transactions_added || []).length === 0 && (again.notices || []).length === 0, again);
    check('L1 same save again: the ledger is byte-for-byte the same', (await snapshot('TX-' + t.id + '%')) === snap);
    const m = await pay('L1', 'Paid', { payment_status: 'Paid', payment_method: 'Cash' });
    check('L1 Pay By: the row follows', (await tx('L1')).pay_by === 'Cash' && (m.transactions_added || []).length === 1, m);
    check('L1 Pay By: the ledger is untouched', (await snapshot('TX-' + t.id + '%')) === snap);
    const sameDay = await pay('L1', 'Paid', { payment_status: 'Paid', settle_date: EARLIER + 'T05:30:00Z' });
    check('L1 same local day: the ledger is untouched', (await snapshot('TX-' + t.id + '%')) === snap && (sameDay.notices || []).length === 0);
}

// ---------------------------------------------------------------------------
// 3. A POSTED receipt: the difference goes to ONE Draft TX-<tx>-ADJ.
// ---------------------------------------------------------------------------
{
    await order('P1', 50, 2);
    await pay('P1', 'Unpaid', { payment_status: 'Paid', amount_received: 50, settle_date: DAY, post_to_ledger: true });
    const t = await tx('P1');
    const ref = 'TX-' + t.id;
    await post(ref);
    const main = await snapshot(ref);

    let c = await pay('P1', 'Paid', { payment_status: 'Paid', amount_received: 45, settle_date: DAY });
    check('P1 45: applied with the POSTED notice', c.applied === true && (c.notices || []).length === 1 && /POSTED/.test(c.notices[0]) && /\$5\.00 less/.test(c.notices[0]), c.notices);
    check('P1 45: the Posted entry is untouched', (await snapshot(ref)) === main);
    check('P1 45: the row is 45', near((await tx('P1')).amount, 45));
    let adj = await entry(ref + '-ADJ');
    check('P1 45: ONE Draft ADJ, Dr revenue 5 / Cr cash 5, dated the settle day, RCP-numbered',
        adj && adj.status === 'Draft' && near(adj.rev_dr, 5) && near(adj.cash_cr, 5) && near(adj.cash_dr, 0) && near(adj.rev_cr, 0)
        && near(adj.cogs, 0) && num(adj.nlines) === 2 && adj.date === DAY && /^JE-\d+-RCP-20261117-\d+$/.test(adj.entry_number)
        && (await entryCount(ref + '-ADJ')) === 1, adj);
    check('P1 45: the notice names the ADJ entry', c.notices[0].includes(adj.entry_number), c.notices[0]);
    check('P1 45: the ADJ is labelled a receipt correction for the customer', /receipt correction/.test(adj.description) && /Cust P1/.test(adj.description), adj.description);
    const adjId = adj.id;
    await checkBalanced('P1 posted, corrected down');

    c = await pay('P1', 'Paid', { payment_status: 'Paid', amount_received: 60, settle_date: DAY });
    adj = await entry(ref + '-ADJ');
    check('P1 60: the SAME ADJ rewritten: Dr cash 10 / Cr revenue 10', adj && adj.id === adjId && near(adj.cash_dr, 10) && near(adj.rev_cr, 10)
        && near(adj.rev_dr, 0) && near(adj.cash_cr, 0) && num(adj.nlines) === 2 && (await entryCount(ref + '-ADJ')) === 1, adj);
    check('P1 60: notice says $10.00 more', (c.notices || []).length === 1 && /\$10\.00 more/.test(c.notices[0]), c.notices);
    check('P1 60: the Posted entry still untouched', (await snapshot(ref)) === main);

    c = await pay('P1', 'Paid', { payment_status: 'Paid', amount_received: 50, settle_date: DAY });
    check('P1 back to 50: the ADJ is gone, no notice', (await entryCount(ref + '-ADJ')) === 0 && (c.notices || []).length === 0, c);

    c = await pay('P1', 'Paid', { payment_status: 'Paid', settle_date: EARLIER });
    check('P1 date only on a Posted entry: no ADJ, notice says the date was left', (await entryCount(ref + '-ADJ')) === 0
        && (c.notices || []).length === 1 && /POSTED/.test(c.notices[0]) && /date was left as 2026-11-17/.test(c.notices[0]), c.notices);
    check('P1 date only: the row moved, the Posted entry did not', String((await tx('P1')).date).startsWith(EARLIER) && (await snapshot(ref)) === main);

    // A Draft ADJ leaves with the row when the order leaves Paid.
    await pay('P1', 'Paid', { payment_status: 'Paid', amount_received: 45 });
    check('P1 45 again: ADJ back', (await entryCount(ref + '-ADJ')) === 1);
    c = await pay('P1', 'Paid', { payment_status: 'Unpaid' });
    check('P1 leaving Paid: the row is removed, the Draft ADJ with it, the Posted entry stays with its notice',
        (await tx('P1')) == null && (await entryCount(ref + '-ADJ')) === 0 && (await entryCount(ref)) === 1
        && (c.notices || []).some(n => /POSTED/.test(n)), c);
    await checkBalanced('P1 left Paid');
}

// ---------------------------------------------------------------------------
// 4. Riel: a riel-only change, and the ADJ of a riel receipt.
// ---------------------------------------------------------------------------
{
    await order('R1', 19.44);
    await pay('R1', 'Unpaid', { payment_status: 'Paid', amount_received: 19.44, settle_date: DAY, post_to_ledger: true });
    let t = await tx('R1');
    const ref = 'TX-' + t.id;
    // The app tags the row and the entry after a riel settle.
    await q(`UPDATE transactions SET currency = 'KHR', original_amount = 79700, exchange_rate = 4100 WHERE id = $1`, [t.id]);
    await q(`UPDATE journal_entries SET currency = 'KHR', original_amount = 79700, exchange_rate = 4100 WHERE reference_id = $1`, [ref]);

    // 79,720 riel is still 19.44: a riel-only correction.
    let c = await pay('R1', 'Paid', { payment_status: 'Paid', amount_received: 19.44, settle_date: DAY, money: khr(79720) });
    t = await tx('R1');
    let e = await entry(ref);
    check('R1 riel only: the row keeps 19.44 and now says 79,720 riel', near(t.amount, 19.44) && near(t.original_amount, 79720) && (c.transactions_added || []).length === 1, t);
    check('R1 riel only: the Draft entry says 79,720 riel, amounts unchanged, no ADJ', near(e.row.original_amount, 79720) && amounts(e, 19.44, 19.44, 3)
        && (await entryCount(ref + '-ADJ')) === 0, e.row);
    const snap = await snapshot(ref + '%');
    c = await pay('R1', 'Paid', { payment_status: 'Paid', amount_received: 19.44, settle_date: DAY, money: khr(79720) });
    check('R1 same riel again: nothing written', (c.transactions_added || []).length === 0 && (await snapshot(ref + '%')) === snap);

    // Posted, then 83,000 riel = 20.24: the ADJ carries the riel delta.
    await post(ref);
    c = await pay('R1', 'Paid', { payment_status: 'Paid', amount_received: 20.24, settle_date: DAY, money: khr(83000) });
    t = await tx('R1');
    const adj = await entry(ref + '-ADJ');
    check('R1 posted + 83,000: row 20.24 / 83,000 riel', near(t.amount, 20.24) && near(t.original_amount, 83000), t);
    check('R1 posted + 83,000: Draft ADJ Dr cash 0.80 / Cr revenue 0.80 in riel 3,280 @ 4,100',
        adj && adj.status === 'Draft' && near(adj.cash_dr, 0.8) && near(adj.rev_cr, 0.8)
        && adj.row.currency === 'KHR' && near(adj.row.original_amount, 3280) && near(adj.row.exchange_rate, 4100), adj);
    check('R1 posted: the Posted entry keeps its 79,720 riel', near((await entry(ref)).row.original_amount, 79720));
    // Back to dollars: the row's riel details are cleared, the ADJ is USD.
    c = await pay('R1', 'Paid', { payment_status: 'Paid', amount_received: 20, settle_date: DAY, money: usd('លក់រាយ') });
    t = await tx('R1');
    const adj2 = await entry(ref + '-ADJ');
    check('R1 back to USD 20.00: row cleared of riel, the same ADJ now 0.56 in USD', t.currency === null && t.original_amount === null
        && adj2.id === adj.id && near(adj2.cash_dr, 0.56) && adj2.row.currency === null, [t, adj2.row]);
    await checkBalanced('R1 riel corrections');
}

// ---------------------------------------------------------------------------
// 5. Deposits.
// ---------------------------------------------------------------------------
{
    await order('D1', 100, 4);
    let c = await pay('D1', 'Unpaid', { payment_status: 'Deposit', deposit_amount: 30, deposit_date: DAY, amount_received: 30, post_to_ledger: true });
    check('D1 deposit 30 applied', c.applied === true, c);
    let t = await tx('D1', 'កក់ប្រាក់');
    const ref = 'TX-' + t.id;
    let e = await entry(ref);
    check('D1 deposit: Draft DEP 30 / 30, no COGS', e && e.status === 'Draft' && amounts(e, 30, 30, 0) && num(e.nlines) === 2 && /-DEP-/.test(e.entry_number), e);
    const depNumber = e.entry_number;

    c = await pay('D1', 'Deposit', { payment_status: 'Deposit', deposit_amount: 25, expected_deposit_amount: 30, amount_received: 25, post_to_ledger: true, money: khr(102500, 4100, 'កក់ប្រាក់') });
    t = await tx('D1', 'កក់ប្រាក់');
    e = await entry(ref);
    check('D1 lowered to 25: the row is 25 in riel 102,500, returned to the app', near(t.amount, 25) && near(t.original_amount, 102500)
        && (c.transactions_added || []).some(x => x.id === t.id), [t, c]);
    check('D1 lowered to 25: the same Draft DEP entry books 25 / 25 with the riel details', e.entry_number === depNumber && amounts(e, 25, 25, 0)
        && near(e.row.original_amount, 102500) && (c.notices || []).length === 0, e);
    check('D1 lowered to 25: sales.deposit_amount = 25', near((await one(`SELECT deposit_amount FROM sales WHERE id = 'D1'`)).deposit_amount, 25));
    check('D1: only one deposit row', num((await one(`SELECT count(*) AS n FROM transactions WHERE order_id = 'D1'`)).n) === 1);

    await post(ref);
    c = await pay('D1', 'Deposit', { payment_status: 'Deposit', deposit_amount: 20, expected_deposit_amount: 25, amount_received: 20, post_to_ledger: true }, TODAY);
    const adj = await entry(ref + '-ADJ');
    check('D1 lowered to 20 on a Posted DEP: Draft ADJ Dr revenue 5 / Cr cash 5 dated today, DEP-numbered, notice',
        adj && adj.status === 'Draft' && near(adj.rev_dr, 5) && near(adj.cash_cr, 5) && adj.date === TODAY && /-DEP-20261118-/.test(adj.entry_number)
        && /deposit correction/.test(adj.description) && (c.notices || []).length === 1 && /POSTED/.test(c.notices[0]), [adj, c.notices]);
    check("D1 lowered to 20: riel delta on the ADJ at the row's rate (20,500 @ 4,100)", near(adj.row.original_amount, 20500) && adj.row.currency === 'KHR', adj.row);
    check('D1 lowered to 20: the row is 20, the Posted entry still 25', near((await tx('D1', 'កក់ប្រាក់')).amount, 20) && amounts(await entry(ref), 25, 25, 0));

    // A top-up still books a new row and entry (unchanged behaviour).
    c = await pay('D1', 'Deposit', { payment_status: 'Deposit', deposit_amount: 35, expected_deposit_amount: 20, amount_received: 35, post_to_ledger: true }, TODAY);
    const rows = (await q(`SELECT amount FROM transactions WHERE order_id = 'D1' ORDER BY created_at`)).rows.map(r => num(r.amount));
    check('D1 top-up to 35: a second row of 15, the first still 20', rows.length === 2 && near(rows[0], 20) && near(rows[1], 15), rows);
    const t2 = await tx('D1', 'កក់ប្រាក់');
    check('D1 top-up: its own Draft DEP 15', amounts(await entry('TX-' + t2.id), 15, 15, 0));

    // A cut deeper than the newest row is not guessed at.
    const snap = await snapshot('TX-%');
    c = await pay('D1', 'Deposit', { payment_status: 'Deposit', deposit_amount: 10, expected_deposit_amount: 35, amount_received: 10, post_to_ledger: true }, TODAY);
    check('D1 cut to 10 (25 off a 15 row): rows and ledger left, notice says where to correct',
        (await snapshot('TX-%')) === snap && (c.transactions_added || []).length === 0
        && (c.notices || []).length === 1 && /lowered by \$25\.00/.test(c.notices[0]) && /\$15\.00/.test(c.notices[0]), c);
    check('D1 cut to 10: the column still follows the save', near((await one(`SELECT deposit_amount FROM sales WHERE id = 'D1'`)).deposit_amount, 10));
    await checkBalanced('D1 deposits');
}

// ---------------------------------------------------------------------------
// 6. A store without the riel columns (add_khr_currency.sql not run).
// ---------------------------------------------------------------------------
{
    for (const t of ['transactions', 'journal_entries']) {
        await q(`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS ${t}_currency_check`);
        for (const col of ['currency', 'original_amount', 'exchange_rate']) await q(`ALTER TABLE ${t} DROP COLUMN IF EXISTS ${col}`);
    }
    check('no riel columns: op_has_currency_cols is false', (await one(`SELECT wp_internal.op_has_currency_cols('journal_entries') AS b`)).b === false);
    await order('N1', 17);
    await pay('N1', 'Unpaid', { payment_status: 'Paid', amount_received: 17, settle_date: DAY, post_to_ledger: true });
    const t = await tx('N1');
    const ref = 'TX-' + t.id;
    let err = await payErr('N1', 'Paid', { payment_status: 'Paid', amount_received: 19.44, settle_date: DAY, post_to_ledger: true, money: khr(79700) });
    check('no riel columns: a riel correction is accepted', err === '', err);
    check('no riel columns: the row and its Draft entry are 19.44', near((await tx('N1')).amount, 19.44) && amounts(await entry(ref), 19.44, 19.44, 3));
    const snap = await snapshot(ref + '%');
    const again = await pay('N1', 'Paid', { payment_status: 'Paid', amount_received: 19.44, settle_date: DAY, post_to_ledger: true, money: khr(79700) });
    check('no riel columns: the same riel save again writes nothing', (again.transactions_added || []).length === 0 && (await snapshot(ref + '%')) === snap);
    await post(ref);
    err = await payErr('N1', 'Paid', { payment_status: 'Paid', amount_received: 17, settle_date: DAY, money: khr(69700) });
    const adj = await entry(ref + '-ADJ');
    check('no riel columns: a Posted correction books the ADJ (Dr revenue 2.44 / Cr cash 2.44)', err === '' && adj && near(adj.rev_dr, 2.44) && near(adj.cash_cr, 2.44), [err, adj]);
    await checkBalanced('N1 without riel columns');
}

done();
