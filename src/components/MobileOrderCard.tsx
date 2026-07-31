import React from 'react';
import { Edit, Eye, Printer, Copy, MapPin, Phone, Globe, Package, CreditCard } from 'lucide-react';
import type { Sale } from '../types';
import StatusBadge from './StatusBadge';
import PaymentStatusBadge from './PaymentStatusBadge';
import { getOperatorForPhone } from '../utils/telecom';
import './MobileOrderCard.css';

interface MobileOrderCardProps {
    order: Sale;
    isSelected: boolean;
    onToggleSelect: () => void;
    isExpanded: boolean;
    onToggleExpand: () => void;
    onEdit: (order: Sale) => void;
    onView: (order: Sale) => void;
    onPrint: (order: Sale) => void;
    onCopy: (order: Sale) => void;
    onUpdateStatus: (id: string, status: any) => void;
    onUpdatePaymentStatus: (id: string, status: any) => void;
    canEdit: boolean;
}

const MobileOrderCard: React.FC<MobileOrderCardProps> = ({
    order,
    isSelected,
    onToggleSelect: _onToggleSelect,
    isExpanded,
    onToggleExpand,
    onEdit,
    onView,
    onPrint,
    onCopy,
    onUpdateStatus,
    onUpdatePaymentStatus,
    canEdit
}) => {
    const getInitials = (name: string) => {
        return name
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    const shippingStatus = (order.shipping?.status || 'Drafted').toLowerCase().replace(/\s+/g, '');
    const payStatus = order.paymentStatus || 'Unpaid';

    const isPaidOrSettle = payStatus === 'Paid';
    const isDelivered = order.shipping?.status === 'Delivered';
    const isCancelled = payStatus === 'Cancel';

    let cardClass = `mobile-order-card status-${shippingStatus}`;
    if (isSelected) cardClass += ' selected';
    else if (isCancelled) { /* no extra bg class */ }
    else if (isPaidOrSettle) cardClass += ' paid-settled';
    else if (isDelivered) cardClass += ' delivered';

    const getPayBadgeClass = () => {
        switch (payStatus) {
            case 'Paid': return 'pay-paid';
            case 'Unpaid': return 'pay-unpaid';
            case 'Get File': return 'pay-getfile';
            case 'Cancel': return 'pay-cancel';
            default: return 'pay-unpaid';
        }
    };

    const canPrint = ['Confirmed', 'Shipped', 'Delivered'].includes(order.shipping?.status || '');

    return (
        <div className={cardClass}>
            {/* Header / Summary Row */}
            <div className="moc-header" onClick={onToggleExpand}>
                {/* Avatar */}
                <div className="moc-avatar">
                    {getInitials(order.customer?.name || 'Unknown')}
                </div>

                {/* Center info */}
                <div className="moc-info">
                    <span className="moc-customer-name">
                        {order.customer?.name || 'Unknown'}
                    </span>
                    <div className="moc-products-summary">
                        {order.items.length > 0 ? (
                            <>
                                {order.items[order.items.length - 1].name}
                                {order.items.length > 1 && <span style={{ color: '#9CA3AF' }}> +{order.items.length - 1}</span>}
                            </>
                        ) : 'No items'}
                    </div>
                    <div className="moc-meta-row">
                        <span>{order.salesman || 'N/A'}</span>
                        <span>•</span>
                        <span>{new Date(order.date).toLocaleDateString()}</span>
                    </div>
                </div>

                {/* Right column: total + badges */}
                <div className="moc-right-col">
                    <span className="moc-total-amount">${order.total.toFixed(2)}</span>
                    <div className="moc-badges">
                        <span className={`moc-badge shipping-${shippingStatus}`}>
                            {order.shipping?.status || 'Drafted'}
                        </span>
                        <span className={`moc-badge ${getPayBadgeClass()}`}>
                            {payStatus === 'Get File' ? 'File' : payStatus}
                        </span>
                    </div>
                </div>
            </div>

            {/* Expanded Content */}
            {isExpanded && (
                <div className="moc-expanded">
                    {/* Customer Info Section */}
                    <div className="moc-section">
                        <div className="moc-section-title">Customer</div>
                        <div className="moc-details-grid">
                            {order.customer?.phone && (() => {
                                const operator = getOperatorForPhone(order.customer.phone);
                                return (
                                    <div className="moc-detail-item">
                                        {operator ? (
                                            <img src={operator.logo} alt={operator.name} style={{ width: '16px', height: '16px', objectFit: 'contain', borderRadius: '2px' }} title={operator.name} />
                                        ) : (
                                            <Phone size={14} />
                                        )}
                                        <span>{order.customer.phone}</span>
                                    </div>
                                );
                            })()}
                            {order.customer?.address && (
                                <div className="moc-detail-item align-start">
                                    <MapPin size={14} /> <span>{order.customer.address}</span>
                                </div>
                            )}
                            {order.customer?.page && (
                                <div className="moc-detail-item">
                                    <Globe size={14} /> <span>{order.customer.page}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Items Section */}
                    <div className="moc-section">
                        <div className="moc-section-title">Items</div>
                        <div className="moc-items-container">
                            {order.items.map((item, idx) => (
                                <div key={idx} className="moc-item-row">
                                    <span>{item.name} <span className="moc-item-qty">x{item.quantity}</span></span>
                                    <span style={{ fontWeight: 600 }}>${(item.price * item.quantity).toFixed(2)}</span>
                                </div>
                            ))}
                            {(order.discount ?? 0) > 0 && (
                                <div className="moc-item-row" style={{ color: '#DC2626' }}>
                                    <span>Discount</span>
                                    <span style={{ fontWeight: 600 }}>-${(order.discount ?? 0).toFixed(2)}</span>
                                </div>
                            )}
                            <div className="moc-total-row">
                                <span>Total</span>
                                <span>${order.total.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Status Section */}
                    <div className="moc-section">
                        <div className="moc-section-title">Status</div>
                        <div className="moc-status-section">
                            <div className="moc-status-row">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <Package size={14} color="#6B7280" />
                                    <span className="moc-status-label">Order</span>
                                </div>
                                <div className="moc-status-control">
                                    <StatusBadge
                                        status={order.shipping?.status || 'Pending'}
                                        readOnly={!canEdit || order.shipping?.status === 'ReStock' || order.shipping?.status === 'Delivered' || order.shipping?.status === 'Returned' || order.shipping?.status === 'Cancelled' || order.paymentStatus === 'Cancel'}
                                        disabledOptions={
                                            (order.shipping?.status === 'Shipped')
                                                ? ['Drafted', 'Pending', 'Confirmed', 'Cancelled', 'Shipped']
                                                : ['Delivered', 'Returned']
                                        }
                                        onChange={(newStatus) => onUpdateStatus(order.id, newStatus)}
                                    />
                                </div>
                            </div>
                            <div className="moc-status-row">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <CreditCard size={14} color="#6B7280" />
                                    <span className="moc-status-label">Payment</span>
                                </div>
                                <div className="moc-status-control">
                                    <PaymentStatusBadge
                                        status={order.paymentStatus || 'Paid'}
                                        onChange={(newStatus) => onUpdatePaymentStatus(order.id, newStatus)}
                                        readOnly={!canEdit || order.shipping?.status === 'ReStock' || order.shipping?.status === 'Drafted' || order.shipping?.status === 'Returned' || order.shipping?.status === 'Cancelled' || order.paymentStatus === 'Cancel' || order.paymentStatus === 'Paid'}
                                        disabledOptions={['Cancel']}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Actions Bar */}
                    <div className="moc-actions">
                        <button
                            onClick={(e) => { e.stopPropagation(); onPrint(order); }}
                            className={`moc-action-btn${!canPrint ? ' disabled' : ''}`}
                            disabled={!canPrint}
                        >
                            <Printer size={16} color={canPrint ? (order.isPrinted ? '#2563EB' : '#DC2626') : '#D1D5DB'} />
                            <span>Print</span>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onCopy(order); }} className="moc-action-btn">
                            <Copy size={16} />
                            <span>Copy</span>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onView(order); }} className="moc-action-btn">
                            <Eye size={16} />
                            <span>View</span>
                        </button>
                        {canEdit && (
                            <button onClick={(e) => { e.stopPropagation(); onEdit(order); }} className="moc-action-btn primary">
                                <Edit size={16} />
                                <span>Edit</span>
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default MobileOrderCard;
