// Unit test of src/utils/getFileSave.ts — the Get File amount popup's save
// (order money first, then Get File). Transpiled on the fly with the repo's
// esbuild; see tests/README.md.
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = await build({
    entryPoints: [path.join(repo, 'src', 'utils', 'getFileSave.ts')],
    bundle: true, format: 'esm', write: false,
});
const bundlePath = path.join(repo, 'tests', '.getfile.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const m = await import('file:///' + bundlePath.replace(/\\/g, '/'));
rmSync(bundlePath);

let pass = 0, fail = 0;
const check = (l, c, extra) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c ? '' : JSON.stringify(extra ?? '')); };
const usd = v => ({ currency: 'USD', original_amount: v, exchange_rate: 1 });
const khr = (r, rate = 4000) => ({ currency: 'KHR', original_amount: r, exchange_rate: rate });

// Which statuses ask for the amount.
check('asks: Unpaid / Deposit', m.getFileAsksAmount({ paymentStatus: 'Unpaid' }) && m.getFileAsksAmount({ paymentStatus: 'Deposit' }));
check('no ask: Paid / Settled / Get File', !m.getFileAsksAmount({ paymentStatus: 'Paid' }) && !m.getFileAsksAmount({ paymentStatus: 'Settled' }) && !m.getFileAsksAmount({ paymentStatus: 'Get File' }));

// Money updates.
const o = { total: 25, depositAmount: 5, discount: 0, customKhrAmount: null };
check('same amount: no change', Object.keys(m.getFileMoneyUpdates(o, 20, usd(20))).length === 0);
let u = m.getFileMoneyUpdates(o, 18, usd(18));
check('lower amount: total 23, discount +2', u.total === 23 && u.discount === 2, u);
u = m.getFileMoneyUpdates(o, 21.5, usd(21.5));
check('higher amount: total 26.5, discount -1.5 (extra charge)', u.total === 26.5 && u.discount === -1.5, u);
u = m.getFileMoneyUpdates(o, 20, khr(80000));
check('riel at the same USD: only the riel price', u.total === undefined && u.customKhrAmount === 80000, u);
u = m.getFileMoneyUpdates({ ...o, customKhrAmount: 80000 }, 18, usd(18));
check('dollar change drops an old riel price', u.total === 23 && u.customKhrAmount === null, u);

// Save order: money first, then Get File; a refused money save stops it.
const calls = [];
const upd = async (id, updates, opts) => { calls.push({ id, updates, opts }); return true; };
const order = { id: 'A1', paymentStatus: 'Unpaid', ...o };
await m.saveGetFile(upd, order, { collectUsd: 18, money: usd(18) });
check('two saves, money first', calls.length === 2 && calls[0].updates.total === 23 && calls[1].updates.paymentStatus === 'Get File', calls);
check('money save carries expectMoney', calls[0].opts?.expectMoney?.total === 25 && calls[0].opts.expectMoney.deposit === 5, calls[0]);
check('Get File keeps the deposit as Received', calls[1].updates.amountReceived === 5 && calls[1].updates.expectedPaymentStatus === 'Unpaid', calls[1]);
calls.length = 0;
await m.saveGetFile(upd, order, { collectUsd: 20, money: usd(20) });
check('unchanged amount: one save', calls.length === 1 && calls[0].updates.paymentStatus === 'Get File', calls);
calls.length = 0;
const ok = await m.saveGetFile(async (...a) => { calls.push(a); return false; }, order, { collectUsd: 18, money: usd(18) });
check('refused money save: no Get File', ok === false && calls.length === 1);

// Collected: same popup and save, its own status.
check('Collected asks: Unpaid / unbooked Get File', m.getFileAsksAmount({ paymentStatus: 'Unpaid' }, 'Collected') && m.getFileAsksAmount({ paymentStatus: 'Get File', getFileBooked: false }, 'Collected'));
check('Collected no ask: booked Get File / Paid / Collected', !m.getFileAsksAmount({ paymentStatus: 'Get File', getFileBooked: true }, 'Collected') && !m.getFileAsksAmount({ paymentStatus: 'Paid' }, 'Collected') && !m.getFileAsksAmount({ paymentStatus: 'Collected' }, 'Collected'));
check('Get File no ask from Collected', !m.getFileAsksAmount({ paymentStatus: 'Collected' }));
calls.length = 0;
await m.saveGetFile(upd, order, { collectUsd: 18, money: usd(18) }, 'Collected');
check('Collected: money first, then Collected', calls.length === 2 && calls[0].updates.total === 23 && calls[1].updates.paymentStatus === 'Collected', calls);
calls.length = 0;
await m.saveGetFile(upd, order, { collectUsd: 20, money: usd(20), method: 'Bank' }, 'Collected');
check('Collected with a Method: saved as the order\'s Pay By', calls.at(-1).updates.paymentStatus === 'Collected' && calls.at(-1).updates.paymentMethod === 'Bank', calls);
calls.length = 0;
await m.saveGetFile(upd, order, { collectUsd: 20, money: usd(20) }, 'Collected');
check('Collected, Method left unset: the save says nothing about it', calls.at(-1).updates.paymentStatus === 'Collected' && !('paymentMethod' in calls.at(-1).updates), calls);
calls.length = 0;
await m.saveGetFile(upd, order, { collectUsd: 20, money: usd(20), accountId: 'acc-aba', accountName: 'Bank Account ABA' }, 'Collected');
check('Collected into Account: stored as the order\'s deposit account',
    calls.at(-1).updates.depositAccountId === 'acc-aba' && calls.at(-1).updates.depositAccountName === 'Bank Account ABA', calls.at(-1));
calls.length = 0;
await m.saveGetFile(upd, order, { collectUsd: 20, money: usd(20) }, 'Collected');
check('Collected, account left unset: the save says nothing about it', !('depositAccountId' in calls.at(-1).updates) && !('depositAccountName' in calls.at(-1).updates), calls.at(-1));
calls.length = 0;
await m.saveGetFile(upd, order, { collectUsd: 20, money: usd(20), holder: 'deliveryman' }, 'Collected');
check('Collected held by deliveryman: saved as the order\'s cod holder', calls.at(-1).updates.codHolder === 'deliveryman', calls.at(-1));
calls.length = 0;
await m.saveGetFile(upd, order, { collectUsd: 20, money: usd(20) }, 'Collected');
check('Collected, holder left unset: the save says nothing about it', !('codHolder' in calls.at(-1).updates), calls.at(-1));
calls.length = 0;
await m.saveGetFile(upd, order, { collectUsd: 20, money: usd(20) });
check('Get File saves no Method', calls[0].updates.paymentStatus === 'Get File' && !('paymentMethod' in calls[0].updates), calls[0]);
calls.length = 0;
await m.saveGetFile(upd, order, { collectUsd: 20, money: khr(80000) }, 'Collected');
check('Collected in riel: the status save carries the riel for the booked row',
    calls.at(-1).updates.paymentStatus === 'Collected' && calls.at(-1).opts?.money?.currency === 'KHR'
    && calls.at(-1).opts.money.original_amount === 80000 && calls.at(-1).opts.money.exchange_rate === 4000
    && calls.at(-1).opts.money.category === 'លក់រាយ', calls.at(-1));
calls.length = 0;
await m.saveGetFile(upd, order, { collectUsd: 20, money: usd(20) }, 'Collected');
check('Collected in dollars: no riel tag', calls.at(-1).opts === undefined, calls.at(-1));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
