// Unit test of src/utils/paymentClaim.ts — the conversion of a Salesman's
// Deposit / Paid / PdFee save into the gray claim (nothing books), and the
// stripping of every booking field. Transpiled with the repo's esbuild.
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = await build({
    entryPoints: [path.join(repo, 'src', 'utils', 'paymentClaim.ts')],
    bundle: true, format: 'esm', write: false,
});
const bundlePath = path.join(repo, 'tests', '.paymentclaim.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const m = await import('file:///' + bundlePath.replace(/\\/g, '/'));
rmSync(bundlePath);

let pass = 0, fail = 0;
const check = (l, c, extra) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c ? '' : JSON.stringify(extra ?? '')); };
const unpaid = { paymentStatus: 'Unpaid', total: 25 };

// Deposit: amount from depositAmount, method/date from the deposit fields.
let c = m.salesmanClaimFor({ paymentStatus: 'Deposit', depositAmount: 5, depositMethod: 'Cash', depositDate: '2026-11-24' }, unpaid, 'Sok');
check('Deposit claim: status/amount/method/date/by', c && c.status === 'Deposit' && c.amount === 5 && c.method === 'Cash' && c.date === '2026-11-24' && c.by === 'Sok', c);

// Paid: amount from amountReceived, falling back to the order total.
c = m.salesmanClaimFor({ paymentStatus: 'Paid', amountReceived: 25, paymentMethod: 'Bank', settleDate: '2026-11-24' }, unpaid, 'Sok');
check('Paid claim: amount/method', c && c.status === 'Paid' && c.amount === 25 && c.method === 'Bank', c);
c = m.salesmanClaimFor({ paymentStatus: 'Settled' }, unpaid, 'Sok');
check('Settled claim: Paid at the order total', c && c.status === 'Paid' && c.amount === 25, c);

// PdFee: amount is the fee (amountReceived), never the total.
c = m.salesmanClaimFor({ paymentStatus: 'PdFee', amountReceived: 1.5, paymentMethod: 'Cash', settleDate: '2026-11-24' }, unpaid, 'Sok');
check('PdFee claim: status PdFee, the fee amount', c && c.status === 'PdFee' && c.amount === 1.5 && c.method === 'Cash', c);
c = m.salesmanClaimFor({ paymentStatus: 'PdFee' }, unpaid, 'Sok');
check('PdFee with no amount: not claimable', c === null);

// Riel rides along from the save's money.
c = m.salesmanClaimFor({ paymentStatus: 'Deposit', depositAmount: 5 }, unpaid, 'Sok', { currency: 'KHR', original_amount: 20500, exchange_rate: 4100 });
check('Riel claim carries currency/original/rate', c && c.currency === 'KHR' && c.original_amount === 20500 && c.exchange_rate === 4100, c);
c = m.salesmanClaimFor({ paymentStatus: 'Deposit', depositAmount: 5 }, unpaid, 'Sok', { currency: 'USD', original_amount: 5, exchange_rate: 1 });
check('USD money: no riel keys on the claim', c && c.currency === undefined, c);

// Not claimable: a booked order, Collected, Unpaid, no status.
check('Booked order (Collected): not claimable', m.salesmanClaimFor({ paymentStatus: 'Paid', amountReceived: 25 }, { paymentStatus: 'Collected', total: 25 }, 'Sok') === null);
check('Collected target: not claimable', m.salesmanClaimFor({ paymentStatus: 'Collected', amountReceived: 25 }, unpaid, 'Sok') === null);
check('No target status: not claimable', m.salesmanClaimFor({ amountReceived: 25 }, unpaid, 'Sok') === null);

// Stripping: every booking field goes, the rest stays.
const u = { paymentStatus: 'PdFee', amountReceived: 1.5, settleDate: '2026-11-24', paymentMethod: 'Cash',
    depositAmount: 5, depositDate: 'x', depositMethod: 'y', codCollected: false, codHolder: 'courier',
    postToLedger: true, depositAccountId: 'a', depositAccountName: 'n', receiptReference: 'r', receiptNotes: 'rn',
    expectedPaymentStatus: 'Unpaid', remark: 'keep me' };
m.stripClaimBookingFields(u);
check('strip removes every booking field', !('paymentStatus' in u) && !('amountReceived' in u) && !('settleDate' in u)
    && !('depositAmount' in u) && !('depositDate' in u) && !('depositMethod' in u) && !('paymentMethod' in u)
    && !('codCollected' in u) && !('codHolder' in u) && !('postToLedger' in u) && !('depositAccountId' in u)
    && !('depositAccountName' in u) && !('receiptReference' in u) && !('receiptNotes' in u) && !('expectedPaymentStatus' in u), u);
check('strip keeps the rest', u.remark === 'keep me');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
