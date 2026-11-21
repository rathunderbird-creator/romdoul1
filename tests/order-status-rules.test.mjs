// Unit test of src/utils/orderStatusRules.ts — the shared refusal rules
// (ORD-9 / PAY-1). Transpiled on the fly with the repo's esbuild; see
// tests/README.md.
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = await build({
    entryPoints: [path.join(repo, 'src', 'utils', 'orderStatusRules.ts')],
    bundle: true, format: 'esm', write: false,
});
const bundlePath = path.join(repo, 'tests', '.rules.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const m = await import('file:///' + bundlePath.replace(/\\/g, '/'));
rmSync(bundlePath);

let pass = 0, fail = 0;
const check = (l, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l); };
const admin = { isAdmin: true, canRestock: true };
const adminNoRestock = { isAdmin: true, canRestock: false };
const staff = { isAdmin: false, canRestock: false };
const staffRestock = { isAdmin: false, canRestock: true };
const s = m.statusChangeRefusal, p = m.paymentChangeRefusal, d = m.settleDateChangeRefusal;

// status: admin free except restock permission
check('admin can reverse Delivered->Pending', s({ shippingStatus: 'Delivered' }, 'Pending', admin) === null);
check('admin without restock perm refused ReStock', s({ shippingStatus: 'Returned' }, 'ReStock', adminNoRestock) !== null);
check('staff with restock perm allowed ReStock from Returned', s({ shippingStatus: 'Returned' }, 'ReStock', staffRestock) === null);
check('staff refused Shipped->Pending', s({ shippingStatus: 'Shipped' }, 'Pending', staff) !== null);
check('staff refused Shipped->Cancelled', s({ shippingStatus: 'Shipped' }, 'Cancelled', staff) !== null);
check('staff refused Delivered->Pending', s({ shippingStatus: 'Delivered' }, 'Pending', staff) !== null);
check('staff refused Delivered->Shipped', s({ shippingStatus: 'Delivered' }, 'Shipped', staff) !== null);
check('staff refused Cancelled->Shipped', s({ shippingStatus: 'Cancelled' }, 'Shipped', staff) !== null);
check('staff refused Returned->Shipped', s({ shippingStatus: 'Returned' }, 'Shipped', staff) !== null);
check('staff allowed Shipped->Delivered', s({ shippingStatus: 'Shipped' }, 'Delivered', staff) === null);
check('staff allowed Delivered->Returned', s({ shippingStatus: 'Delivered' }, 'Returned', staff) === null);
check('staff refused Pending->Delivered (not shipped)', s({ shippingStatus: 'Pending' }, 'Delivered', staff) !== null);
check('staff allowed Pending->Confirmed', s({ shippingStatus: 'Pending' }, 'Confirmed', staff) === null);
check('staff allowed Pending->Shipped', s({ shippingStatus: 'Pending' }, 'Shipped', staff) === null);
check('staff refused on Cancelled row', s({ shippingStatus: 'Cancelled' }, 'Pending', staff) !== null);
check('staff refused on payment-Cancel row', s({ shippingStatus: 'Pending', paymentStatus: 'Cancel' }, 'Confirmed', staff) !== null);
check('staff refused reopening ReStock', s({ shippingStatus: 'ReStock' }, 'Drafted', staff) !== null);

// payment
check('admin can unpay Paid', p({ shippingStatus: 'Delivered', paymentStatus: 'Paid' }, 'Unpaid', admin) === null);
check('staff refused Paid->Unpaid', p({ shippingStatus: 'Delivered', paymentStatus: 'Paid' }, 'Unpaid', staff) !== null);
check('staff refused Paid->Cancel', p({ shippingStatus: 'Delivered', paymentStatus: 'Paid' }, 'Cancel', staff) !== null);
check('staff refused any->Cancel', p({ shippingStatus: 'Pending', paymentStatus: 'Unpaid' }, 'Cancel', staff) !== null);
check('staff allowed Unpaid->Paid', p({ shippingStatus: 'Shipped', paymentStatus: 'Unpaid' }, 'Paid', staff) === null);
check('staff allowed Deposit->Paid', p({ shippingStatus: 'Shipped', paymentStatus: 'Deposit' }, 'Paid', staff) === null);
check('staff refused payment change on Drafted', p({ shippingStatus: 'Drafted', paymentStatus: 'Unpaid' }, 'Paid', staff) !== null);
// Paid->Paid is NOT a no-op for the bulk/drawer callers (they rewrite received
// amount, settle date and pay-by, and book another receipt) — the Paid lock
// runs before the same-status early return (ORD-9 review).
check('staff refused Paid->Paid rewrite', p({ shippingStatus: 'Delivered', paymentStatus: 'Paid' }, 'Paid', staff) !== null);
check('admin allowed Paid->Paid rewrite', p({ shippingStatus: 'Delivered', paymentStatus: 'Paid' }, 'Paid', admin) === null);
check('no-op same payment allowed for unlocked statuses', p({ shippingStatus: 'Pending', paymentStatus: 'Unpaid' }, 'Unpaid', staff) === null);
check('staff refused PdFee change', p({ shippingStatus: 'Cancelled', paymentStatus: 'PdFee' }, 'Unpaid', staff) !== null);

// settle date (the Bulk Edit "Settled/Paid Date" field)
check('staff refused settle date on Paid', d({ shippingStatus: 'Delivered', paymentStatus: 'Paid' }, staff) !== null);
check('staff refused settle date on PdFee', d({ shippingStatus: 'Cancelled', paymentStatus: 'PdFee' }, staff) !== null);
check('staff refused settle date on payment-Cancel', d({ shippingStatus: 'Pending', paymentStatus: 'Cancel' }, staff) !== null);
check('staff allowed settle date on Unpaid', d({ shippingStatus: 'Shipped', paymentStatus: 'Unpaid' }, staff) === null);
check('staff allowed settle date on Deposit', d({ shippingStatus: 'Shipped', paymentStatus: 'Deposit' }, staff) === null);
check('admin allowed settle date on Paid', d({ shippingStatus: 'Delivered', paymentStatus: 'Paid' }, admin) === null);

// A Get File booked as COD (Sales Setup ticked courier) locks like Paid.
const gfb = { shippingStatus: 'Delivered', paymentStatus: 'Get File', getFileBooked: true };
const gfu = { shippingStatus: 'Delivered', paymentStatus: 'Get File', getFileBooked: false };
check('staff refused un-paying a booked Get File', p(gfb, 'Unpaid', staff) !== null);
check('staff refused a same-status re-save on a booked Get File', p(gfb, 'Get File', staff) !== null);
check('staff refused settle date on a booked Get File', d(gfb, staff) !== null);
check('admin allowed un-paying a booked Get File', p(gfb, 'Unpaid', admin) === null);
check('staff allowed to change an unbooked Get File', p(gfu, 'Unpaid', staff) === null && d(gfu, staff) === null);
// ...but staff may move a booked Get File FORWARD to Paid (courier remitted):
// the database books nothing more for it.
check('staff allowed booked Get File->Paid', p(gfb, 'Paid', staff) === null);
check('staff allowed booked Get File->Settled / Paid/Settled', p(gfb, 'Settled', staff) === null && p(gfb, 'Paid/Settled', staff) === null);
check('staff refused booked Get File->Deposit / PdFee / Cancel', p(gfb, 'Deposit', staff) !== null && p(gfb, 'PdFee', staff) !== null && p(gfb, 'Cancel', staff) !== null);
check('staff refused booked Get File->Paid on a Returned row', p({ ...gfb, shippingStatus: 'Returned' }, 'Paid', staff) !== null);
check('staff still refused Paid->Paid rewrite (forward rule is Get File only)', p({ shippingStatus: 'Delivered', paymentStatus: 'Paid' }, 'Paid', staff) !== null);
check('badge: booked Get File is open for staff with only Paid enabled',
    !m.paymentBadgeReadOnlyForNonAdmin(gfb)
    && JSON.stringify(m.paymentBadgeDisabledForNonAdmin(gfb)) === JSON.stringify(['Unpaid', 'Deposit', 'Get File', 'PdFee', 'Cancel']));
check('badge: Paid / PdFee / Cancel stay read-only for staff', m.paymentBadgeReadOnlyForNonAdmin({ paymentStatus: 'Paid' }) && m.paymentBadgeReadOnlyForNonAdmin({ paymentStatus: 'PdFee' }) && m.paymentBadgeReadOnlyForNonAdmin({ paymentStatus: 'Cancel' }));
check('badge: unbooked Get File / Unpaid open, only Cancel disabled', !m.paymentBadgeReadOnlyForNonAdmin(gfu) && JSON.stringify(m.paymentBadgeDisabledForNonAdmin(gfu)) === '["Cancel"]' && JSON.stringify(m.paymentBadgeDisabledForNonAdmin({ paymentStatus: 'Unpaid' })) === '["Cancel"]');
check('paymentLockedForNonAdmin: Paid / booked Get File yes, unbooked Get File / Unpaid no', m.paymentLockedForNonAdmin({ paymentStatus: 'Paid' }) && m.paymentLockedForNonAdmin(gfb) && !m.paymentLockedForNonAdmin(gfu) && !m.paymentLockedForNonAdmin({ paymentStatus: 'Unpaid' }));

// Collected: the courier collected the money — always booked as COD, so it
// locks like a booked Get File and only moves forward to Paid.
const col = { shippingStatus: 'Delivered', paymentStatus: 'Collected' };
check('staff allowed booked Get File->Collected', p(gfb, 'Collected', staff) === null);
check('staff allowed Collected->Paid', p(col, 'Paid', staff) === null && p(col, 'Settled', staff) === null);
check('staff refused Collected->Unpaid / Get File / Deposit / Cancel', p(col, 'Unpaid', staff) !== null && p(col, 'Get File', staff) !== null && p(col, 'Deposit', staff) !== null && p(col, 'Cancel', staff) !== null);
check('staff refused settle date on Collected', d(col, staff) !== null);
check('admin allowed Collected->Unpaid', p(col, 'Unpaid', admin) === null);
check('badge: Collected open for staff with only Paid enabled',
    !m.paymentBadgeReadOnlyForNonAdmin(col)
    && JSON.stringify(m.paymentBadgeDisabledForNonAdmin(col)) === JSON.stringify(['Unpaid', 'Deposit', 'Get File', 'Collected', 'PdFee', 'Cancel']));
check('isCourierBooked: booked Get File / Collected yes, unbooked Get File / Paid no', m.isCourierBooked(gfb) && m.isCourierBooked(col) && !m.isCourierBooked(gfu) && !m.isCourierBooked({ paymentStatus: 'Paid' }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
