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

    const fetchPurchaseOrders = useCallback(async () => {
        setIsLoading(true);
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
            setIsLoading(false);
        }
    }, [showToast]);

    const savePurchaseOrder = useCallback(async (po: Partial<PurchaseOrder>, items: Partial<PurchaseOrderItem>[]) => {
        try {
            const { data: insertedPO, error: poError } = await supabase
                .from('purchase_orders')
                .insert([{
                    supplier_id: po.supplier_id,
                    order_date: po.order_date,
                    expected_delivery_date: po.expected_delivery_date,
                    status: po.status,
                    total_amount: po.total_amount,
                    notes: po.notes
                }])
                .select()
                .single();
                
            if (poError) throw poError;

            const itemsToInsert = items.map(item => ({
                purchase_order_id: insertedPO.id,
                product_id: item.product_id,
                quantity: item.quantity || 0,
                unit_price: item.unit_price || 0
            }));

            const { error: itemsError } = await supabase
                .from('purchase_order_items')
                .insert(itemsToInsert);

            if (itemsError) {
                await supabase.from('purchase_orders').delete().eq('id', insertedPO.id);
                throw itemsError;
            }

            showToast('Purchase Order created successfully', 'success');
            await fetchPurchaseOrders();
        } catch (error: any) {
            console.error('Failed to save purchase order:', error);
            showToast('Failed to save purchase order: ' + error.message, 'error');
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
        savePurchaseOrder
    };
};
