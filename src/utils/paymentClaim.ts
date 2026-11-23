// A Salesman never books money. When one picks Deposit, Paid or PdFee —
// from the Pay Status badge, a payment form or Payment Tracking — the save
// is converted HERE (by updateOrder) into the same gray claim the order
// form writes: the order stays Unpaid with nothing in the journal, and the
// claim waits for Admin, Customer Care or an Accountant to confirm it on
// the Orders page. Collected (and a courier-ticked Get File) book the COD
// receivable with no amount to confirm, so they stay refused instead.
import type { PaymentClaim, Sale } from '../types';
import type { MoneyMeta } from './currency';

// The claim a Salesman's booking save amounts to, or null when the save is
// not claimable (already-booked order, no claimable status, no amount) —
// the caller then refuses it as before.
export function salesmanClaimFor(
    updates: Partial<Sale>,
    existing: { paymentStatus?: string | null; total?: number } | undefined,
    by: string,
    money?: MoneyMeta | null
): PaymentClaim | null {
    // Claims attach to unbooked orders only — a booked order's money is on
    // the ledger, and only a confirmer may touch it.
    if ((existing?.paymentStatus || 'Unpaid') !== 'Unpaid') return null;
    const s = updates.paymentStatus as string | undefined;
    const status: PaymentClaim['status'] | null = s === 'Deposit' ? 'Deposit'
        : s === 'PdFee' ? 'PdFee'
        : s && ['Paid', 'Settled', 'Paid/Settled'].includes(s) ? 'Paid' : null;
    if (!status) return null;
    const amount = status === 'Deposit'
        ? Number(updates.depositAmount ?? updates.amountReceived ?? 0)
        : Number(updates.amountReceived ?? (status === 'Paid' ? existing?.total ?? 0 : 0));
    if (!(amount > 0)) return null;
    const method = status === 'Deposit' ? (updates.depositMethod || updates.paymentMethod) : updates.paymentMethod;
    const rawDate = status === 'Deposit' ? updates.depositDate : updates.settleDate;
    return {
        status,
        amount: Math.round(amount * 100) / 100,
        ...(method ? { method } : {}),
        date: rawDate ? String(rawDate).slice(0, 10) : new Date().toLocaleDateString('en-CA'),
        by,
        at: new Date().toISOString(),
        ...(money?.currency === 'KHR' && money.original_amount
            ? { currency: 'KHR' as const, original_amount: money.original_amount, exchange_rate: money.exchange_rate }
            : {}),
    };
}

// Strips everything that books money or writes the payment columns, so the
// save carries only the claim (and whatever non-payment fields rode along)
// — the same fields the order form deletes for its claims.
export function stripClaimBookingFields(updates: Partial<Sale>): void {
    delete updates.paymentStatus;
    delete updates.amountReceived;
    delete updates.settleDate;
    delete updates.depositAmount;
    delete updates.depositDate;
    delete updates.depositMethod;
    delete updates.paymentMethod;
    delete updates.codCollected;
    delete updates.codHolder;
    delete updates.postToLedger;
    delete updates.depositAccountId;
    delete updates.depositAccountName;
    delete updates.receiptReference;
    delete updates.receiptNotes;
    delete updates.expectedPaymentStatus;
}
