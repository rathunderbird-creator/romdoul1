// Pure rules behind Purchase Reports (PRO-5): what AP Aging and the Supplier
// Statement must count, kept free of React/Supabase so they're unit-testable
// (tests/ap-report-rules.test.mjs).
//
// Rules implemented:
//  · AP Aging honours its "As at" date — a bill dated after the as-at date is
//    not owed yet as of that date, and a payment made after the as-at date
//    has not reduced the balance yet as of that date. The old code used
//    today's amount_paid and included every bill regardless of date, so a
//    month-end aging was wrong whenever anything happened since.
//  · A payable arises when the goods are RECEIVED (that is when the ledger
//    credits A/P, see postPurchaseReceiptEntry) — so a received-but-unbilled
//    PO is owed from its receive date (the receipt journal entry's date, the
//    PO row has no received-at column), not backdated to its order date.
//  · A payment made before the bill is owed (a prepayment) shows as a CREDIT
//    as at that date instead of silently vanishing.
//  · Payments recorded before the supplier_payments table existed only set
//    amount_paid on the PO. The part of amount_paid that no payment row
//    explains is reconciled in as an undated payment, so a legacy-paid bill
//    doesn't reappear as outstanding.
//  · The Supplier Statement nets off a payment only when its charge is on the
//    statement too (any received PO of the supplier, or a payment not linked
//    to a PO at all). A deposit on an unreceived PO has no matching charge,
//    so netting it off understated (even negated) what is really owed.
import type { PurchaseOrder, SupplierPayment } from '../types';

/** The date a bill is owed from: the billed date when stored, else the order date. */
export const billDateOf = (po: Pick<PurchaseOrder, 'bill_date' | 'order_date'>): string =>
    String(po.bill_date || po.order_date || '').slice(0, 10);

/**
 * The date the payable actually arose: the billed date when stored, else the
 * RECEIVE date when known (the 'PO-<id>' receipt journal entry's date — the
 * ledger credits A/P on that day), else the order date as a last resort. This
 * keeps an as-at aging reconcilable to the A/P ledger balance: a PO ordered in
 * June and received in September is not owed in July.
 */
export const owedFromDateOf = (
    po: Pick<PurchaseOrder, 'bill_date' | 'order_date'>,
    receiptDate?: string | null
): string =>
    String(po.bill_date || receiptDate || po.order_date || '').slice(0, 10);

/** Sum of the payments applied to this PO on or before `asAt`. */
export const paidAsAt = (
    poId: string,
    payments: Pick<SupplierPayment, 'purchase_order_id' | 'payment_date' | 'amount'>[],
    asAt: string
): number =>
    payments.reduce((s, p) =>
        s + (p.purchase_order_id === poId && String(p.payment_date || '').slice(0, 10) <= asAt
            ? (Number(p.amount) || 0)
            : 0), 0);

/**
 * The part of po.amount_paid that no supplier_payments row explains: payments
 * recorded before the payments table existed (savePurchaseOrder accepts
 * amount_paid directly). Treated as an UNDATED payment that counts at every
 * as-at date — the alternative, ignoring it, made long-settled legacy bills
 * reappear as fully outstanding in AP Aging while the Accounts Payable page
 * (total − amount_paid) showed them paid.
 */
export const legacyPaidOf = (
    po: Pick<PurchaseOrder, 'id' | 'amount_paid'>,
    payments: Pick<SupplierPayment, 'purchase_order_id' | 'payment_date' | 'amount'>[]
): number => {
    const explained = payments.reduce((s, p) =>
        s + (p.purchase_order_id === po.id ? (Number(p.amount) || 0) : 0), 0);
    return Math.max((Number(po.amount_paid) || 0) - explained, 0);
};

/**
 * A bill's outstanding balance AS AT a date: its full total minus the
 * payments made by then (dated rows plus the undated legacy remainder).
 * A bill not yet owed as of `asAt` contributes only its payments, as a
 * negative balance — a prepayment is a CREDIT as at that date, not nothing.
 * `receiptDate` is the PO's receipt journal entry date, when known (see
 * owedFromDateOf).
 */
export const outstandingAsAt = (
    po: Pick<PurchaseOrder, 'id' | 'bill_date' | 'order_date' | 'total_amount' | 'amount_paid'>,
    payments: Pick<SupplierPayment, 'purchase_order_id' | 'payment_date' | 'amount'>[],
    asAt: string,
    receiptDate?: string | null
): number => {
    const paid = paidAsAt(po.id, payments, asAt) + legacyPaidOf(po, payments);
    if (owedFromDateOf(po, receiptDate) > asAt) return -paid;
    return (Number(po.total_amount) || 0) - paid;
};

/**
 * The payments a supplier statement subtracts: those applied to one of the
 * statement's own charges (`chargePoIds` — every received PO it lists), plus
 * payments not linked to any PO (supplier_payments.purchase_order_id is
 * nullable; a supplier-level payment is still money paid to that supplier).
 * A deposit on a PO that is NOT charged on the statement (Draft/Sent) has no
 * matching charge and must not be netted off.
 */
export const statementPayments = <P extends Pick<SupplierPayment, 'supplier_id' | 'purchase_order_id'>>(
    payments: P[],
    supplierId: string,
    chargePoIds: ReadonlySet<string>
): P[] =>
    payments.filter(p => p.supplier_id === supplierId
        && (!p.purchase_order_id || chargePoIds.has(p.purchase_order_id)));
