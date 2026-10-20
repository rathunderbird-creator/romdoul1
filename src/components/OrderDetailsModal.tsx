import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Edit, ArrowLeft } from 'lucide-react';
import Modal from './Modal';
import OrderDetailsContent from './OrderDetailsContent';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { generateOrderCopyText } from '../utils/orderUtils';

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

    const order = useMemo(() => sales.find(s => s.id === orderId), [sales, orderId]);

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
            {!order ? (
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
