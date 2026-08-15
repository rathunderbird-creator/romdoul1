import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Edit, Trash2, Search, RefreshCw, Database, FileText, Send, CheckCircle2, XCircle, X, DollarSign } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { Modal } from '../../components';
import { useCrm } from '../../hooks/useCrm';
import type { Quotation, QuotationItem } from '../../types';

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
const QUOTE_STATUSES: Quotation['status'][] = ['Draft', 'Sent', 'Accepted', 'Rejected'];

const statusConfig = (s?: string) => {
    switch (s) {
        case 'Sent': return { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' };
        case 'Accepted': return { color: '#059669', bg: 'rgba(16,185,129,0.1)' };
        case 'Rejected': return { color: '#dc2626', bg: 'rgba(239,68,68,0.1)' };
        default: return { color: '#6b7280', bg: 'rgba(107,114,128,0.1)' }; // Draft
    }
};

const QuotationsPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { products } = useStore();
    const { quotations, leads, isLoading, tableMissing, fetchQuotations, fetchLeads, saveQuotation, updateQuotationStatus, deleteQuotation } = useCrm();

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'All' | Quotation['status']>('All');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editing, setEditing] = useState<Quotation | null>(null);
    const [leadId, setLeadId] = useState('');
    const [status, setStatus] = useState<Quotation['status']>('Draft');
    const [validUntil, setValidUntil] = useState('');
    const [lines, setLines] = useState<Partial<QuotationItem>[]>([{ name: '', quantity: 1, unit_price: 0 }]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Quotations</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Price quotes offered to leads</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => { fetchQuotations(); fetchLeads(true); }, [fetchQuotations, fetchLeads]);

    const counts = useMemo(() => {
        const c: Record<string, number> = { All: quotations.length, Draft: 0, Sent: 0, Accepted: 0, Rejected: 0 };
        for (const q of quotations) c[q.status] = (c[q.status] || 0) + 1;
        return c;
    }, [quotations]);

    const summary = useMemo(() => {
        const totalValue = quotations.reduce((s, q) => s + (q.total_amount || 0), 0);
        const acceptedValue = quotations.filter(q => q.status === 'Accepted').reduce((s, q) => s + (q.total_amount || 0), 0);
        const pending = counts.Draft + counts.Sent;
        return { totalValue, acceptedValue, pending };
    }, [quotations, counts]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return quotations
            .filter(x => statusFilter === 'All' || x.status === statusFilter)
            .filter(x => !q || (x.lead?.name || '').toLowerCase().includes(q) || x.id.toLowerCase().includes(q));
    }, [quotations, search, statusFilter]);

    const lineTotal = (l: Partial<QuotationItem>) => (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
    const quoteTotal = useMemo(() => lines.reduce((s, l) => s + lineTotal(l), 0), [lines]);
    const setLine = (idx: number, patch: Partial<QuotationItem>) => setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));

    // Picking a product fills the name and suggests its sale price.
    const pickProduct = (idx: number, productId: string) => {
        const p = products.find(x => x.id === productId);
        if (p) setLine(idx, { name: p.name, unit_price: (lines[idx].unit_price || 0) > 0 ? lines[idx].unit_price : p.price });
    };

    const openModal = (q?: Quotation) => {
        if (q) {
            setEditing(q); setLeadId(q.lead_id || ''); setStatus(q.status); setValidUntil(q.valid_until || '');
            setLines(q.items && q.items.length > 0 ? q.items.map(i => ({ ...i })) : [{ name: '', quantity: 1, unit_price: 0 }]);
        } else {
            setEditing(null); setLeadId(leads[0]?.id || ''); setStatus('Draft'); setValidUntil('');
            setLines([{ name: '', quantity: 1, unit_price: 0 }]);
        }
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!leadId) return;
        const validLines = lines.filter(l => (l.name || '').trim() && (Number(l.quantity) || 0) > 0) as QuotationItem[];
        if (validLines.length === 0) return;
        setSaving(true);
        try {
            await saveQuotation({ id: editing?.id, lead_id: leadId, status, valid_until: validUntil || undefined, items: validLines });
            setIsModalOpen(false);
        } catch { /* hook toasts */ } finally { setSaving(false); }
    };

    const handleDelete = async (q: Quotation) => {
        if (confirm('Delete this quotation?')) { try { await deleteQuotation(q.id); } catch { /* hook toasts */ } }
    };

    return (
        <div style={{ padding: '24px' }}>
            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <StatCard icon={FileText} gradient="linear-gradient(135deg, #6366f1, #8b5cf6)" label="Total Quotations" value={String(counts.All)} />
                <StatCard icon={Send} gradient="linear-gradient(135deg, #3b82f6, #60a5fa)" label="Pending (Draft + Sent)" value={String(summary.pending)} />
                <StatCard icon={CheckCircle2} gradient="linear-gradient(135deg, #10b981, #34d399)" label="Accepted Value" value={fmt(summary.acceptedValue)} valueColor="#10b981" />
                <StatCard icon={DollarSign} gradient="linear-gradient(135deg, #f59e0b, #fbbf24)" label="Total Quoted Value" value={fmt(summary.totalValue)} />
            </div>

            {/* Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', background: 'var(--color-surface)', borderRadius: '10px', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                    {(['All', ...QUOTE_STATUSES] as const).map(tab => (
                        <button key={tab} onClick={() => setStatusFilter(tab)} style={{ padding: '7px 14px', border: 'none', background: statusFilter === tab ? 'var(--color-primary)' : 'transparent', color: statusFilter === tab ? 'white' : 'var(--color-text-secondary)', fontWeight: 600, fontSize: '12px', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            {tab}
                            <span style={{ background: statusFilter === tab ? 'rgba(255,255,255,0.25)' : 'var(--color-bg)', padding: '1px 7px', borderRadius: '12px', fontSize: '10px', fontWeight: 700 }}>{counts[tab] || 0}</span>
                        </button>
                    ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ position: 'relative', width: '240px' }}>
                        <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                        <input type="text" placeholder="Search lead, quote #..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', padding: '9px 10px 9px 36px', borderRadius: '10px', border: '1px solid var(--color-border)', fontSize: '13px', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
                    </div>
                    <button className="secondary-button" onClick={() => fetchQuotations()} title="Refresh" style={{ padding: '9px 12px' }}>
                        <RefreshCw size={16} style={isLoading ? { animation: 'spin 1s linear infinite' } : undefined} />
                    </button>
                    <button className="primary-button" disabled={tableMissing || leads.length === 0} onClick={() => openModal()} style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }} title={leads.length === 0 ? 'Add a lead first' : undefined}>
                        <Plus size={18} /> New Quotation
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
                    <table className="spreadsheet-table" style={{ width: '100%', borderCollapse: 'collapse', border: 'none', minWidth: '820px' }}>
                        <thead>
                            <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
                                <th style={thStyle}>Quote #</th>
                                <th style={thStyle}>Lead</th>
                                <th style={thStyle}>Created</th>
                                <th style={thStyle}>Valid Until</th>
                                <th style={{ ...thStyle, textAlign: 'center' }}>Items</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                                <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr><td colSpan={8} style={{ padding: '60px 20px', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', color: 'var(--color-text-secondary)' }}>
                                        <FileText size={40} style={{ opacity: 0.25 }} />
                                        <p style={{ fontSize: '14px' }}>{search || statusFilter !== 'All' ? 'No quotations match your filters.' : 'No quotations yet. Create one for a lead.'}</p>
                                    </div>
                                </td></tr>
                            ) : filtered.map((q, idx) => {
                                const sc = statusConfig(q.status);
                                const expired = q.valid_until && new Date(q.valid_until) < new Date() && (q.status === 'Draft' || q.status === 'Sent');
                                return (
                                    <tr key={q.id} className="hover-highlight" style={{ borderBottom: '1px solid var(--color-border)', background: idx % 2 === 1 ? 'rgba(0,0,0,0.015)' : undefined }}>
                                        <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 700 }}>QT-{q.id.slice(0, 8).toUpperCase()}</td>
                                        <td style={{ ...tdStyle, fontWeight: 600 }}>{q.lead?.name || '—'}</td>
                                        <td style={{ ...tdStyle, color: 'var(--color-text-secondary)', fontSize: '12px' }}>{q.created_at ? new Date(q.created_at).toLocaleDateString('en-GB').replace(/\//g, '-') : '—'}</td>
                                        <td style={{ ...tdStyle, fontSize: '12px' }}>
                                            {q.valid_until ? (
                                                <span style={{ color: expired ? '#ef4444' : 'var(--color-text-secondary)', fontWeight: expired ? 600 : 400 }}>
                                                    {new Date(q.valid_until).toLocaleDateString('en-GB').replace(/\//g, '-')}
                                                    {expired && <span style={{ marginLeft: '5px', fontSize: '10px', fontWeight: 700 }}>EXPIRED</span>}
                                                </span>
                                            ) : '—'}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600 }}>{q.items?.length || 0}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontSize: '14px' }}>{fmt(q.total_amount || 0)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                                            <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', backgroundColor: sc.bg, color: sc.color }}>{q.status}</span>
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                                                {q.status === 'Draft' && (
                                                    <button onClick={() => updateQuotationStatus(q.id, 'Sent')} title="Mark Sent" style={{ background: 'rgba(59,130,246,0.08)', border: 'none', cursor: 'pointer', color: '#3b82f6', padding: '6px', borderRadius: '6px' }}><Send size={14} /></button>
                                                )}
                                                {q.status === 'Sent' && (
                                                    <>
                                                        <button onClick={() => updateQuotationStatus(q.id, 'Accepted')} title="Mark Accepted" style={{ background: 'rgba(16,185,129,0.1)', border: 'none', cursor: 'pointer', color: '#059669', padding: '6px', borderRadius: '6px' }}><CheckCircle2 size={14} /></button>
                                                        <button onClick={() => updateQuotationStatus(q.id, 'Rejected')} title="Mark Rejected" style={{ background: 'rgba(239,68,68,0.08)', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '6px', borderRadius: '6px' }}><XCircle size={14} /></button>
                                                    </>
                                                )}
                                                <button onClick={() => openModal(q)} title="Edit" style={{ background: 'rgba(59,130,246,0.08)', border: 'none', cursor: 'pointer', color: '#3b82f6', padding: '6px', borderRadius: '6px' }}><Edit size={14} /></button>
                                                <button onClick={() => handleDelete(q)} title="Delete" style={{ background: 'rgba(239,68,68,0.08)', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '6px', borderRadius: '6px' }}><Trash2 size={14} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editing ? 'Edit Quotation' : 'New Quotation'}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: '520px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px' }}>
                        <div>
                            <label style={labelStyle}>Lead *</label>
                            <select className="search-input" style={{ width: '100%' }} value={leadId} onChange={e => setLeadId(e.target.value)}>
                                <option value="" disabled>Select lead…</option>
                                {leads.map(l => <option key={l.id} value={l.id}>{l.name}{l.company_name ? ` (${l.company_name})` : ''}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>Status</label>
                            <select className="search-input" style={{ width: '100%' }} value={status} onChange={e => setStatus(e.target.value as Quotation['status'])}>
                                {QUOTE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div><label style={labelStyle}>Valid Until</label><input type="date" className="search-input" style={{ width: '100%' }} value={validUntil} onChange={e => setValidUntil(e.target.value)} /></div>
                    </div>

                    {/* Line items */}
                    <div>
                        <label style={labelStyle}>Items</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {lines.map((l, idx) => (
                                <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.4fr 0.7fr 0.9fr auto', gap: '8px', alignItems: 'center' }}>
                                    <select className="search-input" value="" onChange={e => pickProduct(idx, e.target.value)}>
                                        <option value="">Pick product…</option>
                                        {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                    </select>
                                    <input className="search-input" placeholder="Item name" value={l.name || ''} onChange={e => setLine(idx, { name: e.target.value })} />
                                    <input type="number" className="search-input" placeholder="Qty" min="0" value={l.quantity ?? ''} onChange={e => setLine(idx, { quantity: Number(e.target.value) })} />
                                    <input type="number" className="search-input" placeholder="Unit $" min="0" step="0.01" value={l.unit_price ?? ''} onChange={e => setLine(idx, { unit_price: Number(e.target.value) })} />
                                    <button className="icon-button" style={{ color: '#EF4444' }} onClick={() => setLines(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)} title="Remove"><X size={16} /></button>
                                </div>
                            ))}
                        </div>
                        <button className="secondary-button" style={{ marginTop: '8px', fontSize: '13px' }} onClick={() => setLines(prev => [...prev, { name: '', quantity: 1, unit_price: 0 }])}>
                            <Plus size={14} /> Add line
                        </button>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--color-border)', paddingTop: '14px' }}>
                        <div style={{ fontSize: '14px' }}>Total: <strong style={{ fontSize: '18px', color: 'var(--color-primary)' }}>{fmt(quoteTotal)}</strong></div>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button className="secondary-button" onClick={() => setIsModalOpen(false)}>Cancel</button>
                            <button className="primary-button" disabled={saving || !leadId || quoteTotal <= 0} onClick={handleSave}>{saving ? 'Saving…' : (editing ? 'Save Changes' : 'Create Quotation')}</button>
                        </div>
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

export default QuotationsPage;
