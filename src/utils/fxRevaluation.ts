// Riel (KHR) payments, phase 3: foreign-exchange gain and loss.
//
// The books stay in USD. Each riel movement is booked at the rate of its own
// day, so a riel account's USD balance (what the ledger shows) drifts away
// from what its riel is worth today. Two entries correct that:
//
//   * Revaluation (FX-REVAL-…): at a date and rate the owner picks, every
//     riel account is brought to riel balance / rate. The difference goes to
//     Foreign Exchange Gain (Revenue · Other Revenue) or Foreign Exchange Loss
//     (Expense · Other Expense). It moves dollars only: its riel is 0.
//   * Exchange (FX-CONV-…): riel sold for dollars at the bank (or bought).
//     Selling takes the riel out at its book value — the account's average
//     rate, USD balance / riel balance — and the difference to the dollars
//     actually received is the realised gain or loss. Buying riel books it at
//     what it cost: no gain.
//
// The riel balance of an account is read from the journal itself:
//   * a line of an entry tagged KHR carries the entry's riel amount
//     (original_amount), split by USD share when several riel lines sit on
//     the same side (a riel→riel transfer has one on each side: both get it);
//   * a line of a revaluation carries 0 riel;
//   * any other line (untagged, i.e. USD — a manual journal, an old row) is
//     counted at `fallbackRate` and reported, so the owner can tag or fix it.
//
// Pure helpers, no supabase import (tests/fx-revaluation.test.mjs bundles
// this file with esbuild).
import { roundCents } from './money';
import { splitRiel } from './currency';

export const FX_REVAL_PREFIX = 'FX-REVAL-';
export const FX_CONV_PREFIX = 'FX-CONV-';
export const isFxReference = (ref?: string | null): boolean =>
    (ref || '').startsWith(FX_REVAL_PREFIX) || (ref || '').startsWith(FX_CONV_PREFIX);

export interface FxEntry {
    id: string;
    date: string;               // YYYY-MM-DD
    status: string;             // 'Posted' | 'Draft'
    reference_id: string | null;
    currency: string | null;
    original_amount: number | null;
    exchange_rate: number | null;
}
export interface FxLine { entryId: string; accountId: string; debit: number; credit: number }

export interface RielBalance {
    accountId: string;
    riel: number;               // whole riel
    usd: number;                // the ledger's USD balance (debit − credit)
    untaggedLines: number;      // lines counted at fallbackRate
    untaggedEntryIds: string[];
    draftLines: number;         // Draft lines on or before asOf, left out when postedOnly
}

// Riel balance and USD balance of each riel account, from its journal lines.
export function rielBalances(
    lines: FxLine[],
    entries: Map<string, FxEntry>,
    rielAccountIds: Iterable<string>,
    opts: { asOf?: string | null; postedOnly?: boolean; fallbackRate: number }
): Map<string, RielBalance> {
    const ids = new Set(rielAccountIds);
    const out = new Map<string, RielBalance>();
    for (const id of ids) out.set(id, { accountId: id, riel: 0, usd: 0, untaggedLines: 0, untaggedEntryIds: [], draftLines: 0 });

    // The riel lines of each entry, within the date bound.
    const byEntry = new Map<string, FxLine[]>();
    for (const l of lines) {
        if (!ids.has(l.accountId)) continue;
        const e = entries.get(l.entryId);
        if (!e) continue;
        if (opts.asOf && e.date.slice(0, 10) > opts.asOf) continue;
        if (opts.postedOnly && e.status === 'Draft') { out.get(l.accountId)!.draftLines++; continue; }
        const list = byEntry.get(l.entryId) || [];
        list.push(l);
        byEntry.set(l.entryId, list);
    }

    for (const [entryId, list] of byEntry) {
        const e = entries.get(entryId)!;
        const net = (l: FxLine) => (Number(l.debit) || 0) - (Number(l.credit) || 0);
        for (const l of list) out.get(l.accountId)!.usd += net(l);

        if ((e.reference_id || '').startsWith(FX_REVAL_PREFIX)) continue;   // dollars only

        if (e.currency === 'KHR' && e.original_amount !== null && Number.isFinite(Number(e.original_amount))) {
            for (const side of [1, -1] as const) {
                const part = list.filter(l => Math.sign(net(l)) === side);
                if (part.length === 0) continue;
                const shares = splitRiel(Number(e.original_amount), part.map(l => Math.abs(net(l))));
                part.forEach((l, i) => { out.get(l.accountId)!.riel += side * shares[i]; });
            }
            continue;
        }

        for (const l of list) {
            const b = out.get(l.accountId)!;
            b.riel += Math.round(net(l) * opts.fallbackRate);
            b.untaggedLines++;
            if (!b.untaggedEntryIds.includes(entryId)) b.untaggedEntryIds.push(entryId);
        }
    }
    for (const b of out.values()) { b.usd = roundCents(b.usd); b.riel = Math.round(b.riel); }
    return out;
}

export interface JournalLineDraft { account_id: string; debit: number; credit: number; description: string }

export interface RevaluationRow {
    accountId: string;
    riel: number;
    bookUsd: number;
    valueUsd: number;           // riel / rate
    diffUsd: number;            // valueUsd − bookUsd: + gain, − loss
}

// One row per riel account at `rate`; differences under a cent are 0.
export function revaluationRows(balances: Iterable<RielBalance>, rate: number): RevaluationRow[] {
    const rows: RevaluationRow[] = [];
    for (const b of balances) {
        const valueUsd = rate > 0 ? roundCents(b.riel / rate) : b.usd;
        const diff = roundCents(valueUsd - b.usd);
        rows.push({ accountId: b.accountId, riel: b.riel, bookUsd: b.usd, valueUsd, diffUsd: Math.abs(diff) < 0.005 ? 0 : diff });
    }
    return rows;
}

// The revaluation entry's lines: each riel account up or down by its
// difference, the net to the gain account (a credit) or the loss account (a
// debit). Empty when nothing moves.
export function revaluationLines(
    rows: RevaluationRow[],
    accounts: { gainId: string; lossId: string },
    names: { account: (id: string) => string; rateText: string }
): { lines: JournalLineDraft[]; net: number } {
    const lines: JournalLineDraft[] = [];
    let net = 0;
    for (const r of rows) {
        if (r.diffUsd === 0) continue;
        net += r.diffUsd;
        lines.push({
            account_id: r.accountId,
            debit: r.diffUsd > 0 ? r.diffUsd : 0,
            credit: r.diffUsd < 0 ? -r.diffUsd : 0,
            description: `Revalue ${names.account(r.accountId)} at ${names.rateText}`,
        });
    }
    net = roundCents(net);
    if (lines.length === 0) return { lines: [], net: 0 };
    if (net > 0) lines.push({ account_id: accounts.gainId, debit: 0, credit: net, description: `Exchange gain at ${names.rateText}` });
    else if (net < 0) lines.push({ account_id: accounts.lossId, debit: -net, credit: 0, description: `Exchange loss at ${names.rateText}` });
    return { lines, net };
}

// What `riel` of an account is worth on its books: its average rate (USD
// balance / riel balance) when both are positive, else `fallbackRate`.
export function bookValueOfRiel(riel: number, balance: { riel: number; usd: number } | undefined, fallbackRate: number): number {
    if (balance && balance.riel > 0 && balance.usd > 0) return roundCents(riel * balance.usd / balance.riel);
    return fallbackRate > 0 ? roundCents(riel / fallbackRate) : 0;
}

export type ExchangeDirection = 'sellRiel' | 'buyRiel';

export interface ExchangeInput {
    direction: ExchangeDirection;
    rielAccountId: string;
    usdAccountId: string;
    riel: number;               // riel that left / reached the riel account
    usd: number;                // dollars that reached / left the dollar account
    balance?: { riel: number; usd: number };   // the riel account before the exchange
    fallbackRate: number;
    gainId: string;
    lossId: string;
}

// The exchange entry: its lines, the riel book value taken out (selling),
// the realised gain (+) or loss (−), and the rate actually got (riel per $1).
export function exchangeLines(x: ExchangeInput, names: { riel: string; usd: string }): {
    lines: JournalLineDraft[]; bookUsd: number; gainUsd: number; rate: number;
} {
    const riel = Math.round(x.riel);
    const usd = roundCents(x.usd);
    const rate = usd > 0 ? Math.round((riel / usd) * 10000) / 10000 : 0;
    if (x.direction === 'buyRiel') {
        return {
            lines: [
                { account_id: x.rielAccountId, debit: usd, credit: 0, description: `Riel bought from ${names.usd}` },
                { account_id: x.usdAccountId, debit: 0, credit: usd, description: `Dollars exchanged into ${names.riel}` },
            ],
            bookUsd: usd, gainUsd: 0, rate,
        };
    }
    const bookUsd = bookValueOfRiel(riel, x.balance, x.fallbackRate);
    const gainUsd = roundCents(usd - bookUsd);
    const lines: JournalLineDraft[] = [
        { account_id: x.usdAccountId, debit: usd, credit: 0, description: `Dollars from riel sold (${names.riel})` },
        { account_id: x.rielAccountId, debit: 0, credit: bookUsd, description: `Riel sold at book value into ${names.usd}` },
    ];
    if (gainUsd > 0) lines.push({ account_id: x.gainId, debit: 0, credit: gainUsd, description: 'Realised exchange gain' });
    else if (gainUsd < 0) lines.push({ account_id: x.lossId, debit: -gainUsd, credit: 0, description: 'Realised exchange loss' });
    return { lines, bookUsd, gainUsd, rate };
}

// The two FX accounts: found by name, else the codes to create them under
// (4910 / 6910, or the next free code in that hundred).
export const FX_GAIN_NAME = 'Foreign Exchange Gain';
export const FX_LOSS_NAME = 'Foreign Exchange Loss';
type AccountLike = { id: string; account_code?: string | null; account_name: string; account_type: string; is_active?: boolean | null };
export function findFxAccounts<A extends AccountLike>(accounts: A[]): { gain?: A; loss?: A } {
    const active = accounts.filter(a => a.is_active !== false);
    const gain = active.find(a => a.account_type === 'Revenue' && /(foreign )?exchange gain|\bfx gain/i.test(a.account_name));
    const loss = active.find(a => a.account_type === 'Expense' && /(foreign )?exchange loss|\bfx loss/i.test(a.account_name));
    return { gain, loss };
}
export function freeAccountCode(accounts: { account_code?: string | null }[], preferred: string): string {
    const taken = new Set(accounts.map(a => String(a.account_code || '')));
    let n = Number(preferred);
    while (taken.has(String(n))) n++;
    return String(n);
}
