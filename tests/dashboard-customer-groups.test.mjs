// Unit test of Dashboard 2's Customer groups grouping (src/pages/dashboard2/
// metrics.ts groupOrders 'customerGroup'): orders grouped by their phone's
// Sales Setup › Customer Group, customers in no group in the '' row.
// Transpiled on the fly with the repo's esbuild; see tests/README.md.
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = await build({
    stdin: { contents: `export * from './src/pages/dashboard2/metrics.ts';`, resolveDir: repo, loader: 'ts' },
    bundle: true, format: 'esm', write: false,
});
const bundlePath = path.join(repo, 'tests', '.dashboard-customer-groups.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const m = await import('file:///' + bundlePath.split(path.sep).join('/'));
rmSync(bundlePath);

let pass = 0, fail = 0;
const check = (l, c, extra) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c || extra === undefined ? '' : JSON.stringify(extra)); };

const order = (id, phone, total, status = 'Shipped') => ({
    id, date: '2026-11-20T09:00:00', total, items: [{ id: 'p', name: 'X', price: total, quantity: 1 }],
    customer: { name: 'C' + id, phone }, paymentStatus: 'Unpaid', paymentMethod: 'COD', shipping: { status },
});
const MEMBERS = { '012345678': { group: 'VIP' }, '098765432': { group: 'Reseller' } };
const ORDERS = [order('1', '012 345 678', 40), order('2', '012-345-678', 10), order('3', '098765432', 25), order('4', '011111111', 5), order('5', '', 7)];

const rows = m.groupOrders(ORDERS, 'customerGroup', 'All', MEMBERS);
const by = Object.fromEntries(rows.map(r => [r.key, r]));
check('orders grouped by the phone\'s group (any phone format)', by.VIP?.orders === 2 && by.Reseller?.orders === 1, rows.map(r => [r.key, r.orders]));
check('no group / no phone → the unassigned row', by['']?.orders === 2);
check('revenue per group', by.VIP?.revenue === 50 && by.Reseller?.revenue === 25, rows.map(r => [r.key, r.revenue]));
check('key lookup directly', m.groupKeyOf(ORDERS[0], 'customerGroup', MEMBERS) === 'VIP' && m.groupKeyOf(ORDERS[3], 'customerGroup', MEMBERS) === '' && m.groupKeyOf(ORDERS[0], 'customerGroup') === '');
check('other kinds unchanged', m.groupKeyOf({ ...ORDERS[0], salesman: ' Sok ' }, 'salesman') === 'Sok');
check('status filter applies', m.groupOrders(ORDERS, 'customerGroup', 'Pending', MEMBERS).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
