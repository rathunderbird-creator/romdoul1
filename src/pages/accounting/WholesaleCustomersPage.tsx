import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit, Trash2, Mail, Phone, Search, Users, DollarSign, RefreshCw, Database, FileText } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { Modal } from '../../components';
import { useWholesale } from '../../hooks/useWholesale';
import type { WholesaleCustomer } from '../../types';

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash % 360)}, 65%, 50%)`;
};
const initials = (name: string) => name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

const WholesaleCustomersPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const navigate = useNavigate();
    const { customers, wholesaleOrders, tableMissing, fetchCustomers, fetchWholesaleOrders, saveCustomer, deleteCustomer } = useWholesale();

    const [search, setSearch] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editing, setEditing] = useState<WholesaleCustomer | null>(null);
    const [form, setForm] = useState<Partial<WholesaleCustomer>>({ name: '', contact_name: '', email: '', phone: '', address: '', note: '', is_active: true });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Wholesale Customers</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Your wholesale/credit customers and their outstanding balances</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => { fetchCustomers(); fetchWholesaleOrders(); }, [fetchCustomers, fetchWholesaleOrders]);

    // Outstanding balance per customer, matched by name (orders store the customer name).
    const balances = useMemo(() => {
        const map: Record<string, { balance: number; orders: number }> = {};
        for (const o of wholesaleOrders) {
            if (o.status === 'Cancelled') continue;
            const key = (o.customer_name || '').trim().toLowerCase();
            if (!map[key]) map[key] = { balance: 0, orders: 0 };
            map[key].balance += (o.total_amount || 0) - (o.amount_paid || 0);
            map[key].orders += 1;
        }
        return map;
    }, [wholesaleOrders]);

    const balanceFor = (name: string) => balances[(name || '').trim().toLowerCase()] || { balance: 0, orders: 0 };

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return [...customers]
            .filter(c => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.email || '').toLowerCase().includes(q) || (c.contact_name || '').toLowerCase().includes(q))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [customers, search]);

    const totalOutstanding = useMemo(() => Object.values(balances).reduce((s, b) => s + b.balance, 0), [balances]);

    const openModal = (c?: WholesaleCustomer) => {
        if (c) { setEditing(c); setForm(c); }
        else { setEditing(null); setForm({ name: '', contact_name: '', email: '', phone: '', address: '', note: '', is_active: true }); }
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!form.name?.trim()) return;
        setSaving(true);
        try { await saveCustomer(form); setIsModalOpen(false); } catch { /* hook toasts */ } finally { setSaving(false); }
    };

    const handleDelete = async (c: WholesaleCustomer) => {
        if (confirm(`Delete customer "${c.name}"?`)) { try { await deleteCustomer(c.id); } catch { /* hook toasts */ } }
    };

    return (
        <div style={{ padding: '24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <SummaryCard icon={Users} color="#6366F1" label="Total Customers" value={String(customers.length)} />
                <SummaryCard icon={DollarSign} color="#EF4444" label="Total Outstanding" value={fmt(totalOutstanding)} />
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '200px' }}>
                    <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                    <input className="search-input" style={{ width: '100%', paddingLeft: '36px' }} placeholder="Search customers…" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <button className="secondary-button" onClick={() => { fetchCustomers(); fetchWholesaleOrders(); }}><RefreshCw size={16} /> Refresh</button>
                <button className="primary-button" disabled={tableMissing} onClick={() => openModal()}><Plus size={18} /> New Customer</button>
            </div>

            {tableMissing ? (
                <div className="glass-panel" style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <Database size={40} style={{ opacity: 0.25, margin: '0 auto 12px', color: '#D97706' }} />
                    <p style={{ fontWeight: 600, color: 'var(--color-text)' }}>Database setup needed</p>
                    <p style={{ fontSize: '13px' }}>Run <code>migrations/wholesale_orders.sql</code> in your Supabase SQL editor, then Refresh.</p>
                </div>
            ) : filtered.length === 0 ? (
                <div className="glass-panel" style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <Users size={40} style={{ opacity: 0.2, margin: '0 auto 12px' }} />
                    <p>No customers yet. Add your first wholesale customer.</p>
                </div>
            ) : (
                <div className="glass-panel" style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
                        <thead>
                            <tr style={{ background: 'var(--color-bg)' }}>
                                <th style={thStyle}>Customer</th>
                                <th style={thStyle}>Contact</th>
                                <th style={{ ...thStyle, textAlign: 'center' }}>Orders</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Outstanding</th>
                                <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(c => {
                                const bal = balanceFor(c.name);
                                return (
                                    <tr key={c.id} onClick={() => navigate(`/wholesale/customers/${c.id}`)} className="hover-highlight" style={{ borderTop: '1px solid var(--color-border)', cursor: 'pointer' }}>
                                        <td style={tdStyle}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: stringToColor(c.name), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px', flexShrink: 0 }}>{initials(c.name)}</div>
                                                <div style={{ fontWeight: 600 }}>{c.name}</div>
                                            </div>
                                        </td>
                                        <td style={tdStyle}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                                {c.phone && <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Phone size={12} /> {c.phone}</span>}
                                                {c.email && <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Mail size={12} /> {c.email}</span>}
                                                {!c.phone && !c.email && <span style={{ opacity: 0.5 }}>—</span>}
                                            </div>
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>{bal.orders}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: bal.balance > 0.005 ? '#EF4444' : '#059669' }}>{fmt(bal.balance)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                                            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', color: c.is_active ? '#059669' : '#6B7280', background: c.is_active ? 'rgba(16,185,129,0.1)' : 'rgba(107,114,128,0.1)' }}>
                                                {c.is_active ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                                            <button className="primary-button" style={{ padding: '5px 10px', fontSize: '12px', marginRight: '6px', display: 'inline-flex', alignItems: 'center', gap: '5px' }} title="View Ledger" onClick={() => navigate(`/wholesale/customers/${c.id}`)}><FileText size={13} /> Ledger</button>
                                            <button className="icon-button" style={{ marginRight: '4px' }} title="Edit" onClick={() => openModal(c)}><Edit size={15} /></button>
                                            <button className="icon-button" style={{ color: '#EF4444' }} title="Delete" onClick={() => handleDelete(c)}><Trash2 size={15} /></button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editing ? 'Edit Customer' : 'New Wholesale Customer'}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                        <label style={labelStyle}>Customer Name *</label>
                        <input className="search-input" style={{ width: '100%' }} value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus placeholder="Company or person" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div><label style={labelStyle}>Contact Person</label><input className="search-input" style={{ width: '100%' }} value={form.contact_name || ''} onChange={e => setForm({ ...form, contact_name: e.target.value })} /></div>
                        <div><label style={labelStyle}>Phone</label><input className="search-input" style={{ width: '100%' }} value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                    </div>
                    <div><label style={labelStyle}>Email</label><input type="email" className="search-input" style={{ width: '100%' }} value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                    <div><label style={labelStyle}>Address</label><textarea className="search-input" style={{ width: '100%', minHeight: '70px', resize: 'vertical' }} value={form.address || ''} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
                    <div><label style={labelStyle}>Note</label><input className="search-input" style={{ width: '100%' }} value={form.note || ''} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={form.is_active ?? true} onChange={e => setForm({ ...form, is_active: e.target.checked })} style={{ width: '18px', height: '18px', accentColor: 'var(--color-primary)' }} />
                        <span style={{ fontWeight: 500, fontSize: '14px' }}>Active customer</span>
                    </label>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid var(--color-border)', paddingTop: '14px' }}>
                        <button className="secondary-button" onClick={() => setIsModalOpen(false)}>Cancel</button>
                        <button className="primary-button" disabled={saving || !form.name?.trim()} onClick={handleSave}>{saving ? 'Saving…' : (editing ? 'Save Changes' : 'Add Customer')}</button>
                    </div>
                </div>
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

export default WholesaleCustomersPage;
