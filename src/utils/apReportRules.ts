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
//  · The Supplier Statement only subtracts payments applied to the bills it
//    shows. The old code subtracted EVERY payment of the supplier, including
//    deposits on unbilled or unreceived POs whose bill never appears on the
//    statement, so the closing balance dropped below what is really owed
//    (and could go negative).
import type { PurchaseOrder, SupplierPayment } from '../types';

/** The date a bill is owed from: the billed date when stored, else the order date. */
export const billDateOf = (po: Pick<PurchaseOrder, 'bill_date' | 'order_date'>): string =>
    String(po.bill_date || po.order_date || '').slice(0, 10);

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
 * A bill's outstanding balance AS AT a date: its full total minus the
 * payments made by then. A bill dated after `asAt` did not exist yet, so it
 * contributes nothing.
 */
export const outstandingAsAt = (
    po: Pick<PurchaseOrder, 'id' | 'bill_date' | 'order_date' | 'total_amount'>,
    payments: Pick<SupplierPayment, 'purchase_order_id' | 'payment_date' | 'amount'>[],
    asAt: string
): number => {
    if (billDateOf(po) > asAt) return 0;
    return (Number(po.total_amount) || 0) - paidAsAt(po.id, payments, asAt);
};

/**
 * The payments a supplier statement subtracts: only those applied to one of
 * the statement's own bills (`billIds`). A deposit on a PO that is not (yet)
 * a bill has no matching charge on the statement and must not be netted off.
 */
export const statementPayments = <P extends Pick<SupplierPayment, 'supplier_id' | 'purchase_order_id'>>(
    payments: P[],
    supplierId: string,
    billIds: ReadonlySet<string>
): P[] =>
    payments.filter(p => p.supplier_id === supplierId && !!p.purchase_order_id && billIds.has(p.purchase_order_id));
