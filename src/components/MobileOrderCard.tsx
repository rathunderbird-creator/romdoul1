import React, { useState, useRef } from 'react';
import { Edit, Eye, Printer, Copy, HandCoins, MapPin, Phone, Globe, Package, CreditCard, Truck, ExternalLink } from 'lucide-react';
import type { Sale } from '../types';
import StatusBadge from './StatusBadge';
import PaymentStatusBadge from './PaymentStatusBadge';
import { getOperatorForPhone } from '../utils/telecom';
import { paymentBadgeReadOnlyForNonAdmin, paymentBadgeDisabledForNonAdmin } from '../utils/orderStatusRules';
import { useTx, orderStatusDisplay } from './useTx';
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
    /** Copy payment request; absent when the order has nothing left to pay. */
    onCopyPaymentRequest?: (order: Sale) => void;
    /** Sales Setup › Customer Groups: this customer's group ('' = none). */
    customerGroup?: string;
    onUpdateStatus: (id: string, status: any) => void;
    onUpdatePaymentStatus: (id: string, status: any) => void;
    canEdit: boolean;
    isAdmin?: boolean;
    // A Salesman's unconfirmed deposit/payment (gray) and who may confirm it.
    canConfirmPayments?: boolean;
    isSalesman?: boolean;
    claimTitle?: string;
    claimDisabledOptions?: string[];
    salesmanDisabledOptions?: string[];
    canRestock?: boolean;
    /** Carrier tracking page for this order's tracking ID (opens in a new tab). */
    trackingUrl?: string | null;
    /** Last carrier status from the tracking cache. */
    carrierStatus?: { status: string; ago: string; delivered: boolean } | null;
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
    onCopyPaymentRequest,
    customerGroup,
    onUpdateStatus,
    onUpdatePaymentStatus,
    canEdit,
    isAdmin = false,
    canConfirmPayments = false,
    isSalesman = false,
    claimTitle,
    claimDisabledOptions = [],
    salesmanDisabledOptions,
    canRestock = true,
    trackingUrl = null,
    carrierStatus = null
}) => {
    const tx = useTx();
    const getInitials = (name: string) => {
        return name
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    // Stable per-customer avatar color (inbox-style).
    const avatarColor = (name: string) => {
        let hash = 0;
        for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
        return `hsl(${Math.abs(hash % 360)}, 60%, 55%)`;
    };

    // --- Swipe-left row actions (inbox style) ---
    const SWIPE_BTN_W = 64;
    const actionsWidth = SWIPE_BTN_W * (canEdit ? 3 : 2); // View, Copy, (Edit)
    const [swipeOpen, setSwipeOpen] = useState(false);
    const [dragOffset, setDragOffset] = useState<number | null>(null);
    const touchRef = useRef<{ x: number; y: number; horizontal: boolean | null } | null>(null);
    const suppressClickRef = useRef(false);

    const baseX = swipeOpen ? -actionsWidth : 0;
    const swipeX = dragOffset !== null ? Math.min(0, Math.max(-actionsWidth, baseX + dragOffset)) : baseX;

    const handleTouchStart = (e: React.TouchEvent) => {
        touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, horizontal: null };
    };
    const handleTouchMove = (e: React.TouchEvent) => {
        const t = touchRef.current;
        if (!t) return;
        const dx = e.touches[0].clientX - t.x;
        const dy = e.touches[0].clientY - t.y;
        if (t.horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
            t.horizontal = Math.abs(dx) > Math.abs(dy);
        }
        if (t.horizontal) setDragOffset(dx);
    };
    const handleTouchEnd = () => {
        const t = touchRef.current;
        touchRef.current = null;
        if (!t || t.horizontal === null || dragOffset === null) { setDragOffset(null); return; }
        suppressClickRef.current = true;
        setSwipeOpen(swipeX < -actionsWidth / 2);
        setDragOffset(null);
        // Allow the click suppression to clear after the tap that ends the swipe.
        setTimeout(() => { suppressClickRef.current = false; }, 80);
    };
    const closeSwipe = () => setSwipeOpen(false);
    const handleRowClick = () => {
        if (suppressClickRef.current) return;
        if (swipeOpen) { closeSwipe(); return; }
        onToggleExpand();
    };

    // Inbox-style timestamp: time for today, "Yesterday", else short date.
    const formatOrderTime = (d: string) => {
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return '';
        const now = new Date();
        if (dt.toDateString() === now.toDateString()) {
            return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        const yesterday = new Date(now.getTime() - 86400000);
        if (dt.toDateString() === yesterday.toDateString()) return tx('ui.components.common.yesterday', 'Yesterday');
        return dt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
    };

    const shippingStatus = (order.shipping?.status || 'Drafted').toLowerCase().replace(/\s+/g, '');
    const payStatus = order.paymentStatus || 'Unpaid';

    const isPaidOrSettle = payStatus === 'Paid';
    const isCancelled = payStatus === 'Cancel';

    const cardClass = `mobile-order-card status-${shippingStatus}`;

    // Row background — same colors and priority as the desktop table
    // (getRowClass / getRowBackgroundColor in Orders.tsx).
    const rowBackground = (() => {
        if (isSelected) return 'var(--color-primary-light)';
        const s = order.shipping?.status;
        if (s === 'ReStock') return '#2596be';
        if (payStatus === 'Cancel') return '#FCA5A5';
        if (s === 'Confirmed') return '#F0F9FF';
        if (s === 'Pending') return '#FFFBEB';
        if (s === 'Shipped') return '#EFF6FF';
        if (s === 'Delivered') return '#ECFDF5';
        if (s === 'Returned' || s === 'Cancelled') return '#FCA5A5';
        if (payStatus === 'Paid') return '#EFF6FF';
        return 'white';
    })();

    const getPayBadgeClass = () => {
        switch (payStatus) {
            case 'Paid': return 'pay-paid';
            case 'Unpaid': return 'pay-unpaid';
            case 'Deposit': return 'pay-deposit';
            case 'Get File': return 'pay-getfile';
            case 'Cancel': return 'pay-cancel';
            default: return 'pay-unpaid';
        }
    };

    const canPrint = ['Confirmed', 'Shipped', 'Delivered'].includes(order.shipping?.status || '');

    return (
        <div className={cardClass} style={{ background: rowBackground }}>
            {/* Header / Summary Row — inbox style, swipe left for quick actions */}
            <div className="moc-swipe-wrap">
                <div className="moc-swipe-actions" style={{ width: `${actionsWidth}px` }}>
                    <button className="moc-swipe-btn" style={{ background: '#6366F1' }} onClick={(e) => { e.stopPropagation(); closeSwipe(); onView(order); }}>
                        <Eye size={18} /><span>{tx('ui.components.common.view', 'View')}</span>
                    </button>
                    <button className="moc-swipe-btn" style={{ background: '#6B7280' }} onClick={(e) => { e.stopPropagation(); closeSwipe(); onCopy(order); }}>
                        <Copy size={18} /><span>{tx('ui.components.common.copy', 'Copy')}</span>
                    </button>
                    {canEdit && (
                        <button className="moc-swipe-btn" style={{ background: '#2563EB' }} onClick={(e) => { e.stopPropagation(); closeSwipe(); onEdit(order); }}>
                            <Edit size={18} /><span>{tx('common.edit', 'Edit')}</span>
                        </button>
                    )}
                </div>
                <div
                    className="moc-swipe-content"
                    style={{ transform: `translateX(${swipeX}px)`, transition: dragOffset !== null ? 'none' : 'transform 0.25s ease' }}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                >
            <div className="moc-header" onClick={handleRowClick}>
                {/* Avatar */}
                <div className="moc-avatar" style={{ background: avatarColor(order.customer?.name || 'Unknown') }}>
                    {getInitials(order.customer?.name || 'Unknown')}
                </div>

                {/* Center info */}
                <div className="moc-info">
                    <div className="moc-name-row">
                        <span className="moc-customer-name">
                            {order.customer?.name || tx('ui.components.common.unknown', 'Unknown')}
                        </span>
                        {customerGroup && (
                            <span title={tx('ui.orders.customerGroup.column', 'Customer group')}
                                style={{ flexShrink: 0, marginLeft: '6px', marginRight: 'auto', maxWidth: '90px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '10.5px', fontWeight: 700, padding: '1px 7px', borderRadius: '999px', background: '#EEF2FF', color: '#4338CA' }}>
                                {customerGroup}
                            </span>
                        )}
                        <span className="moc-time">{formatOrderTime(order.date)}</span>
                    </div>
                    <div className="moc-products-summary">
                        {order.items.length > 0 ? (
                            <>
                                {order.items[order.items.length - 1].name}
                                {order.items.length > 1 && <span style={{ color: '#9CA3AF' }}> +{order.items.length - 1}</span>}
                            </>
                        ) : tx('ui.components.orderCard.noItems', 'No items')}
                    </div>
                    <div className="moc-tags-row">
                        <span className={`moc-tag shipping-${shippingStatus}`}>
                            {orderStatusDisplay(tx, order.shipping?.status || 'Drafted')}
                        </span>
                        {claimTitle && order.paymentClaim ? (
                            // A Salesman's deposit/payment, not confirmed yet: gray.
                            <span className="moc-tag" title={claimTitle} style={{ background: '#F3F4F6', color: '#6B7280', border: '1px solid #D1D5DB' }}>
                                {tx(`dashboard2.pay.${order.paymentClaim.status}`, order.paymentClaim.status)}?
                            </span>
                        ) : (
                            <span className={`moc-tag ${getPayBadgeClass()}`}>
                                {payStatus === 'Get File' ? tx('ui.components.orderCard.file', 'File') : tx(`dashboard2.pay.${payStatus}`, payStatus)}
                            </span>
                        )}
                        {order.salesman && <span className="moc-tag tag-salesman">{order.salesman}</span>}
                        {order.customer?.page && <span className="moc-tag tag-page">{order.customer.page}</span>}
                        <span className="moc-total-amount" style={{ color: isCancelled ? '#9CA3AF' : (isPaidOrSettle ? '#059669' : '#DC2626') }}>
                            ${order.total.toFixed(2)}
                        </span>
                    </div>
                </div>
            </div>
                </div>
            </div>

            {/* Expanded Content */}
            {isExpanded && (
                <div className="moc-expanded">
                    {/* Customer Info Section */}
                    <div className="moc-section">
                        <div className="moc-section-title">{tx('ui.components.common.customer', 'Customer')}</div>
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
                        <div className="moc-section-title">{tx('ui.components.orderCard.items', 'Items')}</div>
                        <div className="moc-items-container">
                            {order.items.map((item, idx) => (
                                <div key={idx} className="moc-item-row">
                                    <span>{item.name} <span className="moc-item-qty">x{item.quantity}</span></span>
                                    <span style={{ fontWeight: 600 }}>${(item.price * item.quantity).toFixed(2)}</span>
                                </div>
                            ))}
                            {(order.discount ?? 0) > 0 && (
                                <div className="moc-item-row" style={{ color: '#DC2626' }}>
                                    <span>{tx('ui.components.common.discount', 'Discount')}</span>
                                    <span style={{ fontWeight: 600 }}>-${(order.discount ?? 0).toFixed(2)}</span>
                                </div>
                            )}
                            <div className="moc-total-row">
                                <span>{tx('common.total', 'Total')}</span>
                                <span>${order.total.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Status Section */}
                    <div className="moc-section">
                        <div className="moc-section-title">{tx('ui.components.report.status', 'Status')}</div>
                        <div className="moc-status-section">
                            <div className="moc-status-row">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <Package size={14} color="#6B7280" />
                                    <span className="moc-status-label">{tx('ui.components.orderCard.order', 'Order')}</span>
                                </div>
                                <div className="moc-status-control">
                                    <StatusBadge
                                        status={order.shipping?.status || 'Pending'}
                                        unrestricted={isAdmin}
                                        // Admins are never locked out — the store warns them (with a
                                        // confirm) before any transition that skips the stock flow.
                                        readOnly={!canEdit || (!isAdmin && (order.shipping?.status === 'ReStock' || order.shipping?.status === 'Returned' || order.shipping?.status === 'Cancelled' || order.paymentStatus === 'Cancel'))}
                                        disabledOptions={isAdmin ? (canRestock ? [] : ['ReStock']) : ((order.shipping?.status === 'Shipped')
                                            ? ['Drafted', 'Pending', 'Confirmed', 'Cancelled', 'Shipped']
                                            : (order.shipping?.status === 'Delivered')
                                                ? ['Drafted', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled']
                                                : (order.shipping?.status === 'ReStock')
                                                    ? ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned', 'Cancelled']
                                                    : ['Delivered', 'Returned']
                                        ).concat(canRestock ? [] : ['ReStock'])}
                                        onChange={(newStatus) => onUpdateStatus(order.id, newStatus)}
                                    />
                                </div>
                            </div>
                            <div className="moc-status-row">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <CreditCard size={14} color="#6B7280" />
                                    <span className="moc-status-label">{tx('ui.components.orderCard.payment', 'Payment')}</span>
                                </div>
                                <div className="moc-status-control">
                                    <PaymentStatusBadge
                                        status={claimTitle && order.paymentClaim ? order.paymentClaim.status : (order.paymentStatus || 'Unpaid')}
                                        unconfirmed={claimTitle}
                                        onChange={(newStatus) => onUpdatePaymentStatus(order.id, newStatus)}
                                        // Admins bypass the lock so they can correct mistakes
                                        // (e.g. un-mark a wrong Paid); the store cleans up the
                                        // logged income when leaving Paid.
                                        readOnly={claimTitle
                                            ? !canConfirmPayments
                                            : (!canEdit || (!isAdmin && (order.shipping?.status === 'ReStock' || order.shipping?.status === 'Drafted' || order.shipping?.status === 'Returned' || order.shipping?.status === 'Cancelled' || paymentBadgeReadOnlyForNonAdmin(order))))}
                                        disabledOptions={claimTitle ? claimDisabledOptions : [...(isAdmin ? [] : paymentBadgeDisabledForNonAdmin(order)), ...(salesmanDisabledOptions ?? (isSalesman ? ['Deposit', 'Paid', 'PdFee'] : []))]}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Carrier tracking (from the tracking cache) */}
                    {(trackingUrl || carrierStatus) && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '6px 12px', fontSize: '12px', borderTop: '1px solid var(--color-border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, color: carrierStatus?.delivered ? '#059669' : 'var(--color-text-secondary)' }}>
                                <Truck size={14} />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {carrierStatus ? `${carrierStatus.status}${carrierStatus.ago ? ' · ' + carrierStatus.ago : ''}` : (order.shipping?.trackingNumber || '')}
                                </span>
                            </div>
                            {trackingUrl && (
                                <a
                                    href={trackingUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--color-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}
                                >
                                    <ExternalLink size={13} /> {tx('ui.components.orderCard.track', 'Track')}
                                </a>
                            )}
                        </div>
                    )}

                    {/* Copy payment request: its own row, so the action bar
                        below keeps its four buttons on a narrow phone. */}
                    {onCopyPaymentRequest && (
                        <div className="moc-actions">
                            <button onClick={(e) => { e.stopPropagation(); onCopyPaymentRequest(order); }} className="moc-action-btn">
                                <HandCoins size={16} />
                                <span>{tx('ui.components.orderDetails.copyPaymentRequest', 'Copy payment request')}</span>
                            </button>
                        </div>
                    )}

                    {/* Actions Bar */}
                    <div className="moc-actions">
                        <button
                            onClick={(e) => { e.stopPropagation(); onPrint(order); }}
                            className={`moc-action-btn${!canPrint ? ' disabled' : ''}`}
                            disabled={!canPrint}
                        >
                            <Printer size={16} color={canPrint ? (order.isPrinted ? '#2563EB' : '#DC2626') : '#D1D5DB'} />
                            <span>{tx('ui.components.report.print', 'Print')}</span>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onCopy(order); }} className="moc-action-btn">
                            <Copy size={16} />
                            <span>{tx('ui.components.common.copy', 'Copy')}</span>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onView(order); }} className="moc-action-btn">
                            <Eye size={16} />
                            <span>{tx('ui.components.common.view', 'View')}</span>
                        </button>
                        {canEdit && (
                            <button onClick={(e) => { e.stopPropagation(); onEdit(order); }} className="moc-action-btn primary">
                                <Edit size={16} />
                                <span>{tx('common.edit', 'Edit')}</span>
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default MobileOrderCard;
