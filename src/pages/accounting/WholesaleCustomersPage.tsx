import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit, Trash2, Mail, Phone, MapPin, Search, Users, Building2, DollarSign, AlertTriangle, RefreshCw, Database, FileText, ArrowUpDown } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { Modal } from '../../components';
import { useWholesale } from '../../hooks/useWholesale';
import type { WholesaleCustomer } from '../../types';

const fmt = (n: number) => (n === 0 ? '$0.00' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0));

const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash % 360)}, 65%, 50%)`;
};
const initials = (name: string) => name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

type StatusFilter = 'All' | 'Active' | 'Inactive';
type SortOption = 'name' | 'balance' | 'newest';

interface CustStat { totalInvoiced: number; totalPaid: number; balance: number; orders: number; overdue: boolean; overdueDays: number; }
const emptyStat: CustStat = { totalInvoiced: 0, totalPaid: 0, balance: 0, orders: 0, overdue: false, overdueDays: 0 };

const WholesaleCustomersPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const navigate = useNavigate();
    const { customers, wholesaleOrders, tableMissing, fetchCustomers, fetchWholesaleOrders, saveCustomer, deleteCustomer } = useWholesale();

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
    const [sortBy, setSortBy] = useState<SortOption>('name');
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

    // Per-customer roll-up from their wholesale orders (matched by name).
    const stats = useMemo(() => {
        const map: Record<string, CustStat> = {};
        const today = new Date(); today.setHours(0, 0, 0, 0);
        for (const o of wholesaleOrders) {
            if (o.status === 'Cancelled') continue;
            const key = (o.customer_name || '').trim().toLowerCase();
            if (!map[key]) map[key] = { ...emptyStat };
            const total = o.total_amount || 0, paid = o.amount_paid || 0;
            map[key].totalInvoiced += total;
            map[key].totalPaid += paid;
            map[key].orders += 1;
            const bal = total - paid;
            if (bal > 0.005 && o.due_date) {
                const due = new Date(o.due_date); due.setHours(0, 0, 0, 0);
                if (due < today) {
                    map[key].overdue = true;
                    const d = Math.ceil((today.getTime() - due.getTime()) / 86400000);
                    if (d > map[key].overdueDays) map[key].overdueDays = d;
                }
            }
        }
        Object.values(map).forEach(m => { m.balance = m.totalInvoiced - m.totalPaid; });
        return map;
    }, [wholesaleOrders]);

    const statFor = (name: string): CustStat => stats[(name || '').trim().toLowerCase()] || emptyStat;

    const summary = useMemo(() => {
        const active = customers.filter(c => c.is_active).length;
        const totalOutstanding = Object.values(stats).reduce((s, b) => s + b.balance, 0);
        const overdueCount = customers.filter(c => statFor(c.name).overdue).length;
        return { total: customers.length, active, inactive: customers.length - active, totalOutstanding, overdueCount };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [customers, stats]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        let result = customers;
        if (statusFilter === 'Active') result = result.filter(c => c.is_active);
        else if (statusFilter === 'Inactive') result = result.filter(c => !c.is_active);
        if (q) result = result.filter(c =>
            c.name.toLowerCase().includes(q) || (c.phone || '').includes(q) ||
            (c.email || '').toLowerCase().includes(q) || (c.contact_name || '').toLowerCase().includes(q));
        return [...result].sort((a, b) => {
            if (sortBy === 'name') return a.name.localeCompare(b.name);
            if (sortBy === 'balance') return statFor(b.name).balance - statFor(a.name).balance;
            return (b.created_at || '').localeCompare(a.created_at || '');
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [customers, search, statusFilter, sortBy, stats]);

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

    const handleDelete = async (c: WholesaleCustomer, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm(`Delete customer "${c.name}"?`)) { try { await deleteCustomer(c.id); } catch { /* hook toasts */ } }
    };

    const statusTabs: { label: string; value: StatusFilter; count: number }[] = [
        { label: 'All', value: 'All', count: summary.total },
        { label: 'Active', value: 'Active', count: summary.active },
        { label: 'Inactive', value: 'Inactive', count: summary.inactive },
    ];

    return (
        <div style={{ padding: '24px' }}>
            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <StatCard icon={Users} gradient="linear-gradient(135deg, #6366f1, #8b5cf6)" label="Total Customers" value={String(summary.total)} />
                <StatCard icon={Building2} gradient="linear-gradient(135deg, #10b981, #34d399)" label="Active" value={String(summary.active)} valueColor="#10b981" />
                <StatCard icon={AlertTriangle} gradient="linear-gradient(135deg, #f59e0b, #fbbf24)" label="Overdue" value={String(summary.overdueCount)} valueColor={summary.overdueCount > 0 ? '#ef4444' : undefined} />
                <StatCard icon={DollarSign} gradient="linear-gradient(135deg, #ef4444, #f87171)" label="Outstanding" value={fmt(summary.totalOutstanding)} valueColor={summary.totalOutstanding > 0 ? '#ef4444' : '#10b981'} />
            </div>

            {/* Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    {/* Status tabs */}
                    <div style={{ display: 'flex', background: 'var(--color-surface)', borderRadius: '10px', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                        {statusTabs.map(tab => (
                            <button key={tab.value} onClick={() => setStatusFilter(tab.value)} style={{ padding: '8px 16px', border: 'none', background: statusFilter === tab.value ? 'var(--color-primary)' : 'transparent', color: statusFilter === tab.value ? 'white' : 'var(--color-text-secondary)', fontWeight: 600, fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {tab.label}
                                <span style={{ background: statusFilter === tab.value ? 'rgba(255,255,255,0.25)' : 'var(--color-bg)', padding: '1px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 700 }}>{tab.count}</span>
                            </button>
                        ))}
                    </div>
                    {/* Sort */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <ArrowUpDown size={14} color="var(--color-text-muted)" />
                        <select value={sortBy} onChange={e => setSortBy(e.target.value as SortOption)} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}>
                            <option value="name">Sort by Name</option>
                            <option value="balance">Sort by Balance</option>
                            <option value="newest">Sort by Newest</option>
                        </select>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ position: 'relative', width: '260px' }}>
                        <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                        <input type="text" placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', padding: '9px 10px 9px 36px', borderRadius: '10px', border: '1px solid var(--color-border)', fontSize: '13px', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
                    </div>
                    <button className="secondary-button" onClick={() => { fetchCustomers(); fetchWholesaleOrders(); }} title="Refresh" style={{ padding: '9px 12px' }}><RefreshCw size={16} /></button>
                    <button className="primary-button" disabled={tableMissing} onClick={() => openModal()} style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}><Plus size={18} /> New Customer</button>
                </div>
            </div>

            {tableMissing ? (
                <div className="glass-panel" style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <Database size={40} style={{ opacity: 0.25, margin: '0 auto 12px', color: '#D97706' }} />
                    <p style={{ fontWeight: 600, color: 'var(--color-text)' }}>Database setup needed</p>
                    <p style={{ fontSize: '13px' }}>Run <code>migrations/wholesale_orders.sql</code> in your Supabase SQL editor, then Refresh.</p>
                </div>
            ) : (
                <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '16px', padding: '0' }}>
                    <table className="spreadsheet-table" style={{ width: '100%', borderCollapse: 'collapse', border: 'none', minWidth: '900px' }}>
                        <thead>
                            <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
                                <th style={thStyle}>Customer</th>
                                <th style={thStyle}>Contact</th>
                                <th style={{ ...thStyle, textAlign: 'center' }}>Orders</th>
                                <th style={thStyle}>Payment Progress</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Outstanding</th>
                                <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr><td colSpan={7} style={{ padding: '60px 20px', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', color: 'var(--color-text-secondary)' }}>
                                        <Users size={40} style={{ opacity: 0.25 }} />
                                        <p style={{ fontSize: '14px' }}>{search || statusFilter !== 'All' ? 'No customers match your filters.' : 'No customers yet. Add your first wholesale customer.'}</p>
                                    </div>
                                </td></tr>
                            ) : filtered.map((c, idx) => {
                                const s = statFor(c.name);
                                const paidPercent = s.totalInvoiced > 0 ? Math.min(100, Math.round((s.totalPaid / s.totalInvoiced) * 100)) : 0;
                                return (
                                    <tr key={c.id} onClick={() => navigate(`/wholesale/customers/${c.id}`)} className="hover-highlight" style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s ease', background: idx % 2 === 1 ? 'rgba(0,0,0,0.015)' : undefined, cursor: 'pointer' }}>
                                        <td style={tdStyle}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                                <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: `linear-gradient(135deg, ${stringToColor(c.name)}, ${stringToColor(c.name + 'x')})`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '13px', flexShrink: 0 }}>{initials(c.name)}</div>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: '14px' }}>{c.name}</div>
                                                    {c.contact_name && <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>{c.contact_name}</div>}
                                                </div>
                                            </div>
                                        </td>
                                        <td style={tdStyle}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                                {c.phone && <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Phone size={12} style={{ opacity: 0.6 }} /> {c.phone}</span>}
                                                {c.email && <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Mail size={12} style={{ opacity: 0.6 }} /> {c.email}</span>}
                                                {!c.phone && !c.email && <span style={{ fontStyle: 'italic', opacity: 0.5 }}>—</span>}
                                            </div>
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600 }}>{s.orders}</td>
                                        <td style={{ ...tdStyle, minWidth: '170px', whiteSpace: 'normal' }}>
                                            {s.totalInvoiced > 0 ? (
                                                <div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
                                                        <span>{fmt(s.totalPaid)}</span><span>{paidPercent}%</span>
                                                    </div>
                                                    <div style={{ width: '100%', height: '6px', borderRadius: '4px', background: 'var(--color-border)', overflow: 'hidden' }}>
                                                        <div style={{ width: `${paidPercent}%`, height: '100%', borderRadius: '4px', background: paidPercent >= 100 ? '#10b981' : paidPercent >= 50 ? '#3b82f6' : '#f59e0b', transition: 'width 0.5s ease' }} />
                                                    </div>
                                                    <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>of {fmt(s.totalInvoiced)}</div>
                                                </div>
                                            ) : <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No orders</span>}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                                            <div style={{ fontWeight: 700, fontSize: '15px', color: s.balance > 0.005 ? '#ef4444' : '#10b981' }}>{fmt(s.balance)}</div>
                                            {s.overdue && (
                                                <div style={{ fontSize: '11px', fontWeight: 700, color: '#ef4444', marginTop: '4px', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '12px', background: 'rgba(239,68,68,0.1)' }}>
                                                    <AlertTriangle size={10} /> {s.overdueDays}d overdue
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                                            <span style={{ display: 'inline-block', fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', textTransform: 'uppercase', color: c.is_active ? '#059669' : '#6B7280', background: c.is_active ? 'rgba(16,185,129,0.1)' : 'rgba(107,114,128,0.1)' }}>
                                                {c.is_active ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                                <button className="primary-button" style={{ padding: '7px 12px', borderRadius: '8px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }} title="View Ledger" onClick={() => navigate(`/wholesale/customers/${c.id}`)}><FileText size={13} /> Ledger</button>
                                                <button className="secondary-button" style={{ padding: '7px', borderRadius: '8px', background: 'var(--color-bg)' }} title="Edit" onClick={() => openModal(c)}><Edit size={14} /></button>
                                                <button style={{ padding: '7px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: 'none', cursor: 'pointer' }} title="Delete" onClick={e => handleDelete(c, e)}><Trash2 size={14} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editing ? 'Edit Customer' : 'Register New Customer'}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '4px 0', minWidth: '480px' }}>
                    <div style={{ background: 'var(--color-bg)', padding: '16px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
                        <h4 style={sectionHeading}><Building2 size={16} /> Customer Information</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={labelStyle}>Customer Name *</label>
                                <input className="search-input" style={{ width: '100%' }} value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus placeholder="Company or person name" />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div><label style={labelStyle}>Contact Person</label><input className="search-input" style={{ width: '100%' }} value={form.contact_name || ''} onChange={e => setForm({ ...form, contact_name: e.target.value })} placeholder="Full name" /></div>
                                <div><label style={labelStyle}>Phone</label><input className="search-input" style={{ width: '100%' }} value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+855 ..." /></div>
                            </div>
                        </div>
                    </div>

                    <div style={{ background: 'var(--color-bg)', padding: '16px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
                        <h4 style={sectionHeading}><MapPin size={16} /> Contact Details</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div><label style={labelStyle}>Email</label><input type="email" className="search-input" style={{ width: '100%' }} value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="contact@company.com" /></div>
                            <div><label style={labelStyle}>Address</label><textarea className="search-input" style={{ width: '100%', minHeight: '70px', resize: 'vertical' }} value={form.address || ''} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Full address..." /></div>
                            <div><label style={labelStyle}>Note</label><input className="search-input" style={{ width: '100%' }} value={form.note || ''} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
                        </div>
                    </div>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '0 4px' }}>
                        <input type="checkbox" checked={form.is_active ?? true} onChange={e => setForm({ ...form, is_active: e.target.checked })} style={{ width: '18px', height: '18px', accentColor: 'var(--color-primary)' }} />
                        <span style={{ fontWeight: 500, fontSize: '14px' }}>Active customer</span>
                    </label>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid var(--color-border)', paddingTop: '18px' }}>
                        <button className="secondary-button" onClick={() => setIsModalOpen(false)} style={{ padding: '10px 20px', borderRadius: '8px' }}>Cancel</button>
                        <button className="primary-button" disabled={saving || !form.name?.trim()} onClick={handleSave} style={{ padding: '10px 24px', borderRadius: '8px', fontWeight: 600 }}>{saving ? 'Saving…' : (editing ? 'Save Changes' : 'Register Customer')}</button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

const StatCard: React.FC<{ icon: React.ComponentType<{ size?: number }>; gradient: string; label: string; value: string; valueColor?: string }> = ({ icon: Icon, gradient, label, value, valueColor }) => (
    <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px 20px' }}>
        <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', flexShrink: 0 }}><Icon size={20} /></div>
        <div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{label}</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: valueColor }}>{value}</div>
        </div>
    </div>
);

const thStyle: React.CSSProperties = { padding: '14px 20px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' };
const tdStyle: React.CSSProperties = { padding: '14px 20px', fontSize: '13px', whiteSpace: 'nowrap' };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' };
const sectionHeading: React.CSSProperties = { fontSize: '14px', fontWeight: 600, marginBottom: '16px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' };

export default WholesaleCustomersPage;
