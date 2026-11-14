import React, { useEffect, useMemo, useState } from 'react';
import { DollarSign, RefreshCw, FileCheck, Search, FilterX } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useProcurement } from '../../hooks/useProcurement';
import { useAccounting } from '../../hooks/useAccounting';
import { usePersistedDateRange } from '../../hooks/usePersistedDateRange';
import { Modal } from '../../components';
import { useToast } from '../../context/ToastContext';
import type { PurchaseOrder } from '../../types';
import { useMobile } from '../../hooks/useMobile';
import { useLanguage } from '../../context/LanguageContext';
import { fill } from '../../i18n/translate';
import MoneyInput from '../../components/MoneyInput';
import CashBankOptions from '../../components/CashBankOptions';
import { useAccountCurrency, useMoneyField } from '../../hooks/useMoneyField';
import { accountCurrency, khrToUsd, usdToKhr } from '../../utils/currency';

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

// Whole days from a due date until today (positive = overdue).
const daysOverdue = (due?: string): number | null => {
    if (!due) return null;
    const d = new Date(due); d.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((today.getTime() - d.getTime()) / 86400000);
};

// Flat row for the payables table — one per open purchase order.
interface Payable {
    key: string;
    date?: string;
    party: string;
    desc: string;
    due_date?: string;
    total: number;
    paid: number;
    balance: number;
    po: PurchaseOrder & { outstanding: number };
}

const AccountsPayablePage: React.FC = () => {
    const isMobile = useMobile();
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { t } = useLanguage();
    const navigate = useNavigate();
    const { currentUser, khrExchangeRate } = useStore();
    const { purchaseOrders, suppliers, isLoading, fetchPurchaseOrders, fetchSuppliers, recordSupplierPayment } = useProcurement();

    const [payPO, setPayPO] = useState<PurchaseOrder | null>(null);
    const [payMethod, setPayMethod] = useState('Cash');
    const [payAccountId, setPayAccountId] = useState('');
    const [payNote, setPayNote] = useState('');
    const [saving, setSaving] = useState(false);

    // Filters
    const [search, setSearch] = useState('');
    const [supplierFilter, setSupplierFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'overdue'>('all');
    const [apDateRange, setApDateRange] = usePersistedDateRange('accounts_payable_range');
    const dateFrom = apDateRange.start;
    const dateTo = apDateRange.end;
    const setDateFrom = (v: string) => setApDateRange(r => ({ ...r, start: v }));
    const setDateTo = (v: string) => setApDateRange(r => ({ ...r, end: v }));

    const { accounts, fetchAccounts } = useAccounting();
    const { purchaseSettings } = useStore();
    useEffect(() => { fetchAccounts(); }, [fetchAccounts]);
    // Cash/bank ledger accounts for the "Paid from" select.
    const paymentAccounts = useMemo(
        () => accounts.filter(a => a.is_active && a.account_type === 'Asset' && /cash|bank/i.test(a.account_name)),
        [accounts]
    );
    // The amount, USD or riel (coupled to "Paid from"); above the bill's
    // balance it warns (likely riel typed as dollars).
    const payBalance = payPO ? Math.max(0, (payPO.total_amount || 0) - (payPO.amount_paid || 0)) : 0;
    const payField = useMoneyField({ shopRate: khrExchangeRate, maxPlausibleUsd: payBalance || null });
    const payCoupling = useAccountCurrency(payField, paymentAccounts, payAccountId, setPayAccountId);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>{t('nav.accountsPayable')}</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>{t('ui.accounting.ap.subtitle')}</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

    useEffect(() => {
        fetchPurchaseOrders();
        fetchSuppliers();
    }, [fetchPurchaseOrders, fetchSuppliers]);

    // Rule (FIN-1 + FIN-2): a payable exists only once the goods are RECEIVED —
    // that is when the books credit Accounts Payable (Dr Inventory / Cr A/P,
    // see postPurchaseReceiptEntry). A Draft or Sent PO is not owed yet, so it
    // must not raise Total Payable (which made this page disagree with the
    // Financial Dashboard's Payables), and it must not offer Record Payment:
    // paying an unreceived PO books the cost as purchase expense (the DB
    // function record_supplier_payments debits A/P only when the PO's receive
    // entry exists) and the later receive books Dr Inventory for the full
    // total again — double-counting the cost. This app has no prepayment
    // account convention to book such a deposit against, so it is refused
    // here; record the payment after the PO is received.
    const openPOs = useMemo(() => {
        return purchaseOrders
            .filter(po => po.status === 'Received')
            .map(po => ({ ...po, outstanding: (po.total_amount || 0) - (po.amount_paid || 0) }))
            .filter(po => po.outstanding > 0.005);
    }, [purchaseOrders]);

    const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name || t('ui.accounting.ap.unknownSupplier');

    // Build the unified payables list — one row per open purchase order, newest first.
    const payables = useMemo<Payable[]>(() => {
        return openPOs
            .map(po => ({
                key: po.id,
                date: po.order_date,
                party: supplierName(po.supplier_id),
                desc: po.invoice_number || `PO-${po.id.slice(0, 8)}`,
                due_date: po.payment_due_date,
                total: po.total_amount || 0,
                paid: po.amount_paid || 0,
                balance: po.outstanding,
                po
            }))
            .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    }, [openPOs, suppliers]);

    // Only suppliers that actually have an open payable — a supplier with no
    // balance would just be a dead option in the filter.
    const payableSuppliers = useMemo(() => {
        const ids = new Set(openPOs.map(po => po.supplier_id));
        return suppliers
            .filter(s => ids.has(s.id))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [openPOs, suppliers]);

    const filteredPayables = useMemo(() => {
        const q = search.trim().toLowerCase();
        return payables.filter(p => {
            if (supplierFilter !== 'all' && p.po.supplier_id !== supplierFilter) return false;
            if (statusFilter === 'overdue') {
                const od = daysOverdue(p.due_date);
                if (od === null || od <= 0) return false;
            }
            const d = (p.date || '').slice(0, 10);
            if (dateFrom && d < dateFrom) return false;
            if (dateTo && d > dateTo) return false;
            if (q && !(p.party.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q))) return false;
            return true;
        });
    }, [payables, search, supplierFilter, statusFilter, dateFrom, dateTo]);

    // Summary cards follow the active filters, so they total what the table shows.
    const totals = useMemo(() => {
        const totalPayable = filteredPayables.reduce((s, p) => s + p.balance, 0);
        const overdue = filteredPayables.reduce((s, p) => {
            const od = daysOverdue(p.due_date);
            return s + (od !== null && od > 0 ? p.balance : 0);
        }, 0);
        return { totalPayable, overdue, count: filteredPayables.length };
    }, [filteredPayables]);

    const hasActiveFilters = !!search || supplierFilter !== 'all' || statusFilter !== 'all' || !!dateFrom || !!dateTo;
    const clearFilters = () => { setSearch(''); setSupplierFilter('all'); setStatusFilter('all'); setDateFrom(''); setDateTo(''); };

    const openPay = (po: PurchaseOrder & { outstanding: number }) => {
        setPayPO(po);
        setPayMethod('Cash');
        setPayNote('');
        // Purchase Setup's default payment account prefills "Paid from".
        const def = purchaseSettings.defaultPaymentAccountId;
        const id = def && paymentAccounts.some(a => a.id === def) ? def : '';
        setPayAccountId(id);
        // A riel default account opens in riel.
        payField.reset(accountCurrency(paymentAccounts.find(a => a.id === id)) === 'KHR'
            ? { amount: usdToKhr(po.outstanding, payField.shopRate), currency: 'KHR' }
            : { amount: po.outstanding.toFixed(2), currency: 'USD' });
    };

    const submitPayment = async () => {
        if (!payPO) return;
        // Guard (FIN-1): the list above only offers Received POs, but a stale
        // modal (PO edited elsewhere meanwhile) must not book a payment that
        // would expense an unreceived purchase — the receive would then book
        // the full cost again.
        if (payPO.status !== 'Received') {
            showToast(t('ui.accounting.ap.toast.notReceived'), 'error');
            return;
        }
        // Riel within 3 cents of the whole balance pays exactly the balance.
        const rate = Number(payField.rate) > 0 ? Number(payField.rate) : payField.shopRate;
        const amount = payField.currency === 'KHR' && Math.abs(khrToUsd(payField.typed, rate) - payBalance) <= 0.03 ? payBalance : payField.usd;
        if (!amount || amount <= 0) { showToast(t('ui.accounting.common.toast.enterValidAmount'), 'error'); return; }
        if (payField.rateInvalid) { showToast(t('ui.accounting.common.toast.rielRate'), 'error'); return; }
        if (paymentAccounts.length > 0 && !payAccountId) { showToast(t('ui.accounting.common.toast.choosePaidFrom'), 'error'); return; }
        if (!payField.confirmIfSuspicious()) return;
        setSaving(true);
        try {
            const acc = paymentAccounts.find(a => a.id === payAccountId);
            await recordSupplierPayment(payPO.id, payPO.supplier_id, amount, payMethod, payNote, undefined, currentUser?.name, payAccountId || undefined, acc?.account_name, payField.meta);
            setPayPO(null);
        } catch {
            /* hook already toasts */
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="acct-page" style={{ maxWidth: '100%', margin: '0 auto', background: 'var(--color-bg)', minHeight: 'var(--vh-full)' }}>
            {/* Summary — same flat cards as the financial statements */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '24px' }}>
                <SummaryCard color="#EF4444" label={t('ui.accounting.ap.totalPayable')} value={fmt(totals.totalPayable)} />
                <SummaryCard color="#D97706" label={t('ui.accounting.ap.overdue')} value={fmt(totals.overdue)} />
                <SummaryCard color="#3B82F6" label={t('ui.accounting.ap.openItems')} value={String(totals.count)} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <button className="secondary-button" onClick={() => { fetchPurchaseOrders(); fetchSuppliers(); }}>
                    <RefreshCw size={16} style={isLoading ? { animation: 'spin 1s linear infinite' } : undefined} /> {t('ui.accounting.common.refresh')}
                </button>
                <button className="secondary-button" onClick={() => navigate('/procurement/purchase-orders')}>
                    <FileCheck size={18} /> {t('ui.accounting.ap.newPurchaseOrder')}
                </button>
            </div>

            {/* Filters */}
            <div style={{ ...cardStyle, padding: '14px 16px', marginBottom: '12px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: '1 1 220px', minWidth: '180px' }}>
                    <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                    <input className="search-input d2-khmer" style={{ width: '100%', paddingLeft: '32px' }} placeholder={t('ui.accounting.ap.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <select className="search-input d2-khmer" style={{ width: 'auto', maxWidth: '220px' }} value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}>
                    <option value="all">{t('ui.accounting.ap.allSuppliers')}</option>
                    {payableSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select className="search-input" style={{ width: 'auto' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | 'overdue')}>
                    <option value="all">{t('ui.accounting.ap.allItems')}</option>
                    <option value="overdue">{t('ui.accounting.ap.overdueOnly')}</option>
                </select>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input type="date" className="search-input" style={{ width: 'auto' }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                    <span style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>{t('ui.accounting.common.to')}</span>
                    <input type="date" className="search-input" style={{ width: 'auto' }} value={dateTo} onChange={e => setDateTo(e.target.value)} />
                </div>
                {hasActiveFilters && (
                    <button className="secondary-button" style={{ padding: '7px 12px', fontSize: '12px' }} onClick={clearFilters}>
                        <FilterX size={14} /> {t('ui.accounting.common.clear')}
                    </button>
                )}
            </div>

            {payables.length === 0 ? (
                <div style={{ ...cardStyle, padding: '48px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <DollarSign size={40} style={{ opacity: 0.2, margin: '0 auto 12px' }} />
                    <p>{t('ui.accounting.ap.emptyAll')}</p>
                </div>
            ) : filteredPayables.length === 0 ? (
                <div style={{ ...cardStyle, padding: '48px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <Search size={40} style={{ opacity: 0.2, margin: '0 auto 12px' }} />
                    <p>{t('ui.accounting.ap.emptyFiltered')}</p>
                    <button className="secondary-button" style={{ marginTop: '12px' }} onClick={clearFilters}>
                        <FilterX size={14} /> {t('ui.accounting.common.clearFilters')}
                    </button>
                </div>
            ) : isMobile ? (
                // Phones: one card per payable — no sideways scrolling.
                <div style={{ ...cardStyle, overflow: 'hidden' }}>
                    {filteredPayables.map(p => {
                        const od = daysOverdue(p.due_date);
                        return (
                            <div key={p.key} style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                                    <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{p.desc}</span>
                                    <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{p.date ? new Date(p.date).toLocaleDateString() : '—'}</span>
                                </div>
                                <div className="d2-khmer" style={{ fontWeight: 600, fontSize: '14px', color: 'var(--color-text-main)', margin: '6px 0 2px' }}>{p.party}</div>
                                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                    {p.due_date ? fill(t('ui.accounting.ap.dueOn'), { date: new Date(p.due_date).toLocaleDateString() }) : t('ui.accounting.ap.noDueDate')}
                                    {od !== null && od > 0 && <span style={{ marginLeft: '6px', color: '#DC2626', fontWeight: 600 }}>{fill(t('ui.accounting.ap.daysLate'), { n: od })}</span>}
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', gap: '10px' }}>
                                    <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                                        {fmt(p.total)} − {fmt(p.paid)} = <span style={{ fontWeight: 700, color: '#EF4444' }}>{fmt(p.balance)}</span>
                                    </span>
                                    <button className="primary-button" style={{ padding: '6px 12px', fontSize: '12px', flexShrink: 0 }} onClick={() => openPay(p.po)}>{t('ui.accounting.ap.recordPayment')}</button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div style={{ ...cardStyle, overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '780px' }}>
                        <thead>
                            <tr style={{ background: 'var(--color-bg)' }}>
                                <th style={thStyle}>{t('ui.accounting.common.date')}</th>
                                <th style={thStyle}>{t('ui.accounting.ap.supplier')}</th>
                                <th style={thStyle}>{t('ui.accounting.ap.invoicePo')}</th>
                                <th style={thStyle}>{t('ui.accounting.ap.due')}</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>{t('common.total')}</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>{t('status.paid')}</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>{t('ui.accounting.common.balance')}</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredPayables.map(p => {
                                const od = daysOverdue(p.due_date);
                                return (
                                    <tr key={p.key} style={{ borderTop: '1px solid var(--color-border)' }}>
                                        <td style={tdStyle}>{p.date ? new Date(p.date).toLocaleDateString() : '—'}</td>
                                        <td style={tdStyle}>{p.party}</td>
                                        <td style={tdStyle}>{p.desc}</td>
                                        <td style={tdStyle}>
                                            {p.due_date ? new Date(p.due_date).toLocaleDateString() : '—'}
                                            {od !== null && od > 0 && <span style={{ marginLeft: '6px', fontSize: '11px', color: '#DC2626', fontWeight: 600 }}>{fill(t('ui.accounting.ap.daysLate'), { n: od })}</span>}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(p.total)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--color-text-secondary)' }}>{fmt(p.paid)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: '#EF4444' }}>{fmt(p.balance)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                                            <button className="primary-button" style={{ padding: '5px 10px', fontSize: '12px' }} onClick={() => openPay(p.po)}>
                                                {t('ui.accounting.ap.recordPayment')}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <Modal isOpen={!!payPO} onClose={() => setPayPO(null)} title={t('ui.accounting.ap.recordSupplierPayment')}>
                {payPO && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                            {supplierName(payPO.supplier_id)} · {payPO.invoice_number || `PO-${payPO.id.slice(0, 8)}`}
                            <div style={{ marginTop: '4px', color: '#EF4444', fontWeight: 600 }}>{t('ui.accounting.common.balance')}: {fmt((payPO.total_amount || 0) - (payPO.amount_paid || 0))}</div>
                        </div>
                        <MoneyInput
                            field={payField}
                            label={t('common.amount')}
                            allowKhr
                            onToggleCurrency={payCoupling.onToggleCurrency}
                            khrUnavailableReason={payCoupling.khrUnavailableReason}
                            labelStyle={labelStyle}
                        />
                        <div>
                            <label style={labelStyle}>{t('ui.accounting.common.paymentMethod')}</label>
                            <select className="search-input" style={{ width: '100%' }} value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                                <option value="Cash">{t('ui.accounting.common.method.cash')}</option><option value="Bank Transfer">{t('ui.accounting.common.method.bankTransfer')}</option><option value="Credit Card">{t('ui.accounting.common.method.creditCard')}</option><option value="Cheque">{t('ui.accounting.common.method.cheque')}</option>
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>{t('ui.accounting.common.paidFrom')} *</label>
                            <select className="search-input d2-khmer" style={{ width: '100%' }} value={payAccountId} onChange={e => payCoupling.onAccountChange(e.target.value)}>
                                <option value="">{t('ui.accounting.common.bankOrCashAccount')}</option>
                                <CashBankOptions accounts={paymentAccounts} />
                            </select>
                            {paymentAccounts.length === 0 && (
                                <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                                    {t('ui.accounting.common.noCashBankAccounts')}
                                </div>
                            )}
                        </div>
                        <div>
                            <label style={labelStyle}>{t('ui.accounting.common.noteOptional')}</label>
                            <input type="text" className="search-input" style={{ width: '100%' }} value={payNote} onChange={e => setPayNote(e.target.value)} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button className="secondary-button" onClick={() => setPayPO(null)}>{t('common.cancel')}</button>
                            <button className="primary-button" disabled={saving} onClick={submitPayment}>{saving ? t('ui.accounting.common.saving') : t('ui.accounting.ap.recordPayment')}</button>
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

export default AccountsPayablePage;
