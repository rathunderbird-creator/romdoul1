// PGlite test of migrations/add_khr_currency.sql (riel payments, phases 1-2)
// on the real stack in deploy order (tests/fifo-test-db.mjs) and the live
// column types. First turns the store back into a live one as it is today:
// no currency columns, no riel accounts, and the pack's old
// wp_cash_bank_match without the riel exclusion (Romdoul2/3 cannot re-run
// the FIFO pack). Then:
//   * the file runs twice; the 12 columns, one <table>_currency_check per
//     table, one 1002 "Cash on Hand (KHR)" and one 1011 "Bank Account ABA
//     (KHR)" (sub_type Current Asset);
//   * the check: EUR and KHR without a rate are refused, KHR with a riel
//     amount and rate, USD and NULL pass;
//   * a 1002 that already exists under another name is left alone;
//   * the automatic pick (wp_internal.wp_cash_bank_account) on a
//     Romdoul2/3-like chart (only 1000 Cash) and a Romdoul1-like one
//     (1001 Petty Cash, 1010 Bank Account (ABA)) never lands on a riel
//     account, while an exact riel name still resolves;
//   * a PdFee settled with no account (an old cached app) debits 1000 Cash,
//     not the riel bank;
//   * a bare store without the server payment functions (no wp_internal)
//     loads the file.
// See tests/README.md for how to run it.
import { makeDb, harness, mig, strip } from './fifo-test-db.mjs';
import fs from 'fs';

const db = await makeDb();
const { q, one, check, errOf, done } = harness(db);
const execErr = async sql => { try { await db.exec(sql); return ''; } catch (e) { return String(e.message || e); } };
const TABLES = ['transactions', 'customer_payments', 'supplier_payments', 'journal_entries'];
const COLS = ['currency', 'original_amount', 'exchange_rate'];
const khrSql = strip(mig('add_khr_currency.sql'));

// ── 0. A live store today ──
for (const t of TABLES) {
    await q(`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS ${t}_currency_check`);
    for (const c of COLS) await q(`ALTER TABLE ${t} DROP COLUMN IF EXISTS ${c}`);
}
await q(`DELETE FROM chart_of_accounts WHERE account_code IN ('1002','1011')`);
await db.exec(`CREATE OR REPLACE FUNCTION wp_internal.wp_cash_bank_match(p_re TEXT)
RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT id FROM chart_of_accounts
     WHERE is_active AND account_type = 'Asset' AND account_name ~* '(cash|bank)'
       AND lower(account_name) ~ p_re
     ORDER BY COALESCE(account_code, '') LIMIT 1;
$$;`);
const colCount = async () => Number((await one(`SELECT count(*) AS n FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY($1) AND column_name = ANY($2)`, [TABLES, COLS])).n);
check('live-like store: no currency columns', await colCount() === 0);

// ── 1. Run it twice ──
let e1 = await execErr(khrSql);
check('migration runs', e1 === '', e1);
e1 = await execErr(khrSql);
check('migration runs again', e1 === '', e1);
check('12 currency columns', await colCount() === 12);
const types = (await q(`SELECT table_name, column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY($1) AND column_name = ANY($2)`, [TABLES, COLS])).rows;
check('currency is text, amounts numeric', types.every(r => r.data_type === (r.column_name === 'currency' ? 'text' : 'numeric')), types);
for (const t of TABLES) {
    const n = Number((await one(`SELECT count(*) AS n FROM pg_constraint WHERE conname = $1`, [`${t}_currency_check`])).n);
    check(`one ${t}_currency_check`, n === 1, n);
}
const accts = (await q(`SELECT account_code, account_name, account_type, is_active, sub_type FROM chart_of_accounts
    WHERE account_code IN ('1002','1011') ORDER BY account_code`)).rows;
check('one 1002 Cash on Hand (KHR) and one 1011 Bank Account ABA (KHR)', accts.length === 2
    && accts[0].account_name === 'Cash on Hand (KHR)' && accts[1].account_name === 'Bank Account ABA (KHR)'
    && accts.every(a => a.account_type === 'Asset' && a.is_active && a.sub_type === 'Current Asset'), accts);

// ── 2. The check ──
const ins = (cur, orig, rate) => errOf(`INSERT INTO transactions (id, type, amount, category, description, date, currency, original_amount, exchange_rate)
    VALUES (gen_random_uuid(), 'Income', 20, 'x', 'x', now(), $1, $2, $3)`, [cur, orig, rate]);
check('EUR refused', /currency_check/.test(await ins('EUR', 20, 1)));
check('KHR without a rate refused', /currency_check/.test(await ins('KHR', 82000, null)));
check('KHR with rate 0 refused', /currency_check/.test(await ins('KHR', 82000, 0)));
check('KHR without the riel amount refused', /currency_check/.test(await ins('KHR', null, 4100)));
check('KHR 82000 @ 4100 accepted', await ins('KHR', 82000, 4100) === '');
check('USD accepted', await ins('USD', 20, 1) === '');
check('NULLs accepted (an untagged row)', await ins(null, null, null) === '');
check('customer_payments KHR tag accepted', await errOf(`INSERT INTO customer_payments (id, amount, currency, original_amount, exchange_rate)
    VALUES (gen_random_uuid(), 20, 'KHR', 82000, 4100)`) === '');

// ── 3. An existing 1002 is left alone ──
await q(`DELETE FROM chart_of_accounts WHERE account_code IN ('1002','1011')`);
await q(`INSERT INTO chart_of_accounts (account_code, account_name, account_type) VALUES ('1002', 'Something', 'Asset')`);
await db.exec(khrSql);
const r1002 = (await q(`SELECT account_name, sub_type FROM chart_of_accounts WHERE account_code = '1002'`)).rows;
check('existing 1002 kept, not duplicated, sub_type untouched', r1002.length === 1 && r1002[0].account_name === 'Something' && r1002[0].sub_type === null, r1002);
await q(`DELETE FROM chart_of_accounts WHERE account_code = '1002'`);
await db.exec(khrSql);

// ── 4. The automatic pick, Romdoul2/3-like chart (1000 Cash + the riel pair) ──
const code = async (payBy, preferBank) => (await one(`SELECT a.account_code AS c FROM chart_of_accounts a
    WHERE a.id = wp_internal.wp_cash_bank_account($1, $2)`, [payBy, preferBank]))?.c;
const cashBankNow = (await q(`SELECT account_code FROM chart_of_accounts WHERE account_type = 'Asset' AND account_name ~* '(cash|bank)' AND is_active ORDER BY 1`)).rows.map(r => r.account_code).join(',');
check('R2-like chart: 1000, 1002, 1011', cashBankNow === '1000,1002,1011', cashBankNow);
for (const [payBy, pb] of [[null, true], ['QR', true], ['Cash', true], ['Cash', false], ['Bank Transfer', false], [null, false], ['ABA', false]]) {
    check(`R2-like pick(${payBy}, ${pb}) → 1000`, await code(payBy, pb) === '1000', await code(payBy, pb));
}
check('R2-like exact "Cash on Hand (KHR)" → 1002', await code('Cash on Hand (KHR)', false) === '1002');
check('R2-like exact "Bank Account ABA (KHR)" (preferBank) → 1011', await code('Bank Account ABA (KHR)', true) === '1011');

// ── 5. A PdFee settled with no account debits 1000, not 1011 ──
await db.exec(strip(mig('add_delivery_fee_revenue_account.sql')));
await q(`INSERT INTO sales (id, total, shipping_status, payment_status, customer_snapshot)
         VALUES ('KHR-1', 20, 'Cancelled', 'Unpaid', jsonb_build_object('name', 'Cust KHR'))`);
const res = (await one(`SELECT public.set_order_payment(p_order_id => 'KHR-1', p_expected_status => 'Unpaid',
    p_updates => '{"payment_status":"PdFee","amount_received":2,"settle_date":"2026-11-13","payment_method":"QR"}'::jsonb,
    p_fields => '{"today":"2026-11-13"}'::jsonb) AS r`)).r;
check('PdFee recorded', res && res.success !== false, res);
const dlv = (await q(`SELECT a.account_code, l.debit, l.credit FROM transactions t
    JOIN journal_entries e ON e.reference_id = 'TX-' || t.id
    JOIN journal_entry_lines l ON l.journal_entry_id = e.id
    JOIN chart_of_accounts a ON a.id = l.account_id
   WHERE t.order_id = 'KHR-1' ORDER BY l.debit DESC`)).rows;
check('DLV entry: Dr 1000 2.00 / Cr 4005', dlv.length === 2 && dlv[0].account_code === '1000' && Number(dlv[0].debit) === 2
    && dlv[1].account_code === '4005', dlv);

// ── 6. Romdoul1-like chart: 1001 Petty Cash, 1010 Bank Account (ABA) ──
await q(`UPDATE chart_of_accounts SET is_active = false WHERE account_code = '1000'`);
await q(`INSERT INTO chart_of_accounts (account_code, account_name, account_type) VALUES
    ('1001', 'Petty Cash', 'Asset'), ('1010', 'Bank Account (ABA)', 'Asset')`);
check('R1-like pick(Cash, false) → 1001', await code('Cash', false) === '1001', await code('Cash', false));
check('R1-like pick(NULL, false) → 1001', await code(null, false) === '1001', await code(null, false));
check('R1-like pick(NULL, true) → 1010', await code(null, true) === '1010');
check('R1-like pick(Bank Transfer, false) → 1010', await code('Bank Transfer', false) === '1010');
check('R1-like pick(Cash on Hand, false) → 1001, not 1002', await code('Cash on Hand', false) === '1001');

// ── 7. The pack itself carries the same exclusion ──
const pack = fs.readFileSync(mig('add_wholesale_procurement_functions.sql'), 'utf8');
check('add_wholesale_procurement_functions.sql wp_cash_bank_match skips riel accounts',
    /wp_cash_bank_match\(p_re TEXT\)[\s\S]{0,400}!~\* '\(\\mkhr\\M\|riel\|៛\)'/.test(pack));

// ── 8. A bare store (no server payment functions) ──
{
    const { PGlite } = await import(process.env.PGLITE_DIST || '@electric-sql/pglite');
    const bare = new PGlite();
    await bare.exec(`CREATE TABLE chart_of_accounts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_code TEXT UNIQUE,
        account_name TEXT, account_type TEXT, is_active BOOLEAN DEFAULT true);
        CREATE TABLE transactions (id UUID PRIMARY KEY, amount NUMERIC);
        CREATE TABLE journal_entries (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
        INSERT INTO chart_of_accounts (account_code, account_name, account_type) VALUES ('1000', 'Cash', 'Asset');`);
    let err = '';
    try { await bare.exec(khrSql); await bare.exec(khrSql); } catch (e) { err = String(e.message || e); }
    check('bare store (no wp_internal, no payment tables, no sub_type) loads the file twice', err === '', err);
    const n = Number((await bare.query(`SELECT count(*) AS n FROM chart_of_accounts WHERE account_code IN ('1002','1011')`)).rows[0].n);
    check('bare store gets the two riel accounts', n === 2, n);
    const c = Number((await bare.query(`SELECT count(*) AS n FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = ANY($1)`, [COLS])).rows[0].n);
    check('bare store transactions gets the 3 columns', c === 3, c);
}

done();
