// The one loader behind every financial-statement style read of the whole
// ledger (Financial Statements, Balance Sheet, Income Statement, Financial
// Dashboard): all journal entry lines belonging to POSTED entries — a Draft
// isn't in the books yet. Paged through fetchAll with the unique `id` both in
// the ordering and in the selected columns, so a line posted while the pages
// load can't be double-counted (fetchAll merges repeats by id).
//
// Instances without migrations/add_entry_status.sql have no status column:
// the load falls back, and everything counts as Posted.
import { supabase } from '../lib/supabase';
import { fetchAll } from './fetchAll';

export interface PostedLedgerLine {
    accountId: string;
    entryId: string;
    debit: number;
    credit: number;
    /** The parent entry's date, YYYY-MM-DD. */
    date: string;
}

type LineRow = {
    id: unknown;
    account_id: unknown;
    journal_entry_id: unknown;
    debit: unknown;
    credit: unknown;
    entry: { date?: unknown; status?: unknown } | null;
};

export async function fetchPostedLedgerLines(label: string): Promise<PostedLedgerLine[]> {
    // supabase-js types the embedded entry as an array (it's a to-one join at
    // runtime), so the rows are cast — exactly as the previous per-page loops did.
    const load = async (withStatus: boolean): Promise<LineRow[]> => (await fetchAll((from, to) => supabase
        .from('journal_entry_lines')
        .select(`id, account_id, journal_entry_id, debit, credit, entry:journal_entries!inner(date${withStatus ? ', status' : ''})`)
        .order('id', { ascending: true })
        .range(from, to), 1000, { label, maxRows: 100000 })) as LineRow[];

    let rows: LineRow[];
    try {
        rows = await load(true);
    } catch (e) {
        if (/status/i.test((e as { message?: string })?.message || '')) rows = await load(false);
        else throw e;
    }

    const all: PostedLedgerLine[] = [];
    for (const l of rows) {
        if (String(l.entry?.status || 'Posted') === 'Draft') continue;
        all.push({
            accountId: String(l.account_id),
            entryId: String(l.journal_entry_id),
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            date: String(l.entry?.date || '').slice(0, 10),
        });
    }
    return all;
}
