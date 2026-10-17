// Wholesale Setup — the sell-side mirror of Purchase Setup: defaults for new
// wholesale orders (VAT, payment terms, warehouse, payment account, invoice
// numbering prefixes), named payment-term presets, and AR opening balances
// per customer. Everything persists in the shared app config.
import React, { useState, useEffect, useMemo } from 'react';
import { SlidersHorizontal, CalendarClock, Landmark, Plus, Trash2 } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useAccounting } from '../../hooks/useAccounting';
import { useWholesale } from '../../hooks/useWholesale';
import type { WholesaleSettings, PurchaseTermPreset, WholesaleOpeningBalance } from '../../types';

type TabKey = 'defaults' | 'terms' | 'opening';

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { key: 'defaults', label: 'Defaults', icon: SlidersHorizontal },
    { key: 'terms', label: 'Payment Terms', icon: CalendarClock },
    { key: 'opening', label: 'AR Opening Balances', icon: Landmark },
];

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

const WholesaleSetupPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { warehouses, wholesaleSettings, updateWholesaleSettings } = useStore();
    const { accounts, fetchAccounts } = useAccounting();
    const { customers, fetchCustomers } = useWholesale();

    const [tab, setTab] = useState<TabKey>('defaults');
    const [saving, setSaving] = useState(false);

    // Local draft of the whole settings object, loaded from the store once.
    const [draft, setDraft] = useState<WholesaleSettings>(() => ({ ...wholesaleSettings }));
    useEffect(() => {
        // Re-sync when the stored settings arrive after the config loads.
        setDraft({ ...wholesaleSettings });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(wholesaleSettings)]);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Wholesale Setup</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Defaults for new sell-side documents, and where you started.</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchAccounts();
        fetchCustomers();
    }, [fetchAccounts, fetchCustomers]);

    // Bank or cash accounts for the default payment account select.
    const paymentAccounts = useMemo(
        () => accounts.filter(a => a.is_active && a.account_type === 'Asset' && /cash|bank/i.test(a.account_name)),
        [accounts]
    );

    const numbering = draft.numbering || {};
    const setNumbering = (key: keyof NonNullable<WholesaleSettings['numbering']>, value: string) =>
        setDraft(d => ({ ...d, numbering: { ...(d.numbering || {}), [key]: value } }));

    const terms: PurchaseTermPreset[] = draft.paymentTerms || [];
    const setTerm = (i: number, patch: Partial<PurchaseTermPreset>) =>
        setDraft(d => ({ ...d, paymentTerms: (d.paymentTerms || []).map((t, idx) => idx === i ? { ...t, ...patch } : t) }));

    const balances = useMemo<WholesaleOpeningBalance[]>(() => draft.arOpeningBalances || [], [draft.arOpeningBalances]);
    const balanceOf = (customerId: string) => balances.find(b => b.customer_id === customerId);
    const setBalance = (customerId: string, patch: Partial<WholesaleOpeningBalance>) =>
        setDraft(d => {
            const list = [...(d.arOpeningBalances || [])];
            const idx = list.findIndex(b => b.customer_id === customerId);
            if (idx >= 0) list[idx] = { ...list[idx], ...patch };
            else list.push({ customer_id: customerId, amount: 0, ...patch });
            return { ...d, arOpeningBalances: list };
        });
    const openingTotal = useMemo(() => balances.reduce((s, b) => s + (Number(b.amount) || 0), 0), [balances]);

    const handleSave = async () => {
        setSaving(true);
        try {
            // Normalize with the SAME fallbacks the inputs display, so an
            // untouched field saves what the user saw (e.g. 30 days), not 0.
            const clean: WholesaleSettings = {
                ...draft,
                vatRate: Math.max(0, Number(draft.vatRate ?? 0) || 0),
                paymentTermsDays: Math.max(0, Math.round(Number(draft.paymentTermsDays ?? 30) || 0)),
                paymentTerms: (draft.paymentTerms || []).filter(t => t.name.trim()).map(t => ({ name: t.name.trim(), days: Math.max(0, Math.round(Number(t.days) || 0)) })),
                arOpeningBalances: (draft.arOpeningBalances || []).filter(b => (Number(b.amount) || 0) > 0),
            };
            await updateWholesaleSettings(clean);
            showToast('Wholesale settings saved', 'success');
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Failed to save settings: ' + msg, 'error');
        } finally {
            setSaving(false);
        }
    };

    // ── Styles (the flat-card family used across the app) ──
    const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };
    const labelStyle: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' };
    const helpStyle: React.CSSProperties = { fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: 1.45, marginTop: '6px' };
    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--color-border)',
        background: 'var(--color-bg)', color: 'var(--color-text-main)', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
    };
    const saveBtn: React.CSSProperties = {
        padding: '10px 18px', borderRadius: '9px', border: 'none', background: 'var(--color-primary)', color: 'white',
        fontSize: '13px', fontWeight: 700, cursor: saving ? 'wait' : 'pointer', alignSelf: 'flex-start',
    };

    return (
        <div className="acct-page" style={{ maxWidth: '100%', margin: '0 auto', background: 'var(--color-bg)', minHeight: 'var(--vh-full)', display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: '4px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '4px', flexWrap: 'wrap', alignSelf: 'flex-start' }}>
                {TABS.map(({ key, label, icon: Icon }) => (
                    <button
                        key={key}
                        onClick={() => setTab(key)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '7px', padding: '8px 14px', borderRadius: '9px', border: 'none',
                            background: tab === key ? 'var(--color-surface)' : 'transparent',
                            color: tab === key ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                            fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                            boxShadow: tab === key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                        }}
                    >
                        <Icon size={15} /> {label}
                    </button>
                ))}
            </div>

            {/* ── Defaults ── */}
            {tab === 'defaults' && (
                <div style={{ ...cardStyle, padding: '20px 22px', maxWidth: '640px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                        Starting values for new wholesale orders only. Changing them never alters an order that has already been saved.
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                        <div>
                            <label style={labelStyle}>Default VAT rate (%)</label>
                            <input type="number" min="0" step="0.01" value={draft.vatRate ?? 0}
                                onChange={e => setDraft(d => ({ ...d, vatRate: Number(e.target.value) }))} style={inputStyle} />
                        </div>
                        <div>
                            <label style={labelStyle}>Payment terms (days)</label>
                            <input type="number" min="0" step="1" value={draft.paymentTermsDays ?? 30}
                                onChange={e => setDraft(d => ({ ...d, paymentTermsDays: Number(e.target.value) }))} style={inputStyle} />
                            <div style={helpStyle}>New wholesale orders prefill their due date this many days after the order date.</div>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                        <div>
                            <label style={labelStyle}>Default warehouse</label>
                            <select value={draft.defaultWarehouseId || ''} className="d2-khmer"
                                onChange={e => setDraft(d => ({ ...d, defaultWarehouseId: e.target.value || undefined }))}
                                style={{ ...inputStyle, cursor: 'pointer' }}>
                                <option value="">First warehouse</option>
                                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>Default payment account</label>
                            <select value={draft.defaultPaymentAccountId || ''} className="d2-khmer"
                                onChange={e => setDraft(d => ({ ...d, defaultPaymentAccountId: e.target.value || undefined }))}
                                style={{ ...inputStyle, cursor: 'pointer' }}>
                                <option value="">Bank or cash account…</option>
                                {paymentAccounts.map(a => <option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>)}
                            </select>
                        </div>
                    </div>

                    <div>
                        <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-text-main)', marginBottom: '4px' }}>Document numbering</div>
                        <div style={{ ...helpStyle, marginTop: 0, marginBottom: '10px' }}>
                            Prefixes only. Changing a prefix affects new records only — invoices that already exist keep their number
                            and the sequence restarts per prefix.
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '10px', maxWidth: '360px' }}>
                            {([
                                ['Orders', 'orders', 'WO'],
                                ['Receipts', 'receipts', 'RCT'],
                                ['Opening', 'opening', 'OB'],
                            ] as const).map(([label, key, def]) => (
                                <div key={key}>
                                    <label style={{ ...labelStyle, whiteSpace: 'nowrap' }}>{label}</label>
                                    <input type="text" value={numbering[key] ?? def} maxLength={6}
                                        onChange={e => setNumbering(key, e.target.value.toUpperCase())} style={inputStyle} />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div style={{ padding: '12px 14px', borderRadius: '10px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', fontSize: '12.5px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                        The GL accounts a sale posts to — receivables, output VAT and sales revenue — are configured in the{' '}
                        <b style={{ color: 'var(--color-text-main)' }}>Chart of Accounts</b>, where the ledger pages read them.
                    </div>

                    <button onClick={handleSave} disabled={saving} style={saveBtn}>{saving ? 'Saving…' : 'Save settings'}</button>
                </div>
            )}

            {/* ── Payment Terms ── */}
            {tab === 'terms' && (
                <div style={{ ...cardStyle, padding: '20px 22px', maxWidth: '640px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                        Named terms you can quote to wholesale customers. The default above ({draft.paymentTermsDays ?? 30} days) is
                        used when an order doesn't pick one.
                    </p>
                    {terms.length === 0 && (
                        <div style={{ padding: '18px', textAlign: 'center', fontSize: '13px', color: 'var(--color-text-muted)', background: 'var(--color-bg)', borderRadius: '10px', border: '1px solid var(--color-border)' }}>
                            No terms yet — add the ones you use, e.g. Due on receipt (0), Net 15, Net 30.
                        </div>
                    )}
                    {terms.map((t, i) => (
                        <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <input type="text" placeholder="e.g. Net 30" value={t.name}
                                onChange={e => setTerm(i, { name: e.target.value })} style={{ ...inputStyle, flex: 2 }} />
                            <input type="number" min="0" step="1" placeholder="Days" value={t.days}
                                onChange={e => setTerm(i, { days: Number(e.target.value) })} style={{ ...inputStyle, flex: 1, maxWidth: '110px' }} />
                            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>days</span>
                            <button
                                onClick={() => setDraft(d => ({ ...d, paymentTerms: (d.paymentTerms || []).filter((_, idx) => idx !== i) }))}
                                aria-label="Remove term"
                                style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: '6px', display: 'flex' }}
                            ><Trash2 size={15} /></button>
                        </div>
                    ))}
                    <button
                        onClick={() => setDraft(d => ({ ...d, paymentTerms: [...(d.paymentTerms || []), { name: '', days: 30 }] }))}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' }}
                    >
                        <Plus size={15} /> Add term
                    </button>
                    <button onClick={handleSave} disabled={saving} style={saveBtn}>{saving ? 'Saving…' : 'Save settings'}</button>
                </div>
            )}

            {/* ── AR Opening Balances ── */}
            {tab === 'opening' && (
                <div style={{ ...cardStyle, padding: '20px 22px', maxWidth: '640px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                        What each wholesale customer still owed you when you started using the system. Reference figures only —
                        ongoing receivables live in Accounts Receivable.
                    </p>
                    {customers.length === 0 ? (
                        <div style={{ padding: '18px', textAlign: 'center', fontSize: '13px', color: 'var(--color-text-muted)', background: 'var(--color-bg)', borderRadius: '10px', border: '1px solid var(--color-border)' }}>
                            No wholesale customers yet — add them under Wholesale → Customers first.
                        </div>
                    ) : (
                        <div style={{ border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
                            {customers.map((c, i) => {
                                const b = balanceOf(c.id);
                                return (
                                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderTop: i === 0 ? 'none' : '1px solid var(--color-border)', flexWrap: 'wrap' }}>
                                        <span className="d2-khmer" style={{ flex: '1 1 160px', minWidth: 0, fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                                        <input
                                            type="number" min="0" step="0.01" placeholder="0.00"
                                            value={b?.amount ?? ''}
                                            onChange={e => setBalance(c.id, { amount: Number(e.target.value) })}
                                            style={{ ...inputStyle, width: '130px', textAlign: 'right' }}
                                            aria-label={`Opening balance for ${c.name}`}
                                        />
                                        <input
                                            type="date"
                                            value={b?.as_of || ''}
                                            onChange={e => setBalance(c.id, { as_of: e.target.value })}
                                            style={{ ...inputStyle, width: '150px' }}
                                            aria-label={`As-of date for ${c.name}`}
                                        />
                                    </div>
                                );
                            })}
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 14px', borderTop: '2px solid var(--color-border)', background: 'var(--color-bg)', fontSize: '13px', fontWeight: 800 }}>
                                <span style={{ color: 'var(--color-text-main)' }}>Total opening receivables</span>
                                <span style={{ color: '#059669', fontVariantNumeric: 'tabular-nums' }}>{fmt(openingTotal)}</span>
                            </div>
                        </div>
                    )}
                    <button onClick={handleSave} disabled={saving} style={saveBtn}>{saving ? 'Saving…' : 'Save settings'}</button>
                </div>
            )}
        </div>
    );
};

export default WholesaleSetupPage;
