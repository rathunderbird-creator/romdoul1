import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Supplier, PurchaseOrder, PurchaseOrderItem } from '../types';
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

export const useProcurement = () => {
    const { showToast } = useToast();
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const fetchSuppliers = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('suppliers')
                .select('*')
                .order('name', { ascending: true });
                
            if (error) throw error;
            setSuppliers(data || []);
        } catch (error: any) {
            console.error('Failed to fetch suppliers:', error);
            showToast('Failed to fetch suppliers: ' + error.message, 'error');
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    const saveSupplier = useCallback(async (supplier: Partial<Supplier>) => {
        try {
            if (supplier.id) {
                const { error } = await supabase
                    .from('suppliers')
                    .update({
                        name: supplier.name,
                        contact_name: supplier.contact_name,
                        email: supplier.email,
                        phone: supplier.phone,
                        address: supplier.address,
                        tax_id: supplier.tax_id,
                        is_active: supplier.is_active
                    })
                    .eq('id', supplier.id);
                if (error) throw error;
                showToast('Supplier updated successfully', 'success');
            } else {
                const { error } = await supabase
                    .from('suppliers')
                    .insert([{
                        name: supplier.name,
                        contact_name: supplier.contact_name,
                        email: supplier.email,
                        phone: supplier.phone,
                        address: supplier.address,
                        tax_id: supplier.tax_id,
                        is_active: supplier.is_active ?? true
                    }]);
                if (error) throw error;
                showToast('Supplier created successfully', 'success');
            }
            await fetchSuppliers();
        } catch (error: any) {
            console.error('Failed to save supplier:', error);
            showToast('Failed to save supplier: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchSuppliers]);

    const deleteSupplier = useCallback(async (id: string) => {
        try {
            const { error } = await supabase.from('suppliers').delete().eq('id', id);
            if (error) throw error;
            showToast('Supplier deleted successfully', 'success');
            await fetchSuppliers();
        } catch (error: any) {
            console.error('Failed to delete supplier:', error);
            showToast('Failed to delete supplier: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchSuppliers]);

    const fetchPurchaseOrders = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('purchase_orders')
                .select('*, supplier:suppliers(*), items:purchase_order_items(*, product:products(*))')
                // order_date is a plain date, so same-day POs tie — break the tie
                // with created_at so the newest transaction is always on top.
                .order('order_date', { ascending: false })
                .order('created_at', { ascending: false });
                
            if (error) throw error;
            setPurchaseOrders(data || []);
        } catch (error: any) {
            console.error('Failed to fetch purchase orders:', error);
            showToast('Failed to fetch purchase orders: ' + error.message, 'error');
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, [showToast]);

    const savePurchaseOrder = useCallback(async (po: Partial<PurchaseOrder>, items: Partial<PurchaseOrderItem>[]) => {
        try {
            let currentPoId = po.id;
            
            if (currentPoId) {
                // Update
                const { error: poError } = await supabase
                    .from('purchase_orders')
                    .update({
                        supplier_id: po.supplier_id,
                        order_date: po.order_date,
                        expected_delivery_date: po.expected_delivery_date,
                        status: po.status,
                        total_amount: po.total_amount,
                        payment_status: po.payment_status || 'Unpaid',
                        amount_paid: po.amount_paid || 0,
                        payment_due_date: po.payment_due_date || null,
                        invoice_number: po.invoice_number || null,
                        notes: po.notes
                    })
                    .eq('id', currentPoId);
                
                if (poError) throw poError;

                // Delete old items
                await supabase.from('purchase_order_items').delete().eq('purchase_order_id', currentPoId);

            } else {
                // Insert
                const { data: insertedPO, error: poError } = await supabase
                    .from('purchase_orders')
                    .insert([{
                        supplier_id: po.supplier_id,
                        order_date: po.order_date,
                        expected_delivery_date: po.expected_delivery_date || null,
                        status: po.status,
                        total_amount: po.total_amount,
                        payment_status: po.payment_status || 'Unpaid',
                        amount_paid: po.amount_paid || 0,
                        payment_due_date: po.payment_due_date || null,
                        invoice_number: po.invoice_number || null,
                        notes: po.notes || null
                    }])
                    .select()
                    .single();
                    
                if (poError) throw poError;
                currentPoId = insertedPO.id;
            }

            const itemsToInsert = items.map(item => ({
                purchase_order_id: currentPoId,
                product_id: item.product_id,
                quantity: item.quantity || 0,
                unit_price: item.unit_price || 0
            }));

            const { error: itemsError } = await supabase
                .from('purchase_order_items')
                .insert(itemsToInsert);

            if (itemsError) {
                if (!po.id) {
                    await supabase.from('purchase_orders').delete().eq('id', currentPoId);
                }
                throw itemsError;
            }

            showToast(po.id ? 'Purchase Order updated successfully' : 'Purchase Order created successfully', 'success');
            await fetchPurchaseOrders(true); // silent fetch
            return currentPoId;
        } catch (error: any) {
            console.error('Failed to save purchase order:', error);
            showToast('Failed to save purchase order: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchPurchaseOrders]);

    const deletePurchaseOrder = useCallback(async (id: string) => {
        try {
            const { error } = await supabase.from('purchase_orders').delete().eq('id', id);
            if (error) throw error;
            showToast('Purchase Order deleted successfully', 'success');
            await fetchPurchaseOrders(true);
        } catch (error: any) {
            console.error('Failed to delete purchase order:', error);
            showToast('Failed to delete purchase order: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchPurchaseOrders]);

    // Also logs each supplier payment to Income & Expense as an Expense.
    const recordSupplierPayment = useCallback(async (poId: string, supplierId: string, amount: number, paymentMethod: string, notes: string, paymentDate?: string, paidBy?: string) => {
        try {
            const payDate = paymentDate || new Date().toISOString().split('T')[0];
            // Log payment
            const { data: inserted, error: paymentError } = await supabase.from('supplier_payments').insert([{
                purchase_order_id: poId,
                supplier_id: supplierId,
                amount,
                payment_date: payDate,
                payment_method: paymentMethod,
                notes
            }]).select().single();

            if (paymentError) throw paymentError;

            // Fetch current PO
            const { data: po, error: fetchError } = await supabase
                .from('purchase_orders')
                .select('amount_paid, total_amount')
                .eq('id', poId)
                .single();

            if (fetchError || !po) throw fetchError || new Error('PO not found');

            const newAmountPaid = (Number(po.amount_paid) || 0) + Number(amount);
            const newPaymentStatus = newAmountPaid >= po.total_amount ? 'Paid' : 'Partial';

            // Update PO
            const { error: poUpdateError } = await supabase
                .from('purchase_orders')
                .update({
                    amount_paid: newAmountPaid,
                    payment_status: newPaymentStatus
                })
                .eq('id', poId);

            if (poUpdateError) throw poUpdateError;

            // Log an Expense transaction, tagged with the payment id so deleting the
            // payment can remove it again. Non-fatal: the payment itself succeeded.
            const { data: supplier } = await supabase.from('suppliers').select('name').eq('id', supplierId).single();
            const marker = `#SPP-${String(inserted?.id || '').slice(0, 8)}`;
            const { error: tErr } = await supabase.from('transactions').insert([{
                id: generateUUID(),
                date: new Date(payDate).toISOString(),
                type: 'Expense',
                category: 'ទិញឥវ៉ាន់',
                amount: Number(amount),
                description: `${supplier?.name || 'Supplier'} · PO-${poId.slice(0, 8).toUpperCase()} ${marker}`,
                pay_by: paymentMethod || null,
                added_by: paidBy || 'Purchasing'
            }]);
            if (tErr) {
                console.error('Failed to log supplier expense transaction:', tErr);
                showToast('Payment saved, but logging to Expense failed: ' + tErr.message, 'error');
            }

            showToast('Payment recorded successfully', 'success');
            await fetchPurchaseOrders(true);
        } catch (error: any) {
            console.error('Failed to record payment:', error);
            showToast('Failed to record payment: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchPurchaseOrders]);

    const deleteSupplierPayment = useCallback(async (paymentId: string) => {
        try {
            // Wait, we need to revert PO amount_paid too. 
            // Fetch payment to get PO id and amount
            const { data: payment, error: fetchErr } = await supabase.from('supplier_payments').select('*').eq('id', paymentId).single();
            if (fetchErr) throw fetchErr;

            if (payment && payment.purchase_order_id) {
                const { data: po } = await supabase.from('purchase_orders').select('amount_paid, total_amount').eq('id', payment.purchase_order_id).single();
                if (po) {
                    const newAmountPaid = Math.max(0, (Number(po.amount_paid) || 0) - Number(payment.amount));
                    const newPaymentStatus = newAmountPaid === 0 ? 'Unpaid' : (newAmountPaid >= po.total_amount ? 'Paid' : 'Partial');
                    await supabase.from('purchase_orders').update({
                        amount_paid: newAmountPaid,
                        payment_status: newPaymentStatus
                    }).eq('id', payment.purchase_order_id);
                }
            }

            const { error } = await supabase.from('supplier_payments').delete().eq('id', paymentId);
            if (error) throw error;
            // Remove the Expense transaction that was logged with this payment.
            await supabase.from('transactions').delete().like('description', `%#SPP-${paymentId.slice(0, 8)}%`);
            showToast('Payment deleted successfully', 'success');
            await fetchPurchaseOrders(true);
        } catch (error: any) {
            console.error('Failed to delete payment:', error);
            showToast('Failed to delete payment: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchPurchaseOrders]);

    return {
        suppliers,
        purchaseOrders,
        isLoading,
        fetchSuppliers,
        saveSupplier,
        deleteSupplier,
        fetchPurchaseOrders,
        deletePurchaseOrder,
        savePurchaseOrder,
        recordSupplierPayment,
        deleteSupplierPayment
    };
};
