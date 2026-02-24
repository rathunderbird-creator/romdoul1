import React from 'react';
import { ChevronDown, Edit, Eye, Printer, Copy, MapPin, Phone, Globe } from 'lucide-react';
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
    // Generate initials or use generic avatar
    const getInitials = (name: string) => {
        return name
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    const getShippingColor = (status: string = '') => {
        switch (status) {
            case 'Pending': return '#D97706'; // Amber
            case 'Shipped': return '#2563EB'; // Blue
            case 'Delivered': return '#059669'; // Green
            case 'Cancelled': return '#DC2626'; // Red
            case 'Returned': return '#DC2626'; // Red
            case 'ReStock': return '#7E22CE'; // Purple
            case 'Ordered': return '#9CA3AF'; // Gray
            default: return '#4B5563'; // Gray
        }
    };

    const isPaidOrSettle = order.paymentStatus === 'Paid' || order.paymentStatus === 'Settled';
    const isDelivered = order.shipping?.status === 'Delivered';

    let cardClass = 'mobile-order-card';
    if (isSelected) cardClass += ' selected';
    else if (isPaidOrSettle) cardClass += ' paid-settled';
    else if (isDelivered) cardClass += ' delivered';

    return (
        <div className={cardClass}>
            {/* Header / Summary Row */}
            <div
                className="moc-header"
                onClick={onToggleExpand}
            >
                {/* Chevron */}
                <div
                    className="moc-chevron"
                    onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
                    style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                >
                    <ChevronDown size={20} />
                </div>

                {/* Checkbox - Hidden per request */
                /* <div className="moc-checkbox" onClick={(e) => e.stopPropagation()}>
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={onToggleSelect}
                    />
                </div> */}

                {/* Avatar & Name */}
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', overflow: 'hidden' }}>
                    <div className="moc-avatar">
                        {getInitials(order.customer?.name || 'Unknown')}
                    </div>
                    <div className="moc-info">
                        <span className="moc-customer-name">
                            {order.customer?.name}
                        </span>
                        <div className="moc-products-summary" style={{ fontSize: '12px', color: '#4B5563', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>
                            {order.items.length > 0 ? (
                                <>
                                    {order.items[order.items.length - 1].name}
                                    {order.items.length > 1 && <span style={{ color: '#6B7280' }}> + {order.items.length - 1} more</span>}
                                </>
                            ) : 'No items'}
                        </div>
                        <div className="moc-meta-row">
                            <span>${order.total.toFixed(2)}</span>
                            <span>•</span>
                            <span>{order.salesman || 'Unknown'}</span>
                            <span>•</span>
                            <span>{new Date(order.date).toLocaleDateString()} {new Date(order.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                    </div>
                </div>

                {/* Status Indicator (Mini) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
                    <div
                        className="moc-status-dot"
                        style={{ backgroundColor: order.paymentStatus === 'Cancel' ? '#DC2626' : getShippingColor(order.shipping?.status) }}
                    />
                </div>
            </div>

            {/* Expanded Content */}
            {isExpanded && (
                <div className="moc-expanded">
                    {/* Customer Details */}
                    <div className="moc-details-grid">
                        {order.customer?.phone && (() => {
                            const operator = getOperatorForPhone(order.customer.phone);
                            return (
                                <div className="moc-detail-item" style={{ gap: '6px' }}>
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

                    {/* Order Items */}
                    <div className="moc-items-container">
                        {order.items.map((item, idx) => (
                            <div key={idx} className="moc-item-row">
                                <span>{item.name} <span className="moc-item-qty">x{item.quantity}</span></span>
                                <span>${(item.price * item.quantity).toFixed(2)}</span>
                            </div>
                        ))}
                        <div className="moc-total-row">
                            <span>Total</span>
                            <span>${order.total.toFixed(2)}</span>
                        </div>
                    </div>

                    {/* Statuses */}
                    <div className="moc-status-section">
                        <div className="moc-status-row">
                            <span className="moc-status-label">Order Status</span>
                            <div className="moc-status-control">
                                <StatusBadge
                                    status={order.shipping?.status || 'Pending'}
                                    readOnly={!canEdit || order.shipping?.status === 'ReStock' || order.shipping?.status === 'Delivered' || order.paymentStatus === 'Cancel'}
                                    disabledOptions={
                                        (order.shipping?.status === 'Shipped')
                                            ? ['Ordered', 'Pending']
                                            : ['Delivered', 'Returned']
                                    }
                                    onChange={(newStatus) => onUpdateStatus(order.id, newStatus)}
                                />
                            </div>
                        </div>
                        <div className="moc-status-row">
                            <span className="moc-status-label">Payment</span>
                            <div className="moc-status-control">
                                <PaymentStatusBadge
                                    status={order.paymentStatus || 'Paid'}
                                    onChange={(newStatus) => onUpdatePaymentStatus(order.id, newStatus)}
                                    // simplified readOnly logic for mobile
                                    readOnly={!canEdit || order.shipping?.status === 'ReStock' || order.paymentStatus === 'Cancel' || order.paymentStatus === 'Paid'}
                                    disabledOptions={[]}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Actions Bar */}
                    <div className="moc-actions">
                        <button onClick={(e) => { e.stopPropagation(); onPrint(order); }} className="moc-action-btn">
                            <Printer size={18} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onCopy(order); }} className="moc-action-btn">
                            <Copy size={18} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onView(order); }} className="moc-action-btn">
                            <Eye size={18} />
                        </button>
                        {canEdit && (
                            <button onClick={(e) => { e.stopPropagation(); onEdit(order); }} className="moc-action-btn primary">
                                <Edit size={18} />
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default MobileOrderCard;
