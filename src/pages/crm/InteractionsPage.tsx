import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Edit, Trash2, Search, RefreshCw, Database, MessageSquare, PhoneCall, Mail, Users as UsersIcon } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { Modal } from '../../components';
import { useCrm } from '../../hooks/useCrm';
import type { Interaction } from '../../types';

const TYPES: Interaction['type'][] = ['Call', 'Email', 'Meeting'];

const typeConfig = (t?: string) => {
    switch (t) {
        case 'Email': return { color: '#7e22ce', bg: 'rgba(126,34,206,0.1)', icon: Mail };
        case 'Meeting': return { color: '#d97706', bg: 'rgba(217,119,6,0.1)', icon: UsersIcon };
        default: return { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', icon: PhoneCall }; // Call
    }
};

const InteractionsPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { currentUser } = useStore();
    const { interactions, leads, isLoading, tableMissing, fetchInteractions, fetchLeads, saveInteraction, deleteInteraction } = useCrm();

    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState<'All' | Interaction['type']>('All');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editing, setEditing] = useState<Interaction | null>(null);
    const [form, setForm] = useState<Partial<Interaction>>({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Interactions</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Calls, emails and meetings logged against your leads</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => { fetchInteractions(); fetchLeads(true); }, [fetchInteractions, fetchLeads]);

    const counts = useMemo(() => {
        const c: Record<string, number> = { All: interactions.length, Call: 0, Email: 0, Meeting: 0 };
        for (const it of interactions) c[it.type] = (c[it.type] || 0) + 1;
        return c;
    }, [interactions]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return interactions
            .filter(it => typeFilter === 'All' || it.type === typeFilter)
            .filter(it => !q || (it.lead?.name || '').toLowerCase().includes(q) || (it.notes || '').toLowerCase().includes(q) || (it.performed_by || '').toLowerCase().includes(q));
    }, [interactions, search, typeFilter]);

    const openModal = (it?: Interaction) => {
        if (it) { setEditing(it); setForm({ ...it, date: it.date?.slice(0, 10) }); }
        else {
            setEditing(null);
            setForm({ lead_id: leads[0]?.id || '', type: 'Call', date: new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10), notes: '', performed_by: currentUser?.name || '' });
        }
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!form.lead_id) return;
        setSaving(true);
        try {
            await saveInteraction({ ...form, date: form.date ? new Date(form.date).toISOString() : new Date().toISOString() });
            setIsModalOpen(false);
        } catch { /* hook toasts */ } finally { setSaving(false); }
    };

    const handleDelete = async (it: Interaction) => {
        if (confirm('Delete this interaction?')) { try { await deleteInteraction(it.id); } catch { /* hook toasts */ } }
    };

    return (
        <div style={{ padding: '24px' }}>
            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <StatCard icon={MessageSquare} gradient="linear-gradient(135deg, #6366f1, #8b5cf6)" label="Total Interactions" value={String(counts.All)} />
                <StatCard icon={PhoneCall} gradient="linear-gradient(135deg, #3b82f6, #60a5fa)" label="Calls" value={String(counts.Call)} />
                <StatCard icon={Mail} gradient="linear-gradient(135deg, #8b5cf6, #a78bfa)" label="Emails" value={String(counts.Email)} />
                <StatCard icon={UsersIcon} gradient="linear-gradient(135deg, #f59e0b, #fbbf24)" label="Meetings" value={String(counts.Meeting)} />
            </div>

            {/* Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', background: 'var(--color-surface)', borderRadius: '10px', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                    {(['All', ...TYPES] as const).map(tab => (
                        <button key={tab} onClick={() => setTypeFilter(tab)} style={{ padding: '7px 14px', border: 'none', background: typeFilter === tab ? 'var(--color-primary)' : 'transparent', color: typeFilter === tab ? 'white' : 'var(--color-text-secondary)', fontWeight: 600, fontSize: '12px', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            {tab}
                            <span style={{ background: typeFilter === tab ? 'rgba(255,255,255,0.25)' : 'var(--color-bg)', padding: '1px 7px', borderRadius: '12px', fontSize: '10px', fontWeight: 700 }}>{counts[tab] || 0}</span>
                        </button>
                    ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ position: 'relative', width: '240px' }}>
                        <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                        <input type="text" placeholder="Search lead, notes..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', padding: '9px 10px 9px 36px', borderRadius: '10px', border: '1px solid var(--color-border)', fontSize: '13px', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
                    </div>
                    <button className="secondary-button" onClick={() => fetchInteractions()} title="Refresh" style={{ padding: '9px 12px' }}>
                        <RefreshCw size={16} style={isLoading ? { animation: 'spin 1s linear infinite' } : undefined} />
                    </button>
                    <button className="primary-button" disabled={tableMissing || leads.length === 0} onClick={() => openModal()} style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }} title={leads.length === 0 ? 'Add a lead first' : undefined}>
                        <Plus size={18} /> Log Interaction
                    </button>
                </div>
            </div>

            {tableMissing ? (
                <div className="glass-panel" style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <Database size={40} style={{ opacity: 0.25, margin: '0 auto 12px', color: '#D97706' }} />
                    <p style={{ fontWeight: 600, color: 'var(--color-text)' }}>Database setup needed</p>
                    <p style={{ fontSize: '13px' }}>Run <code>migrations/erp_schema_additions.sql</code> in your Supabase SQL editor, then Refresh.</p>
                </div>
            ) : (
                <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '16px', padding: '0' }}>
                    <table className="spreadsheet-table" style={{ width: '100%', borderCollapse: 'collapse', border: 'none', minWidth: '760px' }}>
                        <thead>
                            <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
                                <th style={thStyle}>Date</th>
                                <th style={{ ...thStyle, textAlign: 'center' }}>Type</th>
                                <th style={thStyle}>Lead</th>
                                <th style={thStyle}>Notes</th>
                                <th style={thStyle}>By</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr><td colSpan={6} style={{ padding: '60px 20px', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', color: 'var(--color-text-secondary)' }}>
                                        <MessageSquare size={40} style={{ opacity: 0.25 }} />
                                        <p style={{ fontSize: '14px' }}>{search || typeFilter !== 'All' ? 'No interactions match your filters.' : 'No interactions logged yet.'}</p>
                                    </div>
                                </td></tr>
                            ) : filtered.map((it, idx) => {
                                const tc = typeConfig(it.type);
                                const TypeIcon = tc.icon;
                                return (
                                    <tr key={it.id} className="hover-highlight" style={{ borderBottom: '1px solid var(--color-border)', background: idx % 2 === 1 ? 'rgba(0,0,0,0.015)' : undefined }}>
                                        <td style={{ ...tdStyle, color: 'var(--color-text-secondary)', fontSize: '12px' }}>{it.date ? new Date(it.date).toLocaleDateString('en-GB').replace(/\//g, '-') : '—'}</td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', backgroundColor: tc.bg, color: tc.color }}>
                                                <TypeIcon size={11} /> {it.type}
                                            </span>
                                        </td>
                                        <td style={{ ...tdStyle, fontWeight: 600 }}>{it.lead?.name || '—'}</td>
                                        <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: '360px', color: 'var(--color-text)' }}>{it.notes || <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</td>
                                        <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>{it.performed_by || '—'}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                                                <button onClick={() => openModal(it)} title="Edit" style={{ background: 'rgba(59,130,246,0.08)', border: 'none', cursor: 'pointer', color: '#3b82f6', padding: '6px', borderRadius: '6px' }}><Edit size={14} /></button>
                                                <button onClick={() => handleDelete(it)} title="Delete" style={{ background: 'rgba(239,68,68,0.08)', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '6px', borderRadius: '6px' }}><Trash2 size={14} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editing ? 'Edit Interaction' : 'Log Interaction'}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: '420px' }}>
                    <div>
                        <label style={labelStyle}>Lead *</label>
                        <select className="search-input" style={{ width: '100%' }} value={form.lead_id || ''} onChange={e => setForm({ ...form, lead_id: e.target.value })}>
                            <option value="" disabled>Select lead…</option>
                            {leads.map(l => <option key={l.id} value={l.id}>{l.name}{l.company_name ? ` (${l.company_name})` : ''}</option>)}
                        </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                            <label style={labelStyle}>Type</label>
                            <select className="search-input" style={{ width: '100%' }} value={form.type || 'Call'} onChange={e => setForm({ ...form, type: e.target.value as Interaction['type'] })}>
                                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                        <div><label style={labelStyle}>Date</label><input type="date" className="search-input" style={{ width: '100%' }} value={form.date || ''} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
                    </div>
                    <div><label style={labelStyle}>Notes</label><textarea className="search-input" style={{ width: '100%', minHeight: '80px', resize: 'vertical' }} value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="What was discussed…" /></div>
                    <div><label style={labelStyle}>Performed By</label><input className="search-input" style={{ width: '100%' }} value={form.performed_by || ''} onChange={e => setForm({ ...form, performed_by: e.target.value })} /></div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid var(--color-border)', paddingTop: '14px' }}>
                        <button className="secondary-button" onClick={() => setIsModalOpen(false)}>Cancel</button>
                        <button className="primary-button" disabled={saving || !form.lead_id} onClick={handleSave}>{saving ? 'Saving…' : (editing ? 'Save Changes' : 'Log Interaction')}</button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

const StatCard: React.FC<{ icon: React.ComponentType<{ size?: number }>; gradient: string; label: string; value: string }> = ({ icon: Icon, gradient, label, value }) => (
    <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px 20px' }}>
        <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', flexShrink: 0 }}><Icon size={20} /></div>
        <div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{label}</div>
            <div style={{ fontSize: '22px', fontWeight: 700 }}>{value}</div>
        </div>
    </div>
);

const thStyle: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' };
const tdStyle: React.CSSProperties = { padding: '8px 14px', fontSize: '13px', whiteSpace: 'nowrap' };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' };

export default InteractionsPage;
