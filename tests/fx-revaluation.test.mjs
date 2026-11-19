// Unit test of src/utils/fxRevaluation.ts (riel payments, phase 3: FX gain
// and loss). Riel balances read from the journal (a KHR-tagged line carries
// the entry's riel, split by USD share; a revaluation carries none; an
// untagged line counts at the fallback rate and is reported; Drafts and
// later dates left out when asked), the revaluation rows and entry (net to
// the gain or the loss account, nothing when nothing moves), the riel book
// value at the account's average rate, and the exchange entry (selling riel
// realises a gain or loss, buying riel none). Every entry built balances.
// Transpiled on the fly with the repo's esbuild; see tests/README.md.
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = await build({
    stdin: { contents: `export * from './src/utils/fxRevaluation.ts'; export * from './src/utils/systemEntries.ts';`, resolveDir: repo, loader: 'ts' },
    bundle: true, format: 'esm', write: false,
});
const bundlePath = path.join(repo, 'tests', '.fx-revaluation.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const m = await import('file:///' + bundlePath.replace(/\\/g, '/'));
rmSync(bundlePath);

let pass = 0, fail = 0;
const check = (l, c, extra) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c || extra === undefined ? '' : JSON.stringify(extra)); };
const balanced = lines => Math.abs(lines.reduce((s, l) => s + l.debit - l.credit, 0)) < 0.005;
const near = (a, b) => Math.abs(a - b) < 0.005;

// Accounts: 1011 ABA riel, 1002 cash riel, 1010 ABA USD, 1210 COD, 5xxx expense.
const ABA_R = 'aba-r', CASH_R = 'cash-r', ABA_U = 'aba-u', COD = 'cod', EXP = 'exp', GAIN = 'gain', LOSS = 'loss';
const entries = new Map();
const lines = [];
let n = 0;
const post = (date, cur, riel, rate, ls, { status = 'Posted', ref = null } = {}) => {
    const id = `e${++n}`;
    entries.set(id, { id, date, status, reference_id: ref ?? `TX-${id}`, currency: cur, original_amount: riel, exchange_rate: rate });
    for (const [acc, dr, cr] of ls) lines.push({ entryId: id, accountId: acc, debit: dr, credit: cr });
    return id;
};

// 1. ៛82,000 @ 4,100 = $20 into ABA riel (COD remittance).
post('2026-11-01', 'KHR', 82000, 4100, [[ABA_R, 20, 0], [COD, 0, 20]]);
// 2. ៛41,000 @ 4,000 = $10.25 into ABA riel.
post('2026-11-02', 'KHR', 41000, 4000, [[ABA_R, 10.25, 0], [COD, 0, 10.25]]);
// 3. Expense ៛20,500 @ 4,100 = $5 paid from ABA riel.
post('2026-11-03', 'KHR', 20500, 4100, [[EXP, 5, 0], [ABA_R, 0, 5]]);
// 4. Transfer ៛10,000 riel cash → ABA riel (both sides riel), $2.44.
post('2026-11-04', 'KHR', 10000, 4100, [[ABA_R, 2.44, 0], [CASH_R, 0, 2.44]]);
// 5. An untagged manual journal on riel cash: $3 in.
post('2026-11-05', null, null, null, [[CASH_R, 3, 0], [ABA_U, 0, 3]], { ref: 'MAN-1' });
// 6. A Draft riel receipt.
post('2026-11-06', 'KHR', 4100, 4100, [[ABA_R, 1, 0], [COD, 0, 1]], { status: 'Draft' });
// 7. A later receipt (after the as-of date used below).
post('2026-11-20', 'KHR', 8200, 4100, [[ABA_R, 2, 0], [COD, 0, 2]]);
// 8. A riel split over two riel lines on one side: ៛30,000 → $5 ABA + $2.32 cash... (one side two riel lines).
post('2026-11-07', 'KHR', 30000, 4100, [[ABA_R, 5, 0], [CASH_R, 2.32, 0], [COD, 0, 7.32]]);

const RIEL_IDS = [ABA_R, CASH_R];
const bal = m.rielBalances(lines, entries, RIEL_IDS, { asOf: '2026-11-10', postedOnly: true, fallbackRate: 4100 });
const a = bal.get(ABA_R), c = bal.get(CASH_R);
// ABA riel: 82,000 + 41,000 − 20,500 + 10,000 + split share.
const split = Math.round(30000 * 5 / 7.32);
check('ABA riel: riel balance from tagged entries', a.riel === 82000 + 41000 - 20500 + 10000 + split, a);
check('ABA riel: USD balance is the ledger', near(a.usd, 20 + 10.25 - 5 + 2.44 + 5), a);
check('ABA riel: Draft left out and counted', a.draftLines === 1, a);
check('ABA riel: no untagged lines', a.untaggedLines === 0, a);
check('cash riel: transfer out, untagged in at fallback, split share', c.riel === -10000 + 3 * 4100 + (30000 - split), c);
check('cash riel: untagged entry reported', c.untaggedLines === 1 && c.untaggedEntryIds.length === 1, c);
check('split over two riel lines adds up to the riel received', split + (30000 - split) === 30000);

const all = m.rielBalances(lines, entries, RIEL_IDS, { fallbackRate: 4100 });
check('no bound: Draft and later rows counted', all.get(ABA_R).riel === a.riel + 4100 + 8200 && all.get(ABA_R).draftLines === 0, all.get(ABA_R));

// A revaluation entry moves dollars, not riel.
const before = m.rielBalances(lines, entries, RIEL_IDS, { asOf: '2026-11-10', postedOnly: true, fallbackRate: 4100 });
const rows = m.revaluationRows(before.values(), 4000);
const aRow = rows.find(r => r.accountId === ABA_R);
check('revaluation row: value = riel / rate', near(aRow.valueUsd, Math.round(a.riel / 4000 * 100) / 100), aRow);
check('revaluation row: diff = value − book', near(aRow.diffUsd, aRow.valueUsd - aRow.bookUsd), aRow);
const rv = m.revaluationLines(rows, { gainId: GAIN, lossId: LOSS }, { account: id => id, rateText: '៛4,000' });
check('revaluation entry balances', balanced(rv.lines), rv);
check('revaluation net = sum of differences', near(rv.net, rows.reduce((s, r) => s + r.diffUsd, 0)), rv);
const fxLine = rv.lines.find(l => l.account_id === GAIN || l.account_id === LOSS);
check('revaluation net lands on gain (credit) or loss (debit)', rv.net > 0 ? fxLine.account_id === GAIN && fxLine.credit > 0 : fxLine.account_id === LOSS && fxLine.debit > 0, rv);
const revId = post('2026-11-10', null, null, null, rv.lines.map(l => [l.account_id, l.debit, l.credit]), { ref: `${m.FX_REVAL_PREFIX}20261110-1` });
const after = m.rielBalances(lines, entries, RIEL_IDS, { asOf: '2026-11-10', postedOnly: true, fallbackRate: 4100 });
check('after the revaluation: riel unchanged', after.get(ABA_R).riel === a.riel && after.get(CASH_R).riel === c.riel);
check('after the revaluation: untagged count unchanged (revaluation not reported)', after.get(CASH_R).untaggedLines === 1);
const again = m.revaluationRows(after.values(), 4000);
check('revaluing again at the same rate moves nothing', again.every(r => r.diffUsd === 0), again);
check('…and builds no entry', m.revaluationLines(again, { gainId: GAIN, lossId: LOSS }, { account: id => id, rateText: 'x' }).lines.length === 0);
entries.delete(revId);

// Loss direction: riel worth less (rate up).
const lossRows = m.revaluationRows([{ accountId: ABA_R, riel: 410000, usd: 100, untaggedLines: 0, untaggedEntryIds: [], draftLines: 0 }], 4200);
const lossRv = m.revaluationLines(lossRows, { gainId: GAIN, lossId: LOSS }, { account: id => id, rateText: '៛4,200' });
check('rate up: ៛410,000 at 4,200 = $97.62, loss $2.38', near(lossRows[0].valueUsd, 97.62) && near(lossRv.net, -2.38), lossRv);
check('loss: Dr loss 2.38 / Cr riel account 2.38', lossRv.lines.length === 2 && lossRv.lines.some(l => l.account_id === LOSS && near(l.debit, 2.38)) && lossRv.lines.some(l => l.account_id === ABA_R && near(l.credit, 2.38)), lossRv);
check('sub-cent difference is 0', m.revaluationRows([{ accountId: ABA_R, riel: 41000, usd: 10.004, untaggedLines: 0, untaggedEntryIds: [], draftLines: 0 }], 4100)[0].diffUsd === 0);

// Book value at the average rate.
check('book value: average rate', near(m.bookValueOfRiel(205000, { riel: 410000, usd: 100 }, 4100), 50));
check('book value: no positive balance → fallback rate', near(m.bookValueOfRiel(41000, { riel: 0, usd: 0 }, 4100), 10));
check('book value: no balance → fallback rate', near(m.bookValueOfRiel(41000, undefined, 4000), 10.25));

// Exchange: sell ៛410,000 booked at $100 (4,100) for $101 at the bank (4,059.41).
const sell = m.exchangeLines({ direction: 'sellRiel', rielAccountId: ABA_R, usdAccountId: ABA_U, riel: 410000, usd: 101, balance: { riel: 410000, usd: 100 }, fallbackRate: 4100, gainId: GAIN, lossId: LOSS }, { riel: 'ABA KHR', usd: 'ABA USD' });
check('sell riel: book value $100, gain $1', near(sell.bookUsd, 100) && near(sell.gainUsd, 1), sell);
check('sell riel: Dr USD 101 / Cr riel 100 / Cr gain 1', sell.lines.length === 3 && sell.lines[0].account_id === ABA_U && near(sell.lines[0].debit, 101)
    && sell.lines[1].account_id === ABA_R && near(sell.lines[1].credit, 100) && sell.lines[2].account_id === GAIN && near(sell.lines[2].credit, 1), sell.lines);
check('sell riel: balances', balanced(sell.lines));
check('sell riel: rate got', near(sell.rate, 4059.4059), sell.rate);
const sellLoss = m.exchangeLines({ direction: 'sellRiel', rielAccountId: ABA_R, usdAccountId: ABA_U, riel: 205000, usd: 48.5, balance: { riel: 410000, usd: 100 }, fallbackRate: 4100, gainId: GAIN, lossId: LOSS }, { riel: 'r', usd: 'u' });
check('sell half at a worse rate: loss $1.50 on Dr loss', near(sellLoss.gainUsd, -1.5) && sellLoss.lines.some(l => l.account_id === LOSS && near(l.debit, 1.5)) && balanced(sellLoss.lines), sellLoss);
const sellEven = m.exchangeLines({ direction: 'sellRiel', rielAccountId: ABA_R, usdAccountId: ABA_U, riel: 41000, usd: 10, balance: { riel: 410000, usd: 100 }, fallbackRate: 4100, gainId: GAIN, lossId: LOSS }, { riel: 'r', usd: 'u' });
check('sell at the book rate: two lines, no gain', sellEven.lines.length === 2 && sellEven.gainUsd === 0 && balanced(sellEven.lines), sellEven);
const buy = m.exchangeLines({ direction: 'buyRiel', rielAccountId: ABA_R, usdAccountId: ABA_U, riel: 412000, usd: 100, balance: { riel: 0, usd: 0 }, fallbackRate: 4100, gainId: GAIN, lossId: LOSS }, { riel: 'r', usd: 'u' });
check('buy riel: Dr riel 100 / Cr USD 100, no gain', buy.lines.length === 2 && buy.lines[0].account_id === ABA_R && near(buy.lines[0].debit, 100) && buy.gainUsd === 0 && balanced(buy.lines), buy);

// An exchange entry tagged KHR moves the riel out of the account.
const sellId = post('2026-11-08', 'KHR', 41000, sellEven.rate, sellEven.lines.map(l => [l.account_id, l.debit, l.credit]), { ref: `${m.FX_CONV_PREFIX}1` });
const afterSell = m.rielBalances(lines, entries, RIEL_IDS, { asOf: '2026-11-10', postedOnly: true, fallbackRate: 4100 });
check('after selling ៛41,000: riel balance down by 41,000', afterSell.get(ABA_R).riel === a.riel - 41000, afterSell.get(ABA_R));
entries.delete(sellId);

// FX accounts by name; free codes.
const chart = [
    { id: '1', account_code: '4910', account_name: 'Other Income', account_type: 'Revenue', is_active: true },
    { id: '2', account_code: '6910', account_name: 'Foreign Exchange Loss', account_type: 'Expense', is_active: true },
    { id: '3', account_code: '4911', account_name: 'FX gain', account_type: 'Revenue', is_active: false },
];
const fx = m.findFxAccounts(chart);
check('find: the loss account by name', fx.loss?.id === '2');
check('find: an inactive gain account is not used', fx.gain === undefined);
check('free code: 4910 taken → 4912 (4911 taken too)', m.freeAccountCode(chart, '4910') === '4912');
check('free code: 6920 free', m.freeAccountCode(chart, '6920') === '6920');

// The ledger treats FX entries as system entries of their own kind.
check('FX-REVAL is a system entry', m.isSystemEntry({ reference_id: 'FX-REVAL-20261110-1', entry_number: null }));
check('FX-CONV is a system entry', m.isSystemEntry({ reference_id: 'FX-CONV-1', entry_number: null }));
check('kind fx', m.systemEntryKind({ reference_id: 'FX-CONV-1', entry_number: null }) === 'fx');
check('isFxReference', m.isFxReference('FX-REVAL-x') && m.isFxReference('FX-CONV-x') && !m.isFxReference('FIFO-REVAL-x'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
