import { supabase } from '../lib/supabase';

// Journal lines, grouped by their entry.
//
// Why not embed the lines in the entries query (journal_entries?select=*,
// lines:journal_entry_lines(*))? With no index on journal_entry_lines
// .journal_entry_id, Postgres builds each entry's line list by scanning the
// whole lines table, and it does that for EVERY entry before it can sort by
// date and cut a page — ~3s per page on a few thousand entries, past the
// statement timeout, and it grows with the ledger. Flat reads joined here take
// well under a second per request. (migrations/add_journal_indexes.sql adds the
// index; this works with or without it.)
//
// Two ways to read:
//  - whole ledger (no entryIds): keyset pages on the primary key (id > last),
//    so a line deleted mid-read can't shift the pages and silently drop a line
//    of some other entry (offset paging could), and no row ceiling cuts off the
//    newest lines — hitting the safety limit is an error, not a quiet cut.
//  - given entries (entryIds): batches of ids, so each entry's lines arrive
//    together in one request.
//
// `cols` must include journal_entry_id. Within an entry, lines are ordered by
// when they were written, then debits before credits, then by `tieKey` (or the
// account id) — every line of one insert shares the same created_at, so the
// tie-break is what makes the order stable.
const PAGE = 1000;
const SAFETY_LIMIT = 2_000_000;
const ID_BATCH = 200;

type Row = { id: string; created_at?: string | null; journal_entry_id?: unknown; debit?: unknown; account_id?: unknown };

export async function fetchJournalLinesByEntry<L extends object>(
    cols: string,
    label: string,
    opts: { entryIds?: string[]; tieKey?: (line: L) => string } = {},
): Promise<Map<string, L[]>> {
    const select = `id, created_at, ${cols}`;
    const rows: (L & Row)[] = [];
    if (opts.entryIds) {
        const ids = Array.from(new Set(opts.entryIds.filter(Boolean)));
        const batches: string[][] = [];
        for (let i = 0; i < ids.length; i += ID_BATCH) batches.push(ids.slice(i, i + ID_BATCH));
        // A few batches at a time: quicker than one by one, gentle on the API.
        for (let i = 0; i < batches.length; i += 4) {
            const results = await Promise.all(batches.slice(i, i + 4).map(b =>
                supabase.from('journal_entry_lines').select(select).in('journal_entry_id', b)));
            for (const { data, error } of results) {
                if (error) throw error;
                rows.push(...((data || []) as unknown as (L & Row)[]));
            }
        }
    } else {
        let last: string | null = null;
        for (;;) {
            let q = supabase.from('journal_entry_lines').select(select).order('id', { ascending: true }).limit(PAGE);
            if (last !== null) q = q.gt('id', last);
            const { data, error } = await q;
            if (error) throw error;
            const page = (data || []) as unknown as (L & Row)[];
            rows.push(...page);
            if (page.length < PAGE) break;
            last = page[page.length - 1].id;
            if (rows.length >= SAFETY_LIMIT) throw new Error(`${label}: more than ${SAFETY_LIMIT} journal lines — stopped instead of showing a partial ledger.`);
        }
    }

    const byEntry = new Map<string, L[]>();
    for (const r of rows) {
        const key = String(r.journal_entry_id || '');
        if (!key) continue;
        const list = byEntry.get(key);
        if (list) list.push(r); else byEntry.set(key, [r]);
    }
    const side = (l: Row) => ((Number(l.debit) || 0) > 0 ? 0 : 1);
    const tie = (l: L & Row) => (opts.tieKey ? opts.tieKey(l) : String(l.account_id ?? '')) + '\u0000' + l.id;
    for (const list of byEntry.values()) {
        (list as (L & Row)[]).sort((a, b) => {
            const ca = String(a.created_at || ''), cb = String(b.created_at || '');
            if (ca !== cb) return ca < cb ? -1 : 1;
            if (side(a) !== side(b)) return side(a) - side(b);
            const ta = tie(a), tb = tie(b);
            return ta < tb ? -1 : ta > tb ? 1 : 0;
        });
    }
    return byEntry;
}
