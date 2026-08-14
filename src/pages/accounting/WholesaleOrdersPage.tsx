import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, DollarSign, ShoppingCart, RefreshCw, X, Database, Search, User, Calendar, FileSignature, Package, CheckCircle2 } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useWholesale } from '../../hooks/useWholesale';
import type { WholesaleOrder, WholesaleOrderItem } from '../../types';

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
const today = () => new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];

const payConfig = (s?: string) => {
    switch (s) {
        case 'Paid': return { color: '#059669', bg: 'rgba(16,185,129,0.1)' };
        case 'Partial': return { color: '#D97706', bg: 'rgba(217,119,6,0.1)' };
        default: return { color: '#DC2626', bg: 'rgba(239,68,68,0.1)' };
    }
};

const WholesaleOrdersPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { products, warehouses, currentUser, refreshData } = useStore();
    const { wholesaleOrders, customers, isLoading, tableMissing, fetchWholesaleOrders, fetchCustomers, createWholesaleOrder, deleteWholesaleOrder, recordCustomerPayment } = useWholesale();

    const [search, setSearch] = useState('');
    const [payFilter, setPayFilter] = useState<'All' | 'Unpaid' | 'Partial' | 'Paid'>('All');

    // Create modal
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [customerName, setCustomerName] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [warehouseId, setWarehouseId] = useState('');
    const [orderDate, setOrderDate] = useState(today());
    const [dueDate, setDueDate] = useState('');
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [notes, setNotes] = useState('');
    const [lines, setLines] = useState<Partial<WholesaleOrderItem>[]>([{ product_id: '', quantity: 1, unit_price: 0 }]);
    const [saving, setSaving] = useState(false);

    // Payment modal
    const [payOrder, setPayOrder] = useState<WholesaleOrder | null>(null);
    const [payAmount, setPayAmount] = useState<number | string>('');
    const [payMethod, setPayMethod] = useState('Cash');
    const [payNote, setPayNote] = useState('');
    const [payDate, setPayDate] = useState(today());

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Wholesale Orders</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Credit sales to customers — the source of Accounts Receivable</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => { fetchWholesaleOrders(); fetchCustomers(); }, [fetchWholesaleOrders, fetchCustomers]);

    const openCreate = () => {
        setCustomerName(''); setCustomerPhone(''); setWarehouseId(warehouses[0]?.id || '');
        setOrderDate(today()); setDueDate(''); setInvoiceNumber(''); setNotes('');
        setLines([{ product_id: '', quantity: 1, unit_price: 0 }]);
        setIsCreateOpen(true);
    };

    const lineTotal = (l: Partial<WholesaleOrderItem>) => (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
    const orderTotal = useMemo(() => lines.reduce((s, l) => s + lineTotal(l), 0), [lines]);

    const setLine = (idx: number, patch: Partial<WholesaleOrderItem>) => {
        setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
    };

    const submitCreate = async () => {
        if (!customerName.trim()) { showToast('Enter the customer name', 'error'); return; }
        const validLines = lines.filter(l => l.product_id && (Number(l.quantity) || 0) > 0);
        if (validLines.length === 0) { showToast('Add at least one product line', 'error'); return; }

        setSaving(true);
        try {
            const items: Partial<WholesaleOrderItem>[] = validLines.map(l => ({
                product_id: l.product_id!,
                product_name: products.find(p => p.id === l.product_id)?.name || '',
                quantity: Number(l.quantity) || 0,
                unit_price: Number(l.unit_price) || 0
            }));
            await createWholesaleOrder(
                { invoice_number: invoiceNumber, customer_name: customerName.trim(), customer_phone: customerPhone.trim(), warehouse_id: warehouseId, order_date: orderDate, due_date: dueDate, notes },
                items,
                currentUser?.name
            );
            setIsCreateOpen(false);
            refreshData(true); // keep in-memory product stock in sync after the deduction
        } catch { /* hook toasts */ } finally { setSaving(false); }
    };

    const openPay = (o: WholesaleOrder) => {
        setPayOrder(o);
        setPayAmount(((o.total_amount || 0) - (o.amount_paid || 0)).toFixed(2));
        setPayMethod('Cash'); setPayNote(''); setPayDate(today());
    };

    const submitPay = async () => {
        if (!payOrder) return;
        const amount = Number(payAmount);
        if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }
        setSaving(true);
        try {
            await recordCustomerPayment(payOrder.id, amount, payMethod, payNote, payDate);
            setPayOrder(null);
        } catch { /* hook toasts */ } finally { setSaving(false); }
    };

    const handleDelete = async (o: WholesaleOrder) => {
        if (!confirm(`Delete wholesale order for ${o.customer_name}? Stock will be returned.`)) return;
        try { await deleteWholesaleOrder(o); } catch { /* hook toasts */ }
    };

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return wholesaleOrders
            .filter(o => payFilter === 'All' || (o.payment_status || 'Unpaid') === payFilter)
            .filter(o => !q || o.customer_name.toLowerCase().includes(q) || (o.customer_phone || '').includes(q) || (o.invoice_number || '').toLowerCase().includes(q));
    }, [wholesaleOrders, search, payFilter]);

    const totals = useMemo(() => {
        let sales = 0, outstanding = 0;
        for (const o of wholesaleOrders) {
            if (o.status === 'Cancelled') continue;
            sales += o.total_amount || 0;
            outstanding += (o.total_amount || 0) - (o.amount_paid || 0);
        }
        return { sales, outstanding, collected: sales - outstanding };
    }, [wholesaleOrders]);

    return (
        <div style={{ padding: '24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <SummaryCard icon={ShoppingCart} color="#3B82F6" label="Total Wholesale Sales" value={fmt(totals.sales)} />
                <SummaryCard icon={DollarSign} color="#059669" label="Collected" value={fmt(totals.collected)} />
                <SummaryCard icon={DollarSign} color="#EF4444" label="Outstanding (Receivable)" value={fmt(totals.outstanding)} />
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '200px' }}>
                    <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                    <input className="search-input" style={{ width: '100%', paddingLeft: '36px' }} placeholder="Search customer, phone, invoice…" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <select className="search-input" value={payFilter} onChange={e => setPayFilter(e.target.value as any)} style={{ width: 'auto' }}>
                    <option value="All">All statuses</option><option value="Unpaid">Unpaid</option><option value="Partial">Partial</option><option value="Paid">Paid</option>
                </select>
                <button className="secondary-button" onClick={() => fetchWholesaleOrders()}>
                    <RefreshCw size={16} style={isLoading ? { animation: 'spin 1s linear infinite' } : undefined} /> Refresh
                </button>
                <button className="primary-button" disabled={tableMissing} onClick={openCreate}><Plus size={18} /> New Wholesale Order</button>
            </div>

            {tableMissing ? (
                <div className="glass-panel" style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <Database size={40} style={{ opacity: 0.25, margin: '0 auto 12px', color: '#D97706' }} />
                    <p style={{ fontWeight: 600, color: 'var(--color-text)' }}>Database setup needed</p>
                    <p style={{ fontSize: '13px' }}>Run <code>migrations/wholesale_orders.sql</code> in your Supabase SQL editor, then Refresh.</p>
                </div>
            ) : filtered.length === 0 ? (
                <div className="glass-panel" style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <ShoppingCart size={40} style={{ opacity: 0.2, margin: '0 auto 12px' }} />
                    <p>No wholesale orders yet. Create one to start tracking customer credit.</p>
                </div>
            ) : (
                <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '16px', padding: '0' }}>
                    <table className="spreadsheet-table" style={{ width: '100%', borderCollapse: 'collapse', border: 'none', minWidth: '860px' }}>
                        <thead>
                            <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
                                <th style={thStyle}>Invoice</th>
                                <th style={thStyle}>Customer</th>
                                <th style={thStyle}>Date</th>
                                <th style={thStyle}>Due</th>
                                <th style={{ ...thStyle, textAlign: 'center' }}>Items</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Paid</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Balance</th>
                                <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                                <th style={{ ...thStyle, textAlign: 'center' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((o, idx) => {
                                const balance = (o.total_amount || 0) - (o.amount_paid || 0);
                                const pc = payConfig(o.payment_status);
                                return (
                                    <tr key={o.id} className="hover-highlight" style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s ease', background: idx % 2 === 1 ? 'rgba(0,0,0,0.015)' : undefined, opacity: o.status === 'Cancelled' ? 0.5 : 1 }}>
                                        <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 700, color: 'var(--color-text)' }}>{o.invoice_number || `WO-${o.id.slice(0, 8).toUpperCase()}`}</td>
                                        <td style={tdStyle}>
                                            <div style={{ fontWeight: 500 }}>{o.customer_name}</div>
                                            {o.customer_phone && <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{o.customer_phone}</div>}
                                        </td>
                                        <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>{o.order_date ? new Date(o.order_date).toLocaleDateString('en-GB').replace(/\//g, '-') : '—'}</td>
                                        <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>{o.due_date ? new Date(o.due_date).toLocaleDateString('en-GB').replace(/\//g, '-') : '—'}</td>
                                        <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600 }}>{o.items?.length || 0}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontSize: '14px', fontWeight: 700, color: 'var(--color-text)' }}>{fmt(o.total_amount || 0)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--color-text-secondary)' }}>{fmt(o.amount_paid || 0)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: balance > 0.005 ? '#ef4444' : '#059669' }}>{fmt(balance)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                                            <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', backgroundColor: pc.bg, color: pc.color }}>{o.payment_status || 'Unpaid'}</span>
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                                                {o.status !== 'Cancelled' && balance > 0.005 && (
                                                    <button onClick={() => openPay(o)} title="Record Payment" style={{ background: 'rgba(16,185,129,0.08)', border: 'none', cursor: 'pointer', color: '#10b981', padding: '6px', borderRadius: '6px', transition: 'all 0.2s' }}>
                                                        <DollarSign size={15} />
                                                    </button>
                                                )}
                                                <button onClick={() => handleDelete(o)} title="Delete" style={{ background: 'rgba(239,68,68,0.08)', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '6px', borderRadius: '6px', transition: 'all 0.2s' }}>
                                                    <Trash2 size={15} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Create modal — styled like the Purchase Order popup */}
            {isCreateOpen && (
                <div style={modalOverlay} onClick={() => setIsCreateOpen(false)}>
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{ background: 'var(--color-surface)', borderRadius: '24px', width: '100%', maxWidth: '940px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,0.25)', overflow: 'hidden', animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}
                    >
                        {/* Header */}
                        <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, rgba(99,102,241,0.05), rgba(139,92,246,0.05))' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                                    <ShoppingCart size={20} />
                                </div>
                                <div>
                                    <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>New Wholesale Order</h2>
                                    <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '2px 0 0 0' }}>Sale on credit — stock leaves now, payment comes later</p>
                                </div>
                            </div>
                            <button onClick={() => setIsCreateOpen(false)} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text-muted)', width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <X size={18} />
                            </button>
                        </div>

                        {/* Body */}
                        <div style={{ padding: '24px 28px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {/* Customer */}
                            <div style={sectionCard}>
                                <h4 style={sectionHeading}><User size={15} /> Customer Information</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={fieldLabel}>Customer *</label>
                                        <input list="ws-customer-names" style={fieldInput} value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Type or pick a customer" />
                                        <datalist id="ws-customer-names">
                                            {customers.map(c => <option key={c.id} value={c.name} />)}
                                        </datalist>
                                    </div>
                                    <div>
                                        <label style={fieldLabel}>Phone</label>
                                        <input style={fieldInput} value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="Optional" />
                                    </div>
                                </div>
                            </div>

                            {/* Order details */}
                            <div style={sectionCard}>
                                <h4 style={sectionHeading}><Calendar size={15} /> Order Details</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={fieldLabel}>From Warehouse</label>
                                        <select style={fieldInput} value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
                                            <option value="">—</option>
                                            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={fieldLabel}>Order Date *</label>
                                        <input type="date" style={fieldInput} value={orderDate} onChange={e => setOrderDate(e.target.value)} />
                                    </div>
                                    <div>
                                        <label style={fieldLabel}>Due Date</label>
                                        <input type="date" style={fieldInput} value={dueDate} onChange={e => setDueDate(e.target.value)} />
                                    </div>
                                </div>
                            </div>

                            {/* Reference */}
                            <div style={sectionCard}>
                                <h4 style={sectionHeading}><FileSignature size={15} /> Reference & Notes</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={fieldLabel}>Invoice Number</label>
                                        <input style={{ ...fieldInput, fontFamily: 'monospace' }} value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="e.g. WS-2026-001" />
                                    </div>
                                    <div>
                                        <label style={fieldLabel}>Notes</label>
                                        <input style={fieldInput} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." />
                                    </div>
                                </div>
                            </div>

                            {/* Line items */}
                            <div style={sectionCard}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                    <h4 style={{ ...sectionHeading, marginBottom: 0 }}>
                                        <Package size={15} /> Line Items
                                        <span style={{ background: 'var(--color-primary)', color: 'white', padding: '1px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, marginLeft: '4px' }}>{lines.length}</span>
                                    </h4>
                                    <button className="primary-button" style={{ padding: '7px 14px', fontSize: '12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600 }} onClick={() => setLines(prev => [...prev, { product_id: '', quantity: 1, unit_price: 0 }])}>
                                        <Plus size={14} /> Add Product
                                    </button>
                                </div>
                                <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ background: 'var(--color-bg)' }}>
                                                <th style={liTh(36)}>#</th>
                                                <th style={{ ...liTh(), textAlign: 'left' }}>Product</th>
                                                <th style={{ ...liTh(90), textAlign: 'right' }}>Qty</th>
                                                <th style={{ ...liTh(130), textAlign: 'right' }}>Unit Price</th>
                                                <th style={{ ...liTh(130), textAlign: 'right' }}>Subtotal</th>
                                                <th style={liTh(44)}></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {lines.map((l, idx) => (
                                                <tr key={idx} style={{ borderTop: '1px solid var(--color-border)' }}>
                                                    <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)' }}>{idx + 1}</td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        <select style={{ ...fieldInput, padding: '8px 10px', fontSize: '13px' }} value={l.product_id || ''} onChange={e => setLine(idx, { product_id: e.target.value })}>
                                                            <option value="">Select product...</option>
                                                            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                                        </select>
                                                    </td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        <input type="number" style={{ ...fieldInput, padding: '8px 10px', fontSize: '13px', textAlign: 'right' }} min="0" value={l.quantity ?? ''} onChange={e => setLine(idx, { quantity: Number(e.target.value) })} />
                                                    </td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        <input type="number" style={{ ...fieldInput, padding: '8px 10px', fontSize: '13px', textAlign: 'right' }} min="0" step="0.01" value={l.unit_price ?? ''} onChange={e => setLine(idx, { unit_price: Number(e.target.value) })} />
                                                    </td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '14px', fontWeight: 600 }}>{fmt(lineTotal(l))}</td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                                        <button onClick={() => setLines(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)} disabled={lines.length <= 1} style={{ background: lines.length > 1 ? 'rgba(239,68,68,0.08)' : 'transparent', border: 'none', cursor: lines.length > 1 ? 'pointer' : 'not-allowed', color: lines.length > 1 ? '#ef4444' : 'var(--color-text-muted)', padding: '5px', borderRadius: '6px' }}>
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div style={{ padding: '18px 28px', borderTop: '2px solid var(--color-border)', background: 'linear-gradient(135deg, rgba(99,102,241,0.04), rgba(139,92,246,0.04))', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Order Total</span>
                                <span style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-primary)', letterSpacing: '-0.5px' }}>{fmt(orderTotal)}</span>
                                <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', background: 'var(--color-bg)', padding: '3px 10px', borderRadius: '12px', fontWeight: 600 }}>{lines.length} item{lines.length !== 1 ? 's' : ''}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button className="secondary-button" onClick={() => setIsCreateOpen(false)} style={{ padding: '10px 20px', borderRadius: '10px', fontWeight: 600 }}>Cancel</button>
                                <button className="primary-button" onClick={submitCreate} disabled={saving} style={{ padding: '10px 24px', borderRadius: '10px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <CheckCircle2 size={16} /> {saving ? 'Saving…' : 'Create Order'}
                                </button>
                            </div>
                        </div>
                    </div>
                    <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(20px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
                </div>
            )}

            {/* Payment modal — styled like the Purchase Order payment popup */}
            {payOrder && (() => {
                const remaining = (payOrder.total_amount || 0) - (payOrder.amount_paid || 0);
                return (
                    <div style={{ ...modalOverlay, zIndex: 10000 }} onClick={() => setPayOrder(null)}>
                        <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface)', borderRadius: '24px', width: '100%', maxWidth: '520px', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,0.25)', overflow: 'hidden', animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                            {/* Header */}
                            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, rgba(16,185,129,0.05), rgba(52,211,153,0.05))' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #10b981, #34d399)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                                        <DollarSign size={18} />
                                    </div>
                                    <div>
                                        <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Record Payment</h2>
                                        <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', margin: '1px 0 0 0' }}>{payOrder.customer_name} · {payOrder.invoice_number || `WO-${payOrder.id.slice(0, 8).toUpperCase()}`}</p>
                                    </div>
                                </div>
                                <button onClick={() => setPayOrder(null)} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text-muted)', width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <X size={18} />
                                </button>
                            </div>

                            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {remaining > 0 && (
                                    <div style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.12)', borderRadius: '12px', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Remaining Balance</span>
                                        <span style={{ fontSize: '20px', fontWeight: 700, color: '#ef4444' }}>{fmt(remaining)}</span>
                                    </div>
                                )}

                                <div>
                                    <label style={fieldLabel}>Amount to Pay *</label>
                                    <input type="number" style={{ ...fieldInput, fontSize: '16px', fontWeight: 600 }} value={payAmount} onChange={e => setPayAmount(e.target.value === '' ? '' : parseFloat(e.target.value))} min="0" step="0.01" />
                                    {remaining > 0 && (
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginTop: '10px' }}>
                                            {[
                                                { label: 'Full', pct: 1, color: '#10b981' },
                                                { label: '75%', pct: 0.75, color: '#3b82f6' },
                                                { label: '50%', pct: 0.5, color: '#f59e0b' },
                                                { label: '25%', pct: 0.25, color: '#8b5cf6' },
                                            ].map(btn => {
                                                const val = Math.round(remaining * btn.pct * 100) / 100;
                                                const active = Number(payAmount) === val;
                                                return (
                                                    <button key={btn.label} onClick={() => setPayAmount(val)} style={{ padding: '8px 6px', fontSize: '12px', fontWeight: 700, border: '1px solid var(--color-border)', borderRadius: '8px', background: active ? btn.color : 'var(--color-bg)', color: active ? 'white' : btn.color, cursor: 'pointer', transition: 'all 0.2s', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                                        <span>{btn.label}</span>
                                                        <span style={{ fontSize: '10px', opacity: 0.8 }}>{fmt(val)}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                                    <div>
                                        <label style={fieldLabel}>Payment Date *</label>
                                        <input type="date" style={fieldInput} value={payDate} onChange={e => setPayDate(e.target.value)} />
                                    </div>
                                    <div>
                                        <label style={fieldLabel}>Method</label>
                                        <select style={fieldInput} value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                                            <option>Cash</option><option>Bank Transfer</option><option>Credit Card</option><option>Cheque</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label style={fieldLabel}>Notes</label>
                                    <textarea style={{ ...fieldInput, minHeight: '60px', resize: 'vertical' }} value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="Optional payment notes..." />
                                </div>
                            </div>

                            {/* Footer */}
                            <div style={{ padding: '18px 24px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '10px', background: 'rgba(0,0,0,0.01)' }}>
                                <button className="secondary-button" onClick={() => setPayOrder(null)} style={{ padding: '10px 20px', borderRadius: '10px', fontWeight: 600 }}>Cancel</button>
                                <button className="primary-button" onClick={submitPay} disabled={saving || !payAmount || Number(payAmount) <= 0} style={{ padding: '10px 24px', borderRadius: '10px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <CheckCircle2 size={16} /> {saving ? 'Saving…' : 'Record Payment'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
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

const thStyle: React.CSSProperties = { padding: '14px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--color-border)' };
const tdStyle: React.CSSProperties = { padding: '14px 16px', fontSize: '13px', whiteSpace: 'nowrap' };

// Purchase-Order-style modal styles.
const modalOverlay: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' };
const sectionCard: React.CSSProperties = { background: 'var(--color-bg)', padding: '20px', borderRadius: '14px', border: '1px solid var(--color-border)' };
const sectionHeading: React.CSSProperties = { fontSize: '13px', fontWeight: 700, marginBottom: '16px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' };
const fieldLabel: React.CSSProperties = { display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '13px', color: 'var(--color-text-secondary)' };
const fieldInput: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: '10px', fontSize: '14px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' };
const liTh = (width?: number): React.CSSProperties => ({ padding: '10px 12px', textAlign: 'center', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', width: width ? `${width}px` : undefined, borderBottom: '1px solid var(--color-border)' });

export default WholesaleOrdersPage;
