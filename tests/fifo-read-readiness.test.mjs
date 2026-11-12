// PGlite test of when the guarded FIFO read RPCs (add_session_guards.sql
// section 3b: order_cogs, fifo_peek, fifo_inventory_valuation,
// fifo_inventory_check) answer, and of the app's test for "not set up"
// (src/utils/supabaseErrors.ts isFifoReadMissingError, which
// StoreContext's retailCogsAmount uses to keep its purchase_cost path):
//   * a store that re-ran add_session_guards.sql without add_fifo_costing.sql
//     (Romdoul2/3 the next time a guards fix ships);
//   * a store with add_fifo_costing.sql and the guards but no rebuild, so
//     no FIFO packs: still "not set up", so its old costs stay in use;
//   * once the rebuild is recorded and the packs are loaded: they answer.
// The "not set up" answer carries SQLSTATE 42883, the code the app reads as
// a missing function. See tests/README.md for how to run it.
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';

const { PGlite } = await import(process.env.PGLITE_DIST || '@electric-sql/pglite');
const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mig = f => path.join(repo, 'migrations', f);
const strip = f => fs.readFileSync(f, 'utf8').replace(/NOTIFY[^;]*;/g, '');

const out = await build({ entryPoints: [path.join(repo, 'src', 'utils', 'supabaseErrors.ts')], bundle: true, format: 'esm', write: false });
const bundlePath = path.join(repo, 'tests', '.fifo-read-readiness.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const { isFifoReadMissingError } = await import('file:///' + bundlePath.replace(/\\/g, '/'));
rmSync(bundlePath);

let pass = 0, fail = 0;
const check = (label, cond, extra) => {
    if (cond) { pass++; console.log('PASS', label); }
    else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); }
};

async function baseDb() {
    const db = new PGlite();
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;`);
    await db.exec(`CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid LANGUAGE sql AS 'SELECT gen_random_uuid()';`);
    let schema = strip(mig('full_schema.sql')).replace(/CREATE EXTENSION[^;]*;/g, '');
    schema = schema.replace(/INSERT INTO storage[\s\S]*?END \$\$;/, '');
    await db.exec(schema);
    await db.exec(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;`);
    await db.exec(strip(mig('add_auth_guards.sql')));
    for (const f of ['add_transaction_order_link.sql', 'add_transaction_reference_notes.sql', 'add_purchase_order_bill_date.sql']) {
        await db.exec(strip(mig(f)));
    }
    await db.exec(`INSERT INTO products (id, name, price, stock, purchase_cost) VALUES ('A', 'Speaker', 20, 0, 4)`);
    return db;
}
// Each read RPC as the app calls it (no session while enforcement is off),
// with the error as PGlite reports it: {code, message}.
const reads = [
    ['order_cogs', `SELECT public.order_cogs(p_order_id => 'x')`],
    ['fifo_peek', `SELECT public.fifo_peek(p_product_id => 'A', p_qty => 1)`],
    ['fifo_inventory_valuation', `SELECT * FROM public.fifo_inventory_valuation()`],
    ['fifo_inventory_check', `SELECT public.fifo_inventory_check()`],
];
const errOf = async (db, sql) => { try { await db.query(sql); return null; } catch (e) { return { code: e.code, message: String(e.message) }; } };
const allNotSetUp = async (db, tag) => {
    for (const [name, sql] of reads) {
        const e = await errOf(db, sql);
        check(`${tag}: ${name} answers "not set up" with SQLSTATE 42883`,
            !!e && e.code === '42883' && /FIFO costing is not set up/.test(e.message), e);
        check(`${tag}: ${name}: the app takes it as missing and falls back`, !!e && isFifoReadMissingError(e), e);
    }
};

// 1. Guards re-run on a store without add_fifo_costing.sql.
{
    const db = await baseDb();
    await db.exec(strip(mig('add_config_functions.sql')));
    await db.exec(strip(mig('add_session_guards.sql')));
    await allNotSetUp(db, 'guards only');
    // The old wrapper's P0001 answer (an earlier guards file) also counts.
    check('a P0001 "FIFO costing is not set up" answer counts as missing',
        isFifoReadMissingError({ code: 'P0001', message: 'FIFO costing is not set up on this store yet — run migrations/add_fifo_costing.sql.' }));
    check('a network or session failure does not count as missing',
        !isFifoReadMissingError({ code: '', message: 'TypeError: Failed to fetch' })
        && !isFifoReadMissingError({ code: 'P0001', message: 'Your session has expired. Please sign in again.' }));
}

// 2. add_fifo_costing.sql and the guards, but no rebuild (so no packs), on
//    a store with layers: the reads stay "not set up".
{
    const db = await baseDb();
    await db.exec(strip(mig('add_fifo_costing.sql')));
    await db.exec(`SELECT wp_internal.fifo_add_layers('A', 3, 5, now(), 'OPEN')`);
    let eLoad = '';
    try { await db.exec(strip(mig('add_wholesale_procurement_functions.sql'))); } catch (e) { eLoad = String(e.message); }
    check('no rebuild: the packs refuse to load', /Rebuild the FIFO pool first/.test(eLoad), eLoad);
    await db.exec(strip(mig('add_config_functions.sql')));
    await db.exec(strip(mig('add_session_guards.sql')));
    await allNotSetUp(db, 'FIFO schema, no rebuild');

    // 3. The rebuild recorded, the packs and the guards loaded: they answer.
    await db.exec(`CREATE TABLE public.fifo_rebuild_log (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        run_at TIMESTAMPTZ NOT NULL DEFAULT now(), run_date DATE NOT NULL, preset TEXT NOT NULL, summary JSONB NOT NULL);
        INSERT INTO public.fifo_rebuild_log (run_date, preset, summary) VALUES ('2026-11-13', 'default', '{}');`);
    for (const f of ['add_wholesale_procurement_functions.sql', 'add_order_status_function.sql',
                     'add_order_payment_functions.sql', 'add_stock_adjustment_posting.sql', 'add_session_guards.sql']) {
        await db.exec(strip(mig(f)));
    }
    for (const [name, sql] of reads) {
        const e = await errOf(db, sql);
        check(`rebuilt, packs loaded: ${name} answers`, e === null, e);
    }
    const peek = (await db.query(`SELECT public.fifo_peek(p_product_id => 'A', p_qty => 2) AS j`)).rows[0].j;
    check('rebuilt: fifo_peek prices the layers (2 x 5)', Number(peek.cost) === 10, peek);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
