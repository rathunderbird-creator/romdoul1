// Unit test of src/utils/paymentRequest.ts: Sales Setup › Defaults ›
// Payment request message — the template in use, what the editor saves,
// unknown {fields}, what an order still owes for the request, and the filled
// text Order Details › Copy payment request puts on the clipboard.
// Transpiled on the fly with the repo's esbuild; see tests/README.md.
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = await build({
    stdin: { contents: `export * from './src/utils/paymentRequest.ts';`, resolveDir: repo, loader: 'ts' },
    bundle: true, format: 'esm', write: false,
});
const bundlePath = path.join(repo, 'tests', '.payment-request.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const m = await import('file:///' + bundlePath.split(path.sep).join('/'));
rmSync(bundlePath);

let pass = 0, fail = 0;
const check = (l, c, extra) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c || extra === undefined ? '' : JSON.stringify(extra)); };
const D = m.DEFAULT_PAYMENT_REQUEST_MESSAGE;

const order = (o = {}) => ({
    id: 'x', total: 45, date: '2026-11-20T09:30:00', paymentMethod: 'COD', type: 'Online',
    items: [{ id: 'a', name: 'Rice cooker', price: 25, quantity: 1 }, { id: 'b', name: 'Kettle', price: 10, quantity: 2 }],
    customer: { name: ' Dara ', phone: '012', page: 'P1' }, paymentStatus: 'Unpaid', shipping: { status: 'Pending' }, ...o,
});

// Template in use / editor input
check('no saved message → default', m.paymentRequestTemplate(undefined) === D && m.paymentRequestTemplate('  ') === D && m.paymentRequestTemplate(5) === D);
check('a saved message is used', m.paymentRequestTemplate('Pay {due}') === 'Pay {due}');
check('empty input → back to default', m.paymentRequestInput('') === '' && m.paymentRequestInput(' \n ') === '');
check('the default text itself saves as default', m.paymentRequestInput(D) === '' && m.paymentRequestInput(D.split('\n').join('\r\n') + '  ') === '');
check('own text is trimmed and saved', m.paymentRequestInput('  Pay {due} please \r\n') === 'Pay {due} please');
check('too long is refused', m.paymentRequestInput('x'.repeat(1001)) === null && m.paymentRequestInput('x'.repeat(1000)) === 'x'.repeat(1000));
check('unknown fields are listed once', JSON.stringify(m.unknownPaymentRequestFields('Hi {nmae} {due} {nmae} {Total}')) === JSON.stringify(['nmae', 'Total']));
check('the default uses only known fields', m.unknownPaymentRequestFields(D).length === 0);

// Paid / due
check('unpaid owes the total', m.paymentRequestDue(order()) === 45 && m.paymentRequestPaid(order()) === 0);
check('a Pending order still owes (asked before shipping)', m.paymentRequestDue(order({ shipping: { status: 'Drafted' } })) === 45);
check('deposit is taken off', m.paymentRequestDue(order({ paymentStatus: 'Deposit', depositAmount: 10 })) === 35);
check('amount received wins over the deposit', m.paymentRequestPaid(order({ paymentStatus: 'Deposit', depositAmount: 10, amountReceived: 15 })) === 15);
check('Paid and Get File owe nothing', m.paymentRequestDue(order({ paymentStatus: 'Paid' })) === 0 && m.paymentRequestDue(order({ paymentStatus: 'Get File' })) === 0);
check('voided orders owe nothing', ['Cancelled', 'Returned', 'ReStock'].every(s => m.paymentRequestDue(order({ shipping: { status: s } })) === 0)
    && m.paymentRequestDue(order({ paymentStatus: 'Cancel' })) === 0 && m.paymentRequestDue(order({ paymentStatus: 'PdFee' })) === 0);
check('received above the total → nothing due, paid capped', m.paymentRequestDue(order({ amountReceived: 60 })) === 0 && m.paymentRequestPaid(order({ amountReceived: 60 })) === 45);
check('cents are rounded', m.paymentRequestDue(order({ total: 10.1, amountReceived: 3.03 })) === 7.07);

check('trailing spaces do not count toward the limit', m.paymentRequestInput('x'.repeat(999) + '  \n\n') === 'x'.repeat(999) && m.paymentRequestText(' a \r\nb ') === 'a \nb');
// A Salesman's claim waiting for confirmation (order still Unpaid)
const claimPaid = order({ paymentClaim: { status: 'Paid', amount: 45, at: 'x' } });
check('a pending Paid claim → nothing to ask', m.paymentRequestDue(claimPaid) === 0 && m.pendingClaimPaid(claimPaid) === 45);
check('a pending Deposit claim is taken off', m.paymentRequestDue(order({ paymentClaim: { status: 'Deposit', amount: 5, at: 'x' } })) === 40);
check('a confirmed claim (no longer Unpaid) uses the booked figures', m.pendingClaimPaid(order({ paymentStatus: 'Deposit', depositAmount: 10, paymentClaim: { status: 'Deposit', amount: 5, at: 'x' } })) === 0
    && m.paymentRequestDue(order({ paymentStatus: 'Deposit', depositAmount: 10, paymentClaim: { status: 'Deposit', amount: 5, at: 'x' } })) === 35);
check('a claim on a deposit order: riel converted, not the saved full price', m.paymentRequestValues(order({ customKhrAmount: 184500, paymentClaim: { status: 'Deposit', amount: 5, at: 'x' } }), { orderNo: 1, khrRate: 4100 }).dueKhr === '៛164,000');

// Values / fill
const v = m.paymentRequestValues(order({ paymentStatus: 'Deposit', depositAmount: 10 }), { orderNo: 7, storeName: ' Romdoul ', khrRate: 4100 });
check('values', v.name === 'Dara' && v.order === '07' && v.date === '20-11-2026' && v.total === '$45.00' && v.paid === '$10.00' && v.due === '$35.00'
    && v.dueKhr === '៛143,500' && v.page === 'P1' && v.store === 'Romdoul', v);
check('items list each line with its amount', v.items === '- Rice cooker x1 ($25.00)\n- Kettle x2 ($20.00)', v.items);
check('riel set by hand is used when nothing is paid yet', m.paymentRequestValues(order({ customKhrAmount: 180000 }), { orderNo: 1, khrRate: 4100 }).dueKhr === '៛180,000');
check('…and with a deposit it is the riel still owed (what the receipt prints)', m.paymentRequestValues(order({ paymentStatus: 'Deposit', depositAmount: 10, customKhrAmount: 143450 }), { orderNo: 1, khrRate: 4000 }).dueKhr === '៛143,450');
check('…but not after a part-payment beyond the deposit', m.paymentRequestValues(order({ customKhrAmount: 180000, amountReceived: 5 }), { orderNo: 1, khrRate: 4000 }).dueKhr === '៛160,000');
check('page falls back to the page source', m.paymentRequestValues(order({ customer: { name: 'A', phone: '' }, pageSource: 'P2' }), { orderNo: 1, khrRate: 4100 }).page === 'P2');
check('a stale full-price riel (deposit booked from Orders later) is not asked for', m.paymentRequestValues(order({ paymentStatus: 'Deposit', depositAmount: 10, amountReceived: 10, customKhrAmount: 184500 }), { orderNo: 1, khrRate: 4100 }).dueKhr === '៛143,500');
check('a saved riel survives a small rate change', m.paymentRequestValues(order({ paymentStatus: 'Deposit', depositAmount: 10, customKhrAmount: 143500 }), { orderNo: 1, khrRate: 4000 }).dueKhr === '៛143,500');
check('fill replaces known fields, keeps others', m.fillPaymentRequest('Hi {name}, pay {due} {nmae} {}', v) === 'Hi Dara, pay $35.00 {nmae} {}');
check('a value with $& or {due} in it is inserted literally', m.fillPaymentRequest('{name}|{due}', { name: '$& {due}', due: '$1' }) === '$& {due}|$1');
const full = m.fillPaymentRequest(D, v);
check('the default message fills completely', !/\{[A-Za-z]+\}/.test(full) && full.includes('Amount to pay: $35.00 (៛143,500)'), full);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
