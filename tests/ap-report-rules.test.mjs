// Unit test of src/utils/apReportRules.ts — the PRO-5 rules behind Purchase
// Reports: AP Aging honours its "As at" date, and the Supplier Statement only
// nets off payments applied to the bills it shows. Transpiled on the fly with
// the repo's esbuild; see tests/README.md.
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = await build({
    entryPoints: [path.join(repo, 'src', 'utils', 'apReportRules.ts')],
    bundle: true, format: 'esm', write: false,
});
const bundlePath = path.join(repo, 'tests', '.ap-report-rules.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const m = await import('file:///' + bundlePath.replace(/\\/g, '/'));
rmSync(bundlePath);

let pass = 0, fail = 0;
const check = (l, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l); };

// ── billDateOf ──
check('billDateOf prefers bill_date', m.billDateOf({ bill_date: '2026-10-05', order_date: '2026-09-01' }) === '2026-10-05');
check('billDateOf falls back to order_date', m.billDateOf({ bill_date: null, order_date: '2026-09-01' }) === '2026-09-01');
check('billDateOf trims a timestamp to the day', m.billDateOf({ bill_date: null, order_date: '2026-09-01T10:00:00Z' }) === '2026-09-01');

// ── paidAsAt / outstandingAsAt ──
const payments = [
    { purchase_order_id: 'po1', payment_date: '2026-10-10', amount: 300 },
    { purchase_order_id: 'po1', payment_date: '2026-11-05', amount: 700 }, // after asAt
    { purchase_order_id: 'po2', payment_date: '2026-10-01', amount: 50 },  // other PO
];
check('paidAsAt counts only this PO, up to asAt', m.paidAsAt('po1', payments, '2026-10-31') === 300);
check('paidAsAt includes the day itself', m.paidAsAt('po1', payments, '2026-11-05') === 1000);

const po1 = { id: 'po1', bill_date: '2026-10-01', order_date: '2026-09-20', total_amount: 1000 };
check('outstandingAsAt = total − payments made by then', m.outstandingAsAt(po1, payments, '2026-10-31') === 700);
check('outstandingAsAt reaches 0 once fully paid', m.outstandingAsAt(po1, payments, '2026-12-01') === 0);
const poNov = { id: 'po3', bill_date: '2026-11-03', order_date: '2026-11-03', total_amount: 500 };
check('a bill dated after asAt owes nothing as of that date', m.outstandingAsAt(poNov, [], '2026-10-31') === 0);
check('the same bill is owed once asAt reaches its date', m.outstandingAsAt(poNov, [], '2026-11-03') === 500);

// ── statementPayments: only payments applied to the statement's bills ──
const supPayments = [
    { id: 'a', supplier_id: 's1', purchase_order_id: 'bill1' },  // on a shown bill
    { id: 'b', supplier_id: 's1', purchase_order_id: 'sentPO' }, // deposit on an unbilled PO
    { id: 'c', supplier_id: 's2', purchase_order_id: 'bill1' },  // other supplier
    { id: 'd', supplier_id: 's1', purchase_order_id: '' },       // unlinked
];
const kept = m.statementPayments(supPayments, 's1', new Set(['bill1']));
check('keeps the payment applied to a shown bill', kept.some(p => p.id === 'a'));
check('drops a deposit on an unbilled/unreceived PO', !kept.some(p => p.id === 'b'));
check("drops another supplier's payment", !kept.some(p => p.id === 'c'));
check('drops a payment not linked to any bill', !kept.some(p => p.id === 'd'));
check('keeps exactly one payment', kept.length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
