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
    | 'revaluation' | 'trueup' | 'opening' | 'reversal' | 'fx' | 'system';

export type EntryLike = Pick<JournalEntry, 'reference_id' | 'entry_number'>;

// Type codes a person picks when recording an entry by hand: Journal Entries
// (MAN), the Revenue / Expense page (REV / EXP) and COD remittances (COD).
// Every other code names an automatic flow (RCP, DEP, DLV, SPP, WSP, PAY,
// PUR, GRN, ADJ, OPA, …).
const HAND_CODES: ReadonlySet<string> = new Set(['MAN', 'REV', 'EXP', 'COD']);
// Money-in flows vs money-out flows among the 'TX-' day-book entries.
const PAYMENT_CODES: ReadonlySet<string> = new Set(['SPP', 'WSP', 'PAY', 'EXP']);

// FX-REVAL-… / FX-CONV-…: riel revaluations and exchanges (Accounting ›
// Riel Revaluation, utils/fxRevaluation.ts) — built from the riel balances,
// so they are reversed, not edited.
const SYSTEM_REF = /^(TX|ORD|WSO|PO|ADJ|FIFO|TRUEUP|OPENING|FX)-/;
// 'MANREV-<original reference>' or 'MANREV-<n>-<original>' — the shape Reverse
// writes. A prefix, not a '-REV' suffix: the DB packs create and look for
// 'ORD-<id>-COGS-REV' / 'WSO-<id>-COGS-REV' themselves (whether an order's
// COGS counts as reversed), so a hand reversal must never wear that name.
const REVERSAL_REF = /^MANREV-/;

// 'JE-12-RCP-20261113-3' → 'RCP'; anything else (no number yet, or a bare
// reference shown in its place) → null.
export const entryTypeCode = (entryNumber: string | null | undefined): string | null => {
    const m = /^JE-\d+-([A-Z]+)-/.exec(entryNumber || '');
    return m ? m[1] : null;
};

const isHandCode = (code: string | null): boolean => code !== null && HAND_CODES.has(code);

// A reversal a person drafted with Reverse (reversalReference below). The
// packs' own reversals and adjustments ('ORD-<id>-COGS-REV',
// 'WSO-<id>-COGS-ADJ-<n>') keep their system prefix and stay system.
export const isHandReversal = (ref: string | null | undefined): boolean => REVERSAL_REF.test(ref || '');

export function isSystemEntry(entry: EntryLike): boolean {
    const ref = entry.reference_id || '';
    if (isHandReversal(ref)) return false;
    if (SYSTEM_REF.test(ref)) return true;
    const code = entryTypeCode(entry.entry_number);
    return code !== null && !isHandCode(code);
}

// Short label key for a system entry (translated under
// ui.accounting.re.chip.kind.*). 'system' when the reference says nothing
// and only the type code marks it automatic.
export function systemEntryKind(entry: EntryLike): SystemEntryKind {
    const ref = entry.reference_id || '';
    const code = entryTypeCode(entry.entry_number);
    if (isHandReversal(ref)) return 'reversal';
    if (ref.startsWith('TX-')) return code !== null && PAYMENT_CODES.has(code) ? 'payment' : 'receipt';
    if (ref.startsWith('ORD-')) return 'cogs';
    if (ref.startsWith('WSO-')) return ref.includes('-INV') ? 'invoice' : 'cogs';
    if (ref.startsWith('PO-')) return 'purchase';
    if (ref.startsWith('ADJ-')) return 'stockAdj';
    if (ref.startsWith('FIFO-')) return 'revaluation';
    if (ref.startsWith('FX-')) return 'fx';
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

// The reference for a reversal of `original`: 'MANREV-<original>', or
// 'MANREV-2-<original>', 'MANREV-3-…' when `existing` (the references already
// in the ledger that match reversalReferencePattern) holds the earlier ones.
export function reversalReference(original: string, existing: Iterable<string>): string {
    const taken = new Set(existing);
    const first = `MANREV-${original}`;
    if (!taken.has(first)) return first;
    for (let n = 2; ; n++) {
        const candidate = `MANREV-${n}-${original}`;
        if (!taken.has(candidate)) return candidate;
    }
}

// SQL LIKE pattern matching every reversal reference of `original` (the
// first and the numbered ones), for the query that feeds reversalReference.
export const reversalReferencePattern = (original: string): string => `MANREV-%${original}`;
