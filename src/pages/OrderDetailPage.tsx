import React, { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { ArrowLeft, Copy, Edit } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { generateOrderCopyText } from '../utils/orderUtils';

import OrderDetailsContent from '../components/OrderDetailsContent';

const OrderDetailPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { sales, hasPermission } = useStore();
    const { showToast } = useToast();

    const order = useMemo(() => sales.find(s => s.id === id), [sales, id]);

    // ... (useEffect remains same) ...

    if (!order) {
        return (
            <div style={{ padding: '40px', textAlign: 'center' }}>
                <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '16px' }}>Order Not Found</h2>
                <button
                    onClick={() => navigate('/orders')}
                    className="secondary-button"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                >
                    <ArrowLeft size={16} /> Back to Orders
                </button>
            </div>
        );
    }

    const handleCopyInfo = () => {
        const text = generateOrderCopyText(order, sales);
        navigator.clipboard.writeText(text).then(() => {
            showToast('Order info copied to clipboard', 'success');
        });
    };

    return (
        <div style={{ paddingBottom: '40px', maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px', gap: '12px' }}>
                {hasPermission('manage_orders') && (
                    <button
                        onClick={() => navigate('/orders', { state: { editOrderId: order.id } })}
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

            <OrderDetailsContent order={order} />
        </div>
    );
};

export default OrderDetailPage;
