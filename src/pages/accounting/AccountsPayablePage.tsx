import React, { useEffect, useMemo, useState } from 'react';
import { Wallet, AlertTriangle, Users, DollarSign, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useProcurement } from '../../hooks/useProcurement';
import { Modal } from '../../components';
import { useToast } from '../../context/ToastContext';
import type { PurchaseOrder } from '../../types';

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

// Whole days from a due date until today (positive = overdue).
const daysOverdue = (due?: string): number | null => {
    if (!due) return null;
    const d = new Date(due); d.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((today.getTime() - d.getTime()) / 86400000);
};

const AccountsPayablePage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { purchaseOrders, suppliers, isLoading, fetchPurchaseOrders, fetchSuppliers, recordSupplierPayment } = useProcurement();

    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [payPO, setPayPO] = useState<PurchaseOrder | null>(null);
    const [payAmount, setPayAmount] = useState<number | string>('');
    const [payMethod, setPayMethod] = useState('Cash');
    const [payNote, setPayNote] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Accounts Payable</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Money you owe suppliers on credit purchase orders</p>
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

    // Group open POs by supplier.
    const groups = useMemo(() => {
        const map = new Map<string, { supplierId: string; name: string; total: number; overdue: number; pos: (PurchaseOrder & { outstanding: number })[] }>();
        for (const po of openPOs) {
            const key = po.supplier_id || 'none';
            if (!map.has(key)) map.set(key, { supplierId: key, name: supplierName(po.supplier_id), total: 0, overdue: 0, pos: [] });
            const g = map.get(key)!;
            g.total += po.outstanding;
            const od = daysOverdue(po.payment_due_date);
            if (od !== null && od > 0) g.overdue += po.outstanding;
            g.pos.push(po);
        }
        return Array.from(map.values()).sort((a, b) => b.total - a.total);
    }, [openPOs, suppliers]);

    const totals = useMemo(() => {
        const totalPayable = openPOs.reduce((s, po) => s + po.outstanding, 0);
        const overdue = openPOs.reduce((s, po) => {
            const od = daysOverdue(po.payment_due_date);
            return s + (od !== null && od > 0 ? po.outstanding : 0);
        }, 0);
        return { totalPayable, overdue, suppliers: groups.length };
    }, [openPOs, groups]);

    const toggle = (id: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const openPay = (po: PurchaseOrder & { outstanding: number }) => {
        setPayPO(po);
        setPayAmount(po.outstanding.toFixed(2));
        setPayMethod('Cash');
        setPayNote('');
    };

    const submitPayment = async () => {
        if (!payPO) return;
        const amount = Number(payAmount);
        if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }
        setSaving(true);
        try {
            await recordSupplierPayment(payPO.id, payPO.supplier_id, amount, payMethod, payNote);
            setPayPO(null);
        } catch {
            /* hook already toasts */
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
            {/* Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <SummaryCard icon={Wallet} color="#EF4444" label="Total Payable" value={fmt(totals.totalPayable)} />
                <SummaryCard icon={AlertTriangle} color="#D97706" label="Overdue" value={fmt(totals.overdue)} />
                <SummaryCard icon={Users} color="#3B82F6" label="Suppliers Owed" value={String(totals.suppliers)} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
                <button className="secondary-button" onClick={() => { fetchPurchaseOrders(); fetchSuppliers(); }}>
                    <RefreshCw size={16} style={isLoading ? { animation: 'spin 1s linear infinite' } : undefined} /> Refresh
                </button>
            </div>

            {groups.length === 0 ? (
                <div className="glass-panel" style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <DollarSign size={40} style={{ opacity: 0.2, margin: '0 auto 12px' }} />
                    <p>No outstanding payables. All purchase orders are paid. 🎉</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {groups.map(g => {
                        const isOpen = expanded.has(g.supplierId);
                        return (
                            <div key={g.supplierId} className="glass-panel" style={{ overflow: 'hidden' }}>
                                <div
                                    onClick={() => toggle(g.supplierId)}
                                    style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px', cursor: 'pointer' }}
                                >
                                    {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 600 }}>{g.name}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{g.pos.length} open order{g.pos.length === 1 ? '' : 's'}</div>
                                    </div>
                                    {g.overdue > 0 && (
                                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#D97706', background: 'rgba(217,119,6,0.1)', padding: '3px 10px', borderRadius: '20px' }}>
                                            {fmt(g.overdue)} overdue
                                        </span>
                                    )}
                                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#EF4444' }}>{fmt(g.total)}</div>
                                </div>

                                {isOpen && (
                                    <div style={{ borderTop: '1px solid var(--color-border)', overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
                                            <thead>
                                                <tr style={{ background: 'var(--color-bg)' }}>
                                                    <th style={thStyle}>Invoice / PO</th>
                                                    <th style={thStyle}>Order Date</th>
                                                    <th style={thStyle}>Due Date</th>
                                                    <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                                                    <th style={{ ...thStyle, textAlign: 'right' }}>Paid</th>
                                                    <th style={{ ...thStyle, textAlign: 'right' }}>Balance</th>
                                                    <th style={{ ...thStyle, textAlign: 'right' }}></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {g.pos.map(po => {
                                                    const od = daysOverdue(po.payment_due_date);
                                                    return (
                                                        <tr key={po.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                                                            <td style={tdStyle}>
                                                                <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                                                                    {po.invoice_number || `PO-${po.id.slice(0, 8)}`}
                                                                </span>
                                                            </td>
                                                            <td style={tdStyle}>{po.order_date ? new Date(po.order_date).toLocaleDateString() : '—'}</td>
                                                            <td style={tdStyle}>
                                                                {po.payment_due_date ? new Date(po.payment_due_date).toLocaleDateString() : '—'}
                                                                {od !== null && od > 0 && (
                                                                    <span style={{ marginLeft: '6px', fontSize: '11px', color: '#DC2626', fontWeight: 600 }}>{od}d late</span>
                                                                )}
                                                            </td>
                                                            <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(po.total_amount || 0)}</td>
                                                            <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--color-text-secondary)' }}>{fmt(po.amount_paid || 0)}</td>
                                                            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: '#EF4444' }}>{fmt(po.outstanding)}</td>
                                                            <td style={{ ...tdStyle, textAlign: 'right' }}>
                                                                <button className="primary-button" style={{ padding: '5px 10px', fontSize: '12px' }} onClick={() => openPay(po)}>
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
                            </div>
                        );
                    })}
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

const SummaryCard: React.FC<{ icon: React.ComponentType<{ size?: number }>; color: string; label: string; value: string }> = ({ icon: Icon, color, label, value }) => (
    <div className="glass-panel" style={{ padding: '18px', display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ padding: '12px', borderRadius: '12px', background: `${color}1A`, color }}><Icon size={22} /></div>
        <div>
            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>{label}</div>
            <div style={{ fontSize: '22px', fontWeight: 700 }}>{value}</div>
        </div>
    </div>
);

const thStyle: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' };
const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: '13px', whiteSpace: 'nowrap' };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--color-text-secondary)' };

export default AccountsPayablePage;
