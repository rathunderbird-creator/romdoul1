import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, lazy, startTransition } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { PAGE_UNKNOWN, type OrderListFilters } from '../utils/orderListFilters';
import { REVENUE_STATUSES, isRevenueOrder, orderRevenue, orderCollected, orderRevenuePieces, orderBalance } from '../utils/orderMoney';
import { statusChangeRefusal, paymentChangeRefusal, paymentLockedForNonAdmin, settleDateChangeRefusal, orderStatusLabel, orderStatusesMatchingLabel } from '../utils/orderStatusRules';
import { bodyZoom } from '../utils/bodyZoom';
import { Plus, Search, Filter, X, ChevronLeft, ChevronRight, ChevronDown, Edit, Trash2, ArrowUp, ArrowDown, Upload, User, Copy, ExternalLink, Package, Truck, CreditCard, List, Store, Settings, Printer, Clock, CheckCircle, RefreshCw, ChevronsUpDown, MapPin, Check, Wallet, AlertTriangle, ShieldOff, ShieldCheck, Loader2, Table2, Phone, Boxes, HandCoins } from 'lucide-react';
import { useStore, normalizePhone } from '../context/StoreContext';
import { useShipmentTracking } from '../hooks/useShipmentTracking';
import { buildTrackingUrl, canAutoTrack, timeAgo } from '../utils/tracking';
import { useToast } from '../context/ToastContext';
import { getOperatorForPhone, formatPhoneDisplay } from '../utils/telecom';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import { StatusBadge, ReceiptModal, DateRangePicker, MobileOrderCard, BulkEditModal, Modal, SettlePaymentModal, DepositModal, DeliveryFeeModal } from '../components';
import ShippingPointSelector from '../components/ShippingPointSelector';
import StockMovementSummaryModal from '../components/StockMovementSummaryModal';
import CheckStockModal from '../components/CheckStockModal';
import PaymentStatusBadge from '../components/PaymentStatusBadge';
import DataImportModal from '../components/DataImportModal';

const POSInterface = lazy(() => import('../components/POSInterface'));
const ShippingPointContent = lazy(() => import('../components/ShippingPointContent').then(module => ({ default: module.ShippingPointContent })));
const IncomeExpense = lazy(() => import('./IncomeExpense'));
const DeletedOrdersContent = lazy(() => import('./DeletedOrders').then(module => ({ default: module.DeletedOrdersContent })));

import { generateOrderCopyText, getShippingCoColor } from '../utils/orderUtils';
import { usePaymentRequest } from '../hooks/usePaymentRequest';
import CopyPaymentRequestButton from '../components/CopyPaymentRequestButton';
import { copyText } from '../utils/clipboard';

// Narrowest a column may be resized / auto-fitted to (else 50 by hand, 40 by
// auto-fit). Actions holds four icons (Print, Edit, Copy, Payment request) and
// has no text for auto-fit to measure; a narrower saved width is widened on load.
const COLUMN_MIN_WIDTH: Record<string, number> = { actions: 140 };
const columnMinWidth = (colId: string, fallback: number) => Math.max(COLUMN_MIN_WIDTH[colId] ?? 0, fallback);
// Columns the server can't order by: Customer group is looked up from the
// phone in Sales Setup, not stored on the order.
const UNSORTABLE_COLUMNS = new Set(['customerGroup']);
import { getPaymentIcon, getPaymentColor } from '../utils/payment';
import { getShippingLogo } from '../utils/shipping';
import { useClickOutside } from '../hooks/useClickOutside';
import { supabase } from '../lib/supabase';
import { fetchAll } from '../utils/fetchAll';
import { mapSaleEntity } from '../utils/mapper';
import { accountCurrency, formatKhr, formatMoneyLine, formatUsd, isKhrRow, khrMeta, khrToUsd, rielToReopen, shopRate, SNAP_TOLERANCE_USD, usdToKhr, type MoneyMeta } from '../utils/currency';
import { roundCents } from '../utils/money';
import { reasonApplies, reasonOptions } from '../utils/rejectionReasons';
import { courierDeliveryType, couriersMatchingTypeText } from '../utils/deliveryTypes';
import { customerGroupOf, customerGroupOptions, phoneDigits, phonesMatchingGroupText } from '../utils/customerGroups';

// The "Other…" pick in the reason pop-up and Reason column (never saved).
const OTHER_REASON = '__other__';
import MoneyInput from '../components/MoneyInput';
import CashBankOptions from '../components/CashBankOptions';
import { useAccountCurrency, useMoneyField } from '../hooks/useMoneyField';
import { useAccounting } from '../hooks/useAccounting';
import { defaultCashBankAccountId, defaultCodCollected, depositDefaultFor } from '../utils/cashBankAccounts';
import * as XLSX from 'xlsx';
import type { Sale, CartItem, PaidMoney } from '../types';
import { beginLiveResize, endLiveResize, liveDelta, showLiveWidth, type LiveResize } from '../utils/liveColumnResize';
import { useLanguage } from '../context/LanguageContext';
import { tNow, fill } from '../i18n/translate';

// Display text for a stored order / payment status (the stored value itself
// never changes). Read at render time; the page re-renders on a language switch.
const statusText = (s: string): string => {
    const k = `ui.orders.status.${s}`;
    const v = tNow(k);
    return v !== k ? v : orderStatusLabel(s);
};
const payText = (s: string): string => {
    for (const k of [`dashboard2.pay.${s}`, `ui.orders.pay.${s.replace(/\s/g, '')}`]) {
        const v = tNow(k);
        if (v !== k) return v;
    }
    return s;
};

type SortConfig = {
    key: string;
    direction: 'asc' | 'desc';
} | null;

// The minimal money columns the desktop footer's all-matches totals read
// (ORD-11); see the aggregate fetch in fetchOrders.
interface FooterAggRow {
    id: string | number;
    total: number | string | null;
    amount_received: number | string | null;
    deposit_amount: number | string | null;
    payment_status: string | null;
    shipping_status: string | null;
    items: { quantity: number | string | null; name: string | null }[] | null;
}
// The slice of a PostgREST builder the aggregate fetch uses (the builders
// applyOrderFilters hands back are intentionally untyped).
interface FooterAggQuery {
    order: (col: string, opts: { ascending: boolean }) => {
        range: (from: number, to: number) => PromiseLike<{ data: FooterAggRow[] | null; error: unknown }>;
    };
}

// Local start/end of a 'YYYY-MM-DD' day (new Date('YYYY-MM-DD') would parse as UTC).
const localDayBound = (dateStr: string, edge: 'start' | 'end'): Date => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return edge === 'start' ? new Date(y, m - 1, d, 0, 0, 0, 0) : new Date(y, m - 1, d, 23, 59, 59, 999);
};

// Restock only acts on orders that are Returned right now; say what was skipped.
const restockResultMessage = (restocked: number, requested: number) => {
    const skipped = requested - restocked;
    if (restocked === 0) return tNow('ui.orders.restock.none', { n: requested });
    return (restocked === 1 ? tNow('ui.orders.restock.doneOne') : tNow('ui.orders.restock.doneMany', { n: restocked }))
        + (skipped > 0 ? tNow('ui.orders.restock.skipped', { n: skipped }) : '');
};

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
    const { shippingCompanies, customerCare, products, updateOrder, updateOrderStatus, khrExchangeRate, salesSettings } = useStore();
    const defUsd = depositDefaultFor(salesSettings, 'USD');
    const defKhr = depositDefaultFor(salesSettings, 'KHR');
    const { showToast } = useToast();
    const { t } = useLanguage();

    const [selectedCompany, setSelectedCompany] = useState<string>('');
    const [shippingRemark, setShippingRemark] = useState<string>('');
    const [shippingAddress, setShippingAddress] = useState<string>('');
    const [shippingCustomerCare, setShippingCustomerCare] = useState<string>('');
    const [isShippingPointSelectorOpen, setIsShippingPointSelectorOpen] = useState(false);
    const [items, setItems] = useState<CartItem[]>([]);
    // The deposit is a money field like the Deposit modal's: dollars or riel
    // (the ៛ side follows the "Deposited into" account), pre-filled rate, and
    // the wrong-amount warning. A deposit is less than the order total.
    const itemsTotal = items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
    const depositField = useMoneyField({ shopRate: khrExchangeRate, maxPlausibleUsd: itemsTotal > 0 ? itemsTotal : null });
    const { accounts, fetchAccounts } = useAccounting();
    const [depositAccountId, setDepositAccountId] = useState('');
    useEffect(() => { if (isOpen) fetchAccounts(); }, [isOpen, fetchAccounts]);
    // Cash/bank ledger accounts, same filter as the Deposit modal's field.
    const paymentAccounts = useMemo(
        () => accounts.filter(a => a.is_active && a.account_type === 'Asset' && /cash|bank/i.test(a.account_name)),
        [accounts]
    );
    const depositCoupling = useAccountCurrency(depositField, paymentAccounts, depositAccountId, setDepositAccountId, { usd: defUsd, khr: defKhr });
    // '' = auto-compute from the total/deposit — stays live until the user
    // types a KHR figure of their own, same pattern the Receipt used to have.
    const [customKhr, setCustomKhr] = useState<string>('');
    // The riel figure was typed in this opening. On an unpaid order it then
    // sets what is owed: Remaining USD = riel ÷ shop rate, and the order total
    // becomes deposit + that, the difference from the items going into the
    // order's discount (negative = charged extra). An override saved earlier
    // and left alone changes nothing.
    const [khrEdited, setKhrEdited] = useState(false);
    // Save is in flight (see the Save handler).
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    // Inactive (no longer sold) products drop out too; a line already on the
    // order keeps its own fallback option below.
    const activeProducts = useMemo(() => products.filter(p => p.isActive !== false && !p.inactive), [products]);

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
            setItems((order.items || []).map(i => ({ ...i })));
            // Never a riel account by default; a deposit already taken into a
            // riel account reopens in riel (same as the Deposit modal).
            const accountId = defaultCashBankAccountId(paymentAccounts, { preferredId: order.depositAccountId, defaultId: defUsd });
            setDepositAccountId(accountId);
            const prev = order.depositAmount || 0;
            const inRiel = prev > 0 && accountCurrency(paymentAccounts.find(a => a.id === accountId)) === 'KHR';
            depositField.reset(inRiel
                ? { amount: usdToKhr(prev, depositField.shopRate), currency: 'KHR' }
                : { amount: prev, currency: 'USD' });
            // Pre-fill from whatever override is already saved, so reopening
            // the popup shows (and re-saves) the same figure the receipt is
            // actually printing — '' only when there truly is no override.
            setCustomKhr(order.customKhrAmount !== undefined && order.customKhrAmount !== null ? String(order.customKhrAmount) : '');
            setKhrEdited(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, order, shippingCompanies, paymentAccounts, defUsd]);

    if (!order) return null;

    const rate = shopRate(khrExchangeRate);
    const isPaidOrder = ['Paid', 'Settled', 'Paid/Settled'].includes(order.paymentStatus || '');
    const depositNum = depositField.usd;
    const depositChanged = Math.abs(depositNum - (order.depositAmount || 0)) > 0.0001;
    // A changed deposit on an unpaid order is booked (Deposit flow below), so
    // it needs the account it went into.
    const depositBooks = depositChanged && depositNum > 0 && !isPaidOrder;
    const savedDiscount = Number(order.discount) || 0;
    const typedKhr = customKhr !== '' ? Number(customKhr) : NaN;
    // The riel typed here sets the money (unpaid orders only: a paid order's
    // money is already booked, so there it stays a receipt figure).
    const khrSetsMoney = khrEdited && !isPaidOrder && Number.isFinite(typedKhr) && typedKhr >= 0;
    const remainingAmount = khrSetsMoney
        ? khrToUsd(typedKhr, rate)
        : Math.max(0, roundCents(itemsTotal - savedDiscount) - depositNum);
    const computedTotal = khrSetsMoney ? roundCents(depositNum + remainingAmount) : roundCents(itemsTotal - savedDiscount);
    const discount = roundCents(itemsTotal - computedTotal);
    const totalChanged = Math.abs(computedTotal - (Number(order.total) || 0)) > 0.005;
    const khrBase = depositNum > 0 ? remainingAmount : computedTotal;
    const displayKhr = customKhr !== '' ? customKhr : Math.round(khrBase * rate).toString();

    // Editing the items drops a riel figure typed here, so the total follows
    // the items again (and the riel is recomputed from it).
    const itemsEdited = () => { if (khrEdited) { setKhrEdited(false); setCustomKhr(''); } };
    const updateItem = (idx: number, patch: Partial<CartItem>) => { itemsEdited(); setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it)); };
    const removeItem = (idx: number) => { itemsEdited(); setItems(prev => prev.filter((_, i) => i !== idx)); };
    const addItem = () => {
        const p = activeProducts[0];
        if (!p) { showToast(t('ui.orders.ship.noActiveProducts'), 'error'); return; }
        itemsEdited();
        setItems(prev => [...prev, { ...p, quantity: 1 }]);
    };

    return (
        <>
        <Modal isOpen={isOpen} onClose={onClose} title={t('ui.orders.ship.title')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                    {fill(t('ui.orders.ship.intro'), { status: statusText(targetStatus) })}
                </p>
                {/* Who the parcel goes to */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '10px', background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--color-primary-light)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <User size={17} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="d2-khmer" style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {order.customer?.name || '—'}
                        </div>
                        {order.customer?.phone ? (
                            <a href={`tel:${order.customer.phone}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'none', fontVariantNumeric: 'tabular-nums' }}>
                                <Phone size={12} /> {order.customer.phone}
                            </a>
                        ) : (
                            <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>{t('ui.orders.ship.noPhone')}</span>
                        )}
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', flexShrink: 0 }}>#{order.id.slice(-6)}</span>
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>{t('ui.orders.ship.company')} <span style={{ color: 'red' }}>*</span></label>
                    <select
                        value={selectedCompany}
                        onChange={(e) => setSelectedCompany(e.target.value)}
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none'
                        }}
                    >
                        <option value="" disabled>{t('ui.orders.ship.selectCompany')}</option>
                        <option value="អ្នកដឹក" style={{ color: getShippingCoColor('អ្នកដឹក') }}>អ្នកដឹក</option>
                        {shippingCompanies.map(company => (
                            <option key={company} value={company} style={{ color: getShippingCoColor(company) }}>{company}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>{t('orders.remark')}</label>
                    <input
                        type="text"
                        placeholder={t('ui.orders.ship.remarkPlaceholder')}
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
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-main)' }}>{t('orders.address')}</label>
                        <button 
                            onClick={() => setIsShippingPointSelectorOpen(true)}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 12px', cursor: 'pointer', fontWeight: 600, boxShadow: '0 2px 4px rgba(239, 68, 68, 0.2)' }}
                        >
                            <MapPin size={12} /> ជ្រើសរើសទីតាំង
                        </button>
                    </div>
                    <input
                        type="text"
                        placeholder={t('ui.orders.ship.addressPlaceholder')}
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
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>{t('orders.customerCare')}</label>
                    <select
                        value={shippingCustomerCare}
                        onChange={(e) => setShippingCustomerCare(e.target.value)}
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none'
                        }}
                    >
                        <option value="" disabled>{t('ui.orders.ship.selectCc')}</option>
                        {(customerCare || []).map((cc: string) => (
                            <option key={cc} value={cc}>{cc}</option>
                        ))}
                    </select>
                </div>
                {/* What they owe, and what the driver collects on COD */}
                <div style={{ border: '1px solid var(--color-border)', borderRadius: '10px', padding: '12px 14px', background: 'var(--color-bg)' }}>
                    <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse', marginBottom: '10px' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 600, color: 'var(--color-text-secondary)' }}>{t('ui.orders.items.item')}</th>
                                <th style={{ textAlign: 'center', padding: '4px 0', fontWeight: 600, color: 'var(--color-text-secondary)', width: '56px' }}>{t('ui.orders.items.qty')}</th>
                                <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 600, color: 'var(--color-text-secondary)', width: '80px' }}>{t('ui.orders.items.price')}</th>
                                <th style={{ width: '24px' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item, idx) => (
                                <tr key={idx} style={{ borderBottom: '1px dashed var(--color-border)' }}>
                                    <td style={{ padding: '4px 4px 4px 0' }}>
                                        <select
                                            className="d2-khmer"
                                            value={item.id}
                                            onChange={(e) => {
                                                const p = activeProducts.find(p => p.id === e.target.value);
                                                if (p) updateItem(idx, { ...p, quantity: item.quantity });
                                            }}
                                            style={{ width: '100%', padding: '4px', borderRadius: '4px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '13px', outline: 'none' }}
                                        >
                                            {!activeProducts.some(p => p.id === item.id) && (
                                                <option value={item.id}>{item.name}</option>
                                            )}
                                            {activeProducts.map(p => (
                                                <option key={p.id} value={p.id}>{p.name}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td style={{ padding: '4px' }}>
                                        <input
                                            type="number"
                                            min="1"
                                            value={item.quantity}
                                            onChange={(e) => updateItem(idx, { quantity: Math.max(1, parseFloat(e.target.value) || 1) })}
                                            style={{ width: '100%', textAlign: 'center', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '4px', fontSize: '13px', outline: 'none' }}
                                        />
                                    </td>
                                    <td style={{ padding: '4px' }}>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={item.price}
                                            onChange={(e) => updateItem(idx, { price: Math.max(0, parseFloat(e.target.value) || 0) })}
                                            style={{ width: '100%', textAlign: 'right', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '4px', fontSize: '13px', outline: 'none' }}
                                        />
                                    </td>
                                    <td style={{ padding: '4px', textAlign: 'center' }}>
                                        <button onClick={() => removeItem(idx)} title={t('ui.orders.items.remove')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', padding: '2px', display: 'flex' }}>
                                            <X size={14} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <button
                        onClick={addItem}
                        style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px dashed var(--color-border)', background: 'transparent', color: 'var(--color-primary)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', marginBottom: '10px' }}
                    >
                        {t('ui.orders.items.add')}
                    </button>
                    {Math.abs(discount) > 0.005 && (
                        <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', borderTop: '2px solid var(--color-text-main)', paddingTop: '8px' }}>
                                <span>{t('ui.orders.ship.subtotal')}</span>
                                <span>${itemsTotal.toFixed(2)}</span>
                            </div>
                            <div data-shipping-discount style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginTop: '4px', marginBottom: '6px', color: discount > 0 ? '#059669' : '#B45309' }}>
                                <span>{discount > 0 ? t('ui.orders.ship.discount') : t('ui.orders.ship.extraCharge')}</span>
                                <span>{discount > 0 ? '−' : '+'}${Math.abs(discount).toFixed(2)}</span>
                            </div>
                        </>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '14px', borderTop: Math.abs(discount) > 0.005 ? '1px dashed var(--color-border)' : '2px solid var(--color-text-main)', paddingTop: '8px' }}>
                        <span>{t('ui.orders.ship.totalCaps')}</span>
                        <span>${computedTotal.toFixed(2)}</span>
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '13px' }}>
                        <MoneyInput
                            field={depositField}
                            label={t('dashboard2.pay.Deposit')}
                            allowKhr
                            placeholder={depositField.currency === 'KHR' ? t('ui.orders.ship.egKhr') : t('ui.orders.ship.egUsd')}
                            onToggleCurrency={depositCoupling.onToggleCurrency}
                            khrUnavailableReason={depositCoupling.khrUnavailableReason}
                            labelStyle={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-main)' }}
                            inputStyle={{ width: '100%', padding: '6px 8px', borderRadius: '6px', fontSize: '13px', border: '1px dashed var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-main)', boxSizing: 'border-box', textAlign: 'right' }}
                        />
                    </div>
                    {depositBooks && paymentAccounts.length > 0 && (
                        <div style={{ marginTop: '8px', fontSize: '13px' }}>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-main)' }}>{t('ui.orders.ship.depositedInto')} *</label>
                            <select
                                value={depositAccountId}
                                onChange={e => depositCoupling.onAccountChange(e.target.value)}
                                style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', fontSize: '13px', border: `1px solid ${!depositAccountId ? '#DC2626' : 'var(--color-border)'}`, background: 'var(--color-surface)', color: 'var(--color-text-main)', outline: 'none' }}
                            >
                                <option value="">{t('ui.orders.ship.bankOrCash')}</option>
                                <CashBankOptions accounts={paymentAccounts} />
                            </select>
                        </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '14px', marginTop: '6px', borderTop: '1px dashed var(--color-border)', paddingTop: '6px' }}>
                        <span>{t('ui.orders.ship.remainingUsd')}</span>
                        <span data-remaining-usd>${remainingAmount.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 700, fontSize: '13px', marginTop: '6px' }}>
                        <span>{depositNum > 0 ? t('ui.orders.ship.remainingKhr') : t('ui.orders.ship.totalKhr')}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                                type="number"
                                value={displayKhr}
                                onChange={(e) => { setCustomKhr(e.target.value); setKhrEdited(true); }}
                                style={{ width: '90px', textAlign: 'right', border: '1px dashed var(--color-border)', borderRadius: '4px', padding: '2px 4px', fontSize: '13px', fontWeight: 700, outline: 'none' }}
                                onClick={(e) => (e.target as HTMLInputElement).select()}
                            />
                            <span>៛</span>
                        </div>
                    </div>
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
                        {t('common.cancel')}
                    </button>
                    <button
                        onClick={async () => {
                            if (!selectedCompany) {
                                showToast(t('ui.orders.ship.pickCompany'), 'error');
                                return;
                            }
                            if (items.length === 0) {
                                showToast(t('ui.orders.ship.needItem'), 'error');
                                return;
                            }
                            // One save at a time: a second click while the first is still
                            // running is ignored (the ref answers at once; the state
                            // disables the button).
                            if (savingRef.current) return;
                            if (depositBooks && paymentAccounts.length > 0 && !depositAccountId) {
                                showToast(t('ui.orders.ship.pickDepositAccount'), 'error');
                                return;
                            }
                            // Only a changed deposit is checked (an old one was already accepted).
                            if (depositChanged && !depositField.confirmIfSuspicious()) return;
                            // A riel figure far from the items (a typo like 4100 for
                            // 41000) would rewrite the total: ask first.
                            if (khrSetsMoney && totalChanged && Math.abs(discount) > Math.max(0.5, itemsTotal * 0.1)
                                && !window.confirm(fill(t('ui.orders.ship.confirmKhr'), {
                                    label: depositNum > 0 ? t('ui.orders.ship.remaining') : t('ui.orders.ship.total'),
                                    khr: Math.round(typedKhr).toLocaleString(), rate: rate.toLocaleString(), usd: remainingAmount.toFixed(2),
                                    from: (Number(order.total) || 0).toFixed(2), to: computedTotal.toFixed(2),
                                    kind: discount > 0 ? t('ui.orders.ship.discountLower') : t('ui.orders.ship.extraChargeLower'),
                                    diff: Math.abs(discount).toFixed(2), items: itemsTotal.toFixed(2),
                                }))) return;
                            savingRef.current = true;
                            setSaving(true);
                            try {
                                const updates: Partial<Sale> = {};
                                if (shippingRemark !== (order.remark || '')) updates.remark = shippingRemark;
                                if (shippingCustomerCare !== (order.customerCare || '')) updates.customerCare = shippingCustomerCare;
                                if (shippingAddress !== (order.customer?.address || '')) {
                                    updates.customer = { ...order.customer, address: shippingAddress } as any;
                                }
                                const itemsChanged = JSON.stringify(items) !== JSON.stringify(order.items || []);
                                if (itemsChanged) updates.items = items;
                                // The total is rewritten only when this opening changed it
                                // (items edited, or the riel typed on an unpaid order), so
                                // an older order whose total never matched its items is
                                // left as it was.
                                if (itemsChanged || (khrSetsMoney && totalChanged)) {
                                    updates.total = computedTotal;
                                    if (Math.abs(discount - savedDiscount) > 0.005) updates.discount = discount;
                                }
                                let money: MoneyMeta | undefined;
                                if (depositChanged) {
                                    updates.depositAmount = depositNum;
                                    if (depositNum > 0) updates.depositDate = new Date().toISOString().split('T')[0];
                                    // A deposit typed here is money received, the same as in
                                    // the Deposit modal: route it through the Deposit flow so
                                    // it is booked as income (កក់ប្រាក់) with its Draft DEP
                                    // ledger entry — a bare number in the deposit column left
                                    // revenue short by the deposit. Not for a paid order (its
                                    // money is already booked; only the column is corrected).
                                    if (depositNum > 0 && !['Paid', 'Settled', 'Paid/Settled'].includes(order.paymentStatus || '')) {
                                        updates.paymentStatus = 'Deposit';
                                        updates.expectedPaymentStatus = order.paymentStatus;
                                        updates.amountReceived = depositNum;
                                        updates.postToLedger = true;
                                        // The account only (no name): the name would become the
                                        // row's Pay By ("one bank shown as two", PR #229).
                                        if (depositAccountId) updates.depositAccountId = depositAccountId;
                                        // A top-up books only the difference over the deposit
                                        // already taken, so its riel is the difference too. A
                                        // LOWERED deposit corrects the deposit row itself, so it
                                        // carries the whole riel figure as typed.
                                        const prevUsd = order.depositAmount && order.depositAmount > 0 ? order.depositAmount : 0;
                                        money = depositField.meta.currency === 'KHR' && prevUsd > 0 && depositNum > prevUsd
                                            ? khrMeta(Math.max(0, depositField.meta.original_amount - usdToKhr(prevUsd, depositField.meta.exchange_rate, 1)), depositField.meta.exchange_rate)
                                            : depositField.meta;
                                    }
                                }
                                // '' means "no override, keep computing it live" — that's the
                                // same as an unset existing value, so only a real change (either
                                // a new figure, or clearing one that was set) needs saving.
                                const newKhr = customKhr !== '' ? Number(customKhr) : null;
                                const existingKhr = order.customKhrAmount ?? null;
                                if (newKhr !== existingKhr) {
                                    updates.customKhrAmount = newKhr as any;
                                }

                                // An edit that didn't fully save (already explained) must not
                                // go on to ship the order with the old items.
                                if (Object.keys(updates).length > 0 && !(await updateOrder(order.id, updates, money ? { money: { ...money, category: 'កក់ប្រាក់' } } : undefined))) return;
                                // false: refused or changed elsewhere, nothing moved (already explained).
                                // shownStatus: the status the popup was opened from — if the
                                // order has moved on since (shipped from another device), the
                                // change is refused instead of being applied on top of it.
                                const moved = await updateOrderStatus(order.id, targetStatus, order.shipping?.trackingNumber, selectedCompany, { shownStatus: order.shipping?.status || 'Pending' });
                                if (moved) showToast(targetStatus === 'Shipped' ? t('ui.orders.ship.markedShipped') : t('ui.orders.ship.markedConfirmed'), 'success');
                            } catch (e: any) {
                                console.error('Failed to update shipping status:', e);
                                showToast(t('ui.orders.toast.updateFailed'), 'error');
                            } finally {
                                savingRef.current = false;
                                setSaving(false);
                                onClose();
                            }
                        }}
                        disabled={saving || !selectedCompany || items.length === 0}
                        className="primary-button"
                        style={{
                            padding: '10px 16px', borderRadius: '8px', border: 'none',
                            background: (!saving && selectedCompany && items.length > 0) ? 'var(--color-primary)' : 'var(--color-border)',
                            color: 'white', cursor: (!saving && selectedCompany && items.length > 0) ? 'pointer' : 'not-allowed',
                            fontSize: '14px', fontWeight: 600
                        }}
                    >
                        {saving ? t('ui.orders.saving') : t('common.save')}
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

// Asked right after an order moved to Returned or Cancelled: why. Picks
// from Sales Setup › Rejection Reasons, or "Other" with free text; Skip
// leaves the order without one (it can be set later in the Reason column).
// Saves only sales.return_reason — the status change is already done.
const ReturnReasonModalComponent: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    order: Sale | null;
    status: string;
}> = ({ isOpen, onClose, order, status }) => {
    const { updateOrder, rejectionReasons } = useStore();
    const { showToast } = useToast();
    const { t } = useLanguage();
    const [choice, setChoice] = useState('');
    const [other, setOther] = useState('');
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);

    useEffect(() => {
        if (isOpen && order) {
            const cur = (order.returnReason || '').trim();
            const listed = rejectionReasons.find(r => r.trim().toLowerCase() === cur.toLowerCase());
            setChoice(cur ? (listed ?? OTHER_REASON) : '');
            setOther(cur && !listed ? cur : '');
        }
        // Only when it opens (or for another order): a list or order reload
        // must not reset what is being picked.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, order?.id]);

    if (!order) return null;
    const reason = choice === OTHER_REASON ? other.trim() : choice;
    const save = async () => {
        if (savingRef.current || !reason) return;
        savingRef.current = true;
        setSaving(true);
        try {
            // Always written: the copy here may be stale or optimistic.
            if (!(await updateOrder(order.id, { returnReason: reason }))) return;
            showToast(t('ui.orders.returnReason.saved'), 'success');
            onClose();
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };
    const chip = (active: boolean): React.CSSProperties => ({
        padding: '8px 12px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', textAlign: 'left',
        border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
        background: active ? 'var(--color-primary-light, rgba(59,130,246,0.1))' : 'var(--color-surface)',
        color: 'var(--color-text-main)', fontWeight: active ? 600 : 400,
    });
    const options = [...rejectionReasons, OTHER_REASON];

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('ui.orders.returnReason.title')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                    {fill(t('ui.orders.returnReason.intro'), { status: status === 'Cancelled' ? t('status.cancelled') : status === 'ReStock' ? t('status.restock') : t('status.returned') })}
                </p>
                <div role="group" aria-label={t('ui.orders.returnReason.title')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px' }}>
                    {options.map(r => (
                        <button key={r} type="button" aria-pressed={choice === r} onClick={() => setChoice(r)} style={chip(choice === r)}>
                            {r === OTHER_REASON ? t('ui.orders.returnReason.other') : r}
                        </button>
                    ))}
                </div>
                {choice === OTHER_REASON && (
                    <input type="text" autoFocus value={other} onChange={e => setOther(e.target.value)} maxLength={200}
                        placeholder={t('ui.orders.returnReason.otherPlaceholder')} aria-label={t('ui.orders.returnReason.other')}
                        onKeyDown={e => { if (e.key === 'Enter') save(); }}
                        style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px', outline: 'none' }} />
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '4px' }}>
                    <button onClick={onClose} disabled={saving}
                        style={{ padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-main)', cursor: 'pointer', fontSize: '14px', fontWeight: 500 }}>
                        {t('ui.orders.returnReason.skip')}
                    </button>
                    <button onClick={save} disabled={saving || !reason}
                        style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: 'var(--color-primary)', color: 'white', cursor: saving || !reason ? 'not-allowed' : 'pointer', opacity: saving || !reason ? 0.6 : 1, fontSize: '14px', fontWeight: 500 }}>
                        {saving ? t('ui.orders.returnReason.saving') : t('common.save')}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

const PendingRemarkModalComponent: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    order: Sale | null;
}> = ({ isOpen, onClose, order }) => {
    const { updateOrder, updateOrderStatus } = useStore();
    const { showToast } = useToast();
    const { t } = useLanguage();

    const [remark, setRemark] = useState<string>('');
    // Same in-flight guard as the ship popup: one save at a time.
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);

    useEffect(() => {
        if (isOpen && order) {
            setRemark(order.remark || '');
        }
    }, [isOpen, order]);

    if (!order) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('ui.orders.pendingRemark.title')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                    {t('ui.orders.pendingRemark.intro')}
                </p>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>{t('orders.remark')}</label>
                    <input
                        type="text"
                        placeholder={t('ui.orders.pendingRemark.placeholder')}
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
                        {t('common.cancel')}
                    </button>
                    <button
                        onClick={async () => {
                            if (savingRef.current) return;
                            savingRef.current = true;
                            setSaving(true);
                            try {
                                if (remark !== (order.remark || '')) {
                                    await updateOrder(order.id, { remark });
                                }
                                // false: refused or changed elsewhere (already explained).
                                const moved = await updateOrderStatus(order.id, 'Pending', undefined, undefined, { shownStatus: order.shipping?.status || 'Pending' });
                                if (moved) showToast(t('ui.orders.pendingRemark.marked'), 'success');
                            } catch (e: any) {
                                console.error('Failed to update pending status:', e);
                                showToast(t('ui.orders.toast.updateFailed'), 'error');
                            } finally {
                                savingRef.current = false;
                                setSaving(false);
                                onClose();
                            }
                        }}
                        disabled={saving}
                        className="primary-button"
                        style={{
                            padding: '10px 16px', borderRadius: '8px', border: 'none',
                            background: saving ? 'var(--color-border)' : 'var(--color-primary)',
                            color: 'white', cursor: saving ? 'not-allowed' : 'pointer',
                            fontSize: '14px', fontWeight: 500
                        }}
                    >
                        {t('common.confirm')}
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
// Pay Status filter options (toolbar dropdown + mobile drawer). Mirrors
// PaymentStatusBadge's own options list — kept separate since this list drives
// filtering, not the badge/dropdown itself.
const PAY_STATUS_FILTER_OPTIONS = ['Unpaid', 'Deposit', 'Get File', 'Paid', 'PdFee', 'Cancel'];

// Mirrors the rule enforced in StoreContext: 'Delivered' and 'Returned' only make sense
// once the goods have shipped. Checked here too so the UI doesn't open a payment or
// remark modal for a transition the store will reject.
const POST_DISPATCH_STATUSES = ['Delivered', 'Returned'];
// Only 'Shipped' may lead here. Delivered and Returned are terminal — re-selecting either
// would re-open the payment flow and re-run accounting on an order that is already settled.
const canEnterPostDispatch = (order: Sale, target?: string) => {
    const cur = order.shipping?.status || 'Pending';
    // Returned and Delivered are also allowed from each other: real post-delivery
    // returns, and the correction path when either was selected by mistake. Stock is
    // counted out in both states, so the flip is stock-neutral.
    return cur === 'Shipped' ||
        (target === 'Returned' && cur === 'Delivered') ||
        (target === 'Delivered' && cur === 'Returned');
};

// Always-visible chip group for the mobile filter drawer (no hidden dropdowns).
const DrawerChipGroup: React.FC<{ title: string; options: string[]; selected: string[]; onToggle: (v: string) => void; optionLabel?: (v: string) => string }> = ({ title, options, selected, onToggle, optionLabel = orderStatusLabel }) => (
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
                        {optionLabel(opt)}
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
    const { t: tr } = useLanguage();
    const [draft, setDraft] = useState(value);
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
    const WIDTH = 240;

    // Layout effect: positioned before the first paint, so no flash at (0,0).
    useLayoutEffect(() => {
        const update = () => {
            if (!anchor) return;
            // Screen px -> the zoomed body's px (see utils/bodyZoom.ts).
            const z = bodyZoom();
            const r = anchor.getBoundingClientRect();
            setPos({
                top: r.bottom / z + 6,
                left: Math.max(8, Math.min(r.left / z, window.innerWidth / z - WIDTH - 8))
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
                padding: '12px', background: 'var(--color-surface)', boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
                borderRadius: '10px', border: '1px solid var(--color-border)',
                display: 'flex', flexDirection: 'column', gap: '8px'
            }}
        >
            {isDate ? (
                <>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', width: '38px', color: 'var(--color-text-secondary)' }}>{tr('ui.orders.filter.from')}</span>
                        <input type="date" value={start} onChange={(e) => setRange(e.target.value, end)} className="search-input" style={inputStyle} />
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', width: '38px', color: 'var(--color-text-secondary)' }}>{tr('ui.orders.filter.to')}</span>
                        <input type="date" value={end} onChange={(e) => setRange(start, e.target.value)} className="search-input" style={inputStyle} />
                    </div>
                </>
            ) : (
                <input
                    type="text"
                    autoFocus
                    placeholder={fill(tr('ui.orders.filter.placeholder'), { label })}
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
                    <X size={14} /> {tr('ui.orders.filter.clear')}
                </button>
                <button
                    onClick={commit}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 500 }}
                >
                    <Check size={14} /> {tr('common.apply')}
                </button>
            </div>
        </div>,
        document.body
    );
};

const postDispatchMessage = (current: string, target: string) =>
    ['Delivered', 'Returned'].includes(current)
        ? tNow('ui.orders.msg.alreadyPostDispatch', { current: statusText(current), target: statusText(target) })
        : tNow('ui.orders.msg.shipFirst', { target: statusText(target) });

// orderBalance / REVENUE_STATUSES / isRevenueOrder / orderRevenue /
// orderCollected / orderRevenuePieces now live in ../utils/orderMoney — the
// one shared definition used here, on mobile, and by Dashboard 2 (see that
// module's header comment for why the desktop and mobile footers used to
// disagree).

// ReStock orders stay editable (fixing details after a restock is a real
// need); only Cancelled and Returned remain locked.
// A sale's page is page_source, FALLING BACK to the customer snapshot's page
// — the same rule the dashboards group by (and mapper.ts maps by). Filtering
// on page_source alone hid every order whose page only lives in the snapshot
// (old orders predating the column), so a dashboard page card could open a
// list missing rows or empty. PAGE_UNKNOWN (utils/orderListFilters.ts) is the
// dashboards' bucket for orders with neither.
const pageOrFilter = (pages: string[]): string => {
    const noSource = 'page_source.is.null,page_source.eq.""';
    const noSnapshot = 'customer_snapshot->>page.is.null,customer_snapshot->>page.eq.""';
    return pages.flatMap(p => {
        if (p === PAGE_UNKNOWN) return [`and(or(${noSource}),or(${noSnapshot}))`];
        const v = `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        return [`page_source.eq.${v}`, `and(or(${noSource}),customer_snapshot->>page.eq.${v})`];
    }).join(',');
};

const LOCKED_ORDER_STATUSES = ['Cancelled', 'Returned'];
const isOrderLocked = (order: Sale) => LOCKED_ORDER_STATUSES.includes(order.shipping?.status || '');
const lockedOrderMessage = (order: Sale) =>
    tNow('ui.orders.msg.locked', { status: statusText(order.shipping?.status || '') });

// The income category each kind of order payment is booked under.
const PAID_CATEGORY: Record<PaymentKind, string> = { Paid: 'លក់រាយ', Deposit: 'កក់ប្រាក់', PdFee: 'ថ្លៃដឹក' };
type PaymentKind = 'Paid' | 'Deposit' | 'PdFee';

// How an order's payment of this kind was received, from its income rows:
// dollars, or riel at its rate (the riel summed over the rows, e.g. a
// deposit and its top-up taken at the same rate). undefined when that can't
// be told: no row, rows that don't add up to the dollars booked (an older
// row not linked to the order, a duplicate), rows in both currencies or at
// different rates, or a store without the currency columns. The form then
// opens as it always did.
async function paidMoneyOf(orderId: string, kind: PaymentKind, bookedUsd: number): Promise<PaidMoney | undefined> {
    try {
        const { data, error } = await supabase.from('transactions')
            .select('amount, currency, original_amount, exchange_rate')
            .eq('order_id', orderId).eq('type', 'Income').eq('category', PAID_CATEGORY[kind]);
        if (error || !data || data.length === 0) return undefined;
        if (Math.abs(data.reduce((s, r) => s + (Number(r.amount) || 0), 0) - bookedUsd) > 0.005) return undefined;
        if (data.every(r => r.currency !== 'KHR')) return { currency: 'USD' };
        const rate = Number(data[0].exchange_rate);
        if (!data.every(r => isKhrRow(r) && Number(r.exchange_rate) === rate)) return undefined;
        return { currency: 'KHR', original_amount: data.reduce((s, r) => s + Number(r.original_amount), 0), exchange_rate: rate };
    } catch {
        return undefined;
    }
}

const Orders: React.FC = () => {
    console.log('Orders render');
    // (Move refs below state declarations)
    const { sales, updateOrderStatus, updateOrder, updateOrders, deleteOrders, editingOrder, setEditingOrder, pinnedOrderColumns, importOrders, bulkRestockOrders, hasPermission, users, shippingCompanies, pages, refreshData, currentUser, salesUpdatedAt, loadMoreOrders, hasMoreOrders, isLoadingMore, blockedCustomers, addBlockedCustomer, addBlockedCustomers, removeBlockedCustomer, removeBlockedCustomers, addOnlineOrder, trackingUrlTemplates, codPaymentMethods, rejectionReasons, courierDeliveryTypes, customerGroups, customerGroupMembers, setCustomerGroup } = useStore();
    const { t } = useLanguage();
    // Carrier tracking: cached statuses for the rows on screen + on-demand lookups.
    const { trackingMap, isTracking, loadCached, trackOrders } = useShipmentTracking();
    // The fetched page of orders (declared early: the header effect below lists
    // it as a dependency for the Track Shipped button).
    const [serverOrders, setServerOrders] = useState<Sale[]>([]);
    const [isDuplicating, setIsDuplicating] = useState(false);

    const filterShippingCompanies = useMemo(() => {
        return ['អ្នកដឹក', ...shippingCompanies];
    }, [shippingCompanies]);

    const isAdmin = currentUser?.roleId === 'admin';
    const canEdit = hasPermission('manage_orders');
    // A Salesman's deposit/payment waits on the order (gray) until one of
    // these confirms it was received; a Salesman can't book money here.
    const canConfirmPayments = ['admin', 'customer_care', 'accountant'].includes(currentUser?.roleId || '');
    const isSalesmanUser = currentUser?.roleId === 'salesman';
    const canManage = hasPermission('manage_orders');
    // Grantable per role in Roles & Permissions (admins always pass).
    const canUseCheckbox = hasPermission('use_checkbox');
    const canRestock = hasPermission('restock_orders');

    // A claim is open for confirming while nothing is booked on the order and
    // its goods haven't come back (Drafted is fine: a Salesman's new orders are
    // Drafted). Then only the confirmers may act, and only on the claim:
    // Deposit/Paid confirm it, Unpaid removes it; the other statuses stay
    // admin-only as before.
    const claimOpen = (order: Sale) => !!order.paymentClaim && (order.paymentStatus || 'Unpaid') === 'Unpaid'
        && (isAdmin || !['ReStock', 'Returned', 'Cancelled'].includes(order.shipping?.status || ''));
    const claimDisabledOptions = (order: Sale): string[] => isAdmin ? [] : [
        'Cancel',
        // Get File / PdFee move the shipping status: still admin-only on the
        // orders where the badge was locked before (a Salesman's new orders
        // are Drafted).
        ...(['Drafted', 'ReStock', 'Returned', 'Cancelled'].includes(order.shipping?.status || '') ? ['Get File', 'PdFee'] : []),
    ];
    // A Salesman books no money here (PdFee books the delivery fee).
    const salesmanDisabled = isSalesmanUser ? ['Deposit', 'Paid', 'PdFee'] : [];

    // What the gray Pay Status says on hover.
    const claimTooltip = (c: NonNullable<Sale['paymentClaim']>) =>
        fill(t('ui.orders.claim.tipHead'), { status: payText(c.status), amount: Number(c.amount || 0).toFixed(2) })
        + (c.currency === 'KHR' && c.original_amount ? ` (៛${Math.round(c.original_amount).toLocaleString()})` : '')
        + `${c.method ? fill(t('ui.orders.claim.tipBy'), { method: c.method }) : ''}${fill(t('ui.orders.claim.tipEntered'), { by: c.by || t('ui.orders.claim.aSalesman') })}${c.date ? fill(t('ui.orders.claim.tipOn'), { date: c.date }) : ''}`
        + fill(t('ui.orders.claim.tipTail'), { status: payText(c.status) });

    // Picking Unpaid on an order with an unconfirmed payment removes the claim
    // (nothing was booked, so nothing else changes). True = handled here.
    const rejectClaimIfUnpaid = (order: Sale, newStatus: string): boolean => {
        if (!claimOpen(order) || newStatus !== 'Unpaid') return false;
        const c = order.paymentClaim!;
        const claimStatus = payText(c.status) === c.status ? c.status.toLowerCase() : payText(c.status);
        if (window.confirm(fill(t('ui.orders.claim.confirmRemove'), { status: claimStatus, amount: Number(c.amount || 0).toFixed(2), by: c.by || t('ui.orders.claim.theSalesman') }))) {
            updateOrder(order.id, { paymentClaim: null });
        }
        return true;
    };

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
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>{t('orders.title')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>{t('orders.subtitle')}</p>
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
                            <List size={18} /> {t('orders.orderList')}
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
                            <MapPin size={18} /> {t('ui.orders.header.shippingPoints')}
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
                            <Wallet size={18} /> {t('ui.orders.header.checkIncome')}
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
                            <Table2 size={18} /> {t('ui.orders.header.showMovement')}
                        </button>
                    )}
                    {isAdmin && !isMobile && (
                        <button
                            onClick={() => setIsCheckStockOpen(true)}
                            style={{
                                padding: '8px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', flex: isMobile ? 1 : 'initial',
                                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                                color: 'white',
                                fontWeight: 600, cursor: 'pointer', border: 'none',
                                boxShadow: '0 2px 8px rgba(245, 158, 11, 0.3)',
                                transition: 'all 0.2s ease',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(245, 158, 11, 0.4)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(245, 158, 11, 0.3)'; }}
                        >
                            <Boxes size={18} /> {t('ui.orders.header.checkStock')}
                        </button>
                    )}
                    {/* Carrier tracking: check the shipped rows on screen with a
                        supported carrier (J&T), skipping delivered / recently checked. */}
                    {!isMobile && serverOrders.some(o => o.shipping?.status === 'Shipped' && o.shipping?.trackingNumber && canAutoTrack(o.shipping?.company)) && (
                        <button
                            disabled={isTracking}
                            onClick={async () => {
                                const result = await trackOrders(serverOrders, { maxAgeMinutes: 15 });
                                if (result.error) showToast(result.error, 'error');
                                else if (result.checked === 0) showToast(t('ui.orders.track.nothing'), 'info');
                                else showToast(fill(t('ui.orders.track.checked'), { n: result.checked, delivered: result.delivered }) + (result.failed ? fill(t('ui.orders.track.failed'), { n: result.failed }) : ''), result.failed && !result.updated ? 'error' : 'success');
                            }}
                            title={t('ui.orders.track.tooltip')}
                            style={{
                                padding: '8px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center',
                                background: isTracking ? '#9CA3AF' : 'linear-gradient(135deg, #059669, #047857)',
                                color: 'white', fontWeight: 600, cursor: isTracking ? 'wait' : 'pointer', border: 'none',
                                boxShadow: '0 2px 8px rgba(5, 150, 105, 0.3)', transition: 'all 0.2s ease',
                            }}
                        >
                            <Truck size={18} /> {isTracking ? t('ui.orders.track.checking') : t('ui.orders.track.button')}
                        </button>
                    )}

                </div>
            )
        });

        return () => setHeaderContent(null);
    // serverOrders/isTracking/trackOrders/showToast feed the Track Shipped
    // button rendered inside this header — without them the button would act on
    // a stale page of orders and never show its busy state.
    }, [setHeaderContent, activeTab, hasPermission, isMobile, isAdmin, canManage, navigate, serverOrders, isTracking, trackOrders, showToast, t]); // Added dependencies

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

    // True while a dashboard click-through (location.state.filters) is being
    // applied: those values are a TRANSIENT view of one subset, so the persist
    // effect below skips them — otherwise a single card click permanently
    // overwrites the filters the user set up themselves. Cleared by the
    // click-through effect's follow-up run (after the state is consumed),
    // which is declared after the persist effect and so runs last.
    const skipFilterPersistRef = useRef(false);
    // (All filters persist together in one effect further down, after every
    // filter state is declared.)

    const [showFilters, setShowFilters] = useState(false);

    // Shipping Modal State
    const [isShippingModalOpen, setIsShippingModalOpen] = useState(false);
    const [shippingOrderToUpdate, setShippingOrderToUpdate] = useState<Sale | null>(null);
    const [shippingTargetStatus, setShippingTargetStatus] = useState<'Confirmed' | 'Shipped'>('Shipped');
    const [isShippingPointModalOpen, setIsShippingPointModalOpen] = useState(false);
    // "Show Movement" opens the shared stock recap popup (defaults to today).
    const [isMovementSummaryOpen, setIsMovementSummaryOpen] = useState(false);
    // "Check Stock" opens a live stock-on-hand lookup (CheckStockModal).
    const [isCheckStockOpen, setIsCheckStockOpen] = useState(false);
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

    // (Filters persist in the single effect below the pageFilter declaration.)

    const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'date', direction: 'desc' });

    // Modals State
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [showTools, setShowTools] = useState(false);
    // editingOrder is from store

    const handleImportOrders = async (data: any[]) => {
        try {
            await importOrders(data);
            setIsImportModalOpen(false);
            showToast(t('ui.orders.toast.imported'), 'success');
            await fetchOrders();
        } catch (error: any) {
            console.error("Import failed:", error);
            showToast(fill(t('ui.orders.toast.importFailed'), { error: error.message || error }), 'error');
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
        if (confirm(fill(t('ui.orders.bulk.confirmDelete'), { n: selectedIds.size }))) {
            try {
                await deleteOrders(Array.from(selectedIds));
                setSelectedIds(new Set());
                showToast(t('ui.orders.toast.deleted'), 'success');
                await fetchOrders();
            } catch (error: any) {
                console.error('Failed to delete orders:', error);
                showToast(t('ui.orders.toast.deleteFailed') + (error.message || t('ui.orders.toast.unknownError')), 'error');
            }
        }
    };

    const handleBulkRestock = async (e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (!canRestock) {
            showToast(t('ui.orders.toast.noRestockPermission'), 'error');
            return;
        }
        if (confirm(fill(t('ui.orders.bulk.confirmRestock'), { n: selectedIds.size }))) {
            try {
                const requested = selectedIds.size;
                const restocked = await bulkRestockOrders(Array.from(selectedIds));
                setSelectedIds(new Set());
                showToast(restockResultMessage(restocked, requested), restocked > 0 ? 'success' : 'error');
                await fetchOrders();
            } catch (error: any) {
                console.error('Failed to restock orders:', error);
                showToast(t('ui.orders.toast.restockFailed') + (error.message || t('ui.orders.toast.unknownError')), 'error');
            }
        }
    };

    // Column Visibility and Pinning
    const [showColumnMenu, setShowColumnMenu] = useState(false);
    const allColumnsDef = [
        { id: 'actions', label: t('orders.actions') },
        { id: 'date', label: t('orders.date') },
        { id: 'customer', label: t('orders.customer') },
        { id: 'phone', label: t('orders.phone') },
        { id: 'customerGroup', label: t('ui.orders.customerGroup.column') },
        { id: 'address', label: t('orders.address') },
        { id: 'page', label: t('orders.pageName') },
        { id: 'salesman', label: t('orders.salesman') },
        { id: 'customerCare', label: t('orders.customerCare') },
        { id: 'items', label: t('orders.products') },
        { id: 'total', label: t('orders.total') },
        { id: 'payBy', label: t('orders.payBy') },
        { id: 'balance', label: t('ui.orders.columns.pendingBalance') },
        { id: 'status', label: t('orders.orderStatus') },
        { id: 'received', label: t('orders.received') },
        { id: 'payStatus', label: t('orders.payStatus') },
        { id: 'shippingCo', label: t('orders.shippingCo') },
        { id: 'deliveryType', label: t('ui.orders.deliveryType.column') },
        { id: 'remark', label: t('orders.remark') },
        { id: 'returnReason', label: t('ui.orders.returnReason.column') },
        { id: 'tracking', label: t('orders.trackingId') },
        { id: 'settleDate', label: t('orders.settledPaidDate') },
        { id: 'lastEdit', label: t('orders.lastEdit') },
    ];

    // Default visible columns
    const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
        const saved = localStorage.getItem('orders_visibleColumns');
        if (saved) {
            try {
                const cols: string[] = JSON.parse(saved);
                // The Reason column is new: shown once (after Remark) on a
                // saved layout; hiding it afterwards sticks.
                try {
                    // Same for Delivery type (after Shipping Co).
                    if (!localStorage.getItem('orders_deliveryTypeColAdded')) {
                        localStorage.setItem('orders_deliveryTypeColAdded', '1');
                        if (Array.isArray(cols) && !cols.includes('deliveryType')) {
                            const at = cols.indexOf('shippingCo');
                            cols.splice(at >= 0 ? at + 1 : cols.length, 0, 'deliveryType');
                        }
                    }
                    if (!localStorage.getItem('orders_returnReasonColAdded')) {
                        localStorage.setItem('orders_returnReasonColAdded', '1');
                        if (Array.isArray(cols) && !cols.includes('returnReason')) {
                            const at = cols.indexOf('remark');
                            cols.splice(at >= 0 ? at + 1 : cols.length, 0, 'returnReason');
                        }
                    }
                } catch { /* storage blocked: keep the saved layout */ }
                return cols;
            } catch (e) {
                console.error('Failed to parse visible columns:', e);
            }
        }
        // The defaults already hold the newer columns: their one-time adds
        // are done (hiding one later then sticks).
        try {
            localStorage.setItem('orders_deliveryTypeColAdded', '1');
            localStorage.setItem('orders_returnReasonColAdded', '1');
        } catch { /* storage blocked */ }
        return [
            'actions', 'date', 'customer', 'phone', 'address', 'page', 'salesman', 'customerCare', 'items', 'total', 'payBy',
            'balance', 'status', 'received', 'payStatus', 'shippingCo', 'deliveryType', 'remark', 'returnReason', 'tracking', 'settleDate', 'lastEdit'
        ];
    });

    // Persist Visible Columns
    useEffect(() => {
        localStorage.setItem('orders_visibleColumns', JSON.stringify(visibleColumns));
    }, [visibleColumns]);

    // Customer group: shown once (after Phone) when the store has groups —
    // not before, so a store that doesn't use them gets no empty column.
    // Hiding it afterwards sticks.
    useEffect(() => {
        if (customerGroups.length === 0) return;
        try {
            if (localStorage.getItem('orders_customerGroupColAdded')) return;
            localStorage.setItem('orders_customerGroupColAdded', '1');
        } catch { return; }
        setVisibleColumns(cols => {
            if (cols.includes('customerGroup')) return cols;
            const next = [...cols];
            const at = next.indexOf('phone');
            next.splice(at >= 0 ? at + 1 : next.length, 0, 'customerGroup');
            return next;
        });
    }, [customerGroups.length]);

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
        // t: the labels follow a language switch.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pinnedOrderColumns, t]);


    // Resizing State
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
        const saved = localStorage.getItem('pos_column_widths');
        const widths: Record<string, number> = saved ? JSON.parse(saved) : {};
        for (const [colId, min] of Object.entries(COLUMN_MIN_WIDTH)) {
            if (typeof widths[colId] === 'number' && widths[colId] < min) widths[colId] = min;
        }
        return widths;
    });

    useEffect(() => {
        localStorage.setItem('pos_column_widths', JSON.stringify(columnWidths));
    }, [columnWidths]);
    const resizeRef = React.useRef<{ startX: number; startWidth: number; colId: string; live?: LiveResize } | null>(null);

    const startResize = (e: React.MouseEvent, colId: string) => {
        e.preventDefault();
        e.stopPropagation();
        const currentWidth = columnWidths[colId] || (e.currentTarget.parentElement?.getBoundingClientRect().width ?? 150);
        resizeRef.current = { startX: e.clientX, startWidth: currentWidth, colId, live: beginLiveResize(e.currentTarget as Element) };
        document.addEventListener('mousemove', handleGlobalMouseMove);
        document.addEventListener('mouseup', handleGlobalMouseUp);
        document.body.style.cursor = 'col-resize';
    };

    const handleGlobalMouseMove = React.useCallback((e: MouseEvent) => {
        if (!resizeRef.current) return;
        const { startX, startWidth, colId, live } = resizeRef.current;
        const newWidth = Math.max(columnMinWidth(colId, 50), startWidth + liveDelta(live, e.clientX - startX));
        // Straight onto the header cell, once per frame (no re-render, and no
        // page-wide CSS variable restyling every row): utils/liveColumnResize.
        showLiveWidth(live, newWidth);
    }, []);

    const handleGlobalMouseUp = React.useCallback((e: MouseEvent) => {
        if (!resizeRef.current) return;
        const { startX, startWidth, colId, live } = resizeRef.current;
        const newWidth = Math.round(Math.max(columnMinWidth(colId, 50), startWidth + liveDelta(live, e.clientX - startX)));
        endLiveResize(live, newWidth);

        // Save to state/localStorage only on mouse up
        // Saving re-renders every row: a background update, so release doesn't freeze the page.
        startTransition(() => setColumnWidths(prev => ({ ...prev, [colId]: newWidth })));


        resizeRef.current = null;
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
        const finalWidth = Math.min(Math.max(maxWidth, columnMinWidth(colId, 40)), 600);

        if (resizeRef.current && resizeRef.current.colId === colId) {
            document.documentElement.style.removeProperty(`--col-${colId}-width`);
            endLiveResize(resizeRef.current.live, finalWidth);
            resizeRef.current = null;
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

            newWidths[col.id] = Math.min(Math.max(maxWidth, columnMinWidth(col.id, 40)), 600);
        });

        document.body.removeChild(measurer);
        setColumnWidths(newWidths);
    };

    // fetchOrders reports a missing column without re-running on a toast change.
    const showToastRef = useRef(showToast);
    showToastRef.current = showToast;

    // Rejection reason asked after a move to Returned / Cancelled.
    const [reasonTarget, setReasonTarget] = useState<{ order: Sale; status: string } | null>(null);

    // Pending Modal State
    const [isPendingRemarkModalOpen, setIsPendingRemarkModalOpen] = useState(false);
    const [pendingOrderToUpdate, setPendingOrderToUpdate] = useState<Sale | null>(null);

    // Select Payment Method Modal State
    const [isPaymentMethodModalOpen, setIsPaymentMethodModalOpen] = useState(false);
    const [paymentMethodTargetOrder, setPaymentMethodTargetOrder] = useState<Sale | null>(null);
    const [depositTargetOrder, setDepositTargetOrder] = useState<Sale | null>(null);
    const [deliveryFeeTargetOrder, setDeliveryFeeTargetOrder] = useState<Sale | null>(null);
    // How the payment being re-opened was received (paidMoneyOf), so its
    // form starts in that currency.
    const [paidMoney, setPaidMoney] = useState<{ orderId: string; kind: PaymentKind; money: PaidMoney } | null>(null);
    const paidFor = (order: Sale | null, kind: PaymentKind): PaidMoney | undefined =>
        order && paidMoney && paidMoney.orderId === order.id && paidMoney.kind === kind ? paidMoney.money : undefined;
    const settlePaid = paidFor(paymentMethodTargetOrder, 'Paid');
    const settleRiel = settlePaid?.currency === 'KHR' ? settlePaid : undefined;
    // Opens the Settle Payment / Deposit / Delivery Fee form. Re-opening a
    // payment already booked (Paid on a Paid order, Deposit on an order with
    // a deposit, PdFee on a PdFee order) first reads how it was received.
    // Only the latest opening counts: a lookup that comes back after another
    // opening (or after the form was closed) is dropped, so a slow reply can
    // never open, switch or reset a form.
    const paymentOpenSeq = useRef(0);
    const openPaymentForm = async (order: Sale, kind: PaymentKind) => {
        const seq = ++paymentOpenSeq.current;
        const status = String(order.paymentStatus || '');
        const booked = !claimOpen(order) && (kind === 'Deposit' ? (order.depositAmount || 0) > 0
            : kind === 'Paid' ? ['Paid', 'Settled', 'Paid/Settled'].includes(status) : status === kind);
        const deposit = order.depositAmount || 0;
        const bookedUsd = kind === 'Deposit' ? deposit
            : kind === 'Paid' ? Math.max(0, (Number(order.total) || 0) - deposit) : (order.amountReceived || 0);
        const money = booked ? await paidMoneyOf(order.id, kind, bookedUsd) : undefined;
        if (seq !== paymentOpenSeq.current) return;
        setPaidMoney(money ? { orderId: order.id, kind, money } : null);
        if (kind === 'Paid') {
            setPaymentMethodTargetOrder(order);
            setIsPaymentMethodModalOpen(true);
        } else if (kind === 'Deposit') {
            setDepositTargetOrder(order);
        } else {
            setDeliveryFeeTargetOrder(order);
        }
    };

    // Mobile: the filter bar is replaced by a right-side slide-in drawer.
    const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);

    // Fixed table appearance (the old Appearance submenu is gone); saved
    // padding/height from localStorage still apply so existing setups don't
    // jump. fontSize is pinned to 13px to match the filter bar's text size —
    // no longer read from storage, so a stale saved value can't undo it.
    const [tableSettings] = useState<{ fontSize: number; padding: number; height: string }>(() => {
        const saved = localStorage.getItem('pos_table_settings');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.height === '44px') parsed.height = '35px';
            return { ...parsed, fontSize: 13 };
        }
        return { fontSize: 13, padding: 5, height: 'auto' };
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
    // Persist Filters — ALL keys in one effect, so storage always mirrors the
    // screen: after a click-through (which skips persistence), the user's
    // first manual edit adopts the whole on-screen combination instead of
    // writing just one key next to stale saved values.
    useEffect(() => {
        if (skipFilterPersistRef.current) return;
        localStorage.setItem('orders_statusFilter', JSON.stringify(statusFilter));
        localStorage.setItem('orders_salesmanFilter', salesmanFilter);
        localStorage.setItem('orders_payStatusFilter', JSON.stringify(payStatusFilter));
        localStorage.setItem('orders_shippingCoFilter', JSON.stringify(shippingCoFilter));
        localStorage.setItem('orders_dateRange', JSON.stringify(dateRange));
        localStorage.setItem('orders_searchTerm', searchTerm);
        localStorage.setItem('orders_columnFilters', JSON.stringify(columnFilters));
        localStorage.setItem('orders_pageFilter', JSON.stringify(pageFilter));
    }, [statusFilter, salesmanFilter, payStatusFilter, shippingCoFilter, dateRange, searchTerm, columnFilters, pageFilter]);

    // Click-throughs from other pages (Dashboard 2's KPIs, pipeline, alerts,
    // table rows) arrive as `location.state.filters`. Apply them wholesale —
    // anything not given is reset — so the list shows exactly that subset.
    // The subset is a transient view: skipFilterPersistRef keeps it out of
    // localStorage, so the user's own saved filters return on the next
    // ordinary visit.
    useEffect(() => {
        const filters = (location.state as { filters?: OrderListFilters } | null)?.filters;
        if (!filters) { skipFilterPersistRef.current = false; return; }
        skipFilterPersistRef.current = true;
        setStatusFilter(filters.statuses ?? []);
        setPayStatusFilter(filters.payStatuses ?? []);
        setSalesmanFilter(filters.salesman ?? 'All');
        setPageFilter(filters.pages ?? []);
        setShippingCoFilter(filters.shippingCos ?? []);
        setDateRange(filters.dateRange ?? { start: '', end: '' });
        setSearchTerm(filters.search ?? '');
        setColumnFilters({});
        setActiveTab('list');
        navigate(location.pathname, { replace: true, state: {} });
    }, [location.state, location.pathname, navigate]);

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
    // Rule (ORD-11): the desktop footer's money totals (and the status /
    // pay-status chip counts) must cover EVERY order matching the current
    // filter, like the phone view — not just the visible page. These are the
    // minimal money columns of all matching orders, fetched separately when
    // the matches span more than one page; null = the single page already
    // covers every match (or the aggregate fetch failed), and the footer then
    // sums the loaded rows as before.
    const [aggOrders, setAggOrders] = useState<Sale[] | null>(null);
    // The last aggregate result, keyed by the applyOrderFilters identity (it
    // is rebuilt exactly when any filter, the search term, the user scope or
    // a realtime sale update changes — and NOT by pagination or sorting), so
    // paging through the table reuses the totals instead of re-downloading
    // every matching row. rows === null caches "the footer falls back to page
    // sums" (single-page match sets and truncated fetches).
    const aggCacheRef = React.useRef<{ filtersKey: unknown; rows: Sale[] | null } | null>(null);

    // (serverOrders is declared near the top of the component.)
    const [isLoadingOrders, setIsLoadingOrders] = useState(false);

    // Reset pagination when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [statusFilter, salesmanFilter, payStatusFilter, shippingCoFilter, pageFilter, dateRange, searchTerm, columnFilters, itemsPerPage, isMobile]);

    // The toolbar filters (status, salesman incl. the salesman-role lock, pay
    // status, shipping co, page, date range) applied to any sales query
    // builder. Shared by applyOrderFilters and the balance column-filter scan,
    // so the scan matches inside the same subset the page shows.
    const applyScopeFilters = React.useCallback((query: any) => {
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
            query = query.or(pageOrFilter(pageFilter));
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
        return query;
    }, [statusFilter, salesmanFilter, payStatusFilter, shippingCoFilter, pageFilter, dateRange, currentUser]);

    // The balance column filter's scanned id sets, reused across the calls of
    // one fetch cycle (mobile runs applyOrderFilters per chunk) and across
    // quick refetches, so the scan doesn't repeat per keystroke. Holds the
    // in-flight PROMISE, not the result: concurrent fetches (isMobile flips
    // false->true right after mount, restarting fetchOrders) share one scan.
    const balanceScanRef = useRef<{ key: string; at: number; result: Promise<{ match: string[]; rest: string[] }> } | null>(null);

    // Product-name matches that must travel as an id list: ~400 13-char order
    // ids are ~6KB of URL. The gateway was measured to accept 11KB and drop
    // requests at 17KB, which leaves room for the rest of the query.
    const SEARCH_ID_CAP = 400;
    // The search term whose "showing the newest N" notice was already shown —
    // every page change re-runs applyOrderFilters, and one notice is enough.
    const truncationNoticeRef = useRef<string | null>(null);
    // Customer group column filter: the matching phones, as a key that only
    // changes when the filter's result does (tagging a customer with no
    // group filter on must not refetch the page).
    const customerGroupFilterText = (columnFilters.customerGroup || '').trim();
    const customerGroupFilterKey = useMemo(() => customerGroupFilterText
        ? JSON.stringify(phonesMatchingGroupText(customerGroupMembers, customerGroupFilterText)) : '',
    [customerGroupMembers, customerGroupFilterText]);

    // Applies every active filter (status, salesman, pay status, shipping co,
    // page, date range, search, column filters) to a sales query. Takes a
    // builder FACTORY rather than a builder because a search may need an extra
    // embed in the select (see the search block). Shared by the page fetch and
    // the revenue-total query so both always agree.
    const applyOrderFilters = React.useCallback(async (makeQuery: (extraSelect: string) => unknown) => {
            const isSalesman = currentUser?.roleId === 'salesman';
            const effectiveSalesmanFilter = (isSalesman && salesmanFilter === 'All') ? (currentUser?.name || 'All') : salesmanFilter;

            // What the search decides: a top-level OR, and/or an inner-joined
            // sale_items embed (`matched`) carrying its own OR. The embed has to be
            // part of the select, so all of this is settled before the query is built.
            let searchOr: string | null = null;
            let itemEmbed = '';
            let itemEmbedOr: string | null = null;

            if (searchTerm.trim()) {
                const trimmedTerm = searchTerm.trim();
                const isExact = trimmedTerm.startsWith('"') && trimmedTerm.endsWith('"');
                const phrase = isExact ? trimmedTerm.slice(1, -1) : trimmedTerm;

                const terms = isExact ? (phrase ? [phrase] : []) : phrase.split(/[\s,]+/).filter(t => t.trim().length > 0);

                if (terms.length > 0) {
                    // Bulk target detection: If there are many terms, the user is pasting a list of IDs/Phones.
                    // Doing comprehensive ilike searching across 10 columns for > 15 terms breaks URL limits on PostgREST.
                    const isBulk = terms.length > 10;

                    if (isBulk) {
                        // Safely map values into an 'in' string, e.g. "term1","term2"
                        const inList = terms.map(t => `"${t.replace(/"/g, '""')}"`).join(',');
                        searchOr = `id.in.(${inList}),tracking_number.in.(${inList}),customer_snapshot->>phone.in.(${inList})`;
                    } else {
                        const escape = (t: string) => t.toLowerCase().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                        const itemOrFilters = terms.map(t => isExact ? `name.ilike."${escape(t)}"` : `name.ilike."%${escape(t)}%"`).join(',');

                        // Build the comprehensive OR string combining all terms for complex partial text searches
                        const parentOr = terms.map(term => {
                            const matchStr = isExact ? `"${escape(term)}"` : `"%${escape(term)}%"`;
                            return `id.ilike.${matchStr},salesman.ilike.${matchStr},remark.ilike.${matchStr},customer_care.ilike.${matchStr},shipping_company.ilike.${matchStr},tracking_number.ilike.${matchStr},payment_method.ilike.${matchStr},customer_snapshot->>name.ilike.${matchStr},customer_snapshot->>phone.ilike.${matchStr},customer_snapshot->>city.ilike.${matchStr}`;
                        }).join(',');

                        // Does the term hit any ORDER column at all (inside the toolbar
                        // scope)? A product name usually doesn't, and then the item
                        // matches need not be OR-ed with anything: they go through an
                        // inner-joined embed instead of an id list, which is exact for
                        // any number of orders and paged and counted by the server like
                        // every other filter. A failed probe must not read as "no
                        // matches": throw so fetchOrders keeps the previous list.
                        const { data: parentHits, error: probeError } = await applyScopeFilters(supabase.from('sales').select('id')).or(parentOr).limit(1);
                        if (probeError) throw probeError;

                        if (!parentHits || parentHits.length === 0) {
                            itemEmbed = ', matched:sale_items!inner(sale_id)';
                            itemEmbedOr = itemOrFilters;
                        } else {
                            // Order columns match too, so the item matches must be OR-ed in
                            // as an id list, newest first (ids are time-ordered). The list
                            // is capped by the URL limit; a truncated search says so instead
                            // of quietly showing fewer orders, as the old 50-row cap did.
                            const ids = new Set<string>();
                            let truncated = false;
                            const MAX_SCAN = 10000;
                            for (let fromRow = 0; !truncated; fromRow += 1000) {
                                if (fromRow >= MAX_SCAN) { truncated = true; break; }
                                let itemQuery = supabase
                                    .from('sale_items')
                                    .select('sale_id, sales!inner(date, shipping_status, salesman, payment_status, shipping_company, page_source)')
                                    .or(itemOrFilters);

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
                                    // Same page_source-with-snapshot-fallback rule as the main query.
                                    itemQuery = itemQuery.or(pageOrFilter(pageFilter), { foreignTable: 'sales' });
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

                                const { data: itemMatches, error: itemError } = await itemQuery
                                    .order('sale_id', { ascending: false })
                                    .range(fromRow, fromRow + 999);
                                if (itemError) throw itemError;
                                for (const m of itemMatches || []) {
                                    ids.add(String((m as unknown as { sale_id: string | number }).sale_id));
                                    if (ids.size > SEARCH_ID_CAP) { truncated = true; break; }
                                }
                                if (!itemMatches || itemMatches.length < 1000) break;
                            }
                            const matchingSaleIds = Array.from(ids).slice(0, SEARCH_ID_CAP);
                            if (truncated && truncationNoticeRef.current !== searchTerm) {
                                truncationNoticeRef.current = searchTerm;
                                showToast(tNow('ui.orders.toast.searchTruncated', { n: SEARCH_ID_CAP }), 'info');
                            }
                            searchOr = parentOr + (matchingSaleIds.length > 0 ? `,id.in.(${matchingSaleIds.join(',')})` : '');
                        }
                    }
                }
            }

            let query = applyScopeFilters(makeQuery(itemEmbed));
            if (searchOr) query = query.or(searchOr);
            if (itemEmbedOr) query = query.or(itemEmbedOr, { foreignTable: 'matched' });

            for (const [key, val] of Object.entries(columnFilters)) {
                if (!val || typeof val !== 'string' || !val.trim()) continue;
                const v = val.trim();
                const esc = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                
                switch (key) {
                    // Date-range column filters: "From" only = that day onward,
                    // "To" only = up to that day, both = the inclusive range.
                    // (Previously a lone From collapsed to a single day.)
                    case 'date': {
                        const parts = v.split('|');
                        const startStr = parts[0];
                        const endStr = parts.length > 1 ? parts[1] : '';
                        if (startStr) {
                            query = query.gte('date', localDayBound(startStr, 'start').toISOString());
                        }
                        if (endStr) {
                            query = query.lte('date', localDayBound(endStr, 'end').toISOString());
                        }
                        break;
                    }
                    // The column now shows settle_date, falling back to
                    // deposit_date for an order that's only been deposited on
                    // (see the 'settleDate' render case below) — match either
                    // column here too, or filtering by this column would never
                    // find a deposit-only order it visibly displays a date for.
                    case 'settleDate': {
                        const parts = v.split('|');
                        const startStr = parts[0];
                        const endStr = parts.length > 1 ? parts[1] : '';
                        const orGroups: string[] = [];
                        for (const col of ['settle_date', 'deposit_date']) {
                            // deposit_date is a DATE: a UTC instant would be cast to the previous day.
                            const isPlainDate = col === 'deposit_date';
                            const colConds: string[] = [];
                            if (startStr) {
                                colConds.push(`${col}.gte.${isPlainDate ? startStr : localDayBound(startStr, 'start').toISOString()}`);
                            }
                            if (endStr) {
                                colConds.push(`${col}.lte.${isPlainDate ? endStr : localDayBound(endStr, 'end').toISOString()}`);
                            }
                            if (colConds.length > 0) {
                                // The column only falls back to deposit_date when
                                // settle_date is unset (render case below) — once an
                                // order has settled, its old deposit_date is no longer
                                // what's displayed, so gate this branch the same way or
                                // it matches a stale deposit date on an order that has
                                // since settled on a different day.
                                if (isPlainDate) colConds.push('settle_date.is.null');
                                orGroups.push(colConds.length > 1 ? `and(${colConds.join(',')})` : colConds[0]);
                            }
                        }
                        if (orGroups.length > 0) {
                            // Matches the display's own gating — an order sitting on
                            // Unpaid/Cancel/etc. keeps its old settle_date/deposit_date
                            // for financial-record reasons but no longer shows a date
                            // in this column, so don't surface it here either.
                            query = query.in('payment_status', ['Paid', 'Deposit', 'PdFee']).or(orGroups.join(','));
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
                    case 'status': {
                        // Staff filter by what they see ("Returning"); the column
                        // holds the stored value ('Returned') — match both.
                        const viaLabel = orderStatusesMatchingLabel(v);
                        query = viaLabel.length > 0 && !/[,()"]/.test(esc)
                            ? query.or(`shipping_status.ilike.%${esc}%,shipping_status.in.(${viaLabel.join(',')})`)
                            : query.ilike('shipping_status', `%${esc}%`);
                        break;
                    }
                    case 'payStatus': {
                        // payment_status has no NOT NULL/DEFAULT in the DB; a null row
                        // falls back to displaying 'Unpaid' (see the render case below),
                        // so a filter whose text would also match that fallback label
                        // must match null rows too, or it misses them.
                        const matchesUnpaidFallback = 'unpaid'.includes(v.toLowerCase());
                        query = matchesUnpaidFallback
                            ? query.or(`payment_status.ilike.%${esc}%,payment_status.is.null`)
                            : query.ilike('payment_status', `%${esc}%`);
                        break;
                    }
                    case 'shippingCo':
                        query = query.ilike('shipping_company', `%${esc}%`);
                        break;
                    case 'deliveryType': {
                        // Derived from the courier (Sales Setup › Delivery
                        // Types): the couriers whose type matches the text.
                        // Matched like the cell: case-insensitive equality
                        // (ilike without wildcards; % _ \ " escaped).
                        const couriers = couriersMatchingTypeText(courierDeliveryTypes, v);
                        if (!couriers.length) { query = query.in('shipping_company', ['__no_courier_has_this_type__']); break; }
                        const pat = (c: string) => c.trim().replace(/[\\%_]/g, ch => '\\' + ch).replace(/"/g, '\\"');
                        query = query.or(couriers.map(c => `shipping_company.ilike."${pat(c)}"`).join(','));
                        break;
                    }
                    case 'customerGroup': {
                        // A customer is their phone (Sales Setup › Customer
                        // Groups): the phones whose group contains the text,
                        // compared as digits through customer_phone_digits()
                        // (migrations/add_customer_groups.sql).
                        const phones: string[] = customerGroupFilterKey ? JSON.parse(customerGroupFilterKey) : [];
                        if (!phones.length) { query = query.in('id', ['__no_customer_in_this_group__']); break; }
                        const PHONE_CAP = 400; // ~10 digits each keeps the URL under the gateway limit
                        // Said once per filter (this runs for the page and each footer chunk).
                        if (phones.length > PHONE_CAP && truncationNoticeRef.current !== `customer-group:${v}:${phones.length}`) {
                            truncationNoticeRef.current = `customer-group:${v}:${phones.length}`;
                            showToast(tNow('ui.orders.customerGroup.filterTruncated', { n: phones.length, cap: PHONE_CAP }), 'info');
                        }
                        query = query.in('customer_phone_digits', phones.slice(0, PHONE_CAP));
                        break;
                    }
                    case 'remark':
                        query = query.ilike('remark', `%${esc}%`);
                        break;
                    case 'returnReason':
                        query = query.ilike('return_reason', `%${esc}%`);
                        break;
                    case 'tracking':
                        query = query.ilike('tracking_number', `%${esc}%`);
                        break;
                    case 'items': {
                        // The old single limit(300)+slice(0,200) silently dropped any
                        // match beyond the cap with no notice, while the Items cell
                        // shows every item on an order regardless — a true match could
                        // sit past the cap and never surface. Mirror the paginated,
                        // ordered, notice-on-truncation scan the main search bar's
                        // item-match path already uses (above).
                        const numVal = Number(v);
                        const itemFilterOr = (!isNaN(numVal) && v !== '')
                            ? `name.ilike.%${esc}%,quantity.eq.${numVal}`
                            : `name.ilike.%${esc}%`;
                        const colIds = new Set<string>();
                        let colTruncated = false;
                        const COL_MAX_SCAN = 10000;
                        for (let fromRow = 0; !colTruncated; fromRow += 1000) {
                            if (fromRow >= COL_MAX_SCAN) { colTruncated = true; break; }
                            const { data: colItemMatches, error: colItemError } = await supabase
                                .from('sale_items')
                                .select('sale_id')
                                .or(itemFilterOr)
                                .order('sale_id', { ascending: false })
                                .range(fromRow, fromRow + 999);
                            if (colItemError) throw colItemError;
                            for (const m of colItemMatches || []) {
                                colIds.add(String(m.sale_id));
                                if (colIds.size > SEARCH_ID_CAP) { colTruncated = true; break; }
                            }
                            if (!colItemMatches || colItemMatches.length < 1000) break;
                        }
                        const matchingColIds = Array.from(colIds).slice(0, SEARCH_ID_CAP);
                        if (colTruncated && truncationNoticeRef.current !== `items-filter:${v}`) {
                            truncationNoticeRef.current = `items-filter:${v}`;
                            showToast(tNow('ui.orders.toast.itemsFilterTruncated', { n: SEARCH_ID_CAP }), 'info');
                        }
                        if (matchingColIds.length > 0) {
                            query = query.in('id', matchingColIds);
                        } else {
                            query = query.eq('id', 'NO_MATCH');
                        }
                        break;
                    }
                    case 'total': {
                        // The cell displays total.toFixed(2); an exact eq() on the raw
                        // value misses a row whose unrounded total has more than 2
                        // decimals (e.g. a fractional-percentage discount) and so no
                        // longer equals the figure its own cell shows. A half-cent band
                        // matches whatever rounds to the typed 2-decimal value.
                        const target = Number(v);
                        if (!isNaN(target)) query = query.gte('total', target - 0.005).lte('total', target + 0.005);
                        break;
                    }
                    case 'received': {
                        // Same rounding mismatch as 'total' — amount_received can carry
                        // more than 2 decimals while the Received cell rounds for display.
                        const target = Number(v);
                        if (!isNaN(target)) query = query.gte('amount_received', target - 0.005).lte('amount_received', target + 0.005);
                        break;
                    }
                    case 'balance': {
                        // Balance is computed (orderBalance), not a DB column — the old
                        // eq('total', v) matched the wrong orders. Scan the money columns
                        // (within the SAME toolbar scope as the page, so the intersection
                        // is exact), compute each order's balance, and constrain by ids.
                        const target = Number(v);
                        if (isNaN(target)) break;
                        const cents = (n: number) => Math.round(n * 100);
                        const IN_CAP = 200; // ~200 uuids per in()/not.in() keeps the URL under the gateway limit
                        // salesUpdatedAt in the key invalidates the scan the moment any
                        // order mutates; the TTL only backstops missed invalidations.
                        const cacheKey = JSON.stringify([target, statusFilter, salesmanFilter, payStatusFilter, shippingCoFilter, pageFilter, dateRange, currentUser?.roleId, currentUser?.name, salesUpdatedAt]);
                        let scan = balanceScanRef.current;
                        if (!scan || scan.key !== cacheKey || Date.now() - scan.at > 60000) {
                            const runScan = async () => {
                                const rows: any[] = [];
                                for (let fromRow = 0; fromRow < 20000; fromRow += 1000) {
                                    const { data: chunk, error } = await applyScopeFilters(
                                        supabase.from('sales').select('id, total, amount_received, deposit_amount, payment_status, shipping_status')
                                    )
                                        // date desc so a capped id list keeps the newest orders
                                        .order('date', { ascending: false })
                                        .order('id', { ascending: true })
                                        .range(fromRow, fromRow + 999);
                                    // A failed chunk must NOT read as "no matches": throw so
                                    // fetchOrders' catch keeps the previous list instead of
                                    // showing a false "No orders match your filters".
                                    if (error) throw error;
                                    rows.push(...(chunk || []));
                                    if (!chunk || chunk.length < 1000) break;
                                }
                                const match: string[] = [];
                                const rest: string[] = [];
                                for (const r of rows) {
                                    const bal = orderBalance({
                                        paymentStatus: r.payment_status,
                                        total: Number(r.total) || 0,
                                        amountReceived: Number(r.amount_received) || 0,
                                        depositAmount: Number(r.deposit_amount) || 0,
                                        shipping: { status: r.shipping_status },
                                    } as unknown as Sale);
                                    (cents(bal) === cents(target) ? match : rest).push(String(r.id));
                                }
                                return { match, rest };
                            };
                            scan = { key: cacheKey, at: Date.now(), result: runScan() };
                            balanceScanRef.current = scan;
                            // A failed scan must not poison the cache for the retry.
                            scan.result.catch(() => { if (balanceScanRef.current === scan) balanceScanRef.current = null; });
                        }
                        const { match, rest } = await scan.result;
                        if (match.length === 0) {
                            query = query.eq('id', 'NO_MATCH');
                        } else if (match.length <= IN_CAP) {
                            query = query.in('id', match);
                        } else if (rest.length === 0) {
                            // every scanned order matches — no constraint needed
                        } else if (rest.length <= IN_CAP) {
                            // The complement is small (typical for balance = 0, which most
                            // settled orders match): exclude the non-matches instead, which
                            // stays EXACT where a capped in() would silently truncate.
                            query = query.not('id', 'in', `(${rest.join(',')})`);
                        } else {
                            showToast(tNow('ui.orders.toast.balanceFilterTruncated', { n: match.length, cap: IN_CAP }), 'info');
                            query = query.in('id', match.slice(0, IN_CAP));
                        }
                        break;
                    }
                    case 'lastEdit':
                        query = query.ilike('last_edited_by', `%${esc}%`);
                        break;
                }
            }

        // PostgREST builders are thenables — returning one straight out of an
        // async function makes `await` EXECUTE the query and hand back its result
        // instead of the builder. Wrap it so the caller gets the builder intact.
        return { query };
    }, [applyScopeFilters, statusFilter, salesmanFilter, payStatusFilter, shippingCoFilter, pageFilter, dateRange, searchTerm, currentUser, columnFilters, showToast, salesUpdatedAt, courierDeliveryTypes, customerGroupFilterKey]);

    // Stale-response guard: a click-through's filtered refetch races the
    // unfiltered mount fetch (and any other superseded fetch); without this,
    // whichever response lands LAST wins — e.g. a dashboard page card opened
    // an unfiltered list whenever the heavier first response resolved late.
    const fetchOrdersSeqRef = React.useRef(0);
    const fetchOrders = React.useCallback(async () => {
        const reqId = ++fetchOrdersSeqRef.current;
        const isStale = () => reqId !== fetchOrdersSeqRef.current;
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
                    // Derived from the courier: grouped by courier.
                    'deliveryType': 'shipping_company',
                    'tracking': 'tracking_number',
                    'status': 'shipping_status',
                    'received': 'amount_received',
                    'payStatus': 'payment_status',
                    'remark': 'remark',
                    'returnReason': 'return_reason',
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
                    const chunkQuery: any = (await applyOrderFilters(extra =>
                        supabase.from('sales').select(`*, items:sale_items(id, sale_id, product_id, name, price, quantity)${extra}`, { count: 'exact' })
                    )).query;
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
                if (isStale()) return;
                setHasMoreMobile(!serverRanDry && rows.length < (count || 0));
            } else {
                // The filters changed since the cached footer aggregate was
                // built: drop it NOW, before the page query, so the footer
                // never shows the previous filter's all-match totals beside
                // the new filter's rows while the aggregate refetch runs.
                if (aggCacheRef.current && aggCacheRef.current.filtersKey !== applyOrderFilters) {
                    aggCacheRef.current = null;
                    setAggOrders(null);
                }
                // Desktop: one page. Built here (not before the branch) so the mobile
                // path doesn't pay for a filtered query it never executes —
                // applyOrderFilters can run real sale_items subqueries.
                let query: any = (await applyOrderFilters(extra =>
                    supabase.from('sales').select(`*, items:sale_items(id, sale_id, product_id, name, price, quantity)${extra}`, { count: 'exact' })
                )).query;
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

            if (isStale()) return;
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
                        const sumQuery: any = (await applyOrderFilters(extra => supabase.from('sales').select(`total${extra}`))).query;
                        const { data: rows, error: sumError } = await sumQuery
                            .in('shipping_status', REVENUE_STATUSES)
                            // Matches isRevenueOrder: a Cancel-paid order never counts,
                            // even if its shipping status is still Confirmed/Shipped/Delivered.
                            .neq('payment_status', 'Cancel')
                            // Stable order keeps the chunk windows non-overlapping —
                            // without it rows can shift between requests and be
                            // double-counted or skipped.
                            .order('id', { ascending: true })
                            .range(fromRow, fromRow + CHUNK - 1);
                        if (sumError) throw sumError;
                        for (const r of rows || []) revenue += Number((r as any).total) || 0;
                        if (!rows || rows.length < CHUNK) break;
                    }
                    if (!isStale()) setRevenueTotal(revenue);
                } catch (sumErr) {
                    console.error('Failed to compute revenue total:', sumErr);
                    if (!isStale()) setRevenueTotal(null);
                }
            } else {
                // Desktop footer totals across ALL matches (ORD-11). Only
                // needed when the matches don't fit on the loaded page;
                // fetched with the same filters and minimal columns via
                // fetchAll (chunked + merged by id, so rows can't be double-
                // counted while pages shift). On failure the footer falls
                // back to the page sums, exactly as before this fix.
                try {
                    if ((count || 0) <= (data?.length || 0)) {
                        aggCacheRef.current = { filtersKey: applyOrderFilters, rows: null };
                        if (!isStale()) setAggOrders(null);
                    } else if (aggCacheRef.current && aggCacheRef.current.filtersKey === applyOrderFilters) {
                        // Same filters as the cached aggregate (this fetch was
                        // a page/sort change): the totals are unchanged, reuse
                        // them instead of re-downloading every matching row.
                        if (!isStale()) setAggOrders(aggCacheRef.current.rows);
                    } else {
                        // Debounce: a keystroke in the search box re-runs
                        // fetchOrders per character, and each aggregate is up
                        // to 20 chunked requests (times the per-chunk search
                        // probes). Waiting here lets the next keystroke's
                        // fetch supersede this one BEFORE any aggregate
                        // network work starts — only the settled filter pays.
                        await new Promise(resolve => setTimeout(resolve, 400));
                        if (isStale()) return;
                        const MAX_AGG_ROWS = 20000;
                        const aggRows = await fetchAll<FooterAggRow>(async (from, to) => {
                            const built = await applyOrderFilters(extra =>
                                supabase.from('sales').select(`id, total, amount_received, deposit_amount, payment_status, shipping_status, items:sale_items(quantity, name)${extra}`)
                            );
                            return (built.query as unknown as FooterAggQuery).order('id', { ascending: true }).range(from, to);
                        }, 1000, { label: 'Orders desktop footer totals', maxRows: MAX_AGG_ROWS });
                        // fetchAll stops silently at its row ceiling. Partial
                        // sums presented as "every match" would be WRONG (and
                        // biased to the oldest orders — the scan is id-asc),
                        // so past the ceiling the footer falls back to the
                        // page sums, exactly like a failed fetch (ORD-11's
                        // rule is all-matches-or-plainly-page).
                        if (aggRows.length >= MAX_AGG_ROWS) {
                            aggCacheRef.current = { filtersKey: applyOrderFilters, rows: null };
                            if (!isStale()) setAggOrders(null);
                        } else {
                            // Minimal Sale shape — exactly the fields the shared
                            // orderMoney rules and the chip counts read.
                            const mappedAgg = aggRows.map(r => ({
                                id: String(r.id),
                                total: Number(r.total) || 0,
                                amountReceived: Number(r.amount_received) || 0,
                                depositAmount: Number(r.deposit_amount) || 0,
                                paymentStatus: r.payment_status,
                                shipping: { status: r.shipping_status },
                                items: (r.items || []).map(i => ({ name: i.name, quantity: Number(i.quantity) || 0 })),
                            })) as unknown as Sale[];
                            aggCacheRef.current = { filtersKey: applyOrderFilters, rows: mappedAgg };
                            if (!isStale()) setAggOrders(mappedAgg);
                        }
                    }
                } catch (aggErr) {
                    console.error('Failed to compute footer totals across all matches:', aggErr);
                    // Not cached: the next fetch with these filters retries.
                    aggCacheRef.current = null;
                    if (!isStale()) setAggOrders(null);
                }
            }
        } catch (err) {
            console.error("Fetch orders failed", err);
            // A Reason filter or sort on a store without the column.
            const e = err as { code?: string; message?: string } | null;
            if (!isStale() && /return_reason/.test(e?.message || '')) showToastRef.current(tNow('ui.store.order.returnReasonMissing'), 'error');
            // A Customer group filter on a store without add_customer_groups.sql.
            if (!isStale() && /customer_phone_digits/.test(e?.message || '')) showToastRef.current(tNow('ui.orders.customerGroup.sqlMissing'), 'error');
        } finally {
            // Only the newest fetch may clear the spinner — a stale one
            // finishing late must not hide that a newer fetch is in flight.
            if (!isStale()) setIsLoadingOrders(false);
        }
    }, [applyOrderFilters, sortConfig, currentPage, itemsPerPage, salesUpdatedAt, isMobile]);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    // Income rows of the orders on screen, for the small ៛ line under the
    // Received amount: per order and income category, the riel of the rows
    // tagged KHR (currency / original_amount / exchange_rate,
    // migrations/add_khr_currency.sql) and the dollars of the others. A store
    // without those columns, or without transactions.order_id, just shows no
    // riel line.
    type IncomeSplit = { riel: number; usd: number; lines: string[] };
    const [orderIncome, setOrderIncome] = useState<Record<string, Record<string, IncomeSplit>>>({});
    useEffect(() => {
        const ids = serverOrders.map(o => o.id);
        if (ids.length === 0) { setOrderIncome({}); return; }
        let cancelled = false;
        (async () => {
            const byOrder: Record<string, Record<string, IncomeSplit>> = {};
            for (let i = 0; i < ids.length; i += 200) {
                const { data, error } = await supabase.from('transactions')
                    .select('order_id, category, amount, currency, original_amount, exchange_rate')
                    .eq('type', 'Income').in('order_id', ids.slice(i, i + 200));
                if (error) return;
                for (const r of data || []) {
                    const cats = (byOrder[r.order_id] ||= {});
                    const s = (cats[r.category] ||= { riel: 0, usd: 0, lines: [] });
                    if (isKhrRow(r)) s.riel += Number(r.original_amount);
                    else s.usd += Number(r.amount) || 0;
                    s.lines.push(formatMoneyLine(r));
                }
            }
            if (!cancelled) setOrderIncome(byOrder);
        })();
        return () => { cancelled = true; };
    }, [serverOrders]);
    // The riel behind the Received figure, when any of it came in riel: the
    // income of the payments that figure shows (the deposit for a Deposit,
    // deposit + settlement for Paid, the fee for PdFee; nothing for orders
    // whose figure is still owed), with any dollar part after it.
    const rielReceived = (order: Sale): { text: string; title: string } | null => {
        const cats = orderIncome[order.id];
        const status = String(order.paymentStatus || '');
        const kinds: PaymentKind[] = status === 'Deposit' ? ['Deposit']
            : ['Paid', 'Settled', 'Paid/Settled'].includes(status) ? ['Deposit', 'Paid']
            : status === 'PdFee' ? ['PdFee'] : [];
        if (!cats || kinds.length === 0) return null;
        const parts = kinds.map(k => cats[PAID_CATEGORY[k]]).filter((s): s is IncomeSplit => !!s);
        const riel = parts.reduce((a, s) => a + s.riel, 0);
        if (riel <= 0) return null;
        const usd = roundCents(parts.reduce((a, s) => a + s.usd, 0));
        return { text: formatKhr(riel) + (usd > 0 ? ` + ${formatUsd(usd)}` : ''), title: parts.flatMap(s => s.lines).join('\n') };
    };

    // Carrier statuses for the rows on screen: pull the cached rows, then on
    // desktop quietly refresh the stale ones (checked > 6h ago; never delivered
    // parcels; at most 40) so statuses stay current without anyone clicking.
    // Runs once per loaded set of orders. Mobile only reads the cache.
    const autoTrackedKeyRef = React.useRef('');
    useEffect(() => {
        const nos = serverOrders.map(o => o.shipping?.trackingNumber || '').filter(Boolean);
        if (nos.length === 0) return;
        let cancelled = false;
        loadCached(nos).then(() => {
            if (cancelled || isMobile) return;
            const key = serverOrders.map(o => o.id).join(',');
            if (autoTrackedKeyRef.current === key) return;
            autoTrackedKeyRef.current = key;
            trackOrders(serverOrders, { maxAgeMinutes: 360 });
        });
        return () => { cancelled = true; };
    }, [serverOrders, isMobile, loadCached, trackOrders]);

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
        if (order.paymentStatus === 'Cancel') return 'var(--row-alert)';

        // Priority 2: Shipping Status
        const shippingStatus = order.shipping?.status;
        if (shippingStatus === 'Drafted') return 'var(--sticky-plain)';
        if (shippingStatus === 'Confirmed') return 'var(--row-confirmed)';
        if (shippingStatus === 'Pending') return 'var(--row-pending)';
        if (shippingStatus === 'Shipped') return 'var(--row-shipped)';
        if (shippingStatus === 'Delivered') return 'var(--row-delivered)';
        if (shippingStatus === 'Returned') return 'var(--row-alert)';
        if (shippingStatus === 'Cancelled') return 'var(--row-alert)';
        return 'var(--sticky-plain)';
    };



    const paginatedOrders = serverOrders;

    const stats = useMemo(() => {
        const totalOrders = totalCount;
        // Rule (ORD-11): the footer's money totals cover every order matching
        // the current filter, like "Total: N" already did and like the phone
        // view — aggOrders holds all matches when they span more than one
        // page; otherwise the loaded page IS every match.
        const statsOrders = aggOrders ?? filteredOrders;
        // Booked / collected / pieces: gated by isRevenueOrder (Confirmed,
        // Shipped or Delivered, not Cancel-paid) — the same rule the mobile
        // footer and Dashboard 2 use, so all three always agree.
        const totalRevenue = statsOrders.reduce((sum, order) => sum + orderRevenue(order), 0);
        const totalReceived = statsOrders.reduce((sum, order) => sum + orderCollected(order), 0);
        // Sum of the per-row Balance column (same rule as the cells, so the
        // footer always matches what's shown).
        const totalOutstanding = statsOrders.reduce((sum, order) => sum + orderBalance(order), 0);
        const totalProducts = statsOrders.reduce((sum, order) => sum + orderRevenuePieces(order), 0);
        const statusCounts = statsOrders.reduce((acc, order) => {
            const status = order.shipping?.status || 'Pending';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        const payStatusCounts = statsOrders.reduce((acc, order) => {
            const status = order.paymentStatus || 'Unpaid';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        const productCounts = statsOrders.reduce((acc, order) => {
            if (isRevenueOrder(order)) {
                order.items.forEach(item => {
                    const name = item.name || 'Unknown Product';
                    acc[name] = (acc[name] || 0) + item.quantity;
                });
            }
            return acc;
        }, {} as Record<string, number>);
        return { totalOrders, totalRevenue, totalReceived, totalOutstanding, totalProducts, statusCounts, payStatusCounts, productCounts };
    }, [filteredOrders, aggOrders, totalCount]);

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
            showToast(t('ui.orders.toast.noneToExport'), 'error');
            return;
        }

        const data = selectedOrders.map(order => ({
            'Order ID': order.id,
            'Date': new Date(order.date).toLocaleDateString(),
            'Customer': order.customer?.name || 'N/A',
            'Phone': order.customer?.phone || 'N/A',
            'Customer Group': customerGroupOf(customerGroupMembers, order.customer?.phone) || '',
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
            'Settle Date': (() => {
                const d = (order.paymentStatus === 'Paid' || order.paymentStatus === 'Deposit' || order.paymentStatus === 'PdFee')
                    ? (order.settleDate || order.depositDate)
                    : null;
                return d ? new Date(d).toLocaleDateString() : 'N/A';
            })(),
            'Shipping Company': order.shipping?.company || 'N/A',
            'Delivery Type': courierDeliveryType(courierDeliveryTypes, order.shipping?.company) || '',
            'Shipping Status': order.shipping?.status || 'Pending',
            'Tracking Number': order.shipping?.trackingNumber || 'N/A',
            'Remarks': order.remark || '',
            'Return Reason': order.returnReason || ''
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
            { wch: 18 }, // Delivery Type
            { wch: 15 }, // Ship Status
            { wch: 20 }, // Tracking
            { wch: 30 }, // Remarks
            { wch: 24 }  // Return Reason
        ];
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, "Orders");

        // Generate filename with current date
        const dateStr = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
        XLSX.writeFile(wb, `Selected_Orders_Export_${dateStr}.xlsx`);

        showToast(fill(t('ui.orders.toast.exported'), { n: selectedOrders.length }), 'success');
    };

    const handleDelete = async () => {
        if (selectedIds.size === 0) return;

        if (window.confirm(fill(t('ui.orders.bulk.confirmDeleteStock'), { n: selectedIds.size }))) {
            try {
                await deleteOrders(Array.from(selectedIds));
                setSelectedIds(new Set());
                showToast(t('ui.orders.toast.deletedStockRestored'), 'success');
                await fetchOrders();
            } catch (error: any) {
                console.error('Failed to delete orders:', error);
                showToast(t('ui.orders.toast.deleteFailed') + (error.message || t('ui.orders.toast.unknownError')), 'error');
            }
        }
    };

    // settleDate / payBy come from the Bulk Edit modal's Payment section.
    // reason: a Rejection Reason picked with a move to Returned / Cancelled.
    const handleBulkEdit = async (field: 'date' | 'status' | 'paymentStatus' | 'settleDate', value: any, settleDate?: string, payBy?: string, reason?: string) => {
        if (selectedIds.size === 0) return;

        try {
            let ids = Array.from(selectedIds);
            const updates: Partial<Sale> = {};
            // Orders whose change was refused or failed (each one already
            // explained, or its reason kept in lastReason): the toast below
            // reports them instead of claiming every order was updated.
            let notSaved = 0;
            let lastReason = '';

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
                if (value === 'ReStock') {
                    // ReStock means the returned goods are back on the shelf. Changing only
                    // the status marked orders restocked without returning any stock, so
                    // this goes through the Restock flow (stock, return record, payment
                    // Cancel). Only orders that are Returned right now are restocked.
                    // ORD-9: same permission the single-row badge requires.
                    if (!canRestock) {
                        showToast(t('ui.orders.toast.noRestockPermission'), 'error');
                        return;
                    }
                    const restocked = await bulkRestockOrders(ids);
                    showToast(restockResultMessage(restocked, ids.length), restocked > 0 ? 'success' : 'error');
                    setSelectedIds(new Set());
                    await fetchOrders();
                    return;
                }
                // The orders now at the target status (moved, or already there)
                // get the picked reason afterwards.
                const atTarget: string[] = [];
                for (const id of ids) {
                    const order = serverOrders.find(s => s.id === id) || sales.find(s => s.id === id);
                    const current = order?.shipping?.status;
                    // Already there: fill in a missing reason, never replace one.
                    if (current === value) { if (!(order?.returnReason || '').trim()) atTarget.push(id); continue; }
                    // ORD-9: Bulk Edit obeys the same per-order rules as the
                    // single-row badge — refused orders are skipped and counted.
                    const refusal = statusChangeRefusal(
                        { shippingStatus: current, paymentStatus: order?.paymentStatus },
                        value,
                        { isAdmin, canRestock }
                    );
                    if (refusal) { lastReason = refusal; notSaved++; continue; }
                    // shownStatus: the status this list showed; if the order has moved
                    // on since, the change is refused rather than applied to the
                    // status someone else set.
                    const moved = await updateOrderStatus(id, value, undefined, undefined, {
                        shownStatus: current || 'Pending',
                        onRefused: m => { lastReason = m; },
                    });
                    if (!moved) notSaved++;
                    else atTarget.push(id);
                }
                if (reason && (value === 'Returned' || value === 'Cancelled')) {
                    // One at a time; stop at the first failure (a store without
                    // add_sales_return_reason.sql says so once, not per order).
                    for (let i = 0; i < atTarget.length; i++) {
                        if (!(await updateOrder(atTarget[i], { returnReason: reason }))) {
                            // This one and the rest got no reason: report them
                            // (updateOrder already said why, once).
                            const missed = atTarget.length - i;
                            notSaved += missed;
                            lastReason = lastReason || fill(t('ui.orders.bulk.reasonNotSaved'), { n: missed });
                            break;
                        }
                    }
                }
            } else if (field === 'settleDate') {
                // ORD-9: a posted Paid/PdFee/Cancel order's settle date is its
                // booked receipt's day — same lock as the payment badge.
                const allowedIds = ids.filter(id => {
                    const order = serverOrders.find(s => s.id === id) || sales.find(s => s.id === id);
                    const refusal = settleDateChangeRefusal(
                        { shippingStatus: order?.shipping?.status, paymentStatus: order?.paymentStatus, getFileBooked: order?.getFileBooked },
                        { isAdmin, canRestock }
                    );
                    if (refusal) { lastReason = refusal; notSaved++; return false; }
                    return true;
                });
                if (allowedIds.length > 0) {
                    updates.settleDate = value ? new Date(value).toISOString() : null as any;
                    await updateOrders(allowedIds, updates);
                }
            } else if (field === 'paymentStatus') {
                // A Salesman books no money (the store refuses it order by
                // order); say so once instead of once per selected order.
                if (isSalesmanUser && ['Deposit', 'Paid', 'Settled', 'PdFee'].includes(value)) {
                    alert(t('ui.orders.bulk.salesmanNoMoney'));
                    return;
                }
                const now = new Date().toISOString();
                const saveOne = (id: string) => {
                    const order = serverOrders.find(s => s.id === id) || sales.find(s => s.id === id);
                    if (!order) return Promise.resolve(true);

                    // ORD-9: same rules as the single-row payment badge — a
                    // non-admin can't bulk-unpay or bulk-cancel Paid orders.
                    const refusal = paymentChangeRefusal(
                        { shippingStatus: order.shipping?.status, paymentStatus: order.paymentStatus, getFileBooked: order.getFileBooked },
                        value,
                        { isAdmin, canRestock }
                    );
                    if (refusal) { lastReason = refusal; return Promise.resolve(false); }

                    const individualUpdates: Partial<Sale> = { paymentStatus: value };

                    if (value === 'Paid' || value === 'Settled') {
                        individualUpdates.amountReceived = order.total;
                        individualUpdates.settleDate = settleDate ? new Date(settleDate).toISOString() : now;
                        // Pay By chosen in the modal — also feeds the income row's pay_by.
                        if (payBy) individualUpdates.paymentMethod = payBy as any;
                        // Bulk settles book their receipts too; with no account
                        // picker here, the Pay By steers which cash/bank account
                        // the Draft RCP entry lands on — unless the courier
                        // collected the money (the Settle box's default), when
                        // the receipt debits 1210 COD receivable instead.
                        individualUpdates.postToLedger = true;
                        individualUpdates.codCollected = defaultCodCollected(order, codPaymentMethods);
                    } else if (value === 'Get File') {
                        // File collected, money not settled yet — no settle date. Keep a
                        // deposit visible in Received when one was taken.
                        individualUpdates.amountReceived = order.depositAmount || 0;
                        individualUpdates.settleDate = null as any;
                    } else if (value === 'Cancel' || value === 'Unpaid') {
                        individualUpdates.amountReceived = 0;
                        individualUpdates.settleDate = null as any;
                        // Unpaid on a Salesman's unconfirmed payment removes it,
                        // same as on the single-row badge.
                        if (value === 'Unpaid' && order.paymentClaim && canConfirmPayments) individualUpdates.paymentClaim = null;
                    }
                    
                    return updateOrder(id, { ...individualUpdates, expectedPaymentStatus: order.paymentStatus });
                };
                // Get File moves stock (an unshipped order is counted out as Delivered), and
                // stock is read-modify-write per product, so those saves go one at a time:
                // in parallel, two orders with the same product would overwrite each other.
                // false: not saved (updateOrder has said why).
                const results: boolean[] = [];
                if (value === 'Get File') { for (const id of ids) results.push(await saveOne(id)); } else { results.push(...await Promise.all(ids.map(saveOne))); }
                notSaved = results.filter(ok => !ok).length;
            }

            if (notSaved > 0) {
                showToast(fill(t('ui.orders.bulk.partlyUpdated'), { done: ids.length - notSaved, n: ids.length, failed: notSaved }) + (lastReason ? ': ' + lastReason : ''), 'error');
                setSelectedIds(new Set());
                await fetchOrders();
                return;
            }
            showToast(fill(t('ui.orders.bulk.updated'), { n: ids.length }), 'success');
            setSelectedIds(new Set()); // Clear selection
            await fetchOrders();
        } catch (error) {
            console.error('Bulk edit failed:', error);
            showToast(t('ui.orders.bulk.updateFailed'), 'error');
        }
    };



    // Render Helpers
    const handleSort = (key: string) => {
        if (UNSORTABLE_COLUMNS.has(key)) return;
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const SortIcon = ({ columnKey }: { columnKey: string }) => {
        if (UNSORTABLE_COLUMNS.has(columnKey)) return null;
        if (sortConfig?.key !== columnKey) return <ChevronsUpDown size={14} style={{ opacity: 0.3 }} />;
        return sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
    };

    // UI Helpers & Components

    // Legacy helper for Modal (can eventually reuse above logic properly)
    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'Pending': return <span style={{ background: '#FEF3C7', color: '#D97706', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> {statusText('Pending')}</span>;
            case 'Shipped': return <span style={{ background: '#DBEAFE', color: '#2563EB', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}><Truck size={12} /> {statusText('Shipped')}</span>;
            case 'Delivered': return <span style={{ background: '#D1FAE5', color: '#059669', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle size={12} /> {statusText('Delivered')}</span>;
            case 'Cancelled': return <span style={{ background: '#FEE2E2', color: '#DC2626', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}><X size={12} /> {statusText('Cancelled')}</span>;
            default: return <span>{statusText(status)}</span>;
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
        if (!confirm(originals.length > 1 ? fill(t('ui.orders.dup.confirmMany'), { n: originals.length }) : t('ui.orders.dup.confirmOne'))) return;

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
            showToast(fill(created > 1 ? t('ui.orders.dup.createdMany') : t('ui.orders.dup.createdOne'), { n: created }), 'success');
        } catch (error) {
            console.error('Failed to duplicate orders:', error);
            showToast(
                fill(t('ui.orders.dup.failed'), { done: created, n: originals.length }) +
                (error instanceof Error ? error.message : t('ui.orders.dup.unknownError')),
                'error'
            );
        } finally {
            setIsDuplicating(false);
        }
    };

    // Copy payment request (row icon, mobile card): see usePaymentRequest.
    const paymentRequest = usePaymentRequest(sales);

    const handleCopyOrder = async (order: Sale) => {
        const ok = await copyText(generateOrderCopyText(order, sales));
        showToast(t(ok ? 'ui.orders.toast.copied' : 'ui.orders.toast.copyFailed'), ok ? 'success' : 'error');
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
            {t('ui.orders.empty.searching')}
        </div>
    ) : hasFilters ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <Filter size={32} style={{ opacity: 0.25 }} />
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-main)' }}>{t('ui.orders.empty.noMatch')}</div>
            <div style={{ fontSize: '13px' }}>{t('ui.orders.empty.noMatchHint')}</div>
            <button
                onClick={clearAllFilters}
                style={{ marginTop: '4px', padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#EF4444', color: 'white', fontSize: '13px', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
                <Filter size={14} /> {t('ui.orders.toolbar.clearFilters')}
            </button>
        </div>
    ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <Package size={32} style={{ opacity: 0.25 }} />
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-main)' }}>{t('ui.orders.empty.none')}</div>
            <div style={{ fontSize: '13px' }}>{t('ui.orders.empty.noneHint')}</div>
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
                                    placeholder={t('orders.search')}
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
                                    placeholder={t('ui.orders.toolbar.searchPlaceholder')}
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
                                    title={t('ui.orders.toolbar.bulkEditTitle')}
                                >
                                    <Edit size={18} />
                                    {t('ui.orders.toolbar.bulkEdit')} {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
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
                                    title={t('ui.orders.toolbar.duplicateTitle')}
                                >
                                    <Copy size={18} />
                                    {isDuplicating ? t('ui.orders.toolbar.duplicating') : fill(t('ui.orders.toolbar.duplicate'), { n: selectedIds.size })}
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
                                    title={t('ui.orders.toolbar.toggleFilters')}
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
                                        showToast(t('ui.orders.toast.refreshed'), 'success');
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
                                title={t('ui.orders.toolbar.refresh')}
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
                                            background: 'var(--color-surface)',
                                            height: '40px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <User size={16} color="var(--color-primary)" />
                                            <span style={{ fontSize: '13px', color: salesmanFilter === 'All' ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>
                                                {salesmanFilter === 'All' ? (currentUser?.roleId === 'salesman' ? currentUser.name : t('ui.orders.toolbar.salesmen')) : salesmanFilter}
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
                                                background: 'var(--color-surface)',
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
                                                    <span style={{ fontSize: '13px' }}>{currentUser?.roleId === 'salesman' ? currentUser.name : t('ui.orders.toolbar.salesmen')}</span>
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
                                            background: 'var(--color-surface)',
                                            height: '40px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <Package size={16} color="var(--color-primary)" />
                                            <span style={{ fontSize: '13px', color: statusFilter.length === 0 ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>
                                                {statusFilter.length === 0 ? t('orders.orderStatus') : fill(t('ui.orders.toolbar.nSelected'), { n: statusFilter.length })}
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
                                                background: 'var(--color-surface)',
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
                                                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#000000' }}>{t('ui.orders.toolbar.selectAll')}</span>
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
                                                        <span style={{ fontSize: '13px' }}>{statusText(status)}</span>
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
                                            background: 'var(--color-surface)',
                                            height: '40px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <Truck size={16} color="var(--color-primary)" />
                                            <span style={{ fontSize: '13px', fontWeight: 500, color: shippingCoFilter.length === 0 ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>
                                                {shippingCoFilter.length === 0 ? t('orders.shippingCo') : fill(t('ui.orders.toolbar.shippingN'), { n: shippingCoFilter.length })}
                                            </span>
                                        </div>
                                        <ChevronDown size={14} color="var(--color-text-secondary)" />
                                    </button>
                                    {isShippingCoOpen && (
                                        <>

                                            <div className="glass-panel" style={{ position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                                                padding: '8px', width: '220px', zIndex: 100,
                                                display: 'flex', flexDirection: 'column', gap: '2px',
                                                background: 'var(--color-surface)',
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
                                                        <span style={{ fontSize: '13px', fontWeight: 500, color: '#000000' }}>{t('ui.orders.toolbar.selectAll')}</span>
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
                                                {filterShippingCompanies.length === 0 && <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', padding: '8px' }}>{t('ui.orders.toolbar.noShippingCos')}</div>}
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
                                            background: 'var(--color-surface)',
                                            height: '40px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <CreditCard size={16} color="var(--color-primary)" />
                                            <span style={{ fontSize: '13px', color: payStatusFilter.length === 0 ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>
                                                {payStatusFilter.length === 0 ? t('orders.payStatus') : fill(t('ui.orders.toolbar.nSelected'), { n: payStatusFilter.length })}
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
                                                background: 'var(--color-surface)',
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
                                                        checked={payStatusFilter.length === PAY_STATUS_FILTER_OPTIONS.length}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setPayStatusFilter(PAY_STATUS_FILTER_OPTIONS);
                                                            } else {
                                                                setPayStatusFilter([]);
                                                            }
                                                        }}
                                                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                    />
                                                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#000000' }}>{t('ui.orders.toolbar.selectAll')}</span>
                                                </label>
                                                {PAY_STATUS_FILTER_OPTIONS.map(status => (
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
                                                        <span style={{ fontSize: '13px' }}>{payText(status)}</span>
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
                                            background: 'var(--color-surface)',
                                            height: '40px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <Store size={16} color="var(--color-primary)" />
                                            <span style={{ fontSize: '13px', color: pageFilter.length === 0 ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>
                                                {pageFilter.length === 0 ? t('ui.orders.toolbar.pages') : fill(t('ui.orders.toolbar.nSelected'), { n: pageFilter.length })}
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
                                                background: 'var(--color-surface)',
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
                                                        <span style={{ fontSize: '13px', fontWeight: 500, color: '#000000' }}>{t('ui.orders.toolbar.selectAll')}</span>
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
                                                {pages.length === 0 && <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', padding: '8px' }}>{t('ui.orders.toolbar.noPages')}</div>}
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
                                    title={t('ui.orders.toolbar.clearAllFilters')}
                                >
                                    <Filter size={16} /> {t('ui.orders.toolbar.clearFilters')}
                                </button>

                                
                                    </div>
                                )}
                                {
                                    hasPermission('create_orders') && !isMobile && (
                                        <button onClick={handleOpenAdd} className="primary-button" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', width: isMobile ? '100%' : 'auto', justifyContent: 'center' }}>
                                            <Plus size={18} /> {t('dashboard2.newOrder')}
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
                                            title={t('ui.orders.toolbar.tools')}
                                        >
                                            <Settings size={18} />
                                        </button>

                                        {showTools && (
                                            <div className="glass-panel" style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px',
                                                padding: '8px', width: '220px', zIndex: 100,
                                                display: 'flex', flexDirection: 'column', gap: '4px',
                                                background: 'var(--color-surface)',
                                                boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                                            }}>
                                                <div ref={columnMenuRef} style={{ position: 'relative', width: '100%' }}>
                                                    <button
                                                        onClick={() => setShowColumnMenu(!showColumnMenu)}
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
                                                        <span style={{ flex: 1, textAlign: 'left' }}>{t('ui.orders.toolbar.columns')}</span>
                                                        <ChevronRight size={14} color="var(--color-text-secondary)" />
                                                    </button>
                                                    {showColumnMenu && (
                                                        <div className="glass-panel" style={{ position: 'absolute', top: 0, right: '100%', marginRight: '8px',
                                                            padding: '16px', width: '200px', zIndex: 101, maxHeight: '300px', overflowY: 'auto',
                                                            display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--color-surface)',
                                                            boxShadow: '-4px 4px 20px rgba(0,0,0,0.1)'
                                                        }}>
                                                            <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>{t('ui.orders.toolbar.toggleColumns')}</h4>
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
                                                    {t('common.export')} {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
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
                                                        {t('common.import')}
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
                                                        {t('common.delete')} {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
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
                                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>{t('common.filter')}</h3>
                                <button onClick={() => setIsFilterDrawerOpen(false)} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text-muted)', width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Search */}
                            <div style={{ position: 'relative' }}>
                                <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                                <input
                                    type="text"
                                    placeholder={t('orders.search')}
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
                                    title={t('dashboard2.refresh')}
                                    style={{ width: '40px', height: '40px', borderRadius: '10px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                                >
                                    <RefreshCw size={17} />
                                </button>
                            </div>

                            {/* Expanded filter groups */}
                            <DrawerChipGroup
                                title={t('orders.orderStatus')}
                                optionLabel={statusText}
                                options={['Drafted', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned', 'ReStock', 'Cancelled']}
                                selected={statusFilter}
                                onToggle={(v) => setStatusFilter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])}
                            />
                            <DrawerChipGroup
                                title={t('orders.payStatus')}
                                optionLabel={payText}
                                options={PAY_STATUS_FILTER_OPTIONS}
                                selected={payStatusFilter}
                                onToggle={(v) => setPayStatusFilter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])}
                            />
                            <DrawerChipGroup
                                title={t('orders.salesman')}
                                options={users.map(u => u.name)}
                                selected={salesmanFilter === 'All' ? [] : [salesmanFilter]}
                                onToggle={(v) => setSalesmanFilter(salesmanFilter === v ? 'All' : v)}
                            />
                            <DrawerChipGroup
                                title={t('orders.shippingCo')}
                                options={shippingCompanies}
                                selected={shippingCoFilter}
                                onToggle={(v) => setShippingCoFilter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])}
                            />
                            <DrawerChipGroup
                                title={t('dashboard2.page')}
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
                                    {t('ui.orders.filter.clear')}
                                </button>
                                <button
                                    onClick={() => setIsFilterDrawerOpen(false)}
                                    className="primary-button"
                                    style={{ flex: 1, padding: '12px', borderRadius: '12px', fontWeight: 600, fontSize: '14px' }}
                                >
                                    {t('common.filter')}
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
                        maxHeight: isMobile ? 'none' : 'calc(var(--vh-full) - 200px)',
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
                                        <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> {t('ui.orders.mobile.loading')}
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
                                        onCopyPaymentRequest={paymentRequest.canRequest(order) ? (o) => { void paymentRequest.copy(o); } : undefined}
                                        trackingUrl={buildTrackingUrl(order.shipping?.company, order.shipping?.trackingNumber, trackingUrlTemplates)}
                                        carrierStatus={(() => {
                                            const row = trackingMap[order.shipping?.trackingNumber || ''];
                                            if (!row) return null;
                                            return row.error
                                                ? { status: t('ui.orders.track.checkFailed'), ago: timeAgo(row.checked_at), delivered: false }
                                                : { status: `${row.is_delivered ? '✓ ' : ''}${row.last_status || '—'}`, ago: timeAgo(row.checked_at), delivered: !!row.is_delivered };
                                        })()}
                                        onUpdateStatus={(id, status) => {
                                            // Checked before any modal opens — the store rejects these
                                            // transitions anyway, and it's needless to make someone fill
                                            // in payment details first. Admins fall through: the store
                                            // shows them a confirm and lets them force the change.
                                            if (!isAdmin && POST_DISPATCH_STATUSES.includes(status) && !canEnterPostDispatch(order, status)) {
                                                showToast(postDispatchMessage(order.shipping?.status || 'Pending', status), 'error');
                                                return;
                                            }
                                            if (status === 'ReStock' && !canRestock) {
                                                showToast(t('ui.orders.toast.noRestockPermission'), 'error');
                                                return;
                                            }
                                            if (order.shipping?.status === 'ReStock' && status === 'Drafted') {
                                                // Admin reopening a restocked order (see desktop handler).
                                                // In sequence: updateOrder must see the Drafted status the
                                                // first call wrote, and nothing follows a refused change.
                                                updateOrderStatus(id, 'Drafted', undefined, undefined, { shownStatus: order.shipping?.status || 'Pending' })
                                                    .then(moved => { if (moved) return updateOrder(id, { paymentStatus: 'Unpaid', amountReceived: 0, settleDate: null as any, shipping: { ...order.shipping, status: 'Drafted' } as any }); })
                                                    .catch(e => { console.error('Status change failed:', e); showToast(t('ui.orders.toast.statusFailed'), 'error'); });
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
                                                    // false: refused or changed elsewhere (already
                                                    // explained) — don't go on to the payment side.
                                                    // shownStatus: refused if the order is no longer
                                                    // at the status this card showed.
                                                    if (!(await updateOrderStatus(id, status, undefined, undefined, { shownStatus: order.shipping?.status || 'Pending' }))) return;
                                                    if (status === 'ReStock') {
                                                        // updateOrderStatus ran the Restock flow (stock, return record, payment Cancel —
                                                        // PdFee kept — and income cleanup). Nothing more to do here.
                                                    } else if (status === 'Returned' || status === 'Cancelled') {
                                                        // null, not undefined — updateOrder skips undefined fields,
                                                        // which left the old settle_date on cancelled orders.
                                                        await updateOrder(id, { paymentStatus: 'Cancel', amountReceived: 0, settleDate: null as any, shipping: { ...order.shipping, status } as any });
                                                        // Then ask why (Skip allowed): the move above stuck,
                                                        // even if the payment side was refused.
                                                        setReasonTarget({ order, status });
                                                    }
                                                } catch (e) {
                                                    console.error('Status change failed:', e);
                                                    showToast(t('ui.orders.toast.statusFailed'), 'error');
                                                }
                                            })();
                                        }}
                                        onUpdatePaymentStatus={(id, status) => {
                                            if (rejectClaimIfUnpaid(order, status)) return;
                                            const updates: any = { paymentStatus: status };
                                            if (status === 'Deposit') {
                                                void openPaymentForm(order, 'Deposit');
                                                return;
                                            }
                                            if (status === 'PdFee') {
                                                void openPaymentForm(order, 'PdFee');
                                                return;
                                            }
                                            if (status === 'Paid' || status === 'Settled') {
                                                // Same flow as desktop: capture Pay By + settle date
                                                // in the settle modal instead of silently defaulting.
                                                void openPaymentForm(order, 'Paid');
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
                                            updateOrder(id, { ...updates, expectedPaymentStatus: order.paymentStatus });
                                        }}
                                        canEdit={canEdit}
                                        isAdmin={isAdmin}
                                        canRestock={canRestock}
                                        canConfirmPayments={canConfirmPayments}
                                        isSalesman={isSalesmanUser}
                                        claimTitle={claimOpen(order) ? claimTooltip(order.paymentClaim!) : undefined}
                                        claimDisabledOptions={claimDisabledOptions(order)}
                                        salesmanDisabledOptions={salesmanDisabled}
                                    />
                                ))}

                                {/* Infinite scroll sentinel: auto-loads the next batch near the bottom */}
                                {paginatedOrders.length > 0 && (
                                    <div ref={loadMoreSentinelRef} style={{ padding: '18px 0 6px', textAlign: 'center' }}>
                                        {isLoadingOrders ? (
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#9CA3AF', fontSize: '13px', fontWeight: 500 }}>
                                                <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> {t('ui.orders.mobile.loadingMore')}
                                            </div>
                                        ) : hasMoreMobile && paginatedOrders.length < totalCount ? (
                                            <button
                                                onClick={() => setCurrentPage(p => p + 1)}
                                                style={{ padding: '10px 22px', borderRadius: '20px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                                            >
                                                {t('ui.orders.mobile.loadOlder')}
                                            </button>
                                        ) : (
                                            <div style={{ color: '#9CA3AF', fontSize: '12px' }}>{fill(t('ui.orders.mobile.allLoaded'), { n: totalCount })}</div>
                                        )}
                                    </div>
                                )}

                                {/* Mobile FAB - New Order */}
                                {hasPermission('create_orders') && (
                                    <button
                                        className="mobile-fab"
                                        onClick={handleOpenAdd}
                                        aria-label={t('dashboard2.newOrder')}
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
                                    background: 'var(--color-surface)',
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
                                        <div style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('dashboard2.orders')}</div>
                                        <div style={{ fontSize: '18px', fontWeight: '800', color: '#111827' }}>{totalCount}</div>
                                    </div>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('ui.orders.mobile.loaded')}</div>
                                        <div style={{ fontSize: '14px', fontWeight: '700', color: '#374151' }}>{filteredOrders.length}/{totalCount}</div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('orders.total')}</div>
                                        <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--color-primary)' }}>
                                            ${(revenueTotal ?? filteredOrders.reduce((sum, order) => sum + orderRevenue(order), 0)).toFixed(2)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <>
                                <table
                                    className="spreadsheet-table"
                                    data-resize="own"
                                    style={{
                                        // 100% wide, never narrower than the sized columns (the
                                        // calc follows the live --col-*-width vars while dragging),
                                        // with an unsized filler column last that takes the spare
                                        // width. Without it a wide screen spread the spare width
                                        // over every column and dragging one moved the others.
                                        width: '100%',
                                        minWidth: `calc(40px${allColumns.filter(col => visibleColumns.includes(col.id)).map(col => ` + var(--col-${col.id}-width, ${columnWidths[col.id] ? `${columnWidths[col.id]}px` : '150px'})`).join('')})`,
                                        whiteSpace: 'nowrap',
                                        tableLayout: 'fixed',
                                        borderCollapse: 'separate',
                                        borderSpacing: 0,
                                        // Apply CSS Variables
                                        ['--table-font-size' as any]: `${tableSettings.fontSize}px`,
                                        // Header reads 4px, footer 2px larger than the body
                                        // rows (both track the Font Size slider).
                                        ['--table-header-font-size' as any]: `${tableSettings.fontSize + 4}px`,
                                        ['--table-footer-font-size' as any]: `${tableSettings.fontSize + 2}px`,
                                        ['--table-padding' as any]: `${tableSettings.padding}px 6px`, // Reduced side padding too
                                        ['--table-row-height' as any]: tableSettings.height === 'auto' ? 'auto' : tableSettings.height
                                    }}>
                                    <thead>
                                        <tr>
                                            <th style={{ width: '40px', padding: '10px 12px', position: 'sticky', left: 0, top: 0, zIndex: 40, background: 'var(--table-head)' }} className="sticky-col-first">
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
                                                    title={t('ui.orders.table.autoFitAll')}
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
                                                            borderRight: '1px solid var(--color-border)', // highlighted while dragging by utils/liveColumnResize
                                                            transition: 'border-color 0.1s',
                                                            padding: 0,
                                                            position: 'sticky',
                                                            left: isPinned ? stickyLeft : undefined,
                                                            zIndex: isPinned ? 40 : 30,
                                                            background: 'var(--table-head)',
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
                                                                cursor: UNSORTABLE_COLUMNS.has(colId) ? 'default' : 'pointer',
                                                                userSelect: 'none'
                                                            }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'visible', color: 'var(--color-text-main)' }}>
                                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 'normal' }}>{colDef?.label || colId}</span>
                                                                <SortIcon columnKey={colId} />
                                                            </div>
                                                            {colId !== 'actions' && (
                                                                <div style={{ position: 'relative', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
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
                                                                        title={t('ui.orders.table.filterColumn')}
                                                                    >
                                                                        <Filter size={14} />
                                                                    </button>
                                                                </div>
                                                            )}
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
                                            {/* Filler: unsized, takes whatever width is left (see the table style). */}
                                            <th aria-hidden style={{ padding: 0, background: 'var(--table-head)', borderBottom: '1px solid var(--color-border)' }}></th>
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
                                                                                title={['Confirmed', 'Shipped', 'Delivered'].includes(order.shipping?.status || '') ? t('ui.orders.row.printReceipt') : t('ui.orders.row.printDisabled')}
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
                                                                            {hasPermission('manage_orders') && (
                                                                                <button onClick={(e) => { e.stopPropagation(); handleOpenEdit(order); }} className="icon-button" disabled={isOrderLocked(order)} title={isOrderLocked(order) ? fill(t('ui.orders.row.lockedEdit'), { status: statusText(order.shipping?.status || '') }) : t('ui.orders.row.editOrder')} style={{ padding: '4px', background: 'transparent', border: 'none', cursor: isOrderLocked(order) ? 'not-allowed' : 'pointer', opacity: isOrderLocked(order) ? 0.35 : 1 }}>
                                                                                    <Edit size={16} color="var(--color-text-secondary)" />
                                                                                </button>
                                                                            )}
                                                                            <button onClick={(e) => { e.stopPropagation(); handleCopyOrder(order); }} className="icon-button" title={t('ui.orders.row.copyDetails')} style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                                                                                <Copy size={16} color="var(--color-text-secondary)" />
                                                                            </button>
                                                                            {(() => {
                                                                                // Kept in place (dimmed) when nothing is due so the icons don't shift.
                                                                                const can = paymentRequest.canRequest(order);
                                                                                return (
                                                                                    <button onClick={(e) => { e.stopPropagation(); if (can) void paymentRequest.copy(order); }} className="icon-button" disabled={!can}
                                                                                        title={can ? t('ui.components.orderDetails.copyPaymentRequest') : t('ui.orders.row.paymentRequestNone')}
                                                                                        aria-label={t('ui.components.orderDetails.copyPaymentRequest')}
                                                                                        style={{ padding: '4px', background: 'transparent', border: 'none', cursor: can ? 'pointer' : 'not-allowed', opacity: can ? 1 : 0.35 }}>
                                                                                        <HandCoins size={16} color="var(--color-text-secondary)" />
                                                                                    </button>
                                                                                );
                                                                            })()}
                                                                        </div>
                                                                    </td>
                                                                );
                                                            case 'date': return (
                                                                <td
                                                                    key={colId}
                                                                    style={{ ...cellStyle, cursor: 'pointer', color: 'var(--color-primary)' }}
                                                                    title={t('ui.orders.row.viewDetails')}
                                                                    onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); setIsViewModalOpen(true); }}
                                                                >
                                                                    {new Date(order.date).toLocaleDateString()}
                                                                </td>
                                                            );
                                                            case 'customer': {
                                                                const orderPhone = String(order.customer?.phone || '').trim();
                                                                const isScammer = blockedCustomers.some(bc => normalizePhone(bc.phone) === normalizePhone(orderPhone));
                                                                return (
                                                                    <td key={colId} style={cellStyle}>
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
                                                                            <span>{formatPhoneDisplay(order.customer?.phone) || '-'}</span>
                                                                        </div>
                                                                    </td>
                                                                );
                                                            }
                                                            case 'customerGroup': {
                                                                // The customer's group (by phone, so every order of
                                                                // theirs shows it); picked here to tag the customer.
                                                                const phone = order.customer?.phone;
                                                                const group = customerGroupOf(customerGroupMembers, phone);
                                                                if (!phoneDigits(phone) || !canEdit || (customerGroups.length === 0 && !group)) {
                                                                    return <td key={colId} style={{ ...cellStyle, color: group ? 'inherit' : 'var(--color-text-muted)' }} title={group}>{group || '-'}</td>;
                                                                }
                                                                return (
                                                                    <td key={colId} style={{ ...cellStyle, padding: '4px' }}>
                                                                        <select
                                                                            value={group}
                                                                            aria-label={t('ui.orders.customerGroup.column')}
                                                                            title={t('ui.orders.customerGroup.hint')}
                                                                            className="search-input"
                                                                            style={{ width: '100%', padding: '4px 6px', fontSize: 'inherit', color: group ? 'inherit' : 'var(--color-text-muted)', border: '1px solid transparent', background: 'transparent', cursor: 'pointer' }}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            onMouseDown={(e) => e.stopPropagation()}
                                                                            onPointerDown={(e) => e.stopPropagation()}
                                                                            onKeyDown={(e) => { if (e.key === ' ') e.stopPropagation(); }}
                                                                            onChange={(e) => {
                                                                                setCustomerGroup(String(phone), e.target.value, order.customer?.name)
                                                                                    .catch((err: unknown) => showToast(tNow('ui.orders.customerGroup.saveFailed', { error: (err as Error)?.message || '' }), 'error'));
                                                                            }}
                                                                        >
                                                                            <option value="">{t('ui.orders.customerGroup.none')}</option>
                                                                            {customerGroupOptions(customerGroups, group).map(g => <option key={g} value={g}>{g}</option>)}
                                                                        </select>
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
                                                            case 'total': return <td key={colId} style={{ ...cellStyle, textAlign: 'right' }}>${order.total.toFixed(2)}</td>;
                                                            case 'payBy': {
                                                                const PaymentIcon = getPaymentIcon(order.paymentMethod);
                                                                return <td key={colId} style={cellStyle}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                                                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', color: getPaymentColor(order.paymentMethod) }}>{order.paymentMethod || '-'}</span>
                                                                        {PaymentIcon && <PaymentIcon size={14} color={getPaymentColor(order.paymentMethod)} />}
                                                                    </div>
                                                                </td>;
                                                            }
                                                            case 'received': return claimOpen(order) ? (
                                                                // Entered by a Salesman, not confirmed: gray, not counted.
                                                                <td key={colId} style={{ ...cellStyle, textAlign: 'right', color: '#9CA3AF', fontStyle: 'italic' }} title={claimTooltip(order.paymentClaim!)}>
                                                                    ${order.paymentClaim!.amount.toFixed(2)}
                                                                    {order.paymentClaim!.currency === 'KHR' && Number(order.paymentClaim!.original_amount) > 0 && (
                                                                        <div style={{ fontSize: '11px', lineHeight: 1.2 }}>{formatKhr(Number(order.paymentClaim!.original_amount))}</div>
                                                                    )}
                                                                </td>
                                                            ) : <td key={colId} title={rielReceived(order)?.title} style={{
                                                                ...cellStyle,
                                                                textAlign: 'right',
                                                                // Blue = money in hand (fully paid, a deposit, or a delivery fee on an
                                                                // otherwise-cancelled order); red = outstanding.
                                                                color: (order.paymentStatus === 'Paid' || order.paymentStatus === 'Deposit' || order.paymentStatus === 'PdFee') ? '#2563EB' : '#DC2626'
                                                            }}>${(order.paymentStatus === 'Deposit'
                                                                ? (order.depositAmount || order.amountReceived || 0)
                                                                : (order.amountReceived ?? order.total)).toFixed(2)}
                                                                {rielReceived(order) && (
                                                                    // Paid in riel: the riel received, smaller, under the USD.
                                                                    <div style={{ fontSize: '11px', lineHeight: 1.2, color: 'var(--color-text-secondary)' }}>{rielReceived(order)!.text}</div>
                                                                )}</td>;
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
                                                                            status={claimOpen(order) ? order.paymentClaim!.status : (order.paymentStatus || 'Unpaid')}
                                                                            unconfirmed={claimOpen(order) ? claimTooltip(order.paymentClaim!) : undefined}
                                                                            disabledOptions={claimOpen(order) ? claimDisabledOptions(order) : [...(isAdmin ? [] : ['Cancel']), ...salesmanDisabled]}
                                                                            bold={false}
                                                                            onChange={(newStatus) => {
                                                                                if (rejectClaimIfUnpaid(order, newStatus)) return;
                                                                                const updates: any = { paymentStatus: newStatus };
                                                                                if (newStatus === 'Paid') {
                                                                                    void openPaymentForm(order, 'Paid');
                                                                                    return;
                                                                                } else if (newStatus === 'Deposit') {
                                                                                    void openPaymentForm(order, 'Deposit');
                                                                                    return;
                                                                                } else if (newStatus === 'PdFee') {
                                                                                    void openPaymentForm(order, 'PdFee');
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
                                                                                updateOrder(order.id, { ...updates, expectedPaymentStatus: order.paymentStatus });
                                                                            }}
                                                                            // Admins bypass the lock so they can correct mistakes
                                                                            // (e.g. un-mark a wrong Paid); the store cleans up the
                                                                            // logged income when leaving Paid.
                                                                            readOnly={claimOpen(order)
                                                                                ? !canConfirmPayments
                                                                                : (!canEdit || (!isAdmin && (order.shipping?.status === 'ReStock' || order.shipping?.status === 'Drafted' || order.shipping?.status === 'Returned' || order.shipping?.status === 'Cancelled' || paymentLockedForNonAdmin(order))))}
                                                                        />
                                                                    </td>
                                                                );
                                                            case 'balance': {
                                                                const balance = orderBalance(order);
                                                                return (
                                                                    <td key={colId} style={{ ...cellStyle, color: balance > 0 ? '#DC2626' : '#059669', textAlign: 'right' }}>
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
                                                                            bold={false}
                                                                            unrestricted={isAdmin}
                                                                            // Admins are never locked out — the store warns them (with a
                                                                            // confirm) before any transition that skips the stock flow.
                                                                            readOnly={!canEdit || (!isAdmin && (order.shipping?.status === 'ReStock' || order.shipping?.status === 'Returned' || order.shipping?.status === 'Cancelled' || order.paymentStatus === 'Cancel'))}
                                                                            disabledOptions={isAdmin ? (canRestock ? [] : ['ReStock']) : ((order.shipping?.status === 'Shipped')
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
                                                                                // stock on delete that was never deducted. Admins fall
                                                                                // through: the store confirms and lets them force it.
                                                                                if (!isAdmin && POST_DISPATCH_STATUSES.includes(newStatus) && !canEnterPostDispatch(order, newStatus)) {
                                                                                    showToast(postDispatchMessage(order.shipping?.status || 'Pending', newStatus), 'error');
                                                                                    return;
                                                                                }
                                                                                if (newStatus === 'ReStock' && !canRestock) {
                                                                                    showToast(t('ui.orders.toast.noRestockPermission'), 'error');
                                                                                    return;
                                                                                }
                                                                                if (order.shipping?.status === 'ReStock' && newStatus === 'Drafted') {
                                                                                    // Admin reopening a restocked order: back to Drafted with
                                                                                    // payment reset so it can run the normal flow again
                                                                                    // (stock deducts fresh when it ships).
                                                                                    // In sequence: updateOrder must see the Drafted status the
                                                                                    // first call wrote, and nothing follows a refused change.
                                                                                    updateOrderStatus(order.id, 'Drafted', undefined, undefined, { shownStatus: order.shipping?.status || 'Pending' })
                                                                                        .then(moved => { if (moved) return updateOrder(order.id, { paymentStatus: 'Unpaid', amountReceived: 0, settleDate: null as any, shipping: { ...order.shipping, status: 'Drafted' } as any }); })
                                                                                        .catch(e => { console.error('Status change failed:', e); showToast(t('ui.orders.toast.statusFailed'), 'error'); });
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
                                                                                        // false: refused or changed elsewhere (already
                                                                                        // explained) — don't go on to the payment side.
                                                                                        // shownStatus: refused if the order is no longer
                                                                                        // at the status this row showed.
                                                                                        if (!(await updateOrderStatus(order.id, newStatus as any, undefined, undefined, { shownStatus: order.shipping?.status || 'Pending' }))) return;
                                                                                        if (newStatus === 'ReStock') {
                                                                                            // updateOrderStatus ran the Restock flow (stock, return record, payment Cancel —
                                                                                            // PdFee kept — and income cleanup). Nothing more to do here.
                                                                                        } else if (newStatus === 'Returned' || newStatus === 'Cancelled') {
                                                                                            // null, not undefined — updateOrder skips undefined fields,
                                                                                            // which left the old settle_date on cancelled orders.
                                                                                            await updateOrder(order.id, { paymentStatus: 'Cancel', amountReceived: 0, settleDate: null as any, shipping: { ...order.shipping, status: newStatus } as any });
                                                                                            // Then ask why (Skip allowed): the move above stuck,
                                                                                            // even if the payment side was refused.
                                                                                            setReasonTarget({ order, status: newStatus });
                                                                                        }
                                                                                    } catch (e) {
                                                                                        console.error('Status change failed:', e);
                                                                                        showToast(t('ui.orders.toast.statusFailed'), 'error');
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
                                                                            placeholder={t('ui.orders.row.addId')}
                                                                            style={{
                                                                                width: '100%',
                                                                                padding: '4px 8px',
                                                                                fontSize: 'inherit',
                                                                                color: 'inherit',
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
                                                                                    // The status sent back is only what this row showed, not a
                                                                                    // request to move it: if the order moved on since, the
                                                                                    // database's status is kept (no shipment undone or replayed).
                                                                                    updateOrder(order.id, { shipping: updatedShipping, expectedShippingStatus: order.shipping?.status || 'Pending' });
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
                                                                        {/* Carrier link + cached carrier status (Phase 1 + 2 tracking).
                                                                            Always rendered (just invisible when there's nothing to show)
                                                                            so every row reserves the same height — otherwise a row only
                                                                            grew taller once its tracking ID resolved to carrier data. */}
                                                                        {(() => {
                                                                            const no = order.shipping?.trackingNumber || '';
                                                                            const url = no ? buildTrackingUrl(order.shipping?.company, no, trackingUrlTemplates) : null;
                                                                            const row = no ? trackingMap[no] : undefined;
                                                                            const eventsTip = row?.events?.slice(0, 4).map(ev => `${ev.time}  ${ev.status}${ev.desc ? ' — ' + ev.desc : ''}`).join('\n');
                                                                            const hasContent = !!(url || row);
                                                                            return (
                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0 8px 2px', fontSize: '10px', lineHeight: 1.3, minWidth: 0, visibility: hasContent ? 'visible' : 'hidden' }} onClick={(e) => e.stopPropagation()}>
                                                                                    <span
                                                                                        title={row?.error ? fill(t('ui.orders.track.lastCheckFailed'), { error: row.error }) : (eventsTip || row?.last_status || '')}
                                                                                        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: row?.error ? '#B45309' : (row?.is_delivered ? '#059669' : 'var(--color-text-secondary)') }}
                                                                                    >
                                                                                        {row ? (row.error ? t('ui.orders.track.checkFailedShort') : `${row.is_delivered ? '✓ ' : ''}${row.last_status || '—'}`) : ' '}
                                                                                        {row && <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}> · {timeAgo(row.checked_at)}</span>}
                                                                                    </span>
                                                                                    {url && (
                                                                                        <a href={url} target="_blank" rel="noopener noreferrer" title={t('ui.orders.track.openCarrier')} style={{ marginLeft: 'auto', color: 'var(--color-primary)', whiteSpace: 'nowrap', textDecoration: 'none' }}>
                                                                                            {t('ui.orders.track.link')}
                                                                                        </a>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        })()}
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
                                                                            placeholder={t('ui.orders.row.addRemark')}
                                                                            style={{
                                                                                width: '100%',
                                                                                padding: '4px 8px',
                                                                                fontSize: 'inherit',
                                                                                color: 'inherit',
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
                                                            case 'deliveryType': {
                                                                const dt = courierDeliveryType(courierDeliveryTypes, order.shipping?.company);
                                                                return <td key={colId} style={{ ...cellStyle, color: dt ? 'inherit' : 'var(--color-text-muted)' }} title={dt}>{dt || '-'}</td>;
                                                            }
                                                            case 'returnReason': {
                                                                // Settable on Returned / Cancelled / ReStock orders. A
                                                                // reason left on a reopened order still shows (and can
                                                                // be cleared), so the cell matches the filter and sort.
                                                                const applies = reasonApplies(order.shipping?.status);
                                                                if (!applies && !order.returnReason) return <td key={colId} style={cellStyle}>-</td>;
                                                                if (!canEdit) return <td key={colId} style={cellStyle} title={order.returnReason || ''}>{order.returnReason || '-'}</td>;
                                                                const opts = reasonOptions(rejectionReasons, order.returnReason);
                                                                return (
                                                                    <td key={colId} style={{ ...cellStyle, padding: '4px' }}>
                                                                        <select
                                                                            value={order.returnReason || ''}
                                                                            aria-label={t('ui.orders.returnReason.column')}
                                                                            className="search-input"
                                                                            style={{ width: '100%', padding: '4px 6px', fontSize: 'inherit', color: order.returnReason ? 'inherit' : 'var(--color-text-muted)', border: '1px solid transparent', background: 'transparent', cursor: 'pointer' }}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            onMouseDown={(e) => e.stopPropagation()}
                                                                            onPointerDown={(e) => e.stopPropagation()}
                                                                            onKeyDown={(e) => { if (e.key === ' ') e.stopPropagation(); }}
                                                                            onChange={(e) => {
                                                                                const v = e.target.value;
                                                                                if (v === OTHER_REASON) { setReasonTarget({ order, status: order.shipping?.status || 'Returned' }); return; }
                                                                                if (v !== (order.returnReason || '')) updateOrder(order.id, { returnReason: v || null });
                                                                            }}
                                                                        >
                                                                            <option value="">{t('ui.orders.returnReason.none')}</option>
                                                                            {opts.map(r => <option key={r} value={r}>{r}</option>)}
                                                                            <option value={OTHER_REASON}>{t('ui.orders.returnReason.otherEllipsis')}</option>
                                                                        </select>
                                                                    </td>
                                                                );
                                                            }
                                                            case 'lastEdit':
                                                                return (
                                                                    <td key={colId} style={cellStyle}>
                                                                        <div style={{ display: 'flex', flexDirection: 'column', fontSize: '11px', lineHeight: '1.2' }}>
                                                                            <span>{order.lastEditedBy || '-'}</span>
                                                                            {order.lastEditedAt && (
                                                                                <span style={{ color: 'var(--color-text-secondary)', fontSize: '10px' }}>
                                                                                    {new Date(order.lastEditedAt).toLocaleString()}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                );
                                                            case 'settleDate': {
                                                                // Settle date once fully Paid or PdFee (the date the
                                                                // delivery fee was paid); the deposit's own date while
                                                                // only Deposited. Gated on the order's current Pay
                                                                // Status (not just whether the fields happen to be
                                                                // set) — depositDate/settleDate are deliberately kept
                                                                // on the order even after it's reverted to Unpaid/
                                                                // Cancel/etc. for financial-record reasons, so showing
                                                                // them unconditionally would leave a stale date here.
                                                                const displayDate = (order.paymentStatus === 'Paid' || order.paymentStatus === 'Deposit' || order.paymentStatus === 'PdFee')
                                                                    ? (order.settleDate || order.depositDate)
                                                                    : null;
                                                                return <td key={colId} style={cellStyle}>{displayDate ? new Date(displayDate).toLocaleDateString() : '-'}</td>;
                                                            }
                                                            default: return <td key={colId} style={cellStyle}>-</td>;
                                                        }
                                                    })}
                                                    <td aria-hidden style={{ padding: 0 }}></td>
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
                                            <td className="sticky-col-first" style={{ background: 'var(--color-bg)', borderTop: '2px solid var(--color-border)', position: 'sticky', left: 0, zIndex: 20, fontWeight: 'normal' }}></td>
                                            {allColumns.filter(col => visibleColumns.includes(col.id)).map((col) => {
                                                const colId = col.id;
                                                const isPinned = (pinnedOrderColumns || []).includes(colId);
                                                const stickyLeft = getStickyLeft(colId);

                                                const commonStyle = {
                                                    padding: '8px 12px',
                                                    // 2px above the body font, tracking the slider.
                                                    fontSize: 'var(--table-footer-font-size, 14px)',
                                                    // .spreadsheet-table tfoot td is bold by default (index.css) —
                                                    // overridden here since it's shared with other tables (e.g.
                                                    // Delivery Tracking) that still want it.
                                                    fontWeight: 'normal' as const,
                                                    borderTop: '2px solid var(--color-border)',
                                                    background: 'var(--color-bg)',
                                                    textAlign: 'left' as const,
                                                    position: isPinned ? 'sticky' as const : undefined,
                                                    left: isPinned ? stickyLeft : undefined,
                                                    zIndex: isPinned ? 20 : 1,
                                                    boxShadow: isPinned ? '2px 0 5px rgba(0,0,0,0.05)' : 'none'
                                                };

                                                if (colId === 'actions') {
                                                    return <td key={colId} style={{ ...commonStyle, minWidth: '100px' }}>{fill(t('ui.orders.footer.totalN'), { n: stats.totalOrders })}</td>;
                                                }
                                                if (colId === 'total') return <td key={colId} style={{ ...commonStyle, textAlign: 'right' }}>${stats.totalRevenue.toFixed(2)}</td>;
                                                if (colId === 'received') return <td key={colId} style={{ ...commonStyle, textAlign: 'right', color: '#2563EB' }}>${stats.totalReceived.toFixed(2)}</td>;
                                                if (colId === 'balance') return <td key={colId} style={{ ...commonStyle, textAlign: 'right', color: 'var(--color-red)' }}>${stats.totalOutstanding.toFixed(2)}</td>;
                                                if (colId === 'items') return <td key={colId} style={{ ...commonStyle }}>{stats.totalProducts} {t('dashboard2.pieces')}</td>;

                                                return <td key={colId} style={commonStyle}></td>;
                                            })}
                                            <td aria-hidden style={{ padding: 0, background: 'var(--color-bg)', borderTop: '2px solid var(--color-border)' }}></td>
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
                                <span style={{ fontWeight: 600 }}>{fill(t('ui.orders.bulk.nSelected'), { n: selectedIds.size })}</span>
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
                                        showToast(fill(t('ui.orders.scammer.unblockedN'), { n: phonesToUnblock.length }), 'success');
                                        setSelectedIds(new Set());
                                    }} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: '#ECFCCB', color: '#65A30D', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                                        <ShieldCheck size={18} /> {t('ui.orders.scammer.unblock')}
                                    </button>
                                ) : (
                                    <button type="button" onClick={(e) => { e.preventDefault(); setScammerTargetOrder(null); setIsScammerModalOpen(true); }} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: '#FEF2F2', color: '#DC2626', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                                        <ShieldOff size={18} /> {t('ui.orders.scammer.mark')}
                                    </button>
                                ))}
                                {isAdmin && (
                                    <button type="button" onClick={handleBulkDelete} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: '#FEE2E2', color: '#DC2626', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                                        <Trash2 size={18} /> {t('common.delete')}
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
                                            <RefreshCw size={18} /> {t('ui.orders.bulk.restock')}
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
                                {fill(t('ui.orders.footer.showing'), { from: Math.min((currentPage - 1) * itemsPerPage + 1, filteredOrders.length), to: Math.min(currentPage * itemsPerPage, filteredOrders.length), n: filteredOrders.length })}
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
                                                {statusText(status)}: <strong style={{ fontSize: '11px' }}>{count}</strong>
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
                                            const payStatuses = ['Unpaid', 'Deposit', 'Get File', 'Paid', 'PdFee', 'Cancel', 'Settled', 'Not Settle', 'Pending'];
                                            const getPayStatusColors = (s: string) => {
                                                switch (s) {
                                                    case 'Paid': return { bg: '#D1FAE5', color: '#059669' };
                                                    case 'Deposit': return { bg: '#F3E8FF', color: '#7E22CE' };
                                                    case 'Get File': return { bg: '#DBEAFE', color: '#1D4ED8' };
                                                    case 'PdFee': return { bg: '#CFFAFE', color: '#0E7490' };
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
                                                        {payText(status)}: <strong style={{ fontSize: '11px' }}>{count}</strong>
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
                                <span>{t('ui.orders.footer.rowsPerPage')}</span>
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
                                    <option value={999999}>{t('ui.orders.footer.allRows')}</option>
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
                                    {t('ui.orders.footer.page')} <span style={{ color: 'var(--color-text-main)', fontWeight: 600 }}>{currentPage}</span> {fill(t('ui.orders.footer.ofN'), { n: Math.max(1, Math.ceil(totalCount / itemsPerPage)) })}
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
                                        {isLoadingMore ? t('common.loading') : t('ui.orders.footer.loadOlder')}
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
                                <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>{t('ui.orders.view.title')}</h2>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button
                                        onClick={() => {
                                            const textToCopy = generateOrderCopyText(selectedOrder, sales);
                                            navigator.clipboard.writeText(textToCopy);
                                            showToast(t('ui.orders.view.copied'), 'success');
                                        }}
                                        style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: '6px', cursor: 'pointer', padding: '6px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}
                                        title={t('ui.orders.view.copyInfo')}
                                    >
                                        <Copy size={16} /> {t('ui.orders.view.copy')}
                                    </button>
                                    <CopyPaymentRequestButton order={selectedOrder} sales={sales} short
                                        style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: '6px', cursor: 'pointer', padding: '6px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }} />
                                    <button
                                        onClick={() => window.open(`/orders/${selectedOrder.id}`, '_blank')}
                                        style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: '6px', cursor: 'pointer', padding: '6px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}
                                        title={t('ui.orders.view.openPage')}
                                    >
                                        <ExternalLink size={16} /> {t('ui.orders.view.open')}
                                    </button>
                                    {selectedOrder.customer?.phone && blockedCustomers.some(bc => normalizePhone(bc.phone) === normalizePhone(selectedOrder.customer!.phone)) ? (
                                        <button
                                            onClick={() => {
                                                removeBlockedCustomer(String(selectedOrder.customer!.phone || '').trim());
                                                showToast(t('ui.orders.scammer.unblocked'), 'success');
                                            }}
                                            style={{ background: 'none', border: '1px solid #ECFCCB', borderRadius: '6px', cursor: 'pointer', padding: '6px', color: '#65A30D', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}
                                            title={t('ui.orders.scammer.unblockTitle')}
                                        >
                                            <ShieldCheck size={16} /> {t('ui.orders.scammer.unblock')}
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => { setScammerTargetOrder(selectedOrder); setIsScammerModalOpen(true); setIsViewModalOpen(false); }}
                                            style={{ background: 'none', border: '1px solid #FEE2E2', borderRadius: '6px', cursor: 'pointer', padding: '6px', color: '#DC2626', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}
                                            title={t('ui.orders.scammer.mark')}
                                        >
                                            <ShieldOff size={16} /> {t('ui.orders.scammer.block')}
                                        </button>
                                    )}
                                    <button onClick={() => setIsViewModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><X size={24} /></button>
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '12px' }}>
                                <div>
                                    <h4 style={{ color: 'var(--color-text-secondary)', fontSize: '12px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('orders.customer')}</h4>
                                    <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '4px' }}>{selectedOrder.customer?.name}</div>
                                    <div style={{ fontSize: '14px', color: 'var(--color-text-main)' }}>{selectedOrder.customer?.phone}</div>
                                    <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>{selectedOrder.customer?.address}</div>
                                </div>
                                <div>
                                    <h4 style={{ color: 'var(--color-text-secondary)', fontSize: '12px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('ui.orders.view.orderInfo')}</h4>
                                    <div style={{ fontSize: '14px', marginBottom: '4px' }}>{t('ui.orders.view.date')} {new Date(selectedOrder.date).toLocaleString()}</div>
                                    <div style={{ fontSize: '14px', marginBottom: '4px' }}>{t('ui.orders.view.status')} {getStatusBadge(selectedOrder.shipping?.status || 'Pending')}</div>
                                    <div style={{ fontSize: '14px', marginBottom: '4px' }}>{t('ui.orders.view.platform')} {selectedOrder.customer?.platform} ({selectedOrder.customer?.page})</div>
                                    <div style={{ fontSize: '14px', marginTop: '8px', wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <ExternalLink size={14} style={{ color: 'var(--color-primary)' }} />
                                        <a href={`/orders/${selectedOrder.id}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
                                            {t('ui.orders.view.openOrderPage')}
                                        </a>
                                    </div>
                                </div>
                            </div>

                            <div style={{ background: 'rgba(0,0,0,0.03)', borderRadius: '12px', padding: '20px', marginBottom: '12px' }}>
                                <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>{t('ui.orders.view.items')}</h4>
                                {selectedOrder.items.map((item, i) => (
                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px' }}>
                                        <span>{item.name} <span style={{ color: 'var(--color-text-secondary)' }}>x{item.quantity}</span></span>
                                        <span>${(item.price * item.quantity).toFixed(2)}</span>
                                    </div>
                                ))}
                                <div style={{ borderTop: '1px solid var(--color-border)', marginTop: '12px', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '16px' }}>
                                    <span>{t('orders.total')}</span>
                                    <span>${selectedOrder.total.toFixed(2)}</span>
                                </div>
                            </div>

                            <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)', display: 'grid', gap: '8px' }}>
                                <div style={{ color: getShippingCoColor(selectedOrder.shipping?.company || '') }}>
                                    <strong>{t('ui.orders.view.shipping')}</strong> {selectedOrder.shipping?.company} (${selectedOrder.shipping?.cost}) - {selectedOrder.shipping?.trackingNumber || t('ui.orders.view.noId')}
                                    {(() => {
                                        const url = buildTrackingUrl(selectedOrder.shipping?.company, selectedOrder.shipping?.trackingNumber, trackingUrlTemplates);
                                        const row = trackingMap[selectedOrder.shipping?.trackingNumber || ''];
                                        return (
                                            <>
                                                {url && (
                                                    <a href={url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: '8px', color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'none' }}>
                                                        {t('ui.orders.track.link')}
                                                    </a>
                                                )}
                                                {row && !row.error && (
                                                    <div style={{ marginTop: '4px', fontSize: '12px', color: row.is_delivered ? '#059669' : 'var(--color-text-secondary)' }}>
                                                        {t('ui.orders.view.carrier')} {row.is_delivered ? '✓ ' : ''}{row.last_status || '—'}{row.last_event_at ? ` (${row.last_event_at})` : ''} · {t('ui.orders.view.checked')} {timeAgo(row.checked_at)}
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                                <div><strong>{t('ui.orders.view.salesman')}</strong> {selectedOrder.salesman}</div>
                                <div><strong>{t('ui.orders.view.remark')}</strong> {selectedOrder.remark || '-'}</div>
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
            {/* Rejection reason, asked after a move to Returned / Cancelled */}
            <ReturnReasonModalComponent
                isOpen={!!reasonTarget}
                onClose={() => setReasonTarget(null)}
                order={reasonTarget ? (sales.find(s => s.id === reasonTarget.order.id) || reasonTarget.order) : null}
                status={reasonTarget?.status || 'Returned'}
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
                    onClose={() => { paymentOpenSeq.current++; setIsPaymentMethodModalOpen(false); setPaymentMethodTargetOrder(null); }}
                    initialMethod={paymentMethodTargetOrder.paymentClaim?.method || paymentMethodTargetOrder.paymentMethod || undefined}
                    initialDate={paymentMethodTargetOrder.paymentClaim?.date || paymentMethodTargetOrder.settleDate || undefined}
                    amountDue={Math.max(0, paymentMethodTargetOrder.total - (paymentMethodTargetOrder.depositAmount || 0))}
                    orderTotal={paymentMethodTargetOrder.total}
                    khrExpected={paymentMethodTargetOrder.paymentClaim?.status === 'Paid' && paymentMethodTargetOrder.paymentClaim.currency === 'KHR'
                        ? paymentMethodTargetOrder.paymentClaim.original_amount
                        : settleRiel
                            // Re-opening a riel payment: the riel received, at its rate.
                            ? rielToReopen(settleRiel.original_amount, settleRiel.exchange_rate,
                                Math.max(0, paymentMethodTargetOrder.total - (paymentMethodTargetOrder.depositAmount || 0)), SNAP_TOLERANCE_USD)
                            : paymentMethodTargetOrder.customKhrAmount}
                    preferInitialMethod={!!paymentMethodTargetOrder.paymentClaim?.method}
                    preferRiel={paymentMethodTargetOrder.paymentClaim?.status === 'Paid' && paymentMethodTargetOrder.paymentClaim.currency === 'KHR'
                        ? { rate: paymentMethodTargetOrder.paymentClaim.exchange_rate }
                        : settleRiel ? { rate: settleRiel.exchange_rate } : undefined}
                    initialAccountId={settlePaid ? paymentMethodTargetOrder.depositAccountId : undefined}
                    // "អ្នកដឹកប្រមូល (COD)": on for an order a courier has out / has
                    // delivered or one waiting for its payment proof, off for a
                    // direct transfer; a paid order re-opened keeps its flag.
                    codDefault={defaultCodCollected(paymentMethodTargetOrder, codPaymentMethods)}
                    description={paymentMethodTargetOrder.paymentClaim
                        ? fill(t('ui.orders.claim.confirmingDesc'), {
                            kind: paymentMethodTargetOrder.paymentClaim.status === 'Paid' ? t('ui.orders.claim.payment') : t('ui.orders.claim.deposit'),
                            by: paymentMethodTargetOrder.paymentClaim.by || t('ui.orders.claim.theSalesman'),
                            amount: Number(paymentMethodTargetOrder.paymentClaim.amount || 0).toFixed(2),
                            khr: paymentMethodTargetOrder.paymentClaim.currency === 'KHR' && paymentMethodTargetOrder.paymentClaim.original_amount ? ` = ៛${Math.round(paymentMethodTargetOrder.paymentClaim.original_amount).toLocaleString()}` : '',
                        })
                        : undefined}
                    onConfirm={({ paymentMethod, settleDate, depositAccountId, depositAccountName, money, receivedUsd, codCollected }) => {
                        // Payment only — the order/shipping status is left untouched.
                        const updates: any = { paymentStatus: 'Paid', paymentMethod, settleDate };
                        updates.amountReceived = paymentMethodTargetOrder.total;
                        // The courier collected it: the receipt debits 1210 COD
                        // receivable instead of the account picked (which is
                        // where the courier's remittance will land).
                        if (codCollected !== undefined) updates.codCollected = codCollected;
                        // A Received Amount other than the amount due changes the
                        // order's money (as the riel figure does in Select Shipping
                        // Company): total = deposit + received, the difference from
                        // the old total going into the discount (negative = an
                        // extra charge). The income booked is then exactly what
                        // was received (set_order_payment books amount received −
                        // deposit).
                        const deposit = paymentMethodTargetOrder.depositAmount || 0;
                        const due = Math.max(0, paymentMethodTargetOrder.total - deposit);
                        if (receivedUsd !== undefined && Number.isFinite(receivedUsd) && Math.abs(receivedUsd - due) > 0.005) {
                            const newTotal = Math.round((deposit + receivedUsd) * 100) / 100;
                            updates.total = newTotal;
                            updates.discount = Math.round(((Number(paymentMethodTargetOrder.discount) || 0) + (paymentMethodTargetOrder.total - newTotal)) * 100) / 100;
                            updates.amountReceived = newTotal;
                        }
                        // Riel received: the receipt shows the riel actually collected.
                        // A dollar change drops a riel override saved earlier (it
                        // was for the old amount; the receipt recomputes it).
                        if (money?.currency === 'KHR' && money.original_amount && Math.round(money.original_amount) !== Math.round(Number(paymentMethodTargetOrder.customKhrAmount) || 0)) {
                            updates.customKhrAmount = Math.round(money.original_amount);
                        } else if (!money && updates.total !== undefined && paymentMethodTargetOrder.customKhrAmount != null) {
                            updates.customKhrAmount = null;
                        }
                        updates.depositAccountId = depositAccountId;
                        updates.depositAccountName = depositAccountName;
                        // Settling books the receipt too (a Draft RCP entry on the
                        // picked account) — without this, a settled order never
                        // reaches the ledger unless someone also records it on
                        // Customer Payment.
                        updates.postToLedger = true;
                        // Riel received: the order's USD is booked, the riel
                        // amount and rate ride along on the income row.
                        // A changed total was worked out from this screen's deposit
                        // and total: the save is refused if they have moved since.
                        const expectMoney = updates.total !== undefined ? { deposit, total: paymentMethodTargetOrder.total } : undefined;
                        updateOrder(paymentMethodTargetOrder.id, updates, money || expectMoney
                            ? { ...(money ? { money: { ...money, category: 'លក់រាយ' } } : {}), ...(expectMoney ? { expectMoney } : {}) }
                            : undefined);
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
                onClose={() => { paymentOpenSeq.current++; setDepositTargetOrder(null); }}
                showDepositAccount
                claim={depositTargetOrder?.paymentClaim?.status === 'Deposit' ? depositTargetOrder.paymentClaim : undefined}
                paid={paidFor(depositTargetOrder, 'Deposit')}
                onConfirm={({ amount, method, date, depositAccountId, depositAccountName, money }) => {
                    if (!depositTargetOrder) return;
                    updateOrder(depositTargetOrder.id, {
                        paymentStatus: 'Deposit',
                        expectedPaymentStatus: depositTargetOrder.paymentStatus,
                        depositAmount: amount,
                        // depositMethod re-fills this same form's Pay By field next time
                        // it reopens; paymentMethod is the separate field the table's own
                        // Pay By column actually displays — both must carry the pick, or
                        // the column keeps showing whatever it had before the deposit.
                        depositMethod: method,
                        paymentMethod: method as any,
                        depositDate: date,
                        amountReceived: amount,
                        // Deposits book their DEP entry too (same as Payment Tracking's
                        // deposit flow) — the later settle entry only carries the
                        // REMAINDER (total − deposit), so without this the ledger
                        // would be short the deposit for every Orders-settled sale.
                        postToLedger: true,
                        depositAccountId,
                        depositAccountName
                    }, { money: { ...money, category: 'កក់ប្រាក់' } });
                    setDepositTargetOrder(null);
                }}
            />
            {/* Delivery Fee Modal */}
            <DeliveryFeeModal
                order={deliveryFeeTargetOrder}
                paid={paidFor(deliveryFeeTargetOrder, 'PdFee')}
                onClose={() => { paymentOpenSeq.current++; setDeliveryFeeTargetOrder(null); }}
                onConfirm={({ amount, method, date, depositAccountId, depositAccountName, money }) => {
                    if (!deliveryFeeTargetOrder) return;
                    updateOrder(deliveryFeeTargetOrder.id, {
                        paymentStatus: 'PdFee',
                        expectedPaymentStatus: deliveryFeeTargetOrder.paymentStatus,
                        paymentMethod: method as any,
                        settleDate: date,
                        amountReceived: amount,
                        depositAccountId,
                        depositAccountName
                    }, { money: { ...money, category: 'ថ្លៃដឹក' } });
                    setDeliveryFeeTargetOrder(null);
                }}
            />
            {/* Stock Movement Summary (shared with the Stock Movements page) — opens on today */}
            <StockMovementSummaryModal
                isOpen={isMovementSummaryOpen}
                onClose={() => setIsMovementSummaryOpen(false)}
                initialRange={{ start: new Date().toLocaleDateString('en-CA'), end: new Date().toLocaleDateString('en-CA') }}
            />
            {/* Check Stock — live stock on hand per product */}
            <CheckStockModal isOpen={isCheckStockOpen} onClose={() => setIsCheckStockOpen(false)} />
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
                offerReason
            />
            {/* Scammer Modal */}
            <Modal
                isOpen={isScammerModalOpen}
                onClose={() => { setIsScammerModalOpen(false); setScammerTargetOrder(null); setScammerReason(''); }}
                title={scammerTargetOrder ? t('ui.orders.scammer.titleOne') : t('ui.orders.scammer.titleMany')}
                width="400px"
            >
                <div style={{ padding: '20px' }}>
                    <div style={{ marginBottom: '16px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                        {scammerTargetOrder ? (
                            <>{t('ui.orders.scammer.confirmOnePre')} <strong>{scammerTargetOrder.customer?.name}</strong> ({scammerTargetOrder.customer?.phone}){t('ui.orders.scammer.confirmOnePost')}</>
                        ) : (
                            <>{t('ui.orders.scammer.confirmOnePre')} <strong>{selectedIds.size}</strong> {t('ui.orders.scammer.confirmManyPost')}</>
                        )}
                        <br />{t('ui.orders.scammer.prevented')}
                    </div>
                    <div style={{ marginBottom: '24px' }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-main)' }}>{t('ui.orders.scammer.reason')}</label>
                        <input
                            type="text"
                            value={scammerReason}
                            onChange={(e) => setScammerReason(e.target.value)}
                            className="form-input"
                            placeholder={t('ui.orders.scammer.reasonPlaceholder')}
                            autoFocus
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                        <button onClick={() => { setIsScammerModalOpen(false); setScammerTargetOrder(null); setScammerReason(''); }} className="secondary-button" style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '14px' }}>
                            {t('common.cancel')}
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
                                        showToast(t('ui.orders.scammer.markedOne'), 'success');
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
                                        showToast(fill(t('ui.orders.scammer.markedMany'), { n: customersToBlock.length }), 'success');
                                    } else {
                                        showToast(t('ui.orders.scammer.noPhone'), 'error');
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
                            {t('ui.orders.scammer.confirmBlock')}
                        </button>
                    </div>
                </div>
            </Modal>
            {/* Shipping Points Modal */}
            <Modal
                isOpen={isShippingPointModalOpen}
                onClose={() => setIsShippingPointModalOpen(false)}
                title={t('ui.orders.header.shippingPoints')}
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
                title={t('ui.orders.modal.incomeExpense')}
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
                title={t('ui.orders.modal.deletedOrders')}
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

// Named export for the dev preview (src/dev/khrCurrency-preview.tsx).
// eslint-disable-next-line react-refresh/only-export-components
export { ShippingModalComponent };
export default Orders;



