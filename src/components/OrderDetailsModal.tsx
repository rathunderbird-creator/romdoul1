import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Edit, ArrowLeft } from 'lucide-react';
import Modal from './Modal';
import OrderDetailsContent from './OrderDetailsContent';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { generateOrderCopyText } from '../utils/orderUtils';
import { supabase } from '../lib/supabase';
import { mapSaleEntity } from '../utils/mapper';
import type { Sale } from '../types';

interface OrderDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    orderId: string | null;
}

// Same content as the full-page OrderDetailPage (via the shared
// OrderDetailsContent), opened as a popup instead of navigating away — used
// by Customer Payment's "View" action so the list stays put underneath.
const OrderDetailsModal: React.FC<OrderDetailsModalProps> = ({ isOpen, onClose, orderId }) => {
    const { sales, hasPermission } = useStore();
    const { showToast } = useToast();
    const navigate = useNavigate();

    // `sales` is only a recent, paginated slice of the real orders table (see
    // StoreContext.tsx's fetchAllSales .limit(50) + Orders.tsx's infinite
    // scroll) — an order Customer Payment correctly surfaces (via its own
    // targeted existence check) can still be missing from this shared cache.
    // Fall back to a direct, single-order fetch, mirroring the same pattern
    // StoreContext.tsx's updateOrders already uses for the same reason.
    const [fetchedOrder, setFetchedOrder] = useState<Sale | null>(null);
    const [isFetchingOrder, setIsFetchingOrder] = useState(false);
    const cachedOrder = useMemo(() => sales.find(s => s.id === orderId), [sales, orderId]);
    const order = cachedOrder || fetchedOrder || undefined;

    useEffect(() => {
        setFetchedOrder(null);
        if (!isOpen || !orderId || cachedOrder) return;
        let cancelled = false;
        setIsFetchingOrder(true);
        supabase.from('sales')
            .select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)')
            .eq('id', orderId)
            .maybeSingle()
            .then(({ data }) => {
                if (cancelled) return;
                if (data) setFetchedOrder(mapSaleEntity(data));
                setIsFetchingOrder(false);
            });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- cachedOrder intentionally excluded: once sales catches up, the `order` memo above already prefers it over fetchedOrder without needing to refire this fetch.
    }, [isOpen, orderId]);

    const handleCopyInfo = () => {
        if (!order) return;
        const text = generateOrderCopyText(order, sales);
        navigator.clipboard.writeText(text).then(() => {
            showToast('Order info copied to clipboard', 'success');
        });
    };

    const handleEditOrder = () => {
        if (!order) return;
        onClose();
        navigate('/orders', { state: { editOrderId: order.id } });
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={order ? `Order #${order.id.substring(0, 8)}` : 'Order Details'}
            width="800px"
        >
            {!order && isFetchingOrder ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    Loading order…
                </div>
            ) : !order ? (
                <div style={{ padding: '40px', textAlign: 'center' }}>
                    <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '16px' }}>Order Not Found</h2>
                    <button
                        onClick={onClose}
                        className="secondary-button"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                    >
                        <ArrowLeft size={16} /> Close
                    </button>
                </div>
            ) : (
                <>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px', gap: '12px' }}>
                        {hasPermission('manage_orders') && (
                            <button
                                onClick={handleEditOrder}
                                className="secondary-button"
                                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                            >
                                <Edit size={16} /> Edit Order
                            </button>
                        )}
                        <button
                            onClick={handleCopyInfo}
                            className="secondary-button"
                            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                            <Copy size={16} /> Copy Info
                        </button>
                    </div>

                    <OrderDetailsContent order={order} showHeading={false} showPermalink={false} />
                </>
            )}
        </Modal>
    );
};

export default OrderDetailsModal;
