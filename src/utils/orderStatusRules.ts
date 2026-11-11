// One shared definition of "what may a non-admin do to this order's status /
// payment status" — the rules the single-row badges on Orders.tsx enforce via
// readOnly/disabledOptions, extracted so Bulk Edit (Orders, OM2, Payment
// Tracking) and Delivery Tracking's badge enforce the SAME rules instead of
// quietly bypassing them (audit ORD-9, PAY-1).
//
// Everything here is client-side defence-in-depth (RLS is disabled; the
// server-side project is SEC-1). Admin behaviour is unchanged by design: the
// store itself still warns admins before transitions that skip the stock flow.

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
export const POST_DISPATCH_STATUSES = ['Delivered', 'Returned'];
export const canEnterPostDispatch = (current: string, target: string): boolean =>
    current === 'Shipped' ||
    (target === 'Returned' && current === 'Delivered') ||
    (target === 'Delivered' && current === 'Returned');

export const postDispatchMessage = (current: string, target: string): string =>
    POST_DISPATCH_STATUSES.includes(current)
        ? `This order is already ${current}. ${current} orders cannot be changed to ${target}.`
        : `Mark the order Shipped before ${target} — set it back to Drafted and follow Confirmed → Shipped.`;

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
            return 'You do not have permission to restock orders.';
        }
        // Restocking a Returned order is exactly what restock_orders grants —
        // the one transition out of Returned a permitted non-admin may make
        // (the Restock flow handles stock, the return record and payment).
        if (current === 'Returned') return null;
    }
    if (actor.isAdmin) return null;
    if (NON_ADMIN_LOCKED_STATUSES.includes(current)) {
        return `${current} orders cannot be changed. Ask an administrator.`;
    }
    if (order.paymentStatus === 'Cancel') {
        return 'This order’s payment is cancelled — its status can only be changed by an administrator.';
    }
    if (POST_DISPATCH_STATUSES.includes(target) && !canEnterPostDispatch(current, target)) {
        return postDispatchMessage(current, target);
    }
    if (nonAdminDisabledStatusOptions(current).includes(target)) {
        return `${current} orders cannot be moved to ${target}. Ask an administrator.`;
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
    if (payment === target) return null; // no-op rows are quietly fine
    if (['Paid', 'PdFee', 'Cancel'].includes(payment)) {
        return `${payment} orders cannot have their payment changed. Ask an administrator.`;
    }
    if (['ReStock', 'Drafted', 'Returned', 'Cancelled'].includes(shipping)) {
        return `The payment of ${shipping} orders can only be changed by an administrator.`;
    }
    if (target === 'Cancel') {
        return 'Only an administrator can cancel a payment.';
    }
    return null;
};
