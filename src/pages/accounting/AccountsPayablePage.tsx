import React, { useEffect, useMemo, useState } from 'react';
import { DollarSign, RefreshCw, FileCheck, Search, FilterX } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useProcurement } from '../../hooks/useProcurement';
import { useAccounting } from '../../hooks/useAccounting';
import { Modal } from '../../components';
import { useToast } from '../../context/ToastContext';
import type { PurchaseOrder } from '../../types';
import { useMobile } from '../../hooks/useMobile';

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
    const navigate = useNavigate();
    const { currentUser } = useStore();
    const { purchaseOrders, suppliers, isLoading, fetchPurchaseOrders, fetchSuppliers, recordSupplierPayment } = useProcurement();

    const [payPO, setPayPO] = useState<PurchaseOrder | null>(null);
    const [payAmount, setPayAmount] = useState<number | string>('');
    const [payMethod, setPayMethod] = useState('Cash');
    const [payAccountId, setPayAccountId] = useState('');
    const [payNote, setPayNote] = useState('');
    const [saving, setSaving] = useState(false);

    // Filters
    const [search, setSearch] = useState('');
    const [supplierFilter, setSupplierFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'overdue'>('all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    const { accounts, fetchAccounts } = useAccounting();
    const { purchaseSettings } = useStore();
    useEffect(() => { fetchAccounts(); }, [fetchAccounts]);
    // Cash/bank ledger accounts for the "Paid from" select.
    const paymentAccounts = useMemo(
        () => accounts.filter(a => a.is_active && a.account_type === 'Asset' && /cash|bank/i.test(a.account_name)),
        [accounts]
    );

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Accounts Payable</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Money you owe suppliers on credit purchase orders.</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchPurchaseOrders();
        fetchSuppliers();
    }, [fetchPurchaseOrders, fetchSuppliers]);

    // A PO is "on credit" while it still has an outstanding balance and isn't cancelled.
    const openPOs = useMemo(() => {
        return purchaseOrders
            .filter(po => po.status !== 'Cancelled')
            .map(po => ({ ...po, outstanding: (po.total_amount || 0) - (po.amount_paid || 0) }))
            .filter(po => po.outstanding > 0.005);
    }, [purchaseOrders]);

    const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name || 'Unknown supplier';

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

    const totals = useMemo(() => {
        const totalPayable = openPOs.reduce((s, po) => s + po.outstanding, 0);
        const overdue = openPOs.reduce((s, po) => {
            const od = daysOverdue(po.payment_due_date);
            return s + (od !== null && od > 0 ? po.outstanding : 0);
        }, 0);
        return { totalPayable, overdue, count: openPOs.length };
    }, [openPOs]);

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

    const hasActiveFilters = !!search || supplierFilter !== 'all' || statusFilter !== 'all' || !!dateFrom || !!dateTo;
    const clearFilters = () => { setSearch(''); setSupplierFilter('all'); setStatusFilter('all'); setDateFrom(''); setDateTo(''); };

    const openPay = (po: PurchaseOrder & { outstanding: number }) => {
        setPayPO(po);
        setPayAmount(po.outstanding.toFixed(2));
        setPayMethod('Cash');
        setPayNote('');
        // Purchase Setup's default payment account prefills "Paid from".
        const def = purchaseSettings.defaultPaymentAccountId;
        setPayAccountId(def && paymentAccounts.some(a => a.id === def) ? def : '');
    };

    const submitPayment = async () => {
        if (!payPO) return;
        const amount = Number(payAmount);
        if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }
        if (paymentAccounts.length > 0 && !payAccountId) { showToast('Choose the account this payment is paid from', 'error'); return; }
        setSaving(true);
        try {
            const acc = paymentAccounts.find(a => a.id === payAccountId);
            await recordSupplierPayment(payPO.id, payPO.supplier_id, amount, payMethod, payNote, undefined, currentUser?.name, payAccountId || undefined, acc?.account_name);
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
                <SummaryCard color="#EF4444" label="Total Payable" value={fmt(totals.totalPayable)} />
                <SummaryCard color="#D97706" label="Overdue" value={fmt(totals.overdue)} />
                <SummaryCard color="#3B82F6" label="Open Items" value={String(totals.count)} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <button className="secondary-button" onClick={() => { fetchPurchaseOrders(); fetchSuppliers(); }}>
                    <RefreshCw size={16} style={isLoading ? { animation: 'spin 1s linear infinite' } : undefined} /> Refresh
                </button>
                <button className="secondary-button" onClick={() => navigate('/procurement/purchase-orders')}>
                    <FileCheck size={18} /> New Purchase Order
                </button>
            </div>

            {/* Filters */}
            <div style={{ ...cardStyle, padding: '14px 16px', marginBottom: '12px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: '1 1 220px', minWidth: '180px' }}>
                    <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                    <input className="search-input d2-khmer" style={{ width: '100%', paddingLeft: '32px' }} placeholder="Search supplier, invoice…" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <select className="search-input d2-khmer" style={{ width: 'auto', maxWidth: '220px' }} value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}>
                    <option value="all">All Suppliers</option>
                    {payableSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select className="search-input" style={{ width: 'auto' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | 'overdue')}>
                    <option value="all">All Items</option>
                    <option value="overdue">Overdue Only</option>
                </select>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input type="date" className="search-input" style={{ width: 'auto' }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                    <span style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>to</span>
                    <input type="date" className="search-input" style={{ width: 'auto' }} value={dateTo} onChange={e => setDateTo(e.target.value)} />
                </div>
                {hasActiveFilters && (
                    <button className="secondary-button" style={{ padding: '7px 12px', fontSize: '12px' }} onClick={clearFilters}>
                        <FilterX size={14} /> Clear
                    </button>
                )}
            </div>

            {payables.length === 0 ? (
                <div style={{ ...cardStyle, padding: '48px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <DollarSign size={40} style={{ opacity: 0.2, margin: '0 auto 12px' }} />
                    <p>No outstanding payables. All purchase orders are paid. 🎉</p>
                </div>
            ) : filteredPayables.length === 0 ? (
                <div style={{ ...cardStyle, padding: '48px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <Search size={40} style={{ opacity: 0.2, margin: '0 auto 12px' }} />
                    <p>No payables match your filters.</p>
                    <button className="secondary-button" style={{ marginTop: '12px' }} onClick={clearFilters}>
                        <FilterX size={14} /> Clear filters
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
                                    {p.due_date ? <>Due {new Date(p.due_date).toLocaleDateString()}</> : 'No due date'}
                                    {od !== null && od > 0 && <span style={{ marginLeft: '6px', color: '#DC2626', fontWeight: 600 }}>{od}d late</span>}
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', gap: '10px' }}>
                                    <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                                        {fmt(p.total)} − {fmt(p.paid)} = <span style={{ fontWeight: 700, color: '#EF4444' }}>{fmt(p.balance)}</span>
                                    </span>
                                    <button className="primary-button" style={{ padding: '6px 12px', fontSize: '12px', flexShrink: 0 }} onClick={() => openPay(p.po)}>Record Payment</button>
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
                                <th style={thStyle}>Date</th>
                                <th style={thStyle}>Supplier</th>
                                <th style={thStyle}>Invoice / PO</th>
                                <th style={thStyle}>Due</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Paid</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Balance</th>
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
                                            {od !== null && od > 0 && <span style={{ marginLeft: '6px', fontSize: '11px', color: '#DC2626', fontWeight: 600 }}>{od}d late</span>}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(p.total)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--color-text-secondary)' }}>{fmt(p.paid)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: '#EF4444' }}>{fmt(p.balance)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                                            <button className="primary-button" style={{ padding: '5px 10px', fontSize: '12px' }} onClick={() => openPay(p.po)}>
                                                Record Payment
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <Modal isOpen={!!payPO} onClose={() => setPayPO(null)} title="Record Supplier Payment">
                {payPO && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                            {supplierName(payPO.supplier_id)} · {payPO.invoice_number || `PO-${payPO.id.slice(0, 8)}`}
                            <div style={{ marginTop: '4px', color: '#EF4444', fontWeight: 600 }}>Balance: {fmt((payPO.total_amount || 0) - (payPO.amount_paid || 0))}</div>
                        </div>
                        <div>
                            <label style={labelStyle}>Amount ($)</label>
                            <input type="number" className="search-input" style={{ width: '100%' }} value={payAmount} onChange={e => setPayAmount(e.target.value)} min="0" step="0.01" />
                        </div>
                        <div>
                            <label style={labelStyle}>Payment Method</label>
                            <select className="search-input" style={{ width: '100%' }} value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                                <option>Cash</option><option>Bank Transfer</option><option>Credit Card</option><option>Cheque</option>
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>Paid from *</label>
                            <select className="search-input d2-khmer" style={{ width: '100%' }} value={payAccountId} onChange={e => setPayAccountId(e.target.value)}>
                                <option value="">Bank or cash account…</option>
                                {paymentAccounts.map(a => <option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>)}
                            </select>
                            {paymentAccounts.length === 0 && (
                                <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                                    No cash or bank accounts in the Chart of Accounts yet — the payment saves without one.
                                </div>
                            )}
                        </div>
                        <div>
                            <label style={labelStyle}>Note (optional)</label>
                            <input type="text" className="search-input" style={{ width: '100%' }} value={payNote} onChange={e => setPayNote(e.target.value)} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button className="secondary-button" onClick={() => setPayPO(null)}>Cancel</button>
                            <button className="primary-button" disabled={saving} onClick={submitPayment}>{saving ? 'Saving…' : 'Record Payment'}</button>
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
