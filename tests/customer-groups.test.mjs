// Unit test of src/utils/customerGroups.ts: Sales Setup › Customer Groups —
// the group list, the phone-digits -> group map, the scoped config ops that
// tag / untag one customer or free a removed group's customers, and the
// Orders column filter. Transpiled on the fly with the repo's esbuild; see
// tests/README.md.
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = await build({
    stdin: { contents: `export * from './src/utils/customerGroups.ts'; export * from './src/utils/configOps.ts';`, resolveDir: repo, loader: 'ts' },
    bundle: true, format: 'esm', write: false,
});
const bundlePath = path.join(repo, 'tests', '.customer-groups.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const m = await import('file:///' + bundlePath.split(path.sep).join('/'));
rmSync(bundlePath);

let pass = 0, fail = 0;
const check = (l, c, extra) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c || extra === undefined ? '' : JSON.stringify(extra)); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const apply = (cfg, ops) => m.applyConfigOpsLocally(cfg, ops);

// The list (no built-in groups)
check('no list saved → no groups', eq(m.customerGroupList(undefined), []));
check('first add appends (two first adds both land)', eq(m.customerGroupOp(undefined, 'add', ' VIP '), { op: 'append', items: ['VIP'] })
    && eq(apply(apply({}, { customerGroups: m.customerGroupOp(undefined, 'add', 'VIP') }), { customerGroups: m.customerGroupOp(undefined, 'add', 'Reseller') }).customerGroups, ['VIP', 'Reseller']));
check('remove with no list saved → no change', m.customerGroupOp(undefined, 'remove', 'VIP') === null && m.customerGroupOp(['VIP'], 'add', ' ') === null);
check('then appends', eq(m.customerGroupOp(['VIP'], 'add', 'Reseller'), { op: 'append', items: ['Reseller'] }));
check('duplicate (any case) is no change', m.customerGroupOp(['VIP'], 'add', 'vip') === null);
check('remove matches any case', eq(m.customerGroupOp(['VIP'], 'remove', 'vip'), { op: 'removeItems', values: ['VIP'] }));

// The map
const MAP = m.customerGroupMemberMap({
    '012345678': { group: 'VIP', name: ' Dara ' },
    '098765432': { group: 'Reseller' },
    '010111222': { group: 'vip' },
    '012 999 888': { group: 'VIP' },     // not digits-only: dropped
    '011000000': { group: '  ' },        // no group: dropped
    '011000001': 'VIP',                  // not an object: dropped
});
check('malformed entries are dropped, names trimmed', eq(MAP, { '012345678': { group: 'VIP', name: 'Dara' }, '098765432': { group: 'Reseller' }, '010111222': { group: 'vip' } }), MAP);
check('not an object → empty', eq(m.customerGroupMemberMap([1]), {}) && eq(m.customerGroupMemberMap(null), {}));
check('phone digits', m.phoneDigits('+855 (12) 345-678') === '85512345678' && m.phoneDigits(null) === '');
check('an order finds its group by digits', m.customerGroupOf(MAP, '012 345 678') === 'VIP' && m.customerGroupOf(MAP, '012-345-678') === 'VIP');
check('no group / no phone → empty', m.customerGroupOf(MAP, '011 000 000') === '' && m.customerGroupOf(MAP, '') === '' && m.customerGroupOf(MAP, undefined) === '');

// Tagging one customer
check('tag: merge scoped to the phone digits', eq(m.customerGroupMemberOp(MAP, '097 111 222', 'VIP', 'Sok'), { op: 'merge', value: { '097111222': { group: 'VIP', name: 'Sok' } } }));
check('tag without a name', eq(m.customerGroupMemberOp(MAP, '097111222', 'VIP'), { op: 'merge', value: { '097111222': { group: 'VIP' } } }));
check('same group and name → no change', m.customerGroupMemberOp(MAP, '012 345 678', 'VIP', ' Dara ') === null);
check('moving to another group', eq(m.customerGroupMemberOp(MAP, '012345678', 'Reseller', 'Dara'), { op: 'merge', value: { '012345678': { group: 'Reseller', name: 'Dara' } } }));
check('untag: unset that phone only', eq(m.customerGroupMemberOp(MAP, '012 345 678', ''), { op: 'unsetKeys', keys: ['012345678'] }));
check('untag a customer in no group → no change', m.customerGroupMemberOp(MAP, '097111222', '') === null);
check('no digits → no change', m.customerGroupMemberOp(MAP, 'n/a', 'VIP') === null);
check('a long name is cut', m.customerGroupMemberOp(MAP, '097111222', 'VIP', 'x'.repeat(200)).value['097111222'].name.length === m.MAX_MEMBER_NAME);
check('another customer tagged meanwhile is kept', eq(apply({ customerGroupMembers: { '098765432': { group: 'Reseller' }, '011222333': { group: 'VIP' } } },
    { customerGroupMembers: m.customerGroupMemberOp(MAP, '012345678', '') }).customerGroupMembers, { '098765432': { group: 'Reseller' }, '011222333': { group: 'VIP' } }));
check('first tag on a store with no map yet', eq(apply({}, { customerGroupMembers: m.customerGroupMemberOp({}, '012345678', 'VIP') }).customerGroupMembers, { '012345678': { group: 'VIP' } }));

// Removing a group
check('phones in a group, any case', eq(m.phonesInGroup(MAP, 'VIP').sort(), ['010111222', '012345678']));
check('removing a group frees its customers', eq(m.freeMembersOfGroupOp(MAP, 'vip'), { op: 'unsetKeys', keys: ['012345678', '010111222'] }));
check('removing an empty group → no op', m.freeMembersOfGroupOp(MAP, 'Wholesale') === null);

// Orders column filter / picker
check('filter: phones whose group contains the text', eq(m.phonesMatchingGroupText(MAP, 'vi').sort(), ['010111222', '012345678']) && eq(m.phonesMatchingGroupText(MAP, 'sell'), ['098765432']));
check('filter: blank text → none', eq(m.phonesMatchingGroupText(MAP, '  '), []));
check('picker keeps a removed group on screen', eq(m.customerGroupOptions(['VIP'], 'Old'), ['VIP', 'Old']) && eq(m.customerGroupOptions(['VIP'], 'VIP'), ['VIP']) && eq(m.customerGroupOptions(['VIP'], ''), ['VIP']));
check('picker keeps a spelling that differs only in case (not shown as "No group")', eq(m.customerGroupOptions(['VIP'], 'vip'), ['VIP', 'vip']));

check('every op passes the config-op validator', (() => {
    try {
        for (const op of [m.customerGroupMemberOp(MAP, '097111222', 'VIP', 'Sok'), m.customerGroupMemberOp(MAP, '012345678', ''), m.freeMembersOfGroupOp(MAP, 'VIP')]) m.assertValidConfigOps({ customerGroupMembers: op });
        for (const op of [m.customerGroupOp(undefined, 'add', 'VIP'), m.customerGroupOp(['VIP'], 'remove', 'VIP')]) m.assertValidConfigOps({ customerGroups: op });
        return true;
    } catch { return false; }
})());

// migrations/add_customer_groups.sql in PGlite: the Orders filter's
// customer_phone_digits(sales), run twice (safe to re-run).
{
    const { PGlite } = await import(process.env.PGLITE_DIST || '@electric-sql/pglite');
    const db = new PGlite();
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
        CREATE TABLE sales (id TEXT PRIMARY KEY, customer_snapshot JSONB);
        INSERT INTO sales VALUES ('a', '{"phone":"012 345 678"}'), ('b', '{"phone":"012-345-678"}'), ('c', '{"phone":"+855 12 345 678"}'),
            ('d', '{"name":"no phone"}'), ('e', NULL), ('f', '{"phone":"098765432"}');`);
    const sql = (await import('fs')).readFileSync(path.join(repo, 'migrations', 'add_customer_groups.sql'), 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    const ids = async (phones) => (await db.query(`SELECT id FROM sales s WHERE public.customer_phone_digits(s) = ANY($1) ORDER BY id`, [phones])).rows.map(r => r.id).join(',');
    check('SQL: spaced and dashed phones match their digits', await ids(['012345678']) === 'a,b');
    check('SQL: other groups / +855 spelling are separate keys', await ids(['098765432', '85512345678']) === 'c,f');
    const none = (await db.query(`SELECT id, public.customer_phone_digits(s) AS d FROM sales s WHERE id IN ('d','e') ORDER BY id`)).rows;
    check('SQL: no phone → empty digits', none.every(r => r.d === ''), none);
    await db.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
