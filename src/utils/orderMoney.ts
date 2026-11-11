// Canonical revenue/collection rule for a Sale — the ONE definition used by
// Orders.tsx (desktop table + mobile footer), Dashboard 2 and Orders
// Management 2. Money totals must never be computed ad hoc per screen again.
//
// Root cause of the desktop-vs-mobile totals mismatch (fixed here): the
// desktop footer counted every order except a Cancel-paid or ReStock one
// (so Pending/Drafted totals leaked into "booked revenue"), while the
// mobile footer and Dashboard 2 only counted Confirmed/Shipped/Delivered.
// A Pending or Drafted order therefore inflated the desktop figure but not
// the mobile one. Confirmed live 2026-09-08: a $14 Pending order was the
// exact gap between the two totals that day.
//
// Adopted rule: an order counts toward money totals (booked revenue, cash
// collected, pieces sold) only once it is Confirmed, Shipped or Delivered —
// a Pending order is not yet a firm commitment and a Drafted one isn't a
// real order yet. Cancelled/Returned/ReStock never count. This does not
// change `orderBalance` ("Owed"), whose existing rule already excluded
// Drafted/Pending/Cancelled — that formula was already correct and is kept
// verbatim so no other screen using it regresses.
import type { Sale } from '../types';

export const REVENUE_STATUSES = ['Confirmed', 'Shipped', 'Delivered'] as const;

// True once an order is a firm, uncancelled commitment — the gate for every
// money total (booked revenue, cash collected, pieces sold).
export const isRevenueOrder = (order: Sale): boolean =>
    REVENUE_STATUSES.includes((order.shipping?.status || '') as typeof REVENUE_STATUSES[number]) &&
    order.paymentStatus !== 'Cancel';

// This order's contribution to "booked revenue" (0 if not yet a commitment).
export const orderRevenue = (order: Sale): number => (isRevenueOrder(order) ? order.total : 0);

// This order's contribution to "cash collected" (0 if not yet a commitment).
export const orderCollected = (order: Sale): number =>
    isRevenueOrder(order) ? (order.amountReceived || (order.paymentStatus === 'Paid' ? order.total : 0)) : 0;

// Pieces sold, counted only for orders that count toward revenue.
export const orderRevenuePieces = (order: Sale): number =>
    isRevenueOrder(order) ? order.items.reduce((s, item) => s + item.quantity, 0) : 0;

// Balance still owed — "money actually still expected" (DSH-3).
//
// Rule: a voided order owes nothing, whatever its payment status. The void
// list is Cancelled, Returned and ReStock — a Returned order (customer
// refused the goods) and a Cancelled order that had taken a deposit were
// previously still counted as owing, which inflated the Dashboard's
// Outstanding KPI, the daily collected-vs-outstanding chart and each
// salesman's/page's Outstanding with money that will never be collected.
// A Deposit order that is still live keeps its original behaviour: it owes
// total-minus-deposit even while Drafted/Pending, because taking a deposit
// makes it a firm commitment.
export const orderBalance = (order: Sale): number => {
    const s = order.shipping?.status;
    const voided = s === 'Cancelled' || s === 'Returned' || s === 'ReStock';
    if (order.paymentStatus === 'Deposit') {
        if (voided) return 0;
        return Math.max(0, order.total - (order.depositAmount || order.amountReceived || 0));
    }
    // PdFee: the customer refused the goods and paid only the delivery fee, so
    // nothing more is owed — same as Cancel.
    if (order.paymentStatus === 'Cancel' || order.paymentStatus === 'PdFee' || voided || s === 'Drafted' || s === 'Pending') return 0;
    return order.total - (order.amountReceived || (order.paymentStatus === 'Paid' ? order.total : 0));
};
