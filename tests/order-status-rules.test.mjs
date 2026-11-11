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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
