import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Edit, Trash2, Mail, Phone, Search, Users, TrendingUp, Award, XCircle, RefreshCw, Database, UserPlus, Building2 } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { Modal } from '../../components';
import { useCrm } from '../../hooks/useCrm';
import { useLanguage } from '../../context/LanguageContext';
import { fill } from '../../i18n/translate';
import type { Lead } from '../../types';

const LEAD_STATUSES: Lead['status'][] = ['New', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost'];

const statusConfig = (s?: string) => {
    switch (s) {
        case 'Contacted': return { color: '#0369a1', bg: 'rgba(3,105,161,0.1)' };
        case 'Qualified': return { color: '#7e22ce', bg: 'rgba(126,34,206,0.1)' };
        case 'Proposal Sent': return { color: '#d97706', bg: 'rgba(217,119,6,0.1)' };
        case 'Won': return { color: '#059669', bg: 'rgba(16,185,129,0.1)' };
        case 'Lost': return { color: '#dc2626', bg: 'rgba(239,68,68,0.1)' };
        default: return { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' }; // New
    }
};

const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash % 360)}, 65%, 50%)`;
};
const initials = (name: string) => name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

const LeadsPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { users } = useStore();
    const { t } = useLanguage();
    const statusLabel = (s: string) => ({
        All: t('common.all'),
        New: t('ui.people.crm.leadStatus.new'),
        Contacted: t('ui.people.crm.leadStatus.contacted'),
        Qualified: t('ui.people.crm.leadStatus.qualified'),
        'Proposal Sent': t('ui.people.crm.leadStatus.proposalSent'),
        Won: t('ui.people.crm.leadStatus.won'),
        Lost: t('ui.people.crm.leadStatus.lost'),
    } as Record<string, string>)[s] ?? s;
    const { leads, isLoading, tableMissing, fetchLeads, saveLead, deleteLead } = useCrm();

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'All' | Lead['status']>('All');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editing, setEditing] = useState<Lead | null>(null);
    const [form, setForm] = useState<Partial<Lead>>({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>{t('nav.leads')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>{t('ui.people.crm.leads.subtitle')}</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

    useEffect(() => { fetchLeads(); }, [fetchLeads]);

    const summary = useMemo(() => {
        const won = leads.filter(l => l.status === 'Won').length;
        const lost = leads.filter(l => l.status === 'Lost').length;
        return { total: leads.length, pipeline: leads.length - won - lost, won, lost };
    }, [leads]);

    const statusCounts = useMemo(() => {
        const c: Record<string, number> = { All: leads.length };
        for (const s of LEAD_STATUSES) c[s] = 0;
        for (const l of leads) c[l.status] = (c[l.status] || 0) + 1;
        return c;
    }, [leads]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return leads
            .filter(l => statusFilter === 'All' || l.status === statusFilter)
            .filter(l => !q || l.name.toLowerCase().includes(q) || (l.company_name || '').toLowerCase().includes(q) || (l.phone || '').includes(q) || (l.email || '').toLowerCase().includes(q));
    }, [leads, search, statusFilter]);

    const openModal = (l?: Lead) => {
        if (l) { setEditing(l); setForm(l); }
        else { setEditing(null); setForm({ name: '', company_name: '', email: '', phone: '', status: 'New', source: '', assigned_to: '', notes: '' }); }
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!form.name?.trim()) return;
        setSaving(true);
        try { await saveLead(form); setIsModalOpen(false); } catch { /* hook toasts */ } finally { setSaving(false); }
    };

    const handleDelete = async (l: Lead) => {
        if (confirm(fill(t('ui.people.crm.leads.confirmDelete'), { name: l.name }))) {
            try { await deleteLead(l.id); } catch { /* hook toasts */ }
        }
    };

    return (
        <div style={{ padding: '24px' }}>
            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <StatCard icon={Users} gradient="linear-gradient(135deg, #6366f1, #8b5cf6)" label={t('ui.people.crm.leads.total')} value={String(summary.total)} />
                <StatCard icon={TrendingUp} gradient="linear-gradient(135deg, #3b82f6, #60a5fa)" label={t('ui.people.crm.leads.inPipeline')} value={String(summary.pipeline)} />
                <StatCard icon={Award} gradient="linear-gradient(135deg, #10b981, #34d399)" label={t('ui.people.crm.leadStatus.won')} value={String(summary.won)} valueColor="#10b981" />
                <StatCard icon={XCircle} gradient="linear-gradient(135deg, #ef4444, #f87171)" label={t('ui.people.crm.leadStatus.lost')} value={String(summary.lost)} valueColor={summary.lost > 0 ? '#ef4444' : undefined} />
            </div>

            {/* Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', background: 'var(--color-surface)', borderRadius: '10px', border: '1px solid var(--color-border)', overflow: 'hidden', flexWrap: 'wrap' }}>
                    {(['All', ...LEAD_STATUSES] as const).map(tab => (
                        <button key={tab} onClick={() => setStatusFilter(tab)} style={{ padding: '7px 12px', border: 'none', background: statusFilter === tab ? 'var(--color-primary)' : 'transparent', color: statusFilter === tab ? 'white' : 'var(--color-text-secondary)', fontWeight: 600, fontSize: '12px', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            {statusLabel(tab)}
                            <span style={{ background: statusFilter === tab ? 'rgba(255,255,255,0.25)' : 'var(--color-bg)', padding: '1px 7px', borderRadius: '12px', fontSize: '10px', fontWeight: 700 }}>{statusCounts[tab] || 0}</span>
                        </button>
                    ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ position: 'relative', width: '240px' }}>
                        <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                        <input type="text" placeholder={t('ui.people.crm.leads.searchPh')} value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', padding: '9px 10px 9px 36px', borderRadius: '10px', border: '1px solid var(--color-border)', fontSize: '13px', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
                    </div>
                    <button className="secondary-button" onClick={() => fetchLeads()} title={t('ui.people.common.refresh')} style={{ padding: '9px 12px' }}>
                        <RefreshCw size={16} style={isLoading ? { animation: 'spin 1s linear infinite' } : undefined} />
                    </button>
                    <button className="primary-button" disabled={tableMissing} onClick={() => openModal()} style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
                        <Plus size={18} /> {t('ui.people.crm.leads.newLead')}
                    </button>
                </div>
            </div>

            {tableMissing ? (
                <div className="glass-panel" style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <Database size={40} style={{ opacity: 0.25, margin: '0 auto 12px', color: '#D97706' }} />
                    <p style={{ fontWeight: 600, color: 'var(--color-text)' }}>{t('ui.people.crm.dbSetup')}</p>
                    <p style={{ fontSize: '13px' }}>{t('ui.people.crm.dbRun')} <code>migrations/full_schema.sql</code> {t('ui.people.crm.dbRunAfter')}</p>
                </div>
            ) : (
                <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '16px', padding: '0' }}>
                    <table className="spreadsheet-table" style={{ width: '100%', borderCollapse: 'collapse', border: 'none', minWidth: '860px' }}>
                        <thead>
                            <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
                                <th style={thStyle}>{t('ui.people.crm.lead')}</th>
                                <th style={thStyle}>{t('ui.people.hr.emp.contact')}</th>
                                <th style={thStyle}>{t('ui.people.crm.leads.source')}</th>
                                <th style={thStyle}>{t('ui.people.crm.leads.assignedTo')}</th>
                                <th style={{ ...thStyle, textAlign: 'center' }}>{t('ui.people.hr.status.label')}</th>
                                <th style={thStyle}>{t('ui.people.crm.leads.created')}</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>{t('common.actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr><td colSpan={7} style={{ padding: '60px 20px', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', color: 'var(--color-text-secondary)' }}>
                                        <UserPlus size={40} style={{ opacity: 0.25 }} />
                                        <p style={{ fontSize: '14px' }}>{search || statusFilter !== 'All' ? t('ui.people.crm.leads.noMatch') : t('ui.people.crm.leads.noneYet')}</p>
                                    </div>
                                </td></tr>
                            ) : filtered.map((l, idx) => {
                                const sc = statusConfig(l.status);
                                return (
                                    <tr key={l.id} className="hover-highlight" style={{ borderBottom: '1px solid var(--color-border)', background: idx % 2 === 1 ? 'rgba(0,0,0,0.015)' : undefined }}>
                                        <td style={tdStyle}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: `linear-gradient(135deg, ${stringToColor(l.name)}, ${stringToColor(l.name + 'x')})`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '12px', flexShrink: 0 }}>{initials(l.name)}</div>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: '13px' }}>{l.name}</div>
                                                    {l.company_name && <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}><Building2 size={10} /> {l.company_name}</div>}
                                                </div>
                                            </div>
                                        </td>
                                        <td style={tdStyle}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                                {l.phone && <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><Phone size={11} /> {l.phone}</span>}
                                                {l.email && <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><Mail size={11} /> {l.email}</span>}
                                                {!l.phone && !l.email && <span style={{ opacity: 0.5 }}>—</span>}
                                            </div>
                                        </td>
                                        <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>{l.source || '—'}</td>
                                        <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>{l.assigned_to || '—'}</td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                                            <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', backgroundColor: sc.bg, color: sc.color }}>{statusLabel(l.status)}</span>
                                        </td>
                                        <td style={{ ...tdStyle, color: 'var(--color-text-secondary)', fontSize: '12px' }}>{l.created_at ? new Date(l.created_at).toLocaleDateString('en-GB').replace(/\//g, '-') : '—'}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                                                <button onClick={() => openModal(l)} title={t('common.edit')} style={{ background: 'rgba(59,130,246,0.08)', border: 'none', cursor: 'pointer', color: '#3b82f6', padding: '6px', borderRadius: '6px' }}><Edit size={14} /></button>
                                                <button onClick={() => handleDelete(l)} title={t('common.delete')} style={{ background: 'rgba(239,68,68,0.08)', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '6px', borderRadius: '6px' }}><Trash2 size={14} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editing ? t('ui.people.crm.leads.editLead') : t('ui.people.crm.leads.newLead')}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: '440px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div><label style={labelStyle}>{t('ui.people.common.name')} *</label><input className="search-input" style={{ width: '100%' }} value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus placeholder={t('ui.people.crm.leads.namePh')} /></div>
                        <div><label style={labelStyle}>{t('ui.people.crm.company')}</label><input className="search-input" style={{ width: '100%' }} value={form.company_name || ''} onChange={e => setForm({ ...form, company_name: e.target.value })} /></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div><label style={labelStyle}>{t('ui.people.common.phone')}</label><input className="search-input" style={{ width: '100%' }} value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                        <div><label style={labelStyle}>{t('ui.people.crm.type.email')}</label><input type="email" className="search-input" style={{ width: '100%' }} value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                        <div>
                            <label style={labelStyle}>{t('ui.people.hr.status.label')}</label>
                            <select className="search-input" style={{ width: '100%' }} value={form.status || 'New'} onChange={e => setForm({ ...form, status: e.target.value as Lead['status'] })}>
                                {LEAD_STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
                            </select>
                        </div>
                        <div><label style={labelStyle}>{t('ui.people.crm.leads.source')}</label><input className="search-input" style={{ width: '100%' }} value={form.source || ''} onChange={e => setForm({ ...form, source: e.target.value })} placeholder={t('ui.people.crm.leads.sourcePh')} /></div>
                        <div>
                            <label style={labelStyle}>{t('ui.people.crm.leads.assignedTo')}</label>
                            <select className="search-input" style={{ width: '100%' }} value={form.assigned_to || ''} onChange={e => setForm({ ...form, assigned_to: e.target.value })}>
                                <option value="">—</option>
                                {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                            </select>
                        </div>
                    </div>
                    <div><label style={labelStyle}>{t('ui.people.common.notes')}</label><textarea className="search-input" style={{ width: '100%', minHeight: '70px', resize: 'vertical' }} value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid var(--color-border)', paddingTop: '14px' }}>
                        <button className="secondary-button" onClick={() => setIsModalOpen(false)}>{t('common.cancel')}</button>
                        <button className="primary-button" disabled={saving || !form.name?.trim()} onClick={handleSave}>{saving ? t('ui.people.common.saving') : (editing ? t('ui.people.common.saveChanges') : t('ui.people.crm.leads.addLead'))}</button>
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

const thStyle: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' };
const tdStyle: React.CSSProperties = { padding: '8px 14px', fontSize: '13px', whiteSpace: 'nowrap' };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' };

export default LeadsPage;
