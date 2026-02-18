import React, { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { ArrowLeft, Copy, ExternalLink, Edit } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { generateOrderCopyText } from '../utils/orderUtils';

import StatusBadge from '../components/StatusBadge';

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

            <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                    <div style={{ maxWidth: '100%' }}>
                        <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '8px' }}>Order #{order.id.substring(0, 8)}</h2>
                        <div style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>
                            Placed on {new Date(order.date).toLocaleString()}
                        </div>
                        <div style={{ marginTop: '8px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                            <ExternalLink size={14} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                            <a href={`/orders/${order.id}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'underline', wordBreak: 'break-all' }}>
                                {window.location.origin}/orders/{order.id}
                            </a>
                        </div>
                    </div>
                    <div style={{ flexShrink: 0 }}>
                        <StatusBadge status={order.shipping?.status || 'Pending'} readOnly />
                    </div>
                </div>


                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '32px' }}>
                    {/* Customer Info */}
                    <div>
                        <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: '12px' }}>
                            Customer Details
                        </h3>
                        <div style={{ fontSize: '15px', display: 'flex', flexDirection: 'column', gap: '8px', wordBreak: 'break-word' }}>
                            <div style={{ fontWeight: 600 }}>{order.customer?.name}</div>
                            <div>{order.customer?.phone || 'No phone'}</div>
                            <div>{order.customer?.address || 'No address'}</div>
                            {order.customer?.city && <div>{order.customer?.city}</div>}
                            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                                Via {order.customer?.platform} {order.customer?.page && `(${order.customer.page})`}
                            </div>
                        </div>
                    </div>

                    {/* Payment & Shipping */}
                    <div>
                        <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: '12px' }}>
                            Payment & Shipping
                        </h3>
                        <div style={{ fontSize: '15px', display: 'flex', flexDirection: 'column', gap: '8px', wordBreak: 'break-word' }}>
                            <div>Paying by: <span style={{ fontWeight: 500 }}>{order.paymentMethod}</span></div>
                            <div>Status: <span style={{ fontWeight: 500, color: order.paymentStatus === 'Paid' ? 'var(--color-green)' : 'var(--color-text-main)' }}>{order.paymentStatus}</span></div>
                            {order.shipping?.company && (
                                <div style={{ marginTop: '8px' }}>
                                    <div>Shipping: {order.shipping.company}</div>
                                    {order.shipping.trackingNumber && <div>Tracking: {order.shipping.trackingNumber}</div>}
                                    {order.shipping.cost > 0 && <div>Cost: ${order.shipping.cost}</div>}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Items */}
            <div className="glass-panel" style={{ padding: '24px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Order Items</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {order.items.map((item, index) => (
                        <div key={index} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '16px', borderBottom: index === order.items.length - 1 ? 'none' : '1px solid var(--color-border)', gap: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', overflow: 'hidden' }}>
                                <div style={{ width: '48px', height: '48px', borderRadius: '8px', background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {item.image ? (
                                        <img src={item.image} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '8px' }} />
                                    ) : (
                                        <span style={{ fontSize: '10px' }}>No Img</span>
                                    )}
                                </div>
                                <div>
                                    <div style={{ fontWeight: 500, fontSize: '15px' }}>{item.name}</div>
                                    <div style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>${item.price.toFixed(2)} x {item.quantity}</div>
                                </div>
                            </div>
                            <div style={{ fontWeight: 600 }}>
                                ${(item.price * item.quantity).toFixed(2)}
                            </div>
                        </div>
                    ))}
                </div>
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '2px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '16px', fontWeight: 600 }}>Total</span>
                    <span style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--color-primary)' }}>${order.total.toFixed(2)}</span>
                </div>
            </div>

            {order.remark && (
                <div className="glass-panel" style={{ padding: '24px', marginTop: '24px' }}>
                    <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>
                        Remark
                    </h3>
                    <p style={{ fontSize: '15px' }}>{order.remark}</p>
                </div>
            )}
        </div>
    );
};

export default OrderDetailPage;
