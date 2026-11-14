// One shared definition of "what may a non-admin do to this order's status /
// payment status" — the rules the single-row badges on Orders.tsx enforce via
// readOnly/disabledOptions, extracted so Bulk Edit (Orders, OM2, Payment
// Tracking) and Delivery Tracking's badge enforce the SAME rules instead of
// quietly bypassing them (audit ORD-9, PAY-1).
//
// Everything here is client-side defence-in-depth (RLS is disabled; the
// server-side project is SEC-1). Admin behaviour is unchanged by design: the
// store itself still warns admins before transitions that skip the stock flow.

import { tNow } from '../i18n/translate';

export interface OrderStatusView {
    shippingStatus?: string | null;
    paymentStatus?: string | null;
}

export interface StatusActor {
    isAdmin: boolean;
    canRestock: boolean;
}

// Mirrors the Orders.tsx row rule: 'Delivered' and 'Returned' only make sense
// once the goods have shipped; the two may flip between each other (real
// post-delivery returns, or correcting a mis-click) — stock-neutral.
// What staff see for a stored order status. Only the wording changes: the
// stored value stays 'Returned' (rules, filters, reports and the database all
// key on it). 'Returned' reads as "Returning" because at that point the parcel
// is still on its way back — it becomes stock again only at ReStock.
const ORDER_STATUS_LABELS: Record<string, string> = { Returned: 'Returning' };
export const orderStatusLabel = (status: string): string => ORDER_STATUS_LABELS[status] || status;

// The same label in the language the app is in now (status.* in the
// translation files; English gives exactly orderStatusLabel). For messages;
// filters keep using orderStatusLabel.
const STATUS_TEXT_KEYS: Record<string, string> = {
    Drafted: 'status.ordered', Confirmed: 'status.confirmed', Pending: 'status.pending', Shipped: 'status.shipped',
    Delivered: 'status.delivered', Cancelled: 'status.cancelled', Returned: 'status.returned', ReStock: 'status.restock',
    Paid: 'status.paid', Unpaid: 'status.unpaid', Partial: 'status.partial', Cancel: 'status.cancel',
};
export const orderStatusText = (status: string): string => {
    const key = STATUS_TEXT_KEYS[status];
    const v = key ? tNow(key) : '';
    return v && v !== key ? v : orderStatusLabel(status);
};

// Stored statuses whose DISPLAYED label contains `text` but whose stored value
// doesn't (e.g. "returning" -> ['Returned']), so a text filter on the stored
// column can still find what staff typed from the screen.
export const orderStatusesMatchingLabel = (text: string): string[] => {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    return Object.keys(ORDER_STATUS_LABELS).filter(s => !s.toLowerCase().includes(q) && ORDER_STATUS_LABELS[s].toLowerCase().includes(q));
};

export const POST_DISPATCH_STATUSES = ['Delivered', 'Returned'];
export const canEnterPostDispatch = (current: string, target: string): boolean =>
    current === 'Shipped' ||
    (target === 'Returned' && current === 'Delivered') ||
    (target === 'Delivered' && current === 'Returned');

export const postDispatchMessage = (current: string, target: string): string =>
    POST_DISPATCH_STATUSES.includes(current)
        ? tNow('ui.store.statusRules.alreadyPostDispatch', { current: orderStatusText(current), target: orderStatusText(target) })
        : tNow('ui.store.statusRules.shipFirst', { target: orderStatusText(target) });

// The per-current-status option locks of the Orders.tsx row badge for
// non-admins (its disabledOptions ladder), as data. 'ReStock' is handled
// separately — it is permission-gated for everyone, admins included.
export const nonAdminDisabledStatusOptions = (current: string): string[] => {
    switch (current) {
        case 'Shipped':
            return ['Drafted', 'Pending', 'Confirmed', 'Cancelled', 'Shipped'];
        case 'Delivered':
            // From Delivered only a return is allowed.
            return ['Drafted', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'];
        case 'ReStock':
            // Reopening a restocked order: Drafted only.
            return ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned', 'Cancelled'];
        default:
            return ['Delivered', 'Returned'];
    }
};

// Statuses whose rows the Orders badge renders readOnly for non-admins: the
// order has reached (or been cancelled out of) a terminal state.
const NON_ADMIN_LOCKED_STATUSES = ['ReStock', 'Returned', 'Cancelled'];

/**
 * Why this actor may NOT move this order to `target` shipping status — or
 * null when the change is allowed. Exactly the single-row badge rules:
 *   * everyone needs restock_orders to pick ReStock;
 *   * non-admins cannot touch ReStock/Returned/Cancelled or payment-Cancelled
 *     rows, cannot move Shipped/Delivered back to pre-ship statuses, and can
 *     only reach Delivered/Returned from Shipped (or flip between the two).
 */
export const statusChangeRefusal = (
    order: OrderStatusView,
    target: string,
    actor: StatusActor
): string | null => {
    const current = order.shippingStatus || 'Pending';
    if (target === 'ReStock') {
        if (!actor.canRestock) {
            return tNow('ui.store.order.noRestockPermission');
        }
        // Restocking a Returned order is exactly what restock_orders grants —
        // the one transition out of Returned a permitted non-admin may make
        // (the Restock flow handles stock, the return record and payment).
        if (current === 'Returned') return null;
    }
    if (actor.isAdmin) return null;
    if (NON_ADMIN_LOCKED_STATUSES.includes(current)) {
        return tNow('ui.store.statusRules.locked', { status: orderStatusText(current) });
    }
    if (order.paymentStatus === 'Cancel') {
        return tNow('ui.store.statusRules.paymentCancelled');
    }
    if (POST_DISPATCH_STATUSES.includes(target) && !canEnterPostDispatch(current, target)) {
        return postDispatchMessage(current, target);
    }
    if (nonAdminDisabledStatusOptions(current).includes(target)) {
        return tNow('ui.store.statusRules.cannotMove', { current: orderStatusText(current), target: orderStatusText(target) });
    }
    return null;
};

/**
 * Why this actor may NOT set this order's payment status to `target` — or
 * null when allowed. Mirrors the Orders.tsx payment badge: non-admins cannot
 * change Paid/PdFee/Cancel orders (un-paying deletes booked income and journal
 * entries), cannot touch rows in terminal shipping states, and cannot pick
 * Cancel at all.
 */
export const paymentChangeRefusal = (
    order: OrderStatusView,
    target: string,
    actor: StatusActor
): string | null => {
    if (actor.isAdmin) return null;
    const shipping = order.shippingStatus || 'Pending';
    const payment = order.paymentStatus || 'Unpaid';
    // The locked-payment check runs BEFORE the same-status early return: the
    // bulk/drawer callers are NOT no-ops for a same-status save — picking
    // "Paid" on an already-Paid row rewrites its received amount, settle date
    // and pay-by and books another receipt, exactly the rewrite the single-row
    // badge's readOnly prevents (ORD-9 review).
    if (['Paid', 'PdFee', 'Cancel'].includes(payment)) {
        return tNow('ui.store.statusRules.paymentLocked', { status: orderStatusText(payment) });
    }
    if (payment === target) return null; // no-op rows are quietly fine
    if (['ReStock', 'Drafted', 'Returned', 'Cancelled'].includes(shipping)) {
        return tNow('ui.store.statusRules.paymentAdminOnly', { status: orderStatusText(shipping) });
    }
    if (target === 'Cancel') {
        return tNow('ui.store.statusRules.cancelAdminOnly');
    }
    return null;
};

/**
 * Why this actor may NOT change this order's settle date — or null when
 * allowed. The Bulk Edit "Settled/Paid Date" field writes settleDate directly
 * (no payment-status change), but for a posted Paid/PdFee/Cancel order that
 * date IS the booked receipt's day: rewriting it is the same class of change
 * as un-paying, so it follows the same lock (ORD-9 review).
 */
export const settleDateChangeRefusal = (
    order: OrderStatusView,
    actor: StatusActor
): string | null => {
    if (actor.isAdmin) return null;
    const payment = order.paymentStatus || 'Unpaid';
    if (['Paid', 'PdFee', 'Cancel'].includes(payment)) {
        return tNow('ui.store.statusRules.settleDateAdminOnly', { status: orderStatusText(payment) });
    }
    return null;
};
