// Standalone monthly/quarterly/annual Balance Sheet: cumulative account
// balances struck at each period end across a year, grouped the way the
// chart of accounts is laid out (a short "parent" code like 100/150/200
// followed by its longer child codes). This is deliberately a separate,
// self-contained ledger read from FinancialStatements.tsx's single as-at-date
// Balance Sheet (same DEBIT_NORMAL/signed-balance math, re-implemented here
// for isolation) — that page keeps the old snapshot design under Financial
// Reports; this one is what /accounting/balance-sheet now renders.
//
// Grouping uses account_code ranges, not the chart's sub_type field: sub_type
// is only set on about half the accounts, and the short parent codes already
// give every account a reliable Current/Fixed-style bucket.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Printer, Download, RefreshCw } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useMobile } from '../../hooks/useMobile';
import { supabase } from '../../lib/supabase';
import type { ChartOfAccount } from '../../types';

type AccountType = ChartOfAccount['account_type'];
type Granularity = 'monthly' | 'quarterly' | 'annual';
interface LedgerLine { accountId: string; debit: number; credit: number; date: string }
interface AccountGroup { label: string | null; accounts: ChartOfAccount[] }
interface PeriodColumn { key: string; label: string; endYmd: string }
interface ReportRow { kind: 'section' | 'group' | 'account' | 'subtotal' | 'total'; cells: (string | number)[] }

const DEBIT_NORMAL = (t: AccountType): boolean => t === 'Asset' || t === 'Expense';
const fmt = (n: number): string => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cellText = (n: number): string => (Math.abs(n) < 0.005 ? '—' : fmt(n));
const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pad2 = (x: number): string => String(x).padStart(2, '0');
const monthEndYmd = (year: number, monthIndex0: number): string => {
    const d = new Date(year, monthIndex0 + 1, 0);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GRANULARITY_LABEL: Record<Granularity, string> = { monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual' };

const BLUE = '#3B82F6', RED = '#EF4444', PURPLE = '#8B5CF6';
const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };
const btnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px',
    border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-main)',
    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
};
const selectStyle: React.CSSProperties = {
    padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)',
    background: 'var(--color-bg)', color: 'var(--color-text-main)', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
};

// Parent rows are the chart's own category markers (a short code like "100",
// "150"); every longer code is bucketed under the nearest parent whose
// code*10 it's at or above. A type with no parent rows (e.g. Equity, which
// is usually just one flat account) renders as a single ungrouped list.
function buildGroups(accounts: ChartOfAccount[], type: AccountType): AccountGroup[] {
    const sameType = accounts.filter(a => a.account_type === type && a.is_active !== false);
    const isParent = (a: ChartOfAccount) => a.account_code.length <= 3 && /^\d+$/.test(a.account_code);
    const parents = sameType.filter(isParent)
        .map(a => ({ account: a, num: parseInt(a.account_code, 10) }))
        .sort((a, b) => a.num - b.num);
    const leaves = sameType.filter(a => !isParent(a));
    if (parents.length === 0) return [{ label: null, accounts: leaves }];

    const groups = parents.map(p => ({ label: p.account.account_name, num: p.num, accounts: [] as ChartOfAccount[] }));
    const orphans: ChartOfAccount[] = [];
    for (const a of leaves) {
        const n = parseInt(a.account_code, 10);
        const group = Number.isNaN(n) ? undefined : [...groups].reverse().find(g => n >= g.num * 10);
        (group ? group.accounts : orphans).push(a);
    }
    const result: AccountGroup[] = groups.filter(g => g.accounts.length > 0).map(g => ({ label: g.label, accounts: g.accounts }));
    if (orphans.length) result.push({ label: 'Other', accounts: orphans });
    return result;
}

function signedBalancesAsOf(lines: LedgerLine[], accounts: ChartOfAccount[], cutoffYmd: string): Map<string, number> {
    const raw = new Map<string, { d: number; c: number }>();
    for (const l of lines) {
        if (l.date > cutoffYmd) continue;
        const s = raw.get(l.accountId) || { d: 0, c: 0 };
        s.d += l.debit; s.c += l.credit;
        raw.set(l.accountId, s);
    }
    const out = new Map<string, number>();
    for (const a of accounts) {
        const s = raw.get(a.id);
        if (s) out.set(a.id, DEBIT_NORMAL(a.account_type) ? s.d - s.c : s.c - s.d);
    }
    return out;
}

function earningsOf(accounts: ChartOfAccount[], bal: Map<string, number>): number {
    let e = 0;
    for (const a of accounts) {
        if (a.account_type === 'Revenue') e += bal.get(a.id) || 0;
        if (a.account_type === 'Expense') e -= bal.get(a.id) || 0;
    }
    return e;
}

const BalanceSheetPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();
    const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
    const [lines, setLines] = useState<LedgerLine[] | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [granularity, setGranularity] = useState<Granularity>('monthly');
    const [year, setYear] = useState<number>(() => new Date().getFullYear());
    const [compare, setCompare] = useState(false);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Balance Sheet — {GRANULARITY_LABEL[granularity]}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0 }}>Cumulative account balances at each period end</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, granularity]);

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
                    .select(`account_id, debit, credit, entry:journal_entries!inner(date${withStatus ? ', status' : ''})`)
                    .order('id', { ascending: true })
                    .range(from, from + 999);

                const all: LedgerLine[] = [];
                let withStatus = true;
                for (let from = 0; from < 100000; from += 1000) {
                    let { data, error } = await loadPage(from, withStatus);
                    if (error && withStatus && /status/i.test(error.message || '')) {
                        withStatus = false;
                        ({ data, error } = await loadPage(from, withStatus));
                    }
                    if (error) throw error;
                    type LineRow = { account_id: unknown; debit: unknown; credit: unknown; entry: { date?: unknown; status?: unknown } | null };
                    for (const l of (data || []) as LineRow[]) {
                        if (String(l.entry?.status || 'Posted') === 'Draft') continue;
                        all.push({
                            accountId: String(l.account_id),
                            debit: Number(l.debit) || 0,
                            credit: Number(l.credit) || 0,
                            date: String(l.entry?.date || '').slice(0, 10),
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

    const loading = lines === null;

    const years = useMemo(() => {
        const current = new Date().getFullYear();
        const set = new Set<number>([current]);
        for (const l of lines || []) {
            const y = parseInt(l.date.slice(0, 4), 10);
            if (!Number.isNaN(y)) set.add(y);
        }
        return Array.from(set).sort((a, b) => b - a);
    }, [lines]);

    const columns = useMemo<PeriodColumn[]>(() => {
        const cols: PeriodColumn[] = [];
        if (granularity === 'monthly') {
            for (let m = 0; m < 12; m++) cols.push({ key: `m${m}`, label: MONTH_LABELS[m], endYmd: monthEndYmd(year, m) });
        } else if (granularity === 'quarterly') {
            [2, 5, 8, 11].forEach((m, i) => cols.push({ key: `q${i}`, label: `Q${i + 1}`, endYmd: monthEndYmd(year, m) }));
        } else {
            cols.push({ key: 'y', label: String(year), endYmd: monthEndYmd(year, 11) });
        }
        cols.push({ key: 'ytd', label: 'YTD', endYmd: monthEndYmd(year, 11) });
        if (compare) cols.push({ key: 'ytd-prev', label: `YTD ${year - 1}`, endYmd: monthEndYmd(year - 1, 11) });
        return cols;
    }, [granularity, year, compare]);

    const balancesByColumn = useMemo(() => {
        const src = lines || [];
        return columns.map(col => signedBalancesAsOf(src, accounts, col.endYmd));
    }, [columns, lines, accounts]);

    const assetGroups = useMemo(() => buildGroups(accounts, 'Asset'), [accounts]);
    const liabilityGroups = useMemo(() => buildGroups(accounts, 'Liability'), [accounts]);
    const equityGroups = useMemo(() => buildGroups(accounts, 'Equity'), [accounts]);

    const valueOf = useCallback((accountId: string, colIndex: number) => balancesByColumn[colIndex]?.get(accountId) || 0, [balancesByColumn]);
    const groupTotal = useCallback((group: AccountGroup, colIndex: number) => group.accounts.reduce((s, a) => s + valueOf(a.id, colIndex), 0), [valueOf]);
    const typeTotal = useCallback((groups: AccountGroup[], colIndex: number) => groups.reduce((s, g) => s + groupTotal(g, colIndex), 0), [groupTotal]);
    const retainedEarningsAt = useCallback((colIndex: number) => earningsOf(accounts, balancesByColumn[colIndex] || new Map()), [accounts, balancesByColumn]);
    const equityTotal = useCallback((colIndex: number) => typeTotal(equityGroups, colIndex) + retainedEarningsAt(colIndex), [typeTotal, equityGroups, retainedEarningsAt]);

    const reportRows = useMemo((): ReportRow[] => {
        const rows: ReportRow[] = [];
        const emitSection = (label: string) => rows.push({ kind: 'section', cells: ['', label, ...columns.map(() => '')] });
        const emitGroups = (groups: AccountGroup[]) => {
            for (const g of groups) {
                if (g.label) rows.push({ kind: 'group', cells: ['', g.label.toUpperCase(), ...columns.map(() => '')] });
                for (const a of g.accounts) rows.push({ kind: 'account', cells: [a.account_code, a.account_name, ...columns.map((_, i) => valueOf(a.id, i))] });
                if (g.label) rows.push({ kind: 'subtotal', cells: ['', `Total ${g.label}`, ...columns.map((_, i) => groupTotal(g, i))] });
            }
        };

        emitSection('ASSETS');
        emitGroups(assetGroups);
        rows.push({ kind: 'total', cells: ['', 'Total Assets', ...columns.map((_, i) => typeTotal(assetGroups, i))] });

        emitSection('LIABILITIES');
        emitGroups(liabilityGroups);
        rows.push({ kind: 'total', cells: ['', 'Total Liabilities', ...columns.map((_, i) => typeTotal(liabilityGroups, i))] });

        emitSection('EQUITY');
        emitGroups(equityGroups);
        rows.push({ kind: 'account', cells: ['', 'Retained Earnings (to date)', ...columns.map((_, i) => retainedEarningsAt(i))] });
        rows.push({ kind: 'total', cells: ['', 'Total Equity', ...columns.map((_, i) => equityTotal(i))] });

        rows.push({ kind: 'total', cells: ['', 'Total Liabilities & Equity', ...columns.map((_, i) => typeTotal(liabilityGroups, i) + equityTotal(i))] });
        return rows;
    }, [columns, assetGroups, liabilityGroups, equityGroups, valueOf, groupTotal, typeTotal, retainedEarningsAt, equityTotal]);

    const header = useMemo(() => ['Account', ...columns.map(c => c.label)], [columns]);

    const exportCsv = () => {
        const csvHeader = ['Code', 'Account', ...columns.map(c => c.label)];
        const csvRows = reportRows.map(r => r.cells.map(c => (typeof c === 'number' ? cellText(c) : c)));
        const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const csv = [csvHeader, ...csvRows].map(r => r.map(esc).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `balance-sheet-${granularity}-${year}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const printReport = () => {
        const w = window.open('', '_blank', 'width=1100,height=750');
        if (!w) return;
        const body = reportRows.map(r => {
            if (r.kind === 'section') {
                return `<tr><td colspan="${header.length}" style="padding:10px 6px 4px;font-weight:800;text-transform:uppercase;font-size:11px;color:#475569">${escapeHtml(String(r.cells[1]))}</td></tr>`;
            }
            if (r.kind === 'group') {
                return `<tr><td colspan="${header.length}" style="padding:6px 6px 2px;font-weight:700;text-transform:uppercase;font-size:10px;color:#64748b">${escapeHtml(String(r.cells[1]))}</td></tr>`;
            }
            const bold = r.kind === 'subtotal' || r.kind === 'total';
            const cellsHtml = [r.cells[1], ...r.cells.slice(2)].map((c, i) => {
                const text = typeof c === 'number' ? cellText(c) : String(c);
                return `<td style="text-align:${i === 0 ? 'left' : 'right'};font-weight:${bold ? 700 : 400}">${escapeHtml(text)}</td>`;
            }).join('');
            return `<tr style="border-top:${r.kind === 'total' ? '2px solid #cbd5e1' : 'none'}">${cellsHtml}</tr>`;
        }).join('');
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Balance Sheet</title><style>
            body{font-family:Segoe UI,Arial,sans-serif;color:#1a1f36;padding:28px}
            h1{font-size:20px;margin:0}p{color:#64748b;margin:4px 0 20px;font-size:13px}
            table{width:100%;border-collapse:collapse;font-size:11px}
            th{font-size:10px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #cbd5e1;padding:6px;text-align:right}
            td{padding:5px 6px;border-bottom:1px solid #e2e8f0;font-variant-numeric:tabular-nums}
        </style></head><body><h1>Balance Sheet — ${GRANULARITY_LABEL[granularity]}</h1><p>${year} · All figures are in USD.</p>
        <table><thead><tr>${header.map((c, i) => `<th style="text-align:${i === 0 ? 'left' : 'right'}">${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></body></html>`);
        w.document.close();
        w.focus();
        w.print();
    };

    return (
        <div style={isMobile ? { display: 'flex', flexDirection: 'column', gap: '20px' } : { display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
            <div className="acct-page" style={{ display: 'flex', flexDirection: 'column', gap: '18px', flex: isMobile ? undefined : '8 1 0', minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: 'var(--color-text-main)', cursor: 'pointer', userSelect: 'none' }}>
                        <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} style={{ accentColor: BLUE, cursor: 'pointer' }} />
                        Compare with previous period
                    </label>
                    <select value={granularity} onChange={e => setGranularity(e.target.value as Granularity)} style={selectStyle}>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="annual">Annual</option>
                    </select>
                    <select value={year} onChange={e => setYear(Number(e.target.value))} style={selectStyle}>
                        {years.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <button onClick={printReport} disabled={loading} style={{ ...btnStyle, opacity: loading ? 0.5 : 1 }}><Printer size={14} /> Print / PDF</button>
                    <button onClick={exportCsv} disabled={loading} style={{ ...btnStyle, opacity: loading ? 0.5 : 1 }}><Download size={14} /> CSV</button>
                    <button onClick={() => setRefreshKey(k => k + 1)} title="Reload the ledger" style={{ ...btnStyle, padding: '7px 10px' }}>
                        <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
                    </button>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>All figures are in USD.</div>

                <div style={{ ...cardStyle, overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>Account</th>
                                {columns.map(c => (
                                    <th key={c.key} style={{ textAlign: 'right', padding: '10px 14px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', background: c.key.startsWith('ytd') ? 'var(--color-bg)' : undefined, fontWeight: c.key.startsWith('ytd') ? 700 : 500, whiteSpace: 'nowrap' }}>{c.label}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={columns.length + 1} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading the ledger…</td></tr>
                            ) : reportRows.map((r, idx) => {
                                if (r.kind === 'section') {
                                    const color = r.cells[1] === 'ASSETS' ? BLUE : r.cells[1] === 'LIABILITIES' ? RED : PURPLE;
                                    return (
                                        <tr key={idx}>
                                            <td colSpan={columns.length + 1} style={{ padding: '16px 16px 6px', fontSize: '12px', fontWeight: 800, letterSpacing: '0.6px', color, background: 'var(--color-bg)' }}>{r.cells[1]}</td>
                                        </tr>
                                    );
                                }
                                if (r.kind === 'group') {
                                    return (
                                        <tr key={idx}>
                                            <td colSpan={columns.length + 1} style={{ padding: '8px 16px 4px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{r.cells[1]}</td>
                                        </tr>
                                    );
                                }
                                const isTotal = r.kind === 'subtotal' || r.kind === 'total';
                                return (
                                    <tr key={idx} style={{ borderTop: r.kind === 'total' ? '2px solid var(--color-border)' : r.kind === 'subtotal' ? '1px solid var(--color-border)' : 'none', background: r.kind === 'total' ? 'var(--color-bg)' : undefined }}>
                                        <td style={{ padding: '7px 16px', paddingLeft: r.kind === 'account' ? '28px' : '16px', fontWeight: isTotal ? 700 : 400, whiteSpace: 'nowrap' }}>
                                            {r.kind === 'account' && r.cells[0] ? <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginRight: '8px' }}>{r.cells[0]}</span> : null}
                                            <span style={{ color: 'var(--color-text-main)' }}>{r.cells[1]}</span>
                                        </td>
                                        {columns.map((c, i) => {
                                            const raw = r.cells[2 + i];
                                            if (typeof raw !== 'number') return <td key={c.key} />;
                                            return (
                                                <td key={c.key} style={{ padding: '7px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: isTotal ? 700 : 400, color: raw < -0.005 ? RED : 'var(--color-text-main)', background: c.key.startsWith('ytd') ? 'var(--color-bg)' : undefined }}>
                                                    {cellText(raw)}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Reserved for future widgets — intentionally empty, and left
                out entirely on mobile since there's nothing in it to show. */}
            {!isMobile && (
                <>
                    <div style={{ flex: '1 1 0' }} />
                    <div style={{ flex: '1 1 0' }} />
                </>
            )}
        </div>
    );
};

export default BalanceSheetPage;
