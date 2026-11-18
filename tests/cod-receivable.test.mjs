// PGlite test of COD receivable booking (migrations/add_cod_receivable.sql +
// the COD branch of migrations/add_order_payment_functions.sql) on the real
// stack in deploy order (tests/fifo-test-db.mjs) and the live column types:
//   * add_cod_receivable.sql is re-runnable: one 1210 account, the
//     sales.cod_collected column;
//   * a receipt the courier collected (p_updates.cod_collected = true)
//     debits 1210 COD receivable (courier), not cash/bank; COGS unchanged;
//     the flag is stored and returned; a receipt without the flag still
//     debits the bank account;
//   * a LED-6 amount correction of a COD receipt keeps the 1210 debit;
//   * flipping the flag on a paid order moves a Draft entry's debit between
//     1210 and the bank (and its line description); a POSTED entry stays
//     with a notice, the column still follows;
//   * a deposit is never COD (the flag is ignored there; the DEP entry
//     debits the bank); settling the remainder as COD debits 1210;
//   * a remittance entry in the shape Accounting › COD remittances writes
//     (Dr 1011 / Cr 1210, Draft, COD-REMIT-…) brings the 1210 balance down;
//   * leaving Paid removes a COD receipt's Draft entry as before;
//   * a store without the 1210 account books cash/bank with a notice naming
//     add_cod_receivable.sql;
//   * create_retail_order stores the flag, and a later settle without the
//     flag reads the stored one;
//   * the FIFO check stays at variance 0 throughout.
// See tests/README.md for how to run it.
import { makeDb, harness, mig, strip } from './fifo-test-db.mjs';
import { lineUuid as SI } from './live-schema.mjs';

const db = await makeDb();
const { q, one, num, near, check, acct, seedLayers, checkBalanced, done } = harness(db);
const DAY = '2026-11-18';

// The live chart has the ABA accounts (add_khr_currency.sql's 1011 and the
// renamed 1010); the harness's full_schema chart does not.
for (const [code, name] of [['1010', 'Bank Account ABA (USD)'], ['1011', 'Bank Account ABA (KHR)']]) {
    await q(`INSERT INTO chart_of_accounts (account_code, account_name, account_type)
             SELECT $1, $2, 'Asset' WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = $1)`, [code, name]);
}

// ---------------------------------------------------------------------------
// 1. The standalone file, twice.
// ---------------------------------------------------------------------------
await db.exec(strip(mig('add_cod_receivable.sql')));
await db.exec(strip(mig('add_cod_receivable.sql')));
check('1210 COD receivable (courier) exists once, as an active Asset',
    num((await one(`SELECT count(*) AS n FROM chart_of_accounts WHERE account_code = '1210'`)).n) === 1
    && (await one(`SELECT account_type, is_active, account_name FROM chart_of_accounts WHERE account_code = '1210'`)).account_type === 'Asset');
check('1210 is not a cash/bank account by name', !/cash|bank/i.test((await one(`SELECT account_name FROM chart_of_accounts WHERE account_code = '1210'`)).account_name));
check('sales.cod_collected exists, default false',
    (await one(`SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'sales' AND column_name = 'cod_collected'`)).column_default === 'false');
check('op_cod_account resolves 1210', (await one(`SELECT wp_internal.op_cod_account() AS id`)).id === await acct('1210'));

await q(`INSERT INTO products (id, name, price, stock, purchase_cost) VALUES ('C', 'Cable', 17, 0, 2)`);
await seedLayers('C', 20, 3, '2026-01-20T00:00:00Z');
await checkBalanced('seeded');

const order = async (id, total, qty = 1, shipping = 'Delivered') => {
    await q(`INSERT INTO sales (id, total, shipping_status, payment_status, shipping_company, customer_snapshot)
             VALUES ($1, $2, $3, 'Unpaid', 'J&T', jsonb_build_object('name', 'Cust ' || $1))`, [id, total, shipping]);
    if (qty > 0) {
        await q(`INSERT INTO sale_items (id, sale_id, product_id, name, price, quantity) VALUES ($1, $2, 'C', 'Cable', $3, $4)`,
            [SI(id + '-a'), id, total / qty, qty]);
    }
};
const pay = async (id, from, updates, today = DAY) => (await one(`SELECT public.set_order_payment(p_order_id => $1, p_expected_status => $2,
    p_updates => $3::jsonb, p_fields => jsonb_build_object('today', $4::text, 'tz_offset_min', 0)) AS r`, [id, from, JSON.stringify(updates), today])).r;
const tx = async (id, cat = 'លក់រាយ') => one(`SELECT to_jsonb(t) AS j FROM transactions t WHERE order_id = $1 AND category = $2
    ORDER BY created_at DESC, id DESC LIMIT 1`, [id, cat]).then(r => r && r.j);
// One entry by reference with its money side split: what sits on 1210, what
// on a cash/bank account, plus revenue and COGS.
const entry = async ref => one(`
    SELECT e.id, e.entry_number, e.date::text AS date, COALESCE(e.status, 'Posted') AS status, e.description, count(l.id) AS nlines,
           COALESCE(sum(l.debit)  FILTER (WHERE a.account_code = '1210'), 0) AS cod_dr,
           COALESCE(sum(l.credit) FILTER (WHERE a.account_code = '1210'), 0) AS cod_cr,
           COALESCE(sum(l.debit)  FILTER (WHERE a.account_type = 'Asset' AND a.account_name ~* '(cash|bank)'), 0) AS bank_dr,
           COALESCE(sum(l.credit) FILTER (WHERE a.account_type = 'Asset' AND a.account_name ~* '(cash|bank)'), 0) AS bank_cr,
           COALESCE(sum(l.credit) FILTER (WHERE a.account_code = '4000'), 0) AS rev_cr,
           COALESCE(sum(l.debit)  FILTER (WHERE a.account_code = '5000'), 0) AS cogs,
           (SELECT string_agg(l2.description, ' | ' ORDER BY l2.created_at, l2.id) FROM journal_entry_lines l2 JOIN chart_of_accounts a2 ON a2.id = l2.account_id
             WHERE l2.journal_entry_id = e.id AND a2.account_type = 'Asset' AND a2.account_code <> '1300') AS money_desc
      FROM journal_entries e
      LEFT JOIN journal_entry_lines l ON l.journal_entry_id = e.id
      LEFT JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE e.reference_id = $1
     GROUP BY e.id`, [ref]);
const entryCount = async like => num((await one(`SELECT count(*) AS n FROM journal_entries WHERE reference_id LIKE $1`, [like])).n);
const post = async ref => q(`UPDATE journal_entries SET status = 'Posted' WHERE reference_id = $1`, [ref]);
const codFlag = async id => (await one(`SELECT cod_collected FROM sales WHERE id = $1`, [id])).cod_collected;
// What the COD remittances page shows at the top: every line on 1210,
// Draft and Posted alike (the receipts are Drafts until the owner posts).
const codBalance = async () => num((await one(`SELECT COALESCE(sum(l.debit - l.credit), 0) AS b FROM journal_entry_lines l
    JOIN chart_of_accounts a ON a.id = l.account_id WHERE a.account_code = '1210'`)).b);

// ---------------------------------------------------------------------------
// 2. A plain receipt still debits the bank; a COD receipt debits 1210.
// ---------------------------------------------------------------------------
{
    await order('N1', 17);
    const r = await pay('N1', 'Unpaid', { payment_status: 'Paid', amount_received: 17, settle_date: DAY, post_to_ledger: true });
    const e = await entry('TX-' + (await tx('N1')).id);
    check('N1 no flag: Draft RCP Dr bank 17 / Cr revenue 17, COGS 3, nothing on 1210',
        r.applied === true && e.status === 'Draft' && near(e.bank_dr, 17) && near(e.rev_cr, 17) && near(e.cogs, 3) && near(e.cod_dr, 0) && num(e.nlines) === 4, e);
    check('N1 no flag: cod_collected false on the row and in the reply', (await codFlag('N1')) === false && r.payment.cod_collected === false, r.payment);

    await order('C1', 17);
    const c = await pay('C1', 'Unpaid', { payment_status: 'Paid', amount_received: 17, settle_date: DAY, post_to_ledger: true, cod_collected: true });
    const t = await tx('C1');
    const ref = 'TX-' + t.id;
    let ce = await entry(ref);
    check('C1 COD: applied, no notice', c.applied === true && (c.notices || []).length === 0, c);
    check('C1 COD: Draft RCP Dr 1210 17 / Cr revenue 17, COGS 3, nothing on cash/bank',
        ce.status === 'Draft' && near(ce.cod_dr, 17) && near(ce.bank_dr, 0) && near(ce.rev_cr, 17) && near(ce.cogs, 3) && num(ce.nlines) === 4, ce);
    check('C1 COD: the money line says the courier holds it', /^COD held by courier — Cust C1$/.test(ce.money_desc), ce.money_desc);
    check('C1 COD: the income row is unchanged (Income, លក់រាយ, 17)', near(t.amount, 17) && t.type === 'Income');
    check('C1 COD: cod_collected true on the row and in the reply', (await codFlag('C1')) === true && c.payment.cod_collected === true, c.payment);
    check('C1 COD: RCP-numbered like any receipt', /^JE-\d+-RCP-20261118-\d+$/.test(ce.entry_number), ce.entry_number);
    await checkBalanced('N1 + C1 settled');

    // LED-6 correction of a COD receipt: the Draft is rewritten, still on 1210.
    const corr = await pay('C1', 'Paid', { payment_status: 'Paid', amount_received: 19.44, settle_date: DAY, post_to_ledger: true, cod_collected: true });
    ce = await entry(ref);
    check('C1 corrected to 19.44: the same Draft entry now Dr 1210 19.44 / Cr revenue 19.44, COGS 3',
        (corr.notices || []).length === 0 && near(ce.cod_dr, 19.44) && near(ce.rev_cr, 19.44) && near(ce.cogs, 3) && near(ce.bank_dr, 0) && num(ce.nlines) === 4, ce);
    check('C1 corrected: no ADJ for a Draft', (await entryCount(ref + '-ADJ')) === 0);

    // The flag flipped off: the Draft entry's debit moves to the bank.
    let f = await pay('C1', 'Paid', { payment_status: 'Paid', cod_collected: false });
    ce = await entry(ref);
    check('C1 flag off: Dr bank 19.44, nothing on 1210, no notice', (f.notices || []).length === 0 && near(ce.bank_dr, 19.44) && near(ce.cod_dr, 0) && near(ce.rev_cr, 19.44), [f.notices, ce]);
    check('C1 flag off: the line reads Receipt again, the column false', /^Receipt — Cust C1$/.test(ce.money_desc) && (await codFlag('C1')) === false, ce.money_desc);
    f = await pay('C1', 'Paid', { payment_status: 'Paid', cod_collected: true });
    ce = await entry(ref);
    check('C1 flag back on: Dr 1210 19.44 again, line says COD', near(ce.cod_dr, 19.44) && near(ce.bank_dr, 0) && /^COD held by courier/.test(ce.money_desc) && (await codFlag('C1')) === true, ce);
    const snapLines = JSON.stringify((await q(`SELECT l.account_id, l.debit, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id WHERE e.reference_id = $1 ORDER BY l.created_at, l.id`, [ref])).rows);
    f = await pay('C1', 'Paid', { payment_status: 'Paid', cod_collected: true });
    check('C1 same flag again: nothing written, no notice', (f.notices || []).length === 0
        && JSON.stringify((await q(`SELECT l.account_id, l.debit, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id WHERE e.reference_id = $1 ORDER BY l.created_at, l.id`, [ref])).rows) === snapLines);

    // Posted: the entry stays, the notice says how to move it, the column follows.
    await post(ref);
    f = await pay('C1', 'Paid', { payment_status: 'Paid', cod_collected: false });
    ce = await entry(ref);
    check('C1 posted, flag off: entry untouched (Dr 1210), notice says POSTED and names the move',
        near(ce.cod_dr, 19.44) && (f.notices || []).length === 1 && /POSTED/.test(f.notices[0]) && /Dr cash\/bank \/ Cr 1210/.test(f.notices[0]), f.notices);
    check('C1 posted, flag off: the column follows the fact', (await codFlag('C1')) === false);
    await checkBalanced('C1 flips');
}

// ---------------------------------------------------------------------------
// 3. Deposits are never COD; the COD remainder is.
// ---------------------------------------------------------------------------
{
    await order('D1', 100, 4);
    const d = await pay('D1', 'Unpaid', { payment_status: 'Deposit', deposit_amount: 30, deposit_date: DAY, amount_received: 30, post_to_ledger: true, cod_collected: true });
    const dep = await entry('TX-' + (await tx('D1', 'កក់ប្រាក់')).id);
    check('D1 deposit with the flag: Draft DEP Dr bank 30, nothing on 1210, flag ignored',
        d.applied === true && near(dep.bank_dr, 30) && near(dep.cod_dr, 0) && num(dep.nlines) === 2 && (await codFlag('D1')) === false && d.payment.cod_collected === false, [dep, d.payment]);
    const s = await pay('D1', 'Deposit', { payment_status: 'Paid', amount_received: 100, settle_date: DAY, post_to_ledger: true, cod_collected: true });
    const rcp = await entry('TX-' + (await tx('D1')).id);
    check('D1 settled as COD: the 70 remainder Dr 1210 70 / Cr revenue 70, COGS 12', s.applied === true && near(rcp.cod_dr, 70) && near(rcp.rev_cr, 70) && near(rcp.cogs, 12) && near(rcp.bank_dr, 0), rcp);
    check('D1: the DEP entry still on the bank', near((await entry('TX-' + (await tx('D1', 'កក់ប្រាក់')).id)).bank_dr, 30));
    check('D1: cod_collected true', (await codFlag('D1')) === true);
    await checkBalanced('D1 deposit + COD remainder');
}

// ---------------------------------------------------------------------------
// 4. The remittance brings 1210 down; leaving Paid removes a COD receipt.
// ---------------------------------------------------------------------------
{
    check('1210 holds 19.44 (C1) + 70 (D1) = 89.44 before any remittance', near(await codBalance(), 89.44), await codBalance());
    // The entry Accounting › COD remittances writes: Dr 1011 (riel at the
    // shop rate) / Cr 1210, Draft, COD-REMIT-<n>.
    const je = (await one(`INSERT INTO journal_entries (date, description, reference_id, status, entry_number)
                           VALUES ($1, 'COD remittance — J&T · REF 123456', 'COD-REMIT-1', 'Draft', 'JE-900-COD-20261118-001') RETURNING id`, [DAY])).id;
    await q(`INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
             ($1, $2, 70, 0, 'Remittance from J&T'), ($1, $3, 0, 70, 'COD remitted — J&T')`, [je, await acct('1011'), await acct('1210')]);
    const rem = await entry('COD-REMIT-1');
    check('remittance: Dr bank 70 / Cr 1210 70', near(rem.bank_dr, 70) && near(rem.cod_cr, 70) && num(rem.nlines) === 2, rem);
    check('1210 now holds 19.44', near(await codBalance(), 19.44), await codBalance());
    await checkBalanced('remittance');

    await order('C2', 34, 2);
    await pay('C2', 'Unpaid', { payment_status: 'Paid', amount_received: 34, settle_date: DAY, post_to_ledger: true, cod_collected: true });
    const ref = 'TX-' + (await tx('C2')).id;
    check('C2 COD settled: 1210 holds 53.44', near(await codBalance(), 53.44) && near((await entry(ref)).cod_dr, 34));
    const u = await pay('C2', 'Paid', { payment_status: 'Unpaid' });
    check('C2 leaving Paid: the row and its Draft COD entry are gone, 1210 back to 19.44',
        u.applied === true && (await tx('C2')) == null && (await entryCount(ref)) === 0 && near(await codBalance(), 19.44), u);
    check('C2 leaving Paid: the flag is kept on the order', (await codFlag('C2')) === true);
    await checkBalanced('C2 left Paid');
}

// ---------------------------------------------------------------------------
// 5. No 1210 account: cash/bank with a notice.
// ---------------------------------------------------------------------------
{
    await q(`UPDATE chart_of_accounts SET is_active = false WHERE account_code = '1210'`);
    await order('X1', 17);
    const r = await pay('X1', 'Unpaid', { payment_status: 'Paid', amount_received: 17, settle_date: DAY, post_to_ledger: true, cod_collected: true });
    const e = await entry('TX-' + (await tx('X1')).id);
    check('X1 without 1210: Dr bank 17, notice names add_cod_receivable.sql', near(e.bank_dr, 17) && near(e.cod_dr, 0)
        && (r.notices || []).length === 1 && /add_cod_receivable\.sql/.test(r.notices[0]), [e, r.notices]);
    check('X1 without 1210: the line reads Receipt', /^Receipt — /.test(e.money_desc), e.money_desc);
    check('X1 without 1210: the flag is still stored', (await codFlag('X1')) === true);
    await q(`UPDATE chart_of_accounts SET is_active = true WHERE account_code = '1210'`);
    await checkBalanced('X1');
}

// ---------------------------------------------------------------------------
// 6. create_retail_order stores the flag; a later settle reads it.
// ---------------------------------------------------------------------------
{
    const made = (await one(`SELECT public.create_retail_order($1::jsonb, $2::jsonb, '{}'::jsonb) AS r`, [
        JSON.stringify({ id: 'K1', total: 17, payment_status: 'Unpaid', shipping_company: 'VET', shipping_status: 'Pending', customer_snapshot: { name: 'Cust K1' }, cod_collected: true }),
        JSON.stringify([{ id: 'C', name: 'Cable', price: 17, quantity: 1 }]),
    ])).r;
    check('K1 created with cod_collected true', made.order_id === 'K1' && (await codFlag('K1')) === true, made);
    const r = await pay('K1', 'Unpaid', { payment_status: 'Paid', amount_received: 17, settle_date: DAY, post_to_ledger: true });
    const e = await entry('TX-' + (await tx('K1')).id);
    check('K1 settled without the flag: the stored flag books Dr 1210', r.applied === true && near(e.cod_dr, 17) && near(e.bank_dr, 0), e);
    const k2 = (await one(`SELECT public.create_retail_order($1::jsonb, $2::jsonb, '{}'::jsonb) AS r`, [
        JSON.stringify({ id: 'K2', total: 17, payment_status: 'Unpaid', customer_snapshot: { name: 'Cust K2' } }),
        JSON.stringify([{ id: 'C', name: 'Cable', price: 17, quantity: 1 }]),
    ])).r;
    check('K2 created without the key: cod_collected false', k2.order_id === 'K2' && (await codFlag('K2')) === false);
    await checkBalanced('K1');
}

done();
