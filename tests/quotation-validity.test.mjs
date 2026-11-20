// Unit test of src/utils/quotationValidity.ts: Sales Setup › Defaults ›
// Quotation validity (days) — what the field saves for what was typed, how a
// saved value is read, and the Valid until a new CRM quotation starts with.
// Transpiled on the fly with the repo's esbuild; see tests/README.md.
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = await build({
    stdin: { contents: `export * from './src/utils/quotationValidity.ts';`, resolveDir: repo, loader: 'ts' },
    bundle: true, format: 'esm', write: false,
});
const bundlePath = path.join(repo, 'tests', '.quotation-validity.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const m = await import('file:///' + bundlePath.replace(/\\/g, '/'));
rmSync(bundlePath);

let pass = 0, fail = 0;
const check = (l, c, extra) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c || extra === undefined ? '' : JSON.stringify(extra)); };

check('nothing saved → none', m.quotationValidityDays(undefined) === null && m.quotationValidityDays('') === null && m.quotationValidityDays(null) === null);
check('a saved whole number is read', m.quotationValidityDays('14') === 14 && m.quotationValidityDays(' 30 ') === 30 && m.quotationValidityDays(7) === 7);
check('1 and 365 are the limits', m.quotationValidityDays('1') === 1 && m.quotationValidityDays('365') === 365);
check('out of range or not whole → none', ['0', '366', '-5', '1.5', '7d', 'abc', '1e2'].every(v => m.quotationValidityDays(v) === null) && m.quotationValidityDays(2.5) === null);

check('empty input clears', m.quotationValidityInput('') === '' && m.quotationValidityInput('   ') === '');
check('valid input saves the number', m.quotationValidityInput(' 14 ') === '14' && m.quotationValidityInput('007') === '7');
check('bad input is refused', ['0', '400', '2.5', '-1', 'x'].every(v => m.quotationValidityInput(v) === null));

check('no setting → no date', m.defaultQuotationValidUntil(undefined, '2026-11-20') === '');
check('today + days', m.defaultQuotationValidUntil('14', '2026-11-20') === '2026-12-04');
check('crosses a year end', m.defaultQuotationValidUntil('30', '2026-12-15') === '2027-01-14');
check('crosses a leap day', m.defaultQuotationValidUntil('1', '2028-02-28') === '2028-02-29');
check('a bad saved value or today → no date', m.defaultQuotationValidUntil('abc', '2026-11-20') === '' && m.defaultQuotationValidUntil('14', '2026-02-30') === '');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
