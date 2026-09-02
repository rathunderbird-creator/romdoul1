import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { WholesaleOrder, WholesaleOrderItem, WholesaleCustomer } from '../types';
import { useToast } from '../context/ToastContext';

const generateUUID = () => {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

// Mirror of useProcurement, but for customer credit sales (Accounts Receivable).
export const useWholesale = () => {
    const { showToast } = useToast();
    const [wholesaleOrders, setWholesaleOrders] = useState<WholesaleOrder[]>([]);
    const [customers, setCustomers] = useState<WholesaleCustomer[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [tableMissing, setTableMissing] = useState(false);

    const fetchWholesaleOrders = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('wholesale_orders')
                .select('*, items:wholesale_order_items(*), payments:customer_payments(*)')
                // order_date is a plain date, so same-day orders tie — break the tie
                // with created_at so the newest transaction is always on top.
                .order('order_date', { ascending: false })
                .order('created_at', { ascending: false });
            if (error) {
                // Most likely the migration hasn't been run yet.
                setTableMissing(true);
                setWholesaleOrders([]);
            } else {
                setTableMissing(false);
                setWholesaleOrders((data || []) as WholesaleOrder[]);
            }
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, []);

    // Move stock out of a warehouse (delta negative to deduct, positive to restore).
    const adjustWarehouseStock = async (warehouseId: string, productId: string, delta: number) => {
        if (!warehouseId || !productId) return;
        const { data } = await supabase.from('warehouse_stock')
            .select('id, quantity').eq('warehouse_id', warehouseId).eq('product_id', productId).maybeSingle();
        if (data) {
            await supabase.from('warehouse_stock').update({ quantity: Math.max(0, (data.quantity || 0) + delta) }).eq('id', data.id);
        } else if (delta > 0) {
            await supabase.from('warehouse_stock').insert([{ warehouse_id: warehouseId, product_id: productId, quantity: delta }]);
        }
    };

    const adjustProductStock = async (productId: string, delta: number) => {
        if (!productId) return;
        const { data } = await supabase.from('products').select('stock').eq('id', productId).single();
        if (data) {
            await supabase.from('products').update({ stock: Math.max(0, (data.stock || 0) + delta) }).eq('id', productId);
        }
    };

    // Create a wholesale credit sale: stock leaves the company now, money comes later.
    const createWholesaleOrder = useCallback(async (
        order: Partial<WholesaleOrder>,
        items: Partial<WholesaleOrderItem>[],
        createdBy?: string
    ) => {
        try {
            // Availability check BEFORE anything is written: the deduction below
            // clamps at 0 (stock 4 - order 10 = 0), but cancel/delete restores the
            // FULL ordered quantity — an oversell would mint phantom stock. Sum
            // quantities per product so multiple lines are checked together.
            const neededByProduct = new Map<string, { qty: number; name: string }>();
            for (const i of items) {
                if (!i.product_id || !i.quantity) continue;
                const cur = neededByProduct.get(i.product_id) || { qty: 0, name: i.product_name || 'product' };
                cur.qty += i.quantity;
                neededByProduct.set(i.product_id, cur);
            }
            for (const [productId, need] of neededByProduct) {
                const { data: prod } = await supabase.from('products').select('stock, name').eq('id', productId).single();
                const available = prod?.stock || 0;
                if (need.qty > available) {
                    throw new Error(`Insufficient stock for ${prod?.name || need.name}: have ${available}, need ${need.qty}`);
                }
                if (order.warehouse_id) {
                    const { data: ws } = await supabase.from('warehouse_stock')
                        .select('quantity').eq('warehouse_id', order.warehouse_id).eq('product_id', productId).maybeSingle();
                    const whAvailable = ws?.quantity || 0;
                    if (need.qty > whAvailable) {
                        throw new Error(`Insufficient warehouse stock for ${prod?.name || need.name}: have ${whAvailable}, need ${need.qty}`);
                    }
                }
            }

            const total = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
            const { data: inserted, error: oErr } = await supabase.from('wholesale_orders').insert([{
                invoice_number: order.invoice_number || null,
                customer_name: order.customer_name,
                customer_phone: order.customer_phone || null,
                warehouse_id: order.warehouse_id || null,
                order_date: order.order_date,
                due_date: order.due_date || null,
                status: order.status || 'Open',
                total_amount: total,
                amount_paid: 0,
                payment_status: 'Unpaid',
                notes: order.notes || null,
                created_by: createdBy || 'System'
            }]).select().single();
            if (oErr) throw oErr;

            const orderId = inserted.id;
            const itemsPayload = items.map(i => ({
                wholesale_order_id: orderId,
                product_id: i.product_id,
                product_name: i.product_name || '',
                quantity: i.quantity || 0,
                unit_price: i.unit_price || 0
            }));
            const { error: iErr } = await supabase.from('wholesale_order_items').insert(itemsPayload);
            if (iErr) {
                // Don't leave an orphan order with no items (savePurchaseOrder
                // does the same); a retry would otherwise duplicate the order.
                await supabase.from('wholesale_orders').delete().eq('id', orderId);
                throw iErr;
            }

            // Deduct stock (leaves the company).
            for (const i of items) {
                if (!i.product_id || !i.quantity) continue;
                await adjustProductStock(i.product_id, -(i.quantity));
                if (order.warehouse_id) await adjustWarehouseStock(order.warehouse_id, i.product_id, -(i.quantity));
            }

            // Log a stock-out movement per line so the sale shows in Stock Movements.
            const localDate = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
            const baseMovements = items
                .filter(i => i.product_id && i.quantity)
                .map(i => ({
                    product_id: i.product_id,
                    product_name: i.product_name || '',
                    type: 'out',
                    quantity: i.quantity,
                    unit_price: i.unit_price || 0,
                    source: 'Wholesale Order',
                    reason: 'Wholesale Sale',
                    reference_id: orderId,
                    customer_name: order.customer_name || '',
                    customer_phone: order.customer_phone || '',
                    note: `Wholesale ${order.invoice_number || 'WO-' + orderId.slice(0, 8)}`,
                    movement_date: localDate,
                    created_by: createdBy || 'System'
                }));
            if (baseMovements.length > 0) {
                // Try with warehouse_id first; the column only exists after the
                // add_warehouse_to_stock_movements migration. If the insert is
                // rejected (e.g. column missing), retry without it so the
                // movement is still logged.
                const withWarehouse = baseMovements.map(m => ({ ...m, warehouse_id: order.warehouse_id || null }));
                let { error: mErr } = await supabase.from('stock_movements').insert(withWarehouse);
                if (mErr) {
                    ({ error: mErr } = await supabase.from('stock_movements').insert(baseMovements));
                }
                if (mErr) {
                    console.error('Failed to log wholesale stock-out movements:', mErr);
                    showToast('Order saved, but logging to Stock Movements failed: ' + mErr.message, 'error');
                }
            }

            showToast('Wholesale order created', 'success');
            await fetchWholesaleOrders(true);
            return orderId as string;
        } catch (error: any) {
            console.error('Failed to create wholesale order:', error);
            showToast('Failed to create wholesale order: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchWholesaleOrders]);

    const deleteWholesaleOrder = useCallback(async (order: WholesaleOrder) => {
        try {
            // Restore stock that was deducted at creation (only for non-cancelled orders).
            if (order.status !== 'Cancelled') {
                for (const i of order.items || []) {
                    if (!i.product_id || !i.quantity) continue;
                    await adjustProductStock(i.product_id, i.quantity);
                    if (order.warehouse_id) await adjustWarehouseStock(order.warehouse_id, i.product_id, i.quantity);
                }
                // Remove the stock-out movements logged at creation.
                await supabase.from('stock_movements').delete().eq('reference_id', order.id).eq('type', 'out');
            }
            // Payments cascade away with the order — capture their ids FIRST
            // (a failed read aborts the delete), remove the order, then clean
            // their linked Income rows. This ordering means a partial failure
            // at worst leaves an orphaned ledger row (recoverable clutter),
            // never a live order whose books already vanished.
            const { data: cascadingPays, error: paysErr } = await supabase.from('customer_payments').select('id').eq('wholesale_order_id', order.id);
            if (paysErr) throw paysErr;
            const { error } = await supabase.from('wholesale_orders').delete().eq('id', order.id);
            if (error) throw error;
            for (const p of cascadingPays || []) {
                const { error: txErr } = await supabase.from('transactions').delete().like('description', `%#WSP-${String(p.id).slice(0, 8)}%`);
                if (txErr) console.error('Failed to remove income row for deleted wholesale payment:', txErr);
            }
            showToast('Wholesale order deleted', 'success');
            await fetchWholesaleOrders(true);
        } catch (error: any) {
            console.error('Failed to delete wholesale order:', error);
            showToast('Failed to delete wholesale order: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchWholesaleOrders]);

    // Record a customer payment against an order (mirror of recordSupplierPayment).
    // Also logs each receipt to Income & Expense so wholesale money shows up as Income.
    const recordCustomerPayment = useCallback(async (orderId: string, amount: number, paymentMethod: string, notes: string, paymentDate?: string, receivedBy?: string) => {
        try {
            const payDate = paymentDate || new Date().toISOString().split('T')[0];
            const { data: inserted, error: pErr } = await supabase.from('customer_payments').insert([{
                wholesale_order_id: orderId,
                amount,
                payment_date: payDate,
                payment_method: paymentMethod,
                notes: notes || null
            }]).select().single();
            if (pErr) throw pErr;

            const { data: order, error: fErr } = await supabase
                .from('wholesale_orders').select('amount_paid, total_amount, customer_name, invoice_number').eq('id', orderId).single();
            if (fErr || !order) throw fErr || new Error('Order not found');

            const newPaid = (Number(order.amount_paid) || 0) + Number(amount);
            const status = newPaid >= order.total_amount ? 'Paid' : (newPaid > 0 ? 'Partial' : 'Unpaid');
            const { error: uErr } = await supabase.from('wholesale_orders')
                .update({ amount_paid: newPaid, payment_status: status }).eq('id', orderId);
            if (uErr) throw uErr;

            // Log an Income transaction, tagged with the payment id so deleting the
            // payment can remove it again. Non-fatal: the payment itself succeeded.
            const marker = `#WSP-${String(inserted?.id || '').slice(0, 8)}`;
            const { error: tErr } = await supabase.from('transactions').insert([{
                id: generateUUID(),
                date: new Date(payDate).toISOString(),
                type: 'Income',
                category: 'លក់ដុំ',
                amount: Number(amount),
                description: `${order.customer_name || 'Wholesale'} · ${order.invoice_number || 'WO-' + orderId.slice(0, 8).toUpperCase()} ${marker}`,
                pay_by: paymentMethod || null,
                added_by: receivedBy || 'Wholesale'
            }]);
            if (tErr) {
                console.error('Failed to log wholesale income transaction:', tErr);
                showToast('Payment saved, but logging to Income failed: ' + tErr.message, 'error');
            }

            showToast('Payment recorded', 'success');
            await fetchWholesaleOrders(true);
        } catch (error: any) {
            console.error('Failed to record payment:', error);
            showToast('Failed to record payment: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchWholesaleOrders]);

    // Change an order's status. Cancelling returns the stock to inventory and
    // removes the logged stock-out movements (mirror of how deleting does it);
    // Open -> Delivered is a plain status update. Re-opening a cancelled order
    // is not supported, since its stock has already been returned.
    const updateWholesaleOrderStatus = useCallback(async (order: WholesaleOrder, status: WholesaleOrder['status']) => {
        try {
            if (status === 'Cancelled' && order.status !== 'Cancelled') {
                for (const i of order.items || []) {
                    if (!i.product_id || !i.quantity) continue;
                    await adjustProductStock(i.product_id, i.quantity);
                    if (order.warehouse_id) await adjustWarehouseStock(order.warehouse_id, i.product_id, i.quantity);
                }
                await supabase.from('stock_movements').delete().eq('reference_id', order.id).eq('type', 'out');
            }
            const { error } = await supabase.from('wholesale_orders').update({ status }).eq('id', order.id);
            if (error) throw error;
            showToast(status === 'Cancelled' ? 'Order cancelled — stock returned' : `Order marked ${status}`, 'success');
            await fetchWholesaleOrders(true);
        } catch (error: any) {
            showToast('Failed to update order status: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchWholesaleOrders]);

    // Delete a customer payment and revert the order's paid amount (mirror of deleteSupplierPayment).
    const deleteCustomerPayment = useCallback(async (paymentId: string) => {
        try {
            const { data: payment, error: fErr } = await supabase.from('customer_payments').select('*').eq('id', paymentId).single();
            if (fErr) throw fErr;
            if (payment && payment.wholesale_order_id) {
                const { data: o } = await supabase.from('wholesale_orders').select('amount_paid, total_amount').eq('id', payment.wholesale_order_id).single();
                if (o) {
                    const newPaid = Math.max(0, (Number(o.amount_paid) || 0) - Number(payment.amount));
                    const status = newPaid === 0 ? 'Unpaid' : (newPaid >= o.total_amount ? 'Paid' : 'Partial');
                    await supabase.from('wholesale_orders').update({ amount_paid: newPaid, payment_status: status }).eq('id', payment.wholesale_order_id);
                }
            }
            const { error } = await supabase.from('customer_payments').delete().eq('id', paymentId);
            if (error) throw error;
            // Remove the Income transaction that was logged with this payment.
            await supabase.from('transactions').delete().like('description', `%#WSP-${paymentId.slice(0, 8)}%`);
            showToast('Payment deleted', 'success');
            await fetchWholesaleOrders(true);
        } catch (error: any) {
            showToast('Failed to delete payment: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchWholesaleOrders]);

    // --- Customer directory (mirror of suppliers) ---
    const fetchCustomers = useCallback(async () => {
        const { data, error } = await supabase.from('wholesale_customers').select('*').order('name', { ascending: true });
        if (!error) setCustomers((data || []) as WholesaleCustomer[]);
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
    // suffix among existing WO-… invoices, plus one. Manually typed invoices
    // in other formats are ignored by the pattern and never disturbed.
    const nextInvoiceNumber = useCallback(async (): Promise<string> => {
        try {
            const { data, error } = await supabase.from('wholesale_orders')
                .select('invoice_number')
                .like('invoice_number', 'WO-%');
            if (error) throw error;
            let max = 0;
            for (const r of data || []) {
                const m = String(r.invoice_number || '').match(/^WO-(\d+)$/i);
                if (m) max = Math.max(max, parseInt(m[1], 10));
            }
            return `WO-${String(max + 1).padStart(4, '0')}`;
        } catch (e) {
            console.error('Failed to compute next invoice number:', e);
            // Timestamp fallback still yields a unique, recognizable number.
            return `WO-${Date.now().toString().slice(-6)}`;
        }
    }, []);

    return {
        wholesaleOrders,
        customers,
        isLoading,
        tableMissing,
        fetchWholesaleOrders,
        nextInvoiceNumber,
        createWholesaleOrder,
        deleteWholesaleOrder,
        updateWholesaleOrderStatus,
        recordCustomerPayment,
        deleteCustomerPayment,
        fetchCustomers,
        saveCustomer,
        deleteCustomer
    };
};
