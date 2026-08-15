import React, { useEffect, useMemo, useState } from 'react';
import { HandCoins, AlertTriangle, Warehouse as WarehouseIcon, Plus, RefreshCw, ArrowRight, Database, ShoppingCart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useWholesale } from '../../hooks/useWholesale';
import { Modal } from '../../components';
import { supabase } from '../../lib/supabase';

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
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const navigate = useNavigate();
    const { warehouses, products, currentUser } = useStore();
    const { wholesaleOrders, tableMissing: woMissing, fetchWholesaleOrders, recordCustomerPayment } = useWholesale();

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
    const [receiptAmount, setReceiptAmount] = useState<number | string>('');
    const [receiptMethod, setReceiptMethod] = useState('Cash');
    const [receiptNote, setReceiptNote] = useState('');

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Accounts Receivable</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Money owed to you — wholesale customer orders and warehouse transfers on credit</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

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
        for (const t of transfers) {
            if (t.kind === 'wholesale') continue;
            const balance = (t.total_amount || 0) - (t.amount_received || 0);
            if (balance <= 0.005) continue;
            rows.push({
                key: 'wt-' + t.id, source: 'transfer', id: t.id, date: t.transfer_date,
                party: t.to_warehouse_name || warehouseName(t.to_warehouse_id),
                desc: `${t.product_name || ''} ×${t.quantity}`,
                due_date: t.due_date, total: t.total_amount || 0, received: t.amount_received || 0, balance
            });
        }
        // Wholesale orders (customer credit sales).
        for (const o of wholesaleOrders) {
            if (o.status === 'Cancelled') continue;
            const balance = (o.total_amount || 0) - (o.amount_paid || 0);
            if (balance <= 0.005) continue;
            rows.push({
                key: 'wo-' + o.id, source: 'wholesale', id: o.id, date: o.order_date,
                party: o.customer_name, desc: `${o.items?.length || 0} item(s)`,
                due_date: o.due_date, total: o.total_amount || 0, received: o.amount_paid || 0, balance
            });
        }
        return rows.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    }, [transfers, wholesaleOrders, warehouses]);

    const totals = useMemo(() => {
        const totalReceivable = receivables.reduce((s, r) => s + r.balance, 0);
        const overdue = receivables.reduce((s, r) => { const od = daysOverdue(r.due_date); return s + (od !== null && od > 0 ? r.balance : 0); }, 0);
        return { totalReceivable, overdue, count: receivables.length };
    }, [receivables]);

    const adjustWarehouseStock = async (warehouseId: string, pid: string, delta: number) => {
        if (!warehouseId || !pid) return;
        const { data } = await supabase.from('warehouse_stock').select('id, quantity').eq('warehouse_id', warehouseId).eq('product_id', pid).maybeSingle();
        if (data) await supabase.from('warehouse_stock').update({ quantity: Math.max(0, (data.quantity || 0) + delta) }).eq('id', data.id);
        else if (delta > 0) await supabase.from('warehouse_stock').insert([{ warehouse_id: warehouseId, product_id: pid, quantity: delta }]);
    };

    const resetCreate = () => { setFromWh(''); setToWh(''); setProductId(''); setQty(''); setUnitPrice(''); setDueDate(''); setNote(''); };

    const submitTransfer = async () => {
        const q = Number(qty), up = Number(unitPrice);
        if (!fromWh || !toWh) { showToast('Choose both warehouses', 'error'); return; }
        if (fromWh === toWh) { showToast('Source and destination must differ', 'error'); return; }
        if (!productId) { showToast('Choose a product', 'error'); return; }
        if (!q || q <= 0) { showToast('Enter a valid quantity', 'error'); return; }
        if (up < 0) { showToast('Enter a valid unit price', 'error'); return; }
        setSaving(true);
        try {
            const product = products.find(p => p.id === productId);
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
            showToast('Transfer on credit recorded', 'success');
            setIsCreateOpen(false); resetCreate(); fetchTransfers();
        } catch (e: any) {
            showToast('Failed to record transfer: ' + (e.message || ''), 'error');
        } finally { setSaving(false); }
    };

    const openReceipt = (r: Receivable) => { setReceiptFor(r); setReceiptAmount(r.balance.toFixed(2)); setReceiptMethod('Cash'); setReceiptNote(''); };

    const submitReceipt = async () => {
        if (!receiptFor) return;
        const amount = Number(receiptAmount);
        if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }
        setSaving(true);
        try {
            if (receiptFor.source === 'wholesale') {
                await recordCustomerPayment(receiptFor.id, amount, receiptMethod, receiptNote, undefined, currentUser?.name);
            } else {
                await supabase.from('warehouse_transfer_receipts').insert([{
                    transfer_id: receiptFor.id, amount,
                    receipt_date: new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0],
                    payment_method: receiptMethod, note: receiptNote || null
                }]);
                const newReceived = receiptFor.received + amount;
                const status = newReceived >= receiptFor.total ? 'Paid' : (newReceived > 0 ? 'Partial' : 'Unpaid');
                await supabase.from('warehouse_transfers').update({ amount_received: newReceived, payment_status: status }).eq('id', receiptFor.id);
                showToast('Receipt recorded', 'success');
            }
            setReceiptFor(null);
            refreshAll();
        } catch (e: any) {
            showToast('Failed to record receipt: ' + (e.message || ''), 'error');
        } finally { setSaving(false); }
    };

    const bothMissing = transferTableMissing && woMissing;

    return (
        <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <SummaryCard icon={HandCoins} color="#059669" label="Total Receivable" value={fmt(totals.totalReceivable)} />
                <SummaryCard icon={AlertTriangle} color="#D97706" label="Overdue" value={fmt(totals.overdue)} />
                <SummaryCard icon={WarehouseIcon} color="#3B82F6" label="Open Items" value={String(totals.count)} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <button className="secondary-button" onClick={refreshAll}>
                    <RefreshCw size={16} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} /> Refresh
                </button>
                <button className="secondary-button" onClick={() => navigate('/wholesale/orders')}>
                    <ShoppingCart size={18} /> New Wholesale Order
                </button>
                <button className="primary-button" disabled={transferTableMissing} onClick={() => { resetCreate(); setIsCreateOpen(true); }}>
                    <Plus size={18} /> New Transfer on Credit
                </button>
            </div>

            {bothMissing ? (
                <div className="glass-panel" style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <Database size={40} style={{ opacity: 0.25, margin: '0 auto 12px', color: '#D97706' }} />
                    <p style={{ fontWeight: 600, color: 'var(--color-text)' }}>Database setup needed</p>
                    <p style={{ fontSize: '13px' }}>
                        Run <code>migrations/wholesale_orders.sql</code> and <code>migrations/accounts_receivable_transfers.sql</code> in your Supabase SQL editor, then Refresh.
                    </p>
                </div>
            ) : receivables.length === 0 ? (
                <div className="glass-panel" style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <HandCoins size={40} style={{ opacity: 0.2, margin: '0 auto 12px' }} />
                    <p>No outstanding receivables. Everything is collected. 🎉</p>
                </div>
            ) : (
                <div className="glass-panel" style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '860px' }}>
                        <thead>
                            <tr style={{ background: 'var(--color-bg)' }}>
                                <th style={thStyle}>Date</th>
                                <th style={thStyle}>Type</th>
                                <th style={thStyle}>Owed By</th>
                                <th style={thStyle}>Details</th>
                                <th style={thStyle}>Due</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Received</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Balance</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {receivables.map(r => {
                                const od = daysOverdue(r.due_date);
                                const isWholesale = r.source === 'wholesale';
                                return (
                                    <tr key={r.key} style={{ borderTop: '1px solid var(--color-border)' }}>
                                        <td style={tdStyle}>{r.date ? new Date(r.date).toLocaleDateString() : '—'}</td>
                                        <td style={tdStyle}>
                                            <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', color: isWholesale ? '#7E22CE' : '#0369A1', background: isWholesale ? 'rgba(126,34,206,0.1)' : 'rgba(3,105,161,0.1)' }}>
                                                {isWholesale ? 'WHOLESALE' : 'TRANSFER'}
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
                                            {od !== null && od > 0 && <span style={{ marginLeft: '6px', fontSize: '11px', color: '#DC2626', fontWeight: 600 }}>{od}d late</span>}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(r.total)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--color-text-secondary)' }}>{fmt(r.received)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: '#059669' }}>{fmt(r.balance)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                                            <button className="primary-button" style={{ padding: '5px 10px', fontSize: '12px' }} onClick={() => openReceipt(r)}>Record Receipt</button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Transfer-on-credit create modal */}
            <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Transfer Stock to Another Warehouse (on Credit)">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                            <label style={labelStyle}>From Warehouse</label>
                            <select className="search-input" style={{ width: '100%' }} value={fromWh} onChange={e => setFromWh(e.target.value)}>
                                <option value="">Select…</option>
                                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>To Warehouse (owes you)</label>
                            <select className="search-input" style={{ width: '100%' }} value={toWh} onChange={e => setToWh(e.target.value)}>
                                <option value="">Select…</option>
                                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label style={labelStyle}>Product</label>
                        <select className="search-input" style={{ width: '100%' }} value={productId} onChange={e => setProductId(e.target.value)}>
                            <option value="">Select…</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div><label style={labelStyle}>Quantity</label><input type="number" className="search-input" style={{ width: '100%' }} value={qty} onChange={e => setQty(e.target.value)} min="0" step="1" /></div>
                        <div><label style={labelStyle}>Unit Price ($)</label><input type="number" className="search-input" style={{ width: '100%' }} value={unitPrice} onChange={e => setUnitPrice(e.target.value)} min="0" step="0.01" /></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'end' }}>
                        <div><label style={labelStyle}>Due Date (optional)</label><input type="date" className="search-input" style={{ width: '100%' }} value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
                        <div style={{ textAlign: 'right', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Total: <strong style={{ color: 'var(--color-text)', fontSize: '16px' }}>{fmt((Number(qty) || 0) * (Number(unitPrice) || 0))}</strong></div>
                    </div>
                    <div><label style={labelStyle}>Note (optional)</label><input type="text" className="search-input" style={{ width: '100%' }} value={note} onChange={e => setNote(e.target.value)} /></div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                        <button className="secondary-button" onClick={() => setIsCreateOpen(false)}>Cancel</button>
                        <button className="primary-button" disabled={saving} onClick={submitTransfer}>{saving ? 'Saving…' : 'Record Transfer'}</button>
                    </div>
                </div>
            </Modal>

            {/* Receipt modal */}
            <Modal isOpen={!!receiptFor} onClose={() => setReceiptFor(null)} title="Record Receipt">
                {receiptFor && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                            {receiptFor.party} · {receiptFor.desc}
                            <div style={{ marginTop: '4px', color: '#059669', fontWeight: 600 }}>Balance: {fmt(receiptFor.balance)}</div>
                        </div>
                        <div><label style={labelStyle}>Amount ($)</label><input type="number" className="search-input" style={{ width: '100%' }} value={receiptAmount} onChange={e => setReceiptAmount(e.target.value)} min="0" step="0.01" /></div>
                        <div><label style={labelStyle}>Method</label>
                            <select className="search-input" style={{ width: '100%' }} value={receiptMethod} onChange={e => setReceiptMethod(e.target.value)}>
                                <option>Cash</option><option>Bank Transfer</option><option>Credit Card</option><option>Cheque</option>
                            </select>
                        </div>
                        <div><label style={labelStyle}>Note (optional)</label><input type="text" className="search-input" style={{ width: '100%' }} value={receiptNote} onChange={e => setReceiptNote(e.target.value)} /></div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button className="secondary-button" onClick={() => setReceiptFor(null)}>Cancel</button>
                            <button className="primary-button" disabled={saving} onClick={submitReceipt}>{saving ? 'Saving…' : 'Record Receipt'}</button>
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

export default AccountsReceivablePage;
