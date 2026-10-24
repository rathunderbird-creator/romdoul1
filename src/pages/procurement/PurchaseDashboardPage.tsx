// Purchase Dashboard — what's spent, with whom, where prices are rising, how
// suppliers deliver, and what's waiting to be approved, chased or paid.
//
// This app's purchase-order model only covers order -> receive -> bill ->
// pay; there's no requisition/approval step before a PO exists. So three of
// the pipeline's seven stages (Requests awaiting approval, Approved not yet
// ordered, Payment requests awaiting approval) and the "Awaiting approval"
// KPI are structurally always zero here — not a bug, just a stage this data
// model doesn't have yet.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Wallet, Truck } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useHeader } from '../../context/HeaderContext';
import { useProcurement } from '../../hooks/useProcurement';
import { useAccounting } from '../../hooks/useAccounting';
import { dayKeyFromDate, daysBetween, addDays } from '../../utils/dateRange';
import type { PurchaseOrder } from '../../types';

const fmt = (n: number) => (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayYmd = () => dayKeyFromDate(new Date());
const monthKeyOf = (d: string) => String(d || '').slice(0, 7);
const monthLabel = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};
const addMonths = (ym: string, delta: number) => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };
const inputStyle: React.CSSProperties = { padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', outline: 'none', background: 'var(--color-surface)', color: 'var(--color-text-main)' };
const BLUE = '#3B82F6', RED = '#EF4444', GREEN = '#10B981', AMBER = '#F59E0B';

const KpiCard: React.FC<{ label: string; value: React.ReactNode; sub: string; color?: string; loading: boolean }> = ({ label, value, sub, color, loading }) => (
    <div style={{ ...cardStyle, padding: '16px 20px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{label}</div>
        <div style={{ fontSize: '22px', fontWeight: 800, color: color || 'var(--color-text-main)', marginTop: '6px', fontVariantNumeric: 'tabular-nums' }}>{loading ? '…' : value}</div>
        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>{sub}</div>
    </div>
);
const PipelineRow: React.FC<{ label: string; count: number; amount: number | null }> = ({ label, count, amount }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
        <span style={{ fontSize: '13px', color: 'var(--color-text-main)' }}>{label}</span>
        <span style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--color-text-main)' }}>{count}</div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{amount === null ? '—' : fmt(amount)}</div>
        </span>
    </div>
);
const PayableTile: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
    <div style={{ background: `${color}14`, border: `1px solid ${color}33`, borderRadius: '10px', padding: '10px 14px', flex: 1, minWidth: '110px' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color }}>{label}</div>
        <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '4px' }}>{fmt(value)}</div>
        <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>USD</div>
    </div>
);

const PurchaseDashboardPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const navigate = useNavigate();
    const { purchaseOrders, suppliers, isLoading, fetchPurchaseOrders, fetchSuppliers } = useProcurement();
    const { journalEntries, fetchJournalEntries } = useAccounting();

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Purchase Dashboard</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0 }}>What you spend and with whom, where prices are rising, how suppliers deliver, and what is waiting to be approved, chased or paid.</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchPurchaseOrders();
        fetchSuppliers();
        fetchJournalEntries();
    }, [fetchPurchaseOrders, fetchSuppliers, fetchJournalEntries]);

    const [endingMonth, setEndingMonth] = useState(() => monthKeyOf(todayYmd()));
    const startMonth = useMemo(() => addMonths(endingMonth, -11), [endingMonth]);
    const windowStart = `${startMonth}-01`;
    // Memoized (not a plain const) so it has a stable identity for the whole
    // session — a dashboard doesn't need to notice midnight ticking over.
    const today = useMemo(() => todayYmd(), []);
    const endingMonthEnd = (() => {
        const [y, m] = endingMonth.split('-').map(Number);
        const last = new Date(y, m, 0).getDate();
        return `${endingMonth}-${String(last).padStart(2, '0')}`;
    })();
    // The window's own end never runs past today — a future "ending month"
    // can't have real spend in it yet.
    const windowEnd = endingMonthEnd > today ? today : endingMonthEnd;

    // This PO's receipt journal entry, by reference_id 'PO-'+id — same lookup
    // Supplier Bills uses to derive a bill's Draft/Posted status, and here
    // also doubles as the best available proxy for "the day this PO was
    // actually received" (the PO row itself has no received-at column).
    const jeByPoId = useMemo(() => {
        const m = new Map<string, { id: string; status?: string; date: string }>();
        for (const je of journalEntries) {
            if (je.reference_id?.startsWith('PO-')) m.set(je.reference_id.slice(3), je as { id: string; status?: string; date: string });
        }
        return m;
    }, [journalEntries]);

    const billStatusOf = useCallback((po: PurchaseOrder): 'Draft' | 'Posted' | 'Partial' | 'Paid' => {
        if (po.payment_status === 'Paid') return 'Paid';
        if ((Number(po.amount_paid) || 0) > 0) return 'Partial';
        const je = jeByPoId.get(po.id);
        if (!je || (je.status || 'Posted') === 'Draft') return 'Draft';
        return 'Posted';
    }, [jeByPoId]);

    const bills = useMemo(() => purchaseOrders.filter(po => po.status === 'Received' && !!po.invoice_number), [purchaseOrders]);
    // "Posted" here means the books actually reflect it — anything but a
    // still-Draft receipt entry (Partial/Paid bills are posted too, since
    // the payment reality already proved the entry exists and is final).
    const postedBills = useMemo(() => bills.filter(po => billStatusOf(po) !== 'Draft'), [bills, billStatusOf]);
    const outstandingOf = (po: PurchaseOrder) => (po.total_amount || 0) - (po.amount_paid || 0);

    // ── Spend: posted bills' totals, attributed to their order_date ──
    const spendInRange = useCallback((from: string, to: string) =>
        postedBills.filter(po => po.order_date >= from && po.order_date <= to).reduce((s, po) => s + (po.total_amount || 0), 0),
    [postedBills]);
    const spend12mo = spendInRange(windowStart, windowEnd);
    const spendThisMonth = spendInRange(`${endingMonth}-01`, windowEnd);
    const priorYearStart = addMonths(startMonth, -12) + '-01';
    const priorYearEnd = (() => {
        const [y, m] = addMonths(endingMonth, -12).split('-').map(Number);
        const last = new Date(y, m, 0).getDate();
        return `${addMonths(endingMonth, -12)}-${String(last).padStart(2, '0')}`;
    })();
    const spendPriorYear = spendInRange(priorYearStart, priorYearEnd);

    // ── Committed: ordered but not yet received ──
    const openOrders = useMemo(() => purchaseOrders.filter(po => po.status === 'Sent'), [purchaseOrders]);
    const committed = openOrders.reduce((s, po) => s + (po.total_amount || 0), 0);

    // ── Payables: who we owe, bucketed by due date ──
    const payable = useMemo(() => {
        const due7 = addDays(today, 7), due30 = addDays(today, 30);
        let overdue = 0, within7 = 0, within30 = 0, outstanding = 0, billCount = 0;
        for (const po of bills) {
            const out = outstandingOf(po);
            if (out <= 0.005) continue;
            billCount++;
            outstanding += out;
            const dueDate = po.payment_due_date;
            if (dueDate && dueDate < today) overdue += out;
            if (dueDate && dueDate >= today && dueDate <= due7) within7 += out;
            if (dueDate && dueDate >= today && dueDate <= due30) within30 += out;
        }
        return { overdue, within7, within30, outstanding, billCount };
    }, [bills, today]);

    // Days Payable Outstanding: what's owed, expressed in days of buying —
    // reused for both the "Overdue to pay" tile's subtitle and the Payables
    // panel's own caption, so the two always agree.
    const dpo = spend12mo > 0 ? (payable.outstanding / (spend12mo / 365)) : null;

    // ── On-time delivery / fill rate ──
    // Every receive in this app is a single, full receive (no partial
    // quantities tracked) — so "fill rate" can only ever be 100% once
    // anything has been received at all; it's not a computed average.
    const receivedPOs = useMemo(() => purchaseOrders.filter(po => po.status === 'Received'), [purchaseOrders]);
    const onTime = useMemo(() => {
        let onTimeCount = 0, judged = 0;
        for (const po of receivedPOs) {
            if (!po.expected_delivery_date) continue;
            const je = jeByPoId.get(po.id);
            const receivedDate = je?.date || po.order_date;
            judged++;
            if (receivedDate <= po.expected_delivery_date) onTimeCount++;
        }
        return { pct: judged > 0 ? Math.round((onTimeCount / judged) * 100) : null, judged };
    }, [receivedPOs, jeByPoId]);
    const fillRatePct = receivedPOs.length > 0 ? 100 : null;

    // ── Price rises in the last 90 days: each product's most recent
    // purchase price vs. the purchase immediately before it ──
    const priceRises = useMemo(() => {
        const byProduct = new Map<string, { date: string; price: number; qty: number }[]>();
        for (const po of purchaseOrders) {
            if (po.status === 'Draft' || po.status === 'Cancelled') continue;
            for (const item of po.items || []) {
                if (!item.product_id) continue;
                const arr = byProduct.get(item.product_id) || [];
                arr.push({ date: po.order_date, price: Number(item.unit_price) || 0, qty: Number(item.quantity) || 0 });
                byProduct.set(item.product_id, arr);
            }
        }
        const cutoff = addDays(today, -90);
        let impact = 0, count = 0;
        for (const purchases of byProduct.values()) {
            const sorted = [...purchases].sort((a, b) => a.date.localeCompare(b.date));
            for (let i = 1; i < sorted.length; i++) {
                const cur = sorted[i], prev = sorted[i - 1];
                if (cur.date < cutoff) continue;
                if (cur.price > prev.price + 0.005) {
                    impact += (cur.price - prev.price) * cur.qty;
                    count++;
                    break; // one rise counted per product, the most recent
                }
            }
        }
        return { impact, count };
    }, [purchaseOrders, today]);

    // ── Purchasing pipeline ──
    const draftOrders = useMemo(() => purchaseOrders.filter(po => po.status === 'Draft'), [purchaseOrders]);
    const receivedNotBilled = useMemo(() => purchaseOrders.filter(po => po.status === 'Received' && !po.invoice_number), [purchaseOrders]);
    const draftBills = useMemo(() => bills.filter(po => billStatusOf(po) === 'Draft'), [bills, billStatusOf]);
    const oldestWaitingDays = useMemo(() => {
        if (receivedNotBilled.length === 0) return null;
        const oldest = receivedNotBilled.reduce((min, po) => (po.order_date < min ? po.order_date : min), receivedNotBilled[0].order_date);
        return Math.max(0, daysBetween(oldest, today));
    }, [receivedNotBilled, today]);

    // ── Late deliveries: ordered, not yet received, past the expected date ──
    const lateDeliveries = useMemo(
        () => openOrders.filter(po => po.expected_delivery_date && po.expected_delivery_date < today)
            .sort((a, b) => (a.expected_delivery_date || '').localeCompare(b.expected_delivery_date || '')),
        [openOrders, today]
    );

    // ── Spend by month, across the 12-month window ──
    const spendByMonth = useMemo(() => {
        const months: string[] = [];
        for (let i = 0; i < 12; i++) months.push(addMonths(startMonth, i));
        return months.map(ym => {
            const [y, m] = ym.split('-').map(Number);
            const last = new Date(y, m, 0).getDate();
            const from = `${ym}-01`, to = `${ym}-${String(last).padStart(2, '0')}`;
            return { month: monthLabel(ym), spend: spendInRange(from, to) };
        });
    }, [startMonth, spendInRange]);

    const supplierById = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers]);

    return (
        <div className="acct-page" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Filter */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
                <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '5px' }}>Ending month</label>
                    <input type="month" value={endingMonth} max={monthKeyOf(today)} onChange={e => setEndingMonth(e.target.value || monthKeyOf(today))} style={inputStyle} />
                </div>
                <button onClick={() => { fetchPurchaseOrders(); fetchJournalEntries(); }} title="Refresh" style={{ ...inputStyle, cursor: 'pointer', display: 'flex' }}>
                    <RefreshCw size={15} style={isLoading ? { animation: 'spin 1s linear infinite' } : {}} />
                </button>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                {monthLabel(startMonth)} – {monthLabel(endingMonth)} · Amounts in USD, before VAT, net of supplier returns
            </div>

            {/* KPI row 1 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <KpiCard label="Spend · 12 months" value={fmt(spend12mo)} sub={spendPriorYear > 0 ? `${spend12mo >= spendPriorYear ? '+' : ''}${fmt(spend12mo - spendPriorYear)} vs the year before` : 'Nothing bought the year before'} loading={isLoading} />
                <KpiCard label="This month" value={fmt(spendThisMonth)} sub={monthLabel(endingMonth)} loading={isLoading} />
                <KpiCard label="Committed" value={fmt(committed)} sub={`${openOrders.length} open order${openOrders.length === 1 ? '' : 's'}`} color={BLUE} loading={isLoading} />
                <KpiCard label="Awaiting approval" value={0} sub="Requests and payment requests" loading={isLoading} />
            </div>

            {/* KPI row 2 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <KpiCard label="Overdue to pay" value={fmt(payable.overdue)} sub={dpo === null ? 'No purchase history yet' : `Paying in ${Math.round(dpo)} days on average`} color={payable.overdue > 0 ? RED : undefined} loading={isLoading} />
                <KpiCard label="Due in 7 days" value={fmt(payable.within7)} sub={`${fmt(payable.within30)} within 30 days`} color={AMBER} loading={isLoading} />
                <KpiCard label="On-time delivery" value={onTime.pct === null ? '—' : `${onTime.pct}%`} sub={fillRatePct === null ? 'No deliveries yet' : `Fill rate ${fillRatePct}%`} color={GREEN} loading={isLoading} />
                <KpiCard label="Price rises · 90 days" value={fmt(priceRises.impact)} sub={`${priceRises.count} product${priceRises.count === 1 ? '' : 's'} dearer`} color={priceRises.count > 0 ? RED : undefined} loading={isLoading} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: '20px', alignItems: 'start' }}>
                {/* Purchasing pipeline */}
                <div style={{ ...cardStyle, padding: '18px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                        <Truck size={16} color={BLUE} />
                        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)' }}>Purchasing pipeline</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '10px' }}>What is waiting on someone today. Values in USD.</div>
                    <PipelineRow label="Requests awaiting approval" count={0} amount={null} />
                    <PipelineRow label="Approved, not yet ordered" count={0} amount={null} />
                    <PipelineRow label="Orders not sent" count={draftOrders.length} amount={draftOrders.length ? draftOrders.reduce((s, po) => s + (po.total_amount || 0), 0) : null} />
                    <PipelineRow label="Open orders (still to come)" count={openOrders.length} amount={openOrders.length ? committed : null} />
                    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <span style={{ fontSize: '13px', color: 'var(--color-text-main)' }}>Received, not billed</span>
                            <span style={{ textAlign: 'right' }}>
                                <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--color-text-main)' }}>{receivedNotBilled.length}</div>
                                <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{receivedNotBilled.length ? fmt(receivedNotBilled.reduce((s, po) => s + (po.total_amount || 0), 0)) : '—'}</div>
                            </span>
                        </div>
                        {oldestWaitingDays !== null && <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>Oldest waiting {oldestWaitingDays} day{oldestWaitingDays === 1 ? '' : 's'}</div>}
                    </div>
                    <PipelineRow label="Draft bills" count={draftBills.length} amount={draftBills.length ? draftBills.reduce((s, po) => s + (po.total_amount || 0), 0) : null} />
                    <div style={{ padding: '8px 0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <span style={{ fontSize: '13px', color: 'var(--color-text-main)' }}>Payment requests awaiting approval</span>
                            <span style={{ textAlign: 'right' }}>
                                <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--color-text-main)' }}>0</div>
                                <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>—</div>
                            </span>
                        </div>
                    </div>
                    <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--color-border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-secondary)' }}>LATE DELIVERIES</span>
                            <button onClick={() => navigate('/procurement/purchase-orders')} style={{ background: 'none', border: 'none', color: BLUE, fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Open report →</button>
                        </div>
                        {lateDeliveries.length === 0 ? (
                            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '6px' }}>No deliveries are late.</div>
                        ) : (
                            <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {lateDeliveries.slice(0, 5).map(po => (
                                    <div key={po.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                                        <span className="d2-khmer" style={{ color: 'var(--color-text-main)' }}>{po.supplier?.name || supplierById.get(po.supplier_id)?.name || '—'}</span>
                                        <span style={{ color: RED, fontVariantNumeric: 'tabular-nums' }}>{Math.max(0, daysBetween(po.expected_delivery_date || today, today))}d late</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Payables */}
                <div style={{ ...cardStyle, padding: '18px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                        <Wallet size={16} color={AMBER} />
                        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)' }}>Payables</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Owed to suppliers as of today. Each currency stays in its own; the tiles above convert to base.</span>
                        <button onClick={() => navigate('/accounting/payable')} style={{ background: 'none', border: 'none', color: BLUE, fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: '8px' }}>Open report →</button>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
                        <PayableTile label="Overdue" value={payable.overdue} color={RED} />
                        <PayableTile label="Due in 7 days" value={payable.within7} color={AMBER} />
                        <PayableTile label="Due in 30 days" value={payable.within30} color={BLUE} />
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                <th style={{ textAlign: 'left', padding: '6px 0', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>Currency</th>
                                <th style={{ textAlign: 'right', padding: '6px 0', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>USD<div style={{ fontWeight: 400, textTransform: 'none' }}>{payable.billCount} bill{payable.billCount === 1 ? '' : 's'}</div></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr><td style={{ padding: '6px 0', color: 'var(--color-text-main)' }}>Overdue</td><td style={{ padding: '6px 0', textAlign: 'right' }}>{fmt(payable.overdue)}</td></tr>
                            <tr><td style={{ padding: '6px 0', color: 'var(--color-text-main)' }}>Due in 7 days</td><td style={{ padding: '6px 0', textAlign: 'right' }}>{fmt(payable.within7)}</td></tr>
                            <tr><td style={{ padding: '6px 0', color: 'var(--color-text-main)' }}>Due in 30 days</td><td style={{ padding: '6px 0', textAlign: 'right' }}>{fmt(payable.within30)}</td></tr>
                            <tr style={{ borderTop: '1px solid var(--color-border)', fontWeight: 700 }}><td style={{ padding: '8px 0', color: 'var(--color-text-main)' }}>Outstanding</td><td style={{ padding: '8px 0', textAlign: 'right' }}>{fmt(payable.outstanding)}</td></tr>
                        </tbody>
                    </table>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '10px' }}>
                        Days payable outstanding: {dpo === null ? '—' : `${Math.round(dpo)} days`} — what you owe, in days of buying.
                    </div>
                </div>
            </div>

            {/* Spend by month */}
            <div style={{ ...cardStyle, padding: '18px 20px' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)' }}>Spend by month</div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>Posted supplier bills less supplier returns, before VAT, in USD.</div>
                <div style={{ height: '260px' }}>
                    {isLoading ? (
                        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading…</div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={spendByMonth} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                                <XAxis dataKey="month" stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} />
                                <YAxis stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(Number(v))} />
                                <Tooltip
                                    contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    formatter={((value: any) => [fmt(Number(value)), 'Spend']) as any}
                                />
                                <Bar dataKey="spend" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={36} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PurchaseDashboardPage;
