// Turns a live-store column export into tests/live-schema-<store>.json, the
// schema the PGlite harnesses are forced onto (tests/live-schema.mjs).
// Schema only, no data. Not a test itself.
//
// The export is the Supabase SQL editor result of:
//
//   SELECT c.table_name,
//          string_agg(c.column_name || ':' || c.udt_name || ':' || c.is_nullable
//                     || COALESCE(':' || c.column_default, ''), ' | ' ORDER BY c.ordinal_position) AS cols
//     FROM information_schema.columns c
//    WHERE c.table_schema = 'public'
//    GROUP BY c.table_name ORDER BY c.table_name;
//
// saved as CSV. Usage:
//
//   node tests/live-schema-from-csv.mjs <export.csv> romdoul1
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const [csvPath, store] = process.argv.slice(2);
if (!csvPath || !store) {
    console.error('usage: node tests/live-schema-from-csv.mjs <export.csv> <store>');
    process.exit(2);
}

// Minimal RFC 4180 reader (quoted fields, doubled quotes, CRLF or LF).
function parseCsv(text) {
    const rows = [];
    let row = [], field = '', i = 0, quoted = false;
    while (i < text.length) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
            if (ch === '"') { quoted = false; i++; continue; }
            field += ch; i++; continue;
        }
        if (ch === '"') { quoted = true; i++; continue; }
        if (ch === ',') { row.push(field); field = ''; i++; continue; }
        if (ch === '\r') { i++; continue; }
        if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
        field += ch; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
}

const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
const header = rows.shift();
if (header[0] !== 'table_name' || header[1] !== 'cols') throw new Error('unexpected header: ' + header.join(','));
const tables = {};
for (const [table, cols] of rows) {
    if (!table) continue;
    const columns = {};
    for (const part of cols.split(' | ')) {
        // name:udt:nullable[:default] — the default may itself hold colons.
        const m = /^([^:]+):([^:]+):(YES|NO)(?::(.*))?$/.exec(part.trim());
        if (!m) throw new Error(`cannot read column "${part}" of ${table}`);
        columns[m[1]] = { type: m[2], nullable: m[3] === 'YES', default: m[4] === undefined ? null : m[4] };
    }
    tables[table] = columns;
}
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), `live-schema-${store}.json`);
// One line per column so a re-export diffs cleanly.
const lines = ['{', `  "store": ${JSON.stringify(store)},`,
    '  "source": "information_schema.columns (public), exported from the live store",', '  "tables": {'];
const names = Object.keys(tables);
names.forEach((t, ti) => {
    lines.push(`    ${JSON.stringify(t)}: {`);
    const cols = Object.entries(tables[t]);
    cols.forEach(([c, v], ci) => lines.push(`      ${JSON.stringify(c)}: ${JSON.stringify(v)}${ci < cols.length - 1 ? ',' : ''}`));
    lines.push(`    }${ti < names.length - 1 ? ',' : ''}`);
});
lines.push('  }', '}', '');
fs.writeFileSync(out, lines.join('\r\n'));
console.log(`wrote ${out}: ${Object.keys(tables).length} tables`);
