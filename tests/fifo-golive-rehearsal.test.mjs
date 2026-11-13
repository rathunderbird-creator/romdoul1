// FIFO go-live rehearsal on a Romdoul1-shaped store, on the LIVE column types.
//
// The first go-live attempt on Romdoul1 failed in fifo_rebuild_pool.sql with
// "function round(double precision, integer) does not exist": live
// sale_items.quantity is int4, and every other harness had built the store
// from full_schema.sql's NUMERIC columns. This test builds the store the way
// Romdoul1 really is and runs part C of the owner runbook in its order:
//
//   the store before the release   the pre-FIFO full_schema.sql and packs as
//                                  they were last released (git PRE_FIFO),
//                                  forced onto the live column types
//                                  (tests/live-schema-romdoul1.json)
//   pre-FIFO data                  integer stock (an inactive product at 0,
//                                  Test Product at 10), shipped / delivered /
//                                  returned / paid orders with integer
//                                  quantities, the Posted true-up
//                                  TRUEUP-20261112, later Draft receipts at
//                                  9.30 for NR-3026 (basis 9.00), wholesale
//                                  orders (numeric quantities), POs, stock
//                                  movements, the status log
//   C1  add_fifo_costing.sql       run twice (it is re-run on the day)
//   C2  zero Test Product          the runbook's UPDATE
//   C3  the dry run                the JS plan of the same data: guard passes
//   C4/C5 fifo_rebuild_pool.sql    the whole file, preset line edited the way
//                                  the owner does it
//   C6  the four packs             in the runbook order
//   C7  add_session_guards.sql
//   D   verify                     fifo_inventory_check variance 0, then ship
//                                  and settle orders, Add Stock with a retry
//                                  id, a wholesale order, a PO receipt and a
//                                  warehouse stock adjustment, each keeping
//                                  variance 0 and pool = stock.
// See tests/README.md for how to run it.
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { useLiveTypes, diffLive, lineUuid as SI } from './live-schema.mjs';

const { PGlite } = await import(process.env.PGLITE_DIST || '@electric-sql/pglite');
const require = createRequire(import.meta.url);
const { planStore, buildInput, PRESETS } = require('../src/scripts/fifo-rebuild-dryrun.cjs');

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mig = f => path.join(repo, 'migrations', f);
const noNotify = s => s.replace(/NOTIFY[^;]*;/g, '');
const strip = f => noNotify(fs.readFileSync(f, 'utf8'));
// The last release before FIFO: what the live stores run until part C.
const PRE_FIFO = 'e5ecec4';
const preFifo = f => {
    try {
        return noNotify(execFileSync('git', ['show', `${PRE_FIFO}:migrations/${f}`], { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 }));
    } catch (e) {
        throw new Error(`the rehearsal needs git history (${PRE_FIFO}:migrations/${f}) to build the pre-FIFO store: ${e.message}`);
    }
};

let pass = 0, fail = 0;
const check = (label, cond, extra) => {
    if (cond) { pass++; console.log('PASS', label); }
    else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); }
};
const num = v => (v === null || v === undefined ? 0 : Number(v));
const near = (a, b, eps = 0.006) => Math.abs(num(a) - num(b)) < eps;
const errOf = async fn => { try { await fn(); return ''; } catch (e) { return String(e.message || e); } };

const db = new PGlite();
const q = (s, p) => db.query(s, p);
const one = async (s, p) => (await q(s, p)).rows[0];

// ---------------------------------------------------------------------------
// The store before the release: pre-FIFO schema and packs, live types.
// ---------------------------------------------------------------------------
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;`);
await db.exec(`CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid LANGUAGE sql AS 'SELECT gen_random_uuid()';`);
let schema = preFifo('full_schema.sql').replace(/CREATE EXTENSION[^;]*;/g, '');
schema = schema.replace(/INSERT INTO storage[\s\S]*?END \$\$;/, '');
await db.exec(schema);
await useLiveTypes(db);
await db.exec(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;`);
await db.exec(preFifo('add_auth_guards.sql'));
for (const f of ['add_transaction_order_link.sql', 'add_transaction_reference_notes.sql', 'add_purchase_order_bill_date.sql',
                 'add_wholesale_procurement_functions.sql', 'add_order_status_function.sql', 'add_order_payment_functions.sql',
                 'add_stock_adjustment_posting.sql', 'add_config_functions.sql', 'add_session_guards.sql']) {
    await db.exec(preFifo(f));
}
await useLiveTypes(db);
const liveTypes = async () => (await q(`SELECT table_name || '.' || column_name || ':' || udt_name AS c FROM information_schema.columns
    WHERE table_schema = 'public' AND (table_name, column_name) IN (('sale_items', 'quantity'), ('sale_items', 'id'), ('products', 'stock'),
        ('purchase_order_items', 'quantity'), ('stock_movements', 'quantity'), ('warehouse_stock', 'quantity'), ('warehouse_stock', 'warehouse_id'),
        ('restocks', 'id'), ('journal_entries', 'date'), ('wholesale_order_items', 'quantity'), ('stock_adjustment_lines', 'quantity'))
    ORDER BY 1`)).rows.map(r => r.c).join(' ');
const LIVE_TYPES = 'journal_entries.date:date products.stock:int4 purchase_order_items.quantity:int4 restocks.id:text sale_items.id:uuid '
    + 'sale_items.quantity:int4 stock_adjustment_lines.quantity:numeric stock_movements.quantity:int4 warehouse_stock.quantity:int4 '
    + 'warehouse_stock.warehouse_id:uuid wholesale_order_items.quantity:numeric';
check('the pre-FIFO store is on the Romdoul1 live column types', await liveTypes() === LIVE_TYPES, await liveTypes());
check('the pre-FIFO store has no FIFO columns yet',
    !(await q(`SELECT 1 FROM information_schema.columns WHERE table_name = 'inventory_items' AND column_name = 'received_at'`)).rows.length);

// ---------------------------------------------------------------------------
// Pre-FIFO data.
// ---------------------------------------------------------------------------
const acct = async code => (await one(`SELECT id FROM chart_of_accounts WHERE account_code = $1`, [code])).id;
const A = { inv: await acct('1300'), cogs: await acct('5000'), eq: await acct('3000') };
const ts = (d, h = 10, m = 0) => `2026-${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
const TRUEUP_AT = '2026-11-12T14:51:05.206569Z';
const entry = async (ref, status, date, createdAt, lines) => {
    const id = (await one(`INSERT INTO journal_entries (date, description, reference_id, status, created_at) VALUES ($1, $2, $2, $3, $4) RETURNING id`,
        [date, ref, status, createdAt])).id;
    for (const [a, dr, cr] of lines) {
        await q(`INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, $4)`, [id, a, dr, cr]);
    }
    return id;
};
const cogsLines = amt => [[A.cogs, amt, 0], [A.inv, 0, amt]];
// A settled order's receipt the pre-FIFO app booked: the income row and its
// TX-<id> entry with the COGS lines (at purchase_cost).
const receipt = async (order, total, cogs, status, createdAt) => {
    const tx = (await one(`INSERT INTO transactions (type, amount, order_id, category, description, date) VALUES ('Income', $1, $2, 'Sales', 'Order', $3) RETURNING id`,
        [total, order, createdAt])).id;
    await entry(`TX-${tx}`, status, createdAt.slice(0, 10), createdAt, cogsLines(cogs));
};
const statusLog = (order, status, at) => q(`INSERT INTO activity_logs (action, description, metadata, created_at) VALUES ('order_status', 'status', $1::jsonb, $2)`,
    [JSON.stringify({ orderId: order, status }), at]);

const PRODUCTS = [
    // id, name, price, purchase_cost, layer cost, active, in stock
    ['P3026', 'NR-3026', 25, 9.3, 9.3, true, 6],
    ['P6012', 'NR-6012', 30, 10.7, 11, true, 4],
    ['PSPK', 'Speaker', 20, 5, 5, true, 5],
    ['PMIC', 'Mic', 15, 4, 4, true, 3],
    ['PTEST', 'Test Product', 1, 1, 1, false, 10],
    ['POLD', 'Old cable', 3, 1, 1, false, 0], // inactive at 0, no rows
];
for (const [id, name, price, pc, , active, stock] of PRODUCTS) {
    await q(`INSERT INTO products (id, name, price, purchase_cost, stock, is_active) VALUES ($1, $2, $3, $4, $5, $6)`, [id, name, price, pc, stock, active]);
}
const layerCost = Object.fromEntries(PRODUCTS.map(p => [p[0], p[4]]));
let rowN = 0;
const invRow = (product, status, saleId, at) => q(`INSERT INTO inventory_items (id, product_id, cost_of_purchase, status, sale_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)`, [`00000000-0000-4000-8000-${String(++rowN).padStart(12, '0')}`, product, layerCost[product], status, saleId, at]);
for (const [id, , , , , , stock] of PRODUCTS) {
    for (let i = 0; i < stock; i++) await invRow(id, 'in_stock', null, ts('10-05', 9, i));
}

// Orders: [id, shipping, payment, date, lines [product, qty], how]
//   how: 'paid-pre'  settled before the true-up (receipt Posted)
//        'paid-post' settled after it at 9.30 (Draft receipt) — E
//        'su'        Confirmed and Paid, goods on hand (Draft receipt)
//        'u'         shipped unsettled (in U)
//        'ret'       Shipped at the true-up, Returned after it (kept in U)
//        'open'      Pending, to ship after go-live
const ORDERS = [];
let oid = 1793600000000;
const add = (ship, pay, date, lines, how) => { const id = String(oid += 7919); ORDERS.push({ id, ship, pay, date, lines, how }); return id; };
for (let i = 0; i < 6; i++) add('Delivered', 'Paid', ts('10-1' + i), [['PSPK', 1 + (i % 2)], ['PMIC', 1]], 'paid-pre');
for (let i = 0; i < 4; i++) add('Delivered', 'Paid', ts('10-2' + i), [['P3026', 1]], 'paid-pre');
for (let i = 0; i < 4; i++) add('Delivered', 'Paid', ts('11-0' + (i + 1)), [['P3026', 1]], 'paid-post');
const mixedPost = add('Delivered', 'Paid', ts('11-05'), [['P3026', 2], ['PSPK', 1]], 'paid-post');
const su = add('Confirmed', 'Paid', ts('11-11'), [['P6012', 1]], 'su');
const uOrders = [];
for (let i = 0; i < 5; i++) uOrders.push(add(i % 2 ? 'Delivered' : 'Shipped', 'Unpaid', ts('11-0' + (i + 2)), [['P3026', 1], ['PSPK', 1 + (i % 3)]], 'u'));
const uSix = add('Shipped', 'Unpaid', ts('11-08'), [['P6012', 2]], 'u');
const ret1 = add('Returned', 'Unpaid', ts('11-09'), [['P3026', 1]], 'ret');
const ret2 = add('Returned', 'Unpaid', ts('11-10'), [['PMIC', 2]], 'ret');
const open1 = add('Pending', 'Unpaid', ts('11-12'), [['P3026', 2], ['PMIC', 1]], 'open');
const open2 = add('Pending', 'Unpaid', ts('11-12', 11), [['PSPK', 1]], 'open');

const purchaseCost = Object.fromEntries(PRODUCTS.map(p => [p[0], p[3]]));
let lineN = 0;
for (const o of ORDERS) {
    const total = o.lines.reduce((s, [p, n]) => s + n * PRODUCTS.find(x => x[0] === p)[2], 0);
    await q(`INSERT INTO sales (id, total, discount, date, shipping_status, payment_status, amount_received, shipping_cost, customer_snapshot, created_at)
             VALUES ($1, $2, 0, $3, $4, $5, $6, 0, $7::jsonb, $3)`,
        [o.id, total, o.date, o.ship, o.pay, o.pay === 'Paid' ? total : 0, JSON.stringify({ name: `Cust ${o.id.slice(-4)}`, phone: '012345678' })]);
    o.total = total;
    for (const [p, n] of o.lines) {
        await q(`INSERT INTO sale_items (id, sale_id, product_id, name, price, quantity, created_at) VALUES ($1, $2, $3, $3, 10, $4, $5)`,
            [SI(`L${++lineN}`), o.id, p, n, o.date]);
        const holds = ['Shipped', 'Delivered', 'Returned'].includes(o.ship);
        if (holds) {
            for (let k = 0; k < n; k++) await invRow(p, 'sold', o.id, ts('10-01', 8, rowN % 60));
            await q(`INSERT INTO stock_movements (product_id, product_name, type, quantity, unit_price, reference_id, order_id, source, reason, movement_date, created_at)
                     VALUES ($1, $1, 'out', $2, 10, $3, $3, 'Order Shipped', 'Shipped', $4::date, $4)`, [p, n, o.id, o.date]);
        }
    }
    const cogs = o.lines.reduce((s, [p, n]) => s + n * purchaseCost[p], 0);
    if (o.how === 'paid-pre') await receipt(o.id, total, cogs, 'Posted', o.date);
    if (o.how === 'paid-post' || o.how === 'su') await receipt(o.id, total, Math.round(cogs * 100) / 100, 'Draft', `2026-11-13T0${ORDERS.indexOf(o) % 9}:10:00Z`);
    if (o.how === 'ret') {
        await statusLog(o.id, 'Shipped', ts('11-10', 9));
        await statusLog(o.id, 'Returned', '2026-11-13T02:00:00Z');
        await q(`UPDATE sales SET last_edited_at = '2026-11-13T02:00:00Z' WHERE id = $1`, [o.id]);
    }
}
// Wholesale (numeric quantities): one Delivered with Posted COGS before the
// true-up, one Open whose stock is already out.
const wsDone = (await one(`INSERT INTO wholesale_orders (customer_name, status, order_date, total_amount) VALUES ('Shop A', 'Delivered', '2026-10-15', 60) RETURNING id`)).id;
await q(`INSERT INTO wholesale_order_items (wholesale_order_id, product_id, product_name, quantity, unit_price) VALUES ($1, 'P6012', 'NR-6012', 2, 30)`, [wsDone]);
await entry(`WSO-${wsDone}-COGS`, 'Posted', '2026-10-15', ts('10-15', 12), cogsLines(21.4));
// POs: one received (with its restock), one ordered and still to come.
const sup = (await one(`INSERT INTO suppliers (name) VALUES ('Supplier A') RETURNING id`)).id;
const poDone = (await one(`INSERT INTO purchase_orders (supplier_id, order_date, status, total_amount) VALUES ($1, '2026-10-01', 'Received', 50) RETURNING id`, [sup])).id;
await q(`INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_price) VALUES ($1, 'PSPK', 10, 5)`, [poDone]);
await q(`INSERT INTO restocks (id, product_id, quantity, cost, date, note) VALUES ($1, 'PSPK', 10, 5, $2, $3)`,
    ['rst-legacy-1', ts('10-02'), `Received from PO-${String(poDone).slice(0, 8)}`]);
const poOpen = (await one(`INSERT INTO purchase_orders (supplier_id, order_date, status, total_amount) VALUES ($1, '2026-11-10', 'Ordered', 40) RETURNING id`, [sup])).id;
await q(`INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_price) VALUES ($1, 'PMIC', 10, 4)`, [poOpen]);
// A warehouse with stock rows (warehouse_stock.warehouse_id is uuid live).
const wh = (await one(`INSERT INTO warehouses (name) VALUES ('Main') RETURNING id`)).id;
await q(`INSERT INTO warehouse_stock (warehouse_id, product_id, quantity) VALUES ($1, 'PMIC', 3), ($1, 'PSPK', 5)`, [wh]);
// The true-up (amount set below, once the plan says what it must be).
const trueup = await entry('TRUEUP-20261112', 'Posted', '2026-11-12', TRUEUP_AT, [[A.inv, 0, 0], [A.eq, 0, 0]]);
check('seeded: integer quantities everywhere a live int4 column holds them',
    (await one(`SELECT bool_and(quantity = trunc(quantity)) AS ok FROM sale_items`)).ok === true);

// ---------------------------------------------------------------------------
// C1: add_fifo_costing.sql, twice.
// ---------------------------------------------------------------------------
check('C1: add_fifo_costing.sql runs', await errOf(() => db.exec(strip(mig('add_fifo_costing.sql')))) === '');
check('C1: add_fifo_costing.sql runs again (re-run safe)', await errOf(() => db.exec(strip(mig('add_fifo_costing.sql')))) === '');
await useLiveTypes(db);
const missing = (await diffLive(db)).filter(d => d.what === 'missing-in-harness'
    && ['inventory_items', 'sale_items', 'wholesale_order_items', 'stock_movements'].includes(d.table));
check('C1: every FIFO column live has now exists here, on the live type', missing.length === 0, missing);

// C2: zero Test Product, no ledger entry.
const z = (await q(`UPDATE products SET stock = 0 WHERE name = 'Test Product' AND is_active = false RETURNING id, name, stock`)).rows;
check('C2: Test Product zeroed (1 row, stock 0)', z.length === 1 && num(z[0].stock) === 0, z);

// C3: the dry run's plan of the same data, read as the script reads it.
const iso = c => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
async function readRaw() {
    const rows = async s => (await q(s)).rows;
    return {
        products: await rows(`SELECT id, name, stock, purchase_cost, is_active FROM products`),
        items: await rows(`SELECT id::text AS id, product_id, cost_of_purchase, status, sale_id, ${iso('created_at')} AS created_at, ${iso('received_at')} AS received_at FROM inventory_items`),
        sales: await rows(`SELECT id, shipping_status, payment_status, ${iso('date')} AS date, ${iso('created_at')} AS created_at,
                                  ${iso('last_edited_at')} AS last_edited_at FROM sales`),
        saleItems: await rows(`SELECT id::text AS id, sale_id, product_id, quantity FROM sale_items`),
        accounts: await rows(`SELECT id::text AS id, account_code, account_name FROM chart_of_accounts`),
        entries: await rows(`SELECT id::text AS id, reference_id, status, date::text AS date, ${iso('created_at')} AS created_at FROM journal_entries`),
        lines: await rows(`SELECT id::text AS id, journal_entry_id::text AS journal_entry_id, account_id::text AS account_id, debit, credit FROM journal_entry_lines`),
        txs: await rows(`SELECT id::text AS id, order_id FROM transactions WHERE order_id IS NOT NULL`),
        moves: await rows(`SELECT reference_id, order_id, type, ${iso('created_at')} AS created_at FROM stock_movements`),
        statusLogs: await rows(`SELECT id::text AS id, metadata->>'orderId' AS order_id, metadata->>'status' AS status, ${iso('created_at')} AS created_at
                                  FROM activity_logs WHERE action = 'order_status'`),
        restocks: await rows(`SELECT id::text AS id, product_id, cost, ${iso('date')} AS date FROM restocks`),
        purchaseOrders: await rows(`SELECT id::text AS id, status FROM purchase_orders`),
        poItems: await rows(`SELECT id::text AS id, purchase_order_id::text AS purchase_order_id, product_id, unit_price, ${iso('created_at')} AS created_at FROM purchase_order_items`),
        wholesaleItems: await rows(`SELECT id::text AS id, wholesale_order_id::text AS wholesale_order_id, product_id, quantity FROM wholesale_order_items`),
        adjLines: await rows(`SELECT id::text AS id, adjustment_id::text AS adjustment_id, product_id, quantity, unit_cost FROM stock_adjustment_lines`),
    };
}
const P = PRESETS.romdoul1_trueup_2026_11_12;
const plan = async () => planStore(buildInput(await readRaw(), P.basis, {
    uStatuses: new Set(P.uStatuses), uFrom: P.uFrom, basisRef: P.basisRef, uReturnedAfterBasis: P.uReturnedAfterBasis }).input);
// The true-up booked exactly what the guard expects (basis x (S + U) - SU - E).
const p0 = await plan();
const tu = Math.round((p0.ledger.expected_B - p0.ledger.B) * 100) / 100;
await q(`UPDATE journal_entry_lines SET debit = $2 WHERE journal_entry_id = $1 AND account_id = $3`, [trueup, tu, A.inv]);
await q(`UPDATE journal_entry_lines SET credit = $2 WHERE journal_entry_id = $1 AND account_id = $3`, [trueup, tu, A.eq]);
const dry = await plan();
check('C3: the dry run passes the guard (guard_diff 0)', dry.ledger.guard_pass && near(dry.ledger.guard_diff, 0, 1e-6), dry.ledger);
check('C3: the dry run has E from the NR-3026 sales after the true-up (6 units x 0.30)', near(dry.ledger.E, 1.8, 1e-6), dry.ledger);
check('C3: the dry run keeps the two Returned orders in U', num(dry.u_returned_after_basis.orders) === 2, dry.u_returned_after_basis);
check('C3: SU is the Confirmed + Paid order (10.70)', near(dry.ledger.settled_unshipped_booked, 10.7, 1e-6), dry.ledger);

// ---------------------------------------------------------------------------
// C4/C5: the rebuild file, preset line edited as the owner does it.
// ---------------------------------------------------------------------------
const shipped = fs.readFileSync(mig('fifo_rebuild_pool.sql'), 'utf8');
check('C4: the file ships with CHOOSE_A_PRESET on the >>> PRESET line', /-- >>> PRESET[^\n]*\r?\n[^\n]*CHOOSE_A_PRESET/.test(shipped));
// The owner edits the one PRESET line, nothing else.
const edited = noNotify(shipped.replace("set_config('fifo_rebuild.preset', 'CHOOSE_A_PRESET', true)",
    "set_config('fifo_rebuild.preset', 'romdoul1_trueup_2026_11_12', true)"));
const before = noNotify(shipped).split('\n');
check('C4: exactly one line changed', edited.split('\n').filter((l, i) => l !== before[i]).length === 1);
let results = null;
const eRun = await errOf(async () => { results = await db.exec(edited); });
check('C5: fifo_rebuild_pool.sql with the Romdoul1 preset runs on the live types', eRun === '', eRun);
if (eRun) { try { await db.exec('ROLLBACK'); } catch { /* not in a transaction */ } }
const summary = results ? results[results.length - 1].rows : [];
const item = name => (summary.find(r => r.item === name) || {}).value;
check('C5: the summary is the 20-row table, preset romdoul1_trueup_2026_11_12', summary.length === 20 && item('preset') === 'romdoul1_trueup_2026_11_12', summary.map(r => r.item));
check('C5: the SQL guard matches the dry run (D1, V, B, SU, E, guard diff 0, FIFO-REVAL D1 + E)',
    near(item('D1'), dry.ledger.D1) && near(item('V'), dry.ledger.V) && near(item('B'), dry.ledger.B)
    && near(item('SU (booked, goods on hand)'), dry.ledger.settled_unshipped_booked) && near(item('E (overridden products since the basis entry)'), dry.ledger.E)
    && near(item('guard diff D1 - (V - SU - B - E)'), 0) && near(item('FIFO-REVAL amount D1 + E'), dry.ledger.reval_amount),
    { sql: summary, js: dry.ledger });
check('C5: one Draft FIFO-REVAL entry, one log row',
    num((await one(`SELECT count(*) AS n FROM journal_entries WHERE reference_id LIKE 'FIFO-REVAL-%' AND status = 'Draft'`)).n) === 1
    && num((await one(`SELECT count(*) AS n FROM public.fifo_rebuild_log WHERE preset = 'romdoul1_trueup_2026_11_12'`)).n) === 1);

// ---------------------------------------------------------------------------
// C6/C7: the four packs, then the session guards.
// ---------------------------------------------------------------------------
for (const f of ['add_wholesale_procurement_functions.sql', 'add_order_status_function.sql',
                 'add_order_payment_functions.sql', 'add_stock_adjustment_posting.sql', 'add_session_guards.sql']) {
    const e = await errOf(() => db.exec(strip(mig(f))));
    check(`C6/C7: ${f} loads on the rebuilt store`, e === '', e);
}
check('after part C: still on the live column types', await liveTypes() === LIVE_TYPES, await liveTypes());
await useLiveTypes(db);

// ---------------------------------------------------------------------------
// D: verify, then the day-one flows.
// ---------------------------------------------------------------------------
const fifoCheck = async () => (await one(`SELECT public.fifo_inventory_check() AS j`)).j;
const balanced = async label => {
    const c = await fifoCheck();
    check(`${label}: FIFO check variance 0.00, pool = stock`, near(c.variance, 0) && c.product_mismatches === 0, c);
};
await balanced('D1 after the rebuild');
const DAY = '2026-11-13';
const ship = (id, from, to) => one(`SELECT public.set_order_shipping_status(p_order_id => $1, p_expected_status => $2, p_new_status => $3,
    p_fields => jsonb_build_object('movement_date', '${DAY}')) AS r`, [id, from, to]);
const pay = (id, from, updates) => one(`SELECT public.set_order_payment(p_order_id => $1, p_expected_status => $2,
    p_updates => $3::jsonb, p_fields => jsonb_build_object('today', '${DAY}')) AS r`, [id, from, JSON.stringify(updates)]);
const orderOf = id => ORDERS.find(o => o.id === id);

check('D3: ship a Pending order (NR-3026 x 2 + Mic)', await errOf(() => ship(open1, 'Pending', 'Shipped')) === '');
const l1 = (await q(`SELECT product_id, quantity, cogs_cost FROM sale_items WHERE sale_id = $1 ORDER BY product_id`, [open1])).rows;
check('D3: the shipped lines carry their FIFO cost (NR-3026 2 x 9.30, Mic 4)',
    l1.length === 2 && near(l1.find(l => l.product_id === 'P3026').cogs_cost, 18.6) && near(l1.find(l => l.product_id === 'PMIC').cogs_cost, 4), l1);
await balanced('D3 shipped');
const settleErr = await errOf(() => pay(open1, 'Unpaid', { payment_status: 'Paid', amount_received: orderOf(open1).total, settle_date: DAY, post_to_ledger: true }));
check('D3: settle it', settleErr === '', settleErr);
await balanced('D3 settled');
const uErr = await errOf(() => pay(uOrders[0], 'Unpaid', { payment_status: 'Paid', amount_received: orderOf(uOrders[0]).total, settle_date: DAY, post_to_ledger: true }));
check('D3: settle a shipped-unsettled order from U', uErr === '', uErr);
await balanced('D3 U order settled');
check('D3: settle-before-ship on the other Pending order', await errOf(() => pay(open2, 'Unpaid',
    { payment_status: 'Paid', amount_received: orderOf(open2).total, settle_date: DAY, post_to_ledger: true })) === '');
check('D3: ...then ship it', await errOf(() => ship(open2, 'Pending', 'Shipped')) === '');
await balanced('D3 settled, then shipped');
check('restock a Returned order kept in U', await errOf(() => q(`SELECT public.restock_returned_orders(p_ids => ARRAY[$1]::text[], p_fields => '{}'::jsonb)`, [ret2])) === '');
await balanced('Returned order restocked');
const editErr = await errOf(() => q(`SELECT public.edit_order_items(p_order_id => $1, p_items => $2::jsonb, p_fields => '{"movement_date": "${DAY}"}'::jsonb)`,
    [uOrders[1], JSON.stringify([{ id: 'P3026', name: 'NR-3026', price: 25, quantity: 2 }])]));
check('edit a shipped order\'s items', editErr === '', editErr);
await balanced('order edited');

// Add Stock with the app's retry id: restocks.id is TEXT live.
const rid = '5d1c2a5e-0000-4000-8000-000000000001';
const add1 = await errOf(() => q(`SELECT public.add_product_stock(p_product_id => 'PSPK', p_quantity => 3, p_cost => 5.5, p_restock_id => $1::uuid)`, [rid]));
const add2 = await errOf(() => q(`SELECT public.add_product_stock(p_product_id => 'PSPK', p_quantity => 3, p_cost => 5.5, p_restock_id => $1::uuid)`, [rid]));
check('Add Stock with a restock id, then its retry (restocks.id TEXT)', add1 === '' && add2 === '', { add1, add2 });
check('...adds the stock once', num((await one(`SELECT count(*) AS n FROM restocks WHERE id = $1`, [rid])).n) === 1);
// Add Stock books no entry (runbook E): the owner books the bill to 1300.
await entry('BILL-RST-1', 'Posted', DAY, '2026-11-13T05:00:00Z', [[A.inv, 16.5, 0], [A.eq, 0, 16.5]]);
await balanced('Add Stock');
// Wholesale (numeric quantity) and a PO receipt (int4 quantity).
const wsErr = await errOf(() => q(`SELECT public.create_wholesale_order(p_order => $1::jsonb, p_items => $2::jsonb, p_created_by => 'owner', p_today => '${DAY}')`,
    [JSON.stringify({ customer_name: 'Shop B', status: 'Open', warehouse_id: wh }), JSON.stringify([{ product_id: 'PSPK', product_name: 'Speaker', quantity: 2, unit_price: 18 }])]));
check('wholesale order out of the warehouse', wsErr === '', wsErr);
await balanced('wholesale order');
// A decimal typed in the quantity box: int4 stock would round it while FIFO
// costs the fraction, so the pack refuses it and nothing moves.
const wsFrac = await errOf(() => q(`SELECT public.create_wholesale_order(p_order => $1::jsonb, p_items => $2::jsonb, p_created_by => 'owner', p_today => '${DAY}')`,
    [JSON.stringify({ customer_name: 'Shop B', status: 'Open', warehouse_id: wh }), JSON.stringify([{ product_id: 'PSPK', product_name: 'Speaker', quantity: 2.6, unit_price: 18 }])]));
check('a wholesale quantity of 2.6 is refused (whole numbers only)', /Quantities must be whole numbers/.test(wsFrac), wsFrac);
await balanced('fractional wholesale refused');
const poErr = await errOf(() => q(`SELECT public.receive_purchase_order(p_po_id => $1::uuid, p_today => '${DAY}')`, [poOpen]));
check('receive the ordered PO', poErr === '', poErr);
await balanced('PO received');
// A stock adjustment on the warehouse (warehouse_stock.warehouse_id uuid,
// stock_adjustments.warehouse_id text).
const adj = (await one(`INSERT INTO stock_adjustments (reason, adjustment_date) VALUES ('Count correction', '${DAY}') RETURNING id`)).id;
const saveErr = await errOf(() => q(`SELECT public.save_stock_adjustment(p_id => $1::uuid, p_header => $2::jsonb, p_lines => $3::jsonb)`,
    [adj, JSON.stringify({ warehouse_id: wh, adjustment_date: DAY, reason: 'Count correction' }),
     JSON.stringify([{ product_id: 'PMIC', quantity: -1, unit_cost: 4 }, { product_id: 'P6012', quantity: 1, unit_cost: 11 }])]));
const postErr = await errOf(() => q(`SELECT public.post_stock_adjustment(p_id => $1::uuid, p_created_by => 'owner')`, [adj]));
check('a warehouse stock adjustment saves and posts', saveErr === '' && postErr === '', { saveErr, postErr });
const ws = (await q(`SELECT product_id, quantity FROM warehouse_stock WHERE warehouse_id = $1 ORDER BY product_id`, [wh])).rows;
check('...and moves the warehouse rows (Mic 3 - 1, NR-6012 new at 1)',
    JSON.stringify(ws.map(r => [r.product_id, num(r.quantity)])) === JSON.stringify([['P6012', 1], ['PMIC', 2], ['PSPK', 3]]), ws);
await balanced('stock adjustment');
const back = await errOf(() => ship(uOrders[2], 'Shipped', 'Returned'));
const unship = await errOf(() => q(`SELECT public.restock_returned_orders(p_ids => ARRAY[$1]::text[], p_fields => '{}'::jsonb)`, [uOrders[2]]));
check('a shipped-unsettled order comes back Returned and is restocked', back === '' && unship === '', { back, unship });
await balanced('U order restocked');
const pool = (await q(`SELECT p.id, p.stock, (SELECT count(*) FROM inventory_items i WHERE i.product_id = p.id AND i.status = 'in_stock') AS n
    FROM products p ORDER BY p.id`)).rows;
check('every product: layers = integer stock', pool.every(r => num(r.stock) === num(r.n)), pool);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
