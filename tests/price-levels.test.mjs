// Unit test of src/utils/priceLevels.ts: Sales Setup › Price Levels — the
// saved list, adding / removing a level, linking a Customer Group to one
// level, and the level (and discount) Checkout finds for a customer's
// phone. Transpiled on the fly with the repo's esbuild; see tests/README.md.
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = await build({
    stdin: { contents: `export * from './src/utils/priceLevels.ts';`, resolveDir: repo, loader: 'ts' },
    bundle: true, format: 'esm', write: false,
});
const bundlePath = path.join(repo, 'tests', '.price-levels.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const m = await import('file:///' + bundlePath.split(path.sep).join('/'));
rmSync(bundlePath);

let pass = 0, fail = 0;
const check = (l, c, extra) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c || extra === undefined ? '' : JSON.stringify(extra)); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The saved list
const L = m.priceLevelList([
    { name: ' Dealer ', pct: 10, groups: ['VIP', ' Reseller ', 'vip'] },
    { name: 'Staff', pct: 15.555, groups: ['Reseller', 'Staff'] },  // Reseller already on Dealer
    { name: 'dealer', pct: 5 },                                       // duplicate name
    { name: 'Free', pct: 0 }, { name: 'Over', pct: 101 }, { name: '', pct: 5 }, 'x', null,
]);
check('malformed and duplicate levels dropped; groups once, first level wins', eq(L, [
    { name: 'Dealer', pct: 10, groups: ['VIP', 'Reseller'] },
    { name: 'Staff', pct: 15.56, groups: ['Staff'] },
]), L);
check('nothing saved → no levels', eq(m.priceLevelList(undefined), []) && eq(m.priceLevelList({}), []));

// Adding / removing
check('problems', m.priceLevelProblem(L, ' ', '10') === 'needName' && m.priceLevelProblem(L, 'DEALER', '10') === 'duplicate'
    && m.priceLevelProblem(L, 'New', '') === 'badValue' && m.priceLevelProblem(L, 'New', '0') === 'badValue'
    && m.priceLevelProblem(L, 'New', 'abc') === 'badValue' && m.priceLevelProblem(L, 'New', '100.5') === 'pctOver100'
    && m.priceLevelProblem(L, 'New', '12.5') === null);
check('add: trimmed, rounded, no groups yet', eq(m.withPriceLevel([], ' Dealer ', 12.345), [{ name: 'Dealer', pct: 12.35, groups: [] }]));
check('remove matches any case', eq(m.withoutPriceLevel(L, 'staff').map(l => l.name), ['Dealer']));

// Linking groups
const moved = m.withLevelGroup(L, 'Staff', 'vip', true);
check('linking a group moves it off its other level', eq(moved.map(l => l.groups), [['Reseller'], ['Staff', 'vip']]), moved);
check('unlinking', eq(m.withLevelGroup(L, 'Dealer', 'VIP', false)[0].groups, ['Reseller']));
check('a removed Customer Group comes off every level', eq(m.withoutGroupOnLevels(L, 'reseller').map(l => l.groups), [['VIP'], ['Staff']]));
check('unknown level / blank group → unchanged', m.withLevelGroup(L, 'Nope', 'VIP', true) === L && m.withLevelGroup(L, 'Dealer', ' ', true) === L);

// Checkout lookup
const MEMBERS = { '012345678': { group: 'vip', name: 'Dara' }, '098765432': { group: 'Walk-in' } };
check('a level for the group, any case', m.priceLevelForGroup(L, 'reseller')?.name === 'Dealer' && m.priceLevelForGroup(L, 'Walk-in') === null && m.priceLevelForGroup(L, '') === null);
const hit = m.priceLevelForPhone(L, MEMBERS, '012 345 678');
check('a tagged phone finds its level and group', hit?.level.name === 'Dealer' && hit?.group === 'vip', hit);
check('a group with no level, or no group → null', m.priceLevelForPhone(L, MEMBERS, '098765432') === null && m.priceLevelForPhone(L, MEMBERS, '011111111') === null && m.priceLevelForPhone(L, MEMBERS, '') === null);
check('amount: percent of the subtotal, cents', m.priceLevelAmount(L[0], 45) === 4.5 && m.priceLevelAmount(L[1], 10) === 1.56 && m.priceLevelAmount(L[0], 0) === 0 && m.priceLevelAmount(L[0], -5) === 0);
check('100% never goes past the subtotal', m.priceLevelAmount({ name: 'x', pct: 100, groups: [] }, 12.34) === 12.34);
check('label', m.priceLevelPctLabel(L[1]) === '15.56%' && m.priceLevelPctLabel(L[0]) === '10%');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
