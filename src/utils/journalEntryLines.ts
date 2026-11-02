import { supabase } from '../lib/supabase';

// Inserts journal entry lines that carry a per-line `description` (shown in
// the view popups' Description column). The column arrives with
// migrations/add_journal_entry_line_description.sql — on an instance that
// hasn't run it, the insert is retried without the descriptions so the
// posting itself never fails over a cosmetic field.
export type NewJournalLine = {
    journal_entry_id: string;
    account_id: string;
    debit: number;
    credit: number;
    description?: string;
};

export async function insertJournalLines(rows: NewJournalLine[]): Promise<{ error: { message?: string } | null }> {
    let { error } = await supabase.from('journal_entry_lines').insert(rows);
    if (error && /description/i.test(error.message || '') && rows.some(r => r.description !== undefined)) {
        ({ error } = await supabase.from('journal_entry_lines')
            .insert(rows.map(r => ({ journal_entry_id: r.journal_entry_id, account_id: r.account_id, debit: r.debit, credit: r.credit }))));
    }
    return { error: error || null };
}
