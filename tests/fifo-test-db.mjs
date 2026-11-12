// Shared PGlite store for the FIFO phase 3 tests (fifo-orders,
// fifo-wholesale, fifo-adjustment): the real stack in deploy order —
// full_schema.sql, auth guards, add_fifo_costing.sql, the four packs
// (wired to FIFO), add_session_guards.sql — plus seeding helpers and the
// FIFO health check every test asserts. Not a test itself.
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const { PGlite } = await import(process.env.PGLITE_DIST || '@electric-sql/pglite');

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const mig = f => path.join(repo, 'migrations', f);
export const strip = f => fs.readFileSync(f, 'utf8').replace(/NOTIFY[^;]*;/g, '');

export async function makeDb() {
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
                     'add_fifo_costing.sql',
                     'add_wholesale_procurement_functions.sql',
                     'add_order_status_function.sql', 'add_order_payment_functions.sql',
                     'add_stock_adjustment_posting.sql',
                     'add_config_functions.sql', 'add_session_guards.sql']) {
        await db.exec(strip(mig(f)));
    }
    return db;
}

export function harness(db) {
    let pass = 0, fail = 0;
    const q = (s, p) => db.query(s, p);
    const one = async (s, p) => (await q(s, p)).rows[0];
    const num = v => Number(v);
    const near = (a, b, eps = 0.0001) => Math.abs(num(a) - num(b)) < eps;
    const check = (label, cond, extra) => {
        if (cond) { pass++; console.log('PASS', label); }
        else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); }
    };
    const errOf = async (sql, params) => {
        try { await q(sql, params); return ''; } catch (e) { return String(e.message || e); }
    };
    const acct = async code => (await one(`SELECT id FROM chart_of_accounts WHERE account_code = $1`, [code])).id;

    // Layers of a product at a cost, received at a given time, and the
    // matching products.stock / opening 1300 entry (Posted, against 3000)
    // so the FIFO check starts at variance 0.
    const seedLayers = async (product, qty, cost, receivedAt, ref = 'OPEN') => {
        await q(`SELECT wp_internal.fifo_add_layers($1, $2, $3, $4::timestamptz, $5)`, [product, qty, cost, receivedAt, ref]);
        await q(`UPDATE products SET stock = COALESCE(stock, 0) + $2 WHERE id = $1`, [product, qty]);
        await bookOpening(qty * cost);
    };
    const bookOpening = async amount => {
        const je = (await one(`INSERT INTO journal_entries (description, reference_id, status, date)
                               VALUES ('Opening stock', 'OPENING-INV', 'Posted', '2026-01-01') RETURNING id`)).id;
        await q(`INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0), ($1, $4, 0, $3)`,
            [je, await acct('1300'), amount, await acct('3000')]);
    };
    const fifoCheck = async () => (await one(`SELECT wp_internal.fifo_inventory_check() AS j`)).j;
    // The identity every phase 3 path must keep: 1300 = pool + shipped
    // unbooked - booked unshipped + (shipped - booked), and pool count =
    // stock for every product.
    const checkBalanced = async (label, variance = 0) => {
        const c = await fifoCheck();
        check(`${label}: FIFO check variance ${variance.toFixed(2)}, pool = stock`,
            near(c.variance, variance, 0.006) && c.product_mismatches === 0, c);
        return c;
    };
    const entries = async like => (await q(`
        SELECT e.reference_id AS ref, COALESCE(e.status, 'Posted') AS status, e.entry_number,
               COALESCE(sum(l.debit) FILTER (WHERE a.account_code = '5000'), 0)
             - COALESCE(sum(l.credit) FILTER (WHERE a.account_code = '5000'), 0) AS cogs,
               COALESCE(sum(l.credit) FILTER (WHERE a.account_code = '1300'), 0)
             - COALESCE(sum(l.debit) FILTER (WHERE a.account_code = '1300'), 0) AS inv_out
          FROM journal_entries e
          LEFT JOIN journal_entry_lines l ON l.journal_entry_id = e.id
          LEFT JOIN chart_of_accounts a ON a.id = l.account_id
         WHERE e.reference_id LIKE $1
         GROUP BY e.id, e.reference_id, e.status, e.entry_number, e.created_at
         ORDER BY e.created_at, e.id`, [like])).rows;
    const done = () => {
        console.log(`\n${pass} passed, ${fail} failed`);
        process.exit(fail ? 1 : 0);
    };
    return { q, one, num, near, check, errOf, acct, seedLayers, bookOpening, fifoCheck, checkBalanced, entries, done };
}
