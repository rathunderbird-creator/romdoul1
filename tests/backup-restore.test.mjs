// PGlite round-trip of the restore helpers in src/utils/backupRestore.ts
// (audit APP-3). The crux: chart_of_accounts is seeded with gen_random_uuid()
// per database, so a backup's journal_entry_lines.account_id UUIDs never exist
// in the restore target — they must be remapped by account_code, custom
// accounts inserted, and columns the target lacks stripped. See tests/README.md.
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';
import { useLiveTypes } from './live-schema.mjs';

const { PGlite } = await import(process.env.PGLITE_DIST || '@electric-sql/pglite');

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;
const check = (label, cond, extra) => {
    if (cond) { pass++; console.log('PASS', label); }
    else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); }
};

// Helpers, transpiled with the repo's own esbuild.
const out = await build({
    entryPoints: [path.join(repo, 'src', 'utils', 'backupRestore.ts')],
    bundle: true, format: 'esm', write: false,
});
const bundlePath = path.join(repo, 'tests', '.backuprestore.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const { BACKUP_TABLES, buildAccountIdMap, remapAccountIds, missingColumnFromError, stripColumn } = await import('file:///' + bundlePath.replace(/\\/g, '/'));
rmSync(bundlePath);

// The accounting tables exactly as migrations/full_schema.sql creates and
// seeds them — two independent databases, so the seeded UUIDs differ.
const ACCOUNTING_SCHEMA = `
CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid LANGUAGE sql AS 'SELECT gen_random_uuid()';
CREATE TABLE chart_of_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_code TEXT UNIQUE NOT NULL,
    account_name TEXT NOT NULL,
    account_type TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TABLE journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE DEFAULT CURRENT_DATE,
    description TEXT,
    reference_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TABLE journal_entry_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id UUID REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
    debit NUMERIC DEFAULT 0,
    credit NUMERIC DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
INSERT INTO chart_of_accounts (account_code, account_name, account_type) VALUES
('1000', 'Cash', 'Asset'),
('1200', 'Accounts Receivable', 'Asset'),
('4000', 'Sales Revenue', 'Revenue'),
('5000', 'Cost of Goods Sold', 'Expense')
ON CONFLICT (account_code) DO NOTHING;
`;

const source = new PGlite();
const target = new PGlite();
await source.exec(ACCOUNTING_SCHEMA);
await target.exec(ACCOUNTING_SCHEMA);
// Both on the live column types (journal_entries.date NOT NULL, no default).
await useLiveTypes(source);
await useLiveTypes(target);
// The SOURCE store ran the description-column migration; the target did not —
// the schema-drift case restore must survive.
await source.exec(`ALTER TABLE journal_entry_lines ADD COLUMN description TEXT;`);

// The source store sold things: a custom account, an entry, lines.
await source.exec(`INSERT INTO chart_of_accounts (account_code, account_name, account_type) VALUES ('7000', 'Custom Marketing', 'Expense');`);
await source.exec(`
INSERT INTO journal_entries (id, date, description, reference_id) VALUES
('11111111-1111-1111-1111-111111111111', '2026-11-01', 'Sale #1', 'S-1');
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
SELECT '11111111-1111-1111-1111-111111111111', id, 25, 0, 'cash in' FROM chart_of_accounts WHERE account_code = '1000';
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
SELECT '11111111-1111-1111-1111-111111111111', id, 0, 25, 'revenue' FROM chart_of_accounts WHERE account_code = '4000';
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
SELECT '11111111-1111-1111-1111-111111111111', id, 3, 0, 'ads' FROM chart_of_accounts WHERE account_code = '7000';
`);

// "Backup": rows exactly as PostgREST would serve them.
const backup = {};
const ORDER = { chart_of_accounts: 'account_code', journal_entries: 'created_at', journal_entry_lines: 'debit DESC, credit' };
for (const t of ['chart_of_accounts', 'journal_entries', 'journal_entry_lines']) {
    backup[t] = (await source.query(`SELECT * FROM ${t} ORDER BY ${ORDER[t]}`)).rows
        .map(r => JSON.parse(JSON.stringify(r)));
}

// Sanity: the seeded ids really differ between the two databases.
const srcCash = (await source.query(`SELECT id FROM chart_of_accounts WHERE account_code = '1000'`)).rows[0].id;
const tgtCash = (await target.query(`SELECT id FROM chart_of_accounts WHERE account_code = '1000'`)).rows[0].id;
check('seeded account ids differ between databases', srcCash !== tgtCash);

// Proof of the bug the remap fixes: inserting the raw backup lines fails FK.
let rawFailed = false;
try {
    const l = backup.journal_entry_lines[0];
    await target.query(
        `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit) VALUES ($1,$2,$3,$4,$5)`,
        [l.id, null, l.account_id, l.debit, l.credit]);
} catch { rawFailed = true; }
check('raw backup account_id violates FK on the target (the audit failure)', rawFailed);

// ---- The restore path ----
const targetAccounts = (await target.query(`SELECT id, account_code FROM chart_of_accounts`)).rows;
const { idMap, toInsert } = buildAccountIdMap(backup.chart_of_accounts, targetAccounts);
check('seeded accounts remap onto the target rows', idMap[srcCash] === tgtCash);
check('only the custom account needs inserting', toInsert.length === 1 && toInsert[0].account_code === '7000');

for (const acc of toInsert) {
    await target.query(
        `INSERT INTO chart_of_accounts (id, account_code, account_name, account_type, description, is_active) VALUES ($1,$2,$3,$4,$5,$6)`,
        [acc.id, acc.account_code, acc.account_name, acc.account_type, acc.description, acc.is_active]);
}

for (const e of backup.journal_entries) {
    await target.query(`INSERT INTO journal_entries (id, date, description, reference_id) VALUES ($1,$2,$3,$4)`,
        [e.id, e.date, e.description, e.reference_id]);
}

// Lines: remap account ids, then insert with the strip-and-retry loop the app
// uses (the target has no "description" column).
let lines = remapAccountIds(backup.journal_entry_lines, idMap);
const insertLines = async (rows) => {
    for (const l of rows) {
        const cols = Object.keys(l);
        await target.query(
            `INSERT INTO journal_entry_lines (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})`,
            cols.map(c => l[c]));
    }
};
let stripped = null;
for (let attempts = 0; ; attempts++) {
    try { await insertLines(lines); break; }
    catch (e) {
        const missing = missingColumnFromError(e.message);
        if (missing && attempts < 8) { stripped = missing; lines = stripColumn(lines, missing); continue; }
        throw e;
    }
}
check('schema-drift column was detected and stripped', stripped === 'description');

// Round-trip assertions: every line landed, on the account with the SAME code.
const landed = (await target.query(`
    SELECT a.account_code, l.debit::float AS debit, l.credit::float AS credit
    FROM journal_entry_lines l JOIN chart_of_accounts a ON a.id = l.account_id
    ORDER BY a.account_code`)).rows;
check('all three lines restored', landed.length === 3);
check('cash line on the target cash account', landed[0].account_code === '1000' && landed[0].debit === 25);
check('revenue line on the target revenue account', landed[1].account_code === '4000' && landed[1].credit === 25);
check('custom-account line follows its inserted account', landed[2].account_code === '7000' && landed[2].debit === 3);
const orphan = (await target.query(`
    SELECT COUNT(*)::int AS n FROM journal_entry_lines l
    LEFT JOIN chart_of_accounts a ON a.id = l.account_id WHERE a.id IS NULL`)).rows[0].n;
check('no orphaned account references', orphan === 0);

// missingColumnFromError understands both PostgREST and PostgreSQL spellings.
check('parses PostgREST missing-column message',
    missingColumnFromError("Could not find the 'description' column of 'journal_entry_lines' in the schema cache") === 'description');
check('parses PostgreSQL missing-column message',
    missingColumnFromError('column "description" of relation "journal_entry_lines" does not exist') === 'description');
check('unrelated error yields null', missingColumnFromError('duplicate key value violates unique constraint') === null);

// The table list: the FIFO layers travel with the stock they cost, after the
// rows they reference (products, sales), so restore inserts them in order.
const at = t => BACKUP_TABLES.indexOf(t);
check('backup includes inventory_items (the FIFO layers)', at('inventory_items') >= 0);
check('inventory_items is restored after products and sales', at('inventory_items') > at('products') && at('inventory_items') > at('sales'));
check('sale_items after sales, journal lines after their entries and the accounts',
    at('sale_items') > at('sales') && at('journal_entry_lines') > at('journal_entries') && at('journal_entry_lines') > at('chart_of_accounts'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
