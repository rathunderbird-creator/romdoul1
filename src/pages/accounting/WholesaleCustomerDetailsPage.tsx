import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, User, Phone, Receipt, FileText, DollarSign, Trash2, Calendar } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useHeader } from '../../context/HeaderContext';
import { useToast } from '../../context/ToastContext';
import { useWholesale } from '../../hooks/useWholesale';
import type { WholesaleCustomer, WholesaleOrder } from '../../types';

const fmt = (v: number) => (v === 0 ? '$0.00' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v));

interface LedgerEntry {
    id: string;
    date: string;
    type: 'Invoice' | 'Payment';
    description: string;
    reference: string;
    invoiceNumber: string;
    paymentMethod: string;
    debt: number;
    paid: number;
    balance: number;
}

const WholesaleCustomerDetailsPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { deleteWholesaleOrder, deleteCustomerPayment } = useWholesale();

    const [customer, setCustomer] = useState<WholesaleCustomer | null>(null);
    const [orders, setOrders] = useState<WholesaleOrder[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [dateStart, setDateStart] = useState('');
    const [dateEnd, setDateEnd] = useState('');

    const header = (name: string, sub: string) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <button onClick={() => navigate('/wholesale/customers')} className="hover-highlight" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '8px', display: 'flex', alignItems: 'center', color: 'var(--color-text-secondary)' }}>
                <ArrowLeft size={20} />
            </button>
            <div>
                <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>{name}</h1>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>{sub}</p>
            </div>
        </div>
    );

    const fetchData = React.useCallback(async () => {
        if (!id) return;
        setIsLoading(true);
        try {
            const { data: cust, error: cErr } = await supabase.from('wholesale_customers').select('*').eq('id', id).single();
            if (cErr) throw cErr;
            setCustomer(cust);
            setHeaderContent({ title: header(`${cust.name} — Ledger`, 'Account statement and payment history') });

            // Orders for this customer (matched by name), with items + payments.
            const { data: ordData, error: oErr } = await supabase
                .from('wholesale_orders')
                .select('*, items:wholesale_order_items(*), payments:customer_payments(*)')
                .ilike('customer_name', cust.name);
            if (oErr) throw oErr;
            setOrders((ordData || []) as WholesaleOrder[]);
        } catch (error: any) {
            console.error('Error fetching customer ledger:', error);
            showToast('Failed to load customer details: ' + error.message, 'error');
        } finally {
            setIsLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    useEffect(() => {
        setHeaderContent({ title: header('Customer Ledger', 'Loading customer details...') });
        fetchData();
        return () => setHeaderContent(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchData]);

    const ledger = useMemo(() => {
        const entries: Omit<LedgerEntry, 'balance'>[] = [];
        orders.forEach(o => {
            const desc = (o.items && o.items.length > 0)
                ? o.items.map(i => `${i.product_name || 'Item'}=${i.quantity}($${i.unit_price})`).join(', ')
                : `Wholesale Order #${o.id.slice(0, 8)}`;
            entries.push({
                id: `wo-${o.id}`, date: o.order_date, type: 'Invoice', description: desc,
                reference: o.id.slice(0, 8).toUpperCase(), invoiceNumber: o.invoice_number || '',
                paymentMethod: '', debt: Number(o.total_amount) || 0, paid: 0
            });
            (o.payments || []).forEach((p: any) => {
                entries.push({
                    id: `pay-${p.id}`, date: p.payment_date, type: 'Payment',
                    description: `Payment ${fmt(Number(p.amount) || 0)}${p.notes ? ' — ' + p.notes : ''}`,
                    reference: o.id.slice(0, 8).toUpperCase(), invoiceNumber: '',
                    paymentMethod: p.payment_method || '', debt: 0, paid: Number(p.amount) || 0
                });
            });
        });
        entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        let bal = 0;
        return entries.map(e => { bal += e.debt - e.paid; return { ...e, balance: bal }; }).reverse();
    }, [orders]);

    const filteredLedger = useMemo(() => ledger.filter(e => {
        if (dateStart && e.date < dateStart) return false;
        if (dateEnd && e.date > dateEnd) return false;
        return true;
    }), [ledger, dateStart, dateEnd]);

    const stats = useMemo(() => {
        const totalDebt = ledger.reduce((s, e) => s + e.debt, 0);
        const totalPaid = ledger.reduce((s, e) => s + e.paid, 0);
        const paidPercent = totalDebt > 0 ? Math.min(100, Math.round((totalPaid / totalDebt) * 100)) : 0;
        return { totalDebt, totalPaid, balance: totalDebt - totalPaid, paidPercent };
    }, [ledger]);

    const filteredTotals = useMemo(() => ({
        totalDebt: filteredLedger.reduce((s, e) => s + e.debt, 0),
        totalPaid: filteredLedger.reduce((s, e) => s + e.paid, 0),
    }), [filteredLedger]);

    const handleDelete = async (entry: LedgerEntry) => {
        if (!window.confirm(`Delete this ${entry.type}? This cannot be undone.`)) return;
        try {
            if (entry.id.startsWith('wo-')) {
                const order = orders.find(o => o.id === entry.id.replace('wo-', ''));
                if (order) await deleteWholesaleOrder(order); // restores stock
            } else if (entry.id.startsWith('pay-')) {
                await deleteCustomerPayment(entry.id.replace('pay-', ''));
            }
            await fetchData();
        } catch { /* hook toasts */ }
    };

    if (isLoading) {
        return <div className="page-container fade-in" style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><div className="loader" /></div>;
    }
    if (!customer) {
        return (
            <div className="page-container fade-in">
                <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
                    <h3>Customer not found</h3>
                    <button className="primary-button" onClick={() => navigate('/wholesale/customers')} style={{ marginTop: '16px' }}>Back to Customers</button>
                </div>
            </div>
        );
    }

    return (
        <div className="page-container fade-in">
            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '18px 20px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><User size={22} /></div>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Customer</div>
                        <div style={{ fontSize: '17px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customer.name}</div>
                        {customer.phone && <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}><Phone size={10} />{customer.phone}</div>}
                    </div>
                </div>
                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '18px 20px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #ef4444, #f87171)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Receipt size={22} /></div>
                    <div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Total Invoiced</div>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: '#ef4444' }}>{fmt(stats.totalDebt)}</div>
                    </div>
                </div>
                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '18px 20px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #10b981, #34d399)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><DollarSign size={22} /></div>
                    <div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Total Received</div>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: '#10b981' }}>{fmt(stats.totalPaid)}</div>
                    </div>
                </div>
                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '18px 20px', background: stats.balance > 0 ? 'rgba(239, 68, 68, 0.03)' : undefined }}>
                    <div style={{ position: 'relative', width: '48px', height: '48px', flexShrink: 0 }}>
                        <svg width="48" height="48" viewBox="0 0 48 48" style={{ transform: 'rotate(-90deg)' }}>
                            <circle cx="24" cy="24" r="20" fill="none" stroke="var(--color-border)" strokeWidth="4" />
                            <circle cx="24" cy="24" r="20" fill="none" stroke={stats.paidPercent >= 100 ? '#10b981' : stats.paidPercent >= 50 ? '#3b82f6' : '#f59e0b'} strokeWidth="4" strokeDasharray={`${(stats.paidPercent / 100) * 125.66} 125.66`} strokeLinecap="round" />
                        </svg>
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, color: 'var(--color-text-secondary)' }}>{stats.paidPercent}%</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Outstanding</div>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: stats.balance > 0 ? '#ef4444' : '#10b981' }}>{fmt(stats.balance)}</div>
                    </div>
                </div>
            </div>

            {/* Date filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
                <Calendar size={16} color="var(--color-text-muted)" />
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Filter by date:</span>
                <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} className="input-field" style={{ padding: '7px 12px', borderRadius: '8px', fontSize: '13px', border: '1px solid var(--color-border)' }} />
                <span style={{ color: 'var(--color-text-muted)' }}>→</span>
                <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} className="input-field" style={{ padding: '7px 12px', borderRadius: '8px', fontSize: '13px', border: '1px solid var(--color-border)' }} />
                {(dateStart || dateEnd) && (
                    <button onClick={() => { setDateStart(''); setDateEnd(''); }} style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '12px', cursor: 'pointer', fontWeight: 500 }}>Clear</button>
                )}
                <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginLeft: 'auto' }}>{filteredLedger.length} entries</span>
            </div>

            {/* Ledger */}
            <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '16px', padding: '0' }}>
                <table className="spreadsheet-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', border: 'none' }}>
                    <thead>
                        <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
                            <th style={{ ...lth, width: '100px' }}>Date</th>
                            <th style={{ ...lth, width: '100px' }}>Type</th>
                            <th style={lth}>Description</th>
                            <th style={{ ...lth, width: '120px' }}>Invoice No</th>
                            <th style={{ ...lth, color: '#ef4444', textAlign: 'right', width: '120px' }}>Debt</th>
                            <th style={{ ...lth, color: '#3b82f6', textAlign: 'right', width: '120px' }}>Received</th>
                            <th style={{ ...lth, textAlign: 'right', width: '120px' }}>Balance</th>
                            <th style={{ ...lth, textAlign: 'center', width: '60px' }} />
                        </tr>
                    </thead>
                    <tbody>
                        {filteredLedger.length === 0 ? (
                            <tr><td colSpan={8} style={{ padding: '60px 20px', textAlign: 'center' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', color: 'var(--color-text-secondary)' }}>
                                    <FileText size={32} style={{ opacity: 0.5 }} />
                                    <p>No transactions found for this customer.</p>
                                </div>
                            </td></tr>
                        ) : (
                            <>
                                {filteredLedger.map((e, idx) => (
                                    <tr key={e.id} className="hover-highlight" style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s ease', background: idx % 2 === 1 ? 'rgba(0,0,0,0.015)' : undefined }}>
                                        <td style={{ padding: '12px 20px', fontSize: '13px', fontWeight: 500 }}>{new Date(e.date).toLocaleDateString('en-GB').replace(/\//g, '-')}</td>
                                        <td style={{ padding: '12px 20px', fontSize: '13px' }}>
                                            {e.type === 'Invoice'
                                                ? <span style={{ color: '#ef4444', fontWeight: 600, display: 'inline-flex', padding: '3px 10px', background: 'rgba(239, 68, 68, 0.08)', borderRadius: '20px', fontSize: '12px' }}>Invoice</span>
                                                : <span style={{ color: '#3b82f6', fontWeight: 600, display: 'inline-flex', padding: '3px 10px', background: 'rgba(59, 130, 246, 0.08)', borderRadius: '20px', fontSize: '12px' }}>Payment</span>}
                                        </td>
                                        <td style={{ padding: '12px 20px', fontSize: '13px' }}>
                                            <div>{e.description}</div>
                                            {e.paymentMethod && <span style={{ fontSize: '11px', fontWeight: 600, marginTop: '4px', display: 'inline-block', padding: '2px 8px', borderRadius: '8px', background: 'rgba(107, 114, 128, 0.08)', color: 'var(--color-text-secondary)' }}>{e.paymentMethod}</span>}
                                        </td>
                                        <td style={{ padding: '12px 20px', fontSize: '13px', color: 'var(--color-text-secondary)', fontFamily: e.invoiceNumber ? 'monospace' : undefined }}>{e.invoiceNumber || (e.type === 'Invoice' ? `WO-${e.reference}` : '—')}</td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right', fontSize: '14px', fontWeight: 600, color: e.debt > 0 ? '#ef4444' : 'var(--color-text-muted)' }}>{e.debt > 0 ? fmt(e.debt) : ''}</td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right', fontSize: '14px', fontWeight: 600, color: e.paid > 0 ? '#3b82f6' : 'var(--color-text-muted)' }}>{e.paid > 0 ? fmt(e.paid) : ''}</td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right', fontSize: '14px', fontWeight: 700, color: e.balance > 0 ? '#ef4444' : '#10b981' }}>{fmt(e.balance)}</td>
                                        <td style={{ padding: '12px 20px', textAlign: 'center' }}>
                                            <button onClick={() => handleDelete(e)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', opacity: 0.5 }} title="Delete Entry" onMouseEnter={ev => (ev.currentTarget.style.opacity = '1')} onMouseLeave={ev => (ev.currentTarget.style.opacity = '0.5')}>
                                                <Trash2 size={15} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                <tr style={{ background: 'rgba(0,0,0,0.03)', borderTop: '2px solid var(--color-border)' }}>
                                    <td colSpan={4} style={{ padding: '14px 20px', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Totals {(dateStart || dateEnd) ? '(filtered)' : ''}</td>
                                    <td style={{ padding: '14px 20px', textAlign: 'right', fontSize: '15px', fontWeight: 700, color: '#ef4444' }}>{fmt(filteredTotals.totalDebt)}</td>
                                    <td style={{ padding: '14px 20px', textAlign: 'right', fontSize: '15px', fontWeight: 700, color: '#3b82f6' }}>{fmt(filteredTotals.totalPaid)}</td>
                                    <td style={{ padding: '14px 20px', textAlign: 'right', fontSize: '15px', fontWeight: 700, color: stats.balance > 0 ? '#ef4444' : '#10b981' }}>{fmt(stats.balance)}</td>
                                    <td />
                                </tr>
                            </>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const lth: React.CSSProperties = { padding: '14px 20px', fontWeight: 600, fontSize: '12px', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', textTransform: 'uppercase', letterSpacing: '0.5px' };

export default WholesaleCustomerDetailsPage;
