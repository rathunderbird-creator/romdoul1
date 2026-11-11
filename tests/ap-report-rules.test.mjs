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

// A payment made BEFORE the bill is owed is a prepayment: it must show as a
// CREDIT as at that date, not silently vanish from the aging.
const poPrepaid = { id: 'po4', bill_date: '2026-11-03', order_date: '2026-10-01', total_amount: 500 };
const prepayment = [{ purchase_order_id: 'po4', payment_date: '2026-10-15', amount: 200 }];
check('a prepayment on a not-yet-owed bill shows as a credit (−200)', m.outstandingAsAt(poPrepaid, prepayment, '2026-10-31') === -200);
check('once the bill is owed, the prepayment nets off (300)', m.outstandingAsAt(poPrepaid, prepayment, '2026-11-03') === 300);

// ── owedFromDateOf: a received-but-unbilled PO is owed from its RECEIVE date ──
const unbilled = { bill_date: null, order_date: '2026-06-01' };
check('owedFromDateOf prefers bill_date', m.owedFromDateOf({ bill_date: '2026-10-05', order_date: '2026-06-01' }, '2026-09-10') === '2026-10-05');
check('owedFromDateOf uses the receive date when unbilled', m.owedFromDateOf(unbilled, '2026-09-10') === '2026-09-10');
check('owedFromDateOf falls back to order_date', m.owedFromDateOf(unbilled, null) === '2026-06-01');
// The verifier's reconciliation scenario: ordered June 1, received Sept 10 —
// an "As at July 31" aging must NOT show it (the ledger credits A/P at the
// receive), but a September 30 one must.
const poJun = { id: 'po5', bill_date: null, order_date: '2026-06-01', total_amount: 800 };
check('unbilled PO not owed between order and receive', m.outstandingAsAt(poJun, [], '2026-07-31', '2026-09-10') === 0);
check('unbilled PO owed once received', m.outstandingAsAt(poJun, [], '2026-09-30', '2026-09-10') === 800);

// ── legacyPaidOf: amount_paid set with no payment rows (pre-payments-table data) ──
const legacy = { id: 'po6', bill_date: '2025-03-01', order_date: '2025-02-20', total_amount: 1200, amount_paid: 1200 };
check('legacy fully-paid bill (no payment rows) owes 0, not its full total', m.outstandingAsAt(legacy, [], '2026-11-11') === 0);
const legacyPartRows = [{ purchase_order_id: 'po6', payment_date: '2025-03-05', amount: 400 }];
check('legacyPaidOf is only the UNexplained part of amount_paid', m.legacyPaidOf(legacy, legacyPartRows) === 800);
check('rows + legacy remainder together settle the bill', m.outstandingAsAt(legacy, legacyPartRows, '2026-11-11') === 0);
check('legacyPaidOf never negative when rows exceed amount_paid', m.legacyPaidOf({ id: 'po7', amount_paid: 100 }, [{ purchase_order_id: 'po7', payment_date: '2025-01-01', amount: 150 }]) === 0);

// ── statementPayments: payments applied to the statement's charges, plus
// supplier-level payments not linked to any PO ──
const supPayments = [
    { id: 'a', supplier_id: 's1', purchase_order_id: 'bill1' },  // on a shown charge
    { id: 'b', supplier_id: 's1', purchase_order_id: 'sentPO' }, // deposit on an unreceived PO
    { id: 'c', supplier_id: 's2', purchase_order_id: 'bill1' },  // other supplier
    { id: 'd', supplier_id: 's1', purchase_order_id: null },     // unlinked supplier-level payment
];
const kept = m.statementPayments(supPayments, 's1', new Set(['bill1']));
check('keeps the payment applied to a shown charge', kept.some(p => p.id === 'a'));
check('drops a deposit on an unreceived PO (no matching charge)', !kept.some(p => p.id === 'b'));
check("drops another supplier's payment", !kept.some(p => p.id === 'c'));
check('keeps a payment not linked to any PO (still money paid to the supplier)', kept.some(p => p.id === 'd'));
check('keeps exactly two payments', kept.length === 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
