import { supabase } from '../lib/supabase';

// What created the journal entry, embedded in its human-readable
// entry_number. REV/EXP come from the Revenue & Expense entry pages, PUR from
// receiving a purchase order into inventory. ADJ is reserved for a future
// manual-adjustment flow — no current code path produces one.
export type JournalEntryTypeCode = 'RCP' | 'DEP' | 'SPP' | 'WSP' | 'PAY' | 'MAN' | 'REV' | 'EXP' | 'PUR' | 'ADJ';

// Human-readable display ID for a journal entry, additive to (never a
// replacement for) reference_id: JE-{globalSeq}-{TYPE}-{YYYYMMDD}-{dailySeq},
// e.g. JE-37-RCP-20261019-001.
//   - globalSeq: how many journal entries exist system-wide right now (old
//     entries without an entry_number counted too) + 1 — not zero-padded.
//   - dailySeq: 1-indexed, zero-padded to 3 digits, resets per (type, date)
//     combination — counted off entry_number rows already matching that
//     exact type and date.
// Client-side query-then-format (no DB sequence/trigger): this is a
// cosmetic/readability feature, not a strict invoice-numbering guarantee, so
// a rare race between two simultaneous inserts reusing a sequence number is
// an accepted tradeoff.
//
// `date` must be the SAME string about to be written to the entry's own
// `date` column (not created_at). Its first 10 characters are sliced and
// dash-stripped as-is — never re-derived via `new Date(...).toISOString()`,
// which UTC-shifts and can land on the wrong local day.
//
// Returns null when the count can't be resolved — most commonly because this
// instance hasn't run migrations/add_journal_entry_number.sql yet, so the
// entry_number column isn't in the schema cache. Callers should then simply
// omit entry_number from the insert (and still tolerate the insert itself
// failing on that column, as a defensive fallback).
export async function nextJournalEntryNumber(type: JournalEntryTypeCode, date: string): Promise<string | null> {
    try {
        const ymd = String(date || '').slice(0, 10).replace(/-/g, '');
        if (!/^\d{8}$/.test(ymd)) return null;

        const [globalRes, dailyRes] = await Promise.all([
            supabase.from('journal_entries').select('id', { count: 'exact', head: true }),
            supabase.from('journal_entries').select('id', { count: 'exact', head: true })
                .like('entry_number', `JE-%-${type}-${ymd}-%`),
        ]);
        if (globalRes.error) throw globalRes.error;
        if (dailyRes.error) throw dailyRes.error;

        const globalSeq = (globalRes.count || 0) + 1;
        const dailySeq = String((dailyRes.count || 0) + 1).padStart(3, '0');
        return `JE-${globalSeq}-${type}-${ymd}-${dailySeq}`;
    } catch (e) {
        console.error('Failed to compute the next journal entry number:', e);
        return null;
    }
}
