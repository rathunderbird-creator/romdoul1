import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { WholesaleOrder, WholesaleOrderItem, WholesaleCustomer } from '../types';
import { useToast } from '../context/ToastContext';

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
                .order('order_date', { ascending: false });
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
            const total = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
            const { data: inserted, error: oErr } = await supabase.from('wholesale_orders').insert([{
                invoice_number: order.invoice_number || null,
                customer_name: order.customer_name,
                customer_phone: order.customer_phone || null,
                warehouse_id: order.warehouse_id || null,
                order_date: order.order_date,
                due_date: order.due_date || null,
                status: 'Open',
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
            if (iErr) throw iErr;

            // Deduct stock (leaves the company).
            for (const i of items) {
                if (!i.product_id || !i.quantity) continue;
                await adjustProductStock(i.product_id, -(i.quantity));
                if (order.warehouse_id) await adjustWarehouseStock(order.warehouse_id, i.product_id, -(i.quantity));
            }

            // Log a stock-out movement per line so the sale shows in Stock Movements.
            const localDate = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
            const movements = items
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
                    warehouse_id: order.warehouse_id || null,
                    customer_name: order.customer_name || '',
                    customer_phone: order.customer_phone || '',
                    note: `Wholesale ${order.invoice_number || 'WO-' + orderId.slice(0, 8)}`,
                    movement_date: localDate,
                    created_by: createdBy || 'System'
                }));
            if (movements.length > 0) {
                const { error: mErr } = await supabase.from('stock_movements').insert(movements);
                if (mErr) console.error('Failed to log wholesale stock-out movements:', mErr);
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
            const { error } = await supabase.from('wholesale_orders').delete().eq('id', order.id);
            if (error) throw error;
            showToast('Wholesale order deleted', 'success');
            await fetchWholesaleOrders(true);
        } catch (error: any) {
            console.error('Failed to delete wholesale order:', error);
            showToast('Failed to delete wholesale order: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchWholesaleOrders]);

    // Record a customer payment against an order (mirror of recordSupplierPayment).
    const recordCustomerPayment = useCallback(async (orderId: string, amount: number, paymentMethod: string, notes: string, paymentDate?: string) => {
        try {
            const { error: pErr } = await supabase.from('customer_payments').insert([{
                wholesale_order_id: orderId,
                amount,
                payment_date: paymentDate || new Date().toISOString().split('T')[0],
                payment_method: paymentMethod,
                notes: notes || null
            }]);
            if (pErr) throw pErr;

            const { data: order, error: fErr } = await supabase
                .from('wholesale_orders').select('amount_paid, total_amount').eq('id', orderId).single();
            if (fErr || !order) throw fErr || new Error('Order not found');

            const newPaid = (Number(order.amount_paid) || 0) + Number(amount);
            const status = newPaid >= order.total_amount ? 'Paid' : (newPaid > 0 ? 'Partial' : 'Unpaid');
            const { error: uErr } = await supabase.from('wholesale_orders')
                .update({ amount_paid: newPaid, payment_status: status }).eq('id', orderId);
            if (uErr) throw uErr;

            showToast('Payment recorded', 'success');
            await fetchWholesaleOrders(true);
        } catch (error: any) {
            console.error('Failed to record payment:', error);
            showToast('Failed to record payment: ' + error.message, 'error');
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

    return {
        wholesaleOrders,
        customers,
        isLoading,
        tableMissing,
        fetchWholesaleOrders,
        createWholesaleOrder,
        deleteWholesaleOrder,
        recordCustomerPayment,
        deleteCustomerPayment,
        fetchCustomers,
        saveCustomer,
        deleteCustomer
    };
};
