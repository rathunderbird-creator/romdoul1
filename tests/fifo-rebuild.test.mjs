// PGlite test of migrations/fifo_rebuild_pool.sql (FIFO phase 2): the
// one-time pool rebuild and the Draft FIFO-REVAL entry, on top of the real
// stack — full_schema.sql, auth guards, the packs, add_session_guards.sql and
// add_fifo_costing.sql. One seeded store carries every drift case (pool
// larger / smaller than stock, no rows, cost-0 rows, sold rows on Pending /
// ReStock orders, null sale_id, returned rows, settled and COGS-booked
// history, unsettled shipped lines, a fractional line, Returned and pre-cutoff
// orders, an inactive product, a fractional stock, open / cancelled wholesale
// orders). Each case is checked against the SQL result, and the SQL result
// is compared with src/scripts/fifo-rebuild-dryrun.cjs (buildInput +
// planStore) on the same rows — totals, ledger numbers, every row, every
// filler and every line — with the default options and with the Romdoul1
// true-up options. Then the D1 guard, the refusals (run once, phase 1
// missing, bad options) and the file run as shipped (BEGIN ... COMMIT).
// See tests/README.md for how to run it.
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

const { PGlite } = await import(process.env.PGLITE_DIST || '@electric-sql/pglite');
const require = createRequire(import.meta.url);
const { planStore, buildInput } = require('../src/scripts/fifo-rebuild-dryrun.cjs');

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
check('the file has one RUN block and a COMMIT', rebuildFile.includes('-- >>> RUN') && rebuildFile.includes('-- <<< RUN')
    && /COMMIT;\s*$/.test(rebuildFile));

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
        ('U4', 1, 'Shipped', 'COD', '${day(26)}')`);
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
        ('l-u4', 'U4', 'pC', 'x', 1, 1)`);
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
        sales: await rows(`SELECT id, shipping_status, payment_status, ${iso('date')} AS date FROM sales`),
        saleItems: await rows(`SELECT id, sale_id, product_id, quantity FROM sale_items`),
        accounts: await rows(`SELECT id::text AS id, account_code, account_name FROM chart_of_accounts`),
        entries: await rows(`SELECT id::text AS id, reference_id, status, date::text AS date FROM journal_entries`),
        lines: await rows(`SELECT id::text AS id, journal_entry_id::text AS journal_entry_id, account_id::text AS account_id, debit, credit FROM journal_entry_lines`),
        txs: await rows(`SELECT id::text AS id, order_id FROM transactions WHERE order_id IS NOT NULL`),
        moves: await rows(`SELECT reference_id, type, ${iso('created_at')} AS created_at FROM stock_movements`),
        restocks: await rows(`SELECT id::text AS id, product_id, cost, ${iso('date')} AS date FROM restocks`),
        purchaseOrders: await rows(`SELECT id::text AS id, status FROM purchase_orders`),
        poItems: await rows(`SELECT id::text AS id, purchase_order_id::text AS purchase_order_id, product_id, unit_price, ${iso('created_at')} AS created_at FROM purchase_order_items`),
    };
}
const jsPlan = async (db, opts) => {
    const { input } = buildInput(await readRaw(db), opts.basisArgs || [], { uStatuses: opts.uStatuses ? new Set(opts.uStatuses) : undefined, uFrom: opts.uFrom });
    return planStore(input);
};
const runSql = async (db, opts) => {
    await db.exec(rebuildFn);
    const basis = Object.fromEntries((opts.basisArgs || []).map(s => { const [k, v] = s.split('='); return [k, Number(v)]; }));
    return (await db.query(`SELECT pg_temp.fifo_rebuild_pool($1::jsonb, $2::text[], $3::date, $4::date) AS j`,
        [JSON.stringify(basis), opts.uStatuses || null, opts.uFrom || null, '2026-11-13'])).rows[0].j;
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
    for (const k of ['V_in_stock', 'V_unsettled', 'V', 'B', 'V_minus_B', 'basis_value_S_plus_U', 'D1', 'guard_diff_D1_minus_VminusB']) {
        check(`${tag}: SQL ${k} = dry run (${plan.ledger[k]})`, near(res.ledger[k], plan.ledger[k], 0.001), { sql: res.ledger[k], js: plan.ledger[k] });
    }
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
    await bookOpening(db, A, Math.round((before.ledger.basis_value_S_plus_U - before.ledger.B + 0.4) * 100) / 100);
    const plan = await jsPlan(db, {});
    check('defaults: the dry run passes the guard on the seeded store', plan.ledger.guard_pass && near(plan.ledger.guard_diff_D1_minus_VminusB, 0.4, 1e-6), plan.ledger);
    const rowsBefore = num((await db.query(`SELECT count(*) AS n FROM inventory_items`)).rows[0].n);
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
    // Wholesale backfill.
    const wl = new Map((await q(`SELECT id::text AS id, cogs_cost, cogs_short_qty FROM wholesale_order_items`)).map(r => [r.id, r]));
    check('wholesale W1: Posted COGS 9 allocated by purchase_cost x qty (6 : 10) = 3.375 / 5.625, all short',
        num(wl.get(L(9201)).cogs_cost) === 3.375 && num(wl.get(L(9202)).cogs_cost) === 5.625
        && num(wl.get(L(9201)).cogs_short_qty) === 2 && num(wl.get(L(9202)).cogs_short_qty) === 1, [...wl.values()]);
    check('wholesale W2 (Cancelled) untouched', wl.get(L(9203)).cogs_cost === null && num(wl.get(L(9203)).cogs_short_qty) === 0);
    check('wholesale W3 (no COGS entry): cogs_cost 0, qty short', num(wl.get(L(9204)).cogs_cost) === 0 && num(wl.get(L(9204)).cogs_short_qty) === 1);
    check('wholesale W4 (purchase_cost 0): allocated by qty, 8 -> 2 / 6', num(wl.get(L(9205)).cogs_cost) === 2 && num(wl.get(L(9206)).cogs_cost) === 6);
    check('wholesale summary', num(res.wholesale_backfill.lines) === 5 && num(res.wholesale_backfill.cogs_cost) === 17, res.wholesale_backfill);
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
    await bookOpening(db, A, Math.round((before.ledger.basis_value_S_plus_U - before.ledger.B) * 100) / 100);
    const plan = await jsPlan(db, opts);
    check('true-up options: the dry run guard residual is 0', near(plan.ledger.guard_diff_D1_minus_VminusB, 0, 1e-6), plan.ledger);
    const res = await runSql(db, opts);
    await compare(db, 'true-up options', plan, res);
    const lu = new Map((await db.query(`SELECT id, cogs_cost FROM sale_items WHERE id LIKE 'l-u%'`)).rows.map(r => [r.id, r]));
    check('true-up options: Returned U2 and pre-cutoff U3 are left out of U', lu.get('l-u2').cogs_cost === null && lu.get('l-u3').cogs_cost === null);
    check('true-up options: U = U1 (2) + U4 (1)', num(res.totals.U) === 3);
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
    await bookOpening(db, A, Math.round((before.ledger.basis_value_S_plus_U - before.ledger.B + 5) * 100) / 100);
    const plan = await jsPlan(db, {});
    check('guard: the dry run fails it (B 5 over the basis value)', !plan.ledger.guard_pass);
    const snap = async () => JSON.stringify((await db.query(`SELECT id, status, cost_of_purchase, sale_id, consumer_kind FROM inventory_items ORDER BY id`)).rows);
    const s0 = await snap();
    const e = await errOf(() => runSql(db, {}));
    check('guard: the SQL raises with D1, V - B, V and B', /FIFO rebuild stopped, nothing was changed: D1 = -?[\d.]+ but V - B = -?[\d.]+ \(V [\d.]+, B [\d.]+/.test(e)
        && e.includes(`D1 = ${plan.ledger.D1.toFixed(2)}`) && e.includes(`V ${plan.ledger.V.toFixed(2)}`), e);
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
    const e = await errOf(() => db.exec(rebuildFile));
    check('the file as shipped (BEGIN, defaults, COMMIT) runs', e === '', e);
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
    const e2 = await errOf(() => db.exec(rebuildFile));
    check('as shipped: a second run is refused', /already exists/.test(e2), e2);
    await db.exec('ROLLBACK');
    check('as shipped: the refused run changed nothing (one entry, 2 in stock)',
        (await db.query(`SELECT count(*) AS n FROM journal_entries WHERE reference_id LIKE 'FIFO-REVAL-%'`)).rows[0].n == 1
        && (await db.query(`SELECT count(*) AS n FROM inventory_items WHERE status = 'in_stock'`)).rows[0].n == 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
