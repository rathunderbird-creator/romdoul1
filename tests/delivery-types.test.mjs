// Unit test of src/utils/deliveryTypes.ts (and the shared defaultedList.ts):
// Sales Setup › Delivery Types — the list (defaults until a store saves its
// own), each courier's type (an order shows its courier's), the map edits
// and the Orders column filter. Transpiled on the fly with the repo's
// esbuild; see tests/README.md.
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = await build({
    stdin: { contents: `export * from './src/utils/deliveryTypes.ts'; export * from './src/utils/configOps.ts';`, resolveDir: repo, loader: 'ts' },
    bundle: true, format: 'esm', write: false,
});
const bundlePath = path.join(repo, 'tests', '.delivery-types.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const m = await import('file:///' + bundlePath.replace(/\\/g, '/'));
rmSync(bundlePath);

let pass = 0, fail = 0;
const check = (l, c, extra) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c || extra === undefined ? '' : JSON.stringify(extra)); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const D = m.DEFAULT_DELIVERY_TYPES;
const after = (saved, op) => m.applyConfigOpsLocally(saved === undefined ? {} : { deliveryTypes: saved }, { deliveryTypes: op }).deliveryTypes;

check('no saved list → the defaults', eq(m.deliveryTypeList(undefined), D) && D.length === 4);
check('first add keeps the defaults (set)', (() => { const op = m.deliveryTypeOp(undefined, 'add', 'Motor taxi'); return op.op === 'set' && eq(after(undefined, op), [...D, 'Motor taxi']); })());
check('later add appends; duplicate is a no-op', eq(after(['A'], m.deliveryTypeOp(['A'], 'add', 'B')), ['A', 'B']) && m.deliveryTypeOp(['A'], 'add', ' a ') === null);
check('remove (any case)', eq(after(['A', 'B'], m.deliveryTypeOp(['A', 'B'], 'remove', 'b')), ['A']));

check('map: malformed entries dropped', eq(m.courierTypeMap({ 'J&T': 'Province courier', '': 'X', VET: '', D2D: 5, Grab: ' Grab / Express ' }), { 'J&T': 'Province courier', Grab: 'Grab / Express' })
    && eq(m.courierTypeMap(null), {}) && eq(m.courierTypeMap(['x']), {}));
const MAP = { 'J&T': 'Province courier', 'អ្នកដឹក': 'Phnom Penh delivery' };
check('order type follows its courier (case / spaces ignored)', m.courierDeliveryType(MAP, ' j&t ') === 'Province courier' && m.courierDeliveryType(MAP, 'អ្នកដឹក') === 'Phnom Penh delivery');
check('no courier or unmapped → no type', m.courierDeliveryType(MAP, '') === '' && m.courierDeliveryType(MAP, null) === '' && m.courierDeliveryType(MAP, 'VET') === '');

check('set a courier type', eq(m.withCourierType(MAP, 'VET', 'Province courier'), { ...MAP, VET: 'Province courier' }));
check('set replaces other spellings of the courier', eq(m.withCourierType({ 'j&t ': 'Old', X: 'Y' }, 'J&T', 'Province courier'), { X: 'Y', 'J&T': 'Province courier' }));
check('clear a courier type', eq(m.withCourierType(MAP, 'J&T', ''), { 'អ្នកដឹក': 'Phnom Penh delivery' }) && eq(m.withCourierType(MAP, '  ', 'X'), MAP));
check('removing a type frees its couriers', eq(m.withoutTypeInMap({ A: 'T1', B: 't1 ', C: 'T2' }, 'T1'), { C: 'T2' }));

const mapAfter = (map, op) => m.applyConfigOpsLocally({ courierDeliveryTypes: map }, { courierDeliveryTypes: op }).courierDeliveryTypes;
check('courier op: merge touches only that courier', eq(m.courierTypeOp(MAP, 'VET', 'Province courier'), { op: 'merge', value: { VET: 'Province courier' } }));
check('courier op: reuses the saved spelling', eq(mapAfter({ 'j&t ': 'Old' }, m.courierTypeOp({ 'j&t ': 'Old' }, 'J&T', 'New')), { 'j&t ': 'New' }));
check('courier op: clear unsets every spelling; no-ops are null', eq(mapAfter({ 'J&T': 'A', 'j&t': 'A', X: 'B' }, m.courierTypeOp({ 'J&T': 'A', 'j&t': 'A', X: 'B' }, 'J&T', '')), { X: 'B' })
    && m.courierTypeOp(MAP, 'J&T', 'Province courier') === null && m.courierTypeOp(MAP, 'VET', '') === null && m.courierTypeOp(MAP, ' ', 'X') === null);
check('first pick on a store with no map yet', eq(m.applyConfigOpsLocally({}, { courierDeliveryTypes: m.courierTypeOp({}, 'J&T', 'Province courier') }).courierDeliveryTypes, { 'J&T': 'Province courier' }));
check('free couriers of a removed type', eq(mapAfter({ A: 'T1', B: 't1 ', C: 'T2' }, m.freeCouriersOfTypeOp({ A: 'T1', B: 't1 ', C: 'T2' }, 'T1')), { C: 'T2' }) && m.freeCouriersOfTypeOp({ C: 'T2' }, 'T1') === null);
check('every op passes the config-op validator', (() => { try { for (const op of [m.courierTypeOp(MAP, 'VET', 'X'), m.courierTypeOp(MAP, 'J&T', ''), m.freeCouriersOfTypeOp(MAP, 'Province courier')]) m.assertValidConfigOps({ courierDeliveryTypes: op }); return true; } catch { return false; } })());
check('column filter: couriers whose type contains the text', eq(m.couriersMatchingTypeText({ A: 'Province courier', B: 'Phnom Penh delivery', C: 'Grab / Express' }, 'penh'), ['B'])
    && eq(m.couriersMatchingTypeText({ A: 'Province courier', B: 'Phnom Penh delivery' }, 'PROV'), ['A'])
    && eq(m.couriersMatchingTypeText({ A: 'Province courier' }, 'pickup'), []) && eq(m.couriersMatchingTypeText({ A: 'x' }, '  '), []));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
