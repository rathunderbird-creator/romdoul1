/**
 * One-time cutover entry for standard accounting: books the stock already on
 * the shelf as an opening Inventory balance — Dr 1300 Inventory / Cr Equity —
 * valued at each product's current stock × purchase cost (the same basis the
 * app now uses for COGS). Creates ONE Draft journal entry per instance,
 * reference 'OPENING-INV' (re-running never duplicates it); review and Post it
 * from Accounting › Journal Entries.
 *
 * Usage:
 *   node src/scripts/post-opening-inventory.cjs                    // dry run, all instances
 *   node src/scripts/post-opening-inventory.cjs --instance Romdoul2
 *   node src/scripts/post-opening-inventory.cjs --commit           // actually insert
 */
const { createClient } = require('@supabase/supabase-js');
const instances = require('../../migrations/db_instances.json').instances;

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const instanceFilter = args.indexOf('--instance') !== -1 ? args[args.indexOf('--instance') + 1] : null;

const REFERENCE = 'OPENING-INV';

const todayYmd = () => {
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

async function fetchAllRows(query, pageSize = 1000) {
    const rows = [];
    for (let from = 0; from < 1000000; from += pageSize) {
        const { data, error } = await query(from, from + pageSize - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < pageSize) break;
    }
    return rows;
}

// Same format as src/utils/journalEntryNumber.ts (client-side query-then-format).
async function nextEntryNumber(supabase, type, ymd) {
    const compactYmd = ymd.replace(/-/g, '');
    const [globalRes, dailyRes] = await Promise.all([
        supabase.from('journal_entries').select('id', { count: 'exact', head: true }),
        supabase.from('journal_entries').select('id', { count: 'exact', head: true })
            .like('entry_number', `JE-%-${type}-${compactYmd}-%`),
    ]);
    if (globalRes.error || dailyRes.error) return null;
    return `JE-${(globalRes.count || 0) + 1}-${type}-${compactYmd}-${String((dailyRes.count || 0) + 1).padStart(3, '0')}`;
}

async function run(instance) {
    const supabase = createClient(instance.url, instance.anonKey || instance.key);
    const out = { instance: instance.name };

    const { data: existing, error: exErr } = await supabase
        .from('journal_entries').select('id, date, status').eq('reference_id', REFERENCE).limit(1).maybeSingle();
    if (exErr) throw exErr;
    if (existing) {
        out.skipped = `opening entry already exists (${existing.status || 'Posted'}, dated ${existing.date})`;
        return out;
    }

    const products = await fetchAllRows((from, to) => supabase
        .from('products').select('id, name, stock, purchase_cost, is_active').order('id', { ascending: true }).range(from, to));
    const inStock = products.filter(p => (Number(p.stock) || 0) > 0);
    const valued = inStock.filter(p => (Number(p.purchase_cost) || 0) > 0);
    const zeroCost = inStock.length - valued.length;
    const units = inStock.reduce((s, p) => s + (Number(p.stock) || 0), 0);
    const value = Math.round(valued.reduce((s, p) => s + Number(p.stock) * Number(p.purchase_cost), 0) * 100) / 100;

    const { data: coa, error: coaErr } = await supabase
        .from('chart_of_accounts').select('id, account_code, account_name, account_type').eq('is_active', true);
    if (coaErr) throw coaErr;
    const pool = coa || [];
    const inventoryAcc = pool.find(a => a.account_code === '1300')
        || pool.find(a => a.account_type === 'Asset' && /inventor|stock/i.test(a.account_name));
    const equityAcc = pool.find(a => a.account_code === '3000')
        || [...pool].filter(a => a.account_type === 'Equity').sort((a, b) => a.account_code.localeCompare(b.account_code))[0];

    Object.assign(out, {
        productsInStock: inStock.length,
        unitsOnHand: units,
        zeroCostProducts: zeroCost,
        openingValue: value,
        inventoryAccount: inventoryAcc ? `${inventoryAcc.account_code} ${inventoryAcc.account_name}` : null,
        equityAccount: equityAcc ? `${equityAcc.account_code} ${equityAcc.account_name}` : null,
    });

    if (!inventoryAcc || !equityAcc) { out.error = 'missing Inventory or Equity account — nothing booked'; return out; }
    if (value <= 0) { out.error = 'opening value is zero — nothing to book'; return out; }
    if (!commit) { out.dryRun = true; return out; }

    const date = todayYmd();
    const entryNumber = await nextEntryNumber(supabase, 'MAN', date);
    const payload = {
        date,
        description: `Opening inventory balance — ${valued.length} products, ${units} units at purchase cost`,
        reference_id: REFERENCE,
        status: 'Draft',
        ...(entryNumber ? { entry_number: entryNumber } : {}),
    };
    let entry = null, jeErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        ({ data: entry, error: jeErr } = await supabase.from('journal_entries').insert([payload]).select().single());
        if (!jeErr) break;
        const msg = jeErr.message || '';
        let stripped = false;
        if (/entry_number/i.test(msg) && 'entry_number' in payload) { delete payload.entry_number; stripped = true; }
        if (/status/i.test(msg) && 'status' in payload) { delete payload.status; stripped = true; }
        if (!stripped) break;
    }
    if (jeErr || !entry) throw jeErr || new Error('entry insert failed');
    const { error: lErr } = await supabase.from('journal_entry_lines').insert([
        { journal_entry_id: entry.id, account_id: inventoryAcc.id, debit: value, credit: 0 },
        { journal_entry_id: entry.id, account_id: equityAcc.id, debit: 0, credit: value },
    ]);
    if (lErr) {
        await supabase.from('journal_entries').delete().eq('id', entry.id);
        throw lErr;
    }
    out.booked = `${payload.entry_number || entry.id} (Draft, ${date})`;
    return out;
}

(async () => {
    for (const instance of instances) {
        if (instanceFilter && instance.name !== instanceFilter) continue;
        try {
            console.log(JSON.stringify(await run(instance)));
        } catch (e) {
            console.log(JSON.stringify({ instance: instance.name, error: String(e && e.message || e) }));
        }
    }
})();
