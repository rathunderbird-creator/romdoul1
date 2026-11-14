import React, { useEffect, useMemo, useState } from 'react';
import { HandCoins, Plus, RefreshCw, ArrowRight, Database, ShoppingCart, Search, FilterX } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { fill } from '../../i18n/translate';
import { useWholesale } from '../../hooks/useWholesale';
import { useAccounting } from '../../hooks/useAccounting';
import { usePersistedDateRange } from '../../hooks/usePersistedDateRange';
import { Modal } from '../../components';
import { supabase } from '../../lib/supabase';
import { useMobile } from '../../hooks/useMobile';
import MoneyInput from '../../components/MoneyInput';
import CashBankOptions from '../../components/CashBankOptions';
import { useAccountCurrency, useMoneyField } from '../../hooks/useMoneyField';
import { accountCurrency, khrToUsd, usdToKhr } from '../../utils/currency';

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

const daysOverdue = (due?: string): number | null => {
    if (!due) return null;
    const d = new Date(due); d.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((today.getTime() - d.getTime()) / 86400000);
};

interface WarehouseTransfer {
    id: string;
    kind?: 'transfer' | 'wholesale';
    transfer_date: string;
    from_warehouse_id?: string;
    to_warehouse_id?: string;
    to_warehouse_name?: string;
    product_id?: string;
    product_name?: string;
    quantity: number;
    unit_price: number;
    total_amount: number;
    amount_received: number;
    payment_status: 'Unpaid' | 'Partial' | 'Paid';
    due_date?: string;
    note?: string;
}

// Unified row for the receivables table — from either a warehouse transfer or a wholesale order.
interface Receivable {
    key: string;
    source: 'transfer' | 'wholesale';
    date?: string;
    party: string;
    desc: string;
    due_date?: string;
    total: number;
    received: number;
    balance: number;
    id: string; // id of the underlying transfer / wholesale order
}

const AccountsReceivablePage: React.FC = () => {
    const isMobile = useMobile();
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { t } = useLanguage();
    const navigate = useNavigate();
    const { warehouses, products, currentUser, wholesaleSettings, khrExchangeRate } = useStore();
    const { wholesaleOrders, tableMissing: woMissing, fetchWholesaleOrders, recordCustomerPayment } = useWholesale();
    const { accounts, fetchAccounts } = useAccounting();

    useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

    // Cash/bank ledger accounts for the "Received into" select (wholesale receipts).
    const paymentAccounts = useMemo(
        () => accounts.filter(a => a.is_active && a.account_type === 'Asset' && /cash|bank/i.test(a.account_name)),
        [accounts]
    );

    const [transfers, setTransfers] = useState<WarehouseTransfer[]>([]);
    const [loading, setLoading] = useState(true);
    const [transferTableMissing, setTransferTableMissing] = useState(false);

    // Transfer-on-credit create modal
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [fromWh, setFromWh] = useState('');
    const [toWh, setToWh] = useState('');
    const [productId, setProductId] = useState('');
    const [qty, setQty] = useState<number | string>('');
    const [unitPrice, setUnitPrice] = useState<number | string>('');
    const [dueDate, setDueDate] = useState('');
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);

    // Receipt modal (works for both sources)
    const [receiptFor, setReceiptFor] = useState<Receivable | null>(null);
    const [receiptMethod, setReceiptMethod] = useState('Cash');
    const [receiptNote, setReceiptNote] = useState('');
    const [receiveAccountId, setReceiveAccountId] = useState('');
    // The amount: USD, or riel for a wholesale receipt into a riel account.
    // More than the balance is refused, so above it is a typo (riel).
    const receiptField = useMoneyField({ shopRate: khrExchangeRate, maxPlausibleUsd: receiptFor ? receiptFor.balance : null });
    const receiptCoupling = useAccountCurrency(receiptField, receiptFor?.source === 'wholesale' ? paymentAccounts : [], receiveAccountId, setReceiveAccountId);

    // Filters
    const [search, setSearch] = useState('');
    const [sourceFilter, setSourceFilter] = useState<'all' | 'wholesale' | 'transfer'>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'overdue'>('all');
    const [arDateRange, setArDateRange] = usePersistedDateRange('accounts_receivable_range');
    const dateFrom = arDateRange.start;
    const dateTo = arDateRange.end;
    const setDateFrom = (v: string) => setArDateRange(r => ({ ...r, start: v }));
    const setDateTo = (v: string) => setArDateRange(r => ({ ...r, end: v }));

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>{t('ui.wholesale.ar.title')}</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>{t('ui.wholesale.ar.subtitle')}</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

    const fetchTransfers = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.from('warehouse_transfers').select('*').order('transfer_date', { ascending: false });
            if (error) { setTransferTableMissing(true); setTransfers([]); }
            else { setTransferTableMissing(false); setTransfers((data || []) as WarehouseTransfer[]); }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchTransfers(); fetchWholesaleOrders(); }, [fetchWholesaleOrders]);

    const refreshAll = () => { fetchTransfers(); fetchWholesaleOrders(); };
    const warehouseName = (id?: string) => warehouses.find(w => w.id === id)?.name || '—';

    // Build the unified receivables list.
    const receivables = useMemo<Receivable[]>(() => {
        const rows: Receivable[] = [];
        // Warehouse transfers (exclude any legacy 'wholesale' kind; those live in wholesale_orders now).
        for (const tr of transfers) {
            if (tr.kind === 'wholesale') continue;
            const balance = (tr.total_amount || 0) - (tr.amount_received || 0);
            if (balance <= 0.005) continue;
            rows.push({
                key: 'wt-' + tr.id, source: 'transfer', id: tr.id, date: tr.transfer_date,
                party: tr.to_warehouse_name || warehouseName(tr.to_warehouse_id),
                desc: `${tr.product_name || ''} ×${tr.quantity}`,
                due_date: tr.due_date, total: tr.total_amount || 0, received: tr.amount_received || 0, balance
            });
        }
        // Wholesale orders (customer credit sales).
        for (const o of wholesaleOrders) {
            if (o.status === 'Cancelled') continue;
            const balance = (o.total_amount || 0) - (o.amount_paid || 0);
            if (balance <= 0.005) continue;
            rows.push({
                key: 'wo-' + o.id, source: 'wholesale', id: o.id, date: o.order_date,
                party: o.customer_name, desc: fill(t('ui.wholesale.ar.nItems'), { n: o.items?.length || 0 }),
                due_date: o.due_date, total: o.total_amount || 0, received: o.amount_paid || 0, balance
            });
        }
        return rows.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    }, [transfers, wholesaleOrders, warehouses, t]);

    const totals = useMemo(() => {
        const totalReceivable = receivables.reduce((s, r) => s + r.balance, 0);
        const overdue = receivables.reduce((s, r) => { const od = daysOverdue(r.due_date); return s + (od !== null && od > 0 ? r.balance : 0); }, 0);
        return { totalReceivable, overdue, count: receivables.length };
    }, [receivables]);

    const filteredReceivables = useMemo(() => {
        const q = search.trim().toLowerCase();
        return receivables.filter(r => {
            if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
            if (statusFilter === 'overdue') {
                const od = daysOverdue(r.due_date);
                if (od === null || od <= 0) return false;
            }
            const d = (r.date || '').slice(0, 10);
            if (dateFrom && d < dateFrom) return false;
            if (dateTo && d > dateTo) return false;
            if (q && !(r.party.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q))) return false;
            return true;
        });
    }, [receivables, search, sourceFilter, statusFilter, dateFrom, dateTo]);

    const hasActiveFilters = !!search || sourceFilter !== 'all' || statusFilter !== 'all' || !!dateFrom || !!dateTo;
    const clearFilters = () => { setSearch(''); setSourceFilter('all'); setStatusFilter('all'); setDateFrom(''); setDateTo(''); };

    const adjustWarehouseStock = async (warehouseId: string, pid: string, delta: number) => {
        if (!warehouseId || !pid) return;
        const { data } = await supabase.from('warehouse_stock').select('id, quantity').eq('warehouse_id', warehouseId).eq('product_id', pid).maybeSingle();
        if (data) await supabase.from('warehouse_stock').update({ quantity: Math.max(0, (data.quantity || 0) + delta) }).eq('id', data.id);
        else if (delta > 0) await supabase.from('warehouse_stock').insert([{ warehouse_id: warehouseId, product_id: pid, quantity: delta }]);
    };

    const resetCreate = () => { setFromWh(''); setToWh(''); setProductId(''); setQty(''); setUnitPrice(''); setDueDate(''); setNote(''); };

    const submitTransfer = async () => {
        const q = Number(qty), up = Number(unitPrice);
        if (!fromWh || !toWh) { showToast(t('ui.wholesale.ar.toast.chooseWarehouses'), 'error'); return; }
        if (fromWh === toWh) { showToast(t('ui.wholesale.ar.toast.mustDiffer'), 'error'); return; }
        if (!productId) { showToast(t('ui.wholesale.ar.toast.chooseProduct'), 'error'); return; }
        if (!q || q <= 0) { showToast(t('ui.wholesale.ar.toast.validQty'), 'error'); return; }
        if (up < 0) { showToast(t('ui.wholesale.ar.toast.validPrice'), 'error'); return; }
        setSaving(true);
        try {
            const product = products.find(p => p.id === productId);

            // Availability check BEFORE anything is written: the deduction
            // helper clamps at 0 and silently skips a missing warehouse_stock
            // row, so transferring more than the source holds would credit the
            // destination with stock the source never had (phantom inventory).
            const { data: sourceRow } = await supabase.from('warehouse_stock')
                .select('quantity').eq('warehouse_id', fromWh).eq('product_id', productId).maybeSingle();
            const availableAtSource = sourceRow?.quantity || 0;
            if (q > availableAtSource) {
                showToast(fill(t('ui.wholesale.ar.toast.insufficient'), { have: availableAtSource, need: q }), 'error');
                setSaving(false);
                return;
            }

            const { error } = await supabase.from('warehouse_transfers').insert([{
                kind: 'transfer',
                transfer_date: new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0],
                from_warehouse_id: fromWh, to_warehouse_id: toWh, to_warehouse_name: warehouseName(toWh),
                product_id: productId, product_name: product?.name || '',
                quantity: q, unit_price: up, total_amount: q * up, amount_received: 0, payment_status: 'Unpaid',
                due_date: dueDate || null, note: note || null, created_by: currentUser?.name || 'System'
            }]);
            if (error) throw error;
            await adjustWarehouseStock(fromWh, productId, -q);
            await adjustWarehouseStock(toWh, productId, q);
            showToast(t('ui.wholesale.ar.toast.transferRecorded'), 'success');
            setIsCreateOpen(false); resetCreate(); fetchTransfers();
        } catch (e: any) {
            showToast(t('ui.wholesale.ar.toast.transferFailed') + (e.message || ''), 'error');
        } finally { setSaving(false); }
    };

    const openReceipt = (r: Receivable) => {
        setReceiptFor(r); setReceiptMethod('Cash'); setReceiptNote('');
        // Wholesale Setup's default payment account prefills "Received into".
        const def = wholesaleSettings.defaultPaymentAccountId;
        const id = r.source === 'wholesale' && def && paymentAccounts.some(a => a.id === def) ? def : '';
        setReceiveAccountId(id);
        // A riel default account opens in riel.
        receiptField.reset(accountCurrency(paymentAccounts.find(a => a.id === id)) === 'KHR'
            ? { amount: usdToKhr(r.balance, receiptField.shopRate), currency: 'KHR' }
            : { amount: r.balance.toFixed(2), currency: 'USD' });
    };

    const submitReceipt = async () => {
        if (!receiptFor) return;
        // Riel within 3 cents of the whole balance settles exactly the balance.
        const rate = Number(receiptField.rate) > 0 ? Number(receiptField.rate) : receiptField.shopRate;
        const amount = receiptField.currency === 'KHR' && Math.abs(khrToUsd(receiptField.typed, rate) - receiptFor.balance) <= 0.03
            ? receiptFor.balance : receiptField.usd;
        if (!amount || amount <= 0) { showToast(t('ui.wholesale.ar.toast.validAmount'), 'error'); return; }
        if (receiptField.rateInvalid) { showToast(t('ui.wholesale.ar.toast.rielRate'), 'error'); return; }
        if (!receiptField.confirmIfSuspicious()) return;
        // More than is still owed would over-credit the receivable.
        if (receiptFor.source === 'wholesale' && amount > receiptFor.balance + 0.005) {
            showToast(fill(t('ui.wholesale.ar.toast.tooMuch'), { amount: receiptFor.balance.toFixed(2) }), 'error');
            return;
        }
        // "Received into" is required for wholesale receipts whenever cash/bank accounts exist.
        if (receiptFor.source === 'wholesale' && paymentAccounts.length > 0 && !receiveAccountId) {
            showToast(t('ui.wholesale.ar.toast.chooseAccount'), 'error');
            return;
        }
        setSaving(true);
        try {
            if (receiptFor.source === 'wholesale') {
                const acc = paymentAccounts.find(a => a.id === receiveAccountId);
                await recordCustomerPayment(receiptFor.id, amount, receiptMethod, receiptNote, undefined, currentUser?.name, receiveAccountId || undefined, acc?.account_name, receiptField.meta);
            } else {
                await supabase.from('warehouse_transfer_receipts').insert([{
                    transfer_id: receiptFor.id, amount,
                    receipt_date: new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0],
                    payment_method: receiptMethod, note: receiptNote || null
                }]);
                const newReceived = receiptFor.received + amount;
                const status = newReceived >= receiptFor.total ? 'Paid' : (newReceived > 0 ? 'Partial' : 'Unpaid');
                await supabase.from('warehouse_transfers').update({ amount_received: newReceived, payment_status: status }).eq('id', receiptFor.id);
                showToast(t('ui.wholesale.ar.toast.receiptRecorded'), 'success');
            }
            setReceiptFor(null);
            refreshAll();
        } catch (e: any) {
            showToast(t('ui.wholesale.ar.toast.receiptFailed') + (e.message || ''), 'error');
        } finally { setSaving(false); }
    };

    const bothMissing = transferTableMissing && woMissing;

    return (
        <div className="acct-page" style={{ maxWidth: '100%', margin: '0 auto', background: 'var(--color-bg)', minHeight: 'var(--vh-full)' }}>
            {/* Summary — same flat cards as the financial statements */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '24px' }}>
                <SummaryCard color="#059669" label={t('ui.wholesale.ar.totalReceivable')} value={fmt(totals.totalReceivable)} />
                <SummaryCard color="#D97706" label={t('ui.wholesale.orders.stats.overdue')} value={fmt(totals.overdue)} />
                <SummaryCard color="#3B82F6" label={t('ui.wholesale.ar.openItems')} value={String(totals.count)} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <button className="secondary-button" onClick={refreshAll}>
                    <RefreshCw size={16} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} /> {t('ui.wholesale.common.refresh')}
                </button>
                <button className="secondary-button" onClick={() => navigate('/wholesale/orders')}>
                    <ShoppingCart size={18} /> {t('ui.wholesale.orders.newOrder')}
                </button>
                <button className="primary-button" disabled={transferTableMissing} onClick={() => { resetCreate(); setIsCreateOpen(true); }}>
                    <Plus size={18} /> {t('ui.wholesale.ar.newTransfer')}
                </button>
            </div>

            {/* Filters */}
            <div style={{ ...cardStyle, padding: '14px 16px', marginBottom: '12px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: '1 1 220px', minWidth: '180px' }}>
                    <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                    <input className="search-input d2-khmer" style={{ width: '100%', paddingLeft: '32px' }} placeholder={t('ui.wholesale.ar.search')} value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <select className="search-input" style={{ width: 'auto' }} value={sourceFilter} onChange={e => setSourceFilter(e.target.value as 'all' | 'wholesale' | 'transfer')}>
                    <option value="all">{t('ui.wholesale.ar.allTypes')}</option>
                    <option value="wholesale">{t('ui.wholesale.ar.wholesale')}</option>
                    <option value="transfer">{t('ui.wholesale.ar.transfer')}</option>
                </select>
                <select className="search-input" style={{ width: 'auto' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | 'overdue')}>
                    <option value="all">{t('ui.wholesale.ar.allItems')}</option>
                    <option value="overdue">{t('ui.wholesale.ar.overdueOnly')}</option>
                </select>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input type="date" className="search-input" style={{ width: 'auto' }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                    <span style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>{t('ui.wholesale.common.to')}</span>
                    <input type="date" className="search-input" style={{ width: 'auto' }} value={dateTo} onChange={e => setDateTo(e.target.value)} />
                </div>
                {hasActiveFilters && (
                    <button className="secondary-button" style={{ padding: '7px 12px', fontSize: '12px' }} onClick={clearFilters}>
                        <FilterX size={14} /> {t('ui.wholesale.common.clear')}
                    </button>
                )}
            </div>

            {bothMissing ? (
                <div style={{ ...cardStyle, padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <Database size={40} style={{ opacity: 0.25, margin: '0 auto 12px', color: '#D97706' }} />
                    <p style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{t('ui.wholesale.common.dbSetupNeeded')}</p>
                    <p style={{ fontSize: '13px' }}>
                        {t('ui.wholesale.common.dbSetupRun')} <code>migrations/full_schema.sql</code> {t('ui.wholesale.common.dbSetupThen')}
                    </p>
                </div>
            ) : receivables.length === 0 ? (
                <div style={{ ...cardStyle, padding: '48px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <HandCoins size={40} style={{ opacity: 0.2, margin: '0 auto 12px' }} />
                    <p>{t('ui.wholesale.ar.noneOutstanding')} 🎉</p>
                </div>
            ) : filteredReceivables.length === 0 ? (
                <div style={{ ...cardStyle, padding: '48px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <Search size={40} style={{ opacity: 0.2, margin: '0 auto 12px' }} />
                    <p>{t('ui.wholesale.ar.noMatch')}</p>
                    <button className="secondary-button" style={{ marginTop: '12px' }} onClick={clearFilters}>
                        <FilterX size={14} /> {t('ui.wholesale.ar.clearFilters')}
                    </button>
                </div>
            ) : isMobile ? (
                // Phones: one card per receivable — no sideways scrolling.
                <div style={{ ...cardStyle, overflow: 'hidden' }}>
                    {filteredReceivables.map(r => {
                        const od = daysOverdue(r.due_date);
                        const isWholesale = r.source === 'wholesale';
                        return (
                            <div key={r.key} style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', color: isWholesale ? '#7E22CE' : '#0369A1', background: isWholesale ? 'rgba(126,34,206,0.1)' : 'rgba(3,105,161,0.1)', flexShrink: 0 }}>
                                        {isWholesale ? t('ui.wholesale.ar.badgeWholesale') : t('ui.wholesale.ar.badgeTransfer')}
                                    </span>
                                    <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{r.date ? new Date(r.date).toLocaleDateString() : '—'}</span>
                                </div>
                                <div className="d2-khmer" style={{ fontWeight: 600, fontSize: '14px', color: 'var(--color-text-main)', margin: '6px 0 2px' }}>{r.party}</div>
                                <div className="d2-khmer" style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                    {r.desc}
                                    {r.due_date && <> · {t('ui.wholesale.common.due')} {new Date(r.due_date).toLocaleDateString()}</>}
                                    {od !== null && od > 0 && <span style={{ marginLeft: '6px', color: '#DC2626', fontWeight: 600 }}>{fill(t('ui.wholesale.orders.daysLate'), { n: od })}</span>}
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', gap: '10px' }}>
                                    <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                                        {fmt(r.total)} − {fmt(r.received)} = <span style={{ fontWeight: 700, color: '#059669' }}>{fmt(r.balance)}</span>
                                    </span>
                                    <button className="primary-button" style={{ padding: '6px 12px', fontSize: '12px', flexShrink: 0 }} onClick={() => openReceipt(r)}>{t('ui.wholesale.ar.recordReceipt')}</button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div style={{ ...cardStyle, overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '860px' }}>
                        <thead>
                            <tr style={{ background: 'var(--color-bg)' }}>
                                <th style={thStyle}>{t('ui.wholesale.common.date')}</th>
                                <th style={thStyle}>{t('ui.wholesale.common.type')}</th>
                                <th style={thStyle}>{t('ui.wholesale.ar.owedBy')}</th>
                                <th style={thStyle}>{t('ui.wholesale.ar.details')}</th>
                                <th style={thStyle}>{t('ui.wholesale.common.due')}</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>{t('common.total')}</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>{t('ui.wholesale.details.received')}</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>{t('ui.wholesale.common.balance')}</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredReceivables.map(r => {
                                const od = daysOverdue(r.due_date);
                                const isWholesale = r.source === 'wholesale';
                                return (
                                    <tr key={r.key} style={{ borderTop: '1px solid var(--color-border)' }}>
                                        <td style={tdStyle}>{r.date ? new Date(r.date).toLocaleDateString() : '—'}</td>
                                        <td style={tdStyle}>
                                            <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', color: isWholesale ? '#7E22CE' : '#0369A1', background: isWholesale ? 'rgba(126,34,206,0.1)' : 'rgba(3,105,161,0.1)' }}>
                                                {isWholesale ? t('ui.wholesale.ar.badgeWholesale') : t('ui.wholesale.ar.badgeTransfer')}
                                            </span>
                                        </td>
                                        <td style={tdStyle}>
                                            {isWholesale ? r.party : (
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                    <ArrowRight size={12} style={{ color: 'var(--color-text-muted)' }} /> {r.party}
                                                </span>
                                            )}
                                        </td>
                                        <td style={tdStyle}>{r.desc}</td>
                                        <td style={tdStyle}>
                                            {r.due_date ? new Date(r.due_date).toLocaleDateString() : '—'}
                                            {od !== null && od > 0 && <span style={{ marginLeft: '6px', fontSize: '11px', color: '#DC2626', fontWeight: 600 }}>{fill(t('ui.wholesale.orders.daysLate'), { n: od })}</span>}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(r.total)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--color-text-secondary)' }}>{fmt(r.received)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: '#059669' }}>{fmt(r.balance)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                                            <button className="primary-button" style={{ padding: '5px 10px', fontSize: '12px' }} onClick={() => openReceipt(r)}>{t('ui.wholesale.ar.recordReceipt')}</button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Transfer-on-credit create modal */}
            <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title={t('ui.wholesale.ar.transferTitle')}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                            <label style={labelStyle}>{t('ui.wholesale.orders.form.fromWarehouse')}</label>
                            <select className="search-input" style={{ width: '100%' }} value={fromWh} onChange={e => setFromWh(e.target.value)}>
                                <option value="">{t('ui.wholesale.common.select')}</option>
                                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>{t('ui.wholesale.ar.toWarehouse')}</label>
                            <select className="search-input" style={{ width: '100%' }} value={toWh} onChange={e => setToWh(e.target.value)}>
                                <option value="">{t('ui.wholesale.common.select')}</option>
                                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label style={labelStyle}>{t('ui.wholesale.common.product')}</label>
                        <select className="search-input" style={{ width: '100%' }} value={productId} onChange={e => setProductId(e.target.value)}>
                            <option value="">{t('ui.wholesale.common.select')}</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div><label style={labelStyle}>{t('ui.wholesale.common.quantity')}</label><input type="number" className="search-input" style={{ width: '100%' }} value={qty} onChange={e => setQty(e.target.value)} min="0" step="1" /></div>
                        <div><label style={labelStyle}>{t('ui.wholesale.ar.unitPriceUsd')}</label><input type="number" className="search-input" style={{ width: '100%' }} value={unitPrice} onChange={e => setUnitPrice(e.target.value)} min="0" step="0.01" /></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'end' }}>
                        <div><label style={labelStyle}>{t('ui.wholesale.ar.dueDateOptional')}</label><input type="date" className="search-input" style={{ width: '100%' }} value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
                        <div style={{ textAlign: 'right', fontSize: '13px', color: 'var(--color-text-secondary)' }}>{t('ui.wholesale.ar.totalColon')} <strong style={{ color: 'var(--color-text-main)', fontSize: '16px' }}>{fmt((Number(qty) || 0) * (Number(unitPrice) || 0))}</strong></div>
                    </div>
                    <div><label style={labelStyle}>{t('ui.wholesale.ar.noteOptional')}</label><input type="text" className="search-input" style={{ width: '100%' }} value={note} onChange={e => setNote(e.target.value)} /></div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                        <button className="secondary-button" onClick={() => setIsCreateOpen(false)}>{t('common.cancel')}</button>
                        <button className="primary-button" disabled={saving} onClick={submitTransfer}>{saving ? t('ui.wholesale.common.saving') : t('ui.wholesale.ar.recordTransfer')}</button>
                    </div>
                </div>
            </Modal>

            {/* Receipt modal */}
            <Modal isOpen={!!receiptFor} onClose={() => setReceiptFor(null)} title={t('ui.wholesale.ar.recordReceipt')}>
                {receiptFor && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                            {receiptFor.party} · {receiptFor.desc}
                            <div style={{ marginTop: '4px', color: '#059669', fontWeight: 600 }}>{t('ui.wholesale.ar.balanceColon')} {fmt(receiptFor.balance)}</div>
                        </div>
                        {/* Warehouse-transfer receipts have no currency columns: USD only (with the warning). */}
                        <MoneyInput
                            field={receiptField}
                            label={t('common.amount')}
                            allowKhr={receiptFor.source === 'wholesale'}
                            onToggleCurrency={receiptCoupling.onToggleCurrency}
                            khrUnavailableReason={receiptCoupling.khrUnavailableReason}
                            labelStyle={labelStyle}
                        />
                        <div><label style={labelStyle}>{t('ui.wholesale.common.method')}</label>
                            <select className="search-input" style={{ width: '100%' }} value={receiptMethod} onChange={e => setReceiptMethod(e.target.value)}>
                                <option value="Cash">{t('ui.wholesale.methods.cash')}</option><option value="Bank Transfer">{t('ui.wholesale.methods.bankTransfer')}</option><option value="Credit Card">{t('ui.wholesale.methods.creditCard')}</option><option value="Cheque">{t('ui.wholesale.methods.cheque')}</option>
                            </select>
                        </div>
                        {receiptFor.source === 'wholesale' && (
                            <div><label style={labelStyle}>{t('ui.wholesale.ar.receivedInto')} *</label>
                                <select className="search-input d2-khmer" style={{ width: '100%' }} value={receiveAccountId} onChange={e => receiptCoupling.onAccountChange(e.target.value)}>
                                    <option value="">{t('ui.wholesale.setup.bankOrCash')}</option>
                                    <CashBankOptions accounts={paymentAccounts} />
                                </select>
                                {paymentAccounts.length === 0 && (
                                    <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                                        {t('ui.wholesale.ar.noCashAccounts')}
                                    </div>
                                )}
                            </div>
                        )}
                        <div><label style={labelStyle}>{t('ui.wholesale.ar.noteOptional')}</label><input type="text" className="search-input" style={{ width: '100%' }} value={receiptNote} onChange={e => setReceiptNote(e.target.value)} /></div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button className="secondary-button" onClick={() => setReceiptFor(null)}>{t('common.cancel')}</button>
                            <button className="primary-button" disabled={saving} onClick={submitReceipt}>{saving ? t('ui.wholesale.common.saving') : t('ui.wholesale.ar.recordReceipt')}</button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

// The flat card + big colored total used across the financial statements.
const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };

const SummaryCard: React.FC<{ color: string; label: string; value: string }> = ({ color, label, value }) => (
    <div style={{ ...cardStyle, padding: '16px 20px' }}>
        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: '26px', fontWeight: 800, color, marginTop: '6px', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
);

const thStyle: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' };
const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: '13px', whiteSpace: 'nowrap' };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--color-text-secondary)' };

export default AccountsReceivablePage;
