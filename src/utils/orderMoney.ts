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

// Balance still owed. Unchanged from the original Orders.tsx formula: a
// Deposit order always shows total-minus-deposit regardless of status;
// otherwise nothing is owed before dispatch (Drafted/Pending) or after a
// void (Cancelled/Cancel-pay/ReStock).
export const orderBalance = (order: Sale): number => {
    if (order.paymentStatus === 'Deposit') {
        return Math.max(0, order.total - (order.depositAmount || order.amountReceived || 0));
    }
    const s = order.shipping?.status;
    if (order.paymentStatus === 'Cancel' || s === 'ReStock' || s === 'Drafted' || s === 'Pending' || s === 'Cancelled') return 0;
    return order.total - (order.amountReceived || (order.paymentStatus === 'Paid' ? order.total : 0));
};
