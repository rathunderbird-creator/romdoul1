import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Supplier, PurchaseOrder, PurchaseOrderItem } from '../types';
import { useToast } from '../context/ToastContext';

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
                .order('order_date', { ascending: false });
                
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
                        expected_delivery_date: po.expected_delivery_date,
                        status: po.status,
                        total_amount: po.total_amount,
                        payment_status: po.payment_status || 'Unpaid',
                        amount_paid: po.amount_paid || 0,
                        payment_due_date: po.payment_due_date || null,
                        notes: po.notes
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

    const recordSupplierPayment = useCallback(async (poId: string, supplierId: string, amount: number, paymentMethod: string, notes: string) => {
        try {
            // Log payment
            const { error: paymentError } = await supabase.from('supplier_payments').insert([{
                purchase_order_id: poId,
                supplier_id: supplierId,
                amount,
                payment_date: new Date().toISOString().split('T')[0],
                payment_method: paymentMethod,
                notes
            }]);
            
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

            showToast('Payment recorded successfully', 'success');
            await fetchPurchaseOrders(true);
        } catch (error: any) {
            console.error('Failed to record payment:', error);
            showToast('Failed to record payment: ' + error.message, 'error');
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
        savePurchaseOrder,
        deletePurchaseOrder,
        recordSupplierPayment
    };
};
