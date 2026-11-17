// Which journal entries the system booked (and so must not be edited or
// deleted from a UI page), and what kind each one is.
//
// The accounting module writes most entries itself: the day-book payment
// flows ('TX-<transaction id>'), retail and wholesale cost of goods
// ('ORD-<id>-COGS', '-COGS-ADJ', '-COGS-REV'; 'WSO-<id>-COGS…'), wholesale
// invoices ('WSO-<id>-INV'), purchase orders ('PO-<uuid>'), stock adjustments
// ('ADJ-<id>'), the FIFO revaluation ('FIFO-REVAL-<date>'), true-ups
// ('TRUEUP-…') and the opening inventory ('OPENING-INV'). Editing one breaks
// the check that produced it (the FIFO check, the wholesale A/R settlement),
// so a page offers Reverse — an offsetting Draft — instead.
//
// The reference prefix decides first. The entry number's type code
// (JE-<n>-<CODE>-…) is only a fallback: the numbering sweep stamped MAN onto
// payment rows it couldn't classify, and the FIFO pack numbers its
// revaluation MAN as well, so a MAN number alone proves nothing.
import type { JournalEntry } from '../types';

export type SystemEntryKind =
    | 'receipt' | 'payment' | 'cogs' | 'invoice' | 'purchase' | 'stockAdj'
    | 'revaluation' | 'trueup' | 'opening' | 'reversal' | 'system';

export type EntryLike = Pick<JournalEntry, 'reference_id' | 'entry_number'>;

// Type codes a person picks when recording an entry by hand: Journal Entries
// (MAN) and the Revenue / Expense page (REV / EXP). Every other code names an
// automatic flow (RCP, DEP, DLV, SPP, WSP, PAY, PUR, GRN, ADJ, OPA, …).
const HAND_CODES: ReadonlySet<string> = new Set(['MAN', 'REV', 'EXP']);
// Money-in flows vs money-out flows among the 'TX-' day-book entries.
const PAYMENT_CODES: ReadonlySet<string> = new Set(['SPP', 'WSP', 'PAY', 'EXP']);

const SYSTEM_REF = /^(TX|ORD|WSO|PO|ADJ|FIFO|TRUEUP|OPENING)-/;
// '<original reference>-REV' or '-REV-<n>' — the shape Reverse writes.
const REVERSAL_REF = /-REV(-\d+)?$/;

// 'JE-12-RCP-20261113-3' → 'RCP'; anything else (no number yet, or a bare
// reference shown in its place) → null.
export const entryTypeCode = (entryNumber: string | null | undefined): string | null => {
    const m = /^JE-\d+-([A-Z]+)-/.exec(entryNumber || '');
    return m ? m[1] : null;
};

const isHandCode = (code: string | null): boolean => code !== null && HAND_CODES.has(code);

// A reversal a person drafted with Reverse: it keeps the original's reference
// plus '-REV', but carries a hand type code — the database's own reversals
// ('ORD-<id>-COGS-REV') are numbered RCP, never MAN/REV/EXP.
const isHandReversal = (ref: string, code: string | null): boolean => REVERSAL_REF.test(ref) && isHandCode(code);

export function isSystemEntry(entry: EntryLike): boolean {
    const ref = entry.reference_id || '';
    const code = entryTypeCode(entry.entry_number);
    if (SYSTEM_REF.test(ref)) return !isHandReversal(ref, code);
    return code !== null && !isHandCode(code);
}

// Short label key for a system entry (translated under
// ui.accounting.re.chip.kind.*). 'system' when the reference says nothing
// and only the type code marks it automatic.
export function systemEntryKind(entry: EntryLike): SystemEntryKind {
    const ref = entry.reference_id || '';
    const code = entryTypeCode(entry.entry_number);
    if (isHandReversal(ref, code)) return 'reversal';
    if (ref.startsWith('TX-')) return code !== null && PAYMENT_CODES.has(code) ? 'payment' : 'receipt';
    if (ref.startsWith('ORD-')) return 'cogs';
    if (ref.startsWith('WSO-')) return ref.includes('-INV') ? 'invoice' : 'cogs';
    if (ref.startsWith('PO-')) return 'purchase';
    if (ref.startsWith('ADJ-')) return 'stockAdj';
    if (ref.startsWith('FIFO-')) return 'revaluation';
    if (ref.startsWith('TRUEUP-')) return 'trueup';
    if (ref.startsWith('OPENING-')) return 'opening';
    switch (code) {
        case 'RCP': case 'DEP': case 'DLV': return 'receipt';
        case 'SPP': case 'WSP': case 'PAY': return 'payment';
        case 'PUR': case 'GRN': case 'OPA': return 'purchase';
        case 'ADJ': return 'stockAdj';
        default: return 'system';
    }
}

// The reference for a reversal of `original`: '<original>-REV', or
// '<original>-REV-2', '-REV-3', … when `existing` (references already in the
// ledger, e.g. from a LIKE '<original>-REV%' query) holds the earlier ones.
export function reversalReference(original: string, existing: Iterable<string>): string {
    const taken = new Set(existing);
    const base = `${original}-REV`;
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
        const candidate = `${base}-${n}`;
        if (!taken.has(candidate)) return candidate;
    }
}
