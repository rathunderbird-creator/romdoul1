// Orders Management 2 — the row drawer (spec §4.5). This is the ONLY place a
// financial field (payment status / received amount / tracking number) can
// be edited — the table itself is strictly read-only, so any inline-edit
// mistake in the table can't silently move money. Payment changes require an
// explicit window.confirm stating the dollar effect; tracking changes don't
// (no money involved).
import React, { useEffect, useState } from 'react';
import { Copy, Check, User, Tag, Package, Wallet, Truck, MessageSquare, Flag, Printer } from 'lucide-react';
import { D2, fmtMoney, tabular } from '../../dashboard2/theme';
import { DrawerShell, copyToClipboard, MutedPill, AlertPill, ORDER_STATUS_TONE, PAY_STATUS_TONE, TONE_STYLE } from '../ui2';
import { orderBalance, previewPayChange, isMissingTracking, orderStatusOf, payStatusOf, IN_HOUSE_COURIER, type Order } from '../metrics';
import type { OrderEdit, PillTone } from '../types';
import { getOperatorForPhone } from '../../../utils/telecom';
import { getShippingLogo } from '../../../utils/shipping';

type PayStatus = NonNullable<Order['paymentStatus']>;
const PAYMENT_STATUS_OPTIONS: PayStatus[] = ['Unpaid', 'Deposit', 'Paid', 'Cancel', 'Get File'];

type ShipStatus = NonNullable<Order['shipping']>['status'];
// Every status the app models. Not every transition between them is
// actually allowed — updateOrderStatus (StoreContext) owns those rules
// (e.g. a Delivered/Returned order is locked) and rejects an invalid one
// with its own alert(); the drawer doesn't duplicate that logic, it just
// offers the full list and lets the save fail loudly if the move isn't
// allowed, same as every other status control in this app.
const ORDER_STATUS_OPTIONS: ShipStatus[] = ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Drafted', 'Cancelled', 'Returned', 'ReStock'];

interface RowDrawerProps {
    order: Order | null;
    isOpen: boolean;
    onClose: () => void;
    onSave: (edit: OrderEdit) => Promise<void>;
    onPrint: (order: Order) => void;
    salesmen: string[];
    customerCare: string[];
    paymentMethods: string[];
}

interface EditableBaseline {
    paymentStatus: PayStatus;
    amountReceived: number;
    paymentMethod: string;
    settleDate: string; // YYYY-MM-DD, '' = unset
    orderStatus: ShipStatus;
    trackingNumber: string;
}

interface DetailsBaseline {
    address: string;
    pageSource: string;
    salesman: string;
    customerCare: string;
    remark: string;
}

// order.settleDate (ISO) <-> a <input type="date"> value.
const isoToDateInput = (iso: string | undefined): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// "Sep 7, 2026, 3:45 PM" from an ISO timestamp — distinct from theme.ts's
// fmtDay, which only formats a bare YYYY-MM-DD day key.
const fmtDateTime = (iso: string | undefined): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
    <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${D2.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: D2.muted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
            {icon}
            {title}
        </div>
        {children}
    </div>
);

// A single stat in the header's at-a-glance summary and the Payment
// section's Total/Owed pair — same tinted-card treatment so the two most
// important numbers read as numbers, not just another label/value row.
const StatBox: React.FC<{ label: string; value: React.ReactNode; tone?: 'neutral' | 'amber' }> = ({ label, value, tone = 'neutral' }) => (
    <div style={{
        flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 8,
        background: tone === 'amber' ? D2.amberBg : '#f8fafc',
        border: `1px solid ${tone === 'amber' ? '#fde3c4' : D2.border}`,
    }}>
        <div style={{ fontSize: 10.5, color: D2.muted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: tone === 'amber' ? D2.amber : D2.ink, ...tabular }}>{value}</div>
    </div>
);

const Field: React.FC<{
    label: string;
    value: React.ReactNode;
    khmer?: boolean;
    truncate?: boolean;
    fullText?: string;
    style?: React.CSSProperties;
    // Customer section only (per spec of this change) — makes the person's
    // own details scannable at a glance against the rest of the drawer's
    // regular-weight text.
    bold?: boolean;
}> = ({ label, value, khmer, truncate, fullText, style, bold }) => (
    <div style={{ marginBottom: 10, minWidth: 0, ...style }}>
        <div style={{ fontSize: 11, color: D2.muted, marginBottom: 2 }}>{label}</div>
        <div
            className={khmer ? 'om2-khmer' : undefined}
            title={fullText}
            style={{
                fontSize: 13, color: D2.ink, fontWeight: bold ? 700 : 400,
                ...(truncate ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}),
            }}
        >
            {value}
        </div>
    </div>
);

const saveButtonStyle = (enabled: boolean): React.CSSProperties => ({
    padding: '7px 14px',
    borderRadius: 8,
    border: 'none',
    background: enabled ? D2.blue : '#c9d3e0',
    color: '#fff',
    fontSize: 13,
    fontWeight: 700,
    cursor: enabled ? 'pointer' : 'not-allowed',
});

// Default (white) background — just the text takes on the same tone color
// the status pill for this value gets in the Orders Management 2 table
// (MutedPill / ORDER_STATUS_TONE / PAY_STATUS_TONE in ../ui2), so the select
// still reads as "this status" at a glance without a tinted box around it.
const statusSelectStyle = (tone: PillTone): React.CSSProperties => {
    const s = TONE_STYLE[tone];
    return { width: '100%', padding: '7px 8px', borderRadius: 8, border: `1px solid ${D2.border}`, fontSize: 13, fontWeight: 600, color: s.fg, background: D2.card };
};

const RowDrawer: React.FC<RowDrawerProps> = ({ order, isOpen, onClose, onSave, onPrint, salesmen, customerCare: customerCareOptions, paymentMethods }) => {
    // All hooks unconditional (Rules of Hooks) — the !order guard comes after.
    const [paymentStatus, setPaymentStatus] = useState<PayStatus>('Unpaid');
    const [amountReceivedInput, setAmountReceivedInput] = useState('0');
    const [paymentMethod, setPaymentMethod] = useState('');
    const [settleDateInput, setSettleDateInput] = useState('');
    const [orderStatus, setOrderStatus] = useState<ShipStatus>('Pending');
    const [trackingNumber, setTrackingNumber] = useState('');
    // The last known-saved values. Local edits are diffed against this (not
    // against `order` directly) so a successful save clears "dirty" even
    // though the `order` prop itself won't reflect the change until the
    // container's next refetch.
    const [baseline, setBaseline] = useState<EditableBaseline>({ paymentStatus: 'Unpaid', amountReceived: 0, paymentMethod: '', settleDate: '', orderStatus: 'Pending', trackingNumber: '' });
    const [paySaving, setPaySaving] = useState(false);
    const [paySaved, setPaySaved] = useState(false);
    const [trackingSaving, setTrackingSaving] = useState(false);
    const [trackingSaved, setTrackingSaved] = useState(false);
    const [phoneCopied, setPhoneCopied] = useState(false);

    // Address / page / salesman / customer care / remark — grouped into one
    // "Details" save since none of them are financial or status-sensitive
    // (unlike Payment/Shipping, which each keep their own confirm+save).
    const [addressInput, setAddressInput] = useState('');
    const [pageSourceInput, setPageSourceInput] = useState('');
    const [salesmanInput, setSalesmanInput] = useState('');
    const [customerCareInput, setCustomerCareInput] = useState('');
    const [remarkInput, setRemarkInput] = useState('');
    const [detailsBaseline, setDetailsBaseline] = useState<DetailsBaseline>({ address: '', pageSource: '', salesman: '', customerCare: '', remark: '' });
    const [detailsSaving, setDetailsSaving] = useState(false);
    const [detailsSaved, setDetailsSaved] = useState(false);

    // Re-seed local edit state whenever a (different) order is opened.
    useEffect(() => {
        if (!order || !isOpen) return;
        const seed: EditableBaseline = {
            paymentStatus: order.paymentStatus || 'Unpaid',
            amountReceived: order.amountReceived ?? 0,
            paymentMethod: order.paymentMethod || '',
            settleDate: isoToDateInput(order.settleDate),
            orderStatus: order.shipping?.status || 'Pending',
            trackingNumber: order.shipping?.trackingNumber || '',
        };
        setPaymentStatus(seed.paymentStatus);
        setAmountReceivedInput(String(seed.amountReceived));
        setPaymentMethod(seed.paymentMethod);
        setSettleDateInput(seed.settleDate);
        setOrderStatus(seed.orderStatus);
        setTrackingNumber(seed.trackingNumber);
        setBaseline(seed);
        setPaySaved(false);
        setTrackingSaved(false);

        const detailsSeed: DetailsBaseline = {
            address: order.customer?.address || '',
            pageSource: order.pageSource || '',
            salesman: order.salesman || '',
            customerCare: order.customerCare || '',
            remark: order.remark || '',
        };
        setAddressInput(detailsSeed.address);
        setPageSourceInput(detailsSeed.pageSource);
        setSalesmanInput(detailsSeed.salesman);
        setCustomerCareInput(detailsSeed.customerCare);
        setRemarkInput(detailsSeed.remark);
        setDetailsBaseline(detailsSeed);
        setDetailsSaved(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [order?.id, isOpen]);

    if (!order) return null;

    const owed = orderBalance(order);
    const customerName = order.customer?.name || 'Unknown customer';
    const currentStatus = orderStatusOf(order);
    const currentPayStatus = payStatusOf(order);
    const isOwnDriver = order.shipping?.company === IN_HOUSE_COURIER;
    const operator = getOperatorForPhone(order.customer?.phone);
    const courierLogo = getShippingLogo(order.shipping?.company);
    const trackingMissing = isMissingTracking(order);
    // Guard against a saved value (e.g. a salesman who's left, an old
    // payment method no longer offered) that isn't in the current options
    // list — without this the <select> would silently fall back to its
    // first option instead of showing what's actually saved.
    const withCurrent = (options: string[], current: string): string[] =>
        current && !options.includes(current) ? [...options, current] : options;
    const salesmanOptions = withCurrent(salesmen, salesmanInput);
    const customerCareOptionsWithCurrent = withCurrent(customerCareOptions, customerCareInput);
    const paymentMethodOptions = withCurrent(paymentMethods, paymentMethod);

    const payDirty = paymentStatus !== baseline.paymentStatus || (Number(amountReceivedInput) || 0) !== baseline.amountReceived
        || paymentMethod !== baseline.paymentMethod || settleDateInput !== baseline.settleDate;
    const trackDirty = trackingNumber !== baseline.trackingNumber || orderStatus !== baseline.orderStatus;
    const detailsDirty = addressInput !== detailsBaseline.address || pageSourceInput !== detailsBaseline.pageSource
        || salesmanInput !== detailsBaseline.salesman || customerCareInput !== detailsBaseline.customerCare || remarkInput !== detailsBaseline.remark;
    const dirty = payDirty || trackDirty || detailsDirty;

    const onBeforeClose = (): boolean => {
        if (!dirty) return false;
        return !window.confirm('Discard unsaved changes?');
    };

    const handleCopyPhone = async () => {
        const phone = order.customer?.phone;
        if (!phone) return;
        const ok = await copyToClipboard(phone);
        if (ok) {
            setPhoneCopied(true);
            setTimeout(() => setPhoneCopied(false), 1500);
        }
    };

    const handleSavePayment = async () => {
        const amountReceived = Number(amountReceivedInput) || 0;
        const delta = previewPayChange(order, { paymentStatus, amountReceived });
        // Report owed and collected independently rather than assuming one
        // is always the mirror of the other — marking an order Cancel forces
        // owed to $0 regardless of what was collected, so a previously
        // "collected" amount can simply drop out of both figures (written
        // off) instead of moving back to owed. Stating each delta plainly
        // avoids ever telling the user the wrong side moved.
        const owedMoved = delta.toOwed - delta.fromOwed;
        const collectedMoved = delta.toCollected - delta.fromCollected;
        const parts: string[] = [];
        if (owedMoved < 0) parts.push(`owed decreases by ${fmtMoney(Math.abs(owedMoved))}`);
        if (owedMoved > 0) parts.push(`owed increases by ${fmtMoney(owedMoved)}`);
        if (collectedMoved < 0) parts.push(`collected decreases by ${fmtMoney(Math.abs(collectedMoved))}`);
        if (collectedMoved > 0) parts.push(`collected increases by ${fmtMoney(collectedMoved)}`);
        const message = parts.length > 0
            ? `Mark ${customerName} as ${paymentStatus}? ${parts.join(', ')}.`
            : `Mark ${customerName} as ${paymentStatus}? This won't change the owed or collected amounts.`;
        if (!window.confirm(message)) return;
        setPaySaving(true);
        try {
            await onSave({
                orderId: order.id, paymentStatus, amountReceived,
                paymentMethod: paymentMethod ? (paymentMethod as Order['paymentMethod']) : undefined,
                settleDate: settleDateInput || null,
            });
            setBaseline(b => ({ ...b, paymentStatus, amountReceived, paymentMethod, settleDate: settleDateInput }));
            setPaySaved(true);
            setTimeout(() => setPaySaved(false), 2000);
        } finally {
            setPaySaving(false);
        }
    };

    const handleSaveDetails = async () => {
        setDetailsSaving(true);
        try {
            await onSave({
                orderId: order.id,
                address: addressInput,
                pageSource: pageSourceInput,
                salesman: salesmanInput,
                customerCare: customerCareInput,
                remark: remarkInput,
            });
            setDetailsBaseline({ address: addressInput, pageSource: pageSourceInput, salesman: salesmanInput, customerCare: customerCareInput, remark: remarkInput });
            setDetailsSaved(true);
            setTimeout(() => setDetailsSaved(false), 2000);
        } finally {
            setDetailsSaving(false);
        }
    };

    const handleSaveTracking = async () => {
        setTrackingSaving(true);
        try {
            // orderStatus is always included (even when unchanged from
            // baseline) — updateOrderStatus treats "already at that status"
            // as a silent no-op, so this is harmless when only tracking
            // changed, and is exactly what applies the transition when
            // status did change.
            await onSave({ orderId: order.id, orderStatus, trackingNumber, shippingCompany: order.shipping?.company });
            setBaseline(b => ({ ...b, orderStatus, trackingNumber }));
            setTrackingSaved(true);
            setTimeout(() => setTrackingSaved(false), 2000);
        } finally {
            setTrackingSaving(false);
        }
    };

    const location = [order.customer?.village, order.customer?.commune, order.customer?.district, order.customer?.city]
        .filter(Boolean).join(', ');

    return (
        <DrawerShell
            isOpen={isOpen}
            onClose={onClose}
            onBeforeClose={onBeforeClose}
            width={480}
            title={
                <span
                    className="om2-khmer"
                    title={customerName}
                    style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                    {customerName}
                </span>
            }
            headerActions={
                <button
                    type="button"
                    onClick={() => onPrint(order)}
                    title="Print receipt"
                    aria-label="Print receipt"
                    className="d2-clickable"
                    style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${D2.border}`, background: D2.card, color: D2.ink, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                >
                    <Printer size={15} aria-hidden />
                </button>
            }
        >
            {/* At-a-glance strip: the two facts someone opening this drawer
                usually wants first (current status, what's still owed)
                without scrolling to the editable Payment/Shipping sections
                below. Read-only — the pills mirror the table's own tone
                mapping so a status here means the same color everywhere. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                <MutedPill tone={ORDER_STATUS_TONE[currentStatus] || 'neutral'}>{currentStatus}</MutedPill>
                <MutedPill tone={PAY_STATUS_TONE[currentPayStatus] || 'neutral'}>{currentPayStatus}</MutedPill>
                {trackingMissing && <AlertPill icon={<Flag size={11} aria-hidden />}>no tracking</AlertPill>}
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                <StatBox label="Total" value={fmtMoney(order.total)} />
                <StatBox label="Owed" value={fmtMoney(owed)} tone={owed > 0 ? 'amber' : 'neutral'} />
            </div>

            <Section title="Customer" icon={<User size={13} aria-hidden />}>
                <Field label="Name" value={customerName} khmer truncate fullText={customerName} bold />
                <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: D2.muted, marginBottom: 2 }}>Phone</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {operator?.logo && <img src={operator.logo} alt={operator.name} title={operator.name} style={{ width: 14, height: 14, objectFit: 'contain', borderRadius: 2, flexShrink: 0 }} />}
                        <span style={{ fontSize: 13, color: D2.ink, fontWeight: 700, ...tabular }}>{order.customer?.phone || '—'}</span>
                        {order.customer?.phone && (
                            <button
                                type="button"
                                onClick={handleCopyPhone}
                                title="Copy phone number"
                                className="d2-clickable"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: `1px solid ${D2.border}`, background: D2.card, borderRadius: 6, padding: '2px 7px', fontSize: 11, color: D2.muted, cursor: 'pointer' }}
                            >
                                {phoneCopied ? <Check size={12} /> : <Copy size={12} />}
                                {phoneCopied ? 'Copied!' : 'Copy'}
                            </button>
                        )}
                    </div>
                </div>
                <div style={{ marginBottom: 10 }}>
                    <label htmlFor="om2-drawer-address" style={{ display: 'block', fontSize: 11, color: D2.muted, marginBottom: 4 }}>
                        Address
                    </label>
                    <input
                        id="om2-drawer-address"
                        type="text"
                        className="om2-khmer"
                        value={addressInput}
                        onChange={e => setAddressInput(e.target.value)}
                        style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: `1px solid ${D2.border}`, fontSize: 13, fontWeight: 700, color: D2.ink }}
                    />
                </div>
                {location && <Field label="Location" value={location} khmer bold />}
            </Section>

            <Section title="Order source" icon={<Tag size={13} aria-hidden />}>
                <div style={{ marginBottom: 10 }}>
                    <label htmlFor="om2-drawer-page" style={{ display: 'block', fontSize: 11, color: D2.muted, marginBottom: 4 }}>
                        Page
                    </label>
                    <input
                        id="om2-drawer-page"
                        type="text"
                        className="om2-khmer"
                        value={pageSourceInput}
                        onChange={e => setPageSourceInput(e.target.value)}
                        style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: `1px solid ${D2.border}`, fontSize: 13, color: D2.ink }}
                    />
                </div>
                <div style={{ marginBottom: 10 }}>
                    <label htmlFor="om2-drawer-salesman" style={{ display: 'block', fontSize: 11, color: D2.muted, marginBottom: 4 }}>
                        Salesman
                    </label>
                    <select
                        id="om2-drawer-salesman"
                        value={salesmanInput}
                        onChange={e => setSalesmanInput(e.target.value)}
                        style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: `1px solid ${D2.border}`, fontSize: 13, color: D2.ink, background: D2.card }}
                    >
                        <option value="">—</option>
                        {salesmanOptions.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>
                <div style={{ marginBottom: 10 }}>
                    <label htmlFor="om2-drawer-customer-care" style={{ display: 'block', fontSize: 11, color: D2.muted, marginBottom: 4 }}>
                        Customer care
                    </label>
                    <select
                        id="om2-drawer-customer-care"
                        value={customerCareInput}
                        onChange={e => setCustomerCareInput(e.target.value)}
                        style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: `1px solid ${D2.border}`, fontSize: 13, color: D2.ink, background: D2.card }}
                    >
                        <option value="">—</option>
                        {customerCareOptionsWithCurrent.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
            </Section>

            <Section title="Items" icon={<Package size={13} aria-hidden />}>
                <div style={{ border: `1px solid ${D2.border}`, borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                        <thead>
                            <tr style={{ background: '#f9fafb' }}>
                                <th scope="col" style={{ textAlign: 'left', padding: '6px 8px', color: D2.muted, fontWeight: 600, fontSize: 11 }}>Item</th>
                                <th scope="col" style={{ textAlign: 'right', padding: '6px 8px', color: D2.muted, fontWeight: 600, fontSize: 11 }}>Qty</th>
                                <th scope="col" style={{ textAlign: 'right', padding: '6px 8px', color: D2.muted, fontWeight: 600, fontSize: 11 }}>Price</th>
                                <th scope="col" style={{ textAlign: 'right', padding: '6px 8px', color: D2.muted, fontWeight: 600, fontSize: 11 }}>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {order.items.map((item, i) => (
                                <tr key={`${item.id}-${i}`} style={{ borderTop: `1px solid ${D2.border}` }}>
                                    <td className="om2-khmer" title={item.name} style={{ padding: '6px 8px', color: D2.ink, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {item.name}
                                    </td>
                                    <td style={{ padding: '6px 8px', textAlign: 'right', ...tabular }}>{item.quantity}</td>
                                    <td style={{ padding: '6px 8px', textAlign: 'right', ...tabular }}>{fmtMoney(item.price)}</td>
                                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, ...tabular }}>{fmtMoney(item.price * item.quantity)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Section>

            <Section title="Payment" icon={<Wallet size={13} aria-hidden />}>
                {/* Total/Owed already shown at-a-glance above — this section
                    is just the editable controls, so it doesn't repeat them. */}
                <div style={{ marginBottom: 10 }}>
                    <label htmlFor="om2-drawer-pay-status" style={{ display: 'block', fontSize: 11, color: D2.muted, marginBottom: 4 }}>
                        Payment status
                    </label>
                    <select
                        id="om2-drawer-pay-status"
                        value={paymentStatus}
                        onChange={e => setPaymentStatus(e.target.value as PayStatus)}
                        style={statusSelectStyle(PAY_STATUS_TONE[paymentStatus])}
                    >
                        {PAYMENT_STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                </div>

                <div style={{ marginBottom: 12 }}>
                    <label htmlFor="om2-drawer-amount-received" style={{ display: 'block', fontSize: 11, color: D2.muted, marginBottom: 4 }}>
                        Received amount
                    </label>
                    <input
                        id="om2-drawer-amount-received"
                        type="number"
                        step="0.01"
                        min="0"
                        value={amountReceivedInput}
                        onChange={e => setAmountReceivedInput(e.target.value)}
                        style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: `1px solid ${D2.border}`, fontSize: 13, color: D2.ink, ...tabular }}
                    />
                </div>

                <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                    <div style={{ flex: 1 }}>
                        <label htmlFor="om2-drawer-pay-by" style={{ display: 'block', fontSize: 11, color: D2.muted, marginBottom: 4 }}>
                            Pay by
                        </label>
                        <select
                            id="om2-drawer-pay-by"
                            value={paymentMethod}
                            onChange={e => setPaymentMethod(e.target.value)}
                            style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: `1px solid ${D2.border}`, fontSize: 13, color: D2.ink, background: D2.card }}
                        >
                            <option value="">—</option>
                            {paymentMethodOptions.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </div>
                    <div style={{ flex: 1 }}>
                        <label htmlFor="om2-drawer-settle-date" style={{ display: 'block', fontSize: 11, color: D2.muted, marginBottom: 4 }}>
                            Settled date
                        </label>
                        <input
                            id="om2-drawer-settle-date"
                            type="date"
                            value={settleDateInput}
                            onChange={e => setSettleDateInput(e.target.value)}
                            style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: `1px solid ${D2.border}`, fontSize: 13, color: D2.ink, ...tabular }}
                        />
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button type="button" onClick={handleSavePayment} disabled={!payDirty || paySaving} style={saveButtonStyle(payDirty && !paySaving)}>
                        {paySaving ? 'Saving…' : 'Save'}
                    </button>
                    {paySaved && <span style={{ fontSize: 12, color: D2.green, fontWeight: 600 }}>Saved</span>}
                </div>
            </Section>

            <Section title="Shipping and tracking" icon={<Truck size={13} aria-hidden />}>
                <div style={{ marginBottom: 10 }}>
                    <label htmlFor="om2-drawer-status" style={{ display: 'block', fontSize: 11, color: D2.muted, marginBottom: 4 }}>
                        Order status
                    </label>
                    <select
                        id="om2-drawer-status"
                        value={orderStatus}
                        onChange={e => setOrderStatus(e.target.value as ShipStatus)}
                        style={statusSelectStyle(ORDER_STATUS_TONE[orderStatus])}
                    >
                        {ORDER_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <div style={{ fontSize: 11, color: D2.muted, marginTop: 4 }}>
                        Some moves aren't allowed from every status (e.g. a Delivered or Returned order is locked) — an invalid change is rejected with a message when you save.
                    </div>
                </div>
                <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: D2.muted, marginBottom: 2 }}>Courier</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {courierLogo && <img src={courierLogo} alt="" style={{ width: 14, height: 14, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />}
                        <span className="om2-khmer" title={order.shipping?.company} style={{ fontSize: 13, color: D2.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.shipping?.company || '—'}</span>
                    </div>
                </div>
                {isOwnDriver ? (
                    <div style={{ fontSize: 12, color: D2.muted, background: '#f1f3f7', border: `1px solid ${D2.border}`, borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
                        Own driver — no tracking ID needed
                    </div>
                ) : (
                    <div style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                            <label htmlFor="om2-drawer-tracking" style={{ fontSize: 11, color: D2.muted }}>
                                Tracking ID
                            </label>
                            {trackingMissing && <AlertPill icon={<Flag size={11} aria-hidden />}>no tracking</AlertPill>}
                        </div>
                        <input
                            id="om2-drawer-tracking"
                            type="text"
                            value={trackingNumber}
                            onChange={e => setTrackingNumber(e.target.value)}
                            style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: `1px solid ${D2.border}`, fontSize: 13, color: D2.ink }}
                        />
                    </div>
                )}
                {/* Outside the own-driver branch: status alone must still be
                    savable for own-driver orders, which have no tracking field. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button type="button" onClick={handleSaveTracking} disabled={!trackDirty || trackingSaving} style={saveButtonStyle(trackDirty && !trackingSaving)}>
                        {trackingSaving ? 'Saving…' : 'Save'}
                    </button>
                    {trackingSaved && <span style={{ fontSize: 12, color: D2.green, fontWeight: 600 }}>Saved</span>}
                </div>
                <div style={{ fontSize: 11, color: D2.muted, marginTop: 8 }}>Courier itself isn't editable here.</div>
            </Section>

            <Section title="Remark" icon={<MessageSquare size={13} aria-hidden />}>
                <textarea
                    aria-label="Remark"
                    className="om2-khmer"
                    value={remarkInput}
                    onChange={e => setRemarkInput(e.target.value)}
                    rows={3}
                    style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: `1px solid ${D2.border}`, fontSize: 13, color: D2.ink, resize: 'vertical', marginBottom: 10 }}
                />
                {/* One save for Address/Page/Salesman/Customer care/Remark —
                    none of them are financial or status-sensitive like
                    Payment/Shipping above, so a single combined save (rather
                    than one per section) keeps this from turning into five
                    more buttons scattered through the drawer. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button type="button" onClick={handleSaveDetails} disabled={!detailsDirty || detailsSaving} style={saveButtonStyle(detailsDirty && !detailsSaving)}>
                        {detailsSaving ? 'Saving…' : 'Save details'}
                    </button>
                    {detailsSaved && <span style={{ fontSize: 12, color: D2.green, fontWeight: 600 }}>Saved</span>}
                </div>
                <div style={{ fontSize: 11, color: D2.muted, marginTop: 8 }}>Also saves Address, Page, Salesman and Customer care above.</div>
            </Section>

            <div style={{ fontSize: 11, color: D2.muted }}>
                Last edited by {order.lastEditedBy || '—'} on {fmtDateTime(order.lastEditedAt || order.date)}
            </div>
        </DrawerShell>
    );
};

export default RowDrawer;
