// PGlite test of migrations/add_config_functions.sql (audit APP-1) plus a
// parity check against src/utils/configOps.ts — the JS mirror that drives the
// optimistic UI update and the pre-migration fallback. See tests/README.md.
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { useLiveTypes } from './live-schema.mjs';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';

const { PGlite } = await import(process.env.PGLITE_DIST || '@electric-sql/pglite');

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MIG = path.join(repo, 'migrations', 'add_config_functions.sql');
const db = new PGlite();
const q = (s, p) => db.query(s, p);
let pass = 0, fail = 0;
const check = (label, cond, extra) => {
    if (cond) { pass++; console.log('PASS', label); }
    else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); }
};
// Order-insensitive for object keys (jsonb stores them in its own canonical
// order), order-SENSITIVE for arrays (list order is data here).
const canon = (v) => Array.isArray(v) ? v.map(canon)
    : (v && typeof v === 'object')
        ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]))
        : v;
const deepEq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// JS mirror, transpiled with the repo's own esbuild.
const out = await build({
    entryPoints: [path.join(repo, 'src', 'utils', 'configOps.ts')],
    bundle: true, format: 'esm', write: false,
});
const bundlePath = path.join(repo, 'tests', '.configops.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const { applyConfigOpsLocally } = await import('file:///' + bundlePath.replace(/\\/g, '/'));
rmSync(bundlePath);

// app_config as in migrations/full_schema.sql.
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE TABLE app_config (
    id BIGINT PRIMARY KEY,
    data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now());
-- As in the live stores: the app reads and writes app_config directly with
-- the anon key, so anon already has table privileges there.
GRANT ALL ON app_config TO anon, authenticated;
`);
await useLiveTypes(db); // app_config on the live column types

const strip = f => fs.readFileSync(f, 'utf8').replace(/NOTIFY[^;]*;/g, '');
await db.exec(strip(MIG));
await db.exec(strip(MIG)); // safe to re-run
check('migration runs twice', true);

const update = async (ops) => (await q(`SELECT update_app_config($1::jsonb) AS cfg`, [JSON.stringify(ops)])).rows[0].cfg;
const stored = async () => (await q(`SELECT data FROM app_config WHERE id = 1`)).rows[0]?.data;

// There is no separate probe function (the app detects a missing
// update_app_config from the call's own error); an earlier draft's leftover
// must be dropped by the migration.
check('leftover app_config_functions_ready is dropped',
    (await q(`SELECT COUNT(*)::int AS n FROM pg_proc WHERE proname = 'app_config_functions_ready'`)).rows[0].n === 0);

// ---- Fresh store: no row yet ----
let cfg = await update({ categories: { op: 'set', value: ['Speakers'] } });
check('missing row is created, not an error', deepEq(cfg, { categories: ['Speakers'] }));
check('returned config equals stored config', deepEq(cfg, await stored()));

// ---- set / merge / unsetKeys / remove ----
cfg = await update({ khrExchangeRate: { op: 'set', value: 4100 }, storeName: { op: 'set', value: 'Romdoul 1' } });
check('two keys in one call both land', cfg.khrExchangeRate === 4100 && cfg.storeName === 'Romdoul 1');
cfg = await update({ shippingRates: { op: 'merge', value: { 'J&T': 1.5 } } });
cfg = await update({ shippingRates: { op: 'merge', value: { VET: 2 } } });
check('merge builds up an object key', deepEq(cfg.shippingRates, { 'J&T': 1.5, VET: 2 }));
cfg = await update({ shippingRates: { op: 'unsetKeys', keys: ['J&T', 'ghost'] } });
check('unsetKeys deletes listed fields only', deepEq(cfg.shippingRates, { VET: 2 }));
cfg = await update({ storeName: { op: 'remove' } });
check('remove drops the key', !('storeName' in cfg) && cfg.khrExchangeRate === 4100);

// ---- append / prepend / removeItems on plain-string arrays ----
cfg = await update({ categories: { op: 'append', items: ['Mics', 'Speakers', 'Mixers'] } });
check('append skips items already there', deepEq(cfg.categories, ['Speakers', 'Mics', 'Mixers']));
cfg = await update({ salesOrder: { op: 'prepend', items: ['s2'] } });
cfg = await update({ salesOrder: { op: 'prepend', items: ['s1'] } });
check('prepend puts new items first (missing key starts as [])', deepEq(cfg.salesOrder, ['s1', 's2']));
cfg = await update({ categories: { op: 'removeItems', values: ['Mics', 'ghost'] } });
check('removeItems removes matches, ignores unknowns', deepEq(cfg.categories, ['Speakers', 'Mixers']));

// ---- APP-1's exact scenario: two stale terminals, different keys/entries ----
// Writers send only their own operation, so how stale their screens are no
// longer matters: the database merges both onto the stored row in turn.
await q(`UPDATE app_config SET data = $1::jsonb WHERE id = 1`, [JSON.stringify({
    blockedCustomers: [{ phone: '012 111 222', name: 'Old Scammer' }],
    roles: [{ id: 'r1', name: 'Cashier', permissions: ['pos'] }],
    categories: ['Speakers']
})]);
// Terminal A (loaded at 09:00) marks scammer X; terminal B marks scammer Y.
await update({ blockedCustomers: { op: 'append', items: [{ phone: '+855 12 333 444', name: 'X' }], idKey: 'phone', norm: 'phone' } });
await update({ blockedCustomers: { op: 'append', items: [{ phone: '099888777', name: 'Y' }], idKey: 'phone', norm: 'phone' } });
// Terminal A then drags a product row (a different key entirely).
cfg = await update({ productOrder: { op: 'set', value: ['p9', 'p1'] } });
check('both scammers survive concurrent adds', deepEq(cfg.blockedCustomers.map(c => c.name), ['Old Scammer', 'X', 'Y']));
check('product drag does not touch blocklist/roles/categories',
    deepEq(cfg.roles, [{ id: 'r1', name: 'Cashier', permissions: ['pos'] }]) && deepEq(cfg.categories, ['Speakers']));

// Phone identity is normalized: same digits in another format is a duplicate.
cfg = await update({ blockedCustomers: { op: 'append', items: [{ phone: '(855) 12-333-444', name: 'X again' }], idKey: 'phone', norm: 'phone' } });
check('mixed-format duplicate phone not re-added', cfg.blockedCustomers.length === 3);
// Unblock by plain phone string, any format.
cfg = await update({ blockedCustomers: { op: 'removeItems', values: ['012 111-222'], idKey: 'phone', norm: 'phone' } });
check('unblock by differently-formatted phone works', deepEq(cfg.blockedCustomers.map(c => c.name), ['X', 'Y']));
// Edit an entry in place.
cfg = await update({ blockedCustomers: { op: 'updateItems', items: [{ phone: '+855 12 333 444', name: 'X', reason: 'chargeback' }], idKey: 'phone', norm: 'phone' } });
check('updateItems replaces the matching entry in place',
    cfg.blockedCustomers[0].reason === 'chargeback' && cfg.blockedCustomers[1].name === 'Y');

// ---- roles by id ----
cfg = await update({ roles: { op: 'append', items: [{ id: 'r2', name: 'Manager', permissions: [] }], idKey: 'id' } });
cfg = await update({ roles: { op: 'updateItems', items: [{ id: 'r1', name: 'Cashier+', permissions: ['pos', 'orders'] }], idKey: 'id' } });
check('role update touches only its row', cfg.roles[0].name === 'Cashier+' && cfg.roles[1].name === 'Manager');
cfg = await update({ roles: { op: 'removeItems', values: ['r2'], idKey: 'id' } });
check('role delete by id', deepEq(cfg.roles.map(r => r.id), ['r1']));

// ---- same-key set is last-write-wins (accepted) ----
await update({ taxRate: { op: 'set', value: 5 } });
cfg = await update({ taxRate: { op: 'set', value: 10 } });
check('same-key set: last write wins', cfg.taxRate === 10);

// ---- malformed input ----
const fails = async (ops) => { try { await update(ops); return false; } catch { return true; } };
check('unknown op rejected', await fails({ categories: { op: 'teleport' } }));
check('non-object op rejected', await fails({ categories: 42 }));
check('non-object p_ops rejected', await (async () => { try { await q(`SELECT update_app_config('[]'::jsonb)`); return false; } catch { return true; } })());
// A 'set' with no "value" key (what JSON.stringify makes of value: undefined)
// must RAISE — jsonb_set is STRICT, so letting it through would store
// data = NULL and destroy the entire config in one call.
check('set without value rejected', await fails({ storeAddress: { op: 'set' } }));
const after = await stored();
check('failed call changed nothing', after.taxRate === 10);
check('set-without-value did not null the config', after !== null && typeof after === 'object' && after.categories !== undefined);

// ---- wrong-shaped current values never crash ----
await q(`UPDATE app_config SET data = jsonb_set(data, '{categories}', '"oops"'::jsonb) WHERE id = 1`);
cfg = await update({ categories: { op: 'append', items: ['Cables'] } });
check('append onto a non-array treats it as empty', deepEq(cfg.categories, ['Cables']));
await q(`UPDATE app_config SET data = jsonb_set(data, '{shippingRates}', '7'::jsonb) WHERE id = 1`);
cfg = await update({ shippingRates: { op: 'merge', value: { VET: 2 } } });
check('merge onto a non-object treats it as empty', deepEq(cfg.shippingRates, { VET: 2 }));

// ---- anon/authenticated can execute ----
await db.exec(`SET ROLE anon`);
cfg = await update({ pages: { op: 'append', items: ['FB Page'] } });
check('anon can call update_app_config', deepEq(cfg.pages, ['FB Page']));
await db.exec(`RESET ROLE`);

// ---- parity: the JS mirror must agree with the SQL op-for-op ----
const parityBase = {
    categories: ['Speakers', 'Mics'],
    blockedCustomers: [{ phone: '012 111 222', name: 'A' }, { phone: '099888777', name: 'B' }],
    roles: [{ id: 'r1', name: 'Cashier', permissions: ['pos'] }],
    shippingRates: { 'J&T': 1.5 },
    taxRate: 5,
    weird: 'scalar'
};
const parityOps = [
    { categories: { op: 'append', items: ['Mics', 'Mixers'] } },
    { categories: { op: 'prepend', items: ['Cables', 'Speakers'] } },
    { categories: { op: 'removeItems', values: ['Mics', 'ghost'] } },
    { blockedCustomers: { op: 'append', items: [{ phone: '+855-12-111-222', name: 'dup' }, { phone: '010 2', name: 'C' }], idKey: 'phone', norm: 'phone' } },
    { blockedCustomers: { op: 'removeItems', values: ['099-888-777'], idKey: 'phone', norm: 'phone' } },
    { blockedCustomers: { op: 'updateItems', items: [{ phone: '012 111 222', name: 'A2', reason: 'x' }], idKey: 'phone', norm: 'phone' } },
    { roles: { op: 'updateItems', items: [{ id: 'r1', name: 'Cashier+', permissions: [] }], idKey: 'id' } },
    { roles: { op: 'append', items: [{ id: 'r2', name: 'Mgr', permissions: [] }], idKey: 'id' } },
    { shippingRates: { op: 'merge', value: { VET: 2 } } },
    { shippingRates: { op: 'unsetKeys', keys: ['J&T'] } },
    { taxRate: { op: 'set', value: 10 } },
    { weird: { op: 'remove' } },
    { fresh: { op: 'append', items: ['first'] } },
    { weird: { op: 'merge', value: { a: 1 } } }
];
await q(`UPDATE app_config SET data = $1::jsonb WHERE id = 1`, [JSON.stringify(parityBase)]);
let jsCfg = parityBase;
for (const [i, ops] of parityOps.entries()) {
    const sqlCfg = await update(ops);
    jsCfg = applyConfigOpsLocally(jsCfg, ops);
    check(`parity step ${i + 1} (${Object.entries(ops).map(([k, o]) => `${k}:${o.op}`).join(',')})`,
        deepEq(sqlCfg, jsCfg), { sqlCfg, jsCfg });
}

// ---------------------------------------------------------------------------
// SEC-1 addendum: the same pack behind the session guards. The guards
// migration (add_session_guards.sql) moves update_app_config(jsonb) into
// sg_internal and exposes a session-checking wrapper; prove the pack's merge
// semantics survive the move when a session is supplied, and that the strict
// keys behave (the full matrix lives in tests/sec1-session-guards.test.mjs).
// ---------------------------------------------------------------------------
await db.exec(`
CREATE TABLE users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, role_id TEXT, pin TEXT,
    base_salary NUMERIC DEFAULT 0, daily_target NUMERIC DEFAULT 0,
    weekly_target NUMERIC DEFAULT 0, monthly_target NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now());
GRANT ALL ON users TO anon, authenticated;
INSERT INTO users (id, name, role_id, pin) VALUES ('mgr','Mara','manager','2222');
`);
await useLiveTypes(db); // users on the live column types
await db.exec(strip(path.join(repo, 'migrations', 'applied', 'secure_pin_check.sql')));
await db.exec(strip(path.join(repo, 'migrations', 'add_auth_guards.sql')));
await db.exec(strip(path.join(repo, 'migrations', 'add_session_guards.sql')));
await q(`UPDATE app_config SET data = jsonb_set(data, '{roles}', $1::jsonb, true) WHERE id = 1`,
    [JSON.stringify([{ id: 'manager', name: 'Manager', permissions: ['manage_users', 'manage_settings', 'manage_orders'] }])]);
const { rows: [loginRow] } = await q(`SELECT * FROM login_with_pin('2222','mgr')`);
const SESSION = JSON.stringify({ user_id: 'mgr', token: loginRow.session_token });
const guarded = async (ops, session) =>
    (await q(`SELECT update_app_config(p_ops=>$1::jsonb, p_session=>$2::jsonb) AS cfg`, [JSON.stringify(ops), session])).rows[0].cfg;

check('guards: old single-argument signature is gone',
    (await q(`SELECT to_regprocedure('public.update_app_config(jsonb)') IS NULL AS gone`)).rows[0].gone === true);
const guardedCfg = await guarded({ categories: { op: 'append', items: ['Stands'] } }, SESSION);
check('guards: append still merges with a session', deepEq(guardedCfg.categories, [...jsCfg.categories, 'Stands']));
jsCfg = applyConfigOpsLocally(jsCfg, { categories: { op: 'append', items: ['Stands'] } });
check('guards: parity holds through the wrapper', deepEq(guardedCfg.categories, jsCfg.categories));
const errOfG = async (ops, session) => { try { await guarded(ops, session); return ''; } catch (e) { return String(e.message || e); } };
check('guards: NULL session still passes while enforcement is off', await errOfG({ taxRate: { op: 'set', value: 11 } }, null) === '');
check('guards: an invalid session is always refused',
    /session has expired/i.test(await errOfG({ taxRate: { op: 'set', value: 12 } }, JSON.stringify({ user_id: 'mgr', token: 'bad' }))));
check('guards: the roles key refuses a NULL session even while off',
    /session has expired/i.test(await errOfG({ roles: { op: 'set', value: [] } }, null)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
