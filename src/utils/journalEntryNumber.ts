import { supabase } from '../lib/supabase';

// What created the journal entry, embedded in its human-readable
// entry_number. REV/EXP come from the Revenue & Expense entry pages, GRN from
// receiving a purchase order into inventory (goods received note; older
// entries of this kind carry the legacy code PUR). DLV is a cancelled
// order's delivery-fee-only payment (paymentStatus 'PdFee'). ADJ is a Stock
// Adjustment. OPA is a Purchase Setup AP opening balance load.
export type JournalEntryTypeCode = 'RCP' | 'DEP' | 'SPP' | 'WSP' | 'PAY' | 'MAN' | 'REV' | 'EXP' | 'PUR' | 'GRN' | 'DLV' | 'ADJ' | 'OPA';

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

// The {TYPE}-{YYYYMMDD}-{dailySeq} tail of an entry_number, with the
// "JE-{globalSeq}-" prefix stripped — e.g. "JE-37-OPA-20261026-005" becomes
// "OPA-20261026-005". Used to echo a short, readable reference inside an
// entry's own description text, next to its human-readable type label.
export function entryNumberRef(entryNumber: string | null | undefined): string | null {
    if (!entryNumber) return null;
    return entryNumber.replace(/^JE-\d+-/, '');
}

// The unified description format for auto-posted entries that have a
// counterparty: '{Area} - {REF} — {Name}', e.g.
//   'Payment - SPP-20261024-001 — HOT GAME'
//   'Purchase - GRN-20260912-001 — HOT GAME'
//   'Wholesale - WSP-20261024-002 — Meng Sethy'
//   'Retail - RCP-20261024-003 — Sok Dara'
// SPP entries settle a bill, so they read Payment — the purchase itself is
// the receive entry's (GRN/PUR) label.
// The area comes from the entry_number's type code, so every caller labels
// consistently. Returns null when there is no entry number to echo or the
// type has no business area (MAN/PAY/REV/EXP keep their own text) —
// callers then fall back to their older format, which still carries the
// context on instances without the entry_number migration.
const AREA_BY_TYPE: Record<string, string> = {
    SPP: 'Payment', GRN: 'Purchase', PUR: 'Purchase', OPA: 'Purchase',
    WSP: 'Wholesale',
    RCP: 'Retail', DEP: 'Retail', DLV: 'Retail',
    ADJ: 'Inventory', // Stock Adjustments; the "name" slot carries the reason
};
export function entryDescription(entryNumber: string | null | undefined, name: string): string | null {
    const ref = entryNumberRef(entryNumber);
    if (!ref) return null;
    const area = AREA_BY_TYPE[ref.split('-')[0]];
    return area ? `${area} - ${ref} — ${name}` : null;
}
