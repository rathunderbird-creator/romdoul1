// Unit test of src/utils/orderMoney.ts — the shared money rules, in
// particular orderBalance's "money actually still expected" rule (DSH-3):
// Returned / Cancelled / ReStock orders owe nothing, deposits included.
// Transpiled on the fly with the repo's esbuild; see tests/README.md.
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = await build({
    entryPoints: [path.join(repo, 'src', 'utils', 'orderMoney.ts')],
    bundle: true, format: 'esm', write: false,
});
const bundlePath = path.join(repo, 'tests', '.order-money.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const m = await import('file:///' + bundlePath.replace(/\\/g, '/'));
rmSync(bundlePath);

let pass = 0, fail = 0;
const check = (l, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l); };

const order = (shippingStatus, paymentStatus, total, extra = {}) => ({
    total,
    paymentStatus,
    shipping: { status: shippingStatus },
    items: [],
    ...extra,
});

const bal = m.orderBalance;

// ── DSH-3: voided orders owe nothing ──
check('Returned COD (Unpaid) owes 0', bal(order('Returned', 'Unpaid', 40)) === 0);
check('Returned partially-received owes 0', bal(order('Returned', 'Unpaid', 40, { amountReceived: 10 })) === 0);
check('Cancelled deposit order owes 0', bal(order('Cancelled', 'Deposit', 60, { depositAmount: 10 })) === 0);
check('Returned deposit order owes 0', bal(order('Returned', 'Deposit', 60, { depositAmount: 10 })) === 0);
check('ReStock deposit order owes 0', bal(order('ReStock', 'Deposit', 60, { depositAmount: 10 })) === 0);
check('Cancelled (Unpaid) owes 0', bal(order('Cancelled', 'Unpaid', 25)) === 0);
check('ReStock (Unpaid) owes 0', bal(order('ReStock', 'Unpaid', 25)) === 0);

// ── Live orders keep their original balances ──
check('Shipped Unpaid owes full total', bal(order('Shipped', 'Unpaid', 40)) === 40);
check('Delivered partial owes the rest', bal(order('Delivered', 'Unpaid', 40, { amountReceived: 15 })) === 25);
check('Delivered Paid owes 0', bal(order('Delivered', 'Paid', 40)) === 0);
check('Shipped deposit owes total minus deposit', bal(order('Shipped', 'Deposit', 60, { depositAmount: 10 })) === 50);
check('Pending deposit still owes the rest (firm commitment)', bal(order('Pending', 'Deposit', 60, { depositAmount: 10 })) === 50);
check('Deposit above total owes 0, not negative', bal(order('Shipped', 'Deposit', 60, { depositAmount: 70 })) === 0);

// ── Not-yet-committed / fee-settled orders owe nothing (unchanged) ──
check('Drafted owes 0', bal(order('Drafted', 'Unpaid', 40)) === 0);
check('Pending (no deposit) owes 0', bal(order('Pending', 'Unpaid', 40)) === 0);
check('payment-Cancel owes 0', bal(order('Shipped', 'Cancel', 40)) === 0);
check('PdFee owes 0', bal(order('Cancelled', 'PdFee', 40)) === 0);

// ── isRevenueOrder (the gate the Purchase Cost report now uses by default) ──
const rev = m.isRevenueOrder;
check('Confirmed counts as revenue', rev(order('Confirmed', 'Unpaid', 10)) === true);
check('Shipped counts as revenue', rev(order('Shipped', 'Unpaid', 10)) === true);
check('Delivered counts as revenue', rev(order('Delivered', 'Paid', 10)) === true);
check('Pending is not revenue', rev(order('Pending', 'Unpaid', 10)) === false);
check('Drafted is not revenue', rev(order('Drafted', 'Unpaid', 10)) === false);
check('Cancelled is not revenue', rev(order('Cancelled', 'Unpaid', 10)) === false);
check('Returned is not revenue', rev(order('Returned', 'Unpaid', 10)) === false);
check('Cancel-paid Shipped is not revenue', rev(order('Shipped', 'Cancel', 10)) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
