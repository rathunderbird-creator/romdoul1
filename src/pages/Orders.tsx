import React, { useState, useMemo, useEffect, useRef, lazy } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, Search, Filter, X, ChevronLeft, ChevronRight, ChevronDown, Edit, Trash2, ArrowUp, ArrowDown, Upload, Eye, User, Copy, ExternalLink, Package, Truck, CreditCard, List, Store, Settings, Printer, Clock, CheckCircle, RefreshCw, ChevronsUpDown, MapPin, Check, Wallet, AlertTriangle, ShieldOff, ShieldCheck, Loader2, Table2 } from 'lucide-react';
import { useStore, normalizePhone } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { getOperatorForPhone } from '../utils/telecom';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import { StatusBadge, ReceiptModal, DateRangePicker, MobileOrderCard, BulkEditModal, Modal, SettlePaymentModal, DepositModal } from '../components';
import ShippingPointSelector from '../components/ShippingPointSelector';
import StockMovementSummaryModal from '../components/StockMovementSummaryModal';
import PaymentStatusBadge from '../components/PaymentStatusBadge';
import DataImportModal from '../components/DataImportModal';

const POSInterface = lazy(() => import('../components/POSInterface'));
const ShippingPointContent = lazy(() => import('../components/ShippingPointContent').then(module => ({ default: module.ShippingPointContent })));
const IncomeExpense = lazy(() => import('./IncomeExpense'));
const DeletedOrdersContent = lazy(() => import('./DeletedOrders').then(module => ({ default: module.DeletedOrdersContent })));

import { generateOrderCopyText, getShippingCoColor } from '../utils/orderUtils';
import { getPaymentLogo, getPaymentColor } from '../utils/payment';
import { getShippingLogo } from '../utils/shipping';
import { useClickOutside } from '../hooks/useClickOutside';
import { supabase } from '../lib/supabase';
import { mapSaleEntity } from '../utils/mapper';
import * as XLSX from 'xlsx';
import type { Sale } from '../types';

type SortConfig = {
    key: string;
    direction: 'asc' | 'desc';
} | null;

const getStatusBorderColor = (s: string) => {
    switch (s) {
        case 'Pending': return '#D97706';
        case 'Confirmed': return '#0369A1';
        case 'Shipped': return '#2563EB';
        case 'Delivered': return '#059669';
        case 'Cancelled': return '#DC2626';
        case 'Returned': return '#DC2626';
        case 'ReStock': return '#7E22CE';
        case 'Drafted': return '#111827';
        default: return '#4B5563';
    }
};

const ShippingModalComponent: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    order: Sale | null;
    targetStatus?: 'Confirmed' | 'Shipped';
}> = ({ isOpen, onClose, order, targetStatus = 'Shipped' }) => {
    const { shippingCompanies, customerCare, updateOrder, updateOrderStatus } = useStore();
    const { showToast } = useToast();

    const [selectedCompany, setSelectedCompany] = useState<string>('');
    const [shippingRemark, setShippingRemark] = useState<string>('');
    const [shippingAddress, setShippingAddress] = useState<string>('');
    const [shippingCustomerCare, setShippingCustomerCare] = useState<string>('');
    const [isShippingPointSelectorOpen, setIsShippingPointSelectorOpen] = useState(false);

    const handleShippingPointSelect = (data: any) => {
        const parts = [data.addressDetail || data.customName, data.commune, data.district, data.province].filter(Boolean);
        setShippingAddress(parts.join(', '));

        if (data.courier) {
            setSelectedCompany(data.courier);
        }

        setIsShippingPointSelectorOpen(false);
    };

    useEffect(() => {
        if (isOpen && order) {
            setSelectedCompany(order.shipping?.company || shippingCompanies[0] || '');
            setShippingRemark(order.remark || '');
            setShippingAddress(order.customer?.address || '');
            setShippingCustomerCare(order.customerCare || '');
        }
    }, [isOpen, order, shippingCompanies]);

    if (!order) return null;

    return (
        <>
        <Modal isOpen={isOpen} onClose={onClose} title="Select Shipping Company">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                    Please select the shipping company for this order before changing its status to {targetStatus}.
                </p>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Shipping Company <span style={{ color: 'red' }}>*</span></label>
                    <select
                        value={selectedCompany}
                        onChange={(e) => setSelectedCompany(e.target.value)}
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none'
                        }}
                    >
                        <option value="" disabled>Select a company</option>
                        <option value="អ្នកដឹក" style={{ color: getShippingCoColor('អ្នកដឹក') }}>អ្នកដឹក</option>
                        {shippingCompanies.map(company => (
                            <option key={company} value={company} style={{ color: getShippingCoColor(company) }}>{company}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Remark</label>
                    <input
                        type="text"
                        placeholder="Add an optional remark..."
                        value={shippingRemark}
                        onChange={(e) => setShippingRemark(e.target.value)}
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none'
                        }}
                    />
                </div>
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-main)' }}>Address</label>
                        <button 
                            onClick={() => setIsShippingPointSelectorOpen(true)}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 12px', cursor: 'pointer', fontWeight: 600, boxShadow: '0 2px 4px rgba(239, 68, 68, 0.2)' }}
                        >
                            <MapPin size={12} /> ជ្រើសរើសទីតាំង
                        </button>
                    </div>
                    <input
                        type="text"
                        placeholder="Shipping address..."
                        value={shippingAddress}
                        onChange={(e) => setShippingAddress(e.target.value)}
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none'
                        }}
                    />
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Customer Care</label>
                    <select
                        value={shippingCustomerCare}
                        onChange={(e) => setShippingCustomerCare(e.target.value)}
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none'
                        }}
                    >
                        <option value="" disabled>Select Customer Care</option>
                        {(customerCare || []).map((cc: string) => (
                            <option key={cc} value={cc}>{cc}</option>
                        ))}
                    </select>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'transparent', color: 'var(--color-text-main)', cursor: 'pointer',
                            fontSize: '14px', fontWeight: 500
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={async () => {
                            if (!selectedCompany) {
                                showToast('Please select a shipping company', 'error');
                                return;
                            }
                            try {
                                const updates: Partial<Sale> = {};
                                if (shippingRemark !== (order.remark || '')) updates.remark = shippingRemark;
                                if (shippingCustomerCare !== (order.customerCare || '')) updates.customerCare = shippingCustomerCare;
                                if (shippingAddress !== (order.customer?.address || '')) {
                                    updates.customer = { ...order.customer, address: shippingAddress } as any;
                                }

                                if (Object.keys(updates).length > 0) {
                                    await updateOrder(order.id, updates);
                                }
                                await updateOrderStatus(order.id, targetStatus, order.shipping?.trackingNumber, selectedCompany);
                                showToast(targetStatus === 'Shipped' ? 'Order marked as shipped' : 'Order marked as confirmed', 'success');
                            } catch (e: any) {
                                console.error('Failed to update shipping status:', e);
                                showToast('Update failed. Please try again.', 'error');
                            } finally {
                                onClose();
                            }
                        }}
                        disabled={!selectedCompany}
                        className="primary-button"
                        style={{
                            padding: '10px 16px', borderRadius: '8px', border: 'none',
                            background: selectedCompany ? 'var(--color-primary)' : 'var(--color-border)',
                            color: 'white', cursor: selectedCompany ? 'pointer' : 'not-allowed',
                            fontSize: '14px', fontWeight: 600
                        }}
                    >
                        Save
                    </button>
                </div>
            </div>
        </Modal>
        <ShippingPointSelector 
            isOpen={isShippingPointSelectorOpen}
            onClose={() => setIsShippingPointSelectorOpen(false)}
            onSelect={handleShippingPointSelect}
            shippingCompanies={shippingCompanies}
        />
        </>
    );
};

const PendingRemarkModalComponent: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    order: Sale | null;
}> = ({ isOpen, onClose, order }) => {
    const { updateOrder, updateOrderStatus } = useStore();
    const { showToast } = useToast();

    const [remark, setRemark] = useState<string>('');

    useEffect(() => {
        if (isOpen && order) {
            setRemark(order.remark || '');
        }
    }, [isOpen, order]);

    if (!order) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Update Pending Remark">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                    Add or update the remark for this pending order before confirming.
                </p>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Remark</label>
                    <input
                        type="text"
                        placeholder="Add remark..."
                        value={remark}
                        onChange={(e) => setRemark(e.target.value)}
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none'
                        }}
                    />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'transparent', color: 'var(--color-text-main)', cursor: 'pointer',
                            fontSize: '14px', fontWeight: 500
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={async () => {
                            try {
                                if (remark !== (order.remark || '')) {
                                    await updateOrder(order.id, { remark });
                                }
                                await updateOrderStatus(order.id, 'Pending');
                                showToast('Order marked as Pending', 'success');
                            } catch (e: any) {
                                console.error('Failed to update pending status:', e);
                                showToast('Update failed. Please try again.', 'error');
                            } finally {
                                onClose();
                            }
                        }}
                        className="primary-button"
                        style={{
                            padding: '10px 16px', borderRadius: '8px', border: 'none',
                            background: 'var(--color-primary)',
                            color: 'white', cursor: 'pointer',
                            fontSize: '14px', fontWeight: 500
                        }}
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </Modal>
    );
};

// (The old "Select Payment Method" popup on Shipped -> Delivered was removed:
// Delivered is now a plain status change that leaves payment fields untouched.)

// Closed-out orders: stock and/or payment have already been reversed on these, so
// editing would re-run order logic against a reversal. They stay read-only until
// someone deliberately moves the order back to an active status from the order list.
// Mirrors the rule enforced in StoreContext: 'Delivered' and 'Returned' only make sense
// once the goods have shipped. Checked here too so the UI doesn't open a payment or
// remark modal for a transition the store will reject.
const POST_DISPATCH_STATUSES = ['Delivered', 'Returned'];
// Only 'Shipped' may lead here. Delivered and Returned are terminal — re-selecting either
// would re-open the payment flow and re-run accounting on an order that is already settled.
const canEnterPostDispatch = (order: Sale, target?: string) => {
    const cur = order.shipping?.status || 'Pending';
    // Returned is also allowed from Delivered: real post-delivery returns, and the
    // correction path when Delivered was selected by mistake.
    return cur === 'Shipped' || (target === 'Returned' && cur === 'Delivered');
};

// Always-visible chip group for the mobile filter drawer (no hidden dropdowns).
const DrawerChipGroup: React.FC<{ title: string; options: string[]; selected: string[]; onToggle: (v: string) => void }> = ({ title, options, selected, onToggle }) => (
    <div>
        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>{title}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {options.map(opt => {
                const active = selected.includes(opt);
                return (
                    <button
                        key={opt}
                        onClick={() => onToggle(opt)}
                        style={{ padding: '6px 12px', borderRadius: '16px', fontSize: '12px', fontWeight: 600, border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`, background: active ? 'var(--color-primary)' : 'var(--color-surface)', color: active ? 'white' : 'var(--color-text-main)', cursor: 'pointer', transition: 'all 0.15s' }}
                    >
                        {opt}
                    </button>
                );
            })}
        </div>
    </div>
);
// Column filter popover for the table header. Rendered through a portal with
// fixed positioning so the scrolling table container can never clip it, and
// edits a local draft that is applied on Apply / Enter / click-outside — not
// on every keystroke (which used to fire a server query per character).
const ColumnFilterPopover: React.FC<{
    anchor: HTMLElement | null;
    label: string;
    isDate: boolean;
    value: string;
    onApply: (value: string) => void;
    onClear: () => void;
    onClose: () => void;
}> = ({ anchor, label, isDate, value, onApply, onClear, onClose }) => {
    const [draft, setDraft] = useState(value);
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
    const WIDTH = 240;

    useEffect(() => {
        const update = () => {
            if (!anchor) return;
            const r = anchor.getBoundingClientRect();
            setPos({
                top: r.bottom + 6,
                left: Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8))
            });
        };
        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [anchor]);

    const commit = () => {
        if (draft !== value) onApply(draft);
        onClose();
    };

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node;
            if (ref.current?.contains(t) || anchor?.contains(t)) return;
            commit();
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draft, value, anchor]);

    const [start, end] = draft.includes('|') ? draft.split('|') : [draft, ''];
    const setRange = (s: string, e: string) => setDraft(s || e ? `${s}|${e}` : '');
    const inputStyle: React.CSSProperties = { flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '13px', outline: 'none', minWidth: 0 };

    return createPortal(
        <div
            ref={ref}
            className="glass-panel"
            style={{
                position: 'fixed', top: pos.top, left: pos.left, width: `${WIDTH}px`, zIndex: 9999,
                padding: '12px', background: 'white', boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
                borderRadius: '10px', border: '1px solid var(--color-border)',
                display: 'flex', flexDirection: 'column', gap: '8px'
            }}
        >
            {isDate ? (
                <>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', width: '38px', color: 'var(--color-text-secondary)' }}>From</span>
                        <input type="date" value={start} onChange={(e) => setRange(e.target.value, end)} className="search-input" style={inputStyle} />
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', width: '38px', color: 'var(--color-text-secondary)' }}>To</span>
                        <input type="date" value={end} onChange={(e) => setRange(start, e.target.value)} className="search-input" style={inputStyle} />
                    </div>
                </>
            ) : (
                <input
                    type="text"
                    autoFocus
                    placeholder={`Filter ${label}...`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
                    className="search-input"
                    style={{ ...inputStyle, width: '100%' }}
                />
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                <button
                    onClick={() => { onClear(); onClose(); }}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer', background: '#6B7280', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 500 }}
                >
                    <X size={14} /> Clear
                </button>
                <button
                    onClick={commit}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 500 }}
                >
                    <Check size={14} /> Apply
                </button>
            </div>
        </div>,
        document.body
    );
};

const postDispatchMessage = (current: string, target: string) =>
    ['Delivered', 'Returned'].includes(current)
        ? `This order is already ${current}. ${current} orders cannot be changed to ${target}.`
        : `Mark the order Shipped before ${target} — set it back to Drafted and follow Confirmed → Shipped.`;

// Statuses that count as (expected) revenue in the mobile footer's Total.
const REVENUE_TOTAL_STATUSES = ['Confirmed', 'Shipped', 'Delivered'];

// Balance still owed on an order. Zero when payment is cancelled / restocked,
// and for orders that are Drafted, Pending, or Cancelled — nothing is
// collectible before dispatch or after a void.
const orderBalance = (order: Sale): number => {
    // Special case: a Deposit order always shows what's still owed —
    // total minus the deposit received — regardless of shipping status.
    if (order.paymentStatus === 'Deposit') {
        return Math.max(0, order.total - (order.depositAmount || order.amountReceived || 0));
    }
    const s = order.shipping?.status;
    if (order.paymentStatus === 'Cancel' || s === 'ReStock' || s === 'Drafted' || s === 'Pending' || s === 'Cancelled') return 0;
    return order.total - (order.amountReceived || (order.paymentStatus === 'Paid' ? order.total : 0));
};

// ReStock orders stay editable (fixing details after a restock is a real
// need); only Cancelled and Returned remain locked.
const LOCKED_ORDER_STATUSES = ['Cancelled', 'Returned'];
const isOrderLocked = (order: Sale) => LOCKED_ORDER_STATUSES.includes(order.shipping?.status || '');
const lockedOrderMessage = (order: Sale) =>
    `This order is ${order.shipping?.status} and can no longer be edited. ` +
    `Change its status from the order list first if you need to reopen it.`;

const Orders: React.FC = () => {
    console.log('Orders render');
    // (Move refs below state declarations)
    const { sales, updateOrderStatus, updateOrder, updateOrders, deleteOrders, editingOrder, setEditingOrder, pinnedOrderColumns, toggleOrderColumnPin, importOrders, restockOrder, bulkRestockOrders, hasPermission, users, shippingCompanies, pages, refreshData, currentUser, salesUpdatedAt, loadMoreOrders, hasMoreOrders, isLoadingMore, blockedCustomers, addBlockedCustomer, addBlockedCustomers, removeBlockedCustomer, removeBlockedCustomers, addOnlineOrder } = useStore();
    const [isDuplicating, setIsDuplicating] = useState(false);

    const filterShippingCompanies = useMemo(() => {
        return ['អ្នកដឹក', ...shippingCompanies];
    }, [shippingCompanies]);

    const isAdmin = currentUser?.roleId === 'admin';
    const canEdit = hasPermission('manage_orders');
    const canManage = hasPermission('manage_orders');
    // Grantable per role in Roles & Permissions (admins always pass).
    const canUseCheckbox = hasPermission('use_checkbox');
    const canRestock = hasPermission('restock_orders');

    const { showToast } = useToast();
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();
    const location = useLocation();
    const navigate = useNavigate();

    // Tabs & View State
    const [activeTab, setActiveTab] = useState<'list' | 'pos'>(() => {
        return hasPermission('view_orders') ? 'list' : 'pos';
    });
    const [isIncomeModalOpen, setIsIncomeModalOpen] = useState(false);
    const [isDeletedModalOpen, setIsDeletedModalOpen] = useState(false);

    console.log('Orders Debug:', {
        currentUser,
        roleId: currentUser?.roleId,
        canCreate: hasPermission('create_orders'),
        canView: hasPermission('view_orders'),
        activeTab
    });

    // Update Header Content
    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Orders Management</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Manage and track all customer orders</p>
                </div>
            ),
            // Hidden on mobile: Order List / POS / Shipping Points tabs are desktop-only
            // (mobile reaches POS via the New Order FAB).
            actions: isMobile ? undefined : (
                <div style={{ display: 'flex', gap: '3px', background: 'var(--color-surface)', padding: '4px', borderRadius: '12px', border: '1px solid var(--color-border)', width: isMobile ? '100%' : 'auto' }}>
                    {hasPermission('view_orders') && (
                        <button
                            onClick={() => setActiveTab('list')}
                            style={{
                                padding: '8px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', flex: isMobile ? 1 : 'initial',
                                background: activeTab === 'list' ? 'var(--color-primary)' : 'transparent',
                                color: activeTab === 'list' ? 'white' : 'var(--color-text-secondary)',
                                fontWeight: 500, cursor: 'pointer', border: 'none'
                            }}
                        >
                            <List size={18} /> Order List
                        </button>
                    )}
                    {hasPermission('create_orders') && (
                        <button
                            onClick={() => setActiveTab('pos')}
                            style={{
                                padding: '8px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', flex: isMobile ? 1 : 'initial',
                                background: activeTab === 'pos' ? 'var(--color-primary)' : 'transparent',
                                color: activeTab === 'pos' ? 'white' : 'var(--color-text-secondary)',
                                fontWeight: 500, cursor: 'pointer', border: 'none'
                            }}
                        >
                            <Store size={18} /> POS
                        </button>
                    )}
                    {hasPermission('view_dashboard') && (
                        <button
                            onClick={() => setIsShippingPointModalOpen(true)}
                            style={{
                                padding: '8px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', flex: isMobile ? 1 : 'initial',
                                background: 'transparent',
                                color: 'var(--color-text-secondary)',
                                fontWeight: 500, cursor: 'pointer', border: 'none'
                            }}
                        >
                            <MapPin size={18} /> Shipping Points
                        </button>
                    )}
                    {isAdmin && !isMobile && (
                        <button
                            onClick={() => setIsIncomeModalOpen(true)}
                            style={{
                                padding: '8px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', flex: isMobile ? 1 : 'initial',
                                background: 'linear-gradient(135deg, #10B981, #059669)',
                                color: 'white',
                                fontWeight: 600, cursor: 'pointer', border: 'none',
                                boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
                                transition: 'all 0.2s ease',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.4)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.3)'; }}
                        >
                            <Wallet size={18} /> Check Income
                        </button>
                    )}
                    {isAdmin && !isMobile && (
                        <button
                            onClick={() => setIsMovementSummaryOpen(true)}
                            style={{
                                padding: '8px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', flex: isMobile ? 1 : 'initial',
                                background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
                                color: 'white',
                                fontWeight: 600, cursor: 'pointer', border: 'none',
                                boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)',
                                transition: 'all 0.2s ease',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.4)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.3)'; }}
                        >
                            <Table2 size={18} /> Show Movement
                        </button>
                    )}

                </div>
            )
        });

        return () => setHeaderContent(null);
    }, [setHeaderContent, activeTab, hasPermission, isMobile, isAdmin, canManage, navigate]); // Added dependencies

    // Filters with Persistence
    const [statusFilter, setStatusFilter] = useState<string[]>(() => {
        const saved = localStorage.getItem('orders_statusFilter');
        if (!saved || saved === 'All') return [];
        try {
            return JSON.parse(saved);
        } catch (e) {
            console.error('Failed to parse status filter:', e);
            return [];
        }
    });
    const [isStatusFilterOpen, setIsStatusFilterOpen] = useState(false);

    const [salesmanFilter, setSalesmanFilter] = useState<string>(() =>
        localStorage.getItem('orders_salesmanFilter') || 'All'
    );
    const [isSalesmanOpen, setIsSalesmanOpen] = useState(false);
    const [payStatusFilter, setPayStatusFilter] = useState<string[]>(() =>
        JSON.parse(localStorage.getItem('orders_payStatusFilter') || '[]')
    );
    const [isPayStatusOpen, setIsPayStatusOpen] = useState(false);

    const [shippingCoFilter, setShippingCoFilter] = useState<string[]>(() =>
        JSON.parse(localStorage.getItem('orders_shippingCoFilter') || '[]')
    );
    const [isShippingCoOpen, setIsShippingCoOpen] = useState(false);

    const [dateRange, setDateRange] = useState(() =>
        JSON.parse(localStorage.getItem('orders_dateRange') || '{"start": "", "end": ""}')
    );
    const [searchTerm, setSearchTerm] = useState(() =>
        localStorage.getItem('orders_searchTerm') || ''
    );

    const [columnFilters, setColumnFilters] = useState<Record<string, string>>(() => {
        const saved = localStorage.getItem('orders_columnFilters');
        return saved ? JSON.parse(saved) : {};
    });
    const [activeColFilter, setActiveColFilter] = useState<string | null>(null);
    // Anchors for the column-filter popover (one button per header cell).
    const filterBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

    useEffect(() => { localStorage.setItem('orders_columnFilters', JSON.stringify(columnFilters)); }, [columnFilters]);

    const [showFilters, setShowFilters] = useState(false);

    // Shipping Modal State
    const [isShippingModalOpen, setIsShippingModalOpen] = useState(false);
    const [shippingOrderToUpdate, setShippingOrderToUpdate] = useState<Sale | null>(null);
    const [shippingTargetStatus, setShippingTargetStatus] = useState<'Confirmed' | 'Shipped'>('Shipped');
    const [isShippingPointModalOpen, setIsShippingPointModalOpen] = useState(false);
    // "Show Movement" opens the shared stock recap popup (defaults to today).
    const [isMovementSummaryOpen, setIsMovementSummaryOpen] = useState(false);
    useEffect(() => {
        if (location.state) {
            const state = location.state as any;
            if (state.editOrderId) {
                const editId = state.editOrderId;
                const orderToEdit = sales.find(s => s.id === editId) || serverOrders.find(s => s.id === editId);
                if (orderToEdit) {
                    // Same rule as the edit buttons — this route (e.g. from the order
                    // detail page) would otherwise open the form for a restocked order.
                    if (isOrderLocked(orderToEdit)) {
                        showToast(lockedOrderMessage(orderToEdit), 'error');
                    } else {
                        setEditingOrder(orderToEdit);
                        setActiveTab('pos');
                    }
                    navigate(location.pathname, { replace: true, state: {} });
                }
            } else if (state.createNew) {
                setEditingOrder(null);
                setActiveTab('pos');
                navigate(location.pathname, { replace: true, state: {} });
            }
        }
    }, [location.state, sales, navigate, location.pathname]);

    // Persist Filters
    useEffect(() => { localStorage.setItem('orders_statusFilter', JSON.stringify(statusFilter)); }, [statusFilter]);
    useEffect(() => { localStorage.setItem('orders_salesmanFilter', salesmanFilter); }, [salesmanFilter]);
    useEffect(() => { localStorage.setItem('orders_payStatusFilter', JSON.stringify(payStatusFilter)); }, [payStatusFilter]);
    useEffect(() => { localStorage.setItem('orders_shippingCoFilter', JSON.stringify(shippingCoFilter)); }, [shippingCoFilter]);
    useEffect(() => { localStorage.setItem('orders_dateRange', JSON.stringify(dateRange)); }, [dateRange]);
    useEffect(() => { localStorage.setItem('orders_searchTerm', searchTerm); }, [searchTerm]);

    const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'date', direction: 'desc' });

    // Modals State
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [showTools, setShowTools] = useState(false);
    // editingOrder is from store

    const handleImportOrders = async (data: any[]) => {
        try {
            await importOrders(data);
            setIsImportModalOpen(false);
            showToast('Orders imported successfully', 'success');
            await fetchOrders();
        } catch (error: any) {
            console.error("Import failed:", error);
            showToast(`Failed to import orders: ${error.message || error}`, 'error');
        }
    };
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<Sale | null>(null);
    const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
    const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
    
    // Scammer Modal State
    const [isScammerModalOpen, setIsScammerModalOpen] = useState(false);
    const [scammerTargetOrder, setScammerTargetOrder] = useState<Sale | null>(null);
    const [scammerReason, setScammerReason] = useState('');

    // Selection State
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

    // Mobile Expansion State
    const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set());

    const toggleOrderExpansion = (id: string) => {
        const newExpanded = new Set(expandedOrderIds);
        if (newExpanded.has(id)) {
            newExpanded.delete(id);
        } else {
            newExpanded.add(id);
        }
        setExpandedOrderIds(newExpanded);
    };

    const toggleSelection = (id: string, event?: React.MouseEvent) => {
        const newSelected = new Set(selectedIds);

        if (event?.shiftKey && lastSelectedId) {
            const lastIndex = paginatedOrders.findIndex(o => o.id === lastSelectedId);
            const currentIndex = paginatedOrders.findIndex(o => o.id === id);

            if (lastIndex !== -1 && currentIndex !== -1) {
                const start = Math.min(lastIndex, currentIndex);
                const end = Math.max(lastIndex, currentIndex);

                const rangeOrders = paginatedOrders.slice(start, end + 1);

                // Add the range to the existing selection
                rangeOrders.forEach(o => newSelected.add(o.id));
            }
        } else {
            if (newSelected.has(id)) {
                newSelected.delete(id);
            } else {
                newSelected.add(id);
            }
            setLastSelectedId(id);
        }

        setSelectedIds(newSelected);
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredOrders.length && filteredOrders.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredOrders.map(o => o.id)));
        }
    };

    const handleBulkDelete = async (e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (confirm(`Are you sure you want to delete ${selectedIds.size} orders ? `)) {
            try {
                await deleteOrders(Array.from(selectedIds));
                setSelectedIds(new Set());
                showToast('Orders deleted successfully', 'success');
                await fetchOrders();
            } catch (error: any) {
                console.error('Failed to delete orders:', error);
                showToast('Failed to delete orders: ' + (error.message || 'Unknown error'), 'error');
            }
        }
    };

    const handleBulkRestock = async (e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (!canRestock) {
            showToast('You do not have permission to restock orders.', 'error');
            return;
        }
        if (confirm(`Are you sure you want to restock ${selectedIds.size} orders ? `)) {
            try {
                await bulkRestockOrders(Array.from(selectedIds));
                setSelectedIds(new Set());
                showToast('Orders restocked successfully', 'success');
                await fetchOrders();
            } catch (error: any) {
                console.error('Failed to restock orders:', error);
                showToast('Failed to restock orders: ' + (error.message || 'Unknown error'), 'error');
            }
        }
    };

    // Column Visibility and Pinning
    const [showColumnMenu, setShowColumnMenu] = useState(false);
    const allColumnsDef = [
        { id: 'actions', label: 'Actions' },
        { id: 'date', label: 'Date' },
        { id: 'customer', label: 'Customer' },
        { id: 'phone', label: 'Phone' },
        { id: 'address', label: 'Address' },
        { id: 'page', label: 'Page Name' },
        { id: 'salesman', label: 'Salesman' },
        { id: 'customerCare', label: 'Customer Care' },
        { id: 'items', label: 'Products' },
        { id: 'total', label: 'Total' },
        { id: 'payBy', label: 'Pay By' },
        { id: 'balance', label: 'Pending Balance' },
        { id: 'status', label: 'Order Status' },
        { id: 'received', label: 'Received' },
        { id: 'payStatus', label: 'Pay Status' },
        { id: 'shippingCo', label: 'Shipping Co' },
        { id: 'remark', label: 'Remark' },
        { id: 'tracking', label: 'Tracking ID' },
        { id: 'settleDate', label: 'Settled/Paid Date' },
        { id: 'lastEdit', label: 'Last Edit' },
    ];

    // Default visible columns
    const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
        const saved = localStorage.getItem('orders_visibleColumns');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                console.error('Failed to parse visible columns:', e);
            }
        }
        return [
            'actions', 'date', 'customer', 'phone', 'address', 'page', 'salesman', 'customerCare', 'items', 'total', 'payBy',
            'balance', 'status', 'received', 'payStatus', 'shippingCo', 'remark', 'tracking', 'settleDate', 'lastEdit'
        ];
    });

    // Persist Visible Columns
    useEffect(() => {
        localStorage.setItem('orders_visibleColumns', JSON.stringify(visibleColumns));
    }, [visibleColumns]);

    // Derived Columns with Pinning Logic
    const allColumns = useMemo(() => {
        const pinned = pinnedOrderColumns || [];
        // Sort so pinned columns come first, in the order they were pinned
        return [...allColumnsDef].sort((a, b) => {
            const indexA = pinned.indexOf(a.id);
            const indexB = pinned.indexOf(b.id);
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return 0; // Maintain original order for unpinned
        });
    }, [pinnedOrderColumns]);


    // Resizing State
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
        const saved = localStorage.getItem('pos_column_widths');
        return saved ? JSON.parse(saved) : {};
    });

    useEffect(() => {
        localStorage.setItem('pos_column_widths', JSON.stringify(columnWidths));
    }, [columnWidths]);
    const [resizingCol, setResizingCol] = useState<string | null>(null);
    const resizeRef = React.useRef<{ startX: number; startWidth: number; colId: string } | null>(null);

    const startResize = (e: React.MouseEvent, colId: string) => {
        e.preventDefault();
        e.stopPropagation();
        const currentWidth = columnWidths[colId] || (e.currentTarget.parentElement?.getBoundingClientRect().width ?? 150);
        resizeRef.current = { startX: e.clientX, startWidth: currentWidth, colId };
        setResizingCol(colId);
        document.addEventListener('mousemove', handleGlobalMouseMove);
        document.addEventListener('mouseup', handleGlobalMouseUp);
        document.body.style.cursor = 'col-resize';
    };

    const handleGlobalMouseMove = React.useCallback((e: MouseEvent) => {
        if (!resizeRef.current) return;
        const { startX, startWidth, colId } = resizeRef.current;
        const diff = e.clientX - startX;
        const newWidth = Math.max(50, startWidth + diff);
        // Fast DOM update avoiding React re-render of 100 rows
        document.documentElement.style.setProperty(`--col-${colId}-width`, `${newWidth}px`);
    }, []);

    const handleGlobalMouseUp = React.useCallback((e: MouseEvent) => {
        if (!resizeRef.current) return;
        const { startX, startWidth, colId } = resizeRef.current;
        const diff = e.clientX - startX;
        const newWidth = Math.max(50, startWidth + diff);

        // Save to state/localStorage only on mouse up
        setColumnWidths(prev => ({ ...prev, [colId]: newWidth }));

        // Clean up CSS var so React state takes over
        document.documentElement.style.removeProperty(`--col-${colId}-width`);

        resizeRef.current = null;
        setResizingCol(null);
        document.removeEventListener('mousemove', handleGlobalMouseMove);
        document.removeEventListener('mouseup', handleGlobalMouseUp);
        document.body.style.cursor = '';
    }, [handleGlobalMouseMove]);

    const autoFitColumn = (colId: string) => {
        const table = document.querySelector('.spreadsheet-table') as HTMLTableElement;
        if (!table) return;

        const visibleCols = allColumns.filter(c => visibleColumns.includes(c.id));
        const colIndex = visibleCols.findIndex(c => c.id === colId);
        if (colIndex === -1) return;
        const cellIndex = colIndex + 1; // +1 for checkbox column

        const measurer = document.createElement('div');
        measurer.style.cssText = 'position:absolute;visibility:hidden;height:auto;width:auto;white-space:nowrap;padding:0 12px;font-size:13px;font-family:inherit;';
        document.body.appendChild(measurer);

        let maxWidth = 40;

        const headerCell = table.tHead?.rows[0]?.cells[cellIndex];
        if (headerCell) {
            measurer.style.fontWeight = '600';
            measurer.textContent = (headerCell.textContent || '').trim();
            maxWidth = Math.max(maxWidth, measurer.scrollWidth + 40);
            measurer.style.fontWeight = '';
        }

        const rows = table.tBodies[0]?.rows;
        if (rows) {
            for (let i = 0; i < rows.length; i++) {
                const cell = rows[i]?.cells[cellIndex];
                if (cell) {
                    measurer.textContent = (cell.textContent || '').trim();
                    maxWidth = Math.max(maxWidth, measurer.scrollWidth);
                }
            }
        }

        document.body.removeChild(measurer);
        const finalWidth = Math.min(Math.max(maxWidth, 40), 600);

        if (resizeRef.current && resizeRef.current.colId === colId) {
            document.documentElement.style.removeProperty(`--col-${colId}-width`);
            resizeRef.current = null;
            setResizingCol(null);
            document.removeEventListener('mousemove', handleGlobalMouseMove);
            document.removeEventListener('mouseup', handleGlobalMouseUp);
            document.body.style.cursor = '';
        }

        setColumnWidths(prev => ({ ...prev, [colId]: finalWidth }));
    };

    const autoFitAllColumns = () => {
        const table = document.querySelector('.spreadsheet-table') as HTMLTableElement;
        if (!table) return;

        const visibleCols = allColumns.filter(c => visibleColumns.includes(c.id));
        
        const measurer = document.createElement('div');
        measurer.style.cssText = 'position:absolute;visibility:hidden;height:auto;width:auto;white-space:nowrap;padding:0 12px;font-size:13px;font-family:inherit;';
        document.body.appendChild(measurer);

        const newWidths = { ...columnWidths };

        visibleCols.forEach((col, colIndex) => {
            const cellIndex = colIndex + 1; // +1 for checkbox column
            let maxWidth = 40;

            const headerCell = table.tHead?.rows[0]?.cells[cellIndex];
            if (headerCell) {
                measurer.style.fontWeight = '600';
                measurer.textContent = (headerCell.textContent || '').trim();
                maxWidth = Math.max(maxWidth, measurer.scrollWidth + 40);
                measurer.style.fontWeight = '';
            }

            const rows = table.tBodies[0]?.rows;
            if (rows) {
                for (let i = 0; i < rows.length; i++) {
                    const cell = rows[i]?.cells[cellIndex];
                    if (cell) {
                        measurer.textContent = (cell.textContent || '').trim();
                        maxWidth = Math.max(maxWidth, measurer.scrollWidth);
                    }
                }
            }

            newWidths[col.id] = Math.min(Math.max(maxWidth, 40), 600);
        });

        document.body.removeChild(measurer);
        setColumnWidths(newWidths);
    };

    // Appearance State
    const [showAppearanceMenu, setShowAppearanceMenu] = useState(false);

    // Pending Modal State
    const [isPendingRemarkModalOpen, setIsPendingRemarkModalOpen] = useState(false);
    const [pendingOrderToUpdate, setPendingOrderToUpdate] = useState<Sale | null>(null);

    // Select Payment Method Modal State
    const [isPaymentMethodModalOpen, setIsPaymentMethodModalOpen] = useState(false);
    const [paymentMethodTargetOrder, setPaymentMethodTargetOrder] = useState<Sale | null>(null);
    const [depositTargetOrder, setDepositTargetOrder] = useState<Sale | null>(null);

    // Mobile: the filter bar is replaced by a right-side slide-in drawer.
    const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);

    const [tableSettings, setTableSettings] = useState<{ fontSize: number; padding: number; height: string }>(() => {
        const saved = localStorage.getItem('pos_table_settings');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.height === '44px') parsed.height = '35px';
            return parsed;
        }
        return { fontSize: 12, padding: 5, height: 'auto' };
    });

    useEffect(() => {
        localStorage.setItem('pos_table_settings', JSON.stringify(tableSettings));
    }, [tableSettings]);

    // -- Click Outside Refs --
    const statusFilterRef = useClickOutside<HTMLDivElement>(() => setIsStatusFilterOpen(false));
    const salesmanFilterRef = useClickOutside<HTMLDivElement>(() => setIsSalesmanOpen(false));
    const payStatusFilterRef = useClickOutside<HTMLDivElement>(() => setIsPayStatusOpen(false));
    const [pageFilter, setPageFilter] = useState<string[]>(() =>
        JSON.parse(localStorage.getItem('orders_pageFilter') || '[]')
    );
    const [isPageOpen, setIsPageOpen] = useState(false);
    useEffect(() => { localStorage.setItem('orders_pageFilter', JSON.stringify(pageFilter)); }, [pageFilter]);

    // Number of active filter groups — shown as a badge on the mobile filter button.
    const activeFilterCount =
        (statusFilter.length > 0 ? 1 : 0) +
        (payStatusFilter.length > 0 ? 1 : 0) +
        (salesmanFilter !== 'All' ? 1 : 0) +
        (shippingCoFilter.length > 0 ? 1 : 0) +
        (pageFilter.length > 0 ? 1 : 0) +
        ((dateRange.start || dateRange.end) ? 1 : 0);
    const pageFilterRef = useClickOutside<HTMLDivElement>(() => setIsPageOpen(false));
    const shippingCoFilterRef = useClickOutside<HTMLDivElement>(() => setIsShippingCoOpen(false));
    const appearanceMenuRef = useClickOutside<HTMLDivElement>(() => setShowAppearanceMenu(false));
    const columnMenuRef = useClickOutside<HTMLDivElement>(() => setShowColumnMenu(false));
    const toolsMenuRef = useClickOutside<HTMLDivElement>(() => setShowTools(false));

    // Cleanup on unmount
    React.useEffect(() => {
        return () => {
            document.removeEventListener('mousemove', handleGlobalMouseMove);
            document.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [handleGlobalMouseMove, handleGlobalMouseUp]);


    // Derived State (filteredOrders, paginatedOrders, stats) -> kept same essentially
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(200);
    // Mobile ignores itemsPerPage and infinite-scrolls in batches of this size.
    const MOBILE_PAGE_SIZE = 100;
    const [totalCount, setTotalCount] = useState(0);
    // Guards the infinite scroll: false once a fetch proves the server has no more
    // matching rows, so a count/length mismatch can never loop the loader forever.
    const [hasMoreMobile, setHasMoreMobile] = useState(true);
    // Revenue across ALL orders matching the filters (Confirmed/Shipped/Delivered
    // only). null = query failed; the footer then falls back to the loaded rows.
    const [revenueTotal, setRevenueTotal] = useState<number | null>(null);

    const [serverOrders, setServerOrders] = useState<Sale[]>([]);
    const [isLoadingOrders, setIsLoadingOrders] = useState(false);

    // Reset pagination when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [statusFilter, salesmanFilter, payStatusFilter, shippingCoFilter, pageFilter, dateRange, searchTerm, columnFilters, itemsPerPage, isMobile]);

    // Applies every active filter (status, salesman, pay status, shipping co,
    // page, date range, search, column filters) to a sales query builder.
    // Shared by the page fetch and the revenue-total query so both always agree.
    const applyOrderFilters = React.useCallback(async (query: any) => {
            if (statusFilter.length > 0) {
                query = query.in('shipping_status', statusFilter);
            }

            const isSalesman = currentUser?.roleId === 'salesman';
            const effectiveSalesmanFilter = (isSalesman && salesmanFilter === 'All') ? (currentUser?.name || 'All') : salesmanFilter;

            if (effectiveSalesmanFilter !== 'All') {
                query = query.eq('salesman', effectiveSalesmanFilter);
            }

            if (payStatusFilter.length > 0) {
                query = query.in('payment_status', payStatusFilter);
            }

            if (shippingCoFilter.length > 0) {
                query = query.in('shipping_company', shippingCoFilter);
            }

            if (pageFilter.length > 0) {
                query = query.in('page_source', pageFilter);
            }

            if (dateRange.start) {
                const start = new Date(dateRange.start);
                start.setHours(0, 0, 0, 0);
                query = query.gte('date', start.toISOString());
            }
            if (dateRange.end) {
                const end = new Date(dateRange.end);
                end.setHours(23, 59, 59, 999);
                query = query.lte('date', end.toISOString());
            }

            if (searchTerm.trim()) {
                const trimmedTerm = searchTerm.trim();
                const isExact = trimmedTerm.startsWith('"') && trimmedTerm.endsWith('"');
                const phrase = isExact ? trimmedTerm.slice(1, -1) : trimmedTerm;
                
                const terms = isExact ? (phrase ? [phrase] : []) : phrase.split(/[\s,]+/).filter(t => t.trim().length > 0);

                if (terms.length > 0) {
                    // Bulk target detection: If there are many terms, the user is pasting a list of IDs/Phones.
                    // Doing comprehensive ilike searching across 10 columns for > 15 terms breaks URL limits on PostgREST.
                    const isBulk = terms.length > 10;
                    
                    let matchingSaleIds: string[] = [];

                    if (!isBulk) {
                        // Combine item matching into one query using OR
                        let itemQuery = supabase
                            .from('sale_items')
                            .select('sale_id, sales!inner(date, shipping_status, salesman, payment_status, shipping_company, page_source)');

                        const itemOrFilters = terms.map(t => {
                            const escaped = t.toLowerCase().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                            return isExact ? `name.ilike."${escaped}"` : `name.ilike."%${escaped}%"`;
                        }).join(',');
                        itemQuery = itemQuery.or(itemOrFilters);

                        // Mirror the sales filters onto the inner joined table
                        if (statusFilter.length > 0) {
                            itemQuery = itemQuery.in('sales.shipping_status', statusFilter);
                        }
                        if (effectiveSalesmanFilter !== 'All') {
                            itemQuery = itemQuery.eq('sales.salesman', effectiveSalesmanFilter);
                        }
                        if (payStatusFilter.length > 0) {
                            itemQuery = itemQuery.in('sales.payment_status', payStatusFilter);
                        }
                        if (shippingCoFilter.length > 0) {
                            itemQuery = itemQuery.in('sales.shipping_company', shippingCoFilter);
                        }
                        if (pageFilter.length > 0) {
                            itemQuery = itemQuery.in('sales.page_source', pageFilter);
                        }
                        
                        if (dateRange.start) {
                            const start = new Date(dateRange.start);
                            start.setHours(0, 0, 0, 0);
                            itemQuery = itemQuery.gte('sales.date', start.toISOString());
                        }
                        if (dateRange.end) {
                            const end = new Date(dateRange.end);
                            end.setHours(23, 59, 59, 999);
                            itemQuery = itemQuery.lte('sales.date', end.toISOString());
                        }

                        // Order by sale_id descending to get newest first before the limit kicks in
                        itemQuery = itemQuery.order('sale_id', { ascending: false }).limit(50);

                        const { data: itemMatches } = await itemQuery;

                        if (itemMatches && itemMatches.length > 0) {
                            matchingSaleIds = Array.from(new Set(itemMatches.map((m: any) => m.sale_id))).slice(0, 50);
                        }
                    }

                    if (isBulk) {
                        // Safely map values into an 'in' string, e.g. "term1","term2"
                        const inList = terms.map(t => `"${t.replace(/"/g, '""')}"`).join(',');
                        query = query.or(`id.in.(${inList}),tracking_number.in.(${inList}),customer_snapshot->>phone.in.(${inList})`);
                    } else {
                        // Build the comprehensive OR string combining all terms for complex partial text searches
                        let finalOrFilters: string[] = [];
                        
                        for (const term of terms) {
                            const escapedTerm = term.toLowerCase().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                            const matchStr = isExact ? `"${escapedTerm}"` : `"%${escapedTerm}%"`;
                            finalOrFilters.push(`id.ilike.${matchStr},salesman.ilike.${matchStr},remark.ilike.${matchStr},customer_care.ilike.${matchStr},shipping_company.ilike.${matchStr},tracking_number.ilike.${matchStr},payment_method.ilike.${matchStr},customer_snapshot->>name.ilike.${matchStr},customer_snapshot->>phone.ilike.${matchStr},customer_snapshot->>city.ilike.${matchStr}`);
                        }

                        let orFilter = finalOrFilters.join(',');

                        if (matchingSaleIds.length > 0) {
                            orFilter += `,id.in.(${matchingSaleIds.join(',')})`;
                        }

                        query = query.or(orFilter);
                    }
                }
            }

            for (const [key, val] of Object.entries(columnFilters)) {
                if (!val || typeof val !== 'string' || !val.trim()) continue;
                const v = val.trim();
                const esc = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                
                switch (key) {
                    // Date-range column filters: "From" only = that day onward,
                    // "To" only = up to that day, both = the inclusive range.
                    // (Previously a lone From collapsed to a single day.)
                    case 'date':
                    case 'settleDate': {
                        const col = key === 'date' ? 'date' : 'settle_date';
                        const parts = v.split('|');
                        const startStr = parts[0];
                        const endStr = parts.length > 1 ? parts[1] : '';
                        if (startStr) {
                            const start = new Date(startStr);
                            start.setHours(0, 0, 0, 0);
                            query = query.gte(col, start.toISOString());
                        }
                        if (endStr) {
                            const end = new Date(endStr);
                            end.setHours(23, 59, 59, 999);
                            query = query.lte(col, end.toISOString());
                        }
                        break;
                    }
                    case 'customer':
                        query = query.ilike('customer_snapshot->>name', `%${esc}%`);
                        break;
                    case 'phone':
                        query = query.ilike('customer_snapshot->>phone', `%${esc}%`);
                        break;
                    case 'address':
                        query = query.ilike('customer_snapshot->>address', `%${esc}%`);
                        break;
                    case 'page':
                        query = query.ilike('customer_snapshot->>page', `%${esc}%`);
                        break;
                    case 'salesman':
                        query = query.ilike('salesman', `%${esc}%`);
                        break;
                    case 'customerCare':
                        query = query.ilike('customer_care', `%${esc}%`);
                        break;
                    case 'payBy':
                        query = query.ilike('payment_method', `%${esc}%`);
                        break;
                    case 'status':
                        query = query.ilike('shipping_status', `%${esc}%`);
                        break;
                    case 'payStatus':
                        query = query.ilike('payment_status', `%${esc}%`);
                        break;
                    case 'shippingCo':
                        query = query.ilike('shipping_company', `%${esc}%`);
                        break;
                    case 'remark':
                        query = query.ilike('remark', `%${esc}%`);
                        break;
                    case 'tracking':
                        query = query.ilike('tracking_number', `%${esc}%`);
                        break;
                    case 'items': {
                        let itemQuery = supabase.from('sale_items').select('sale_id');
                        const numVal = Number(v.trim());
                        if (!isNaN(numVal) && v.trim() !== '') {
                            itemQuery = itemQuery.or(`name.ilike.%${esc}%,quantity.eq.${numVal}`);
                        } else {
                            itemQuery = itemQuery.ilike('name', `%${esc}%`);
                        }
                        const { data: colItemMatches } = await itemQuery.limit(300);

                        if (colItemMatches && colItemMatches.length > 0) {
                            const ids = Array.from(new Set(colItemMatches.map(m => m.sale_id))).slice(0, 200);
                            query = query.in('id', ids);
                        } else {
                            query = query.eq('id', 'NO_MATCH');
                        }
                        break;
                    }
                    case 'total':
                        if (!isNaN(Number(v))) query = query.eq('total', Number(v));
                        break;
                    case 'received':
                        if (!isNaN(Number(v))) query = query.eq('amount_received', Number(v));
                        break;
                    case 'balance':
                        if (!isNaN(Number(v))) query = query.eq('total', Number(v));
                        break;
                    case 'lastEdit':
                        query = query.ilike('last_edited_by', `%${esc}%`);
                        break;
                }
            }

        // PostgREST builders are thenables — returning one straight out of an
        // async function makes `await` EXECUTE the query and hand back its result
        // instead of the builder. Wrap it so the caller gets the builder intact.
        return { query };
    }, [statusFilter, salesmanFilter, payStatusFilter, shippingCoFilter, pageFilter, dateRange, searchTerm, currentUser, columnFilters]);

    const fetchOrders = React.useCallback(async () => {
        setIsLoadingOrders(true);
        try {
            let dbSortCol = 'date';
            if (sortConfig) {
                const map: Record<string, string> = {
                    'date': 'date',
                    'customer': 'customer_snapshot->name',
                    'phone': 'customer_snapshot->phone',
                    'address': 'customer_snapshot->address',
                    'page': 'page_source',
                    'salesman': 'salesman',
                    'customerCare': 'customer_care',
                    'total': 'total',
                    'balance': 'total',
                    'payBy': 'payment_method',
                    'shippingCo': 'shipping_company',
                    'tracking': 'tracking_number',
                    'status': 'shipping_status',
                    'received': 'amount_received',
                    'payStatus': 'payment_status',
                    'remark': 'remark',
                    'settleDate': 'settle_date',
                    'lastEdit': 'last_edited_at'
                };
                dbSortCol = map[sortConfig.key] || 'date';
            }

            let data: any[] | null = null;
            let count: number | null = null;

            if (isMobile) {
                // Mobile infinite scroll: each "page" widens the window from row 0, so a
                // refetch (edit, realtime update) rebuilds the whole loaded list
                // idempotently. Fetched in sub-cap chunks (rebuilt per chunk, like the
                // revenue sum below) because one wide .range() is silently truncated at
                // the API's max-rows limit — which hid orders past ~1000 and left the
                // "loaded < total" sentinel below firing forever.
                const targetTo = currentPage * MOBILE_PAGE_SIZE - 1;
                const CHUNK = 1000;
                const rows: any[] = [];
                let serverRanDry = false;
                for (let fromRow = 0; fromRow <= targetTo; fromRow += CHUNK) {
                    let chunkQuery: any = supabase.from('sales').select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)', { count: 'exact' });
                    chunkQuery = (await applyOrderFilters(chunkQuery)).query;
                    const toRow = Math.min(fromRow + CHUNK - 1, targetTo);
                    const { data: chunk, count: chunkCount, error: chunkError } = await chunkQuery
                        .order(dbSortCol, { ascending: sortConfig?.direction === 'asc' })
                        .order('id', { ascending: true })
                        .range(fromRow, toRow);
                    if (chunkError) throw chunkError;
                    if (count === null) count = chunkCount ?? 0;
                    rows.push(...(chunk || []));
                    if (!chunk || chunk.length < (toRow - fromRow + 1)) { serverRanDry = true; break; }
                }
                data = rows;
                setHasMoreMobile(!serverRanDry && rows.length < (count || 0));
            } else {
                // Desktop: one page. Built here (not before the branch) so the mobile
                // path doesn't pay for a filtered query it never executes —
                // applyOrderFilters can run real sale_items subqueries.
                let query: any = supabase.from('sales').select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)', { count: 'exact' });
                query = (await applyOrderFilters(query)).query;
                // Secondary sort on id keeps paged windows deterministic when the
                // primary sort column has ties (row order is unspecified otherwise).
                query = query.order(dbSortCol, { ascending: sortConfig?.direction === 'asc' }).order('id', { ascending: true });
                const from = (currentPage - 1) * itemsPerPage;
                const to = from + itemsPerPage - 1;
                const res = await query.range(from, to);
                if (res.error) throw res.error;
                data = res.data;
                count = res.count;
            }

            setTotalCount(count || 0);

            const mapped = (data || []).map(mapSaleEntity);
            setServerOrders(mapped);

            // Mobile footer Total: revenue across ALL matching orders (not just the
            // loaded window), counting only Confirmed / Shipped / Delivered. Summed
            // client-side in chunks — works without PostgREST aggregates and isn't
            // silently capped by the API's max-rows limit.
            if (isMobile) {
                try {
                    let revenue = 0;
                    const CHUNK = 1000;
                    for (let fromRow = 0; fromRow < 20000; fromRow += CHUNK) {
                        let sumQuery: any = supabase.from('sales').select('total');
                        sumQuery = (await applyOrderFilters(sumQuery)).query;
                        const { data: rows, error: sumError } = await sumQuery
                            .in('shipping_status', REVENUE_TOTAL_STATUSES)
                            // Stable order keeps the chunk windows non-overlapping —
                            // without it rows can shift between requests and be
                            // double-counted or skipped.
                            .order('id', { ascending: true })
                            .range(fromRow, fromRow + CHUNK - 1);
                        if (sumError) throw sumError;
                        for (const r of rows || []) revenue += Number((r as any).total) || 0;
                        if (!rows || rows.length < CHUNK) break;
                    }
                    setRevenueTotal(revenue);
                } catch (sumErr) {
                    console.error('Failed to compute revenue total:', sumErr);
                    setRevenueTotal(null);
                }
            }
        } catch (err) {
            console.error("Fetch orders failed", err);
        } finally {
            setIsLoadingOrders(false);
        }
    }, [applyOrderFilters, sortConfig, currentPage, itemsPerPage, salesUpdatedAt, isMobile]);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    // Mobile infinite scroll: widen the window when the bottom sentinel nears the viewport.
    const loadMoreSentinelRef = React.useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!isMobile || activeTab !== 'list') return;
        const el = loadMoreSentinelRef.current;
        if (!el) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !isLoadingOrders && hasMoreMobile && serverOrders.length < totalCount) {
                setCurrentPage(p => p + 1);
            }
        }, { rootMargin: '400px' });
        observer.observe(el);
        return () => observer.disconnect();
    }, [isMobile, activeTab, isLoadingOrders, hasMoreMobile, serverOrders.length, totalCount]);

    // Derived states based on the SINGLE PAGE of fetched items
    const filteredOrders = serverOrders;

    const duplicateOrderIds = useMemo(() => {
        const exactMatches = new Map<string, string[]>();
        serverOrders.forEach(order => {
            const dateStr = new Date(order.date).toLocaleDateString();
            const itemsStr = order.items.map(i => `${i.name}_${i.quantity}`).sort().join('|');
            const customerName = String(order.customer?.name || '').trim().toLowerCase();
            const customerPhone = String(order.customer?.phone || '').trim();
            const key = `${customerName}_${customerPhone}_${order.total}_${dateStr}_${itemsStr}`;

            if (!exactMatches.has(key)) {
                exactMatches.set(key, []);
            }
            exactMatches.get(key)!.push(order.id);
        });

        const duplicates = new Set<string>();
        exactMatches.forEach(ids => {
            if (ids.length > 1) {
                ids.forEach(id => duplicates.add(id));
            }
        });
        return duplicates;
    }, [serverOrders]);

    const getRowClass = (order: Sale) => {
        if (selectedIds.has(order.id)) return 'selected';
        if (duplicateOrderIds.has(order.id)) return 'duplicate-row';

        // Priority 1: Shipping Status = ReStock
        if (order.shipping?.status === 'ReStock') return 'restock-row';

        // Priority 2: Payment Status = Cancel
        if (order.paymentStatus === 'Cancel') return 'returned-row';

        // Priority 2: Shipping Status
        const shippingStatus = order.shipping?.status;
        if (shippingStatus === 'Drafted') return 'ordered-row';
        if (shippingStatus === 'Confirmed') return 'confirmed-row';
        if (shippingStatus === 'Pending') return 'pending-row';
        if (shippingStatus === 'Shipped') return 'shipped-row';
        if (shippingStatus === 'Delivered') return 'delivered-row';
        if (shippingStatus === 'Returned') return 'returned-row';
        if (shippingStatus === 'Cancelled') return 'returned-row';

        // Secondary: Payment Status
        if (order.paymentStatus === 'Paid') return 'paid-settled-row';

        return '';
    };

    const getRowBackgroundColor = (order: Sale, isSelected: boolean) => {
        if (isSelected) return 'var(--color-primary-light)';
        if (duplicateOrderIds.has(order.id)) return '#6B21A8';

        // Priority 1: Shipping Status = ReStock
        if (order.shipping?.status === 'ReStock') return '#2596be';

        // Priority 2: Payment Status = Cancel
        if (order.paymentStatus === 'Cancel') return '#FCA5A5'; // Red 300

        // Priority 2: Shipping Status
        const shippingStatus = order.shipping?.status;
        if (shippingStatus === 'Drafted') return 'white';
        if (shippingStatus === 'Confirmed') return '#F0F9FF';
        if (shippingStatus === 'Pending') return '#FFFBEB';
        if (shippingStatus === 'Shipped') return '#EFF6FF';
        if (shippingStatus === 'Delivered') return '#ECFDF5';
        if (shippingStatus === 'Returned') return '#FCA5A5';
        if (shippingStatus === 'Cancelled') return '#FCA5A5';
        return 'white';
    };



    const paginatedOrders = serverOrders;

    const stats = useMemo(() => {
        const totalOrders = totalCount;
        const totalRevenue = filteredOrders.reduce((sum, order) => {
            const isCancelled = order.paymentStatus === 'Cancel' || order.shipping?.status === 'ReStock';
            return sum + (isCancelled ? 0 : order.total);
        }, 0);
        const totalReceived = filteredOrders.reduce((sum, order) => {
            const isCancelled = order.paymentStatus === 'Cancel' || order.shipping?.status === 'ReStock';
            return sum + (isCancelled ? 0 : (order.amountReceived || (order.paymentStatus === 'Paid' ? order.total : 0)));
        }, 0);
        // Sum of the per-row Balance column (same rule as the cells, so the
        // footer always matches what's shown).
        const totalOutstanding = filteredOrders.reduce((sum, order) => sum + orderBalance(order), 0);
        const totalProducts = filteredOrders.reduce((sum, order) => {
            const isCancelled = order.paymentStatus === 'Cancel' || order.shipping?.status === 'ReStock';
            return sum + (isCancelled ? 0 : order.items.reduce((s, item) => s + item.quantity, 0));
        }, 0);
        const statusCounts = filteredOrders.reduce((acc, order) => {
            const status = order.shipping?.status || 'Pending';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        const payStatusCounts = filteredOrders.reduce((acc, order) => {
            const status = order.paymentStatus || 'Unpaid';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        const productCounts = filteredOrders.reduce((acc, order) => {
            const isCancelled = order.paymentStatus === 'Cancel' || order.shipping?.status === 'ReStock';
            if (!isCancelled) {
                order.items.forEach(item => {
                    const name = item.name || 'Unknown Product';
                    acc[name] = (acc[name] || 0) + item.quantity;
                });
            }
            return acc;
        }, {} as Record<string, number>);
        return { totalOrders, totalRevenue, totalReceived, totalOutstanding, totalProducts, statusCounts, payStatusCounts, productCounts };
    }, [filteredOrders, totalCount]);

    const handleOpenAdd = () => {
        setEditingOrder(null);
        setActiveTab('pos');
    };

    const handleOpenEdit = (order: Sale) => {
        if (isOrderLocked(order)) {
            showToast(lockedOrderMessage(order), 'error');
            return;
        }
        setEditingOrder(order);
        setActiveTab('pos');
    };

    // Helper to calculate sticky left offset
    const getStickyLeft = (colId: string) => {
        const pinned = pinnedOrderColumns || [];
        const index = pinned.indexOf(colId);
        if (index === -1) return undefined;

        // Base offset for the first checkbox column
        let left = 40;

        // Add widths of preceding pinned columns
        for (let i = 0; i < index; i++) {
            const pid = pinned[i];
            // If a pinned column is hidden, it shouldn't contribute to offset?
            // Assuming pinned columns are visible for now, or check visibleColumns
            if (visibleColumns.includes(pid)) {
                left += (columnWidths[pid] || 150);
            }
        }
        return left;
    };

    const handleExportExcel = () => {
        const selectedOrders = filteredOrders.filter(order => selectedIds.has(order.id));

        if (selectedOrders.length === 0) {
            showToast('No orders selected to export', 'error');
            return;
        }

        const data = selectedOrders.map(order => ({
            'Order ID': order.id,
            'Date': new Date(order.date).toLocaleDateString(),
            'Customer': order.customer?.name || 'N/A',
            'Phone': order.customer?.phone || 'N/A',
            'Address': order.customer?.address || 'N/A',
            'City': order.customer?.city || 'N/A',
            'Page': order.customer?.page || 'N/A',
            'Platform': order.customer?.platform || 'N/A',
            'Salesman': order.salesman || 'N/A',
            'Customer Care': order.customerCare || 'N/A',
            'Items': order.items.map(i => `${i.name} (${i.quantity})`).join(', '),
            'Total Amount': order.total,
            'Payment Method': order.paymentMethod,
            'Payment Status': order.paymentStatus || 'Paid',
            'Settle Date': order.settleDate ? new Date(order.settleDate).toLocaleDateString() : 'N/A',
            'Shipping Company': order.shipping?.company || 'N/A',
            'Shipping Status': order.shipping?.status || 'Pending',
            'Tracking Number': order.shipping?.trackingNumber || 'N/A',
            'Remarks': order.remark || ''
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);

        // Auto-width for columns
        const colWidths = [
            { wch: 20 }, // Order ID
            { wch: 12 }, // Date
            { wch: 20 }, // Customer
            { wch: 15 }, // Phone
            { wch: 30 }, // Address
            { wch: 15 }, // City
            { wch: 15 }, // Page
            { wch: 15 }, // Platform
            { wch: 15 }, // Salesman
            { wch: 15 }, // Customer Care
            { wch: 40 }, // Items
            { wch: 12 }, // Total
            { wch: 15 }, // Method
            { wch: 15 }, // Pay Status
            { wch: 15 }, // Settle Date
            { wch: 20 }, // Ship Company
            { wch: 15 }, // Ship Status
            { wch: 20 }, // Tracking
            { wch: 30 }  // Remarks
        ];
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, "Orders");

        // Generate filename with current date
        const dateStr = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
        XLSX.writeFile(wb, `Selected_Orders_Export_${dateStr}.xlsx`);

        showToast(`Exported ${selectedOrders.length} orders to Excel`, 'success');
    };

    const handleDelete = async () => {
        if (selectedIds.size === 0) return;

        if (window.confirm(`Are you sure you want to delete ${selectedIds.size} orders? \n\nIMPORTANT: The items in these orders will be returned to the product stock.`)) {
            try {
                await deleteOrders(Array.from(selectedIds));
                setSelectedIds(new Set());
                showToast('Orders deleted and stock restored', 'success');
                await fetchOrders();
            } catch (error: any) {
                console.error('Failed to delete orders:', error);
                showToast('Failed to delete orders: ' + (error.message || 'Unknown error'), 'error');
            }
        }
    };

    // settleDate / payBy come from the Bulk Edit modal's Payment section.
    const handleBulkEdit = async (field: 'date' | 'status' | 'paymentStatus' | 'settleDate', value: any, settleDate?: string, payBy?: string) => {
        if (selectedIds.size === 0) return;

        try {
            let ids = Array.from(selectedIds);
            const updates: Partial<Sale> = {};

            if (field === 'date') {
                updates.date = new Date(value).toISOString();
                await updateOrders(ids, updates);
            } else if (field === 'status') {
                // Route through updateOrderStatus (not updateOrders) so bulk status
                // changes run the same stock handling as single-row changes —
                // deducting/restoring products.stock and inventory_items, not just
                // logging movements. Sequential: parallel updates on orders sharing
                // a product would race the read-modify-write of its stock. Rows
                // already at the target status are skipped as quiet no-ops.
                for (const id of ids) {
                    const current = (serverOrders.find(s => s.id === id) || sales.find(s => s.id === id))?.shipping?.status;
                    if (current === value) continue;
                    await updateOrderStatus(id, value);
                }
            } else if (field === 'settleDate') {
                updates.settleDate = value ? new Date(value).toISOString() : null as any;
                await updateOrders(ids, updates);
            } else if (field === 'paymentStatus') {
                const now = new Date().toISOString();
                const promises = ids.map(id => {
                    const order = serverOrders.find(s => s.id === id) || sales.find(s => s.id === id);
                    if (!order) return Promise.resolve();
                    
                    const individualUpdates: Partial<Sale> = { paymentStatus: value };

                    if (value === 'Paid' || value === 'Settled') {
                        individualUpdates.amountReceived = order.total;
                        individualUpdates.settleDate = settleDate ? new Date(settleDate).toISOString() : now;
                        // Pay By chosen in the modal — also feeds the income row's pay_by.
                        if (payBy) individualUpdates.paymentMethod = payBy as any;
                    } else if (value === 'Get File') {
                        // File collected, money not settled yet — no settle date. Keep a
                        // deposit visible in Received when one was taken.
                        individualUpdates.amountReceived = order.depositAmount || 0;
                        individualUpdates.settleDate = null as any;
                    } else if (value === 'Cancel' || value === 'Unpaid') {
                        individualUpdates.amountReceived = 0;
                        individualUpdates.settleDate = null as any;
                    }
                    
                    return updateOrder(id, individualUpdates);
                });
                await Promise.all(promises);
            }

            showToast(`Updated ${ids.length} orders`, 'success');
            setSelectedIds(new Set()); // Clear selection
            await fetchOrders();
        } catch (error) {
            console.error('Bulk edit failed:', error);
            showToast('Failed to update orders', 'error');
        }
    };



    // Render Helpers
    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const SortIcon = ({ columnKey }: { columnKey: string }) => {
        if (sortConfig?.key !== columnKey) return <ChevronsUpDown size={14} style={{ opacity: 0.3 }} />;
        return sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
    };

    // UI Helpers & Components

    // Legacy helper for Modal (can eventually reuse above logic properly)
    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'Pending': return <span style={{ background: '#FEF3C7', color: '#D97706', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> Pending</span>;
            case 'Shipped': return <span style={{ background: '#DBEAFE', color: '#2563EB', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}><Truck size={12} /> Shipped</span>;
            case 'Delivered': return <span style={{ background: '#D1FAE5', color: '#059669', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle size={12} /> Delivered</span>;
            case 'Cancelled': return <span style={{ background: '#FEE2E2', color: '#DC2626', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}><X size={12} /> Cancelled</span>;
            default: return <span>{status}</span>;
        }
    };

    // Duplicates the selected orders as fresh Drafted orders.
    //
    // Everything that describes an *outcome* is deliberately reset rather than copied:
    // payment status, amount received, settle date and tracking number all belong to
    // the original. Copying `paymentStatus: 'Paid'` would be the damaging one —
    // addOnlineOrder records an income transaction for paid orders, so a duplicate
    // would invent revenue that was never taken.
    const handleDuplicateSelected = async () => {
        if (isDuplicating || selectedIds.size === 0) return;

        const originals = filteredOrders.filter(o => selectedIds.has(o.id));
        if (originals.length === 0) return;
        if (!confirm(`Duplicate ${originals.length} order${originals.length > 1 ? 's' : ''} as new Drafted order${originals.length > 1 ? 's' : ''}?`)) return;

        setIsDuplicating(true);
        let created = 0;
        try {
            for (const original of originals) {
                const duplicate: Omit<Sale, 'id'> = {
                    items: original.items.map(item => ({ ...item })),
                    total: original.total,
                    discount: original.discount,
                    date: new Date().toISOString(),
                    paymentMethod: original.paymentMethod,
                    type: original.type,
                    salesman: original.salesman,
                    customerCare: original.customerCare,
                    remark: original.remark,
                    pageSource: original.pageSource,
                    customer: original.customer ? { ...original.customer } : undefined,

                    // Reset outcome fields — this is a new, unstarted order.
                    paymentStatus: 'Unpaid',
                    amountReceived: 0,
                    settleDate: undefined,
                    orderStatus: 'Open',
                    isPrinted: false,
                    shipping: {
                        company: original.shipping?.company || '',
                        trackingNumber: '',
                        status: 'Drafted',
                        cost: original.shipping?.cost || 0,
                        staffName: original.shipping?.staffName,
                    },
                };

                await addOnlineOrder(duplicate);
                created++;
            }

            setSelectedIds(new Set());
            showToast(`Created ${created} new Drafted order${created > 1 ? 's' : ''}`, 'success');
        } catch (error) {
            console.error('Failed to duplicate orders:', error);
            showToast(
                `Duplicated ${created} of ${originals.length} before failing: ` +
                (error instanceof Error ? error.message : 'unknown error'),
                'error'
            );
        } finally {
            setIsDuplicating(false);
        }
    };

    const handleCopyOrder = (order: Sale) => {
        const text = generateOrderCopyText(order, sales);

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(() => showToast('Order details copied to clipboard', 'success'))
                .catch((err) => {
                    console.error('Clipboard write failed:', err);
                    fallbackCopyTextToClipboard(text);
                });
        } else {
            fallbackCopyTextToClipboard(text);
        }
    };

    const fallbackCopyTextToClipboard = (text: string) => {
        const textArea = document.createElement("textarea");
        textArea.value = text;

        // Ensure strictly accessible for selection but minimally visible
        textArea.style.position = 'fixed';
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.width = '2em';
        textArea.style.height = '2em';
        textArea.style.padding = '0';
        textArea.style.border = 'none';
        textArea.style.outline = 'none';
        textArea.style.boxShadow = 'none';
        textArea.style.background = 'transparent';

        // Using very low opacity instead of 0, as some browsers ignore opacity:0 selection
        textArea.style.opacity = '0.01';

        document.body.appendChild(textArea);

        if (navigator.userAgent.match(/ipad|iphone/i)) {
            // iOS needs contentEditable
            textArea.contentEditable = 'true';
            textArea.readOnly = false;
        } else {
            textArea.focus();
        }

        // Just use select() and setSelectionRange, creating a range on a textarea value does not work via selectNodeContents
        textArea.select();
        textArea.setSelectionRange(0, 999999); // Universal

        try {
            const successful = document.execCommand('copy');
            if (successful) {
                showToast('Order details copied to clipboard', 'success');
            } else {
                showToast('Copy failed. Please copy manually.', 'error');
            }
        } catch (err) {
            console.error('Fallback copy failed:', err);
            showToast('Copy error', 'error');
        }

        document.body.removeChild(textArea);
    };

    const hasFilters = statusFilter.length > 0 || salesmanFilter !== 'All' || searchTerm !== '' || payStatusFilter.length > 0 || shippingCoFilter.length > 0 || pageFilter.length > 0 || (dateRange.start && dateRange.end) || Object.keys(columnFilters).length > 0;

    // Shared by the toolbar's "Clear Filters" button and the empty-state row, so a
    // user who filters themselves down to nothing can recover without hunting for
    // which of the ten filters is responsible.
    const clearAllFilters = () => {
        setSearchTerm('');
        setStatusFilter([]);
        setSalesmanFilter('All');
        setPayStatusFilter([]);
        setShippingCoFilter([]);
        setPageFilter([]);
        setColumnFilters({});
        setDateRange({ start: '', end: '' });
    };

    // +1 for the leading checkbox/status column, which sits outside `visibleColumns`.
    const visibleColumnCount = allColumns.filter(col => visibleColumns.includes(col.id)).length + 1;

    // Shared by the desktop table body and the mobile card list. Distinguishes "your
    // filters excluded everything" (recoverable) from "there are genuinely no orders".
    const emptyStateContent = isLoadingOrders ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', fontSize: '14px' }}>
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
            Searching orders…
        </div>
    ) : hasFilters ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <Filter size={32} style={{ opacity: 0.25 }} />
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-main)' }}>No orders match your filters</div>
            <div style={{ fontSize: '13px' }}>Try widening the date range or removing a filter.</div>
            <button
                onClick={clearAllFilters}
                style={{ marginTop: '4px', padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#EF4444', color: 'white', fontSize: '13px', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
                <Filter size={14} /> Clear Filters
            </button>
        </div>
    ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <Package size={32} style={{ opacity: 0.25 }} />
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-main)' }}>No orders yet</div>
            <div style={{ fontSize: '13px' }}>New orders will appear here once they’re created.</div>
        </div>
    );

    return (
        <div>
            {/* Header */}
            {/* Header Moved to Global Header */}

            {activeTab === 'list' ? (
                <>


                    {/* Filters Bar */}
                    {/* Mobile: slim trigger bar — search + filter button opening the drawer */}
                    {isMobile && (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
                            <div style={{ position: 'relative', flex: 1 }}>
                                <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                                <input
                                    type="text"
                                    placeholder="Search orders..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: '12px', border: '1px solid var(--color-border)', fontSize: '14px', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                                />
                            </div>
                            <button
                                onClick={() => setIsFilterDrawerOpen(true)}
                                style={{ position: 'relative', width: '42px', height: '42px', borderRadius: '12px', border: '1px solid var(--color-border)', background: activeFilterCount > 0 ? 'var(--color-primary)' : 'var(--color-surface)', color: activeFilterCount > 0 ? 'white' : 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                            >
                                <Filter size={19} />
                                {activeFilterCount > 0 && (
                                    <span style={{ position: 'absolute', top: '-5px', right: '-5px', minWidth: '18px', height: '18px', borderRadius: '9px', background: '#EF4444', color: 'white', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{activeFilterCount}</span>
                                )}
                            </button>
                        </div>
                    )}

                    {/* Mobile: drawer backdrop */}
                    {isMobile && isFilterDrawerOpen && (
                        <div onClick={() => setIsFilterDrawerOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1199 }} />
                    )}

                    {!isMobile && (
                    <div className="glass-panel" style={{ marginBottom: '12px', padding: '16px', display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', position: 'relative', zIndex: 50 }}>


                        {/* Search and DatePicker Row */}
                        <div style={{
                            display: 'flex',
                            gap: '12px',
                            alignItems: 'center',
                            width: '100%',
                            flex: 1,
                            minWidth: isMobile ? 'auto' : '300px'
                        }}>
                            <div style={{ position: 'relative', flex: 1 }}>
                                <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                                <input
                                    type="text"
                                    placeholder="Search (space/comma separated)..."
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    // Handle pasted multiline text gracefully by splitting it with spaces
                                    onPaste={e => {
                                        const pasted = e.clipboardData.getData('text');
                                        if (pasted.includes('\n') || pasted.includes('\r')) {
                                            e.preventDefault();
                                            const cleaned = pasted.split(/[\r\n]+/).filter(t => t.trim()).join(' ');
                                            const el = e.target as HTMLInputElement;
                                            const start = el.selectionStart || 0;
                                            const end = el.selectionEnd || 0;
                                            const newVal = searchTerm.slice(0, start) + cleaned + (searchTerm.slice(end) || (searchTerm.length ? '' : ''));
                                            setSearchTerm(newVal);
                                            // The controlled state update will handle rendering.
                                        }
                                    }}
                                    className="search-input"
                                    style={{ paddingLeft: '36px', width: '100%', height: '40px', borderRadius: '8px', border: '1px solid var(--color-border)' }}
                                />
                            </div>
                            {canEdit && selectedIds.size > 0 && (
                                <button
                                    onClick={() => setIsBulkEditOpen(true)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        padding: '0 16px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--color-primary)',
                                        background: 'var(--color-surface)',
                                        color: 'var(--color-primary)',
                                        cursor: 'pointer',
                                        fontWeight: 500,
                                        transition: 'all 0.2s',
                                        height: '40px',
                                        whiteSpace: 'nowrap'
                                    }}
                                    title="Bulk Edit Selected Orders"
                                >
                                    <Edit size={18} />
                                    Bulk Edit {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                                </button>
                            )}
                            {canEdit && selectedIds.size > 0 && (
                                <button
                                    onClick={handleDuplicateSelected}
                                    disabled={isDuplicating}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        padding: '0 16px',
                                        borderRadius: '8px',
                                        border: '1px solid #10B981',
                                        background: 'var(--color-surface)',
                                        color: '#10B981',
                                        cursor: isDuplicating ? 'not-allowed' : 'pointer',
                                        opacity: isDuplicating ? 0.6 : 1,
                                        fontWeight: 500,
                                        transition: 'all 0.2s',
                                        height: '40px',
                                        whiteSpace: 'nowrap'
                                    }}
                                    title="Duplicate selected orders as new Drafted orders"
                                >
                                    <Copy size={18} />
                                    {isDuplicating ? 'Duplicating…' : `Duplicate (${selectedIds.size})`}
                                </button>
                            )}
                            <div style={{ width: 'auto' }}>
                                <DateRangePicker
                                    value={dateRange}
                                    onChange={setDateRange}
                                    style={{ width: '100%' }}
                                    compact={isMobile}
                                />
                            </div>
                            {isMobile && (
                                <button
                                    onClick={() => setShowFilters(!showFilters)}
                                    style={{
                                        padding: '10px',
                                        borderRadius: '8px',
                                        border: hasFilters ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                        background: showFilters ? 'var(--color-primary)' : (hasFilters ? 'var(--color-primary-light)' : 'var(--color-surface)'),
                                        color: showFilters ? 'white' : (hasFilters ? 'var(--color-primary)' : 'var(--color-text-secondary)'),
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                    title="Toggle Filters"
                                >
                                    <Filter size={18} />
                                </button>
                            )}
                            <button
                                disabled={isLoadingOrders}
                                onClick={() => {
                                    const btn = document.getElementById('orders-refresh-btn');
                                    if (btn) btn.style.animation = 'spin 1s linear infinite';
                                    Promise.all([
                                        refreshData(true),
                                        fetchOrders()
                                    ]).finally(() => {
                                        if (btn) btn.style.animation = 'none';
                                        showToast('Data refreshed', 'success');
                                    });
                                }}
                                style={{
                                    padding: '10px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-border)',
                                    background: 'var(--color-surface)',
                                    color: 'var(--color-text-secondary)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}
                                title="Refresh Orders"
                            >
                                <RefreshCw id="orders-refresh-btn" size={18} />
                            </button>
                            <style>{`
                                @keyframes spin { 
                                    100% { -webkit-transform: rotate(360deg); transform:rotate(360deg); } 
                                }
                            `}</style>
                        </div>
                        {(!isMobile || showFilters) && (
                            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', width: isMobile ? '100%' : 'auto' }}>
                                <div style={{ width: isMobile ? 'auto' : 'auto' }}>
                                    {/* DateRangePicker removed from old location */}
                                </div>
                                <div ref={salesmanFilterRef} style={{ position: 'relative', width: isMobile ? '100%' : 'auto' }}>
                                    <button
                                        onClick={() => setIsSalesmanOpen(!isSalesmanOpen)}
                                        className="search-input"
                                        style={{
                                            minWidth: '160px',
                                            width: isMobile ? '100%' : 'auto',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            cursor: 'pointer',
                                            paddingRight: '12px',
                                            background: 'white',
                                            height: '40px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <User size={16} color="var(--color-primary)" />
                                            <span style={{ fontSize: '13px', color: salesmanFilter === 'All' ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>
                                                {salesmanFilter === 'All' ? (currentUser?.roleId === 'salesman' ? currentUser.name : 'Salesmen') : salesmanFilter}
                                            </span>
                                        </div>
                                        <ChevronDown size={14} color="var(--color-text-secondary)" />
                                    </button>

                                    {isSalesmanOpen && (
                                        <>

                                            <div className="glass-panel" style={{ position: 'absolute',
                                                top: '100%',
                                                left: 0,
                                                marginTop: '4px',
                                                width: '200px',
                                                padding: '8px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '2px',
                                                zIndex: 100,
                                                background: 'white',
                                                boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                                            }}>
                                                <label style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    padding: '8px 12px',
                                                    cursor: 'pointer',
                                                    borderRadius: '6px',
                                                    transition: 'background 0.2s',
                                                    backgroundColor: salesmanFilter === 'All' ? 'var(--color-bg)' : 'transparent'
                                                }}
                                                    onClick={() => { setSalesmanFilter('All'); setIsSalesmanOpen(false); }}
                                                >
                                                    <span style={{ fontSize: '13px' }}>{currentUser?.roleId === 'salesman' ? currentUser.name : 'Salesmen'}</span>
                                                </label>
                                                {currentUser?.roleId !== 'salesman' && users.filter(u => u.roleId !== 'admin').map(s => (
                                                    <label key={s.id} style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '8px 12px',
                                                        cursor: 'pointer',
                                                        borderRadius: '6px',
                                                        transition: 'background 0.2s',
                                                        backgroundColor: salesmanFilter === s.name ? 'var(--color-bg)' : 'transparent'
                                                    }}
                                                        onClick={() => { setSalesmanFilter(s.name); setIsSalesmanOpen(false); }}
                                                    >
                                                        <span style={{ fontSize: '13px' }}>{s.name}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>



                                <div ref={statusFilterRef} style={{ position: 'relative', width: isMobile ? '100%' : 'auto' }}>
                                    <button
                                        onClick={() => setIsStatusFilterOpen(!isStatusFilterOpen)}
                                        className="search-input"
                                        style={{
                                            minWidth: '160px',
                                            width: isMobile ? '100%' : 'auto',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            cursor: 'pointer',
                                            paddingRight: '12px',
                                            background: 'white',
                                            height: '40px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <Package size={16} color="var(--color-primary)" />
                                            <span style={{ fontSize: '13px', color: statusFilter.length === 0 ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>
                                                {statusFilter.length === 0 ? 'Order Status' : `${statusFilter.length} Selected`}
                                            </span>
                                        </div>
                                        <ChevronDown size={14} color="var(--color-text-secondary)" />
                                    </button>

                                    {isStatusFilterOpen && (
                                        <>

                                            <div className="glass-panel" style={{ position: 'absolute',
                                                top: '100%',
                                                left: 0,
                                                marginTop: '4px',
                                                width: '200px',
                                                padding: '8px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '2px',
                                                zIndex: 100,
                                                background: 'white',
                                                boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                                            }}>
                                                <label style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    padding: '8px 12px',
                                                    cursor: 'pointer',
                                                    borderRadius: '6px',
                                                    borderBottom: '1px solid var(--color-border)',
                                                    marginBottom: '4px'
                                                }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={statusFilter.length === 7}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setStatusFilter(['Drafted', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned', 'ReStock']);
                                                            } else {
                                                                setStatusFilter([]);
                                                            }
                                                        }}
                                                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                    />
                                                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#000000' }}>Select All</span>
                                                </label>
                                                {['Drafted', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned', 'ReStock'].map(status => (
                                                    <label key={status} style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '8px 12px',
                                                        cursor: 'pointer',
                                                        borderRadius: '6px',
                                                        transition: 'background 0.2s',
                                                        backgroundColor: statusFilter.includes(status) ? 'var(--color-bg)' : 'transparent'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={statusFilter.includes(status)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) setStatusFilter([...statusFilter, status]);
                                                                else setStatusFilter(statusFilter.filter(s => s !== status));
                                                            }}
                                                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                        />
                                                        <span style={{ fontSize: '13px' }}>{status}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>



                                {/* Shipping Co Filter */}
                                <div ref={shippingCoFilterRef} style={{ position: 'relative', width: isMobile ? '100%' : 'auto' }}>
                                    <button
                                        onClick={() => { setIsShippingCoOpen(!isShippingCoOpen); setIsStatusFilterOpen(false); setIsPayStatusOpen(false); }}
                                        className="search-input"
                                        style={{
                                            minWidth: '160px',
                                            width: isMobile ? '100%' : 'auto',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            cursor: 'pointer',
                                            paddingRight: '12px',
                                            background: 'white',
                                            height: '40px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <Truck size={16} color="var(--color-primary)" />
                                            <span style={{ fontSize: '13px', fontWeight: 500, color: shippingCoFilter.length === 0 ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>
                                                {shippingCoFilter.length === 0 ? 'Shipping Co' : `Shipping (${shippingCoFilter.length})`}
                                            </span>
                                        </div>
                                        <ChevronDown size={14} color="var(--color-text-secondary)" />
                                    </button>
                                    {isShippingCoOpen && (
                                        <>

                                            <div className="glass-panel" style={{ position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                                                padding: '8px', width: '220px', zIndex: 100,
                                                display: 'flex', flexDirection: 'column', gap: '2px',
                                                background: 'white',
                                                boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                                            }}>
                                                {filterShippingCompanies.length > 0 && (
                                                    <label style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '8px 12px',
                                                        cursor: 'pointer',
                                                        borderRadius: '6px',
                                                        borderBottom: '1px solid var(--color-border)',
                                                        marginBottom: '4px'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={shippingCoFilter.length === filterShippingCompanies.length && filterShippingCompanies.length > 0}
                                                            onChange={(e) => {
                                                                if (e.target.checked) setShippingCoFilter([...filterShippingCompanies]);
                                                                else setShippingCoFilter([]);
                                                            }}
                                                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                        />
                                                        <span style={{ fontSize: '13px', fontWeight: 500, color: '#000000' }}>Select All</span>
                                                    </label>
                                                )}
                                                {filterShippingCompanies.map(co => (
                                                    <label key={co} style={{
                                                        display: 'flex', alignItems: 'center', gap: '10px',
                                                        padding: '8px 12px', cursor: 'pointer', borderRadius: '6px',
                                                        transition: 'background 0.2s',
                                                        backgroundColor: shippingCoFilter.includes(co) ? 'var(--color-bg)' : 'transparent'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={shippingCoFilter.includes(co)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) setShippingCoFilter([...shippingCoFilter, co]);
                                                                else setShippingCoFilter(shippingCoFilter.filter(s => s !== co));
                                                            }}
                                                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                        />
                                                        {getShippingLogo(co) && (
                                                            <img src={getShippingLogo(co)!} alt="logo" style={{ width: '14px', height: '14px', borderRadius: '50%', objectFit: 'cover' }} />
                                                        )}
                                                        <span style={{ fontSize: "13px", color: getShippingCoColor(co) }}>{co}</span>
                                                    </label>
                                                ))}
                                                {filterShippingCompanies.length === 0 && <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', padding: '8px' }}>No shipping companies found.</div>}
                                            </div>
                                        </>
                                    )}
                                </div>



                                <div ref={payStatusFilterRef} style={{ position: 'relative', width: isMobile ? '100%' : 'auto' }}>
                                    <button
                                        onClick={() => setIsPayStatusOpen(!isPayStatusOpen)}
                                        className="search-input"
                                        style={{
                                            minWidth: '160px',
                                            width: isMobile ? '100%' : 'auto',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            cursor: 'pointer',
                                            paddingRight: '12px',
                                            background: 'white',
                                            height: '40px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <CreditCard size={16} color="var(--color-primary)" />
                                            <span style={{ fontSize: '13px', color: payStatusFilter.length === 0 ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>
                                                {payStatusFilter.length === 0 ? 'Pay Status' : `${payStatusFilter.length} Selected`}
                                            </span>
                                        </div>
                                        <ChevronDown size={14} color="var(--color-text-secondary)" />
                                    </button>

                                    {isPayStatusOpen && (
                                        <>

                                            <div className="glass-panel" style={{ position: 'absolute',
                                                top: '100%',
                                                left: 0,
                                                marginTop: '4px',
                                                width: '200px',
                                                padding: '8px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '2px',
                                                zIndex: 100,
                                                background: 'white',
                                                boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                                            }}>
                                                <label style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    padding: '8px 12px',
                                                    cursor: 'pointer',
                                                    borderRadius: '6px',
                                                    borderBottom: '1px solid var(--color-border)',
                                                    marginBottom: '4px'
                                                }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={payStatusFilter.length === 4}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setPayStatusFilter(['Unpaid', 'Deposit', 'Get File', 'Paid', 'Cancel']);
                                                            } else {
                                                                setPayStatusFilter([]);
                                                            }
                                                        }}
                                                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                    />
                                                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#000000' }}>Select All</span>
                                                </label>
                                                {['Unpaid', 'Deposit', 'Get File', 'Paid', 'Cancel'].map(status => (
                                                    <label key={status} style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '8px 12px',
                                                        cursor: 'pointer',
                                                        borderRadius: '6px',
                                                        transition: 'background 0.2s',
                                                        backgroundColor: payStatusFilter.includes(status) ? 'var(--color-bg)' : 'transparent'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={payStatusFilter.includes(status)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) setPayStatusFilter([...payStatusFilter, status]);
                                                                else setPayStatusFilter(payStatusFilter.filter(s => s !== status));
                                                            }}
                                                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                        />
                                                        <span style={{ fontSize: '13px' }}>{status}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>

                                <div ref={pageFilterRef} style={{ position: 'relative', width: isMobile ? '100%' : 'auto' }}>
                                    <button
                                        onClick={() => setIsPageOpen(!isPageOpen)}
                                        className="search-input"
                                        style={{
                                            minWidth: '160px',
                                            width: isMobile ? '100%' : 'auto',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            cursor: 'pointer',
                                            paddingRight: '12px',
                                            background: 'white',
                                            height: '40px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <Store size={16} color="var(--color-primary)" />
                                            <span style={{ fontSize: '13px', color: pageFilter.length === 0 ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>
                                                {pageFilter.length === 0 ? 'Pages' : `${pageFilter.length} Selected`}
                                            </span>
                                        </div>
                                        <ChevronDown size={14} color="var(--color-text-secondary)" />
                                    </button>

                                    {isPageOpen && (
                                        <>
                                            <div className="glass-panel" style={{ position: 'absolute',
                                                top: '100%',
                                                left: 0,
                                                marginTop: '4px',
                                                width: '200px',
                                                padding: '8px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '2px',
                                                zIndex: 100,
                                                background: 'white',
                                                boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                                            }}>
                                                {pages.length > 0 && (
                                                    <label style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '8px 12px',
                                                        cursor: 'pointer',
                                                        borderRadius: '6px',
                                                        borderBottom: '1px solid var(--color-border)',
                                                        marginBottom: '4px'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={pageFilter.length === pages.length && pages.length > 0}
                                                            onChange={(e) => {
                                                                if (e.target.checked) {
                                                                    setPageFilter([...pages]);
                                                                } else {
                                                                    setPageFilter([]);
                                                                }
                                                            }}
                                                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                        />
                                                        <span style={{ fontSize: '13px', fontWeight: 500, color: '#000000' }}>Select All</span>
                                                    </label>
                                                )}
                                                {pages.map(page => (
                                                    <label key={page} style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '8px 12px',
                                                        cursor: 'pointer',
                                                        borderRadius: '6px',
                                                        transition: 'background 0.2s',
                                                        backgroundColor: pageFilter.includes(page) ? 'var(--color-bg)' : 'transparent'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={pageFilter.includes(page)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) setPageFilter([...pageFilter, page]);
                                                                else setPageFilter(pageFilter.filter(p => p !== page));
                                                            }}
                                                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                        />
                                                        <span style={{ fontSize: '13px', color: '#000000' }}>{page}</span>
                                                    </label>
                                                ))}
                                                {pages.length === 0 && <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', padding: '8px' }}>No pages found.</div>}
                                            </div>
                                        </>
                                    )}
                                </div>

                                <button
                                    onClick={clearAllFilters}
                                    disabled={!hasFilters}
                                    style={{
                                        padding: '10px 16px', borderRadius: '8px',
                                        border: 'none',
                                        background: hasFilters ? '#EF4444' : 'var(--color-surface)',
                                        color: hasFilters ? 'white' : 'var(--color-text-secondary)',
                                        cursor: hasFilters ? 'pointer' : 'not-allowed',
                                        opacity: hasFilters ? 1 : 0.5,
                                        fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px',
                                        transition: 'all 0.2s',
                                        width: isMobile ? '100%' : 'auto',
                                        justifyContent: 'center',
                                        height: '40px',
                                        boxShadow: hasFilters ? '0 2px 4px rgba(239, 68, 68, 0.3)' : 'none'
                                    }}
                                    title="Clear All Filters"
                                >
                                    <Filter size={16} /> Clear Filters
                                </button>

                                
                                    </div>
                                )}
                                {
                                    hasPermission('create_orders') && !isMobile && (
                                        <button onClick={handleOpenAdd} className="primary-button" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', width: isMobile ? '100%' : 'auto', justifyContent: 'center' }}>
                                            <Plus size={18} /> New Order
                                        </button>
                                    )
                                }
                                {!isMobile && (
                                    <div ref={toolsMenuRef} style={{ position: 'relative', width: isMobile ? '100%' : 'auto' }}>
                                        <button
                                            onClick={() => setShowTools(!showTools)}
                                            style={{
                                                padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                                                background: showTools ? 'var(--color-primary)' : 'var(--color-surface)',
                                                color: showTools ? 'white' : 'var(--color-text-main)',
                                                cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                height: '40px', width: '40px',
                                                transition: 'all 0.2s'
                                            }}
                                            title="Tools"
                                        >
                                            <Settings size={18} />
                                        </button>

                                        {showTools && (
                                            <div className="glass-panel" style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px',
                                                padding: '8px', width: '220px', zIndex: 100,
                                                display: 'flex', flexDirection: 'column', gap: '4px',
                                                background: 'white',
                                                boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                                            }}>
                                                <div ref={appearanceMenuRef} style={{ position: 'relative', width: '100%' }}>
                                                    <button
                                                        onClick={() => { setShowAppearanceMenu(!showAppearanceMenu); setShowColumnMenu(false); }}
                                                        style={{
                                                            padding: '8px 12px', borderRadius: '6px', border: 'none',
                                                            background: showAppearanceMenu ? 'var(--color-bg)' : 'transparent',
                                                            color: 'var(--color-text-main)', cursor: 'pointer',
                                                            display: 'flex', alignItems: 'center', gap: '8px',
                                                            width: '100%', textAlign: 'left', fontSize: '13px',
                                                            transition: 'background 0.2s'
                                                        }}
                                                    >
                                                        <Eye size={16} color="var(--color-primary)" />
                                                        <span style={{ flex: 1, textAlign: 'left' }}>Appearance</span>
                                                        <ChevronRight size={14} color="var(--color-text-secondary)" />
                                                    </button>
                                                    {showAppearanceMenu && (
                                                        <div className="glass-panel" style={{ position: 'absolute', top: 0, right: '100%', marginRight: '8px',
                                                            padding: '16px', width: '250px', zIndex: 101, maxHeight: '300px', overflowY: 'auto',
                                                            display: 'flex', flexDirection: 'column', gap: '12px', background: 'white',
                                                            boxShadow: '-4px 4px 20px rgba(0,0,0,0.1)'
                                                        }}>
                                                            <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>Table Settings</h4>
                                                            <div>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                                    <label style={{ fontSize: '13px' }}>Font Size</label>
                                                                    <span style={{ fontSize: '12px', color: 'gray' }}>{tableSettings.fontSize}px</span>
                                                                </div>
                                                                <input
                                                                    type="range" min="9" max="16" value={tableSettings.fontSize}
                                                                    onChange={(e) => setTableSettings({ ...tableSettings, fontSize: parseInt(e.target.value) })}
                                                                    style={{ width: '100%' }}
                                                                />
                                                            </div>
                                                            <div>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                                    <label style={{ fontSize: '13px' }}>Row Padding</label>
                                                                    <span style={{ fontSize: '12px', color: 'gray' }}>{tableSettings.padding}px</span>
                                                                </div>
                                                                <input
                                                                    type="range" min="0" max="20" step="1" value={tableSettings.padding}
                                                                    onChange={(e) => setTableSettings({ ...tableSettings, padding: parseInt(e.target.value) })}
                                                                    style={{ width: '100%' }}
                                                                />
                                                            </div>
                                                            <div>
                                                                <label style={{ fontSize: '13px', display: 'block', marginBottom: '4px' }}>Row Height</label>
                                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                                    <button
                                                                        onClick={() => setTableSettings({ ...tableSettings, height: 'auto' })}
                                                                        style={{
                                                                            flex: 1, padding: '6px', fontSize: '12px',
                                                                            background: tableSettings.height === 'auto' ? 'var(--color-primary)' : 'var(--color-bg)',
                                                                            color: tableSettings.height === 'auto' ? 'white' : 'var(--color-text-main)',
                                                                            borderRadius: '4px', border: 'none', cursor: 'pointer'
                                                                        }}
                                                                    >
                                                                        Auto
                                                                    </button>
                                                                    <button
                                                                        onClick={() => setTableSettings({ ...tableSettings, height: '35px' })}
                                                                        style={{
                                                                            flex: 1, padding: '6px', fontSize: '12px',
                                                                            background: tableSettings.height === '35px' ? 'var(--color-primary)' : 'var(--color-bg)',
                                                                            color: tableSettings.height === '35px' ? 'white' : 'var(--color-text-main)',
                                                                            borderRadius: '4px', border: 'none', cursor: 'pointer'
                                                                        }}
                                                                    >
                                                                        Fixed
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>



                                                <div ref={columnMenuRef} style={{ position: 'relative', width: '100%' }}>
                                                    <button
                                                        onClick={() => { setShowColumnMenu(!showColumnMenu); setShowAppearanceMenu(false); }}
                                                        style={{
                                                            padding: '8px 12px', borderRadius: '6px', border: 'none',
                                                            background: showColumnMenu ? 'var(--color-bg)' : 'transparent',
                                                            color: 'var(--color-text-main)', cursor: 'pointer',
                                                            display: 'flex', alignItems: 'center', gap: '8px',
                                                            width: '100%', textAlign: 'left', fontSize: '13px',
                                                            transition: 'background 0.2s'
                                                        }}
                                                    >
                                                        <List size={16} color="var(--color-primary)" />
                                                        <span style={{ flex: 1, textAlign: 'left' }}>Columns</span>
                                                        <ChevronRight size={14} color="var(--color-text-secondary)" />
                                                    </button>
                                                    {showColumnMenu && (
                                                        <div className="glass-panel" style={{ position: 'absolute', top: 0, right: '100%', marginRight: '8px',
                                                            padding: '16px', width: '200px', zIndex: 101, maxHeight: '300px', overflowY: 'auto',
                                                            display: 'flex', flexDirection: 'column', gap: '8px', background: 'white',
                                                            boxShadow: '-4px 4px 20px rgba(0,0,0,0.1)'
                                                        }}>
                                                            <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>Toggle Columns</h4>
                                                            {allColumnsDef.map(col => (
                                                                <label key={col.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={visibleColumns.includes(col.id)}
                                                                        onChange={() => {
                                                                            if (visibleColumns.includes(col.id)) {
                                                                                setVisibleColumns(visibleColumns.filter(c => c !== col.id));
                                                                            } else {
                                                                                setVisibleColumns([...visibleColumns, col.id]);
                                                                            }
                                                                        }}
                                                                    />
                                                                    {col.label}
                                                                </label>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>

                                                <button
                                                    onClick={handleExportExcel}
                                                    disabled={selectedIds.size === 0}
                                                    style={{
                                                        padding: '8px 12px', borderRadius: '6px', border: 'none',
                                                        background: 'transparent',
                                                        color: selectedIds.size > 0 ? 'var(--color-text-main)' : 'var(--color-text-secondary)',
                                                        cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed',
                                                        display: 'flex', alignItems: 'center', gap: '8px',
                                                        width: '100%', textAlign: 'left', fontSize: '13px',
                                                        transition: 'background 0.2s', opacity: selectedIds.size > 0 ? 1 : 0.5
                                                    }}
                                                >
                                                    <Upload size={16} color={selectedIds.size > 0 ? '#10B981' : "var(--color-text-secondary)"} style={{ transform: 'rotate(180deg)' }} />
                                                    Export {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                                                </button>

                                                {canEdit && (
                                                    <button
                                                        onClick={() => { setIsImportModalOpen(true); setShowTools(false); }}
                                                        style={{
                                                            padding: '8px 12px', borderRadius: '6px', border: 'none',
                                                            background: 'transparent',
                                                            color: 'var(--color-text-main)', cursor: 'pointer',
                                                            display: 'flex', alignItems: 'center', gap: '8px',
                                                            width: '100%', textAlign: 'left', fontSize: '13px',
                                                            transition: 'background 0.2s'
                                                        }}
                                                    >
                                                        <Upload size={16} color="var(--color-primary)" />
                                                        Import
                                                    </button>
                                                )}

                                                {isAdmin && selectedIds.size > 0 && (
                                                    <button
                                                        onClick={() => { handleDelete(); setShowTools(false); }}
                                                        style={{
                                                            padding: '8px 12px', borderRadius: '6px', border: 'none',
                                                            background: '#FEE2E2',
                                                            color: '#DC2626', cursor: 'pointer',
                                                            display: 'flex', alignItems: 'center', gap: '8px',
                                                            width: '100%', textAlign: 'left', fontSize: '13px',
                                                            transition: 'background 0.2s', marginTop: '4px'
                                                        }}
                                                    >
                                                        <Trash2 size={16} color="#DC2626" />
                                                        Delete {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                            </div>
                        )}

                    </div >
                    )}

                    {/* Mobile filter drawer: search / date / refresh on top, all
                        filter groups expanded as chips below (no hidden dropdowns) */}
                    {isMobile && (
                        <div className="glass-panel" style={{
                            position: 'fixed', top: 0, right: 0, bottom: 0,
                            width: '85%', maxWidth: '340px', zIndex: 1200,
                            display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px',
                            overflowY: 'auto', borderRadius: '16px 0 0 16px',
                            background: 'var(--color-surface)',
                            transform: isFilterDrawerOpen ? 'translateX(0)' : 'translateX(105%)',
                            transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                            boxShadow: '-8px 0 30px rgba(0,0,0,0.18)'
                        }}>
                            {/* Header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Filter</h3>
                                <button onClick={() => setIsFilterDrawerOpen(false)} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text-muted)', width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Search */}
                            <div style={{ position: 'relative' }}>
                                <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                                <input
                                    type="text"
                                    placeholder="Search orders..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: '10px', border: '1px solid var(--color-border)', fontSize: '14px', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                                />
                            </div>

                            {/* Date range + refresh */}
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <DateRangePicker value={dateRange} onChange={setDateRange} />
                                </div>
                                <button
                                    onClick={() => refreshData(true)}
                                    title="Refresh"
                                    style={{ width: '40px', height: '40px', borderRadius: '10px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                                >
                                    <RefreshCw size={17} />
                                </button>
                            </div>

                            {/* Expanded filter groups */}
                            <DrawerChipGroup
                                title="Order Status"
                                options={['Drafted', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned', 'ReStock', 'Cancelled']}
                                selected={statusFilter}
                                onToggle={(v) => setStatusFilter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])}
                            />
                            <DrawerChipGroup
                                title="Pay Status"
                                options={['Unpaid', 'Deposit', 'Get File', 'Paid', 'Cancel']}
                                selected={payStatusFilter}
                                onToggle={(v) => setPayStatusFilter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])}
                            />
                            <DrawerChipGroup
                                title="Salesman"
                                options={users.map(u => u.name)}
                                selected={salesmanFilter === 'All' ? [] : [salesmanFilter]}
                                onToggle={(v) => setSalesmanFilter(salesmanFilter === v ? 'All' : v)}
                            />
                            <DrawerChipGroup
                                title="Shipping Co"
                                options={shippingCompanies}
                                selected={shippingCoFilter}
                                onToggle={(v) => setShippingCoFilter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])}
                            />
                            <DrawerChipGroup
                                title="Page"
                                options={pages}
                                selected={pageFilter}
                                onToggle={(v) => setPageFilter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])}
                            />

                            {/* Footer: Clear + Filter */}
                            <div style={{ marginTop: 'auto', position: 'sticky', bottom: 0, background: 'var(--color-surface)', paddingTop: '12px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: '10px' }}>
                                <button
                                    onClick={() => {
                                        setStatusFilter([]);
                                        setPayStatusFilter([]);
                                        setSalesmanFilter('All');
                                        setShippingCoFilter([]);
                                        setPageFilter([]);
                                        setDateRange({ start: '', end: '' });
                                        setSearchTerm('');
                                    }}
                                    style={{ flex: 1, padding: '12px', borderRadius: '12px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}
                                >
                                    Clear
                                </button>
                                <button
                                    onClick={() => setIsFilterDrawerOpen(false)}
                                    className="primary-button"
                                    style={{ flex: 1, padding: '12px', borderRadius: '12px', fontWeight: 600, fontSize: '14px' }}
                                >
                                    Filter
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Table or Mobile List */}
                    <div style={{
                        // visible on mobile so the full-bleed list (negative margins)
                        // isn't clipped into a horizontal scrollbar
                        overflowX: isMobile ? 'visible' : 'auto',
                        overflowY: isMobile ? 'visible' : 'auto',
                        maxHeight: isMobile ? 'none' : 'calc(100vh - 200px)',
                        paddingBottom: '0'
                    }}>
                        {isMobile ? (
                            <div style={{ display: 'flex', flexDirection: 'column', padding: '0 0 100px 0', margin: '0 -12px' /* full-bleed: cancels the layout's 12px gutter */, background: 'var(--color-surface)', overflow: 'hidden' }}>
                                {paginatedOrders.length === 0 && !isLoadingOrders && (
                                    <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                        {emptyStateContent}
                                    </div>
                                )}
                                {paginatedOrders.length === 0 && isLoadingOrders && (
                                    <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                        <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading orders…
                                    </div>
                                )}
                                {paginatedOrders.map(order => (
                                    <MobileOrderCard
                                        key={order.id}
                                        order={order}
                                        isSelected={selectedIds.has(order.id)}
                                        onToggleSelect={() => toggleSelection(order.id)}
                                        isExpanded={expandedOrderIds.has(order.id)}
                                        onToggleExpand={() => toggleOrderExpansion(order.id)}
                                        onEdit={(o) => handleOpenEdit(o)}
                                        onView={(o) => { setSelectedOrder(o); setIsViewModalOpen(true); }}
                                        onPrint={(o) => setReceiptSale(o)}
                                        onCopy={(o) => handleCopyOrder(o)}
                                        onUpdateStatus={(id, status) => {
                                            // Checked before any modal opens — the store rejects these
                                            // transitions anyway, and it's needless to make someone fill
                                            // in payment details first.
                                            if (POST_DISPATCH_STATUSES.includes(status) && !canEnterPostDispatch(order, status)) {
                                                showToast(postDispatchMessage(order.shipping?.status || 'Pending', status), 'error');
                                                return;
                                            }
                                            if (status === 'ReStock' && !canRestock) {
                                                showToast('You do not have permission to restock orders.', 'error');
                                                return;
                                            }
                                            if (order.shipping?.status === 'ReStock' && status === 'Drafted') {
                                                // Admin reopening a restocked order (see desktop handler).
                                                updateOrderStatus(id, 'Drafted');
                                                updateOrder(id, { paymentStatus: 'Unpaid', amountReceived: 0, settleDate: null as any, shipping: { ...order.shipping, status: 'Drafted' } as any });
                                                return;
                                            }
                                            // Shipped -> Delivered is a plain status change: no payment
                                            // method popup, and payment fields stay untouched.
                                            if (status === 'Shipped' || status === 'Confirmed') {
                                                setShippingTargetStatus(status);
                                                setShippingOrderToUpdate(order);
                                                setIsShippingModalOpen(true);
                                                return;
                                            }
                                            // Awaited in sequence — see the desktop handler: updateOrder
                                            // must read the status updateOrderStatus just wrote so the
                                            // stock-ledger handling never runs twice for one transition.
                                            (async () => {
                                                try {
                                                    await updateOrderStatus(id, status);
                                                    if (status === 'ReStock') {
                                                        // Pass the shipping status so updateOrder doesn't reset it to Pending.
                                                        await updateOrder(id, { paymentStatus: 'Cancel', shipping: { ...order.shipping, status: 'ReStock' } as any });
                                                        restockOrder(id);
                                                    } else if (status === 'Returned' || status === 'Cancelled') {
                                                        // null, not undefined — updateOrder skips undefined fields,
                                                        // which left the old settle_date on cancelled orders.
                                                        await updateOrder(id, { paymentStatus: 'Cancel', amountReceived: 0, settleDate: null as any, shipping: { ...order.shipping, status } as any });
                                                    }
                                                } catch (e) {
                                                    console.error('Status change failed:', e);
                                                    showToast('Failed to update order status', 'error');
                                                }
                                            })();
                                        }}
                                        onUpdatePaymentStatus={(id, status) => {
                                            const updates: any = { paymentStatus: status };
                                            if (status === 'Deposit') {
                                                setDepositTargetOrder(order);
                                                return;
                                            }
                                            if (status === 'Paid' || status === 'Settled') {
                                                // Same flow as desktop: capture Pay By + settle date
                                                // in the settle modal instead of silently defaulting.
                                                setPaymentMethodTargetOrder(order);
                                                setIsPaymentMethodModalOpen(true);
                                                return;
                                            } else if (status === 'Get File') {
                                                // Same as bulk edit: keep a deposit visible
                                                // in Received when one was taken.
                                                updates.amountReceived = order.depositAmount || 0;
                                                updates.settleDate = null;
                                            } else {
                                                updates.amountReceived = 0;
                                                updates.settleDate = null;
                                            }
                                            updateOrder(id, updates);
                                        }}
                                        canEdit={canEdit}
                                        isAdmin={isAdmin}
                                        canRestock={canRestock}
                                    />
                                ))}

                                {/* Infinite scroll sentinel: auto-loads the next batch near the bottom */}
                                {paginatedOrders.length > 0 && (
                                    <div ref={loadMoreSentinelRef} style={{ padding: '18px 0 6px', textAlign: 'center' }}>
                                        {isLoadingOrders ? (
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#9CA3AF', fontSize: '13px', fontWeight: 500 }}>
                                                <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> Loading more…
                                            </div>
                                        ) : hasMoreMobile && paginatedOrders.length < totalCount ? (
                                            <button
                                                onClick={() => setCurrentPage(p => p + 1)}
                                                style={{ padding: '10px 22px', borderRadius: '20px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                                            >
                                                Load older orders
                                            </button>
                                        ) : (
                                            <div style={{ color: '#9CA3AF', fontSize: '12px' }}>All {totalCount} orders loaded</div>
                                        )}
                                    </div>
                                )}

                                {/* Mobile FAB - New Order */}
                                {hasPermission('create_orders') && (
                                    <button
                                        className="mobile-fab"
                                        onClick={handleOpenAdd}
                                        aria-label="New Order"
                                    >
                                        <Plus size={26} />
                                    </button>
                                )}

                                {/* Mobile Summary Footer */}
                                <div style={{
                                    position: 'fixed',
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    background: 'rgba(255,255,255,0.95)',
                                    backdropFilter: 'blur(10px)',
                                    WebkitBackdropFilter: 'blur(10px)',
                                    borderTop: '1px solid var(--color-border)',
                                    padding: '12px 20px',
                                    zIndex: 100,
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    boxShadow: '0 -2px 10px rgba(0, 0, 0, 0.06)'
                                }}>
                                    <div>
                                        <div style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Orders</div>
                                        <div style={{ fontSize: '18px', fontWeight: '800', color: '#111827' }}>{totalCount}</div>
                                    </div>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Loaded</div>
                                        <div style={{ fontSize: '14px', fontWeight: '700', color: '#374151' }}>{filteredOrders.length}/{totalCount}</div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total</div>
                                        <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--color-primary)' }}>
                                            ${(revenueTotal ?? filteredOrders
                                                .filter(o => REVENUE_TOTAL_STATUSES.includes(o.shipping?.status || ''))
                                                .reduce((sum, order) => sum + order.total, 0)).toFixed(2)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <>
                                <table
                                    className="spreadsheet-table"
                                    style={{
                                        minWidth: '100%',
                                        whiteSpace: 'nowrap',
                                        tableLayout: 'fixed',
                                        borderCollapse: 'separate',
                                        borderSpacing: 0,
                                        // Apply CSS Variables
                                        ['--table-font-size' as any]: `${tableSettings.fontSize}px`,
                                        ['--table-padding' as any]: `${tableSettings.padding}px 6px`, // Reduced side padding too
                                        ['--table-row-height' as any]: tableSettings.height === 'auto' ? 'auto' : tableSettings.height
                                    }}>
                                    <thead>
                                        <tr>
                                            <th style={{ width: '40px', padding: '10px 12px', position: 'sticky', left: 0, top: 0, zIndex: 40, background: '#e5e7eb' }} className="sticky-col-first">
                                                {canUseCheckbox && (
                                                    <input
                                                        type="checkbox"
                                                        checked={filteredOrders.length > 0 && selectedIds.size === filteredOrders.length}
                                                        onChange={toggleSelectAll}
                                                        style={{ cursor: 'pointer' }}
                                                    />
                                                )}
                                                <div
                                                    onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); autoFitAllColumns(); }}
                                                    style={{
                                                        position: 'absolute', right: 0, top: 0, bottom: 0, width: '10px',
                                                        cursor: 'col-resize', background: 'transparent', zIndex: 25, transform: 'translateX(50%)'
                                                    }}
                                                    className="resize-handle"
                                                    title="Double click to auto-fit all columns"
                                                />
                                            </th>
                                            {allColumns.filter(col => visibleColumns.includes(col.id)).map((col) => {
                                                const colId = col.id;
                                                const colDef = col;
                                                const width = columnWidths[colId];
                                                const isPinned = (pinnedOrderColumns || []).includes(colId);
                                                const stickyLeft = getStickyLeft(colId);

                                                return (
                                                    <th
                                                        key={colId}
                                                        style={{
                                                            width: `var(--col-${colId}-width, ${width ? `${width}px` : '150px'})`,
                                                            minWidth: `var(--col-${colId}-width, ${width ? `${width}px` : '150px'})`,
                                                            overflow: 'visible',
                                                            borderRight: resizingCol === colId ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                            transition: 'border-color 0.1s',
                                                            padding: 0,
                                                            position: 'sticky',
                                                            left: isPinned ? stickyLeft : undefined,
                                                            zIndex: isPinned ? 40 : 30,
                                                            background: '#e5e7eb',
                                                            boxShadow: isPinned ? '2px 0 5px rgba(0,0,0,0.05)' : 'none',
                                                            top: 0
                                                        }}
                                                    >
                                                        <div
                                                            onClick={() => handleSort(colId)}
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'space-between',
                                                                height: '100%',
                                                                padding: 'var(--table-padding, 8px 12px)',
                                                                overflow: 'visible',
                                                                width: '100%',
                                                                cursor: 'pointer',
                                                                userSelect: 'none'
                                                            }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'visible', color: 'var(--color-text-main)' }}>
                                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }}>{colDef?.label || colId}</span>
                                                                <SortIcon columnKey={colId} />
                                                                {colId !== 'actions' && (
                                                                    <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                                                                        <button
                                                                            ref={(el) => { filterBtnRefs.current[colId] = el; }}
                                                                            onClick={() => setActiveColFilter(activeColFilter === colId ? null : colId)}
                                                                            style={{
                                                                                background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px',
                                                                                color: columnFilters[colId] ? 'white' : 'var(--color-text-main)',
                                                                                backgroundColor: columnFilters[colId] ? '#ef4444' : 'transparent',
                                                                                borderRadius: '4px',
                                                                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                                            }}
                                                                            title="Filter Column"
                                                                        >
                                                                            <Filter size={14} />
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    toggleOrderColumnPin(colId);
                                                                }}
                                                                style={{
                                                                    background: 'transparent',
                                                                    border: 'none',
                                                                    cursor: 'pointer',
                                                                    padding: '2px',
                                                                    marginLeft: '4px',
                                                                    opacity: isPinned ? 1 : 0.3,
                                                                    transition: 'opacity 0.2s',
                                                                    display: 'flex', alignItems: 'center'
                                                                }}
                                                                onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                                                                onMouseLeave={(e) => e.currentTarget.style.opacity = isPinned ? '1' : '0.3'}
                                                                title={isPinned ? "Unpin Column" : "Pin Column"}
                                                            >
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill={isPinned ? "var(--color-primary)" : "none"} stroke={isPinned ? "var(--color-primary)" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                    <line x1="12" y1="17" x2="12" y2="22"></line>
                                                                    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
                                                                </svg>
                                                            </button>
                                                        </div>
                                                        <div
                                                            onMouseDown={(e) => startResize(e, colId)}
                                                            onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); autoFitColumn(colId); }}
                                                            style={{
                                                                position: 'absolute',
                                                                right: 0,
                                                                top: 0,
                                                                bottom: 0,
                                                                width: '10px',
                                                                cursor: 'col-resize',
                                                                background: 'transparent',
                                                                zIndex: 25,
                                                                transform: 'translateX(50%)' // Center on the border line
                                                            }}
                                                            className="resize-handle"
                                                        />
                                                    </th>
                                                );
                                            })}
                                            <th style={{ width: '100%', minWidth: 'auto', background: '#e5e7eb', borderBottom: '1px solid var(--color-border)' }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {paginatedOrders.map((order) => {

                                            const isSelected = selectedIds.has(order.id);
                                            const rowClass = getRowClass(order);

                                            // Helper to get background color for sticky columns based on row class
                                            // We use the helper defined outside


                                            return (
                                                <tr key={order.id} className={rowClass}>
                                                    <td style={{ textAlign: 'center', position: 'sticky', left: 0, zIndex: 15, borderLeft: order.paymentStatus === 'Cancel' ? '2px solid #991B1B' : (order.shipping?.status === 'Drafted' ? '2px solid transparent' : `2px solid ${getStatusBorderColor(order.shipping?.status || 'Pending')}`) }} className="sticky-col-first">
                                                        {canUseCheckbox && (
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedIds.has(order.id)}
                                                                onChange={(e) => toggleSelection(order.id, e.nativeEvent as unknown as React.MouseEvent)}
                                                                onClick={(e) => e.stopPropagation()}
                                                                style={{ cursor: 'pointer' }}
                                                            />
                                                        )}
                                                    </td>
                                                    {allColumns.filter(col => visibleColumns.includes(col.id)).map(col => {
                                                        const colId = col.id;
                                                        const isPinned = (pinnedOrderColumns || []).includes(colId);
                                                        const stickyLeft = getStickyLeft(colId);

                                                        const cellStyle: React.CSSProperties = {
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            maxWidth: `var(--col-${colId}-width, ${columnWidths[colId] ? `${columnWidths[colId]}px` : '150px'})`,
                                                            width: `var(--col-${colId}-width, ${columnWidths[colId] ? `${columnWidths[colId]}px` : '150px'})`,
                                                            position: isPinned ? 'sticky' : undefined,
                                                            left: isPinned ? stickyLeft : undefined,
                                                            zIndex: isPinned ? 15 : 1,
                                                            // Sticky columns need explicit background to cover scrolled content
                                                            backgroundColor: isPinned ? getRowBackgroundColor(order, isSelected) : undefined,
                                                            boxShadow: isPinned ? '2px 0 5px rgba(0,0,0,0.05)' : 'none'
                                                        };
                                                        switch (colId) {
                                                            case 'actions':
                                                                return (
                                                                    <td key={colId} style={{ ...cellStyle, width: '100px', minWidth: '100px' }}>
                                                                        <div style={{ display: 'flex', gap: '8px' }}>
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); setReceiptSale(order); }}
                                                                                className="icon-button"
                                                                                title={['Confirmed', 'Shipped', 'Delivered'].includes(order.shipping?.status || '') ? "Print Receipt" : "Print disabled (Status must be Confirmed, Shipped, or Delivered)"}
                                                                                disabled={!['Confirmed', 'Shipped', 'Delivered'].includes(order.shipping?.status || '')}
                                                                                style={{
                                                                                    padding: '4px',
                                                                                    background: 'transparent',
                                                                                    border: 'none',
                                                                                    cursor: ['Confirmed', 'Shipped', 'Delivered'].includes(order.shipping?.status || '') ? 'pointer' : 'not-allowed',
                                                                                    opacity: ['Confirmed', 'Shipped', 'Delivered'].includes(order.shipping?.status || '') ? 1 : 0.4
                                                                                }}
                                                                            >
                                                                                <Printer size={16} color={['Confirmed', 'Shipped', 'Delivered'].includes(order.shipping?.status || '') ? (order.isPrinted ? "#2563EB" : "#DC2626") : "#ccc"} />
                                                                            </button>
                                                                            <button onClick={(e) => { e.stopPropagation(); handleCopyOrder(order); }} className="icon-button" title="Copy Details" style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                                                                                <Copy size={16} color="var(--color-text-secondary)" />
                                                                            </button>
                                                                            <button onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); setIsViewModalOpen(true); }} className="icon-button" title="View Details" style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                                                                                <Eye size={16} color="var(--color-text-secondary)" />
                                                                            </button>
                                                                            {hasPermission('manage_orders') && (
                                                                                <button onClick={(e) => { e.stopPropagation(); handleOpenEdit(order); }} className="icon-button" disabled={isOrderLocked(order)} title={isOrderLocked(order) ? `${order.shipping?.status} orders cannot be edited` : 'Edit Order'} style={{ padding: '4px', background: 'transparent', border: 'none', cursor: isOrderLocked(order) ? 'not-allowed' : 'pointer', opacity: isOrderLocked(order) ? 0.35 : 1 }}>
                                                                                    <Edit size={16} color="var(--color-text-secondary)" />
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                );
                                                            case 'date': return <td key={colId} style={cellStyle}>{new Date(order.date).toLocaleDateString()}</td>;
                                                            case 'customer': {
                                                                const orderPhone = String(order.customer?.phone || '').trim();
                                                                const isScammer = blockedCustomers.some(bc => normalizePhone(bc.phone) === normalizePhone(orderPhone));
                                                                return (
                                                                    <td key={colId} style={{ ...cellStyle, fontWeight: 500 }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                            {order.customer?.name}
                                                                            {isScammer && <AlertTriangle size={14} color="#EF4444" />}
                                                                        </div>
                                                                    </td>
                                                                );
                                                            }
                                                            case 'phone': {
                                                                const operator = getOperatorForPhone(order.customer?.phone);
                                                                return (
                                                                    <td key={colId} style={cellStyle}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                            {operator && <img src={operator.logo} alt={operator.name} style={{ width: '16px', height: '16px', objectFit: 'contain', borderRadius: '2px' }} title={operator.name} />}
                                                                            <span>{order.customer?.phone || '-'}</span>
                                                                        </div>
                                                                    </td>
                                                                );
                                                            }
                                                            case 'address': return <td key={colId} style={cellStyle}>{order.customer?.address || '-'}</td>;
                                                            case 'page': return <td key={colId} style={cellStyle}>{order.customer?.page || '-'}</td>;
                                                            case 'items':
                                                                return (
                                                                    <td key={colId} style={cellStyle}>
                                                                        <div style={{ fontSize: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                            {order.items.map(i => `${i.name} x${i.quantity} `).join(', ')}
                                                                        </div>
                                                                    </td>
                                                                );
                                                            case 'total': return <td key={colId} style={{ ...cellStyle, fontWeight: 'bold', textAlign: 'right' }}>${order.total.toFixed(2)}</td>;
                                                            case 'payBy': return <td key={colId} style={cellStyle}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                    {order.paymentMethod && getPaymentLogo(order.paymentMethod) && (
                                                                        <img src={getPaymentLogo(order.paymentMethod)!} alt="payby logo" style={{ width: '14px', height: '14px', borderRadius: '2px', objectFit: 'contain' }} />
                                                                    )}
                                                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', color: getPaymentColor(order.paymentMethod) }}>{order.paymentMethod || '-'}</span>
                                                                </div>
                                                            </td>;
                                                            case 'received': return <td key={colId} style={{
                                                                ...cellStyle,
                                                                textAlign: 'right',
                                                                // Blue = money in hand (fully paid, or a deposit received); red = outstanding.
                                                                color: (order.paymentStatus === 'Paid' || order.paymentStatus === 'Deposit') ? '#2563EB' : '#DC2626',
                                                                fontWeight: 'bold'
                                                            }}>${(order.paymentStatus === 'Deposit'
                                                                ? (order.depositAmount || order.amountReceived || 0)
                                                                : (order.amountReceived ?? order.total)).toFixed(2)}</td>;
                                                            case 'payStatus':
                                                                return (
                                                                    <td key={colId} style={{
                                                                        width: `var(--col-${colId}-width, ${columnWidths[colId] ? `${columnWidths[colId]}px` : '150px'})`,
                                                                        minWidth: `var(--col-${colId}-width, ${columnWidths[colId] ? `${columnWidths[colId]}px` : '150px'})`,
                                                                        overflow: 'visible',
                                                                        textOverflow: 'ellipsis',
                                                                        textAlign: 'left'
                                                                    }}>
                                                                        <PaymentStatusBadge
                                                                            status={order.paymentStatus || 'Unpaid'}
                                                                            disabledOptions={isAdmin ? [] : ['Cancel']}
                                                                            onChange={(newStatus) => {
                                                                                const updates: any = { paymentStatus: newStatus };
                                                                                if (newStatus === 'Paid') {
                                                                                    setPaymentMethodTargetOrder(order);
                                                                                    setIsPaymentMethodModalOpen(true);
                                                                                    return;
                                                                                } else if (newStatus === 'Deposit') {
                                                                                    setDepositTargetOrder(order);
                                                                                    return;
                                                                                } else if (newStatus === 'Get File') {
                                                                                    // Same as bulk edit: keep a deposit visible
                                                                                    // in Received when one was taken.
                                                                                    updates.amountReceived = order.depositAmount || 0;
                                                                                    updates.settleDate = null;
                                                                                } else if (newStatus === 'Cancel') {
                                                                                    updates.amountReceived = 0;
                                                                                    updates.settleDate = null;
                                                                                } else {
                                                                                    updates.amountReceived = 0;
                                                                                    updates.settleDate = null;
                                                                                }
                                                                                updateOrder(order.id, updates);
                                                                            }}
                                                                            // Admins bypass the lock so they can correct mistakes
                                                                            // (e.g. un-mark a wrong Paid); the store cleans up the
                                                                            // logged income when leaving Paid.
                                                                            readOnly={!canEdit || (!isAdmin && (order.shipping?.status === 'ReStock' || order.shipping?.status === 'Drafted' || order.shipping?.status === 'Returned' || order.shipping?.status === 'Cancelled' || order.paymentStatus === 'Cancel' || order.paymentStatus === 'Paid'))}
                                                                        />
                                                                    </td>
                                                                );
                                                            case 'balance': {
                                                                const balance = orderBalance(order);
                                                                return (
                                                                    <td key={colId} style={{ ...cellStyle, color: balance > 0 ? '#DC2626' : '#059669', fontWeight: 600, textAlign: 'right' }}>
                                                                        ${balance.toFixed(2)}
                                                                    </td>
                                                                );
                                                            }
                                                            case 'status':
                                                                return (
                                                                    <td key={colId} style={{
                                                                        width: `var(--col-${colId}-width, ${columnWidths[colId] ? `${columnWidths[colId]}px` : '150px'})`,
                                                                        minWidth: `var(--col-${colId}-width, ${columnWidths[colId] ? `${columnWidths[colId]}px` : '150px'})`,
                                                                        overflow: 'visible',
                                                                        textOverflow: 'ellipsis',
                                                                        textAlign: 'left'
                                                                    }}>
                                                                        <StatusBadge
                                                                            status={order.shipping?.status || 'Pending'}
                                                                            // Admins may reopen a ReStock order (to Drafted only).
                                                                            readOnly={!canEdit || ((order.shipping?.status === 'ReStock' || order.shipping?.status === 'Returned' || order.shipping?.status === 'Cancelled' || order.paymentStatus === 'Cancel') && !(isAdmin && order.shipping?.status === 'ReStock'))}
                                                                            disabledOptions={((order.shipping?.status === 'Shipped')
                                                                                ? ['Drafted', 'Pending', 'Confirmed', 'Cancelled', 'Shipped']
                                                                                : (order.shipping?.status === 'Delivered')
                                                                                    // From Delivered only a return is allowed (post-delivery
                                                                                    // return, or correcting a mistaken Delivered).
                                                                                    ? ['Drafted', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled']
                                                                                    : (order.shipping?.status === 'ReStock')
                                                                                        // Reopening a restocked order: Drafted only.
                                                                                        ? ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned', 'Cancelled']
                                                                                        : ['Delivered', 'Returned']
                                                                            ).concat(canRestock ? [] : ['ReStock'])}
                                                                            onChange={(newStatus: string) => {
                                                                                // Backstop for the disabledOptions above, and it also covers
                                                                                // 'Returned' — reaching it without shipping would credit
                                                                                // stock on delete that was never deducted.
                                                                                if (POST_DISPATCH_STATUSES.includes(newStatus) && !canEnterPostDispatch(order, newStatus)) {
                                                                                    showToast(postDispatchMessage(order.shipping?.status || 'Pending', newStatus), 'error');
                                                                                    return;
                                                                                }
                                                                                if (newStatus === 'ReStock' && !canRestock) {
                                                                                    showToast('You do not have permission to restock orders.', 'error');
                                                                                    return;
                                                                                }
                                                                                if (order.shipping?.status === 'ReStock' && newStatus === 'Drafted') {
                                                                                    // Admin reopening a restocked order: back to Drafted with
                                                                                    // payment reset so it can run the normal flow again
                                                                                    // (stock deducts fresh when it ships).
                                                                                    updateOrderStatus(order.id, 'Drafted');
                                                                                    updateOrder(order.id, { paymentStatus: 'Unpaid', amountReceived: 0, settleDate: null as any, shipping: { ...order.shipping, status: 'Drafted' } as any });
                                                                                    return;
                                                                                }
                                                                                if (newStatus === 'Shipped') {
                                                                                    setShippingTargetStatus('Shipped');
                                                                                    setShippingOrderToUpdate(order);
                                                                                    setIsShippingModalOpen(true);
                                                                                    return;
                                                                                }
                                                                                if (newStatus === 'Confirmed') {
                                                                                    setShippingTargetStatus('Confirmed');
                                                                                    setShippingOrderToUpdate(order);
                                                                                    setIsShippingModalOpen(true);
                                                                                    return;
                                                                                }
                                                                                if (newStatus === 'Pending') {
                                                                                    setPendingOrderToUpdate(order);
                                                                                    setIsPendingRemarkModalOpen(true);
                                                                                    return;
                                                                                }
                                                                                // Shipped -> Delivered is a plain status change: no payment
                                                                                // method popup, and payment fields stay untouched.
                                                                                // Awaited in sequence: updateOrder reads the DB status
                                                                                // updateOrderStatus just wrote, so the transition (and its
                                                                                // stock-ledger handling) is never replayed twice.
                                                                                (async () => {
                                                                                    try {
                                                                                        await updateOrderStatus(order.id, newStatus as any);
                                                                                        if (newStatus === 'ReStock') {
                                                                                            // Pass the shipping status so updateOrder doesn't reset it to Pending.
                                                                                            await updateOrder(order.id, { paymentStatus: 'Cancel', shipping: { ...order.shipping, status: 'ReStock' } as any });
                                                                                            restockOrder(order.id);
                                                                                        } else if (newStatus === 'Returned' || newStatus === 'Cancelled') {
                                                                                            // null, not undefined — updateOrder skips undefined fields,
                                                                                            // which left the old settle_date on cancelled orders.
                                                                                            await updateOrder(order.id, { paymentStatus: 'Cancel', amountReceived: 0, settleDate: null as any, shipping: { ...order.shipping, status: newStatus } as any });
                                                                                        }
                                                                                    } catch (e) {
                                                                                        console.error('Status change failed:', e);
                                                                                        showToast('Failed to update order status', 'error');
                                                                                    }
                                                                                })();
                                                                            }}
                                                                        />
                                                                    </td>
                                                                );
                                                            case 'tracking':
                                                                return (
                                                                    <td key={colId} style={{ ...cellStyle, padding: '4px' }}>
                                                                        <input
                                                                            key={`tracking-${order.shipping?.trackingNumber || ''}`}
                                                                            type="text"
                                                                            readOnly={!canEdit}
                                                                            className="search-input"
                                                                            defaultValue={order.shipping?.trackingNumber || ''}
                                                                            placeholder="Add ID"
                                                                            style={{
                                                                                width: '100%',
                                                                                padding: '4px 8px',
                                                                                fontSize: 'inherit',
                                                                                color: 'inherit',
                                                                                fontFamily: 'monospace',
                                                                                border: '1px solid transparent',
                                                                                background: 'transparent'
                                                                            }}
                                                                            onFocus={(e) => {
                                                                                e.target.style.background = 'white';
                                                                                e.target.style.borderColor = 'var(--color-primary)';
                                                                            }}
                                                                            onBlur={(e) => {
                                                                                e.target.style.background = 'transparent';
                                                                                e.target.style.borderColor = 'transparent';
                                                                                const val = e.target.value.trim();
                                                                                const currentTracking = order.shipping?.trackingNumber || '';
                                                                                if (val !== currentTracking) {
                                                                                    const updatedShipping = order.shipping
                                                                                        ? { ...order.shipping, trackingNumber: val }
                                                                                        : { company: '', trackingNumber: val, status: 'Pending' as const, cost: 0, staffName: '' };
                                                                                    updateOrder(order.id, { shipping: updatedShipping });
                                                                                }
                                                                            }}
                                                                            onKeyDown={(e) => {
                                                                                if (e.key === ' ') e.stopPropagation();
                                                                                if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                                                                            }}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            onMouseDown={(e) => e.stopPropagation()}
                                                                            onPointerDown={(e) => e.stopPropagation()}
                                                                        />
                                                                    </td>
                                                                );
                                                            case 'shippingCo': return <td key={colId} style={{ ...cellStyle, color: getShippingCoColor(order.shipping?.company || '') }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                    {order.shipping?.company && getShippingLogo(order.shipping.company) && (
                                                                        <img src={getShippingLogo(order.shipping.company)!} alt="shipping logo" style={{ width: '14px', height: '14px', borderRadius: '50%', objectFit: 'cover' }} />
                                                                    )}
                                                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{order.shipping?.company || '-'}</span>
                                                                </div>
                                                            </td>;
                                                            case 'salesman': return <td key={colId} style={cellStyle}>{order.salesman || '-'}</td>;
                                                            case 'customerCare': return <td key={colId} style={cellStyle}>{order.customerCare || '-'}</td>;
                                                            case 'remark':
                                                                return (
                                                                    <td key={colId} style={{ ...cellStyle, padding: '4px' }}>
                                                                        <input
                                                                            key={`remark-${order.remark || ''}`}
                                                                            type="text"
                                                                            readOnly={!canEdit}
                                                                            className="search-input"
                                                                            defaultValue={order.remark || ''}
                                                                            placeholder="Add Remark"
                                                                            style={{
                                                                                width: '100%',
                                                                                padding: '4px 8px',
                                                                                fontSize: 'inherit',
                                                                                color: 'inherit',
                                                                                fontFamily: 'Battambang',
                                                                                border: '1px solid transparent',
                                                                                background: 'transparent'
                                                                            }}
                                                                            onFocus={(e) => {
                                                                                e.target.style.background = 'white';
                                                                                e.target.style.borderColor = 'var(--color-primary)';
                                                                            }}
                                                                            onBlur={(e) => {
                                                                                e.target.style.background = 'transparent';
                                                                                e.target.style.borderColor = 'transparent';
                                                                                const val = e.target.value.trim();
                                                                                if (val !== (order.remark || '')) {
                                                                                    updateOrder(order.id, { remark: val });
                                                                                }
                                                                            }}
                                                                            onKeyDown={(e) => {
                                                                                if (e.key === ' ') e.stopPropagation();
                                                                                if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                                                                            }}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            onMouseDown={(e) => e.stopPropagation()}
                                                                            onPointerDown={(e) => e.stopPropagation()}
                                                                        />
                                                                    </td>
                                                                );
                                                            case 'lastEdit':
                                                                return (
                                                                    <td key={colId} style={cellStyle}>
                                                                        <div style={{ display: 'flex', flexDirection: 'column', fontSize: '11px', lineHeight: '1.2' }}>
                                                                            <span style={{ fontWeight: 500 }}>{order.lastEditedBy || '-'}</span>
                                                                            {order.lastEditedAt && (
                                                                                <span style={{ color: 'var(--color-text-secondary)', fontSize: '10px' }}>
                                                                                    {new Date(order.lastEditedAt).toLocaleString()}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                );
                                                            case 'settleDate': return <td key={colId} style={cellStyle}>{order.settleDate ? new Date(order.settleDate).toLocaleDateString() : '-'}</td>;
                                                            default: return <td key={colId} style={cellStyle}>-</td>;
                                                        }
                                                    })}
                                                    <td style={{ width: '100%', minWidth: 'auto' }}></td>
                                                </tr>
                                            );
                                        })}
                                        {paginatedOrders.length === 0 && (
                                            /* Without this the body renders as blank space under the
                                               headers, which reads as "broken" rather than "no match". */
                                            <tr>
                                                <td colSpan={visibleColumnCount + 1} style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                                    {emptyStateContent}
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                    <tfoot>
                                        <tr>
                                            <td className="sticky-col-first" style={{ background: 'var(--color-bg)', borderTop: '2px solid var(--color-border)', position: 'sticky', left: 0, zIndex: 20 }}></td>
                                            {allColumns.filter(col => visibleColumns.includes(col.id)).map((col) => {
                                                const colId = col.id;
                                                const isPinned = (pinnedOrderColumns || []).includes(colId);
                                                const stickyLeft = getStickyLeft(colId);

                                                const commonStyle = {
                                                    padding: '8px 12px',
                                                    fontSize: '12px',
                                                    fontWeight: 'bold',
                                                    borderTop: '2px solid var(--color-border)',
                                                    background: 'var(--color-bg)',
                                                    textAlign: 'left' as const,
                                                    position: isPinned ? 'sticky' as const : undefined,
                                                    left: isPinned ? stickyLeft : undefined,
                                                    zIndex: isPinned ? 20 : 1,
                                                    boxShadow: isPinned ? '2px 0 5px rgba(0,0,0,0.05)' : 'none'
                                                };

                                                if (colId === 'actions') {
                                                    return <td key={colId} style={{ ...commonStyle, minWidth: '100px' }}>Total: {stats.totalOrders}</td>;
                                                }
                                                if (colId === 'total') return <td key={colId} style={{ ...commonStyle, textAlign: 'right' }}>${stats.totalRevenue.toFixed(2)}</td>;
                                                if (colId === 'received') return <td key={colId} style={{ ...commonStyle, textAlign: 'right', color: '#2563EB' }}>${stats.totalReceived.toFixed(2)}</td>;
                                                if (colId === 'balance') return <td key={colId} style={{ ...commonStyle, textAlign: 'right', color: 'var(--color-red)' }}>${stats.totalOutstanding.toFixed(2)}</td>;
                                                if (colId === 'items') return <td key={colId} style={{ ...commonStyle }}>{stats.totalProducts} pcs</td>;

                                                return <td key={colId} style={commonStyle}></td>;
                                            })}
                                            <td style={{ width: '100%', minWidth: 'auto', background: 'var(--color-bg)', borderTop: '2px solid var(--color-border)' }}></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </>
                        )}
                    </div>

                    {/* Bulk Actions Bar — visible to anyone who can select rows;
                        the buttons inside keep their own permission gates. */}
                    {
                        selectedIds.size > 0 && canUseCheckbox && (
                            <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: 'var(--color-surface)', padding: '16px 24px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: '16px', zIndex: 100, border: '1px solid var(--color-border)' }}>
                                <span style={{ fontWeight: 600 }}>{selectedIds.size} selected</span>
                                <div style={{ height: '24px', width: '1px', background: 'var(--color-border)' }} />
                                {canManage && (Array.from(selectedIds).some(id => {
                                    const order = filteredOrders.find(o => o.id === id);
                                    const phone = order?.customer?.phone;
                                    return phone && blockedCustomers.some(bc => normalizePhone(bc.phone) === normalizePhone(phone));
                                }) ? (
                                    <button type="button" onClick={(e) => {
                                        e.preventDefault();
                                        // One batched call: looping the single remove rebuilt
                                        // the list from stale state each time, so only the
                                        // last phone actually stayed unblocked.
                                        const phonesToUnblock: string[] = [];
                                        selectedIds.forEach(id => {
                                            const order = filteredOrders.find(o => o.id === id);
                                            const phone = order?.customer?.phone;
                                            if (phone && blockedCustomers.some(bc => normalizePhone(bc.phone) === normalizePhone(phone))) {
                                                phonesToUnblock.push(String(phone));
                                            }
                                        });
                                        removeBlockedCustomers(phonesToUnblock);
                                        showToast(`Unblocked ${phonesToUnblock.length} customer(s)`, 'success');
                                        setSelectedIds(new Set());
                                    }} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: '#ECFCCB', color: '#65A30D', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                                        <ShieldCheck size={18} /> Unblock
                                    </button>
                                ) : (
                                    <button type="button" onClick={(e) => { e.preventDefault(); setScammerTargetOrder(null); setIsScammerModalOpen(true); }} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: '#FEF2F2', color: '#DC2626', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                                        <ShieldOff size={18} /> Mark as Scammer
                                    </button>
                                ))}
                                {isAdmin && (
                                    <button type="button" onClick={handleBulkDelete} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: '#FEE2E2', color: '#DC2626', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                                        <Trash2 size={18} /> Delete
                                    </button>
                                )}
                                { (() => {
                                    if (!canRestock) return null;
                                    const allReturned = Array.from(selectedIds).every(id => filteredOrders.find(o => o.id === id)?.shipping?.status === 'Returned');
                                    if (!allReturned) return null;
                                    return (
                                        <button 
                                            type="button" 
                                            onClick={handleBulkRestock} 
                                            style={{ 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                gap: '8px', 
                                                padding: '8px 16px', 
                                                background: '#E0E7FF', 
                                                color: '#4F46E5', 
                                                borderRadius: '8px', 
                                                border: 'none', 
                                                cursor: 'pointer', 
                                                fontWeight: 500 
                                            }}>
                                            <RefreshCw size={18} /> Restock
                                        </button>
                                    );
                                })() }
                            </div>
                        )
                    }
                </>
            ) : (
                <POSInterface
                    orderToEdit={editingOrder}
                    onCancelEdit={() => {
                        setEditingOrder(null);
                        setActiveTab('list');
                    }}
                />
            )}

            {/* Desktop pagination bar — mobile uses infinite scroll instead */}
            {
                !isMobile && activeTab === 'list' && filteredOrders.length > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', padding: '0', position: 'relative' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                                Showing {Math.min((currentPage - 1) * itemsPerPage + 1, filteredOrders.length)} to {Math.min(currentPage * itemsPerPage, filteredOrders.length)} of {filteredOrders.length} entries
                            </div>
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'nowrap', alignItems: 'center' }}>
                                {(() => {
                                    const statuses = ['Drafted', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned', 'ReStock', 'Cancelled'];
                                    const getStatusColors = (s: string) => {
                                        switch (s) {
                                            case 'Pending': return { bg: '#FEF3C7', color: '#D97706' };
                                            case 'Confirmed': return { bg: '#E0F2FE', color: '#0369A1' };
                                            case 'Shipped': return { bg: '#DBEAFE', color: '#2563EB' };
                                            case 'Delivered': return { bg: '#D1FAE5', color: '#059669' };
                                            case 'Cancelled': return { bg: '#FEE2E2', color: '#DC2626' };
                                            case 'Returned': return { bg: '#F3F4F6', color: '#DC2626' };
                                            case 'ReStock': return { bg: '#E9D5FF', color: '#7E22CE' };
                                            case 'Drafted': return { bg: '#F3F4F6', color: '#111827' };
                                            default: return { bg: '#F3F4F6', color: '#4B5563' };
                                        }
                                    };
                                    return statuses.map(status => {
                                        const count = stats.statusCounts[status] || 0;
                                        if (count === 0) return null;
                                        const colors = getStatusColors(status);
                                        return (
                                            <span key={status} style={{
                                                backgroundColor: colors.bg,
                                                color: colors.color,
                                                padding: '1px 5px',
                                                borderRadius: '4px',
                                                fontSize: '10px',
                                                fontWeight: 600,
                                                whiteSpace: 'nowrap',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '2px'
                                            }}>
                                                {status}: <strong style={{ fontSize: '11px' }}>{count}</strong>
                                            </span>
                                        );
                                    });
                                })()}
                            </div>
                            {Object.values(stats.payStatusCounts).some(c => c > 0) && (
                                <>
                                    <div style={{ width: '1px', height: '14px', backgroundColor: 'var(--color-border)' }} />
                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'nowrap', alignItems: 'center' }}>
                                        {(() => {
                                            const payStatuses = ['Unpaid', 'Deposit', 'Get File', 'Paid', 'Cancel', 'Settled', 'Not Settle', 'Pending'];
                                            const getPayStatusColors = (s: string) => {
                                                switch (s) {
                                                    case 'Paid': return { bg: '#D1FAE5', color: '#059669' };
                                                    case 'Deposit': return { bg: '#F3E8FF', color: '#7E22CE' };
                                                    case 'Get File': return { bg: '#DBEAFE', color: '#1D4ED8' };
                                                    case 'Unpaid': return { bg: '#FEE2E2', color: '#DC2626' };
                                                    case 'Settled': return { bg: '#E0E7FF', color: '#4F46E5' };
                                                    case 'Not Settle': return { bg: '#FEE2E2', color: '#DC2626' };
                                                    case 'Cancel': return { bg: '#FEF2F2', color: '#991B1B' };
                                                    case 'Pending': return { bg: '#FEF3C7', color: '#D97706' };
                                                    default: return { bg: '#F3F4F6', color: '#4B5563' };
                                                }
                                            };
                                            return payStatuses.map(status => {
                                                const count = stats.payStatusCounts[status] || 0;
                                                if (count === 0) return null;
                                                const colors = getPayStatusColors(status);
                                                return (
                                                    <span key={status} style={{
                                                        backgroundColor: colors.bg,
                                                        color: colors.color,
                                                        padding: '1px 5px',
                                                        borderRadius: '4px',
                                                        fontSize: '10px',
                                                        fontWeight: 600,
                                                        whiteSpace: 'nowrap',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '2px'
                                                    }}>
                                                        {status}: <strong style={{ fontSize: '11px' }}>{count}</strong>
                                                    </span>
                                                );
                                            });
                                        })()}
                                    </div>
                                </>
                            )}

                        </div>



                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                <span>Rows per page:</span>
                                <select
                                    value={itemsPerPage}
                                    onChange={(e) => setItemsPerPage(Number(e.target.value))}
                                    style={{
                                        padding: '4px 8px',
                                        borderRadius: '6px',
                                        border: '1px solid var(--color-border)',
                                        background: 'var(--color-surface)',
                                        color: 'var(--color-text-main)',
                                        fontSize: '13px',
                                        outline: 'none',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <option value={100}>100</option>
                                    <option value={200}>200</option>
                                    <option value={300}>300</option>
                                    <option value={500}>500</option>
                                    <option value={1000}>1000</option>
                                    <option value={3000}>3000</option>
                                    <option value={5000}>5000</option>
                                    <option value={999999}>All Rows</option>
                                </select>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <button
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    style={{
                                        padding: '6px', borderRadius: '6px', border: '1px solid var(--color-border)',
                                        background: currentPage === 1 ? 'var(--color-bg)' : 'var(--color-surface)',
                                        color: currentPage === 1 ? 'var(--color-text-muted)' : 'var(--color-text-main)',
                                        cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}
                                >
                                    <ChevronLeft size={16} />
                                </button>
                                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                                    Page <span style={{ color: 'var(--color-text-main)', fontWeight: 600 }}>{currentPage}</span> of {Math.max(1, Math.ceil(totalCount / itemsPerPage))}
                                </span>
                                <button
                                    onClick={() => setCurrentPage(p => Math.min(Math.ceil(totalCount / itemsPerPage), p + 1))}
                                    disabled={currentPage >= Math.ceil(totalCount / itemsPerPage)}
                                    style={{
                                        padding: '6px', borderRadius: '6px', border: '1px solid var(--color-border)',
                                        background: currentPage >= Math.ceil(totalCount / itemsPerPage) ? 'var(--color-bg)' : 'var(--color-surface)',
                                        color: currentPage >= Math.ceil(totalCount / itemsPerPage) ? 'var(--color-text-muted)' : 'var(--color-text-main)',
                                        cursor: currentPage >= Math.ceil(totalCount / itemsPerPage) ? 'not-allowed' : 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}
                                >
                                    <ChevronRight size={16} />
                                </button>
                                {hasMoreOrders && (
                                    <button
                                        onClick={loadMoreOrders}
                                        disabled={isLoadingMore}
                                        style={{
                                            padding: '6px 16px',
                                            borderRadius: '6px',
                                            border: '1px solid var(--color-border)',
                                            background: 'var(--color-primary)',
                                            color: 'white',
                                            cursor: isLoadingMore ? 'not-allowed' : 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '13px',
                                            fontWeight: 500,
                                            marginLeft: '12px',
                                            opacity: isLoadingMore ? 0.7 : 1
                                        }}
                                    >
                                        {isLoadingMore ? 'Loading...' : 'Load Older Records'}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }

            {/* View Order Modal */}
            {
                isViewModalOpen && selectedOrder && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
                        <div className="glass-panel" style={{ width: '600px', padding: '32px', maxHeight: '90vh', overflowY: 'auto' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                                <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>Order Details</h2>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button
                                        onClick={() => {
                                            const textToCopy = generateOrderCopyText(selectedOrder, sales);
                                            navigator.clipboard.writeText(textToCopy);
                                            showToast('Order info copied!', 'success');
                                        }}
                                        style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: '6px', cursor: 'pointer', padding: '6px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}
                                        title="Copy Order Info"
                                    >
                                        <Copy size={16} /> Copy
                                    </button>
                                    <button
                                        onClick={() => window.open(`/orders/${selectedOrder.id}`, '_blank')}
                                        style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: '6px', cursor: 'pointer', padding: '6px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}
                                        title="Open Details Page"
                                    >
                                        <ExternalLink size={16} /> Open
                                    </button>
                                    {selectedOrder.customer?.phone && blockedCustomers.some(bc => normalizePhone(bc.phone) === normalizePhone(selectedOrder.customer!.phone)) ? (
                                        <button
                                            onClick={() => {
                                                removeBlockedCustomer(String(selectedOrder.customer!.phone || '').trim());
                                                showToast('Customer unblocked', 'success');
                                            }}
                                            style={{ background: 'none', border: '1px solid #ECFCCB', borderRadius: '6px', cursor: 'pointer', padding: '6px', color: '#65A30D', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}
                                            title="Unblock Scammer"
                                        >
                                            <ShieldCheck size={16} /> Unblock
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => { setScammerTargetOrder(selectedOrder); setIsScammerModalOpen(true); setIsViewModalOpen(false); }}
                                            style={{ background: 'none', border: '1px solid #FEE2E2', borderRadius: '6px', cursor: 'pointer', padding: '6px', color: '#DC2626', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}
                                            title="Mark as Scammer"
                                        >
                                            <ShieldOff size={16} /> Block
                                        </button>
                                    )}
                                    <button onClick={() => setIsViewModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><X size={24} /></button>
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '12px' }}>
                                <div>
                                    <h4 style={{ color: 'var(--color-text-secondary)', fontSize: '12px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Customer</h4>
                                    <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '4px' }}>{selectedOrder.customer?.name}</div>
                                    <div style={{ fontSize: '14px', color: 'var(--color-text-main)' }}>{selectedOrder.customer?.phone}</div>
                                    <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>{selectedOrder.customer?.address}</div>
                                </div>
                                <div>
                                    <h4 style={{ color: 'var(--color-text-secondary)', fontSize: '12px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Order Info</h4>
                                    <div style={{ fontSize: '14px', marginBottom: '4px' }}>Date: {new Date(selectedOrder.date).toLocaleString()}</div>
                                    <div style={{ fontSize: '14px', marginBottom: '4px' }}>Status: {getStatusBadge(selectedOrder.shipping?.status || 'Pending')}</div>
                                    <div style={{ fontSize: '14px', marginBottom: '4px' }}>Platform: {selectedOrder.customer?.platform} ({selectedOrder.customer?.page})</div>
                                    <div style={{ fontSize: '14px', marginTop: '8px', wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <ExternalLink size={14} style={{ color: 'var(--color-primary)' }} />
                                        <a href={`/orders/${selectedOrder.id}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
                                            Open Order Page
                                        </a>
                                    </div>
                                </div>
                            </div>

                            <div style={{ background: 'rgba(0,0,0,0.03)', borderRadius: '12px', padding: '20px', marginBottom: '12px' }}>
                                <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Items</h4>
                                {selectedOrder.items.map((item, i) => (
                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px' }}>
                                        <span>{item.name} <span style={{ color: 'var(--color-text-secondary)' }}>x{item.quantity}</span></span>
                                        <span>${(item.price * item.quantity).toFixed(2)}</span>
                                    </div>
                                ))}
                                <div style={{ borderTop: '1px solid var(--color-border)', marginTop: '12px', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '16px' }}>
                                    <span>Total</span>
                                    <span>${selectedOrder.total.toFixed(2)}</span>
                                </div>
                            </div>

                            <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)', display: 'grid', gap: '8px' }}>
                                <div style={{ color: getShippingCoColor(selectedOrder.shipping?.company || '') }}><strong>Shipping:</strong> {selectedOrder.shipping?.company} (${selectedOrder.shipping?.cost}) - {selectedOrder.shipping?.trackingNumber || 'No ID'}</div>
                                <div><strong>Salesman:</strong> {selectedOrder.salesman}</div>
                                <div><strong>Remark:</strong> {selectedOrder.remark || '-'}</div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Receipt Modal */}
            {
                receiptSale && (
                    <ReceiptModal
                        sale={receiptSale}
                        onClose={() => setReceiptSale(null)}
                    />
                )
            }

            {/* Shipping Company Selection Modal */}
            <ShippingModalComponent
                isOpen={isShippingModalOpen}
                onClose={() => { setIsShippingModalOpen(false); setShippingOrderToUpdate(null); }}
                order={shippingOrderToUpdate}
                targetStatus={shippingTargetStatus}
            />
            {/* Pending Remark Modal */}
            <PendingRemarkModalComponent
                isOpen={isPendingRemarkModalOpen}
                onClose={() => { setIsPendingRemarkModalOpen(false); setPendingOrderToUpdate(null); }}
                order={pendingOrderToUpdate}
            />
            {/* Settle Payment Modal */}
            {paymentMethodTargetOrder && (
                <SettlePaymentModal
                    isOpen={isPaymentMethodModalOpen}
                    onClose={() => { setIsPaymentMethodModalOpen(false); setPaymentMethodTargetOrder(null); }}
                    initialMethod={paymentMethodTargetOrder.paymentMethod || undefined}
                    initialDate={paymentMethodTargetOrder.settleDate || undefined}
                    onConfirm={({ paymentMethod, settleDate }) => {
                        // Payment only — the order/shipping status is left untouched.
                        const updates: any = { paymentStatus: 'Paid', paymentMethod, settleDate };
                        updates.amountReceived = paymentMethodTargetOrder.total;
                        updateOrder(paymentMethodTargetOrder.id, updates);
                    }}
                />
            )}
            {/* Column filter popover (portal — never clipped by the table scroller) */}
            {activeColFilter && (
                <ColumnFilterPopover
                    key={activeColFilter}
                    anchor={filterBtnRefs.current[activeColFilter]}
                    label={allColumnsDef.find(c => c.id === activeColFilter)?.label || activeColFilter}
                    isDate={activeColFilter === 'date' || activeColFilter === 'settleDate'}
                    value={columnFilters[activeColFilter] || ''}
                    onApply={(v) => {
                        const col = activeColFilter;
                        setColumnFilters(prev => {
                            const next = { ...prev };
                            if (v.trim()) next[col] = v; else delete next[col];
                            return next;
                        });
                    }}
                    onClear={() => {
                        const col = activeColFilter;
                        setColumnFilters(prev => { const next = { ...prev }; delete next[col]; return next; });
                    }}
                    onClose={() => setActiveColFilter(null)}
                />
            )}
            {/* Deposit Modal */}
            <DepositModal
                order={depositTargetOrder}
                onClose={() => setDepositTargetOrder(null)}
                onConfirm={({ amount, method, date }) => {
                    if (!depositTargetOrder) return;
                    updateOrder(depositTargetOrder.id, {
                        paymentStatus: 'Deposit',
                        depositAmount: amount,
                        depositMethod: method,
                        depositDate: date,
                        amountReceived: amount
                    });
                    setDepositTargetOrder(null);
                }}
            />
            {/* Stock Movement Summary (shared with the Stock Movements page) — opens on today */}
            <StockMovementSummaryModal
                isOpen={isMovementSummaryOpen}
                onClose={() => setIsMovementSummaryOpen(false)}
                initialRange={{ start: new Date().toLocaleDateString('en-CA'), end: new Date().toLocaleDateString('en-CA') }}
            />
            <DataImportModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                type="order"
                onImport={handleImportOrders}
            />
            <BulkEditModal
                isOpen={isBulkEditOpen}
                onClose={() => setIsBulkEditOpen(false)}
                onApply={handleBulkEdit}
                count={selectedIds.size}
            />
            {/* Scammer Modal */}
            <Modal
                isOpen={isScammerModalOpen}
                onClose={() => { setIsScammerModalOpen(false); setScammerTargetOrder(null); setScammerReason(''); }}
                title={scammerTargetOrder ? "Mark Customer as Scammer" : "Mark Customers as Scammers"}
                width="400px"
            >
                <div style={{ padding: '20px' }}>
                    <div style={{ marginBottom: '16px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                        {scammerTargetOrder ? (
                            <>Are you sure you want to block <strong>{scammerTargetOrder.customer?.name}</strong> ({scammerTargetOrder.customer?.phone})?</>
                        ) : (
                            <>Are you sure you want to block <strong>{selectedIds.size}</strong> selected customer(s)?</>
                        )}
                        <br />They will be prevented from placing future orders.
                    </div>
                    <div style={{ marginBottom: '24px' }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-main)' }}>Reason (Optional)</label>
                        <input
                            type="text"
                            value={scammerReason}
                            onChange={(e) => setScammerReason(e.target.value)}
                            className="form-input"
                            placeholder="e.g. Fake order, refused delivery"
                            autoFocus
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                        <button onClick={() => { setIsScammerModalOpen(false); setScammerTargetOrder(null); setScammerReason(''); }} className="secondary-button" style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '14px' }}>
                            Cancel
                        </button>
                        <button
                            onClick={async () => {
                                if (scammerTargetOrder) {
                                    if (scammerTargetOrder.customer?.phone) {
                                        await addBlockedCustomer({
                                            phone: String(scammerTargetOrder.customer.phone || '').trim(),
                                            name: scammerTargetOrder.customer.name || 'Unknown',
                                            reason: scammerReason,
                                            blockedAt: new Date().toISOString(),
                                            blockedBy: currentUser?.name
                                        });
                                        showToast('Customer marked as scammer', 'success');
                                    }
                                } else {
                                    const customersToBlock: any[] = [];
                                    const seenPhones = new Set<string>();
                                    selectedIds.forEach(id => {
                                        // The table renders serverOrders; the store's sales cache only
                                        // holds a recent page, so older selected orders miss it.
                                        const order = serverOrders.find(s => s.id === id) || sales.find(s => s.id === id);
                                        const phone = String(order?.customer?.phone || '').trim();
                                        if (phone && !seenPhones.has(phone)) {
                                            seenPhones.add(phone);
                                            customersToBlock.push({
                                                phone,
                                                name: order!.customer!.name || 'Unknown',
                                                reason: scammerReason,
                                                blockedAt: new Date().toISOString(),
                                                blockedBy: currentUser?.name
                                            });
                                        }
                                    });
                                    if (customersToBlock.length > 0) {
                                        await addBlockedCustomers(customersToBlock);
                                        showToast(`${customersToBlock.length} customer(s) marked as scammers`, 'success');
                                    } else {
                                        showToast('No customer phone found on the selected orders — nobody was blocked', 'error');
                                    }
                                }
                                setIsScammerModalOpen(false);
                                setScammerTargetOrder(null);
                                setScammerReason('');
                                setSelectedIds(new Set());
                            }}
                            className="primary-button"
                            style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '14px', background: '#EF4444', border: 'none', boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)' }}
                        >
                            Confirm Block
                        </button>
                    </div>
                </div>
            </Modal>
            {/* Shipping Points Modal */}
            <Modal
                isOpen={isShippingPointModalOpen}
                onClose={() => setIsShippingPointModalOpen(false)}
                title="Shipping Points"
                fullScreen
                bodyPadding="0"
                bodyOverflowY="auto"
            >
                <ShippingPointContent
                    mode="page"
                    hideHeaderEffect
                    hideHeader
                    tableName="custom_locations"
                    mapSource="google"
                />
            </Modal>
            
            {/* Income Expense Modal */}
            <Modal
                isOpen={isIncomeModalOpen}
                onClose={() => setIsIncomeModalOpen(false)}
                title="Income & Expense"
                width="1200px"
                height="90vh"
                bodyPadding="0"
                bodyOverflowY="auto"
            >
                <IncomeExpense isModal />
            </Modal>

            {/* Deleted Orders Modal */}
            <Modal
                isOpen={isDeletedModalOpen}
                onClose={() => setIsDeletedModalOpen(false)}
                title="Deleted Orders"
                width="1200px"
                height="90vh"
                bodyPadding="0"
                bodyOverflowY="hidden"
            >
                <DeletedOrdersContent isModal />
            </Modal>
        </div >
    );
};

export default Orders;



