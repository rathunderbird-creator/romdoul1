// PGlite test of migrations/add_session_guards.sql (SEC-1 phase 1): the
// whole stack is built for real — full_schema.sql, auth guards, the five
// function packs, then the session guards — so the guarded wrappers call the
// REAL pack implementations. Checks, with enforcement off and on:
//   * sg_check semantics (null / invalid / wrong-permission / valid),
//   * the per-function permission map,
//   * the users-table rules (SEC-3, now in SQL) via save_user / delete_user /
//     set_user_pin / update_user_work_fields,
//   * the app_config per-key permission map (roles rules included),
//   * anon cannot write users / app_config / security_settings directly,
//   * the old unguarded public signatures are gone,
//   * the migration is re-runnable,
//   * the packs still work end to end with sessions supplied.
// See tests/README.md for how to run it.
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { useLiveTypes } from './live-schema.mjs';

const { PGlite } = await import(process.env.PGLITE_DIST || '@electric-sql/pglite');

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mig = f => path.join(repo, 'migrations', f);
const db = new PGlite();
const q = (s, p) => db.query(s, p);
let pass = 0, fail = 0;
const check = (label, cond, extra) => {
    if (cond) { pass++; console.log('PASS', label); }
    else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); }
};
// Calls fn and returns the error message ('' when it succeeded).
const errOf = async (sql, params) => {
    try { await q(sql, params); return ''; } catch (e) { return String(e.message || e); }
};
const expired = m => /session has expired/i.test(m);
const noPerm = m => /do not have permission|Only an administrator|cannot/i.test(m);

const strip = f => fs.readFileSync(f, 'utf8').replace(/NOTIFY[^;]*;/g, '');

// ---------------------------------------------------------------------------
// Build the store: roles, full schema (minus Supabase storage), packs.
// ---------------------------------------------------------------------------
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;`);
// full_schema uses uuid_generate_v4 once; PGlite has gen_random_uuid built in.
await db.exec(`CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid LANGUAGE sql AS 'SELECT gen_random_uuid()';`);
let schema = strip(mig('full_schema.sql')).replace(/CREATE EXTENSION[^;]*;/g, '');
// Drop the Supabase storage-bucket section (storage schema doesn't exist here).
schema = schema.replace(/INSERT INTO storage[\s\S]*?END \$\$;/, '');
await db.exec(schema);
await useLiveTypes(db); // the live column types, not full_schema's
// Simulate Supabase's default API grants, which the lockdowns must undo.
await db.exec(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;`);
await db.exec(strip(mig('add_auth_guards.sql'))); // restores the users lockdown
for (const f of ['add_transaction_order_link.sql', 'add_transaction_reference_notes.sql',
                 'add_purchase_order_bill_date.sql',
                 'add_fifo_costing.sql', // the packs call its FIFO helpers
                 'add_wholesale_procurement_functions.sql', // creates wp_internal, which the two order packs use
                 'add_order_status_function.sql', 'add_order_payment_functions.sql',
                 'add_stock_adjustment_posting.sql',
                 'add_config_functions.sql']) {
    await db.exec(strip(mig(f)));
}
await db.exec(strip(mig('add_session_guards.sql')));
await db.exec(strip(mig('add_session_guards.sql'))); // safe to re-run
await useLiveTypes(db); // and on the columns the migrations added
check('migration runs twice', true);

// ---------------------------------------------------------------------------
// Seed: roles in app_config, users, a product.
// ---------------------------------------------------------------------------
const ROLES = [
    { id: 'admin', name: 'Administrator', permissions: [] }, // hardcoded full access
    { id: 'manager', name: 'Manager', permissions: ['manage_users', 'manage_orders', 'manage_settings', 'create_orders', 'view_orders'] },
    { id: 'salesman', name: 'Salesman', permissions: ['create_orders', 'view_orders'] },
    { id: 'stocker', name: 'Stocker', permissions: ['manage_inventory'] },
    { id: 'payrollist', name: 'Payroll', permissions: ['manage_payroll'] },
    { id: 'richrole', name: 'Rich', permissions: ['manage_users', 'manage_orders', 'manage_settings', 'create_orders', 'view_orders', 'manage_procurement'] },
    { id: 'reporter', name: 'Reports', permissions: ['view_reports'] },
    { id: 'restocker', name: 'Restock clerk', permissions: ['restock_orders', 'view_orders'] },
];
await q(`UPDATE app_config SET data = jsonb_set(data, '{roles}', $1::jsonb, true) WHERE id = 1`, [JSON.stringify(ROLES)]);
await q(`INSERT INTO users (id, name, email, role_id, pin) VALUES
    ('boss','Boss','b@x.com','admin','1111'),
    ('mgr','Mara','m@x.com','manager','2222'),
    ('sal','Sok','s@x.com','salesman','3333'),
    ('stk','Stody','k@x.com','stocker','4444'),
    ('pay','Pel','p@x.com','payrollist','5555'),
    ('rep','Rina','r@x.com','reporter','6666'),
    ('rst','Rotha','t@x.com','restocker','7777')
    ON CONFLICT (id) DO NOTHING`);
await q(`INSERT INTO products (id, name, price, stock) VALUES ('prod1', 'Speaker', 50, 10)`);

const login = async (id, pin) => {
    const { rows: [r] } = await q(`SELECT * FROM login_with_pin($1,$2)`, [pin, id]);
    return JSON.stringify({ user_id: id, token: r.session_token });
};
const S = {
    boss: await login('boss', '1111'),
    mgr: await login('mgr', '2222'),
    sal: await login('sal', '3333'),
    stk: await login('stk', '4444'),
    pay: await login('pay', '5555'),
    rep: await login('rep', '6666'),
    rst: await login('rst', '7777'),
};
const BAD = JSON.stringify({ user_id: 'boss', token: 'deadbeef' });

// ---------------------------------------------------------------------------
// Old unguarded signatures are gone from public.
// ---------------------------------------------------------------------------
const oldSigs = [
    'public.set_order_shipping_status(text,text,text,jsonb)',
    'public.edit_order_items(text,jsonb,jsonb)',
    'public.restock_returned_orders(text[],jsonb)',
    'public.create_retail_order(jsonb,jsonb,jsonb)',
    'public.set_order_payment(text,text,jsonb,jsonb)',
    'public.delete_retail_orders(text[],jsonb)',
    'public.apply_restock_payment_side(text[],jsonb)',
    'public.create_wholesale_order(jsonb,jsonb,text,date)',
    'public.update_wholesale_order(uuid,jsonb,jsonb,text,date)',
    'public.set_wholesale_order_status(uuid,text)',
    'public.delete_wholesale_order(uuid)',
    'public.record_customer_payment(uuid,numeric,text,text,date,text,uuid,text,uuid)',
    'public.delete_customer_payment(uuid)',
    'public.record_supplier_payments(uuid,jsonb,text,text,date,text,uuid,text)',
    'public.receive_purchase_order(uuid,text,text,date,boolean)',
    'public.add_product_stock(text,integer,numeric,text,text,text,text,date,uuid)',
    'public.save_stock_adjustment(uuid,jsonb,jsonb)',
    'public.post_stock_adjustment(uuid,text)',
    'public.set_product_stock(text,numeric,text,text,text,date)',
    'public.update_app_config(jsonb)',
];
for (const s of oldSigs) {
    const { rows: [{ gone }] } = await q(`SELECT to_regprocedure($1) IS NULL AS gone`, [s]);
    check(`old signature gone: ${s}`, gone === true);
}

// ---------------------------------------------------------------------------
// Enforcement OFF (the default): null passes, invalid refused, wrong
// permission refused, right permission passes.
// ---------------------------------------------------------------------------
const addStock = (session) => errOf(
    `SELECT add_product_stock(p_product_id => 'prod1', p_quantity => 1, p_session => $1::jsonb)`, [session]);

check('OFF: null session passes', await addStock(null) === '');
check('OFF: invalid session always refused', expired(await addStock(BAD)));
check('OFF: valid session, wrong permission refused', noPerm(await addStock(S.sal)));
check('OFF: valid session, right permission passes', await addStock(S.stk) === '');
check('OFF: admin passes everywhere', await addStock(S.boss) === '');
const { rows: [{ stock }] } = await q(`SELECT stock FROM products WHERE id='prod1'`);
check('add_product_stock really added stock', Number(stock) === 13);

// Per-function permission map spot checks (bogus ids: the guard must fire
// BEFORE the implementation, so the wrong-perm error is a permission one and
// the right-perm error is the pack's own plain message).
const probes = [
    ['set_order_shipping_status', `SELECT set_order_shipping_status(p_order_id=>'nope', p_expected_status=>'Open', p_new_status=>'Shipped', p_session=>$1::jsonb)`, S.stk, S.mgr],
    ['edit_order_items', `SELECT edit_order_items(p_order_id=>'nope', p_items=>'[]'::jsonb, p_session=>$1::jsonb)`, S.sal, S.mgr],
    ['restock_returned_orders', `SELECT restock_returned_orders(p_ids=>ARRAY['nope'], p_session=>$1::jsonb)`, S.mgr, S.boss],
    ['set_order_payment', `SELECT set_order_payment(p_order_id=>'nope', p_expected_status=>'x', p_updates=>'{}'::jsonb, p_session=>$1::jsonb)`, S.stk, S.mgr],
    ['delete_retail_orders', `SELECT delete_retail_orders(p_ids=>ARRAY['nope'], p_session=>$1::jsonb)`, S.sal, S.mgr],
    ['apply_restock_payment_side', `SELECT apply_restock_payment_side(p_ids=>ARRAY['nope'], p_session=>$1::jsonb)`, S.mgr, S.boss],
    ['update_wholesale_order', `SELECT update_wholesale_order(p_id=>gen_random_uuid(), p_updates=>'{}'::jsonb, p_items=>NULL, p_session=>$1::jsonb)`, S.stk, S.mgr],
    ['set_wholesale_order_status', `SELECT set_wholesale_order_status(p_id=>gen_random_uuid(), p_status=>'Confirmed', p_session=>$1::jsonb)`, S.stk, S.mgr],
    ['delete_wholesale_order', `SELECT delete_wholesale_order(p_id=>gen_random_uuid(), p_session=>$1::jsonb)`, S.stk, S.mgr],
    ['record_customer_payment', `SELECT record_customer_payment(p_order_id=>gen_random_uuid(), p_amount=>1, p_method=>'Cash', p_notes=>'', p_pay_date=>CURRENT_DATE, p_session=>$1::jsonb)`, S.stk, S.mgr],
    ['delete_customer_payment', `SELECT delete_customer_payment(p_payment_id=>gen_random_uuid(), p_session=>$1::jsonb)`, S.stk, S.mgr],
    ['record_supplier_payments', `SELECT record_supplier_payments(p_supplier_id=>gen_random_uuid(), p_allocations=>'[]'::jsonb, p_method=>'Cash', p_notes=>'', p_pay_date=>CURRENT_DATE, p_session=>$1::jsonb)`, S.mgr, S.boss],
    ['receive_purchase_order', `SELECT receive_purchase_order(p_po_id=>gen_random_uuid(), p_session=>$1::jsonb)`, S.mgr, S.boss],
    ['save_stock_adjustment', `SELECT save_stock_adjustment(p_id=>gen_random_uuid(), p_header=>'{}'::jsonb, p_lines=>'[]'::jsonb, p_session=>$1::jsonb)`, S.sal, S.stk],
    ['post_stock_adjustment', `SELECT post_stock_adjustment(p_id=>gen_random_uuid(), p_session=>$1::jsonb)`, S.sal, S.stk],
    ['set_product_stock', `SELECT set_product_stock(p_product=>'nope', p_new_stock=>1, p_session=>$1::jsonb)`, S.sal, S.stk],
];
for (const [name, sql, wrong, right] of probes) {
    const w = await errOf(sql, [wrong]);
    check(`${name}: wrong permission refused`, noPerm(w) && !expired(w), w);
    const r = await errOf(sql, [right]);
    check(`${name}: right permission reaches the implementation`, !noPerm(r) || /no longer exists|not found|was not found|needs at least|no id/i.test(r), r);
}

// End to end through the guarded wrappers: a retail order is created by a
// salesman, a wholesale order by a manager.
const retail = await errOf(
    `SELECT create_retail_order(p_order=>'{"id":"ORD-1","total":50,"customer_snapshot":{"name":"K"}}'::jsonb,
            p_items=>'[{"id":"prod1","name":"Speaker","price":50,"quantity":1}]'::jsonb, p_session=>$1::jsonb)`, [S.sal]);
check('create_retail_order works with create_orders session', retail === '', retail);
const wholesale = await errOf(
    `SELECT create_wholesale_order(p_order=>'{"customer_name":"W"}'::jsonb,
            p_items=>'[{"product_id":"prod1","product_name":"Speaker","quantity":1,"unit_price":40}]'::jsonb, p_session=>$1::jsonb)`, [S.mgr]);
check('create_wholesale_order works with manage_orders session', wholesale === '', wholesale);
check('create_retail_order refused for stocker', noPerm(await errOf(
    `SELECT create_retail_order(p_order=>'{"id":"ORD-2","total":1,"customer_snapshot":{"name":"K"}}'::jsonb,
            p_items=>'[{"id":"prod1","name":"Speaker","price":1,"quantity":1}]'::jsonb, p_session=>$1::jsonb)`, [S.stk])));

// Stock adjustment pack end to end with a stocker session.
await q(`INSERT INTO stock_adjustments (id, reason, status) VALUES ('11111111-1111-1111-1111-111111111111', 'Stock correction', 'Draft')`);
const saveAdj = await errOf(
    `SELECT save_stock_adjustment(p_id=>'11111111-1111-1111-1111-111111111111',
        p_header=>'{"warehouse_id":"","adjustment_date":"2026-11-11","reason":"Stock correction","notes":""}'::jsonb,
        p_lines=>'[{"product_id":"prod1","quantity":2,"unit_cost":10}]'::jsonb, p_session=>$1::jsonb)`, [S.stk]);
check('save_stock_adjustment works for stocker', saveAdj === '', saveAdj);
const postAdj = await errOf(`SELECT post_stock_adjustment(p_id=>'11111111-1111-1111-1111-111111111111', p_session=>$1::jsonb)`, [S.stk]);
check('post_stock_adjustment works for stocker', postAdj === '', postAdj);
const setStk = await errOf(`SELECT set_product_stock(p_product=>'prod1', p_new_stock=>3, p_by=>'stk', p_session=>$1::jsonb)`, [S.stk]);
const { rows: [{ stock: stkAfter }] } = await q(`SELECT stock FROM products WHERE id='prod1'`);
check('set_product_stock works for stocker (stock set to 3)', setStk === '' && Number(stkAfter) === 3, { setStk, stkAfter });

// ---------------------------------------------------------------------------
// app_config permission map (enforcement still OFF — a supplied session is
// always permission-checked; only a NULL one passes).
// ---------------------------------------------------------------------------
const cfg = (ops, session) => errOf(`SELECT update_app_config(p_ops=>$1::jsonb, p_session=>$2::jsonb)`, [JSON.stringify(ops), session]);

check('config: null session passes while off', await cfg({ storeName: { op: 'set', value: 'S' } }, null) === '');
check('config: invalid session refused', expired(await cfg({ storeName: { op: 'set', value: 'S' } }, BAD)));
check('config: storeName needs manage_settings', noPerm(await cfg({ storeName: { op: 'set', value: 'X' } }, S.sal)));
check('config: storeName ok for manager', await cfg({ storeName: { op: 'set', value: 'X' } }, S.mgr) === '');
check('config: blockedCustomers ok for manager (manage_orders)', await cfg({ blockedCustomers: { op: 'append', items: [{ phone: '012', name: 'B' }], idKey: 'phone', norm: 'phone' } }, S.mgr) === '');
check('config: blockedCustomers refused for stocker', noPerm(await cfg({ blockedCustomers: { op: 'append', items: [{ phone: '013' }], idKey: 'phone', norm: 'phone' } }, S.stk)));
check('config: pinnedProducts ok for salesman (create_orders)', await cfg({ pinnedProducts: { op: 'append', items: ['prod1'] } }, S.sal) === '');
check('config: salesOrder ok for salesman', await cfg({ salesOrder: { op: 'prepend', items: ['ORD-1'] } }, S.sal) === '');
check('config: users key admin-only', noPerm(await cfg({ users: { op: 'set', value: [] } }, S.mgr)));
check('config: users key ok for admin', await cfg({ users: { op: 'set', value: [] } }, S.boss) === '');

// roles key rules (PR #215's updateRole, in SQL).
check('roles: admin may replace the list', await cfg({ roles: { op: 'set', value: ROLES } }, S.boss) === '');
check('roles: manager cannot replace the list', noPerm(await cfg({ roles: { op: 'set', value: [] } }, S.mgr)));
check('roles: salesman cannot touch roles at all', noPerm(await cfg({ roles: { op: 'append', items: [{ id: 'r2', permissions: [] }], idKey: 'id' } }, S.sal)));
check('roles: manager may add a role within their own permissions',
    await cfg({ roles: { op: 'append', items: [{ id: 'junior', name: 'Jr', permissions: ['view_orders'] }], idKey: 'id' } }, S.mgr) === '');
check('roles: manager cannot add a role beyond their own permissions',
    noPerm(await cfg({ roles: { op: 'append', items: [{ id: 'evil', name: 'E', permissions: ['manage_procurement'] }], idKey: 'id' } }, S.mgr)));
check('roles: manager cannot add permissions to their own role',
    noPerm(await cfg({ roles: { op: 'updateItems', items: [{ id: 'manager', name: 'Manager', permissions: ['manage_users', 'manage_orders', 'manage_settings', 'create_orders', 'view_orders', 'manage_inventory'] }], idKey: 'id' } }, S.mgr)));
check('roles: manager cannot grant another role a permission they lack',
    noPerm(await cfg({ roles: { op: 'updateItems', items: [{ id: 'junior', permissions: ['view_orders', 'manage_procurement'] }], idKey: 'id' } }, S.mgr)));
check('roles: manager may shrink or rename within their cap',
    await cfg({ roles: { op: 'updateItems', items: [{ id: 'junior', name: 'Junior', permissions: ['view_orders'] }], idKey: 'id' } }, S.mgr) === '');
check('roles: manager cannot edit the admin role',
    noPerm(await cfg({ roles: { op: 'updateItems', items: [{ id: 'admin', permissions: [] }], idKey: 'id' } }, S.mgr)));
check('roles: nobody deletes the admin role (manager)',
    noPerm(await cfg({ roles: { op: 'removeItems', values: ['admin'], idKey: 'id' } }, S.mgr)));
check('roles: manager cannot delete their own role',
    noPerm(await cfg({ roles: { op: 'removeItems', values: ['manager'], idKey: 'id' } }, S.mgr)));
check('roles: manager may delete a lesser role',
    await cfg({ roles: { op: 'removeItems', values: ['junior'], idKey: 'id' } }, S.mgr) === '');

// ---------------------------------------------------------------------------
// users-table rules (strict: a valid session is required even while
// enforcement is OFF — these functions outlive the table revokes).
// ---------------------------------------------------------------------------
const saveUser = (user, session) => errOf(`SELECT save_user(p_session=>$2::jsonb, p_user=>$1::jsonb)`, [JSON.stringify(user), session]);
const delUser = (id, session) => errOf(`SELECT delete_user(p_session=>$2::jsonb, p_id=>$1)`, [id, session]);
const setPin = (id, pin, session) => errOf(`SELECT set_user_pin(p_session=>$3::jsonb, p_id=>$1, p_pin=>$2)`, [id, pin, session]);
const workFields = (id, fields, session) => errOf(`SELECT update_user_work_fields(p_session=>$3::jsonb, p_id=>$1, p_fields=>$2::jsonb)`, [id, JSON.stringify(fields), session]);

check('save_user: null session refused even while enforcement is off', expired(await saveUser({ id: 'x1', name: 'X', role_id: 'salesman' }, null)));
check('save_user: invalid session refused', expired(await saveUser({ id: 'x1', name: 'X', role_id: 'salesman' }, BAD)));
check('save_user: salesman has no manage_users', noPerm(await saveUser({ id: 'x1', name: 'X', role_id: 'salesman' }, S.sal)));
check('save_user: manager may create a salesman', await saveUser({ id: 'x1', name: 'X', email: 'x@x.com', role_id: 'salesman', pin: '9090' }, S.mgr) === '');
check('new user can log in with the pin save_user stored', (await q(`SELECT * FROM login_with_pin('9090','x1')`)).rows.length === 1);
check('save_user: manager cannot assign the admin role', noPerm(await saveUser({ id: 'x1', role_id: 'admin' }, S.mgr)));
check('save_user: manager cannot assign a richer role', noPerm(await saveUser({ id: 'x1', role_id: 'richrole' }, S.mgr)));
check('save_user: manager cannot change their own role', noPerm(await saveUser({ id: 'mgr', role_id: 'salesman' }, S.mgr)));
check('save_user: admin cannot change their own role either', noPerm(await saveUser({ id: 'boss', role_id: 'manager' }, S.boss)));
check('save_user: manager cannot edit an admin account', noPerm(await saveUser({ id: 'boss', name: 'Evil' }, S.mgr)));
check('save_user: manager cannot re-PIN an admin account', noPerm(await saveUser({ id: 'boss', pin: '0000' }, S.mgr)));
check('set_user_pin: manager cannot re-PIN an admin account', noPerm(await setPin('boss', '0000', S.mgr)));
check('set_user_pin: manager may re-PIN a lesser account', await setPin('x1', '8080', S.mgr) === '');
check('old pin dead, new pin works', (await q(`SELECT * FROM login_with_pin('9090','x1')`)).rows.length === 0
    && (await q(`SELECT * FROM login_with_pin('8080','x1')`)).rows.length === 1);
check('save_user: admin may edit anyone', await saveUser({ id: 'x1', name: 'X2', role_id: 'stocker' }, S.boss) === '');
check('delete_user: nobody deletes themself', noPerm(await delUser('mgr', S.mgr)) && noPerm(await delUser('boss', S.boss)));
check('delete_user: manager cannot delete an admin', noPerm(await delUser('boss', S.mgr)));
check('delete_user: manager cannot delete an outranking account', noPerm(await delUser('stk', S.mgr)));
check('delete_user: admin may delete', await delUser('x1', S.boss) === '');
check('user really deleted', (await q(`SELECT 1 FROM users WHERE id='x1'`)).rows.length === 0);

check('work fields: payrollist may set an admin salary', await workFields('boss', { base_salary: 1000, daily_target: 5 }, S.pay) === '');
const { rows: [{ base_salary }] } = await q(`SELECT base_salary FROM users WHERE id='boss'`);
check('salary really saved', Number(base_salary) === 1000);
check('work fields: only payroll columns accepted', noPerm(await workFields('boss', { name: 'Haxx' }, S.pay)) || /only accepts payroll fields/i.test(await workFields('boss', { name: 'Haxx' }, S.pay)));
check('work fields: salesman refused', noPerm(await workFields('sal', { base_salary: 9 }, S.sal)));
check('work fields: null session refused', expired(await workFields('sal', { base_salary: 9 }, null)));

// ---------------------------------------------------------------------------
// Review fixes (still enforcement OFF).
// ---------------------------------------------------------------------------
// A ReStock transition is gated on restock_orders alone (the client's gate);
// other transitions accept manage/create/view_orders (OM2 admits all three).
const reaches = m => !noPerm(m) && !expired(m); // guard passed; impl's own error is fine
const shipStatus = (newStatus, session) => errOf(
    `SELECT set_order_shipping_status(p_order_id=>'nope', p_expected_status=>'Returned', p_new_status=>$2, p_session=>$1::jsonb)`,
    [session, newStatus]);
check('ReStock passes for a restock clerk (no manage_orders)', reaches(await shipStatus('ReStock', S.rst)));
check('ReStock refused for a salesman (no restock_orders)', noPerm(await shipStatus('ReStock', S.sal)));
check('status change passes for a salesman (OM2 parity: create/view_orders)', reaches(await shipStatus('Shipped', S.sal)));
check('status change passes for the restock clerk too (view_orders)', reaches(await shipStatus('Shipped', S.rst)));
check('status change still refused for a stocker', noPerm(await shipStatus('Shipped', S.stk)));
check('payment save passes for a salesman (OM2 parity)', reaches(await errOf(
    `SELECT set_order_payment(p_order_id=>'nope', p_expected_status=>'x', p_updates=>'{}'::jsonb, p_session=>$1::jsonb)`, [S.sal])));

// Config keys written outside Settings: productOrder (inventory drag),
// Sales Setup's district/commune overrides, checkout's inline adds, and the
// Shipping report's inline rate editor.
check('config: productOrder ok for stocker (manage_inventory)', await cfg({ productOrder: { op: 'set', value: ['prod1'] } }, S.stk) === '');
check('config: productOrder refused for salesman', noPerm(await cfg({ productOrder: { op: 'set', value: [] } }, S.sal)));
check('config: customDistricts ok for manager (manage_orders)', await cfg({ customDistricts: { op: 'append', items: [{ code: 'D1', khmer: 'ក', latin: 'K' }], idKey: 'code' } }, S.mgr) === '');
check('config: removedCommuneCodes ok for manager', await cfg({ removedCommuneCodes: { op: 'append', items: ['C9'] } }, S.mgr) === '');
check('config: customDistricts refused for stocker', noPerm(await cfg({ customDistricts: { op: 'append', items: [{ code: 'D2' }], idKey: 'code' } }, S.stk)));
check('config: cities ok for salesman (checkout inline add)', await cfg({ cities: { op: 'append', items: ['PP'] } }, S.sal) === '');
check('config: pages ok for salesman (checkout inline add)', await cfg({ pages: { op: 'append', items: ['FB Page'] } }, S.sal) === '');
check('config: paymentMethods ok for salesman (checkout inline add)', await cfg({ paymentMethods: { op: 'append', items: ['ABA'] } }, S.sal) === '');
check('config: shippingRates ok for reporter (view_reports inline editor)', await cfg({ shippingRates: { op: 'merge', value: { VET: 1.5 } } }, S.rep) === '');
check('config: shippingRates refused for restock clerk', noPerm(await cfg({ shippingRates: { op: 'merge', value: { VET: 9 } } }, S.rst)));

// The roles (and legacy users) keys are strict: a NULL session is refused
// even while enforcement is off — sg_permission reads this key, so leaving
// it sessionless during rollout would defeat every other guard.
check('roles: NULL session refused even while enforcement is off', expired(await cfg({ roles: { op: 'set', value: ROLES } }, null)));
check('users key: NULL session refused even while enforcement is off', expired(await cfg({ users: { op: 'set', value: [] } }, null)));
check('other keys still pass with a NULL session while off', await cfg({ storeName: { op: 'set', value: 'Still open' } }, null) === '');

// Roles-op identity bypass: the executor matches by the caller's idKey/norm,
// the guard inspects 'id' — so any non-'id' idKey (or any norm) is refused
// for non-admin callers.
const byId = m => /identify roles by their id/i.test(m);
check('roles: removeItems by name refused (idKey bypass)', byId(await cfg({ roles: { op: 'removeItems', values: [{ name: 'Administrator' }], idKey: 'name' } }, S.mgr)));
check('roles: updateItems by name refused (idKey bypass)', byId(await cfg({ roles: { op: 'updateItems', items: [{ name: 'Salesman', permissions: [] }], idKey: 'name' } }, S.mgr)));
check('roles: norm refused (normalized-identity bypass)', byId(await cfg({ roles: { op: 'removeItems', values: ['!!!'], idKey: 'id', norm: 'phone' } }, S.mgr)));
const { rows: [{ admin_still }] } = await q(
    `SELECT EXISTS (SELECT 1 FROM app_config c, jsonb_array_elements(c.data->'roles') r WHERE c.id=1 AND r->>'id'='admin') AS admin_still`);
check('admin role survived the bypass attempts', admin_still === true);

// save_user checks the target's CURRENT role: a manage_users holder cannot
// demote / rename / re-PIN an account whose role outranks theirs (the
// demote-then-re-PIN two-step takeover). The stocker outranks the manager
// (manage_inventory is not among the manager's permissions).
check('save_user: manager cannot demote an outranking account', noPerm(await saveUser({ id: 'stk', role_id: 'salesman' }, S.mgr)));
check('save_user: manager cannot rename an outranking account', noPerm(await saveUser({ id: 'stk', name: 'Hx' }, S.mgr)));
check('save_user: manager cannot re-PIN an outranking account', noPerm(await saveUser({ id: 'stk', pin: '0001' }, S.mgr)));
const { rows: [stkRow] } = await q(`SELECT name, role_id FROM users WHERE id='stk'`);
check('the outranking account is untouched', stkRow.name === 'Stody' && stkRow.role_id === 'stocker');
check('save_user: payroll-only fields of an outranking account stay editable (milder path)',
    await saveUser({ id: 'stk', daily_target: 7 }, S.mgr) === '');

// Target-ONLY work-field edits accept view_reports (Staff Performance's Set
// Targets modal); base_salary stays manage_payroll / manage_users.
check('work fields: reporter may set sales targets', await workFields('sal', { daily_target: 3, monthly_target: 90 }, S.rep) === '');
check('work fields: reporter cannot touch base_salary', noPerm(await workFields('sal', { base_salary: 5, daily_target: 3 }, S.rep)));
check('work fields: payrollist still edits salary + targets together', await workFields('sal', { base_salary: 5, daily_target: 4 }, S.pay) === '');

// ---------------------------------------------------------------------------
// anon cannot write users / app_config / security_settings directly.
// ---------------------------------------------------------------------------
const can = async (sql) => { try { await db.exec(sql); return true; } catch { return false; } };
await db.exec(`SET ROLE anon`);
check('anon: cannot INSERT users', !(await can(`INSERT INTO users (id, name, role_id, pin) VALUES ('evil','E','admin','1')`)));
check('anon: cannot UPDATE users', !(await can(`UPDATE users SET pin='1' WHERE id='boss'`)));
check('anon: cannot UPDATE users app columns either', !(await can(`UPDATE users SET name='E' WHERE id='boss'`)));
check('anon: cannot DELETE users', !(await can(`DELETE FROM users WHERE id='sal'`)));
check('anon: can still SELECT the allowed user columns', await can(`SELECT id, name, email, role_id, base_salary FROM users`));
check('anon: cannot UPDATE app_config', !(await can(`UPDATE app_config SET data='{}'::jsonb WHERE id=1`)));
check('anon: cannot INSERT app_config', !(await can(`INSERT INTO app_config (id, data) VALUES (2,'{}'::jsonb)`)));
check('anon: can still SELECT app_config', await can(`SELECT data FROM app_config`));
check('anon: cannot read security_settings', !(await can(`SELECT * FROM security_settings`)));
check('anon: cannot write security_settings', !(await can(`UPDATE security_settings SET enforce_sessions=true`)));
// The guarded path still works as anon (what PostgREST actually executes).
await q(`SELECT update_app_config(p_ops=>$1::jsonb, p_session=>$2::jsonb)`, [JSON.stringify({ storeName: { op: 'set', value: 'ViaAnon' } }), S.mgr]);
check('anon: guarded update_app_config works with a manager session', true);
check('anon: guarded save_user works with an admin session', await saveUser({ id: 'x2', name: 'N', role_id: 'salesman', pin: '7070' }, S.boss) === '');
check('anon: guarded add_product_stock works', await addStock(S.stk) === '');
await db.exec(`RESET ROLE`);

// ---------------------------------------------------------------------------
// Enforcement ON: a null session is refused everywhere.
// ---------------------------------------------------------------------------
await db.exec(`UPDATE security_settings SET enforce_sessions = true WHERE id = 1`);
check('ON: null session refused (stock)', expired(await addStock(null)));
check('ON: null session refused (config)', expired(await cfg({ storeName: { op: 'set', value: 'Z' } }, null)));
check('ON: null session refused (orders)', expired(await errOf(
    `SELECT set_order_shipping_status(p_order_id=>'nope', p_expected_status=>'Open', p_new_status=>'Shipped')`)));
check('ON: invalid session still refused', expired(await addStock(BAD)));
check('ON: wrong permission still refused', noPerm(await addStock(S.sal)));
check('ON: valid session still passes', await addStock(S.stk) === '');
check('ON: config with permission still passes', await cfg({ storeName: { op: 'set', value: 'Z' } }, S.mgr) === '');

// Rollback switch works.
await db.exec(`UPDATE security_settings SET enforce_sessions = false WHERE id = 1`);
check('rollback: null session passes again', await addStock(null) === '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
