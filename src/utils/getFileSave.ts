// Moving an order to Get File or Collected from the Pay Status badge (Orders
// desktop + mobile, Payment Tracking). GetFileModal asks for the amount the
// courier collects first; saveGetFile saves it.
import type { Sale } from '../types';
import type { MoneyMeta } from './currency';
import type { OrderMoneyOpts } from '../context/StoreContext';

type UpdateOrder = (id: string, updates: Partial<Sale>, opts?: OrderMoneyOpts) => Promise<boolean>;

/** The two courier statuses the amount popup serves. */
export type CourierStatus = 'Get File' | 'Collected';

/**
 * Whether moving to Get File / Collected opens the amount popup. Not for an
 * order already settled (Paid, Collected, a booked Get File: its receipt
 * stands as booked, the database keeps it) nor one already at the target;
 * those save straight away. With Sales Setup's "Collected is a plain
 * status" switch on (salesSettings.collectedStatusOnly), Collected books
 * nothing, so there is no amount or holder to ask for either.
 */
export const getFileAsksAmount = (order: Pick<Sale, 'paymentStatus' | 'getFileBooked'>, target: CourierStatus = 'Get File', collectedStatusOnly = false): boolean => {
    if (target === 'Collected' && collectedStatusOnly) return false;
    const current = String(order.paymentStatus || '');
    if (current === target) return false;
    if (['Paid', 'Settled', 'Paid/Settled', 'Collected'].includes(current)) return false;
    return !(current === 'Get File' && order.getFileBooked);
};

/**
 * The order's money for an amount to collect other than what is due:
 * total = deposit + collected, the difference going into the discount (the
 * Settle form's Received Amount rule). Riel typed sets the riel price the
 * courier collects; a dollar change drops a riel price saved earlier.
 * Empty when nothing changes.
 */
export function getFileMoneyUpdates(
    order: Pick<Sale, 'total' | 'depositAmount' | 'discount' | 'customKhrAmount'>,
    collectUsd: number,
    money: MoneyMeta,
): Partial<Sale> {
    const deposit = order.depositAmount || 0;
    const total = Number(order.total) || 0;
    const due = Math.max(0, total - deposit);
    const updates: Partial<Sale> = {};
    if (Math.abs(collectUsd - due) > 0.005) {
        const newTotal = Math.round((deposit + collectUsd) * 100) / 100;
        updates.total = newTotal;
        updates.discount = Math.round(((Number(order.discount) || 0) + (total - newTotal)) * 100) / 100;
    }
    if (money.currency === 'KHR' && money.original_amount
        && Math.round(money.original_amount) !== Math.round(Number(order.customKhrAmount) || 0)) {
        updates.customKhrAmount = Math.round(money.original_amount);
    } else if (money.currency !== 'KHR' && updates.total !== undefined && order.customKhrAmount != null) {
        updates.customKhrAmount = null as unknown as number;
    }
    return updates;
}

/**
 * Saves a move to Get File (or Collected). A changed amount is its own save
 * FIRST: the database books the COD receipt from the stored total the moment
 * the order enters Get File (a ticked courier) or Collected (always), so the
 * total must already be the new one. Resolves false when either save was
 * refused (updateOrder has said why).
 */
export async function saveGetFile(
    updateOrder: UpdateOrder,
    order: Sale,
    amount?: { collectUsd: number; money: MoneyMeta; method?: string; holder?: 'courier' | 'deliveryman' },
    status: CourierStatus = 'Get File',
): Promise<boolean> {
    if (amount) {
        const moneyUpdates = getFileMoneyUpdates(order, amount.collectUsd, amount.money);
        if (Object.keys(moneyUpdates).length > 0) {
            const ok = await updateOrder(order.id, moneyUpdates, moneyUpdates.total !== undefined
                // Worked out from this screen's deposit and total: refused
                // if they have moved since.
                ? { expectMoney: { deposit: order.depositAmount || 0, total: Number(order.total) || 0 } }
                : undefined);
            if (!ok) return false;
        }
    }
    // Keep a deposit visible in Received when one was taken (as bulk edit).
    return updateOrder(order.id, {
        paymentStatus: status,
        amountReceived: order.depositAmount || 0,
        settleDate: null as unknown as string,
        expectedPaymentStatus: order.paymentStatus,
        // Collected's popup can name the Pay By (how the courier will
        // remit); the receipt still debits 1210 — the method is the income
        // row's Method and the order's Pay By. Unset says nothing, so a
        // method already on the order stands.
        ...(amount?.method ? { paymentMethod: amount.method as Sale['paymentMethod'] } : {}),
        // Who holds the money (Collected only, offered when the chart has a
        // deliveryman receivable): courier books the receipt to 1210,
        // deliveryman to 1220. Unset says nothing — courier by default.
        ...(amount?.holder ? { codHolder: amount.holder } : {}),
    },
        // An amount typed in riel rides along as the booked money's riel
        // details: updateOrder tags the income row this save books (and its
        // ledger entry) with them, so Received shows the riel — exactly as
        // the Settle form's riel does. Collected always books on entry; a
        // Get File only for a courier ticked in Sales Setup, and with no
        // row booked the tag is a no-op, so it is safe to send either way.
        amount?.money.currency === 'KHR'
            ? { money: { ...amount.money, category: 'លក់រាយ' } }
            : undefined);
}
