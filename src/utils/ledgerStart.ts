import { supabase } from '../lib/supabase';

// The day this store's ledger starts: the date of its opening stock-count
// entry (reference OPENING-INV, Draft or Posted). Earlier history is read in
// Income & Expense and deliberately kept OUT of the ledger — there is no
// opening cash entry, pre-count cost of goods was intentionally not
// backfilled, and many early day-book rows are really inter-branch repayments,
// supplier pay-offs, stock or owner draws that would book to the wrong
// accounts. So the ledger-booking flows (Journal Entries' Import to Ledger,
// Retail Payment's Post Now) only offer rows dated on or after this day.
//
// Returns 'YYYY-MM-DD', or null when the store has no opening entry (no
// restriction then — today's behaviour). Cached for the session once found.
let cached: string | null | undefined;

export async function fetchLedgerStartDate(): Promise<string | null> {
    if (cached !== undefined) return cached;
    const { data, error } = await supabase
        .from('journal_entries')
        .select('date')
        .eq('reference_id', 'OPENING-INV')
        .order('date', { ascending: true })
        .limit(1);
    // A failed lookup is not cached, and doesn't block: the next call retries.
    if (error) return null;
    cached = data && data.length > 0 ? String(data[0].date).slice(0, 10) : null;
    return cached;
}

// True when a row dated `ymd` (YYYY-MM-DD, the user's local day) falls before
// the ledger start. A null start never blocks.
export const isBeforeLedgerStart = (ymd: string, start: string | null): boolean =>
    !!start && !!ymd && ymd < start;

// '21 Oct 2026' for messages.
export const formatLedgerStart = (start: string): string => {
    const [y, m, d] = start.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

// The day a purchase order belongs to for the ledger-start rule: the local day
// it was recorded (created_at), falling back to its order date. A PO recorded
// before the opening stock count was received into that count, so it must not
// get a receipt entry of its own now (see postPurchaseReceiptEntry).
export const purchaseOrderLedgerDay = (po: { created_at?: string | null; order_date?: string | null }): string => {
    if (po.created_at) {
        const d = new Date(po.created_at);
        if (!Number.isNaN(d.getTime())) {
            const p = (n: number) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        }
    }
    return String(po.order_date || '').slice(0, 10);
};
