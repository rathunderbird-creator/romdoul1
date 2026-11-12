import { supabase } from '../lib/supabase';
import { fetchAll } from './fetchAll';

// Every journal line, grouped by its entry.
//
// Why not embed the lines in the entries query (journal_entries?select=*,
// lines:journal_entry_lines(*))? With no index on journal_entry_lines
// .journal_entry_id, Postgres builds each entry's line list by scanning the
// whole lines table, and it does that for EVERY entry before it can sort by
// date and cut a page — ~3s per page on a few thousand entries, past the
// statement timeout, and it grows with the ledger. Two flat paged reads
// (entries, lines) joined here take well under a second each.
// (migrations/add_journal_indexes.sql adds the index; this works with or without it.)
//
// `cols` must include journal_entry_id. Lines come back in the order they were
// written (created_at), debits before credits on a tie — a multi-line insert
// stamps every line with the same created_at.
export async function fetchJournalLinesByEntry<L extends object>(
    cols: string,
    label: string,
): Promise<Map<string, L[]>> {
    const rows = await fetchAll<L & { id: string; created_at?: string | null }>((from, to) => supabase
        .from('journal_entry_lines')
        .select(`id, created_at, ${cols}`)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: (L & { id: string; created_at?: string | null })[] | null; error: unknown }>,
        1000, { label });
    const byEntry = new Map<string, L[]>();
    for (const r of rows) {
        const key = String((r as { journal_entry_id?: unknown }).journal_entry_id || '');
        if (!key) continue;
        const list = byEntry.get(key);
        if (list) list.push(r); else byEntry.set(key, [r]);
    }
    const isDebit = (l: L) => (Number((l as { debit?: unknown }).debit) || 0) > 0 ? 0 : 1;
    for (const list of byEntry.values()) {
        list.sort((a, b) => {
            const ca = String((a as { created_at?: string | null }).created_at || '');
            const cb = String((b as { created_at?: string | null }).created_at || '');
            return ca === cb ? isDebit(a) - isDebit(b) : (ca < cb ? -1 : 1);
        });
    }
    return byEntry;
}
