// Unit test of src/utils/discountPresets.ts: Sales Setup › Discounts presets
// (validation, the saved-list cleanup, add/remove) and the USD amount a pick
// fills in Checkout (percent of the items' price or a fixed amount, rounded
// to cents, never below 0 or above the items' price). Transpiled on the fly
// with the repo's esbuild; see tests/README.md.
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = await build({
    stdin: { contents: `export * from './src/utils/discountPresets.ts';`, resolveDir: repo, loader: 'ts' },
    bundle: true, format: 'esm', write: false,
});
const bundlePath = path.join(repo, 'tests', '.discount-presets.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const m = await import('file:///' + bundlePath.replace(/\\/g, '/'));
rmSync(bundlePath);

let pass = 0, fail = 0;
const check = (l, c, extra) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c || extra === undefined ? '' : JSON.stringify(extra)); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const VIP = { name: 'VIP', type: 'pct', value: 10 };
const REP = { name: 'Repeat buyer', type: 'usd', value: 2 };

check('no saved list → none', eq(m.discountPresetList(undefined), []) && eq(m.discountPresetList('x'), []));
check('malformed entries are dropped', eq(m.discountPresetList([VIP, { name: '', type: 'pct', value: 5 }, { name: 'A', type: 'pct', value: 150 }, { name: 'B', type: 'usd', value: -1 }, { name: 'C', type: 'x', value: 1 }, null, { name: ' D ', type: 'usd', value: 3 }]),
    [VIP, { name: 'D', type: 'usd', value: 3 }]));

const P = (n, t, v) => m.discountPresetProblem([VIP], n, t, v);
check('valid new preset', P('Staff', 'pct', '15') === null && P('Gift', 'usd', '2.5') === null);
check('name required', P('  ', 'pct', '5') === 'needName');
check('duplicate name (any case)', P(' vip ', 'usd', '5') === 'duplicate');
check('value must be > 0', P('A', 'usd', '0') === 'badValue' && P('A', 'usd', '') === 'badValue' && P('A', 'usd', 'abc') === 'badValue' && P('A', 'pct', '-3') === 'badValue');
check('a value that rounds to 0 is refused', P('A', 'usd', '0.004') === 'badValue' && P('A', 'pct', '0.001') === 'badValue');
check('percent at most 100', P('A', 'pct', '100') === null && P('A', 'pct', '100.5') === 'pctOver100');
check('a fixed amount above 100 is fine', P('Big', 'usd', '150') === null);

check('add rounds and trims', eq(m.withDiscountPreset([VIP], '  Gift ', 'usd', 2.499), [VIP, { name: 'Gift', type: 'usd', value: 2.5 }]));
check('remove by name, any case', eq(m.withoutDiscountPreset([VIP, REP], 'repeat BUYER'), [VIP]) && eq(m.withoutDiscountPreset([VIP], 'nope'), [VIP]));

const A = m.discountPresetAmount;
check('percent of the subtotal', A(VIP, 125) === 12.5 && A({ name: 'x', type: 'pct', value: 15 }, 33.33) === 5);
check('percent rounds to cents', A({ name: 'x', type: 'pct', value: 7 }, 19.99) === 1.4);
check('fixed amount', A(REP, 30) === 2);
check('never more than the subtotal', A({ name: 'x', type: 'usd', value: 50 }, 20) === 20 && A({ name: 'x', type: 'pct', value: 100 }, 20) === 20);
check('empty cart → 0', A(REP, 0) === 0 && A(VIP, 0) === 0 && A(REP, NaN) === 0);

check('labels', m.discountPresetValueLabel(VIP) === '10%' && m.discountPresetValueLabel(REP) === '$2.00' && m.discountPresetValueLabel({ name: 'x', type: 'pct', value: 12.5 }) === '12.5%');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
