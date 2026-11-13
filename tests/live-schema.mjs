// Puts a PGlite harness on the column types a live store really has.
//
// migrations/full_schema.sql is the fresh-install schema, and the live
// stores were built long before it, by hand: their quantity / stock columns
// are int4, some ids are uuid, journal_entries.date is date and so on. The
// FIFO go-live on Romdoul1 failed on exactly that (round(double precision,
// integer) because sale_items.quantity is int4 live and NUMERIC here), so
// every harness that builds from full_schema.sql calls applyLiveTypes() after
// the schema and again after the migration stack: each column the live
// export (tests/live-schema-<store>.json, made by live-schema-from-csv.mjs)
// lists is altered to the live type, nullability and default. Views that
// depend on an altered column are dropped and re-created around the change.
//
// diffLive() reports what still differs (columns only one side has, plus any
// type the harness could not take), so a re-exported schema that drifts is
// seen in the tests. Not a test itself.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const loadLive = (store = 'romdoul1') =>
    JSON.parse(fs.readFileSync(path.join(here, `live-schema-${store}.json`), 'utf8'));

// information_schema udt_name -> a type name ALTER COLUMN accepts.
const SQL_TYPE = {
    int2: 'smallint', int4: 'integer', int8: 'bigint', float4: 'real', float8: 'double precision',
    bool: 'boolean', _text: 'text[]', varchar: 'varchar', bpchar: 'char',
};
const sqlType = udt => SQL_TYPE[udt] || udt;
const ident = s => '"' + s.replace(/"/g, '""') + '"';
// Defaults compared loosely: the same expression prints with or without a
// cast or schema prefix depending on how it was declared.
const normDefault = d => d === null || d === undefined ? null
    : String(d).replace(/::(text|numeric|integer|jsonb|character varying|text\[\])/g, '')
        .replace(/\bpublic\./g, '').replace(/\s+/g, ' ').trim().toLowerCase();

async function harnessColumns(db) {
    const rows = (await db.query(`
        SELECT c.table_name, c.column_name, c.udt_name, c.is_nullable, c.column_default,
               cl.relkind
          FROM information_schema.columns c
          JOIN pg_class cl ON cl.relname = c.table_name
          JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = c.table_schema
         WHERE c.table_schema = 'public'`)).rows;
    const t = {};
    for (const r of rows) {
        (t[r.table_name] ||= { kind: r.relkind, cols: {} }).cols[r.column_name] =
            { type: r.udt_name, nullable: r.is_nullable === 'YES', default: r.column_default };
    }
    return t;
}

// Every difference between the harness and the live export:
// { table, column, what: 'type'|'nullable'|'default'|'missing-in-harness'|'missing-live'|'table-missing-in-harness'|'table-missing-live', harness, live }
export async function diffLive(db, store = 'romdoul1') {
    const live = loadLive(store).tables;
    const h = await harnessColumns(db);
    const out = [];
    for (const [table, cols] of Object.entries(live)) {
        if (!h[table]) { out.push({ table, column: null, what: 'table-missing-in-harness' }); continue; }
        for (const [column, lc] of Object.entries(cols)) {
            const hc = h[table].cols[column];
            if (!hc) { out.push({ table, column, what: 'missing-in-harness', live: lc }); continue; }
            if (hc.type !== lc.type) out.push({ table, column, what: 'type', harness: hc.type, live: lc.type, view: h[table].kind === 'v' });
            if (h[table].kind !== 'v') {
                if (hc.nullable !== lc.nullable) out.push({ table, column, what: 'nullable', harness: hc.nullable, live: lc.nullable });
                if (normDefault(hc.default) !== normDefault(lc.default))
                    out.push({ table, column, what: 'default', harness: hc.default, live: lc.default });
            }
        }
        for (const column of Object.keys(h[table].cols)) {
            if (!cols[column]) out.push({ table, column, what: 'missing-live', harness: h[table].cols[column] });
        }
    }
    for (const table of Object.keys(h)) {
        if (!live[table] && !table.startsWith('_') && !/_bak_/.test(table)) out.push({ table, column: null, what: 'table-missing-live' });
    }
    return out;
}

// Alters every harness table column to the live type / nullability /
// default. Safe to call more than once. Returns the list of changes made.
export async function applyLiveTypes(db, store = 'romdoul1') {
    const live = loadLive(store).tables;
    const h = await harnessColumns(db);
    const typeChanges = [], otherChanges = [];
    for (const [table, cols] of Object.entries(live)) {
        if (!h[table] || h[table].kind !== 'r') continue;
        for (const [column, lc] of Object.entries(cols)) {
            const hc = h[table].cols[column];
            if (!hc) continue;
            if (hc.type !== lc.type) typeChanges.push({ table, column, from: hc.type, to: lc.type });
            if (hc.nullable !== lc.nullable)
                otherChanges.push({ table, column, sql: `ALTER TABLE public.${ident(table)} ALTER COLUMN ${ident(column)} ${lc.nullable ? 'DROP' : 'SET'} NOT NULL` });
            if (normDefault(hc.default) !== normDefault(lc.default))
                otherChanges.push({ table, column, sql: `ALTER TABLE public.${ident(table)} ALTER COLUMN ${ident(column)} `
                    + (lc.default === null ? 'DROP DEFAULT' : `SET DEFAULT ${lc.default}`) });
        }
    }
    await alterColumnTypes(db, typeChanges.map(c => ({ ...c, default: live[c.table][c.column].default })));
    for (const c of otherChanges) {
        // A default the harness cannot evaluate (an extension function it
        // lacks) is left alone; diffLive() still reports it.
        try { await db.exec(c.sql); } catch (e) {
            if (!/does not exist/.test(e.message)) throw new Error(`live types: ${c.sql}: ${e.message}`);
        }
    }
    return { typeChanges, otherChanges: otherChanges.map(c => c.sql) };
}

// ALTER COLUMN ... TYPE for each change ({table, column, to: udt or SQL
// type, default}), around the views and foreign keys that would block it.
export async function alterColumnTypes(db, changes) {
    if (!changes.length) return;
    // Views that read an altered table block ALTER COLUMN TYPE: drop
    // them (with their grants), alter, re-create in the same order.
    const views = (await db.query(`
        SELECT c.relname, pg_get_viewdef(c.oid, true) AS def, c.oid
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'v'
         ORDER BY c.oid`)).rows;
    const grants = (await db.query(`
        SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
         WHERE table_schema = 'public' AND table_name = ANY($1)`, [views.map(v => v.relname)])).rows;
    for (const v of [...views].reverse()) await db.exec(`DROP VIEW public.${ident(v.relname)}`);
    // FKs between columns that both change type are dropped and re-added.
    const fks = (await db.query(`
        SELECT con.conname, cl.relname, pg_get_constraintdef(con.oid) AS def
          FROM pg_constraint con JOIN pg_class cl ON cl.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = cl.relnamespace
         WHERE n.nspname = 'public' AND con.contype = 'f'`)).rows;
    for (const fk of fks) await db.exec(`ALTER TABLE public.${ident(fk.relname)} DROP CONSTRAINT ${ident(fk.conname)}`);
    for (const c of changes) {
        await db.exec(`ALTER TABLE public.${ident(c.table)} ALTER COLUMN ${ident(c.column)} DROP DEFAULT`);
        await db.exec(`ALTER TABLE public.${ident(c.table)} ALTER COLUMN ${ident(c.column)} TYPE ${sqlType(c.to)}`
            + ` USING ${ident(c.column)}::${sqlType(c.to)}`);
        if (c.default !== null && c.default !== undefined)
            await db.exec(`ALTER TABLE public.${ident(c.table)} ALTER COLUMN ${ident(c.column)} SET DEFAULT ${c.default}`);
    }
    for (const fk of fks) {
        try { await db.exec(`ALTER TABLE public.${ident(fk.relname)} ADD CONSTRAINT ${ident(fk.conname)} ${fk.def}`); }
        catch (e) { throw new Error(`live types: cannot re-add ${fk.relname}.${fk.conname} (${fk.def}): ${e.message}`); }
    }
    for (const v of views) await db.exec(`CREATE VIEW public.${ident(v.relname)} AS ${v.def}`);
    for (const g of grants) await db.exec(`GRANT ${g.privilege_type} ON public.${ident(g.table_name)} TO ${ident(g.grantee)}`);
}

// sale_items.id is uuid on the live stores, so a test's readable line label
// ('S1-a') becomes a uuid that spells it: the label's bytes in hex, padded
// with zeros. Uuids compare byte-wise, so labels keep their order.
export const lineUuid = label => {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(label))) return String(label); // already one
    const hex = Buffer.from(String(label), 'utf8').toString('hex');
    if (hex.length > 32) throw new Error(`line label too long for a uuid: ${label}`);
    const h = hex.padEnd(32, '0');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

// applyLiveTypes(), then refuse to go on if any column both sides have still
// differs in type, nullability or default: the harness must be on the live
// types before a test may pass. Columns only one side has are allowed (a
// test may rebuild a table as it was before a migration).
export async function useLiveTypes(db, store = 'romdoul1') {
    await applyLiveTypes(db, store);
    // A view's column types follow its tables (and the casts its definition
    // froze), so only tables must match.
    const left = (await diffLive(db, store)).filter(d => ['type', 'nullable', 'default'].includes(d.what) && !d.view);
    if (left.length) {
        throw new Error('harness still differs from the live schema: '
            + left.map(d => `${d.table}.${d.column} ${d.what} ${JSON.stringify(d.harness)} vs live ${JSON.stringify(d.live)}`).join('; '));
    }
}
