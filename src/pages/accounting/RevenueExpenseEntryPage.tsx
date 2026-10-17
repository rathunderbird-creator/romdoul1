// Manual Revenue / Expense entry for the Accounting section. One form, no
// debit/credit knowledge needed: picking the Revenue (or Expense) account and
// the cash/bank side posts a balanced journal entry, which the Journal
// Entries page, Income Statement and Cash In / Out then all see.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, AlertTriangle, CircleDollarSign, TrendingDown, Search, Eye, Printer, Download } from 'lucide-react';
import { Modal } from '../../components';
import { useNavigate } from 'react-router-dom';
import { useMobile } from '../../hooks/useMobile';
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
    status: string;
    ref: string;
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Shared look of the print windows (voucher and list).
const PRINT_CSS = `
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: #111; margin: 32px; font-size: 13px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .muted { color: #666; }
  .meta { margin: 14px 0 18px; display: grid; grid-template-columns: 110px 1fr; row-gap: 5px; }
  .meta b { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { border: 1px solid #ccc; padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .mono { font-family: monospace; font-size: 11px; white-space: nowrap; }
  tfoot td { font-weight: 700; background: #fafafa; }
  .foot { margin-top: 22px; font-size: 11px; color: #888; }
`;

const StatusChip: React.FC<{ status: string }> = ({ status }) => (
    <span style={{
        fontSize: '11px', fontWeight: 700, padding: '2px 9px', borderRadius: '20px', whiteSpace: 'nowrap',
        color: status === 'Draft' ? '#B45309' : '#047857',
        background: status === 'Draft' ? 'rgba(217, 119, 6, 0.12)' : 'rgba(5, 150, 105, 0.12)',
    }}>{status}</span>
);

const todayYmd = (): string => {
    const d = new Date();
    const p = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const fmt = (n: number): string => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const RevenueExpenseEntryPage: React.FC<{ mode: 'revenue' | 'expense' }> = ({ mode }) => {
    const cfg = CFG[mode];
    const isMobile = useMobile();
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { saveJournalEntry } = useAccounting();
    const navigate = useNavigate();

    const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
    interface RawLine { entryId: string; accountId: string; debit: number; credit: number; date: string; description: string; status: string; ref: string }
    const [lines, setLines] = useState<RawLine[] | null>(null);
    // False once loading falls back because journal_entries.status does not
    // exist yet (migrations/add_entry_status.sql not run on this instance).
    const [statusSupported, setStatusSupported] = useState(true);
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

                const loadPage = (from: number, withStatus: boolean) => supabase
                    .from('journal_entry_lines')
                    .select(`account_id, journal_entry_id, debit, credit, entry:journal_entries!inner(date, description, reference_id${withStatus ? ', status' : ''})`)
                    .order('id', { ascending: true })
                    .range(from, from + 999);

                const all: RawLine[] = [];
                let withStatus = true;
                for (let from = 0; from < 100000; from += 1000) {
                    let { data, error } = await loadPage(from, withStatus);
                    // Instances that haven't run add_entry_status.sql have no
                    // status column — reload without it; everything is Posted.
                    if (error && withStatus && /status/i.test(error.message || '')) {
                        withStatus = false;
                        ({ data, error } = await loadPage(from, withStatus));
                    }
                    if (error) throw error;
                    type Row = { account_id: unknown; journal_entry_id: unknown; debit: unknown; credit: unknown; entry: { date?: unknown; description?: unknown; status?: unknown; reference_id?: unknown } | null };
                    for (const l of (data || []) as Row[]) {
                        all.push({
                            entryId: String(l.journal_entry_id),
                            accountId: String(l.account_id),
                            debit: Number(l.debit) || 0,
                            credit: Number(l.credit) || 0,
                            date: String(l.entry?.date || '').slice(0, 10),
                            description: String(l.entry?.description || ''),
                            status: String(l.entry?.status || 'Posted'),
                            ref: String(l.entry?.reference_id || ''),
                        });
                    }
                    if (!data || data.length < 1000) break;
                }
                if (!alive) return;
                setAccounts(accs || []);
                setLines(all);
                setStatusSupported(withStatus);
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
    const [entryStatus, setEntryStatus] = useState<'Posted' | 'Draft'>('Posted');
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
                { date, description: description.trim() || `${cfg.title}: ${accName}`, reference_id: `${cfg.refPrefix}-${Date.now()}`, status: entryStatus },
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
                status: entryLines[0].status,
                ref: entryLines[0].ref,
            });
        }
        return out.sort((a, b) => b.date.localeCompare(a.date) || b.entryId.localeCompare(a.entryId));
    }, [lines, accountById, cfg.accountType, mode]);

    // The money cards count Posted entries only; drafts aren't final yet.
    const totals = useMemo(() => {
        const month = todayYmd().slice(0, 7);
        const posted = rows.filter(r => r.status !== 'Draft');
        return {
            month: posted.filter(r => r.date.startsWith(month)).reduce((s, r) => s + r.amount, 0),
            all: posted.reduce((s, r) => s + r.amount, 0),
            count: rows.length,
        };
    }, [rows]);

    // ── List filters: search, date range, status ──
    const [search, setSearch] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [statusFilter, setStatusFilter] = useState<'All' | 'Posted' | 'Draft'>('All');
    const filtersActive = !!(search.trim() || dateFrom || dateTo || statusFilter !== 'All');

    const filteredRows = useMemo(() => {
        const q = search.trim().toLowerCase();
        return rows.filter(r =>
            (statusFilter === 'All' || r.status === statusFilter) &&
            (!dateFrom || r.date >= dateFrom) &&
            (!dateTo || r.date <= dateTo) &&
            (!q || r.description.toLowerCase().includes(q) || r.accountName.toLowerCase().includes(q) || r.counterName.toLowerCase().includes(q) || r.ref.toLowerCase().includes(q)));
    }, [rows, search, dateFrom, dateTo, statusFilter]);

    const filteredTotal = useMemo(() => filteredRows.reduce((s, r) => s + r.amount, 0), [filteredRows]);

    // ── View & Print actions ──
    const [viewEntry, setViewEntry] = useState<EntryRow | null>(null);
    const entryLinesOf = (entryId: string): RawLine[] => (lines || []).filter(l => l.entryId === entryId);
    const accountLabelOf = (accountId: string): string => {
        const a = accountById.get(accountId);
        return a ? `${a.account_code} · ${a.account_name}` : '?';
    };

    const openPrintWindow = (title: string, bodyHtml: string) => {
        const w = window.open('', '_blank', 'width=860,height=900');
        if (!w) { showToast('Allow popups to print', 'error'); return; }
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head><body>${bodyHtml}</body></html>`);
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 300);
    };

    // A small printable voucher in its own window, like a receipt.
    const printEntry = (row: EntryRow) => {
        const ls = entryLinesOf(row.entryId);
        const linesHtml = ls.map(l => `
            <tr>
                <td>${escapeHtml(accountLabelOf(l.accountId))}</td>
                <td class="num">${l.debit > 0 ? fmt(l.debit) : ''}</td>
                <td class="num">${l.credit > 0 ? fmt(l.credit) : ''}</td>
            </tr>`).join('');
        const totalDebit = ls.reduce((s, l) => s + l.debit, 0);
        const totalCredit = ls.reduce((s, l) => s + l.credit, 0);
        openPrintWindow(`${cfg.title} Voucher ${row.ref || ''}`, `
  <h1>JBL POS — ${escapeHtml(cfg.title)} Voucher</h1>
  <div class="muted">${escapeHtml(row.ref || row.entryId)}</div>
  <div class="meta">
    <b>Date</b><span>${escapeHtml(row.date)}</span>
    <b>Status</b><span>${escapeHtml(row.status)}</span>
    <b>Description</b><span>${escapeHtml(row.description || '—')}</span>
  </div>
  <table>
    <thead><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
    <tbody>${linesHtml}</tbody>
    <tfoot><tr><td>Total</td><td class="num">${fmt(totalDebit)}</td><td class="num">${fmt(totalCredit)}</td></tr></tfoot>
  </table>
  <div class="foot">Printed ${new Date().toLocaleString()}</div>`);
    };

    // Print the (filtered) list as a report.
    const printList = () => {
        const rowsHtml = filteredRows.map(r => `
            <tr>
                <td>${escapeHtml(r.date)}</td>
                <td class="mono">${escapeHtml(r.ref || '')}</td>
                <td>${escapeHtml(r.description || '')}</td>
                <td>${escapeHtml(r.accountName)}</td>
                <td>${escapeHtml(r.counterName)}</td>
                <td class="num">${fmt(r.amount)}</td>
                <td>${escapeHtml(r.status)}</td>
            </tr>`).join('');
        openPrintWindow(`${cfg.title} Entries`, `
  <h1>JBL POS — ${escapeHtml(cfg.title)} Entries</h1>
  <div class="muted">${filteredRows.length} ${filteredRows.length === 1 ? 'entry' : 'entries'}${filtersActive ? ' (filtered)' : ''} · Printed ${new Date().toLocaleString()}</div>
  <table>
    <thead><tr><th>Date</th><th>Reference</th><th>Description</th><th>${escapeHtml(cfg.accountLabel)}</th><th>${escapeHtml(cfg.counterLabel)}</th><th class="num">Amount</th><th>Status</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot><tr><td colspan="5">Total</td><td class="num">${fmt(filteredTotal)}</td><td></td></tr></tfoot>
  </table>`);
    };

    // Download the (filtered) list as a UTF-8 CSV Excel opens cleanly.
    const exportCsv = () => {
        const cell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const head = ['Date', 'Reference', 'Description', cfg.accountLabel, cfg.counterLabel, 'Amount', 'Status'];
        const body = filteredRows.map(r => [r.date, r.ref, r.description, r.accountName, r.counterName, r.amount.toFixed(2), r.status].map(cell).join(','));
        const blob = new Blob(['﻿' + [head.map(cell).join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${mode}-entries-${todayYmd()}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    // Post a draft entry (one way, like real books).
    const postEntry = async (row: EntryRow) => {
        try {
            const { error } = await supabase.from('journal_entries').update({ status: 'Posted' }).eq('id', row.entryId);
            if (error) throw error;
            showToast('Entry posted', 'success');
            refetch();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Failed to post entry: ' + msg, 'error');
        }
    };

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
                        <div>
                            <label style={labelStyle}>Status</label>
                            <select value={entryStatus} onChange={e => setEntryStatus(e.target.value as 'Posted' | 'Draft')} style={{ ...inputStyle, cursor: 'pointer' }}>
                                <option value="Posted">Posted</option>
                                <option value="Draft">Draft</option>
                            </select>
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
                <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-text-main)' }}>{cfg.title} Entries</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {(() => {
                            const hdrBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 11px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-secondary)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' };
                            const disabled = loading || filteredRows.length === 0;
                            return (
                                <>
                                    <button onClick={printList} disabled={disabled} title="Print the listed entries" style={{ ...hdrBtn, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
                                        <Printer size={13} /> Print List
                                    </button>
                                    <button onClick={exportCsv} disabled={disabled} title="Download the listed entries as CSV" style={{ ...hdrBtn, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
                                        <Download size={13} /> Export CSV
                                    </button>
                                    <button onClick={refetch} title="Reload" style={hdrBtn}>
                                        <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
                                    </button>
                                </>
                            );
                        })()}
                    </span>
                </div>

                {/* Filters: search, date range, status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 18px', borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', flex: '1 1 180px', maxWidth: '300px' }}>
                        <Search size={14} color="var(--color-text-muted)" style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)' }} />
                        <input
                            type="text" className="d2-khmer" placeholder="Search description or account…"
                            value={search} onChange={e => setSearch(e.target.value)}
                            style={{ ...inputStyle, paddingLeft: '32px', boxSizing: 'border-box' }}
                        />
                    </div>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inputStyle, width: 'auto' }} aria-label="From date" />
                    <span style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>to</span>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...inputStyle, width: 'auto' }} aria-label="To date" />
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'All' | 'Posted' | 'Draft')} style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}>
                        <option value="All">All Statuses</option>
                        <option value="Posted">Posted</option>
                        <option value="Draft">Draft</option>
                    </select>
                    {filtersActive && (
                        <button
                            onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); setStatusFilter('All'); }}
                            style={{ ...inputStyle, width: 'auto', cursor: 'pointer', color: 'var(--color-text-secondary)' }}
                        >
                            Clear
                        </button>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                        {loading ? '…' : `${filteredRows.length} of ${rows.length}`}
                    </span>
                </div>

                {!statusSupported && !loading && (
                    <div style={{ padding: '8px 18px', borderBottom: '1px solid var(--color-border)', fontSize: '12px', color: '#B45309', background: 'rgba(217, 119, 6, 0.07)' }}>
                        Draft / Posted statuses need <code>migrations/add_entry_status.sql</code> on this instance — every entry shows as Posted for now.
                    </div>
                )}

                {loading ? (
                    <div style={{ padding: '36px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading entries…</div>
                ) : rows.length === 0 ? (
                    <div style={{ padding: '36px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                        No {mode} entries yet — record the first one above.
                    </div>
                ) : filteredRows.length === 0 ? (
                    <div style={{ padding: '36px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                        No entries match these filters.
                    </div>
                ) : isMobile ? (
                    // Phones: one card per entry — no sideways scrolling.
                    <>
                        {filteredRows.map(r => (
                            <div key={r.entryId} style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{r.date}</span>
                                        {r.ref && <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.ref}</span>}
                                        <StatusChip status={r.status} />
                                    </span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                        <span style={{ fontWeight: 700, color: cfg.color, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.amount)}</span>
                                        <Eye size={15} color="var(--color-text-muted)" style={{ cursor: 'pointer' }} onClick={() => setViewEntry(r)} />
                                        <Printer size={15} color="var(--color-text-muted)" style={{ cursor: 'pointer' }} onClick={() => printEntry(r)} />
                                        <Trash2 size={15} color="var(--color-text-muted)" style={{ cursor: 'pointer' }} onClick={() => handleDelete(r)} />
                                    </span>
                                </div>
                                {r.description && <div className="d2-khmer" style={{ fontSize: '13px', color: 'var(--color-text-main)', margin: '4px 0 2px' }}>{r.description}</div>}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                                    <div className="d2-khmer" style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                        {mode === 'revenue' ? `${r.accountName} → ${r.counterName}` : `${r.accountName} ← ${r.counterName}`}
                                    </div>
                                    {r.status === 'Draft' && statusSupported && (
                                        <button onClick={() => postEntry(r)} style={{ padding: '4px 10px', borderRadius: '7px', border: 'none', background: cfg.color, color: 'white', fontSize: '11px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>Post</button>
                                    )}
                                </div>
                            </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--color-bg)', fontWeight: 800, fontSize: '13px' }}>
                            <span style={{ color: 'var(--color-text-main)' }}>{filtersActive ? 'Total (filtered)' : 'Total'}</span>
                            <span style={{ color: cfg.color, fontVariantNumeric: 'tabular-nums' }}>{fmt(filteredTotal)}</span>
                        </div>
                    </>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '680px' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--color-border)', background: 'var(--color-bg)' }}>
                                    {['Date', 'Reference', 'Description', cfg.accountLabel, cfg.counterLabel, 'Amount', 'Status', 'Actions'].map((h, i) => (
                                        <th key={h || 'x'} style={{ padding: '10px 16px', textAlign: i === 5 ? 'right' : 'left', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)', width: i === 7 ? '110px' : undefined }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRows.map((r, idx) => (
                                    <tr key={r.entryId} style={{ borderBottom: '1px solid var(--color-border)', background: idx % 2 ? 'rgba(0,0,0,0.015)' : 'transparent' }}>
                                        <td style={{ padding: '10px 16px', whiteSpace: 'nowrap', color: 'var(--color-text-secondary)' }}>{r.date}</td>
                                        <td style={{ padding: '10px 16px', whiteSpace: 'nowrap', color: 'var(--color-text-secondary)', fontFamily: 'monospace', fontSize: '12px' }}>{r.ref || '—'}</td>
                                        <td className="d2-khmer" style={{ padding: '10px 16px', color: 'var(--color-text-main)', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>{r.description || '—'}</td>
                                        <td className="d2-khmer" style={{ padding: '10px 16px', color: 'var(--color-text-secondary)' }}>{r.accountName}</td>
                                        <td className="d2-khmer" style={{ padding: '10px 16px', color: 'var(--color-text-secondary)' }}>{r.counterName}</td>
                                        <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: cfg.color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(r.amount)}</td>
                                        <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                                <StatusChip status={r.status} />
                                                {r.status === 'Draft' && statusSupported && (
                                                    <button onClick={() => postEntry(r)} style={{ padding: '3px 10px', borderRadius: '7px', border: 'none', background: cfg.color, color: 'white', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>Post</button>
                                                )}
                                            </span>
                                        </td>
                                        <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '12px' }}>
                                                <Eye size={15} color="var(--color-text-muted)" style={{ cursor: 'pointer' }} onClick={() => setViewEntry(r)} aria-label="View entry" />
                                                <Printer size={15} color="var(--color-text-muted)" style={{ cursor: 'pointer' }} onClick={() => printEntry(r)} aria-label="Print entry" />
                                                <Trash2 size={15} color="var(--color-text-muted)" style={{ cursor: 'pointer' }} onClick={() => handleDelete(r)} aria-label="Delete entry" />
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ borderTop: '2px solid var(--color-border)', background: 'var(--color-bg)', fontWeight: 800 }}>
                                    <td colSpan={5} style={{ padding: '11px 16px', color: 'var(--color-text-main)' }}>{filtersActive ? `Total (filtered · ${filteredRows.length})` : 'Total'}</td>
                                    <td style={{ padding: '11px 16px', textAlign: 'right', color: cfg.color, fontVariantNumeric: 'tabular-nums' }}>{fmt(filteredTotal)}</td>
                                    <td colSpan={2}></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>

            {/* View entry modal */}
            <Modal isOpen={!!viewEntry} onClose={() => setViewEntry(null)} title={`${cfg.title} Entry`}>
                {viewEntry && (() => {
                    const ls = entryLinesOf(viewEntry.entryId);
                    const totalDebit = ls.reduce((s, l) => s + l.debit, 0);
                    const totalCredit = ls.reduce((s, l) => s + l.credit, 0);
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', rowGap: '6px', fontSize: '13px' }}>
                                <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Reference</span>
                                <span style={{ color: 'var(--color-text-main)', fontFamily: 'monospace', fontSize: '12px' }}>{viewEntry.ref || viewEntry.entryId}</span>
                                <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Date</span>
                                <span style={{ color: 'var(--color-text-main)' }}>{viewEntry.date}</span>
                                <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Status</span>
                                <span><StatusChip status={viewEntry.status} /></span>
                                <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Description</span>
                                <span className="d2-khmer" style={{ color: 'var(--color-text-main)' }}>{viewEntry.description || '—'}</span>
                            </div>
                            <div style={{ border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                    <thead>
                                        <tr style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
                                            <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>Account</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)', width: '100px' }}>Debit</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)', width: '100px' }}>Credit</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ls.map((l, i) => (
                                            <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                <td className="d2-khmer" style={{ padding: '8px 12px', color: 'var(--color-text-main)' }}>{accountLabelOf(l.accountId)}</td>
                                                <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: l.debit > 0 ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>{l.debit > 0 ? fmt(l.debit) : '—'}</td>
                                                <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: l.credit > 0 ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>{l.credit > 0 ? fmt(l.credit) : '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr style={{ background: 'var(--color-bg)', fontWeight: 700 }}>
                                            <td style={{ padding: '8px 12px', color: 'var(--color-text-main)' }}>Total</td>
                                            <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-main)' }}>{fmt(totalDebit)}</td>
                                            <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-main)' }}>{fmt(totalCredit)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                                <button
                                    onClick={() => printEntry(viewEntry)}
                                    style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 16px', borderRadius: '8px', border: 'none', background: cfg.color, color: 'white', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                                >
                                    <Printer size={15} /> Print
                                </button>
                                <button
                                    onClick={() => setViewEntry(null)}
                                    style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    );
                })()}
            </Modal>

            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default RevenueExpenseEntryPage;
