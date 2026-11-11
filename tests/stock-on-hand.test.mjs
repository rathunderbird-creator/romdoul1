// Unit test of src/utils/stockOnHand.ts — the INV-1 rule: Stock on Hand lines
// are the tracked per-warehouse figures plus an explicit Unassigned remainder,
// so they always sum to the authoritative products.stock. Transpiled on the
// fly with the repo's esbuild; see tests/README.md.
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = await build({
    entryPoints: [path.join(repo, 'src', 'utils', 'stockOnHand.ts')],
    bundle: true, format: 'esm', write: false,
});
const bundlePath = path.join(repo, 'tests', '.stock-on-hand.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const m = await import('file:///' + bundlePath.replace(/\\/g, '/'));
rmSync(bundlePath);

let pass = 0, fail = 0;
const check = (l, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l); };
const lines = m.productWarehouseLines;
const sum = ls => ls.reduce((s, l) => s + l.qty, 0);

// The audit's own scenario: a warehouse row of 20, then 15 retail shipments
// and a PO receipt of 50 move only products.stock (now 55). The report used
// to keep showing 20.
const audited = lines(55, [{ warehouseId: 'w1', warehouseName: 'Main', qty: 20 }]);
check('audit scenario: lines sum to the real company stock (55)', sum(audited) === 55);
check('audit scenario: tracked warehouse row stays at its tracked 20', audited.find(l => l.warehouseId === 'w1')?.qty === 20);
check('audit scenario: the 35 the warehouse rows miss shows as Unassigned', audited.find(l => l.warehouseId === null)?.qty === 35);

// No warehouse rows at all → one Unassigned row of the full stock (as before).
const untracked = lines(12, [{ warehouseId: 'w1', warehouseName: 'Main', qty: 0 }]);
check('untracked product: one Unassigned row', untracked.length === 1 && untracked[0].warehouseId === null);
check('untracked product: full stock', untracked[0].qty === 12);

// Fully tracked → no remainder row.
const exact = lines(30, [
    { warehouseId: 'w1', warehouseName: 'Main', qty: 10 },
    { warehouseId: 'w2', warehouseName: 'Branch', qty: 20 },
]);
check('fully tracked: no Unassigned row', !exact.some(l => l.warehouseId === null));
check('fully tracked: sums to stock', sum(exact) === 30);

// Warehouse rows can exceed company stock (e.g. a sale shipped after the
// adjustment) → the remainder is negative, shown, not hidden.
const over = lines(5, [{ warehouseId: 'w1', warehouseName: 'Main', qty: 9 }]);
check('over-tracked: negative Unassigned remainder of -4', over.find(l => l.warehouseId === null)?.qty === -4);
check('over-tracked: still sums to stock', sum(over) === 5);

// Zero company stock with a stale tracked row still reconciles to 0.
const zero = lines(0, [{ warehouseId: 'w1', warehouseName: 'Main', qty: 7 }]);
check('zero stock: sums to 0', sum(zero) === 0);

// No stock anywhere → no rows at all.
check('nothing anywhere: no lines', lines(0, [{ warehouseId: 'w1', warehouseName: 'Main', qty: 0 }]).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
