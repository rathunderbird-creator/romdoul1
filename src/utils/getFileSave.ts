// Moving an order to Get File from the Pay Status badge (Orders desktop +
// mobile, Payment Tracking). GetFileModal asks for the amount the courier
// collects first; saveGetFile saves it.
import type { Sale } from '../types';
import type { MoneyMeta } from './currency';
import type { OrderMoneyOpts } from '../context/StoreContext';

type UpdateOrder = (id: string, updates: Partial<Sale>, opts?: OrderMoneyOpts) => Promise<boolean>;

/**
 * Whether Get File opens the amount popup. Not for an order already settled
 * (its receipt stands as booked: the database keeps it on a move to Get File)
 * nor one already in Get File; those save straight away.
 */
export const getFileAsksAmount = (order: Pick<Sale, 'paymentStatus'>): boolean =>
    !['Paid', 'Settled', 'Paid/Settled', 'Get File'].includes(String(order.paymentStatus || ''));

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
 * Saves a move to Get File. A changed amount is its own save FIRST: the
 * database books a ticked courier's COD receipt from the stored total the
 * moment the order enters Get File, so the total must already be the new one.
 * Resolves false when either save was refused (updateOrder has said why).
 */
export async function saveGetFile(
    updateOrder: UpdateOrder,
    order: Sale,
    amount?: { collectUsd: number; money: MoneyMeta },
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
        paymentStatus: 'Get File',
        amountReceived: order.depositAmount || 0,
        settleDate: null as unknown as string,
        expectedPaymentStatus: order.paymentStatus,
    });
}
