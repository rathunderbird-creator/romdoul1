// Resolves which cash/bank asset account a payment lands in (debit for money
// received, credit for money paid out) when the user didn't pick one
// explicitly. Shared by every auto-posting flow so they all match the same
// way; before this helper each flow took "the first active asset whose name
// contains cash or bank" in raw row order, which happened to be 1001 Petty
// Cash on existing instances — so every receipt debited Petty Cash no matter
// how it was actually paid.
//
// `payBy` is the payment's method/account hint as the transaction logs it
// ('Bank', 'Cash', 'ABA', an exact account name, …). Resolution order:
//   1. exact account-name match on the hint (a deliberately picked account
//      always wins — a riel account included, unless `currency` is given
//      and the name is in the other currency);
//   2. with `preferBank` (revenue flows — retail/wholesale receipts,
//      deposits, delivery fees): the first bank account, whatever the
//      Method says — all revenue lands in the bank account by default
//      (owner's rule: takings are deposited to ABA, so a 'Cash' Method is
//      still bank money by the time it's bookkept);
//   3. hint-family match: aba/acleda → that bank, any bank-ish wording
//      ('bank', 'transfer', 'card', 'cheque') → first bank account,
//      'cash' → Cash on Hand over other cash accounts (Petty Cash is a
//      deliberate, manually-picked account, never an automatic target);
//   4. no/unmatched hint → Cash on Hand, else the lowest account code.
// Candidates are sorted by account code so the fallback is deterministic
// instead of whatever order the chart-of-accounts query returns rows in.
//
// Riel accounts (a name with KHR / riel / ៛, e.g. 1002 "Cash on Hand (KHR)",
// 1011 "Bank Account ABA (KHR)" from migrations/add_khr_currency.sql) take
// part in steps 2-4 only when `currency: 'KHR'` is asked for, and then only
// riel accounts do. A USD payment never falls back to a riel account: with
// no USD cash/bank account the result is undefined. The SQL twin
// wp_internal.wp_cash_bank_match skips them the same way.
import { isKhrAccountName, type Currency } from './currency';

export type CashBankCandidate = {
    id: string;
    account_code?: string | null;
    account_name: string;
    account_type: string;
};

const isCashBank = (a: CashBankCandidate) => a.account_type === 'Asset' && /cash|bank/i.test(a.account_name);
const byCode = <T extends CashBankCandidate>(a: T, b: T) => (a.account_code || '').localeCompare(b.account_code || '');

export function pickCashBankAccount<T extends CashBankCandidate>(
    pool: T[],
    payBy?: string | null,
    opts?: { preferBank?: boolean; currency?: Currency }
): T | undefined {
    const all = pool.filter(isCashBank).sort(byCode);
    if (all.length === 0) return undefined;
    const hint = (payBy || '').trim().toLowerCase();
    const wantKhr = opts?.currency === 'KHR';
    if (hint) {
        // A stored account name resolves to that account whatever its
        // currency, unless the caller asked for one currency explicitly.
        const exact = all.find(a => a.account_name.toLowerCase() === hint
            && (!opts?.currency || isKhrAccountName(a.account_name) === wantKhr));
        if (exact) return exact;
    }
    const candidates = all.filter(a => isKhrAccountName(a.account_name) === wantKhr);
    if (candidates.length === 0) return undefined;
    const find = (re: RegExp) => candidates.find(a => re.test(a.account_name.toLowerCase()));
    if (opts?.preferBank) {
        const bank = find(/aba/) || find(/bank/);
        if (bank) return bank;
    }
    if (hint) {
        let hinted: T | undefined;
        if (hint.includes('aba')) hinted = find(/aba/) || find(/bank/);
        else if (hint.includes('acleda')) hinted = find(/acleda/) || find(/bank/);
        else if (/bank|transfer|card|cheque/.test(hint)) hinted = find(/bank/);
        else if (hint.includes('cash')) hinted = find(/cash on hand/) || find(/cash/);
        if (hinted) return hinted;
    }
    return find(/cash on hand/) || candidates[0];
}

// The "Deposited into" / "Received into" default of the retail payment
// modals (Settle, Deposit, Delivery Fee, Record Receipt): the preferred id
// when it is still listed, an exact name match on the hint, a cash account
// for a cash hint (with `cashHint`), else the first bank account, else the
// first account — in account-code order and in the asked currency only, so
// a USD payment never opens on a riel account.
export function defaultCashBankAccountId<T extends CashBankCandidate>(
    accounts: T[],
    opts?: { preferredId?: string | null; hint?: string | null; cashHint?: boolean; currency?: Currency }
): string {
    const all = accounts.filter(isCashBank).sort(byCode);
    const wantKhr = opts?.currency === 'KHR';
    const pool = all.filter(a => isKhrAccountName(a.account_name) === wantKhr);
    // With a currency given, the preferred id and the exact-name hint count
    // only inside that currency: a riel row's hint is often a USD account's
    // name (pay_by 'Cash' is the USD cash account on Romdoul2/3), and a USD
    // receipt never opens on a riel account. Without one, as before.
    const scope = opts?.currency ? pool : all;
    if (opts?.preferredId && scope.some(a => a.id === opts.preferredId)) return opts.preferredId;
    const hint = (opts?.hint || '').trim().toLowerCase();
    if (hint) {
        const exact = scope.find(a => a.account_name.toLowerCase() === hint);
        if (exact) return exact.id;
    }
    const pick = (opts?.cashHint && hint.includes('cash') ? pool.find(a => /cash/i.test(a.account_name)) : undefined)
        || pool.find(a => a.account_name.toLowerCase().includes('bank'))
        || pool[0];
    return pick?.id || '';
}

// The same kind of account (cash → cash, bank → bank) in the other
// currency, for a currency toggle next to an account picker. undefined when
// the store has no account in that currency.
export function counterpartAccount<T extends CashBankCandidate>(
    accounts: T[],
    currentId: string | null | undefined,
    target: Currency
): T | undefined {
    const all = accounts.filter(isCashBank).sort(byCode);
    const current = all.find(a => a.id === currentId);
    if (current && (isKhrAccountName(current.account_name) ? 'KHR' : 'USD') === target) return current;
    const family = current && /bank|aba|acleda/i.test(current.account_name) ? 'bank' : (current ? 'cash' : 'bank');
    const pool = all.filter(a => isKhrAccountName(a.account_name) === (target === 'KHR'));
    const sameFamily = pool.find(a => (family === 'bank') === /bank|aba|acleda/i.test(a.account_name));
    return sameFamily || pickCashBankAccount(pool, family, { preferBank: family === 'bank', currency: target });
}

// Picker order: USD accounts by code, then riel accounts by code. The
// pickers render the riel group under an <optgroup label="Riel (KHR)">.
export function sortCashBankForPicker<T extends { account_code?: string | null; account_name: string }>(accounts: T[]): T[] {
    return [...accounts].sort((a, b) => {
        const ka = isKhrAccountName(a.account_name) ? 1 : 0;
        const kb = isKhrAccountName(b.account_name) ? 1 : 0;
        return ka - kb || (a.account_code || '').localeCompare(b.account_code || '');
    });
}

export const splitByCurrency = <T extends { account_name: string }>(accounts: T[]): { usd: T[]; khr: T[] } => ({
    usd: accounts.filter(a => !isKhrAccountName(a.account_name)),
    khr: accounts.filter(a => isKhrAccountName(a.account_name)),
});
