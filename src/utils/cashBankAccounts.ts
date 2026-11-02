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
//   1. exact account-name match on the hint;
//   2. hint-family match: aba/acleda → that bank, any bank-ish wording
//      ('bank', 'transfer', 'card', 'cheque') → first bank account,
//      'cash' → Cash on Hand over other cash accounts (Petty Cash is a
//      deliberate, manually-picked account, never an automatic target);
//   3. no/unmatched hint → Cash on Hand, else the lowest account code.
// Candidates are sorted by account code so the fallback is deterministic
// instead of whatever order the chart-of-accounts query returns rows in.
export type CashBankCandidate = {
    id: string;
    account_code?: string | null;
    account_name: string;
    account_type: string;
};

export function pickCashBankAccount<T extends CashBankCandidate>(pool: T[], payBy?: string | null): T | undefined {
    const candidates = pool
        .filter(a => a.account_type === 'Asset' && /cash|bank/i.test(a.account_name))
        .sort((a, b) => (a.account_code || '').localeCompare(b.account_code || ''));
    if (candidates.length === 0) return undefined;
    const find = (re: RegExp) => candidates.find(a => re.test(a.account_name.toLowerCase()));
    const hint = (payBy || '').trim().toLowerCase();
    if (hint) {
        const exact = candidates.find(a => a.account_name.toLowerCase() === hint);
        if (exact) return exact;
        let hinted: T | undefined;
        if (hint.includes('aba')) hinted = find(/aba/) || find(/bank/);
        else if (hint.includes('acleda')) hinted = find(/acleda/) || find(/bank/);
        else if (/bank|transfer|card|cheque/.test(hint)) hinted = find(/bank/);
        else if (hint.includes('cash')) hinted = find(/cash on hand/) || find(/cash/);
        if (hinted) return hinted;
    }
    return find(/cash on hand/) || candidates[0];
}
