import { supabase } from '../lib/supabase';

// Human-readable reference prefilled on a new Supplier Bill, editable by the
// user (e.g. to type the supplier's own invoice number instead): shape
// {PREFIX}-{YYYYMMDD}-{seq}, e.g. BIL-20261021-001. Client-side
// query-then-format (no DB sequence/trigger), same accepted tradeoff as
// utils/journalEntryNumber.ts's nextJournalEntryNumber — a cosmetic prefill,
// not a strict numbering guarantee, and the field stays editable either way.
//
// Counted against purchase_orders.invoice_number, scoped to bills created
// TODAY under the SAME prefix — a prefix change in Purchase Setup only
// affects new bills, existing ones keep their old reference text.
export async function nextBillNumber(date: string, prefix = 'BIL'): Promise<string | null> {
    try {
        const ymd = String(date || '').slice(0, 10).replace(/-/g, '');
        if (!/^\d{8}$/.test(ymd)) return null;
        const p = (prefix || 'BIL').trim() || 'BIL';

        const { count, error } = await supabase
            .from('purchase_orders')
            .select('id', { count: 'exact', head: true })
            .like('invoice_number', `${p}-${ymd}-%`);
        if (error) throw error;

        const seq = String((count || 0) + 1).padStart(3, '0');
        return `${p}-${ymd}-${seq}`;
    } catch (e) {
        console.error('Failed to compute the next bill number:', e);
        return null;
    }
}
