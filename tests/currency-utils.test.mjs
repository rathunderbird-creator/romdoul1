// Unit test of src/utils/currency.ts (riel conversions, the wrong-amount
// warnings, the list line, the missing-column test) and the currency rule
// of src/utils/cashBankAccounts.ts: on the Romdoul1/2/3 charts the USD
// picks are the same with and without the riel accounts 1002/1011, a riel
// pick needs currency 'KHR', and a USD pick never lands on a riel account.
// Transpiled on the fly with the repo's esbuild; see tests/README.md.
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entry = `export * from './src/utils/currency.ts'; export * from './src/utils/cashBankAccounts.ts';`;
const out = await build({
    stdin: { contents: entry, resolveDir: repo, loader: 'ts' },
    bundle: true, format: 'esm', write: false,
});
const bundlePath = path.join(repo, 'tests', '.currency-utils.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const m = await import('file:///' + bundlePath.replace(/\\/g, '/'));
rmSync(bundlePath);

let pass = 0, fail = 0;
const check = (l, c, extra) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c || extra === undefined ? '' : JSON.stringify(extra)); };

// ── defaultCodCollected (the codCollected value every Paid save sends) ──
// The COD box is gone: a Paid save books the picked cash/bank account, and
// courier-held money is Pay Status Collected. True only for a stored true
// or an order at Collected, so a Paid save on those can never re-point
// their booked COD receipt to a bank account.
const cod = m.defaultCodCollected;
const ship = (status, company = 'J&T') => ({ company, status });
check('cod: stored true → on, whatever the state', cod({ codCollected: true, paymentStatus: 'Unpaid', shipping: ship('Confirmed') }) === true && cod({ codCollected: true, paymentStatus: 'Paid', shipping: ship('Confirmed') }) === true);
check('cod: unbooked Get File → off (only Collected is courier money now)', cod({ codCollected: false, paymentStatus: 'Get File', shipping: null }) === false);
check('cod: booked Get File → on through its stored flag', cod({ codCollected: true, paymentStatus: 'Get File', shipping: null }) === true);
check('cod: Collected → on', cod({ codCollected: false, paymentStatus: 'Collected', shipping: ship('Delivered') }) === true);
check('cod: unpaid Delivered courier order → off (courier money is Collected now)', cod({ codCollected: false, paymentStatus: 'Unpaid', shipping: ship('Delivered') }) === false);
check('cod: unpaid Shipped courier order → off', cod({ codCollected: false, paymentStatus: 'Unpaid', shipping: ship('Shipped') }) === false);
check('cod: a COD payment method no longer defaults it on', cod({ codCollected: false, paymentStatus: 'Unpaid', paymentMethod: 'COD', shipping: ship('Shipped') }, ['COD']) === false);
check('cod: Paid with stored false → off', cod({ codCollected: false, paymentStatus: 'Paid', shipping: ship('Delivered') }) === false);
check('cod: flag undefined, Delivered courier → off', cod({ paymentStatus: 'Unpaid', shipping: ship('Delivered') }) === false);
check('cod: Deposit Shipped courier → off', cod({ codCollected: false, paymentStatus: 'Deposit', shipping: ship('Shipped') }) === false);
check('cod: PdFee Delivered courier → off', cod({ codCollected: false, paymentStatus: 'PdFee', shipping: ship('Delivered') }) === false);

// ── getFileBooksCod (Sales Setup: couriers whose Get File books the COD receipt) ──
const gf = m.getFileBooksCod;
check('getFileBooksCod: ticked courier → true', gf(['J&T'], 'J&T') === true);
check('getFileBooksCod: case and spaces ignored', gf([' j&t '], 'J&T ') === true);
check('getFileBooksCod: another courier → false', gf(['J&T'], 'VET') === false);
check('getFileBooksCod: no list / empty list → false', gf(undefined, 'J&T') === false && gf([], 'J&T') === false);
check('getFileBooksCod: no courier on the order → false', gf(['J&T'], '') === false && gf(['J&T'], null) === false && gf([''], '') === false);
const ct = m.codTicksFor;
check('codTicksFor: returns the stored spelling to untick', JSON.stringify(ct([' j&t ', 'VET'], 'J&T')) === JSON.stringify([' j&t ']));
check('codTicksFor: unticked courier → nothing to send', ct(['J&T'], 'VET').length === 0 && ct(undefined, 'VET').length === 0);
check('codTicksFor: blank courier → nothing', ct(['', 'J&T'], ' ').length === 0);

// ── codReceiptDebitId (Post Now keeps a COD receipt on 1210) ──
const POOL = [
    { id: 'aba', account_code: '1011', account_name: 'ABA Bank', account_type: 'Asset' },
    { id: 'cod', account_code: '1210', account_name: 'COD receivable (courier)', account_type: 'Asset' },
];
const cr = m.codReceiptDebitId;
check('codReceiptDebitId: Draft debiting 1210 keeps 1210', cr(POOL, { oldDebitAccountIds: ['cod', 'cogs'] }) === 'cod');
check('codReceiptDebitId: Draft debiting the bank stays as picked', cr(POOL, { oldDebitAccountIds: ['aba', 'cogs'] }) === undefined);
check('codReceiptDebitId: a Draft wins over the order flag', cr(POOL, { oldDebitAccountIds: ['aba'], saleCod: true }) === undefined);
check('codReceiptDebitId: fresh entry, COD order → 1210', cr(POOL, { saleCod: true }) === 'cod');
check('codReceiptDebitId: fresh entry, not COD → picked account', cr(POOL, { saleCod: false }) === undefined && cr(POOL, {}) === undefined);
check('codReceiptDebitId: store without 1210 → picked account', cr(POOL.filter(a => a.id !== 'cod'), { saleCod: true }) === undefined);

// ── Sales Setup default deposit account (defaultId) ──
const DPOOL = [
    { id: 'coh', account_code: '1001', account_name: 'Cash on Hand', account_type: 'Asset' },
    { id: 'cohk', account_code: '1002', account_name: 'Cash on Hand (KHR)', account_type: 'Asset' },
    { id: 'aba', account_code: '1011', account_name: 'ABA Bank', account_type: 'Asset' },
    { id: 'acl', account_code: '1012', account_name: 'ACLEDA Bank', account_type: 'Asset' },
    { id: 'abak', account_code: '1013', account_name: 'ABA Bank (KHR)', account_type: 'Asset' },
    { id: 'cod', account_code: '1210', account_name: 'COD receivable (courier)', account_type: 'Asset' },
];
const pk = (payBy, o) => m.pickCashBankAccount(DPOOL, payBy, { preferBank: true, ...o })?.id;
check('default: unset → bank as before', pk('QR', { currency: 'USD' }) === 'aba');
check('default: set → a non-cash method goes to it', pk('QR', { currency: 'USD', defaultId: 'acl' }) === 'acl' && pk('Bank', { currency: 'USD', defaultId: 'acl' }) === 'acl');
check('default: a Cash method still goes to Cash on Hand', pk('Cash', { currency: 'USD', defaultId: 'acl' }) === 'coh');
check('default: riel Cash → riel Cash on Hand', pk('Cash', { currency: 'KHR', defaultId: 'abak' }) === 'cohk');
check('default: a method named exactly like an account wins', pk('ABA Bank', { currency: 'USD', defaultId: 'acl' }) === 'aba');
check('default: COD still lands on 1210', pk('QR', { currency: 'USD', defaultId: 'acl', cod: true }) === 'cod');
check('default: a riel default is ignored for a USD payment', pk('QR', { currency: 'USD', defaultId: 'abak' }) === 'aba');
check('default: a missing / deactivated id is ignored', pk('QR', { currency: 'USD', defaultId: 'gone' }) === 'aba');
check('default: the receivable is never a deposit default', pk('QR', { currency: 'USD', defaultId: 'cod' }) === 'aba');
const dd = (o) => m.defaultCashBankAccountId(DPOOL, o);
check('modal default: unset → first bank', dd({ currency: 'USD' }) === 'aba');
check('modal default: set → the default', dd({ currency: 'USD', defaultId: 'acl' }) === 'acl');
check('modal default: a re-opened payment keeps its account', dd({ currency: 'USD', preferredId: 'aba', defaultId: 'acl' }) === 'aba');
check('modal default: cash hint → Cash on Hand', dd({ currency: 'USD', hint: 'Cash', cashHint: true, defaultId: 'acl' }) === 'coh');
check('modal default: riel default only for riel', dd({ currency: 'KHR', defaultId: 'abak' }) === 'abak' && dd({ currency: 'USD', defaultId: 'abak' }) === 'aba');
const DPOOL2 = [...DPOOL, { id: 'pet', account_code: '1003', account_name: 'Petty Cash', account_type: 'Asset' }];
check('default: Petty Cash is never a deposit default', m.pickCashBankAccount(DPOOL2, 'QR', { preferBank: true, currency: 'USD', defaultId: 'pet' })?.id === 'aba'
    && m.defaultCashBankAccountId(DPOOL2, { currency: 'USD', defaultId: 'pet' }) === 'aba');
check('modal default: method Cash → Cash on Hand (only with a default)', dd({ currency: 'USD', defaultId: 'acl', method: 'Cash' }) === 'coh'
    && dd({ currency: 'USD', method: 'Cash' }) === 'aba');
const fm = (cur, prev, next, o) => m.followMethodAccount(DPOOL, cur, prev, next, o);
check('follow: auto pick moves Bank → Cash', fm('acl', 'Bank', 'Cash', { currency: 'USD', defaultId: 'acl' }) === 'coh');
check('follow: and back Cash → QR', fm('coh', 'Cash', 'QR', { currency: 'USD', defaultId: 'acl' }) === 'acl');
check('follow: a user pick is left alone', fm('aba', 'Bank', 'Cash', { currency: 'USD', defaultId: 'acl' }) === undefined);
check('follow: no default → no change (as before)', fm('aba', 'Bank', 'Cash', { currency: 'USD' }) === undefined);
check('follow: riel', fm('abak', 'Bank', 'Cash', { currency: 'KHR', defaultId: 'abak' }) === 'cohk');
const cp = (cur, target, d) => m.counterpartAccount(DPOOL, cur, target, d)?.id;
check('toggle: bank → riel default', cp('acl', 'KHR', { usd: 'acl', khr: 'abak' }) === 'abak' && cp('aba', 'KHR', { khr: 'abak' }) === 'abak');
check('toggle: riel → USD default', cp('abak', 'USD', { usd: 'acl', khr: 'abak' }) === 'acl');
check('toggle: cash stays cash', cp('coh', 'KHR', { usd: 'acl', khr: 'abak' }) === 'cohk');
check('toggle: no defaults → as before (first bank of the family)', cp('acl', 'KHR') === 'abak' && cp('abak', 'USD') === 'aba');
const NOCOH = [{ id: 'pet', account_code: '1001', account_name: 'Petty Cash', account_type: 'Asset' }, { id: 'aba', account_code: '1011', account_name: 'ABA Bank', account_type: 'Asset' }, { id: 'acl', account_code: '1012', account_name: 'ACLEDA Bank', account_type: 'Asset' }];
check('default: Cash with no Cash on Hand never lands on Petty Cash', m.pickCashBankAccount(NOCOH, 'Cash', { preferBank: true, currency: 'USD', defaultId: 'acl' })?.id === 'acl'
    && m.defaultCashBankAccountId(NOCOH, { currency: 'USD', defaultId: 'acl', method: 'Cash' }) === 'acl');
check('toggle: a cash default moves to the other currency default', cp('coh', 'KHR', { usd: 'coh', khr: 'abak' }) === 'abak');
check('depositDefaultFor picks by currency', m.depositDefaultFor({ defaultDepositAccountId: 'u', defaultDepositAccountIdKhr: 'k' }, 'KHR') === 'k'
    && m.depositDefaultFor({ defaultDepositAccountId: 'u' }, 'USD') === 'u' && m.depositDefaultFor({ defaultDepositAccountId: 'u' }, undefined) === 'u'
    && m.depositDefaultFor({ defaultDepositAccountId: '' }, 'USD') === undefined && m.depositDefaultFor(null, 'KHR') === undefined);

// ── conversions ──
check('khrToUsd 82000 @ 4100 = 20', m.khrToUsd(82000, 4100) === 20);
check('khrToUsd 4269000 @ 4100 = 1041.22 (rounded to cents)', m.khrToUsd(4269000, 4100) === 1041.22);
check('khrToUsd with rate 0 = 0', m.khrToUsd(82000, 0) === 0);
check('usdToKhr 17 @ 4100 = 69700', m.usdToKhr(17, 4100) === 69700);
check('usdToKhr 1.95 @ 4100 = 8000 (100-riel steps)', m.usdToKhr(1.95, 4100) === 8000);
check('shopRate undefined → 4100', m.shopRate(undefined) === 4100);
check('shopRate 0 → 4100', m.shopRate(0) === 4100);
check('shopRate -1 → 4100', m.shopRate(-1) === 4100);
check('shopRate "abc" → 4100', m.shopRate('abc') === 4100);
check('shopRate 4000 → 4000', m.shopRate(4000) === 4000);
check('formatKhr', m.formatKhr(82000) === '៛82,000');
check('formatUsd', m.formatUsd(1041.2) === '$1,041.20' && m.formatUsd(-2) === '-$2.00');

const sp = m.splitRiel(82000, [10, 5, 5]);
check('splitRiel in proportion, adds up', sp.join(',') === '41000,20500,20500', sp);
const sp2 = m.splitRiel(100000, [1, 1, 1]);
check('splitRiel remainder on the last part', sp2.reduce((s, x) => s + x, 0) === 100000 && sp2[2] === 33334, sp2);

// ── warnings ──
const w1 = m.checkUsdAmount(8000, { rate: 4100, maxPlausibleUsd: 15 });
check('8000 in a USD delivery fee → usd-looks-riel, ៛8,000 = $1.95', w1 && w1.kind === 'usd-looks-riel' && w1.asRielUsd === 1.95, w1);
check('2 in a USD delivery fee → no warning', m.checkUsdAmount(2, { rate: 4100, maxPlausibleUsd: 15 }) === null);
check('16 over a $15 max → over-max warning', m.checkUsdAmount(16, { rate: 4100, maxPlausibleUsd: 15 })?.reason === 'over-max');
check('1041.22 with no max → no warning', m.checkUsdAmount(1041.22, { rate: 4100 }) === null);
check('2000 with no max → riel-shaped warning', m.checkUsdAmount(2000, { rate: 4100 })?.reason === 'riel-shaped');
check('1050 with no max → no warning (not a multiple of 100)', m.checkUsdAmount(1050, { rate: 4100 }) === null);
check('0 → no warning', m.checkUsdAmount(0, { rate: 4100 }) === null);
const k1 = m.checkKhrAmount(20, { rate: 4100 });
check('៛20 → khr-looks-usd ($20 = ៛82,000)', k1 && k1.kind === 'khr-looks-usd' && k1.asKhr === 82000 && k1.asUsd === 20, k1);
check('៛82000 → no warning', m.checkKhrAmount(82000, { rate: 4100 }) === null);
check('៛8000.5 → warning (decimals)', m.checkKhrAmount(8000.5, { rate: 4100 })?.kind === 'khr-looks-usd');
check('rate 0 → invalid', m.checkRate(0, 4100) === 'invalid');
check('rate NaN → invalid', m.checkRate(NaN, 4100) === 'invalid');
check('rate 4000 → ok', m.checkRate(4000, 4100) === null);
check('rate 41 → rate-off', m.checkRate(41, 4100)?.kind === 'rate-off');
const text = m.amountWarningText(w1);
check('confirm text shows both readings', text.includes('$8,000.00') && text.includes('៛8,000 = $1.95'), text);
check('confirm text uses a translator when it answers', m.amountWarningText(w1, k => k === 'money.usdLooksRielConfirm' ? 'KM {{asUsd}}' : k) === 'KM $8,000.00');
check('confirm text falls back to English when the key is missing', m.amountWarningText(w1, k => k).includes('$8,000.00'));

// ── formatMoneyLine ──
check('KHR exact line', m.formatMoneyLine({ amount: 20, currency: 'KHR', original_amount: 82000, exchange_rate: 4100 }) === '៛82,000 @ 4,100 = $20.00');
check('KHR booked line', m.formatMoneyLine({ amount: 20, currency: 'KHR', original_amount: 80000, exchange_rate: 4100 }) === '៛80,000 @ 4,100 → $20.00 booked');
check('USD line', m.formatMoneyLine({ amount: 20, currency: 'USD', original_amount: 20, exchange_rate: 1 }) === '$20.00');
check('untagged line', m.formatMoneyLine({ amount: 2 }) === '$2.00');
check('KHR without a rate shows as USD', m.formatMoneyLine({ amount: 2, currency: 'KHR', original_amount: 8000, exchange_rate: null }) === '$2.00');

// ── resolveMoney ──
let r = m.resolveMoney({ amount: '82,000', currency: 'KHR', rate: 4100 });
check('resolveMoney KHR', r.usd === 20 && r.meta.currency === 'KHR' && r.meta.original_amount === 82000 && r.meta.exchange_rate === 4100, r);
r = m.resolveMoney({ amount: '2.005', currency: 'USD', rate: 4100 });
check('resolveMoney USD rounds to cents, meta USD/1', r.usd === 2.01 && r.meta.currency === 'USD' && r.meta.exchange_rate === 1, r);
r = m.resolveMoney({ amount: 82100, currency: 'KHR', rate: 4100, snapToUsd: 20 });
check('within $0.03 of the target books the target', r.usd === 20 && Math.abs(r.diffUsd - 0.02) < 1e-9, r);
r = m.resolveMoney({ amount: 80000, currency: 'KHR', rate: 4100, snapToUsd: 20 });
check('outside $0.03 books riel/rate, diff -0.49', r.usd === 19.51 && Math.abs(r.diffUsd + 0.49) < 1e-9, r);
r = m.resolveMoney({ amount: 82000, currency: 'KHR', rate: 0 });
check('rate 0 falls back to the 4100 default', r.meta.exchange_rate === 4100 && r.usd === 20, r);

// ── missing-column errors ──
check('PGRST204 currency column → missing', m.isMissingCurrencyColumnError({ code: 'PGRST204', message: "Could not find the 'currency' column of 'transactions' in the schema cache" }));
check('42703 original_amount → missing', m.isMissingCurrencyColumnError({ code: '42703', message: 'column "original_amount" of relation "transactions" does not exist' }));
check('unrelated column error → not missing', !m.isMissingCurrencyColumnError({ code: '42703', message: 'column "foo" does not exist' }));
check('network error → not missing', !m.isMissingCurrencyColumnError({ message: 'Failed to fetch' }));
check('null → not missing', !m.isMissingCurrencyColumnError(null));
const s = m.stripCurrency({ a: 1, currency: 'KHR', original_amount: 1, exchange_rate: 2 });
check('stripCurrency', JSON.stringify(s) === '{"a":1}');

// ── account currency ──
check('isKhrAccountName "Cash on Hand (KHR)"', m.isKhrAccountName('Cash on Hand (KHR)'));
check('isKhrAccountName "Bank Account ABA (KHR)"', m.isKhrAccountName('Bank Account ABA (KHR)'));
check('isKhrAccountName "Riel cash"', m.isKhrAccountName('Riel cash'));
check('not KHR: "Bank Account (ABA)"', !m.isKhrAccountName('Bank Account (ABA)'));
check('not KHR: "Khronos" (word boundary)', !m.isKhrAccountName('Khronos Cash'));

// ── pickers on the live charts ──
const A = (id, code, name, type = 'Asset') => ({ id, account_code: code, account_name: name, account_type: type });
const KHR = [A('k1002', '1002', 'Cash on Hand (KHR)'), A('k1011', '1011', 'Bank Account ABA (KHR)')];
const R1 = [A('a1001', '1001', 'Petty Cash'), A('a1010', '1010', 'Bank Account (ABA)'), A('a1200', '1200', 'Accounts Receivable')];
const R2 = [A('a1000', '1000', 'Cash'), A('a1200', '1200', 'Accounts Receivable')];
const pick = (pool, hint, opts) => m.pickCashBankAccount(pool, hint, opts)?.id;
const cases = [
    [null, { preferBank: true }], ['QR', { preferBank: true }], ['Cash', { preferBank: true }], ['Bank', { preferBank: true }],
    [null, {}], ['Cash', {}], ['QR', {}], ['Bank Transfer', {}], ['Bank', {}], ['ABA', {}], ['Cash on Hand', {}],
    ['Bank Account (ABA)', {}], ['Petty Cash', {}], ['Cash', { preferBank: false }],
];
for (const [store, chart] of [['R1', R1], ['R2', R2], ['R3', R2]]) {
    for (const [hint, opts] of cases) {
        const before = pick(chart, hint, opts);
        const after = pick([...chart, ...KHR], hint, opts);
        check(`${store} pick(${hint}, ${JSON.stringify(opts)}) unchanged with the riel accounts (${before})`, before === after, { before, after });
    }
}
check('R1 Cash hint → 1001 Petty Cash', pick([...R1, ...KHR], 'Cash', {}) === 'a1001');
check('R1 no hint → 1001', pick([...R1, ...KHR], null, {}) === 'a1001');
check('R1 preferBank → 1010', pick([...R1, ...KHR], null, { preferBank: true }) === 'a1010');
check('R2 preferBank → 1000 Cash, not the riel bank', pick([...R2, ...KHR], 'QR', { preferBank: true }) === 'a1000');
check('KHR preferBank → 1011', pick([...R2, ...KHR], null, { preferBank: true, currency: 'KHR' }) === 'k1011');
check('KHR cash hint → 1002', pick([...R2, ...KHR], 'Cash', { currency: 'KHR' }) === 'k1002');
check('exact riel name resolves without asking KHR', pick([...R2, ...KHR], 'Cash on Hand (KHR)', { preferBank: true }) === 'k1002');
check('only riel accounts: a USD pick → undefined', pick(KHR, 'Cash', { preferBank: true }) === undefined);
check('no riel accounts: a KHR pick → undefined', pick(R2, 'Cash', { currency: 'KHR' }) === undefined);

// ── modal default parity (the old "first name containing bank" default) ──
const oldDefault = (accts, preferredId, hint, cashHint) => {
    const pa = accts.filter(a => a.account_type === 'Asset' && /cash|bank/i.test(a.account_name));
    const h = (hint || '').trim().toLowerCase();
    const p = (preferredId && pa.find(a => a.id === preferredId))
        || (h ? pa.find(a => a.account_name.toLowerCase() === h) : undefined)
        || (cashHint && h.includes('cash') ? pa.find(a => /cash/i.test(a.account_name)) : undefined)
        || pa.find(a => a.account_name.toLowerCase().includes('bank'))
        || pa[0];
    return p?.id || '';
};
for (const [store, chart] of [['R1', R1], ['R2', R2]]) {
    for (const [pref, hint, cashHint] of [[null, null, false], [null, 'Cash', true], [null, 'Bank', true], ['a1001', null, false], [null, 'Petty Cash', true]]) {
        const before = oldDefault(chart, pref, hint, cashHint);
        const after = m.defaultCashBankAccountId([...chart, ...KHR], { preferredId: pref, hint, cashHint });
        check(`${store} modal default (${pref}, ${hint}) unchanged with the riel accounts (${before})`, before === after, { before, after });
    }
}
check('modal default in KHR → 1011', m.defaultCashBankAccountId([...R1, ...KHR], { currency: 'KHR' }) === 'k1011');
check('modal default, only riel accounts, USD → ""', m.defaultCashBankAccountId(KHR, {}) === '');
check('counterpart of R1 bank in KHR → 1011', m.counterpartAccount([...R1, ...KHR], 'a1010', 'KHR')?.id === 'k1011');
check('counterpart of R1 Petty Cash in KHR → 1002', m.counterpartAccount([...R1, ...KHR], 'a1001', 'KHR')?.id === 'k1002');
check('counterpart of 1011 in USD on R2 → 1000', m.counterpartAccount([...R2, ...KHR], 'k1011', 'USD')?.id === 'a1000');
check('counterpart in KHR without riel accounts → undefined', m.counterpartAccount(R2, 'a1000', 'KHR') === undefined);
const sorted = m.sortCashBankForPicker([...KHR, ...R1]).map(a => a.account_code).join(',');
check('picker order: USD by code, then riel', sorted === '1001,1010,1200,1002,1011', sorted);

// ── Posting a riel row (RecordReceipt finalize): the hint is the row's
// pay_by, often a USD account's name ('Cash' is 1000 on Romdoul2/3). With a
// currency given, the hint and the preferred id count only in that currency.
check('R2 finalize KHR row, hint "Cash" → 1002 (not 1000 Cash)', m.defaultCashBankAccountId([...R2, ...KHR], { hint: 'Cash', cashHint: true, currency: 'KHR' }) === 'k1002');
check('R1 finalize KHR row, hint "Cash" → 1002', m.defaultCashBankAccountId([...R1, ...KHR], { hint: 'Cash', cashHint: true, currency: 'KHR' }) === 'k1002');
check('R2 finalize KHR row, hint "Bank" → 1011', m.defaultCashBankAccountId([...R2, ...KHR], { hint: 'Bank', cashHint: true, currency: 'KHR' }) === 'k1011');
check('USD receipt, preferred id a riel account → USD default', m.defaultCashBankAccountId([...R1, ...KHR], { preferredId: 'k1002', currency: 'USD' }) === 'a1010');
check('USD receipt, hint a riel name → USD default', m.defaultCashBankAccountId([...R2, ...KHR], { hint: 'Cash on Hand (KHR)', cashHint: true, currency: 'USD' }) === 'a1000');
check('USD receipt, hint "Cash" on R2 → 1000', m.defaultCashBankAccountId([...R2, ...KHR], { hint: 'Cash', cashHint: true, currency: 'USD' }) === 'a1000');
for (const [store, chart] of [['R1', R1], ['R2', R2]]) {
    for (const [pref, hint] of [[null, null], [null, 'Cash'], [null, 'Bank'], ['a1001', null], [null, 'Petty Cash']]) {
        const before = oldDefault(chart, pref, hint, true);
        const after = m.defaultCashBankAccountId([...chart, ...KHR], { preferredId: pref, hint, cashHint: true, currency: 'USD' });
        check(`${store} USD receipt default (${pref}, ${hint}) unchanged with the riel accounts (${before})`, before === after, { before, after });
    }
}

// ── Editing a row keeps its booked USD unless the figure changes ──
const settled = { amount: 20, currency: 'KHR', original_amount: 80000, exchange_rate: 4100 };
check('edit, riel and rate unchanged → keeps $20.00 (not 19.51)', m.editedBookedUsd(settled, { currency: 'KHR', amount: '80000', rate: '4100' }) === 20);
check('edit, riel changed → converts again', m.editedBookedUsd(settled, { currency: 'KHR', amount: '82000', rate: '4100' }) === 20 && m.editedBookedUsd(settled, { currency: 'KHR', amount: '41000', rate: '4100' }) === 10);
check('edit, rate changed → converts again', m.editedBookedUsd(settled, { currency: 'KHR', amount: '80000', rate: '4000' }) === 20 && m.editedBookedUsd(settled, { currency: 'KHR', amount: '80000', rate: '3200' }) === 25);
check('edit, switched to USD → the typed dollars', m.editedBookedUsd(settled, { currency: 'USD', amount: '20', rate: '' }) === 20);
check('edit, USD row unchanged keeps an unrounded legacy amount', m.editedBookedUsd({ amount: 1041.219512 }, { currency: 'USD', amount: '1041.219512' }) === 1041.219512);
check('edit, USD row changed → rounded to cents', m.editedBookedUsd({ amount: 10 }, { currency: 'USD', amount: '12.345' }) === 12.35);
check('edit, untagged row given riel → converts', m.editedBookedUsd({ amount: 20 }, { currency: 'KHR', amount: '82000', rate: '4100' }) === 20);

// ── Confirm text when the form books a fixed USD (Settle) ──
const small = m.checkKhrAmount(5, { rate: 4100 });
const fixedText = m.amountWarningText(small, undefined, 20);
check('Settle confirm says it books the $20.00 due, not $0.00', fixedText.includes('OK books $20.00') && !fixedText.includes('OK books $0.00'), fixedText);
check('Settle confirm still shows both readings', fixedText.includes('As riel: ៛5') && fixedText.includes('As dollars: $5.00'), fixedText);
check('no fixed amount → the typed figure\'s USD', m.amountWarningText(small).includes('OK books $0.00'));
check('fixed line translates', m.amountWarningText(small, k => (k === 'money.fixedBooksConfirm' ? 'KM {{booked}} {{typed}}' : k), 20).endsWith('KM $20.00 ៛5'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
