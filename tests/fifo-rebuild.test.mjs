// PGlite test of migrations/fifo_rebuild_pool.sql (FIFO phase 2): the
// one-time pool rebuild and the Draft FIFO-REVAL entry, on top of the real
// stack — full_schema.sql, auth guards, the packs, add_session_guards.sql and
// add_fifo_costing.sql. One seeded store carries every drift case (pool
// larger / smaller than stock, no rows, cost-0 rows, sold rows on Pending /
// ReStock orders, null sale_id, returned rows, settled and COGS-booked
// history, unsettled shipped lines, a fractional line, Returned and pre-cutoff
// orders, an inactive product, a fractional stock, open / cancelled wholesale
// orders, COGS booked for orders whose goods are still on hand). Each case is
// checked against the SQL result, and the SQL result
// is compared with src/scripts/fifo-rebuild-dryrun.cjs (buildInput +
// planStore) on the same rows — totals, ledger numbers, every row, every
// filler and every line — with the default options and with the Romdoul1
// true-up options. Then the D1 guard, the refusals (run once, phase 1
// missing, bad options) and the file run as shipped (no preset picked: it
// refuses; a preset picked: it runs and its last statement lists the
// summary).
// See tests/README.md for how to run it.
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

const { PGlite } = await import(process.env.PGLITE_DIST || '@electric-sql/pglite');
const require = createRequire(import.meta.url);
const { planStore, buildInput, PRESETS } = require('../src/scripts/fifo-rebuild-dryrun.cjs');

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mig = f => path.join(repo, 'migrations', f);
const strip = f => fs.readFileSync(f, 'utf8').replace(/NOTIFY[^;]*;/g, '');
let pass = 0, fail = 0;
const check = (label, cond, extra) => {
    if (cond) { pass++; console.log('PASS', label); }
    else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); }
};
const num = v => (v === null || v === undefined ? 0 : Number(v));
const near = (a, b, eps = 1e-9) => Math.abs(num(a) - num(b)) < eps;

const rebuildFile = strip(mig('fifo_rebuild_pool.sql'));
// The function definition alone (no BEGIN, no RUN call), so a test can call
// it with its own options.
const rebuildFn = rebuildFile.slice(0, rebuildFile.indexOf('-- >>> RUN')).replace(/^BEGIN;\s*$/m, '');
check('the file has one PRESET block, one RUN block, a COMMIT and then the summary SELECT',
    rebuildFile.split('-- >>> PRESET').length === 2 && rebuildFile.split('-- >>> RUN').length === 2 && rebuildFile.includes('-- <<< RUN')
    && /COMMIT;\s*-- The summary[\s\S]*ORDER BY x\.n;\s*$/.test(rebuildFile));
check('the Romdoul1 preset carries the true-up as its basis entry, in the SQL and in the dry run',
    /p_basis => '\{"NR-3026": 9\}'::JSONB,[\s\S]*?p_basis_ref => 'TRUEUP-20261112',\s*p_u_returned_after_basis => true\);/.test(rebuildFile)
    && PRESETS.romdoul1_trueup_2026_11_12.basisRef === 'TRUEUP-20261112' && PRESETS.default.basisRef === null
    && PRESETS.romdoul1_trueup_2026_11_12.uReturnedAfterBasis === true && PRESETS.default.uReturnedAfterBasis === false);
check('the file ships with no preset picked', /set_config\('fifo_rebuild\.preset', 'CHOOSE_A_PRESET', true\)/.test(rebuildFile));
check('the temp tables are dropped as pg_temp.*', /DROP TABLE IF EXISTS pg_temp\._fr_basis, pg_temp\._fr_p,/.test(rebuildFile)
    && !/DROP TABLE IF EXISTS _fr/.test(rebuildFile));

async function makeDb() {
    const db = new PGlite();
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;`);
    await db.exec(`CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid LANGUAGE sql AS 'SELECT gen_random_uuid()';`);
    let schema = strip(mig('full_schema.sql')).replace(/CREATE EXTENSION[^;]*;/g, '');
    schema = schema.replace(/INSERT INTO storage[\s\S]*?END \$\$;/, '');
    await db.exec(schema);
    await db.exec(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;`);
    await db.exec(strip(mig('add_auth_guards.sql')));
    for (const f of ['add_transaction_order_link.sql', 'add_transaction_reference_notes.sql',
                     'add_purchase_order_bill_date.sql',
                 'add_fifo_costing.sql', // the packs call its FIFO helpers
                     'add_wholesale_procurement_functions.sql',
                     'add_order_status_function.sql', 'add_order_payment_functions.sql',
                     'add_stock_adjustment_posting.sql',
                     'add_config_functions.sql', 'add_session_guards.sql',
                     'add_fifo_costing.sql', 'add_session_guards.sql']) {
        await db.exec(strip(mig(f)));
    }
    return db;
}
const L = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const day = (d, t = '10:00:00') => `2026-10-${String(d).padStart(2, '0')}T${t}Z`;
const W = n => `00000000-0000-0000-0000-0000000f000${n}`;

// ---------------------------------------------------------------------------
// The seeded store. Every product is one drift case.
// ---------------------------------------------------------------------------
async function seed(db) {
    const q = (s, p) => db.query(s, p);
    await q(`INSERT INTO products (id, name, price, stock, purchase_cost, is_active) VALUES
        ('pA', 'Pool big', 20, 2, 10, true),
        ('pB', 'Pool small', 20, 3, 9, true),
        ('pC', 'No rows', 20, 2, 4, true),
        ('pC2', 'PO only', 20, 1, 5, true),
        ('pD', 'Zero cost', 20, 2, 5, true),
        ('pE', 'Leftovers', 20, 1, 5, true),
        ('pF', 'Unsettled', 20, 2, 4, true),
        ('pN', 'NR-3026', 20, 2, 9.3, true),
        ('pT', 'Test Product', 20, 1, 1, false),
        ('pW', 'Wholesale item', 20, 5, 3, true),
        ('pQ', 'Frac stock', 20, 7.5, 2, true),
        ('pZ', 'Zero pc', 20, 0, 0, true)`);
    await q(`INSERT INTO sales (id, total, shipping_status, payment_status, date) VALUES
        ('H1', 1, 'Delivered', 'Paid', '${day(1)}'),
        ('H2', 1, 'Delivered', 'Settled', '${day(1)}'),
        ('H3', 1, 'Delivered', 'Paid/Settled', '${day(1)}'),
        ('K1', 1, 'Delivered', 'Unpaid', '${day(22)}'),
        ('K2', 1, 'Shipped', 'Unpaid', '${day(22)}'),
        ('P1', 1, 'Pending', 'Unpaid', '${day(22)}'),
        ('R1', 1, 'ReStock', 'Unpaid', '${day(22)}'),
        ('U1', 1, 'Shipped', 'Unpaid', '${day(25)}'),
        ('U2', 1, 'Returned', 'Unpaid', '${day(25)}'),
        ('U3', 1, 'Delivered', 'Unpaid', '${day(15)}'),
        ('U4', 1, 'Shipped', 'COD', '${day(26)}'),
        ('Q1', 1, 'ReStock', 'Paid', '${day(23)}'),
        ('Q2', 1, 'Pending', 'Unpaid', '${day(23)}'),
        ('Q3', 1, 'Confirmed', 'Paid', '${day(23)}'),
        ('Q4', 1, 'Pending', 'Paid', '${day(23)}')`);
    await q(`INSERT INTO sale_items (id, sale_id, product_id, name, price, quantity) VALUES
        ('l-h1', 'H1', 'pD', 'x', 1, 1),
        ('l-h2', 'H2', 'pE', 'x', 1, 1),
        ('l-h3', 'H3', 'pF', 'x', 1, 9),
        ('l-k1a', 'K1', 'pE', 'x', 1, 0.5),
        ('l-k1b', 'K1', 'pE', 'x', 1, 2),
        ('l-k2', 'K2', 'pE', 'x', 1, 1),
        ('l-p1', 'P1', 'pE', 'x', 1, 1),
        ('l-u1', 'U1', 'pF', 'x', 1, 2),
        ('l-u2', 'U2', 'pF', 'x', 1, 1.5),
        ('l-u3', 'U3', 'pF', 'x', 1, 1),
        ('l-u4', 'U4', 'pC', 'x', 1, 1),
        ('l-q1a', 'Q1', 'pA', 'x', 1, 2),
        ('l-q1e', 'Q1', 'pE', 'x', 1, 1),
        ('l-q1s', 'Q1', NULL, 'wrap', 1, 2),
        ('l-q2s', 'Q2', NULL, 'service', 1, 1),
        ('l-q3', 'Q3', 'pA', 'x', 1, 1),
        ('l-q4', 'Q4', 'pA', 'x', 1, 1)`);
    await q(`INSERT INTO stock_movements (product_id, product_name, type, quantity, reference_id, created_at) VALUES
        ('pF', 'x', 'out', 2, 'U1', '${day(27, '10:00:01')}'),
        ('pF', 'x', 'out', 2, 'U1', '${day(26, '10:00:01')}'),
        ('pF', 'x', 'out', 1, 'U2', '${day(27, '10:00:02')}'),
        ('pC', 'x', 'out', 1, 'U4', '${day(26, '12:00:00')}'),
        ('pC', 'x', 'in', 1, 'U3', '${day(1)}')`);
    // pD's settled history row, its two cost-0 rows; pE's leftovers all on
    // one day (only the id orders them); pF's six layers; ties on pA.
    await q(`INSERT INTO inventory_items (id, product_id, cost_of_purchase, status, sale_id, received_at) VALUES
        ('${L(101)}', 'pA', 10, 'in_stock', NULL, '${day(1)}'),
        ('${L(102)}', 'pA', 10, 'in_stock', NULL, '${day(2)}'),
        ('${L(104)}', 'pA', 12, 'in_stock', NULL, '${day(4)}'),
        ('${L(103)}', 'pA', 12, 'in_stock', NULL, '${day(4)}'),
        ('${L(105)}', 'pA', 13, 'in_stock', NULL, '${day(5)}'),
        ('${L(201)}', 'pB', 8, 'in_stock', NULL, '${day(5)}'),
        ('${L(401)}', 'pD', 6, 'sold', 'H1', '${day(1)}'),
        ('${L(402)}', 'pD', 0, 'in_stock', NULL, '${day(2)}'),
        ('${L(403)}', 'pD', NULL, 'in_stock', NULL, '${day(3)}'),
        ('${L(501)}', 'pE', 5, 'sold', 'P1', '${day(1)}'),
        ('${L(502)}', 'pE', 5, 'sold', 'R1', '${day(1)}'),
        ('${L(503)}', 'pE', 5, 'sold', NULL, '${day(1)}'),
        ('${L(504)}', 'pE', 5, 'sold', 'H2', '${day(1)}'),
        ('${L(505)}', 'pE', 5, 'sold', 'K1', '${day(1)}'),
        ('${L(506)}', 'pE', 5, 'sold', 'K2', '${day(1)}'),
        ('${L(507)}', 'pE', 5, 'returned', NULL, '${day(1)}'),
        ('${L(509)}', 'pE', 5, 'sold', 'K1', '${day(1)}'),
        ('${L(510)}', 'pE', 5, 'sold', 'K1', '${day(1)}'),
        ('${L(508)}', 'pE', 5.5, 'in_stock', NULL, '${day(9)}'),
        ('${L(601)}', 'pF', 1, 'sold', 'H3', '${day(1)}'),
        ('${L(602)}', 'pF', 2, 'in_stock', NULL, '${day(2)}'),
        ('${L(603)}', 'pF', 3, 'in_stock', NULL, '${day(3)}'),
        ('${L(604)}', 'pF', 4, 'sold', 'U1', '${day(4)}'),
        ('${L(605)}', 'pF', 5, 'in_stock', NULL, '${day(5)}'),
        ('${L(606)}', 'pF', 6, 'in_stock', NULL, '${day(6)}'),
        ('${L(701)}', 'pN', 9.3, 'in_stock', NULL, '${day(3)}'),
        ('${L(702)}', 'pN', 9.3, 'in_stock', NULL, '${day(4)}'),
        ('${L(801)}', 'pT', 1, 'in_stock', NULL, '${day(2)}')`);
    for (let i = 1; i <= 5; i++) await q(`INSERT INTO inventory_items (id, product_id, cost_of_purchase, status, received_at) VALUES ($1, 'pW', 3, 'in_stock', $2)`, [L(900 + i), day(1)]);
    for (let i = 1; i <= 8; i++) await q(`INSERT INTO inventory_items (id, product_id, cost_of_purchase, status, received_at) VALUES ($1, 'pQ', 2, 'in_stock', $2)`, [L(1000 + i), day(1)]);
    // Receipt costs: pB's newest priced restock is 7.5 (a newer 0 one is
    // skipped, and a restock beats an even newer received PO line at 8.8);
    // pC2's received PO line 5.3 (a newer Draft PO's 9 is not).
    await q(`INSERT INTO restocks (id, product_id, quantity, cost, date) VALUES
        ('${L(9001)}', 'pB', 1, 7.0, '${day(3)}'),
        ('${L(9002)}', 'pB', 1, 7.5, '${day(4)}'),
        ('${L(9003)}', 'pB', 1, 0, '${day(6)}')`);
    await q(`INSERT INTO purchase_orders (id, status) VALUES ('${L(9101)}', 'Received'), ('${L(9102)}', 'Draft')`);
    await q(`INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, unit_price, created_at) VALUES
        ('${L(9111)}', '${L(9101)}', 'pC2', 1, 5.3, '${day(3)}'),
        ('${L(9112)}', '${L(9102)}', 'pC2', 1, 9, '${day(8)}'),
        ('${L(9113)}', '${L(9101)}', 'pB', 1, 8.8, '${day(8)}')`);
    // Wholesale: W1 Open with a Posted COGS of 9 booked at older costs; W2
    // Cancelled; W3 Delivered with no COGS entry; W4 all at purchase_cost 0.
    await q(`INSERT INTO wholesale_orders (id, customer_name, status) VALUES
        ('${W(1)}', 'Shop 1', 'Open'), ('${W(2)}', 'Shop 2', 'Cancelled'), ('${W(3)}', 'Shop 3', 'Delivered'), ('${W(4)}', 'Shop 4', 'Open')`);
    await q(`INSERT INTO wholesale_order_items (id, wholesale_order_id, product_id, quantity, unit_price) VALUES
        ('${L(9201)}', '${W(1)}', 'pW', 2, 5), ('${L(9202)}', '${W(1)}', 'pA', 1, 15),
        ('${L(9203)}', '${W(2)}', 'pW', 1, 5),
        ('${L(9204)}', '${W(3)}', 'pC', 1, 5),
        ('${L(9205)}', '${W(4)}', 'pZ', 1, 5), ('${L(9206)}', '${W(4)}', 'pZ', 3, 5)`);
    const acc = async c => (await q(`SELECT id FROM chart_of_accounts WHERE account_code = $1`, [c])).rows[0].id;
    const A = { inv: await acc('1300'), cogs: await acc('5000'), eq: await acc('3000'), cash: await acc('1000') };
    const entry = async (ref, status, lines) => {
        const id = (await q(`INSERT INTO journal_entries (description, reference_id, status, date) VALUES ($1, $1, $2, '2026-10-21') RETURNING id`, [ref, status])).rows[0].id;
        for (const [a, dr, cr] of lines) await q(`INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, $4)`, [id, a, dr, cr]);
    };
    await entry('ORD-K1-COGS', 'Draft', [[A.cogs, 10, 0], [A.inv, 0, 10]]);
    const tx = (await q(`INSERT INTO transactions (type, amount, order_id) VALUES ('Income', 5, 'K2') RETURNING id`)).rows[0].id;
    await entry(`TX-${tx}`, 'Posted', [[A.cash, 5, 0], [A.cogs, 5, 0], [A.inv, 0, 5], [A.eq, 0, 5]]);
    // U1 has a receipt entry with no 5000 line, U4 an ORD-…-COGS-ADJ: neither
    // counts as a COGS entry.
    const tx2 = (await q(`INSERT INTO transactions (type, amount, order_id) VALUES ('Income', 3, 'U1') RETURNING id`)).rows[0].id;
    await entry(`TX-${tx2}`, 'Draft', [[A.cash, 3, 0], [A.eq, 0, 3]]);
    await entry('ORD-U4-COGS-ADJ', 'Draft', [[A.cogs, 1, 0], [A.inv, 0, 1]]);
    await entry(`WSO-${W(1)}-COGS`, 'Posted', [[A.cogs, 9, 0], [A.inv, 0, 9]]);
    // Booked with the goods on hand (SU): Q1 restocked after a Posted
    // ORD-Q1-COGS of 6; Q2 not shipped, its receipt took 3.5 (no product
    // line); Q4's two entries net to 0 (left out); Q3 has no COGS entry; an
    // entry of a deleted order is ignored.
    await entry('ORD-Q1-COGS', 'Posted', [[A.cogs, 6, 0], [A.inv, 0, 6]]);
    const tx3 = (await q(`INSERT INTO transactions (type, amount, order_id) VALUES ('Income', 9, 'Q2') RETURNING id`)).rows[0].id;
    await entry(`TX-${tx3}`, 'Draft', [[A.cash, 9, 0], [A.cogs, 3.5, 0], [A.inv, 0, 3.5], [A.eq, 0, 9]]);
    const tx4 = (await q(`INSERT INTO transactions (type, amount, order_id) VALUES ('Income', 4, 'Q4') RETURNING id`)).rows[0].id;
    await entry(`TX-${tx4}`, 'Posted', [[A.cogs, 2, 0], [A.inv, 0, 2]]);
    await entry('ORD-Q4-COGS', 'Draft', [[A.inv, 2, 0], [A.cogs, 0, 2]]);
    await entry('ORD-GONE-COGS', 'Posted', [[A.cogs, 4, 0], [A.inv, 0, 4]]);
    await entry(`WSO-${W(4)}-COGS`, 'Draft', [[A.cogs, 8, 0], [A.inv, 0, 8]]);
    return A;
}

// The opening entry that makes B = the plan's basis value + offset.
async function bookOpening(db, A, amount) {
    const id = (await db.query(`INSERT INTO journal_entries (description, reference_id, status, date) VALUES ('Opening', 'OPENING-INV', 'Posted', '2026-10-21') RETURNING id`)).rows[0].id;
    await db.query(`INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0), ($1, $4, 0, $3)`, [id, A.inv, amount, A.eq]);
}

// The dry run's view of the database: the same columns its loader selects,
// timestamps in the ISO form PostgREST sends.
const iso = c => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
async function readRaw(db) {
    const rows = async s => (await db.query(s)).rows;
    return {
        products: await rows(`SELECT id, name, stock, purchase_cost, is_active FROM products`),
        items: await rows(`SELECT id::text AS id, product_id, cost_of_purchase, status, sale_id, ${iso('created_at')} AS created_at, ${iso('received_at')} AS received_at FROM inventory_items`),
        sales: await rows(`SELECT id, shipping_status, payment_status, ${iso('date')} AS date, ${iso('created_at')} AS created_at,
                                  ${iso('last_edited_at')} AS last_edited_at FROM sales`),
        saleItems: await rows(`SELECT id, sale_id, product_id, quantity FROM sale_items`),
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
const jsPlan = async (db, opts) => {
    const { input } = buildInput(await readRaw(db), opts.basisArgs || [], { uStatuses: opts.uStatuses ? new Set(opts.uStatuses) : undefined,
        uFrom: opts.uFrom, basisRef: opts.basisRef, uReturnedAfterBasis: !!opts.uReturnedAfterBasis });
    return planStore(input);
};
const runSql = async (db, opts) => {
    await db.exec(rebuildFn);
    const basis = Object.fromEntries((opts.basisArgs || []).map(s => { const [k, v] = s.split('='); return [k, Number(v)]; }));
    return (await db.query(`SELECT pg_temp.fifo_rebuild_pool($1::jsonb, $2::text[], $3::date, $4::date, $5::text, $6::boolean) AS j`,
        [JSON.stringify(basis), opts.uStatuses || null, opts.uFrom || null, '2026-11-13', opts.basisRef || null, !!opts.uReturnedAfterBasis])).rows[0].j;
};
const errOf = async (fn) => { try { await fn(); return ''; } catch (e) { return String(e.message || e); } };

// Compare the SQL result and the database after it with the dry run's plan.
async function compare(db, tag, plan, res) {
    const T = plan.totals, R = res.totals;
    for (const k of ['S', 'U', 'u_lines', 'u_orders', 'rows_total', 'kept_in_stock', 'assigned_rows', 'filler_in_stock',
                     'filler_assigned', 'recosted_zero_rows', 'pulled_from_history', 'history_sold', 'written_off',
                     'wo_surplus_in_stock', 'wo_returned', 'wo_sold_null_sale', 'wo_sold_unsettled_unassigned']) {
        check(`${tag}: SQL ${k} = dry run (${T[k]})`, num(R[k]) === num(T[k]), { sql: R[k], js: T[k] });
    }
    check(`${tag}: SQL wo_sold_not_holding = dry run`, num(R.wo_sold_not_holding) === T.wo_sold_not_holding + T.wo_sold_missing_sale);
    check(`${tag}: SQL u_frac_qty = dry run`, near(R.u_frac_qty, T.u_frac_qty));
    for (const k of ['V_in_stock', 'V_unsettled', 'V', 'B', 'V_minus_B', 'settled_unshipped_booked', 'basis_value_S_plus_U',
                     'E', 'expected_B', 'D1', 'guard_diff', 'reval_amount']) {
        check(`${tag}: SQL ${k} = dry run (${plan.ledger[k]})`, near(res.ledger[k], plan.ledger[k], 0.001), { sql: res.ledger[k], js: plan.ledger[k] });
    }
    const su = l => l.map(o => [o.order_id, o.shipping_status, o.payment_status, num(o.booked)]);
    check(`${tag}: SQL SU orders = dry run`, JSON.stringify(su(res.settled_unshipped)) === JSON.stringify(su(plan.settled_unshipped)),
        { sql: res.settled_unshipped, js: plan.settled_unshipped });
    const es = l => l.map(x => [x.kind, x.id, JSON.stringify(x.refs), num(x.booked_before_cutoff), num(x.booked_after_cutoff),
        num(x.overridden_qty), num(x.basis_value), num(x.direction), num(x.ledger_excess), num(x.cost_excess), num(x.E), x.source, x.note]);
    check(`${tag}: SQL E subjects = dry run (${plan.basis_sales.subjects.length})`,
        JSON.stringify(es(res.basis_sales.subjects)) === JSON.stringify(es(plan.basis_sales.subjects)),
        { sql: res.basis_sales.subjects, js: plan.basis_sales.subjects });
    const ra = x => [num(x.orders), num(x.qty), num(x.basis_value), JSON.stringify(x.list.map(k => [k.order_id, k.status_at_cutoff, num(k.qty), num(k.basis_value)]))];
    check(`${tag}: SQL Returned orders kept in U = dry run (${plan.u_returned_after_basis.orders})`,
        JSON.stringify(ra(res.u_returned_after_basis)) === JSON.stringify(ra(plan.u_returned_after_basis)),
        { sql: res.u_returned_after_basis, js: plan.u_returned_after_basis });
    for (const why of ['by_status', 'before_u_from']) {
        const a = res.excluded_from_u[why], b = plan.excluded_from_u[why];
        check(`${tag}: SQL excluded_from_u.${why} = dry run`, num(a.orders) === b.orders && near(a.qty, b.qty) && near(a.basis_value, b.basis_value, 0.001)
            && JSON.stringify(a.order_ids) === JSON.stringify(b.order_ids), { sql: a, js: b });
    }
    const booked = (await db.query(`SELECT sale_id, sum(cogs_booked) AS b FROM sale_items WHERE cogs_booked IS NOT NULL GROUP BY sale_id ORDER BY sale_id`)).rows;
    check(`${tag}: cogs_booked is recorded on the SU orders only, at their booked amount`,
        JSON.stringify(booked.map(r => [r.sale_id, num(r.b)])) === JSON.stringify(plan.settled_unshipped.map(o => [o.order_id, o.booked])), booked);
    const db_rows = new Map((await db.query(`SELECT id::text AS id, product_id, status, cost_of_purchase, sale_id, consumer_kind, consumer_id, consumer_line_id, receipt_ref
        FROM inventory_items`)).rows.map(r => [r.id, r]));
    const bad = [];
    const fillersJs = new Map();
    for (const p of plan.rowPlan) {
        if (p.row_id.startsWith('FILLER-')) {
            const k = [p.product_id, p.new_status, num(p.new_cost), p.consumer_line_id || ''].join('|');
            fillersJs.set(k, (fillersJs.get(k) || 0) + 1);
            continue;
        }
        const d = db_rows.get(p.row_id);
        if (!d) { bad.push([p.row_id, 'missing']); continue; }
        let ok = d.status === p.new_status && near(d.cost_of_purchase, p.new_cost);
        if (p.new_status === 'in_stock') ok = ok && d.sale_id === null && d.consumer_kind === null;
        if (p.new_status === 'written_off') ok = ok && d.consumer_kind === 'reconcile' && d.consumer_id === 'FIFO-REBUILD-20261113' && d.sale_id === null;
        if (p.new_status === 'sold' && p.consumer_line_id) ok = ok && d.consumer_kind === 'retail' && d.consumer_line_id === p.consumer_line_id && d.sale_id === p.consumer_id;
        if (p.new_status === 'sold' && !p.consumer_line_id) ok = ok && d.sale_id === p.consumer_id;
        if (!ok) bad.push([p.row_id, p.new_status, p.new_cost, d]);
    }
    check(`${tag}: every existing row ends as the dry run planned (${plan.rowPlan.length} plan rows)`, bad.length === 0, bad.slice(0, 5));
    check(`${tag}: every row is in the plan`, db_rows.size === plan.rowPlan.length, { db: db_rows.size, plan: plan.rowPlan.length });
    const fillersSql = new Map();
    for (const d of db_rows.values()) {
        if (d.receipt_ref !== 'FIFO-REBUILD') continue;
        const k = [d.product_id, d.status, num(d.cost_of_purchase), d.consumer_line_id || ''].join('|');
        fillersSql.set(k, (fillersSql.get(k) || 0) + 1);
    }
    check(`${tag}: fillers match the dry run (product, status, cost, line)`,
        JSON.stringify([...fillersSql].sort()) === JSON.stringify([...fillersJs].sort()), { sql: [...fillersSql], js: [...fillersJs] });
    const lines = new Map((await db.query(`SELECT id, cogs_cost, cogs_short_qty FROM sale_items`)).rows.map(r => [r.id, r]));
    const badLines = plan.linePlan.filter(l => !near(lines.get(l.line_id).cogs_cost, l.cogs_cost, 1e-4) || !near(lines.get(l.line_id).cogs_short_qty, l.cogs_short_qty));
    check(`${tag}: every U line's cogs_cost / cogs_short_qty = dry run`, badLines.length === 0, badLines);
    const planned = new Set(plan.linePlan.map(l => l.line_id));
    check(`${tag}: lines outside U keep cogs_cost NULL`, [...lines.values()].every(l => planned.has(l.id) || l.cogs_cost === null));
}

const poolEqStock = async db => (await db.query(`SELECT p.id, floor(GREATEST(p.stock, 0)) AS s,
        (SELECT count(*) FROM inventory_items i WHERE i.product_id = p.id AND i.status = 'in_stock') AS n
      FROM products p`)).rows.filter(r => num(r.s) !== num(r.n));

// ===========================================================================
// 1. Default options (U = Shipped / Delivered / Returned, no cutoff)
// ===========================================================================
{
    const db = await makeDb();
    const A = await seed(db);
    const before = await jsPlan(db, {});
    // B so that the guard passes with 0.40 to spare.
    await bookOpening(db, A, Math.round((before.ledger.expected_B - before.ledger.B + 0.4) * 100) / 100);
    const plan = await jsPlan(db, {});
    check('defaults: the dry run passes the guard on the seeded store', plan.ledger.guard_pass && near(plan.ledger.guard_diff, 0.4, 1e-6), plan.ledger);
    const rowsBefore = num((await db.query(`SELECT count(*) AS n FROM inventory_items`)).rows[0].n);
    // Supabase's default privileges: new public tables are open to the API roles.
    await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated`);
    const res = await runSql(db, {});
    await compare(db, 'defaults', plan, res);
    const q = async (s, p) => (await db.query(s, p)).rows;
    const one = async (s, p) => (await q(s, p))[0];
    const st = async id => one(`SELECT status, cost_of_purchase AS cost, sale_id, consumer_kind AS kind, consumer_id AS cid, consumer_line_id AS line, received_at FROM inventory_items WHERE id = $1`, [id]);

    check('every product: in_stock count = stock (floored)', (await poolEqStock(db)).length === 0, await poolEqStock(db));
    check('fractional stock is reported, planned as 7', res.anomalies.length === 1 && res.anomalies[0].product_id === 'pQ' && num(res.anomalies[0].planned_as) === 7, res.anomalies);
    // Pool larger than stock.
    check('pool > stock: the newest 2 of pA stay (13, then 12 of the id-tied pair L104)',
        (await st(L(105))).status === 'in_stock' && (await st(L(104))).status === 'in_stock' && (await st(L(103))).status === 'written_off');
    check('pool > stock: 3 surplus pA rows written off, tagged, unlinked',
        (await q(`SELECT 1 FROM inventory_items WHERE product_id = 'pA' AND status = 'written_off' AND consumer_kind = 'reconcile' AND consumer_id = 'FIFO-REBUILD-20261113'`)).length === 3);
    // Pool smaller than stock.
    const pB = await q(`SELECT cost_of_purchase AS cost, received_at < '${day(5)}'::timestamptz AS older FROM inventory_items WHERE product_id = 'pB' AND receipt_ref = 'FIFO-REBUILD'`);
    check('pool < stock: 2 pB fillers at the newest priced restock (7.5), received before the oldest row',
        pB.length === 2 && pB.every(r => num(r.cost) === 7.5 && r.older), pB);
    // No rows.
    const pC = await q(`SELECT status, cost_of_purchase AS cost, consumer_line_id AS line FROM inventory_items WHERE product_id = 'pC' ORDER BY received_at DESC`);
    check('no rows: pC gets 3 fillers at purchase_cost 4 — 2 in_stock, the oldest sold to U4',
        pC.length === 3 && pC.every(r => num(r.cost) === 4) && pC[0].status === 'in_stock' && pC[1].status === 'in_stock'
        && pC[2].status === 'sold' && pC[2].line === 'l-u4', pC);
    check('no rows: pC2 filler at the received PO line cost (5.3, not the Draft PO 9)',
        num((await one(`SELECT cost_of_purchase AS c FROM inventory_items WHERE product_id = 'pC2'`)).c) === 5.3);
    // Cost-0 rows.
    check('cost-0 rows: pD 0 and NULL rows re-costed to the newest priced row (6)',
        num((await st(L(402))).cost) === 6 && num((await st(L(403))).cost) === 6 && (await st(L(402))).status === 'in_stock');
    check('cost-0 rows: pD settled history row stays sold to H1, stamped to its line',
        (await st(L(401))).status === 'sold' && (await st(L(401))).sale_id === 'H1' && (await st(L(401))).line === 'l-h1');
    // Leftovers.
    for (const [id, why] of [[501, 'Pending order'], [502, 'ReStock order'], [503, 'null sale_id'], [507, "status 'returned'"]]) {
        const r = await st(L(id));
        check(`leftover sold row on a ${why} is written off with sale_id cleared`, r.status === 'written_off' && r.sale_id === null && r.kind === 'reconcile', r);
    }
    const h2 = await st(L(504)), k2 = await st(L(506));
    check('history: settled H2 row stays sold, stamped retail / H2 / l-h2', h2.status === 'sold' && h2.kind === 'retail' && h2.cid === 'H2' && h2.line === 'l-h2', h2);
    check('history: TX-booked K2 row stays sold, stamped to l-k2', k2.status === 'sold' && k2.line === 'l-k2', k2);
    // K1 (ORD-K1-COGS booked) holds 3 rows; its lines are 0.5 (no whole unit) and 2.
    const k1 = await q(`SELECT id::text AS id, consumer_line_id AS line FROM inventory_items WHERE sale_id = 'K1' ORDER BY id`);
    check('history: K1 rows stamped by line room (0.5 line holds none, the 2-line two), the extra row left unstamped',
        k1.length === 3 && k1[0].line === 'l-k1b' && k1[1].line === 'l-k1b' && k1[2].line === null, k1);
    check('history: K1 and K2 orders (COGS-booked) are not in U', !plan.linePlan.some(l => l.order_id === 'K1' || l.order_id === 'K2'));
    // Unsettled shipped lines take the next-newest layers.
    const held = async line => (await q(`SELECT id::text AS id FROM inventory_items WHERE consumer_line_id = $1 AND status = 'sold' ORDER BY received_at, id`, [line])).map(r => r.id);
    check('U: pF in_stock = the newest 2 (6, 5)', (await st(L(606))).status === 'in_stock' && (await st(L(605))).status === 'in_stock');
    check('U: oldest-shipped line l-u3 (no movement: its order date, Oct 15) gets the oldest of the U slice (L601, pulled from history)',
        JSON.stringify(await held('l-u3')) === JSON.stringify([L(601)]));
    check('U: l-u1 (newest out movement Oct 27 10:00:01) next: L602 + L603',
        JSON.stringify(await held('l-u1')) === JSON.stringify([L(602), L(603)]));
    check('U: l-u2 (Returned, Oct 27 10:00:02) last: L604', JSON.stringify(await held('l-u2')) === JSON.stringify([L(604)]));
    const lu = new Map((await q(`SELECT id, cogs_cost, cogs_short_qty FROM sale_items WHERE id LIKE 'l-u%'`)).map(r => [r.id, r]));
    check('U: cogs_cost l-u3 1, l-u1 5, l-u2 4 + 0.5 short at the fallback 6 = 7, l-u4 4',
        num(lu.get('l-u3').cogs_cost) === 1 && num(lu.get('l-u1').cogs_cost) === 5 && num(lu.get('l-u2').cogs_cost) === 7
        && num(lu.get('l-u4').cogs_cost) === 4, [...lu.values()]);
    check('U: the fractional part is the line\'s cogs_short_qty', num(lu.get('l-u2').cogs_short_qty) === 0.5 && num(lu.get('l-u1').cogs_short_qty) === 0);
    const u1 = await st(L(602));
    check('U: assigned rows carry sale_id and consumed_at = ship time',
        u1.sale_id === 'U1' && num((await one(`SELECT consumed_at = '${day(27, '10:00:01')}'::timestamptz AS ok FROM inventory_items WHERE id = $1`, [L(602)])).ok ? 1 : 0) === 1);
    check('inactive product is rebuilt like any other (Test Product kept)', (await st(L(801))).status === 'in_stock');
    // SU.
    check('SU = Q1 (6) + Q2 (3.5); Q3 (nothing booked), Q4 (nets to 0) and a deleted order left out',
        near(res.ledger.settled_unshipped_booked, 9.5) && JSON.stringify(res.settled_unshipped.map(o => o.order_id)) === '["Q1","Q2"]', res.settled_unshipped);
    check('the guard counts SU: expected B = basis value - SU', near(res.ledger.expected_B, res.ledger.basis_value_S_plus_U - 9.5, 1e-6));
    const qb = new Map((await q(`SELECT id, cogs_booked, cogs_cost FROM sale_items WHERE sale_id IN ('Q1', 'Q2', 'Q3', 'Q4')`)).map(r => [r.id, r]));
    check('SU Q1: 6 split by quantity over its product lines (pA 2 -> 4, pE 1 -> 2), the no-product line none, no cogs_cost',
        num(qb.get('l-q1a').cogs_booked) === 4 && num(qb.get('l-q1e').cogs_booked) === 2 && qb.get('l-q1s').cogs_booked === null
        && [...qb.values()].every(r => r.cogs_cost === null), [...qb.values()]);
    check('SU Q2 (no product line): all 3.5 on its first line', num(qb.get('l-q2s').cogs_booked) === 3.5);
    check('Q3 and Q4 get no cogs_booked', qb.get('l-q3').cogs_booked === null && qb.get('l-q4').cogs_booked === null);
    // Wholesale backfill.
    const wl = new Map((await q(`SELECT id::text AS id, cogs_cost, cogs_short_qty FROM wholesale_order_items`)).map(r => [r.id, r]));
    check('wholesale W1: Posted COGS 9 allocated by purchase_cost x qty (6 : 10) = 3.375 / 5.625, all short',
        num(wl.get(L(9201)).cogs_cost) === 3.375 && num(wl.get(L(9202)).cogs_cost) === 5.625
        && num(wl.get(L(9201)).cogs_short_qty) === 2 && num(wl.get(L(9202)).cogs_short_qty) === 1, [...wl.values()]);
    check('wholesale W2 (Cancelled) untouched', wl.get(L(9203)).cogs_cost === null && num(wl.get(L(9203)).cogs_short_qty) === 0);
    check('wholesale W3 (no COGS entry): cogs_cost 0, qty short', num(wl.get(L(9204)).cogs_cost) === 0 && num(wl.get(L(9204)).cogs_short_qty) === 1);
    check('wholesale W4 (purchase_cost 0): allocated by qty, 8 -> 2 / 6', num(wl.get(L(9205)).cogs_cost) === 2 && num(wl.get(L(9206)).cogs_cost) === 6);
    check('wholesale summary', num(res.wholesale_backfill.lines) === 5 && num(res.wholesale_backfill.cogs_cost) === 17, res.wholesale_backfill);
    check('wholesale backfill lines are marked cogs_backfill (and only they)',
        num((await one(`SELECT count(*) FILTER (WHERE cogs_backfill) AS b, count(*) FILTER (WHERE cogs_backfill AND cogs_cost IS NULL) AS x FROM wholesale_order_items`)).b) === 5
        && num((await one(`SELECT count(*) FILTER (WHERE cogs_backfill AND cogs_cost IS NULL) AS x FROM wholesale_order_items`)).x) === 0);
    const chkW = (await one(`SELECT wp_internal.fifo_inventory_check() AS j`)).j;
    check('fifo_inventory_check: the backfill is pre-FIFO wholesale, not shortfall (5 lines, 17.00)',
        num(chkW.shortfall.wholesale_lines) === 0 && num(chkW.shortfall.wholesale_qty) === 0
        && num(chkW.shortfall.wholesale_backfill_lines) === 5 && near(chkW.shortfall.wholesale_backfill_cost, 17, 1e-6), chkW.shortfall);
    const w1 = await one(`SELECT wholesale_order_id::text AS oid FROM wholesale_order_items WHERE id = $1`, [L(9201)]);
    await db.query(`SELECT wp_internal.fifo_give_back_line('wholesale', $1, $2)`, [w1.oid, L(9201)]);
    check('a backfill line that gives its units back is no longer marked',
        (await one(`SELECT cogs_backfill FROM wholesale_order_items WHERE id = $1`, [L(9201)])).cogs_backfill === false);
    await db.query(`UPDATE inventory_items SET status = 'sold', consumer_kind = 'wholesale', consumer_id = $1, consumer_line_id = $2
                     WHERE receipt_ref = 'RET-' || $1`, [w1.oid, L(9201)]);
    await db.query(`UPDATE wholesale_order_items SET cogs_cost = 3.375, cogs_short_qty = 0 WHERE id = $1`, [L(9201)]);
    const bak = await one(`SELECT c.relrowsecurity AS rls, has_table_privilege('anon', c.oid, 'SELECT') AS anon_sel,
                                  has_table_privilege('authenticated', c.oid, 'UPDATE') AS auth_upd
                             FROM pg_class c WHERE c.relname = 'inventory_items_bak_20261113'`);
    check('backup table: row level security on, no API access (anon / authenticated)', bak.rls === true && bak.anon_sel === false && bak.auth_upd === false, bak);
    // Backup, entry, ledger identity.
    check('backup table inventory_items_bak_20261113 holds every row from before',
        num((await one(`SELECT count(*) AS n FROM inventory_items_bak_20261113`)).n) === rowsBefore && res.backup_table === 'inventory_items_bak_20261113');
    const je = await q(`SELECT e.entry_number, e.status, e.description, e.date::text AS date, a.account_code AS code, l.debit, l.credit
        FROM journal_entries e JOIN journal_entry_lines l ON l.journal_entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
       WHERE e.reference_id = 'FIFO-REVAL-20261113' ORDER BY a.account_code`);
    const d1 = num(res.ledger.D1);
    check('D1 is not 0 on the seeded store', Math.abs(d1) > 0.005, res.ledger);
    const inv = je.find(r => r.code === '1300'), cg = je.find(r => r.code === '5000');
    check('FIFO-REVAL: one Draft entry, app numbering JE-<n>-MAN-20261113-001, dated the run date',
        je.length === 2 && je.every(r => r.status === 'Draft' && /^JE-\d+-MAN-20261113-001$/.test(r.entry_number) && r.date === '2026-11-13')
        && je[0].description === 'FIFO revaluation of on-hand and shipped-unsettled stock', je);
    check(`FIFO-REVAL: D1 ${d1} between 1300 and 5000 in the right direction`,
        d1 > 0 ? near(inv.debit, d1) && near(cg.credit, d1) && near(inv.credit, 0) : near(inv.credit, -d1) && near(cg.debit, -d1) && near(inv.debit, 0), je);
    check('summary entry matches', res.entry && res.entry.reference_id === 'FIFO-REVAL-20261113' && near(res.entry.amount, Math.abs(d1)));
    const chk = (await one(`SELECT wp_internal.fifo_inventory_check() AS j`)).j;
    check('after the rebuild fifo_inventory_check variance = B - basis value (the 0.40 the guard allowed)',
        near(chk.variance, 0.4, 1e-6) && near(chk.retail_out_unbooked, res.ledger.V_unsettled, 1e-6), chk);
    check('fifo_inventory_check: only the fractional-stock product mismatches', chk.product_mismatches === 1 && chk.products[0].product_id === 'pQ', chk.products);
    check('fifo_inventory_check counts SU as booked, not out', near(chk.retail_booked_not_out, 9.5, 1e-6), chk);
    // Run once.
    const again = await errOf(() => runSql(db, {}));
    check('a second run the same day is refused (backup exists)', /already exists/.test(again), again);
    await db.query(`DROP TABLE inventory_items_bak_20261113`);
    const again2 = await errOf(() => runSql(db, {}));
    check('...and with the backup gone, refused by the FIFO-REVAL entry', /FIFO-REVAL-20261113 already exists/.test(again2), again2);
    await db.query(`DELETE FROM journal_entries WHERE reference_id = 'FIFO-REVAL-20261113'`);
    const again3 = await errOf(() => runSql(db, {}));
    check('...and with that gone too, refused by the pool\'s FIFO state', /already carries FIFO state/.test(again3), again3);
    // The phase 1 primitives on the rebuilt pool.
    const ret = await one(`SELECT cost, short_qty FROM wp_internal.fifo_return('retail', 'U1', 'l-u1')`);
    check('after: fifo_return of a U line gives back exactly its rows (5)', near(ret.cost, 5) && (await held('l-u1')).length === 0, ret);
    const back = await one(`SELECT cost FROM wp_internal.fifo_consume('pF', 2, 'retail', 'U1', 'l-u1')`);
    check('after: taking them again picks the same rows', near(back.cost, 5) && JSON.stringify(await held('l-u1')) === JSON.stringify([L(602), L(603)]));
    const fb = await one(`SELECT cost FROM wp_internal.fifo_consume('pB', 1, 'retail', 'U4', 'x')`);
    check('after: pB\'s next unit out is a filler (7.5), older than the real layer', near(fb.cost, 7.5));
    const h = await one(`SELECT cost FROM wp_internal.fifo_return('retail', 'H2', 'l-h2')`);
    check('after: a stamped history row can be given back', near(h.cost, 5) && (await st(L(504))).status === 'in_stock');
}

// ===========================================================================
// 2. The Romdoul1 true-up options: a basis override, Returned left out, a cutoff
// ===========================================================================
{
    const db = await makeDb();
    const A = await seed(db);
    const opts = { basisArgs: ['NR-3026=9'], uStatuses: ['Shipped', 'Delivered'], uFrom: '2026-10-21' };
    const before = await jsPlan(db, opts);
    await bookOpening(db, A, Math.round((before.ledger.expected_B - before.ledger.B) * 100) / 100);
    const plan = await jsPlan(db, opts);
    check('true-up options: the dry run guard residual is 0', near(plan.ledger.guard_diff, 0, 1e-6), plan.ledger);
    const res = await runSql(db, opts);
    await compare(db, 'true-up options', plan, res);
    const lu = new Map((await db.query(`SELECT id, cogs_cost FROM sale_items WHERE id LIKE 'l-u%'`)).rows.map(r => [r.id, r]));
    check('true-up options: Returned U2 and pre-cutoff U3 are left out of U', lu.get('l-u2').cogs_cost === null && lu.get('l-u3').cogs_cost === null);
    check('true-up options: U = U1 (2) + U4 (1)', num(res.totals.U) === 3);
    check('true-up options: the summary lists the orders left out of U (U2 by status, U3 before the cutoff)',
        JSON.stringify(res.excluded_from_u.by_status.order_ids) === '["U2"]' && JSON.stringify(res.excluded_from_u.before_u_from.order_ids) === '["U3"]'
        && num(res.excluded_from_u.by_status.qty) === 1.5, res.excluded_from_u);
    const pn = plan.productRows.find(r => r.product_id === 'pN');
    check('true-up options: NR-3026 layers at 9.30 against a 9.00 basis add 0.60 to D1', near(pn.d1, 0.6, 1e-6));
    check('true-up options: with U smaller, the next-older pF row L602 is written off and U1 keeps L603 + L604', (await db.query(`SELECT status FROM inventory_items WHERE id = $1`, [L(602)])).rows[0].status === 'written_off'
        && (await db.query(`SELECT count(*) AS n FROM inventory_items WHERE consumer_line_id = 'l-u1' AND id IN ($1, $2)`, [L(603), L(604)])).rows[0].n == 2);
    const chk = (await db.query(`SELECT wp_internal.fifo_inventory_check() AS j`)).rows[0].j;
    check('true-up options: fifo_inventory_check variance 0 after the rebuild', near(chk.variance, 0, 1e-6), chk);
}

// ===========================================================================
// 3. The D1 guard, the other refusals, and nothing changed when they fire
// ===========================================================================
{
    const db = await makeDb();
    const A = await seed(db);
    const before = await jsPlan(db, {});
    await bookOpening(db, A, Math.round((before.ledger.expected_B - before.ledger.B + 5) * 100) / 100);
    const plan = await jsPlan(db, {});
    check('guard: the dry run fails it (B 5 over the basis value)', !plan.ledger.guard_pass);
    const snap = async () => JSON.stringify((await db.query(`SELECT id, status, cost_of_purchase, sale_id, consumer_kind FROM inventory_items ORDER BY id`)).rows);
    const s0 = await snap();
    const e = await errOf(() => runSql(db, {}));
    check('guard: the SQL raises with D1, V - SU - B - E, V, SU, B and E', /FIFO rebuild stopped, nothing was changed: D1 = -?[\d.]+ but V - SU - B - E = -?[\d.]+ \(V [\d.]+, SU [\d.]+, B -?[\d.]+, E -?[\d.]+/.test(e)
        && e.includes(`D1 = ${plan.ledger.D1.toFixed(2)}`) && e.includes(`V ${plan.ledger.V.toFixed(2)}`) && e.includes('SU 9.50'), e);
    check('guard: the message names the inactive product that still holds stock, and how to zero it',
        e.includes('Inactive products still holding stock: Test Product (stock 1, 1.00 at basis cost)') && /no ledger entry/.test(e), e);
    check('guard: nothing changed (rows, no backup, no entry, no line cost)', await snap() === s0
        && (await db.query(`SELECT to_regclass('inventory_items_bak_20261113') AS t`)).rows[0].t === null
        && (await db.query(`SELECT count(*) AS n FROM journal_entries WHERE reference_id LIKE 'FIFO-REVAL-%'`)).rows[0].n == 0
        && (await db.query(`SELECT count(*) AS n FROM sale_items WHERE cogs_cost IS NOT NULL`)).rows[0].n == 0
        && (await db.query(`SELECT count(*) AS n FROM wholesale_order_items WHERE cogs_cost IS NOT NULL`)).rows[0].n == 0);
    const eb = await errOf(() => runSql(db, { basisArgs: ['Nope=3'] }));
    check('a basis naming no product is refused', /basis "Nope" matches 0 products/.test(eb), eb);
    const es = await errOf(() => runSql(db, { uStatuses: ['Shipped', 'Pending'] }));
    check('a U status that does not hold stock is refused', /"Pending" do not hold stock/.test(es), es);
    await db.query(`ALTER FUNCTION wp_internal.fifo_fallback_cost(TEXT) RENAME TO fifo_fallback_cost_hidden`);
    const ep = await errOf(() => runSql(db, {}));
    check('without phase 1 the run names the file to run first', /run migrations\/add_fifo_costing\.sql/.test(ep), ep);
    await db.query(`ALTER FUNCTION wp_internal.fifo_fallback_cost_hidden(TEXT) RENAME TO fifo_fallback_cost`);
    await db.query(`UPDATE sale_items SET cogs_cost = 1 WHERE id = 'l-h1'`);
    const ec = await errOf(() => runSql(db, {}));
    check('a line that already has a cogs_cost is refused (phase 3 live)', /already carry a FIFO cost/.test(ec), ec);
    await db.query(`UPDATE sale_items SET cogs_cost = NULL, cogs_booked = 1 WHERE id = 'l-h1'`);
    const ecb = await errOf(() => runSql(db, {}));
    check('a line that already has a cogs_booked is refused', /already carry a FIFO cost/.test(ecb), ecb);
    await db.query(`UPDATE sale_items SET cogs_booked = NULL WHERE id = 'l-h1'`);
    await db.exec(rebuildFn);
    const ep2 = await errOf(() => db.query(`SELECT pg_temp.fifo_rebuild_run('romdoul1')`));
    check('an unknown preset is refused and names the two presets', /pick a preset first.*"romdoul1".*romdoul1_trueup_2026_11_12.*default/.test(ep2), ep2);
    check('still nothing changed after every refusal', await snap() === s0);
}

// ===========================================================================
// 4. The guard edge (|D1 - (V - B)| = 1.00 passes) and the file as shipped
// ===========================================================================
for (const [offset, ok] of [[1, true], [-1.01, false]]) {
    const db = await makeDb();
    await db.query(`INSERT INTO products (id, name, stock, purchase_cost) VALUES ('g', 'G', 1, 5)`);
    await db.query(`INSERT INTO inventory_items (product_id, cost_of_purchase, status) VALUES ('g', 4, 'in_stock')`);
    const A = { inv: (await db.query(`SELECT id FROM chart_of_accounts WHERE account_code = '1300'`)).rows[0].id,
                eq: (await db.query(`SELECT id FROM chart_of_accounts WHERE account_code = '3000'`)).rows[0].id };
    await bookOpening(db, A, 5 + offset);
    const e = await errOf(() => runSql(db, {}));
    check(`guard edge: residual ${offset} ${ok ? 'passes' : 'is refused'}`, ok ? e === '' : /over \$1/.test(e), e);
}
{
    const db = await makeDb();
    // One product, pool 3 at 4 against stock 2 at purchase_cost 5: D1 = -2.
    await db.query(`INSERT INTO products (id, name, stock, purchase_cost) VALUES ('g', 'G', 2, 5)`);
    for (let i = 0; i < 3; i++) await db.query(`INSERT INTO inventory_items (product_id, cost_of_purchase, status) VALUES ('g', 4, 'in_stock')`);
    const A = { inv: (await db.query(`SELECT id FROM chart_of_accounts WHERE account_code = '1300'`)).rows[0].id,
                eq: (await db.query(`SELECT id FROM chart_of_accounts WHERE account_code = '3000'`)).rows[0].id };
    await bookOpening(db, A, 10);
    const ymd = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
    const e0 = await errOf(() => db.exec(rebuildFile));
    check('the file as shipped (no preset picked) refuses', /pick a preset first.*"CHOOSE_A_PRESET"/.test(e0), e0);
    await db.exec('ROLLBACK');
    check('...and changed nothing (no entry, no backup, no log table, 3 in stock)',
        (await db.query(`SELECT count(*) AS n FROM journal_entries WHERE reference_id LIKE 'FIFO-REVAL-%'`)).rows[0].n == 0
        && (await db.query(`SELECT to_regclass($1) AS t`, [`inventory_items_bak_${ymd}`])).rows[0].t === null
        && (await db.query(`SELECT to_regclass('public.fifo_rebuild_log') AS t`)).rows[0].t === null
        && (await db.query(`SELECT count(*) AS n FROM inventory_items WHERE status = 'in_stock'`)).rows[0].n == 3);
    const picked = rebuildFile.replace("set_config('fifo_rebuild.preset', 'CHOOSE_A_PRESET', true)", "set_config('fifo_rebuild.preset', 'default', true)");
    let results = null;
    const e = await errOf(async () => { results = await db.exec(picked); });
    check('the file with the default preset picked runs', e === '', e);
    const last = results ? results[results.length - 1].rows : [];
    const item = name => (last.find(r => r.item === name) || {}).value;
    check('its LAST statement returns the summary rows: preset, entry, D1, V, B, SU, guard diff, excluded, wholesale, anomalies',
        item('preset') === 'default' && num(item('D1')) === -2 && num(item('V')) === 8 && num(item('B')) === 10
        && num(item('SU (booked, goods on hand)')) === 0 && num(item('guard diff D1 - (V - SU - B - E)')) === 0 && num(item('E (overridden products since the basis entry)')) === 0
        && num(item('FIFO-REVAL amount D1 + E')) === -2 && item('E orders and adjustments') && Array.isArray(item('E orders and adjustments').subjects)
        && item('FIFO-REVAL entry') && item('FIFO-REVAL entry').reference_id === `FIFO-REVAL-${ymd}`
        && /^JE-\d+-MAN-\d{8}-\d{3}$/.test(item('FIFO-REVAL entry').entry_number)
        && item('excluded from U') && item('excluded from U').by_status && item('wholesale backfill') !== undefined && Array.isArray(item('anomalies')),
        last);
    check('the summary is kept in public.fifo_rebuild_log',
        (await db.query(`SELECT count(*) AS n FROM public.fifo_rebuild_log WHERE preset = 'default'`)).rows[0].n == 1);
    const je = (await db.query(`SELECT a.account_code AS code, l.debit, l.credit, e.status FROM journal_entries e
        JOIN journal_entry_lines l ON l.journal_entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
       WHERE e.reference_id = $1 ORDER BY a.account_code`, [`FIFO-REVAL-${ymd}`])).rows;
    check('as shipped: named after today in Cambodia; a negative D1 (-2) is Dr 5000 / Cr 1300, Draft',
        je.length === 2 && je[0].code === '1300' && num(je[0].credit) === 2 && je[1].code === '5000' && num(je[1].debit) === 2
        && je.every(r => r.status === 'Draft'), je);
    check('as shipped: the backup is committed', (await db.query(`SELECT to_regclass($1) AS t`, [`inventory_items_bak_${ymd}`])).rows[0].t !== null);
    check('as shipped: the pg_temp function leaves nothing in public or wp_internal',
        (await db.query(`SELECT count(*) AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE p.proname = 'fifo_rebuild_pool' AND n.nspname IN ('public', 'wp_internal')`)).rows[0].n == 0);
    const e2 = await errOf(() => db.exec(picked));
    check('as shipped: a second run is refused', /already exists/.test(e2), e2);
    await db.exec('ROLLBACK');
    check('as shipped: the refused run changed nothing (one entry, one log row, 2 in stock)',
        (await db.query(`SELECT count(*) AS n FROM journal_entries WHERE reference_id LIKE 'FIFO-REVAL-%'`)).rows[0].n == 1
        && (await db.query(`SELECT count(*) AS n FROM public.fifo_rebuild_log`)).rows[0].n == 1
        && (await db.query(`SELECT count(*) AS n FROM inventory_items WHERE status = 'in_stock'`)).rows[0].n == 2);
}

// ===========================================================================
// 5. E: an overridden basis (NR-3026 at 9.00, purchase_cost 9.30) and sales
//    booked at 9.30 after the basis entry (TRUEUP-20261112)
// ===========================================================================
// Final stock: pN 3 at 9.30 (one is SU1's, restocked) + UN's unit shipped
// unsettled; pX 2 at 4. Basis value of S+U = 4 x 9 + 2 x 4 = 44, D1 = 1.20.
// After the cutoff, each a unit booked at 9.30 against the 9.00 basis
// (8 units, E = 2.40): S1..S3 (one pN each), S4 (pN + pX, 13.30), R1
// (settled, reversed, settled again), ADJ (removes one pN), WSO (two pN).
// SU1 settled after the cutoff and restocked: in SU at its booked 9.30, so
// it adds nothing to E. P1 settled before the cutoff: not a subject. B is
// 44 - 9.30 (SU) - 2.40 (E) = 32.30.
// opt.trueup adds to the true-up's 1300 debit (goods the true-up counted that
// opt.more seeds); opt.more(ctx) adds rows (ctx: q, A, entry, txEntry, cogs,
// at, post).
async function seedE(db, extra = [], opt = {}) {
    const q = (s, p) => db.query(s, p);
    const at = h => `2026-11-12T${String(h).padStart(2, '0')}:00:00Z`;
    const post = m => `2026-11-13T01:${String(m).padStart(2, '0')}:00Z`;
    await q(`INSERT INTO products (id, name, price, stock, purchase_cost, is_active) VALUES
        ('pN', 'NR-3026', 20, 3, 9.3, true), ('pX', 'Other', 10, 2, 4, true)`);
    await q(`INSERT INTO sales (id, total, shipping_status, payment_status, date) VALUES
        ('S1', 20, 'Delivered', 'Paid', '${day(30)}'), ('S2', 20, 'Delivered', 'Paid', '${day(30)}'),
        ('S3', 20, 'Delivered', 'Paid', '${day(30)}'), ('S4', 30, 'Delivered', 'Paid', '${day(30)}'),
        ('R1', 20, 'Delivered', 'Paid', '${day(30)}'), ('SU1', 20, 'ReStock', 'Paid', '${day(30)}'),
        ('P1', 20, 'Delivered', 'Paid', '${day(30)}'), ('UN', 20, 'Shipped', 'Unpaid', '${day(30)}')`);
    await q(`INSERT INTO sale_items (id, sale_id, product_id, name, price, quantity) VALUES
        ('e-s1', 'S1', 'pN', 'x', 20, 1), ('e-s2', 'S2', 'pN', 'x', 20, 1), ('e-s3', 'S3', 'pN', 'x', 20, 1),
        ('e-s4n', 'S4', 'pN', 'x', 20, 1), ('e-s4x', 'S4', 'pX', 'x', 10, 1), ('e-r1', 'R1', 'pN', 'x', 20, 1),
        ('e-su1', 'SU1', 'pN', 'x', 20, 1), ('e-p1', 'P1', 'pN', 'x', 20, 1), ('e-un', 'UN', 'pN', 'x', 20, 1)`);
    for (let i = 1; i <= 4; i++) await q(`INSERT INTO inventory_items (id, product_id, cost_of_purchase, status, sale_id, received_at) VALUES ($1, 'pN', 9.3, $2, $3, $4)`,
        [L(2000 + i), i === 1 ? 'sold' : 'in_stock', i === 1 ? 'UN' : null, day(i)]);
    for (let i = 1; i <= 2; i++) await q(`INSERT INTO inventory_items (id, product_id, cost_of_purchase, status, received_at) VALUES ($1, 'pX', 4, 'in_stock', $2)`, [L(2100 + i), day(i)]);
    const acc = async c => (await q(`SELECT id FROM chart_of_accounts WHERE account_code = $1`, [c])).rows[0].id;
    const A = { inv: await acc('1300'), cogs: await acc('5000'), eq: await acc('3000') };
    const entry = async (ref, created, lines) => {
        const id = (await q(`INSERT INTO journal_entries (description, reference_id, status, date, created_at) VALUES ($1, $1, 'Draft', '2026-11-12', $2) RETURNING id`, [ref, created])).rows[0].id;
        for (const [a, dr, cr] of lines) await q(`INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, $4)`, [id, a, dr, cr]);
    };
    const cogs = (amt) => [[A.cogs, amt, 0], [A.inv, 0, amt]];
    const txEntry = async (order, created, amt) => {
        const tx = (await q(`INSERT INTO transactions (type, amount, order_id) VALUES ('Income', 20, $1) RETURNING id`, [order])).rows[0].id;
        await entry(`TX-${tx}`, created, cogs(amt));
    };
    await txEntry('P1', at(10), 9);
    const tu = 129 + (opt.trueup || 0);
    await entry('TRUEUP-20261112', '2026-11-12T14:51:05.206569Z', [[A.inv, tu, 0], [A.eq, 0, tu]]);
    await txEntry('S1', post(1), 9.3);
    await txEntry('S2', post(2), 9.3);
    await txEntry('S3', post(3), 9.3);
    await txEntry('S4', post(4), 13.3);
    await txEntry('R1', post(5), 9.3);
    await entry('ORD-R1-COGS-REV', post(6), [[A.inv, 9.3, 0], [A.cogs, 0, 9.3]]);
    await entry('ORD-R1-COGS', post(7), cogs(9.3));
    await txEntry('SU1', post(8), 9.3);
    const adj = (await q(`INSERT INTO stock_adjustments (reason, status) VALUES ('Loss/Damage', 'Posted') RETURNING id::text AS id`)).rows[0].id;
    await q(`INSERT INTO stock_adjustment_lines (adjustment_id, product_id, quantity, unit_cost) VALUES ($1, 'pN', -1, 9.3)`, [adj]);
    await entry(`ADJ-${adj}`, post(9), cogs(9.3));
    await q(`INSERT INTO wholesale_orders (id, customer_name, status) VALUES ('${W(7)}', 'Shop 7', 'Delivered')`);
    await q(`INSERT INTO wholesale_order_items (id, wholesale_order_id, product_id, quantity, unit_price) VALUES ('${L(2201)}', '${W(7)}', 'pN', 2, 15)`);
    await entry(`WSO-${W(7)}-COGS`, post(10), cogs(18.6));
    for (const [ref, amt] of extra) await entry(ref, post(20), amt > 0 ? [[A.eq, amt, 0], [A.inv, 0, amt]] : [[A.inv, -amt, 0], [A.eq, 0, -amt]]);
    if (opt.more) await opt.more({ q, A, entry, txEntry, cogs, at, post });
    return { A, adj };
}
const optsE = { basisArgs: ['NR-3026=9'], basisRef: 'TRUEUP-20261112' };
{
    const db = await makeDb();
    const { adj } = await seedE(db);
    const plan = await jsPlan(db, optsE);
    const L5 = plan.ledger;
    check('E: dry run D1 1.20, SU 9.30, B 32.30, E 2.40 = 0.30 x 8 units, guard 0, REVAL D1 + E = 3.60',
        near(L5.D1, 1.2, 1e-6) && near(L5.settled_unshipped_booked, 9.3, 1e-6) && near(L5.B, 32.3, 1e-6) && near(L5.E, 2.4, 1e-6)
        && near(L5.guard_diff, 0, 1e-6) && L5.guard_pass && near(L5.reval_amount, 3.6, 1e-6) && near(L5.expected_B, 32.3, 1e-6), L5);
    const sub = new Map(plan.basis_sales.subjects.map(x => [x.id, x]));
    check('E: one subject per order / adjustment with an overridden line and a post-cutoff 1300 entry (P1 and UN are not)',
        JSON.stringify(plan.basis_sales.subjects.map(x => x.kind + ':' + x.id))
        === JSON.stringify(['adjustment:' + adj, 'retail:R1', 'retail:S1', 'retail:S2', 'retail:S3', 'retail:S4', 'retail:SU1', 'wholesale:' + W(7)]),
        plan.basis_sales.subjects);
    check('E: S1 9.30 booked - 9.00 basis = 0.30 from the ledger; S4 mixes pX: only its pN line, 1 x (9.30 - 9.00) = 0.30',
        near(sub.get('S1').E, 0.3, 1e-6) && sub.get('S1').source === 'ledger' && sub.get('S1').direction === 1
        && near(sub.get('S4').E, 0.3, 1e-6) && sub.get('S4').source === 'cost difference (mixed)' && near(sub.get('S4').cost_excess, 0.3, 1e-6));
    check('E: R1 settled, reversed and settled again after the cutoff counts once (0.30)',
        near(sub.get('R1').booked_after_cutoff, 9.3, 1e-6) && near(sub.get('R1').E, 0.3, 1e-6) && sub.get('R1').refs.length === 3);
    check('E: SU1 (in SU at its booked 9.30) adds 0', near(sub.get('SU1').E, 0, 1e-6) && /SU/.test(sub.get('SU1').note));
    check('E: the stock adjustment removing one unit at 9.30 adds 0.30, the wholesale order of two 0.60',
        near(sub.get(adj).E, 0.3, 1e-6) && near(sub.get(W(7)).E, 0.6, 1e-6));
    check('E: the residual breakdown names E and leaves nothing unexplained',
        near(plan.residual.basis_sales_E, 2.4, 1e-6) && near(plan.residual.unexplained, 0, 1e-6), plan.residual);
    const plain = await jsPlan(db, { basisArgs: ['NR-3026=9'] });
    check('E: without the basis entry the same store fails the guard by -2.40 (the old behaviour)',
        near(plain.ledger.E, 0) && near(plain.ledger.guard_diff, -2.4, 1e-6) && !plain.ledger.guard_pass, plain.ledger);
    const res = await runSql(db, optsE);
    await compare(db, 'E', plan, res);
    check('E: SQL E 2.40, guard 0, REVAL amount 3.60 in the summary and the cutoff from TRUEUP-20261112',
        near(res.ledger.E, 2.4) && near(res.ledger.guard_diff, 0) && near(res.ledger.reval_amount, 3.6)
        && res.basis_sales.basis_ref === 'TRUEUP-20261112' && /^2026-11-12T14:51:05\.206569/.test(String(res.basis_sales.cutoff)), res);
    check('E: the FIFO-REVAL entry books D1 + E = 3.60 Dr 1300 / Cr 5000',
        res.entry && near(res.entry.amount, 3.6) && res.entry.debit === '1300' && res.entry.credit === '5000', res.entry);
    const chk = (await db.query(`SELECT wp_internal.fifo_inventory_check() AS j`)).rows[0].j;
    check('E: after the rebuild fifo_inventory_check variance 0 (1300 = V - SU)', near(chk.variance, 0, 1e-6) && chk.product_mismatches === 0, chk);
}
{
    // An unexplained 2.00 taken out of 1300 after the cutoff still fails.
    const db = await makeDb();
    await seedE(db, [['MANUAL-WRITEOFF', 2]]);
    const plan = await jsPlan(db, optsE);
    check('E negative: the dry run fails the guard by -2.00 with E still 2.40',
        !plan.ledger.guard_pass && near(plan.ledger.guard_diff, -2, 1e-6) && near(plan.ledger.E, 2.4, 1e-6), plan.ledger);
    const e = await errOf(() => runSql(db, optsE));
    check('E negative: the SQL raises, naming E', /stopped, nothing was changed/.test(e) && e.includes('E 2.40') && e.includes('B 30.30'), e);
    check('E negative: nothing booked', (await db.query(`SELECT count(*) AS n FROM journal_entries WHERE reference_id LIKE 'FIFO-REVAL-%'`)).rows[0].n == 0);
}
{
    // The Romdoul1 preset runner passes the true-up as the basis entry.
    const db = await makeDb();
    await seedE(db);
    await db.exec(rebuildFn);
    const r = (await db.query(`SELECT pg_temp.fifo_rebuild_run('romdoul1_trueup_2026_11_12') AS j`)).rows[0].j;
    check('E: the romdoul1_trueup_2026_11_12 preset finds TRUEUP-20261112, E 2.40, guard 0, REVAL 3.60',
        r.preset === 'romdoul1_trueup_2026_11_12' && r.basis_sales.basis_ref === 'TRUEUP-20261112' && near(r.ledger.E, 2.4)
        && near(r.ledger.guard_diff, 0) && near(r.entry.amount, 3.6) && r.options.basis_ref === 'TRUEUP-20261112'
        && r.options.u_returned_after_basis === true && num(r.u_returned_after_basis.orders) === 0, r.ledger);
}
{
    // The basis entry must exist exactly once.
    const db = await makeDb();
    await seedE(db);
    const e0 = await errOf(() => runSql(db, { ...optsE, basisRef: 'TRUEUP-NOPE' }));
    check('E: a basis entry that is not there is refused', /the basis entry TRUEUP-NOPE matches 0 journal entries/.test(e0), e0);
    await db.query(`INSERT INTO journal_entries (description, reference_id, status, date) VALUES ('dup', 'TRUEUP-20261112', 'Draft', '2026-11-12')`);
    const e2 = await errOf(() => runSql(db, optsE));
    check('E: a basis entry that is there twice is refused', /the basis entry TRUEUP-20261112 matches 2 journal entries/.test(e2), e2);
    const j2 = await errOf(() => jsPlan(db, optsE));
    check('E: ...and the dry run refuses it too', /matches 2 journal entries/.test(j2), j2);
}

// ===========================================================================
// 6. E only explains the overridden lines' cost difference; REV / ADJ net
//    into the booked amount; Returned orders the true-up still counted
// ===========================================================================
// S5: a mixed order (1 pN + 2 pY, pY has no stock), booked 9.30 + 2 x 5 after
// the cutoff; the true-up counted its goods (+19).
const seedMixed = async ({ q, txEntry, post }) => {
    await q(`INSERT INTO products (id, name, price, stock, purchase_cost, is_active) VALUES ('pY', 'Other Y', 10, 0, 5, true)`);
    await q(`INSERT INTO sales (id, total, shipping_status, payment_status, date) VALUES ('S5', 40, 'Delivered', 'Paid', '${day(30)}')`);
    await q(`INSERT INTO sale_items (id, sale_id, product_id, name, price, quantity) VALUES
        ('e-s5n', 'S5', 'pN', 'x', 20, 1), ('e-s5y', 'S5', 'pY', 'x', 10, 2)`);
    await txEntry('S5', post(31), 19.3);
};
{
    // Balanced: S5 (mixed, +0.30), BK (settled at 9.30 before the cutoff,
    // reversed after it and restocked: -0.30, not SU), RV (shipped unsettled
    // at the true-up, settled and reversed after it, Returned and Unpaid
    // again: in U, 0), P1 (settled at 9.00 before the cutoff, re-costed to
    // 9.30 after it: +0.30). E = 2.40 + 0.30 - 0.30 + 0 + 0.30 = 2.70.
    // Final pN: stock 4 (BK's unit back) + U 2 (UN, RV) at 9.30, pX 2 at 4:
    // V 63.80, basis 62, D1 1.80. True-up +19 (S5) + 9 (RV) + 9.30 (BK's
    // pre-cutoff COGS, which the true-up absorbed): B 50.00 = 62 - 9.30 - 2.70.
    const db = await makeDb();
    await seedE(db, [], { trueup: 37.3, more: async (ctx) => {
        const { q, A, entry, txEntry, cogs, at, post } = ctx;
        await seedMixed(ctx);
        await q(`INSERT INTO sales (id, total, shipping_status, payment_status, date) VALUES
            ('BK', 20, 'ReStock', 'Paid', '${day(30)}'), ('RV', 20, 'Returned', 'Unpaid', '${day(30)}')`);
        await q(`INSERT INTO sale_items (id, sale_id, product_id, name, price, quantity) VALUES ('e-bk', 'BK', 'pN', 'x', 20, 1), ('e-rv', 'RV', 'pN', 'x', 20, 1)`);
        await txEntry('BK', at(11), 9.3);
        await entry('ORD-BK-COGS-REV', post(32), [[A.inv, 9.3, 0], [A.cogs, 0, 9.3]]);
        await q(`UPDATE products SET stock = stock + 1 WHERE id = 'pN'`);
        await q(`INSERT INTO inventory_items (id, product_id, cost_of_purchase, status, received_at) VALUES ($1, 'pN', 9.3, 'in_stock', '2026-11-13T01:32:00Z')`, [L(2301)]);
        await q(`INSERT INTO inventory_items (id, product_id, cost_of_purchase, status, sale_id, received_at) VALUES ($1, 'pN', 9.3, 'sold', 'RV', $2)`, [L(2302), day(5)]);
        await txEntry('RV', post(33), 9.3);
        await entry('ORD-RV-COGS-REV', post(34), [[A.inv, 9.3, 0], [A.cogs, 0, 9.3]]);
        await entry('ORD-P1-COGS-ADJ', post(35), cogs(0.3));
    } });
    const plan = await jsPlan(db, optsE);
    const L6 = plan.ledger;
    const sub = new Map(plan.basis_sales.subjects.map(x => [x.id, x]));
    check('E probes: E 2.70, SU 9.30 (BK left out), B 50.00, D1 1.80, guard 0, REVAL 4.50',
        near(L6.E, 2.7, 1e-6) && near(L6.settled_unshipped_booked, 9.3, 1e-6) && near(L6.B, 50, 1e-6) && near(L6.D1, 1.8, 1e-6)
        && near(L6.guard_diff, 0, 1e-6) && near(L6.reval_amount, 4.5, 1e-6), L6);
    check('E probes: a mixed order counts only its NR-3026 line (0.30, not 19.30 - 19.00 read through pY)',
        near(sub.get('S5').E, 0.3, 1e-6) && sub.get('S5').source === 'cost difference (mixed)', sub.get('S5'));
    check('E probes: settled before the cutoff and reversed after it: -0.30, and not in SU (the REV un-books it)',
        near(sub.get('BK').E, -0.3, 1e-6) && sub.get('BK').direction === -1 && sub.get('BK').source === 'ledger'
        && !plan.settled_unshipped.some(o => o.order_id === 'BK'), sub.get('BK'));
    check('E probes: settled and reversed after the cutoff, still Returned and unpaid: back in U, E 0',
        near(sub.get('RV').E, 0, 1e-6) && plan.linePlan.some(l => l.order_id === 'RV'), sub.get('RV'));
    check('E probes: re-costed from 9.00 to 9.30 after the cutoff (held throughout): 0.30 from the ledger',
        near(sub.get('P1').E, 0.3, 1e-6) && sub.get('P1').direction === 0 && sub.get('P1').source === 'ledger', sub.get('P1'));
    // The other product's cost changes after S5 was booked: E does not move.
    await db.query(`UPDATE products SET purchase_cost = 6 WHERE id = 'pY'`);
    const plan2 = await jsPlan(db, optsE);
    check('E probes: pY purchase_cost 5 -> 6 after the sale: S5 still 0.30, guard still 0',
        near(plan2.ledger.E, 2.7, 1e-6) && near(plan2.ledger.guard_diff, 0, 1e-6), plan2.ledger);
    const res = await runSql(db, optsE);
    await compare(db, 'E probes', plan2, res);
    const chk = (await db.query(`SELECT wp_internal.fifo_inventory_check() AS j`)).rows[0].j;
    check('E probes: after the rebuild fifo_inventory_check variance 0', near(chk.variance, 0, 1e-6) && chk.product_mismatches === 0, chk);
}
{
    // Not absorbed: a duplicate ORD-S1-COGS (9.30) on top of S1's receipt,
    // and P1 re-costed by 3.00 (beyond purchase_cost) after the cutoff.
    const db = await makeDb();
    await seedE(db, [], { more: async ({ entry, cogs, post }) => {
        await entry('ORD-S1-COGS', post(36), cogs(9.3));
        await entry('ORD-P1-COGS-ADJ', post(37), cogs(3));
    } });
    const plan = await jsPlan(db, optsE);
    const sub = new Map(plan.basis_sales.subjects.map(x => [x.id, x]));
    check('E negative: a duplicate COGS entry stays out of E (S1 0.30, its ledger 9.60 not used): guard -12.30',
        near(plan.ledger.E, 2.4, 1e-6) && near(sub.get('S1').E, 0.3, 1e-6) && near(sub.get('S1').ledger_excess, 9.6, 1e-6)
        && sub.get('S1').source === 'cost difference (ledger outside basis..cost)'
        && near(plan.ledger.guard_diff, -12.3, 1e-6) && !plan.ledger.guard_pass, { L: plan.ledger, S1: sub.get('S1') });
    check('E negative: a re-cost beyond purchase_cost on an order held throughout adds 0',
        near(sub.get('P1').E, 0, 1e-6) && near(sub.get('P1').ledger_excess, 3, 1e-6), sub.get('P1'));
    const e = await errOf(() => runSql(db, optsE));
    check('E negative: the SQL raises with the same E (2.40)', /stopped, nothing was changed/.test(e) && e.includes('E 2.40'), e);
}
{
    // Not masked: pY's cost drops 5 -> 4 after S5 was booked, and 2.00 is
    // written off 1300 with no reason. The guard shows the 2.00.
    const db = await makeDb();
    await seedE(db, [['MANUAL-WRITEOFF', 2]], { trueup: 19, more: seedMixed });
    await db.query(`UPDATE products SET purchase_cost = 4 WHERE id = 'pY'`);
    const plan = await jsPlan(db, optsE);
    check('E negative: a mixed order whose other product got cheaper does not hide a 2.00 write-off (E 2.70, guard -2.00)',
        near(plan.ledger.E, 2.7, 1e-6) && near(plan.ledger.guard_diff, -2, 1e-6) && !plan.ledger.guard_pass, plan.ledger);
    const e = await errOf(() => runSql(db, optsE));
    check('E negative: ...and the SQL raises', /stopped, nothing was changed/.test(e) && e.includes('E 2.70'), e);
}
{
    // Returned orders and the true-up (U = Shipped / Delivered):
    //   RA shipped at the true-up (counted in U), Returned after it, not
    //      restocked -> kept in U;
    //   RN created after the true-up (its goods were in S), shipped and
    //      Returned -> kept in U;
    //   RB already Returned at the true-up (not counted) -> left out;
    //   RD shipped at the true-up, Returned after it, but restocked (an 'in'
    //      movement, its unit is back in S) -> left out.
    // True-up +9 (RA) + 9 (RD) + 9 (RN): B 59.30 = (7 x 9 + 8) - 9.30 - 2.40.
    const optsR = { basisArgs: ['NR-3026=9'], basisRef: 'TRUEUP-20261112', uStatuses: ['Shipped', 'Delivered'], uFrom: '2026-10-21', uReturnedAfterBasis: true };
    const db = await makeDb();
    await seedE(db, [], { trueup: 27, more: async ({ q, at, post }) => {
        await q(`INSERT INTO sales (id, total, shipping_status, payment_status, date, created_at, last_edited_at) VALUES
            ('RA', 20, 'Returned', 'Unpaid', '${day(30)}', '${at(1)}', '${post(40)}'),
            ('RB', 20, 'Returned', 'Unpaid', '${day(30)}', '${at(1)}', '${at(5)}'),
            ('RD', 20, 'Returned', 'Unpaid', '${day(30)}', '${at(1)}', '${post(41)}'),
            ('RN', 20, 'Returned', 'Unpaid', '${day(30)}', '${post(42)}', '${post(43)}')`);
        await q(`INSERT INTO sale_items (id, sale_id, product_id, name, price, quantity) VALUES
            ('e-ra', 'RA', 'pN', 'x', 20, 1), ('e-rb', 'RB', 'pN', 'x', 20, 1), ('e-rd', 'RD', 'pN', 'x', 20, 1), ('e-rn', 'RN', 'pN', 'x', 20, 1)`);
        const log = (id, status, t) => q(`INSERT INTO activity_logs (action, description, metadata, created_at) VALUES ('order_status', 'x', $1::jsonb, $2)`,
            [JSON.stringify(status ? { orderId: id, status } : { orderId: id }), t]);
        await log('RA', 'Confirmed', at(2)); await log('RA', 'Shipped', at(3)); await log('RA', null, at(4)); await log('RA', 'Returned', post(40));
        await log('RB', 'Shipped', at(2)); await log('RB', 'Returned', at(5));
        await log('RD', 'Shipped', at(3)); await log('RD', 'Returned', post(41));
        await log('RN', 'Shipped', post(42)); await log('RN', 'Returned', post(43));
        for (const [n, sid, d] of [[2401, 'RA', 6], [2402, 'RB', 7], [2404, 'RN', 8]]) {
            await q(`INSERT INTO inventory_items (id, product_id, cost_of_purchase, status, sale_id, received_at) VALUES ($1, 'pN', 9.3, 'sold', $2, $3)`, [L(n), sid, day(d)]);
        }
        await q(`INSERT INTO inventory_items (id, product_id, cost_of_purchase, status, received_at) VALUES ($1, 'pN', 9.3, 'in_stock', '2026-11-13T01:41:00Z')`, [L(2403)]);
        await q(`UPDATE products SET stock = stock + 1 WHERE id = 'pN'`);
        await q(`INSERT INTO stock_movements (product_id, product_name, type, quantity, reference_id, created_at) VALUES ('pN', 'x', 'in', 1, 'RD', '${post(41)}')`);
    } });
    const plan = await jsPlan(db, optsR);
    const RA = plan.u_returned_after_basis;
    check('Returned after the basis entry: RA (was Shipped) and RN (created after it) kept in U, guard 0',
        near(plan.ledger.guard_diff, 0, 1e-6) && plan.ledger.guard_pass && RA.orders === 2 && near(RA.basis_value, 18, 1e-6)
        && JSON.stringify(RA.list.map(k => [k.order_id, k.status_at_cutoff])) === '[["RA","Shipped"],["RN","created after the basis entry"]]', { L: plan.ledger, RA });
    check('Returned after the basis entry: RB (Returned at the true-up) and RD (restocked) stay out of U',
        JSON.stringify(plan.excluded_from_u.by_status.order_ids) === '["RB","RD"]' && plan.totals.U === 3, plan.excluded_from_u);
    const off = await jsPlan(db, { ...optsR, uReturnedAfterBasis: false });
    check('Returned after the basis entry: without the option the guard fails by +18.00 (their basis value)',
        near(off.ledger.guard_diff, 18, 1e-6) && !off.ledger.guard_pass, off.ledger);
    const eNo = await errOf(() => runSql(db, { uReturnedAfterBasis: true }));
    check('Returned after the basis entry: the option without a basis entry is refused', /needs the basis entry/.test(eNo), eNo);
    const jNo = await errOf(() => jsPlan(db, { uReturnedAfterBasis: true }));
    check('Returned after the basis entry: ...and the dry run refuses it too', /needs a basis entry/.test(jNo), jNo);
    const res = await runSql(db, optsR);
    await compare(db, 'Returned after the basis entry', plan, res);
    const lu = new Map((await db.query(`SELECT id, cogs_cost FROM sale_items WHERE id IN ('e-ra', 'e-rn', 'e-rb', 'e-rd')`)).rows.map(r => [r.id, r]));
    check('Returned after the basis entry: RA / RN lines hold their layer (9.30), RB / RD none',
        near(lu.get('e-ra').cogs_cost, 9.3) && near(lu.get('e-rn').cogs_cost, 9.3) && lu.get('e-rb').cogs_cost === null && lu.get('e-rd').cogs_cost === null, [...lu.values()]);
    const chk = (await db.query(`SELECT wp_internal.fifo_inventory_check() AS j`)).rows[0].j;
    check('Returned after the basis entry: after the rebuild fifo_inventory_check variance 0', near(chk.variance, 0, 1e-6) && chk.product_mismatches === 0, chk);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
