// Manual Revenue / Expense entry for the Accounting section. One form, no
// debit/credit knowledge needed: picking the Revenue (or Expense) account and
// the cash/bank side posts a balanced journal entry, which the Journal
// Entries page, Income Statement and Cash In / Out then all see.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, AlertTriangle, CircleDollarSign, TrendingDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useHeader } from '../../context/HeaderContext';
import { useToast } from '../../context/ToastContext';
import { useAccounting } from '../../hooks/useAccounting';
import { supabase } from '../../lib/supabase';
import type { ChartOfAccount } from '../../types';

const GREEN = '#10B981', RED = '#EF4444';

const CFG = {
    revenue: {
        title: 'Revenue',
        subtitle: 'Record money the business earned',
        color: GREEN,
        icon: CircleDollarSign,
        accountType: 'Revenue' as const,
        accountLabel: 'Revenue Account',
        counterLabel: 'Received Into',
        submit: 'Record Revenue',
        refPrefix: 'REV',
    },
    expense: {
        title: 'Expense',
        subtitle: 'Record money the business spent',
        color: RED,
        icon: TrendingDown,
        accountType: 'Expense' as const,
        accountLabel: 'Expense Account',
        counterLabel: 'Paid From',
        submit: 'Record Expense',
        refPrefix: 'EXP',
    },
};

interface EntryRow {
    entryId: string;
    date: string;
    description: string;
    accountName: string;
    counterName: string;
    amount: number;
}

const todayYmd = (): string => {
    const d = new Date();
    const p = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const fmt = (n: number): string => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const RevenueExpenseEntryPage: React.FC<{ mode: 'revenue' | 'expense' }> = ({ mode }) => {
    const cfg = CFG[mode];
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { saveJournalEntry } = useAccounting();
    const navigate = useNavigate();

    const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
    interface RawLine { entryId: string; accountId: string; debit: number; credit: number; date: string; description: string }
    const [lines, setLines] = useState<RawLine[] | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>{cfg.title}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0 }}>{cfg.subtitle}</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, cfg]);

    const refetch = useCallback(() => setRefreshKey(k => k + 1), []);

    useEffect(() => {
        let alive = true;
        setLines(null);
        (async () => {
            try {
                const { data: accs, error: accErr } = await supabase
                    .from('chart_of_accounts').select('*').order('account_code', { ascending: true });
                if (accErr) throw accErr;

                const all: RawLine[] = [];
                for (let from = 0; from < 100000; from += 1000) {
                    const { data, error } = await supabase
                        .from('journal_entry_lines')
                        .select('account_id, journal_entry_id, debit, credit, entry:journal_entries!inner(date, description)')
                        .order('id', { ascending: true })
                        .range(from, from + 999);
                    if (error) throw error;
                    type Row = { account_id: unknown; journal_entry_id: unknown; debit: unknown; credit: unknown; entry: { date?: unknown; description?: unknown } | null };
                    for (const l of (data || []) as Row[]) {
                        all.push({
                            entryId: String(l.journal_entry_id),
                            accountId: String(l.account_id),
                            debit: Number(l.debit) || 0,
                            credit: Number(l.credit) || 0,
                            date: String(l.entry?.date || '').slice(0, 10),
                            description: String(l.entry?.description || ''),
                        });
                    }
                    if (!data || data.length < 1000) break;
                }
                if (!alive) return;
                setAccounts(accs || []);
                setLines(all);
            } catch (e) {
                console.error('Failed to load the ledger:', e);
                if (alive) setLines([]);
            }
        })();
        return () => { alive = false; };
    }, [refreshKey]);

    const accountById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
    const mainAccounts = useMemo(
        () => accounts.filter(a => a.account_type === cfg.accountType && a.is_active),
        [accounts, cfg.accountType]
    );
    // Where the money lands or comes from: Asset accounts plus Liability
    // (credit card / payable) for expenses. Cash-named accounts first.
    const counterAccounts = useMemo(() => {
        const pool = accounts.filter(a => a.is_active && (a.account_type === 'Asset' || (mode === 'expense' && a.account_type === 'Liability')));
        return [...pool].sort((a, b) => Number(/cash|bank/i.test(b.account_name)) - Number(/cash|bank/i.test(a.account_name)) || a.account_code.localeCompare(b.account_code));
    }, [accounts, mode]);

    // ── Form ──
    const [date, setDate] = useState(todayYmd());
    const [description, setDescription] = useState('');
    const [accountId, setAccountId] = useState('');
    const [counterId, setCounterId] = useState('');
    const [amount, setAmount] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // Default the selects once accounts arrive, and re-default when switching
    // between the Revenue and Expense pages (same component, prop change).
    useEffect(() => {
        setAccountId(prev => (prev && mainAccounts.some(a => a.id === prev)) ? prev : (mainAccounts[0]?.id || ''));
        setCounterId(prev => (prev && counterAccounts.some(a => a.id === prev)) ? prev : (counterAccounts[0]?.id || ''));
    }, [mainAccounts, counterAccounts, mode]);

    const amountNum = Math.round((Number(amount) || 0) * 100) / 100;
    const canSave = !isSaving && amountNum > 0 && !!accountId && !!counterId && !!date;

    const handleSave = async () => {
        if (!canSave) return;
        setIsSaving(true);
        try {
            const accName = accountById.get(accountId)?.account_name || cfg.title;
            const entryLines = mode === 'revenue'
                ? [
                    { account_id: counterId, debit: amountNum, credit: 0 },
                    { account_id: accountId, debit: 0, credit: amountNum },
                ]
                : [
                    { account_id: accountId, debit: amountNum, credit: 0 },
                    { account_id: counterId, debit: 0, credit: amountNum },
                ];
            await saveJournalEntry(
                { date, description: description.trim() || `${cfg.title}: ${accName}`, reference_id: `${cfg.refPrefix}-${Date.now()}` },
                entryLines
            );
            setAmount('');
            setDescription('');
            refetch();
        } catch {
            // saveJournalEntry already toasts the failure.
        } finally {
            setIsSaving(false);
        }
    };

    // ── Entries of this kind: the entry has a line on a Revenue account with a
    // credit (or an Expense account with a debit). ──
    const rows = useMemo((): EntryRow[] => {
        if (!lines) return [];
        const byEntry = new Map<string, RawLine[]>();
        for (const l of lines) {
            const arr = byEntry.get(l.entryId);
            if (arr) arr.push(l); else byEntry.set(l.entryId, [l]);
        }
        const out: EntryRow[] = [];
        for (const [entryId, entryLines] of byEntry) {
            const mains = entryLines.filter(l => {
                const a = accountById.get(l.accountId);
                if (!a || a.account_type !== cfg.accountType) return false;
                return mode === 'revenue' ? l.credit > 0 : l.debit > 0;
            });
            if (mains.length === 0) continue;
            const amount = mains.reduce((s, l) => s + (mode === 'revenue' ? l.credit - l.debit : l.debit - l.credit), 0);
            if (amount <= 0) continue;
            const counters = entryLines.filter(l => !mains.includes(l));
            out.push({
                entryId,
                date: entryLines[0].date,
                description: entryLines[0].description,
                accountName: mains.map(l => accountById.get(l.accountId)?.account_name || '?').join(', '),
                counterName: counters.map(l => accountById.get(l.accountId)?.account_name || '?').join(', ') || '—',
                amount,
            });
        }
        return out.sort((a, b) => b.date.localeCompare(a.date) || b.entryId.localeCompare(a.entryId));
    }, [lines, accountById, cfg.accountType, mode]);

    const totals = useMemo(() => {
        const month = todayYmd().slice(0, 7);
        return {
            month: rows.filter(r => r.date.startsWith(month)).reduce((s, r) => s + r.amount, 0),
            all: rows.reduce((s, r) => s + r.amount, 0),
            count: rows.length,
        };
    }, [rows]);

    const handleDelete = async (row: EntryRow) => {
        if (!confirm(`Delete this ${mode} entry of ${fmt(row.amount)} (${row.date})? The journal entry and its lines are removed.`)) return;
        try {
            const { error: lineErr } = await supabase.from('journal_entry_lines').delete().eq('journal_entry_id', row.entryId);
            if (lineErr) throw lineErr;
            const { error: entryErr } = await supabase.from('journal_entries').delete().eq('id', row.entryId);
            if (entryErr) throw entryErr;
            showToast('Entry deleted', 'success');
            refetch();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Failed to delete entry: ' + msg, 'error');
        }
    };

    const loading = lines === null;

    const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };
    const labelStyle: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' };
    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--color-border)',
        background: 'var(--color-bg)', color: 'var(--color-text-main)', fontSize: '13px', outline: 'none',
    };

    const Icon = cfg.icon;

    return (
        <div className="acct-page" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Totals */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '14px' }}>
                {[
                    { label: `${cfg.title} This Month`, value: fmt(totals.month) },
                    { label: `${cfg.title} All Time`, value: fmt(totals.all) },
                    { label: 'Entries', value: String(totals.count) },
                ].map(c => (
                    <div key={c.label} style={{ ...cardStyle, borderTop: `3px solid ${cfg.color}`, padding: '14px 16px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{c.label}</div>
                        <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '6px', fontVariantNumeric: 'tabular-nums' }}>{loading ? '…' : c.value}</div>
                    </div>
                ))}
            </div>

            {/* Entry form */}
            <div style={{ ...cardStyle, borderLeft: `4px solid ${cfg.color}`, padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                    <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: `${cfg.color}1A`, color: cfg.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon size={18} />
                    </div>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-text-main)' }}>New {cfg.title} Entry</div>
                </div>

                {!loading && mainAccounts.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)', fontSize: '13px', color: 'var(--color-text-main)' }}>
                        <AlertTriangle size={18} color="#F59E0B" style={{ flexShrink: 0 }} />
                        <span>
                            No active {cfg.accountType} accounts exist yet.{' '}
                            <button onClick={() => navigate('/accounting/chart-of-accounts')} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: '13px' }}>
                                Create one in the Chart of Accounts
                            </button>{' '}
                            first (account type: {cfg.accountType}).
                        </span>
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', alignItems: 'end' }}>
                        <div>
                            <label style={labelStyle}>Date</label>
                            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
                        </div>
                        <div>
                            <label style={labelStyle}>{cfg.accountLabel}</label>
                            <select value={accountId} onChange={e => setAccountId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                                {mainAccounts.map(a => <option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>{cfg.counterLabel}</label>
                            <select value={counterId} onChange={e => setCounterId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                                {counterAccounts.map(a => <option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>Amount (USD)</label>
                            <input
                                type="number" min="0.01" step="0.01" placeholder="0.00" value={amount}
                                onChange={e => setAmount(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
                                style={inputStyle}
                            />
                        </div>
                        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '12px', alignItems: 'end', flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: '220px' }}>
                                <label style={labelStyle}>Description (optional)</label>
                                <input
                                    type="text" className="d2-khmer" placeholder={`e.g. ${mode === 'revenue' ? 'Speaker repair service' : 'Office rent for October'}`}
                                    value={description} onChange={e => setDescription(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
                                    style={inputStyle}
                                />
                            </div>
                            <button
                                onClick={handleSave}
                                disabled={!canSave}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', borderRadius: '9px', border: 'none',
                                    background: canSave ? cfg.color : 'var(--color-border)', color: canSave ? 'white' : 'var(--color-text-muted)',
                                    fontSize: '13px', fontWeight: 700, cursor: canSave ? 'pointer' : 'not-allowed', flexShrink: 0, height: '38px',
                                }}
                            >
                                <Plus size={16} /> {isSaving ? 'Saving…' : cfg.submit}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Entries list */}
            <div style={{ ...cardStyle, overflow: 'hidden' }}>
                <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-text-main)' }}>{cfg.title} Entries</span>
                    <button onClick={refetch} title="Reload" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-secondary)', fontSize: '12px', cursor: 'pointer' }}>
                        <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
                    </button>
                </div>
                {loading ? (
                    <div style={{ padding: '36px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading entries…</div>
                ) : rows.length === 0 ? (
                    <div style={{ padding: '36px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                        No {mode} entries yet — record the first one above.
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '680px' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--color-border)', background: 'var(--color-bg)' }}>
                                    {['Date', 'Description', cfg.accountLabel, cfg.counterLabel, 'Amount', ''].map((h, i) => (
                                        <th key={h || 'x'} style={{ padding: '10px 16px', textAlign: i === 4 ? 'right' : 'left', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)', width: i === 5 ? '50px' : undefined }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r, idx) => (
                                    <tr key={r.entryId} style={{ borderBottom: '1px solid var(--color-border)', background: idx % 2 ? 'rgba(0,0,0,0.015)' : 'transparent' }}>
                                        <td style={{ padding: '10px 16px', whiteSpace: 'nowrap', color: 'var(--color-text-secondary)' }}>{r.date}</td>
                                        <td className="d2-khmer" style={{ padding: '10px 16px', color: 'var(--color-text-main)', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>{r.description || '—'}</td>
                                        <td className="d2-khmer" style={{ padding: '10px 16px', color: 'var(--color-text-secondary)' }}>{r.accountName}</td>
                                        <td className="d2-khmer" style={{ padding: '10px 16px', color: 'var(--color-text-secondary)' }}>{r.counterName}</td>
                                        <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: cfg.color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(r.amount)}</td>
                                        <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                                            <Trash2 size={15} color="var(--color-text-muted)" style={{ cursor: 'pointer' }} onClick={() => handleDelete(r)} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ borderTop: '2px solid var(--color-border)', background: 'var(--color-bg)', fontWeight: 800 }}>
                                    <td colSpan={4} style={{ padding: '11px 16px', color: 'var(--color-text-main)' }}>Total</td>
                                    <td style={{ padding: '11px 16px', textAlign: 'right', color: cfg.color, fontVariantNumeric: 'tabular-nums' }}>{fmt(totals.all)}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>

            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default RevenueExpenseEntryPage;
