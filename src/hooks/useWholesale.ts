import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { WholesaleOrder, WholesaleOrderItem, WholesaleCustomer, CustomerPayment } from '../types';
import { useToast } from '../context/ToastContext';
import { dayKeyFromDate } from '../utils/dateRange';
import { createInFlightGuard } from '../utils/inFlightGuard';
import { createRetryKeys } from '../utils/retryKey';
import { callDbFunction, noticesOf } from '../utils/dbFunctions';
import { fetchAll } from '../utils/fetchAll';
import { isMissingTableError, errMessage } from '../utils/supabaseErrors';
import type { MoneyMeta } from '../utils/currency';
import { findTransactionIdsByMarker, resolveCashBankAccount, tagRows, tagTransactionsAndEntries } from '../utils/currencyTags';

// Stock, payments and the books for wholesale orders move inside the
// database (migrations/add_wholesale_procurement_functions.sql): each save is
// one function, in one transaction, that locks the order, re-checks it and
// either does everything or nothing. The ledger side is unchanged — creating
// an order books a Draft COGS entry (Dr Cost of Goods Sold / Cr Inventory,
// 'WSO-<id>-COGS') and a Draft invoice entry (Dr A/R / Cr Sales,
// 'WSO-<id>-INV'); each payment books a Draft receipt (Dr cash / Cr A/R).
const customerPaymentGuard = createInFlightGuard();
const customerPaymentKeys = createRetryKeys();

// The order shape the database functions take (empty strings for unset
// optional fields; the function stores them as NULL).
const orderPayload = (o: { invoice_number?: string; customer_name?: string; customer_phone?: string; warehouse_id?: string; order_date?: string; due_date?: string; status?: string; notes?: string }) => ({
    invoice_number: o.invoice_number || '',
    customer_name: o.customer_name || '',
    customer_phone: o.customer_phone || '',
    warehouse_id: o.warehouse_id || '',
    order_date: o.order_date || '',
    due_date: o.due_date || '',
    status: o.status || '',
    notes: o.notes || '',
});
const itemsPayload = (items: Partial<WholesaleOrderItem>[]) => items.map(i => ({
    product_id: i.product_id || '',
    product_name: i.product_name || '',
    quantity: i.quantity || 0,
    unit_price: i.unit_price || 0,
}));
const showNotices = (showToast: (msg: string, kind: 'success' | 'error' | 'info') => void, result: unknown) => {
    for (const n of noticesOf(result)) showToast(n, 'info');
};

// Mirror of useProcurement, but for customer credit sales (Accounts Receivable).
export const useWholesale = () => {
    const { showToast } = useToast();
    const [wholesaleOrders, setWholesaleOrders] = useState<WholesaleOrder[]>([]);
    const [customers, setCustomers] = useState<WholesaleCustomer[]>([]);
    const [customerPayments, setCustomerPayments] = useState<CustomerPayment[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [tableMissing, setTableMissing] = useState(false);

    // Flat feed of every payment, independent of which order it settled —
    // mirror of fetchSupplierPayments in useProcurement. wholesale_orders has
    // no direct customer FK (customer_name is denormalized onto the order
    // itself), so the join is through the order rather than a customer row.
    const fetchCustomerPayments = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            // Paged (fetchAll): the payments ledger and per-customer balances
            // sum this list, so it must not stop at the ~1000-row cap. The
            // unique id breaks payment_date/created_at ties for a stable order.
            const data = await fetchAll<CustomerPayment>((from, to) => supabase
                .from('customer_payments')
                .select('*, wholesale_order:wholesale_orders(*)')
                .order('payment_date', { ascending: false })
                .order('created_at', { ascending: false })
                .order('id', { ascending: true })
                .range(from, to), 1000, { label: 'useWholesale.fetchCustomerPayments' });
            setCustomerPayments(data);
        } catch (error: any) {
            console.error('Failed to fetch customer payments:', error);
            showToast('Failed to fetch customer payments: ' + error.message, 'error');
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, [showToast]);

    const fetchWholesaleOrders = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            // Paged (fetchAll): Sales/Outstanding/Overdue totals, per-customer
            // balances and A/R are summed from this list, so the oldest unpaid
            // invoices must not fall off the ~1000-row cap.
            try {
                const data = await fetchAll<WholesaleOrder>((from, to) => supabase
                    .from('wholesale_orders')
                    .select('*, items:wholesale_order_items(*), payments:customer_payments(*)')
                    // order_date is a plain date, so same-day orders tie — break the tie
                    // with created_at so the newest transaction is always on top,
                    // then with the unique id for a stable page order.
                    .order('order_date', { ascending: false })
                    .order('created_at', { ascending: false })
                    .order('id', { ascending: true })
                    .range(from, to), 1000, { label: 'useWholesale.fetchWholesaleOrders' });
                setTableMissing(false);
                setWholesaleOrders(data);
            } catch (error) {
                // Only a missing relation means "migration hasn't been run yet".
                // The paged load makes several sequential requests, so one
                // transient network blip mid-paging must not discard the rows
                // already on screen or flip the UI into the migration banner.
                if (isMissingTableError(error)) {
                    setTableMissing(true);
                    setWholesaleOrders([]);
                } else {
                    console.error('Failed to fetch wholesale orders:', error);
                    showToast('Failed to fetch wholesale orders: ' + errMessage(error), 'error');
                }
            }
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, [showToast]);

    // Create a wholesale credit sale: stock leaves the company now, money comes
    // later. One database function (create_wholesale_order) checks the stock
    // (summed per product, company-wide and in the warehouse), writes the order
    // and its lines, takes the stock out, logs the 'out' movements and books the
    // Draft COGS (Dr COGS / Cr Inventory, 'WSO-<id>-COGS') and invoice
    // (Dr A/R / Cr Sales, 'WSO-<id>-INV') entries — all or nothing.
    const createWholesaleOrder = useCallback(async (
        order: Partial<WholesaleOrder>,
        items: Partial<WholesaleOrderItem>[],
        createdBy?: string
    ) => {
        try {
            const orderId = await callDbFunction<string>('create_wholesale_order', {
                p_order: orderPayload(order),
                p_items: itemsPayload(items),
                p_created_by: createdBy || 'System',
                p_today: dayKeyFromDate(new Date()),
            }, 'Wholesale orders');
            showToast('Wholesale order created', 'success');
            await fetchWholesaleOrders(true);
            return orderId;
        } catch (error: any) {
            console.error('Failed to create wholesale order:', error);
            showToast('Failed to create wholesale order: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchWholesaleOrders]);

    // Edit an existing order (Admin only, enforced in the UI). The database
    // function works from the order as it is NOW (not this screen's copy):
    // puts its current lines' stock back, takes the edited lines out, re-logs
    // the movements, re-books the COGS entry and handles the invoice entry
    // (Draft → re-booked at the new total, in place once payments exist;
    // Posted → only while the total is unchanged). Refused for a cancelled
    // order; any failure leaves the order exactly as it was.
    const updateWholesaleOrder = useCallback(async (
        order: WholesaleOrder,
        updates: { customer_name: string; customer_phone?: string; warehouse_id?: string; order_date: string; due_date?: string; status?: WholesaleOrder['status']; invoice_number?: string; notes?: string },
        items: Partial<WholesaleOrderItem>[],
        editedBy?: string
    ) => {
        try {
            if (order.status === 'Cancelled') throw new Error('Cannot edit a cancelled order');
            const result = await callDbFunction<unknown>('update_wholesale_order', {
                p_id: order.id,
                p_updates: orderPayload(updates),
                p_items: itemsPayload(items),
                p_edited_by: editedBy || 'System',
                p_today: dayKeyFromDate(new Date()),
            }, 'Editing wholesale orders');
            showNotices(showToast, result);
            showToast('Wholesale order updated', 'success');
            await fetchWholesaleOrders(true);
        } catch (error: any) {
            console.error('Failed to update wholesale order:', error);
            showToast('Failed to update wholesale order: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchWholesaleOrders]);

    // Delete an order: its stock goes back (unless it was cancelled), its
    // movements, payments (with their Income rows and ledger entries) and its
    // COGS and invoice entries go too — in one transaction. An order another
    // tab already deleted counts as deleted.
    const deleteWholesaleOrder = useCallback(async (order: WholesaleOrder) => {
        try {
            const result = await callDbFunction<unknown>('delete_wholesale_order', { p_id: order.id }, 'Deleting wholesale orders');
            showNotices(showToast, result);
            showToast('Wholesale order deleted', 'success');
            await fetchWholesaleOrders(true);
        } catch (error: any) {
            console.error('Failed to delete wholesale order:', error);
            showToast('Failed to delete wholesale order: ' + error.message, 'error');
            await fetchWholesaleOrders(true);
            throw error;
        }
    }, [showToast, fetchWholesaleOrders]);

    // Record a customer payment against an order (mirror of recordSupplierPayment).
    // One database function writes the payment, the order's amount paid and
    // payment status, the Income row (Income & Expense, tagged '#WSP-<id>' so
    // deleting the payment finds it) and its Draft ledger entry (Dr cash/bank /
    // Cr A/R, or Cr Sales for an order from before invoice entries) — all or
    // nothing, so a 'Failed' payment was never half saved. The payment's id
    // is picked here and kept when the call fails: if the network dropped
    // after the database saved it, the retry (same order, amount and details)
    // sends the same id and the database reports the earlier payment instead
    // of recording it again. More than the balance still owed is refused.
    // money: the riel received (amount is its USD); recorded on the payment,
    // its Income row and its entry after the save — kept out of the retry
    // signature, as it is a tag on the same payment.
    const recordCustomerPayment = useCallback(async (orderId: string, amount: number, paymentMethod: string, notes: string, paymentDate?: string, receivedBy?: string, receivedInAccountId?: string, receivedInAccountName?: string, money?: MoneyMeta) => {
        const signature = JSON.stringify([orderId, amount, paymentMethod, notes, paymentDate, receivedBy, receivedInAccountId, receivedInAccountName]);
        const [paymentId] = customerPaymentKeys.take(signature);
        // No account picked: pick it here in the payment's currency, so a USD
        // receipt never lands on a riel account (the database would pick by
        // name otherwise; same rules). Only the id is filled: the name stays
        // as the caller gave it, because the database writes the Income row's
        // pay_by from it (falling back to the method), and an account name
        // there would show one bank as two (PR #229).
        if (!receivedInAccountId) {
            const acc = await resolveCashBankAccount(receivedInAccountName || paymentMethod, { preferBank: true, currency: money?.currency });
            if (acc) receivedInAccountId = acc.id;
        }
        try {
            const result = await callDbFunction<{ already_recorded?: boolean }>('record_customer_payment', {
                p_order_id: orderId,
                p_amount: Number(amount),
                p_method: paymentMethod || '',
                p_notes: notes || '',
                p_pay_date: paymentDate || dayKeyFromDate(new Date()),
                p_received_by: receivedBy || null,
                p_account_id: receivedInAccountId || null,
                p_account_name: receivedInAccountName || null,
                p_payment_id: paymentId,
            }, 'Recording payments');
            customerPaymentKeys.release(signature);
            if (money?.currency === 'KHR') {
                // Best effort, never fails the payment (a store without
                // add_khr_currency.sql skips it silently).
                await tagRows('customer_payments', { ids: [paymentId] }, money);
                const txIds = await findTransactionIdsByMarker('#WSP-' + paymentId.slice(0, 8), 'លក់ដុំ');
                await tagTransactionsAndEntries(txIds, money);
            }
            showNotices(showToast, result);
            showToast(result?.already_recorded ? 'This payment had already been saved — it was not recorded twice' : 'Payment recorded', 'success');
            await fetchWholesaleOrders(true);
            await fetchCustomerPayments(true);
        } catch (error: any) {
            console.error('Failed to record payment:', error);
            showToast('Failed to record payment: ' + error.message, 'error');
            // The payment may have been saved even so (a lost reply): show the
            // order as it is now.
            await fetchWholesaleOrders(true);
            await fetchCustomerPayments(true);
            throw error;
        }
    }, [showToast, fetchWholesaleOrders, fetchCustomerPayments]);

    // Change an order's status, decided by the database from the order as it
    // is now. Cancelling returns the stock, removes the logged stock-out
    // movements and takes the COGS and invoice entries off the books (an
    // order whose payments settle its invoice must have them deleted first);
    // a second Cancel is refused, so stock is never returned twice. Open ->
    // Delivered is a plain status update. A cancelled order stays cancelled.
    const updateWholesaleOrderStatus = useCallback(async (order: WholesaleOrder, status: WholesaleOrder['status']) => {
        try {
            const result = await callDbFunction<unknown>('set_wholesale_order_status', { p_id: order.id, p_status: status }, 'Changing wholesale order status');
            showNotices(showToast, result);
            showToast(status === 'Cancelled' ? 'Order cancelled — stock returned' : `Order marked ${status}`, 'success');
            await fetchWholesaleOrders(true);
        } catch (error: any) {
            showToast('Failed to update order status: ' + error.message, 'error');
            await fetchWholesaleOrders(true);
            throw error;
        }
    }, [showToast, fetchWholesaleOrders]);

    const recordCustomerPaymentOnce = useCallback((...args: Parameters<typeof recordCustomerPayment>) =>
        customerPaymentGuard(JSON.stringify(args), () => recordCustomerPayment(...args)), [recordCustomerPayment]);

    // Delete a customer payment and revert the order's paid amount (mirror of
    // deleteSupplierPayment), removing its Income row and ledger entry — in
    // one transaction. A payment another tab already deleted counts as deleted.
    const deleteCustomerPayment = useCallback(async (paymentId: string) => {
        try {
            await callDbFunction<unknown>('delete_customer_payment', { p_payment_id: paymentId }, 'Deleting payments');
            showToast('Payment deleted', 'success');
            await fetchWholesaleOrders(true);
            await fetchCustomerPayments(true);
        } catch (error: any) {
            showToast('Failed to delete payment: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchWholesaleOrders, fetchCustomerPayments]);

    // --- Customer directory (mirror of suppliers) ---
    const fetchCustomers = useCallback(async () => {
        try {
            // Paged (fetchAll); names can tie, so the unique id breaks the tie.
            const data = await fetchAll<WholesaleCustomer>((from, to) => supabase
                .from('wholesale_customers').select('*')
                .order('name', { ascending: true })
                .order('id', { ascending: true })
                .range(from, to), 1000, { label: 'useWholesale.fetchCustomers' });
            setCustomers(data);
        } catch (error) {
            console.error('Failed to fetch wholesale customers:', error);
        }
    }, []);

    const saveCustomer = useCallback(async (customer: Partial<WholesaleCustomer>) => {
        try {
            const payload = {
                name: customer.name,
                contact_name: customer.contact_name || null,
                email: customer.email || null,
                phone: customer.phone || null,
                address: customer.address || null,
                note: customer.note || null,
                is_active: customer.is_active ?? true
            };
            if (customer.id) {
                const { error } = await supabase.from('wholesale_customers').update(payload).eq('id', customer.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('wholesale_customers').insert([payload]);
                if (error) throw error;
            }
            showToast(customer.id ? 'Customer updated' : 'Customer added', 'success');
            await fetchCustomers();
        } catch (error: any) {
            showToast('Failed to save customer: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchCustomers]);

    const deleteCustomer = useCallback(async (id: string) => {
        try {
            const { error } = await supabase.from('wholesale_customers').delete().eq('id', id);
            if (error) throw error;
            showToast('Customer deleted', 'success');
            await fetchCustomers();
        } catch (error: any) {
            showToast('Failed to delete customer: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchCustomers]);

    // Next sequential invoice number (WO-0001, WO-0002, …): highest numeric
    // suffix among existing invoices with this prefix, plus one. The prefix
    // comes from Wholesale Setup (default WO); manually typed invoices in
    // other formats are ignored by the pattern and never disturbed.
    const nextInvoiceNumber = useCallback(async (prefix: string = 'WO'): Promise<string> => {
        const p = (prefix || 'WO').trim().replace(/-+$/, '') || 'WO';
        try {
            // Highest numeric suffix computed SERVER-SIDE-ordered, never from a
            // client scan of every matching row (the old full paged scan made
            // one sequential request per 1000 invoices on every save and, past
            // the pager's 50k ceiling, silently computed the max from a prefix
            // of the rows — which could repeat an existing number). Within one
            // digit-LENGTH class ("WO-____" = exactly four characters after the
            // dash), lexicographic order equals numeric order, so each class's
            // max sits at the top of a descending sort. Classes of 1..10 digits
            // are probed in parallel: a constant ten small requests however
            // large the table grows. (A same-second collision between two users
            // remains possible until the database enforces uniqueness — that
            // needs a migration.)
            const classes = await Promise.all(Array.from({ length: 10 }, (_, i) => supabase
                .from('wholesale_orders')
                .select('invoice_number')
                .like('invoice_number', `${p}-${'_'.repeat(i + 1)}`)
                .order('invoice_number', { ascending: false })
                .limit(200)));
            const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = new RegExp(`^${escaped}-(\\d+)$`, 'i');
            let max = 0;
            for (const { data, error } of classes) {
                if (error) throw error;
                // The first digits-only value in the descending page is this
                // class's numeric max; same-length values with other characters
                // sort above the digits and are skipped by the pattern.
                for (const r of data || []) {
                    const m = String(r.invoice_number || '').match(pattern);
                    if (m) { max = Math.max(max, parseInt(m[1], 10)); break; }
                }
            }
            return `${p}-${String(max + 1).padStart(4, '0')}`;
        } catch (e) {
            console.error('Failed to compute next invoice number:', e);
            // Timestamp fallback still yields a unique, recognizable number.
            return `${p}-${Date.now().toString().slice(-6)}`;
        }
    }, []);

    return {
        wholesaleOrders,
        customers,
        customerPayments,
        isLoading,
        tableMissing,
        fetchWholesaleOrders,
        fetchCustomerPayments,
        nextInvoiceNumber,
        createWholesaleOrder,
        updateWholesaleOrder,
        deleteWholesaleOrder,
        updateWholesaleOrderStatus,
        recordCustomerPayment: recordCustomerPaymentOnce,
        deleteCustomerPayment,
        fetchCustomers,
        saveCustomer,
        deleteCustomer
    };
};
