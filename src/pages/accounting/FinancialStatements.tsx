// Financial statements driven by the double-entry ledger (chart_of_accounts +
// journal_entry_lines): Balance Sheet, Income Statement, Cash Flow and Trial
// Balance. The Balance Sheet and Trial Balance are struck AT the end date;
// the Income Statement and Cash Flow cover the start→end range.
//
// Shared by the Reports-center Financials tab (dates from the reports layout)
// and the standalone /accounting pages (FinancialReportsPage, with its own
// From / As-at pickers).
import React, { useState, useEffect, useMemo } from 'react';
import { Scale, TrendingUp, ArrowDownUp, ClipboardList, CheckCircle2, AlertTriangle, Printer, Download, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { ChartOfAccount } from '../../types';

type AccountType = ChartOfAccount['account_type'];
interface LedgerLine { accountId: string; entryId: string; debit: number; credit: number; date: string }

const DEBIT_NORMAL = (t: AccountType): boolean => t === 'Asset' || t === 'Expense';
const fmt = (n: number): string => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const displayDate = (ymd: string): string => {
    if (!ymd) return '—';
    const [y, m, d] = ymd.split('-');
    return `${d}/${m}/${y}`;
};
const shiftYears = (ymd: string, delta: number): string => {
    const d = new Date(ymd + 'T00:00:00');
    d.setFullYear(d.getFullYear() + delta);
    const p = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TABS = [
    { key: 'balance', label: 'Balance Sheet', icon: Scale },
    { key: 'income', label: 'Income Statement', icon: TrendingUp },
    { key: 'cashflow', label: 'Cash Flow', icon: ArrowDownUp },
    { key: 'trial', label: 'Trial Balance', icon: ClipboardList },
] as const;
export type TabKey = typeof TABS[number]['key'];

const BLUE = '#3B82F6', RED = '#EF4444', PURPLE = '#8B5CF6', GREEN = '#10B981', AMBER = '#F59E0B';

interface StatementRow { code: string; name: string; amount: number; prev?: number }

export interface FinancialStatementsProps {
    startDate: string;
    endDate: string;
    /** Open on this statement; the sidebar's per-statement pages set it. */
    initialTab?: TabKey;
}

const FinancialStatements: React.FC<FinancialStatementsProps> = ({ startDate, endDate, initialTab }) => {
    const [tab, setTab] = useState<TabKey>(initialTab || 'balance');
    const [compare, setCompare] = useState(false);

    // Navigating between the per-statement sidebar pages changes only the prop
    // (the component is not remounted), so follow it.
    useEffect(() => {
        if (initialTab) setTab(initialTab);
    }, [initialTab]);

    const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
    const [lines, setLines] = useState<LedgerLine[] | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        let alive = true;
        setLines(null);
        (async () => {
            try {
                const { data: accs, error: accErr } = await supabase
                    .from('chart_of_accounts').select('*').order('account_code', { ascending: true });
                if (accErr) throw accErr;

                const all: LedgerLine[] = [];
                for (let from = 0; from < 100000; from += 1000) {
                    const { data, error } = await supabase
                        .from('journal_entry_lines')
                        .select('account_id, journal_entry_id, debit, credit, entry:journal_entries!inner(date)')
                        .order('id', { ascending: true })
                        .range(from, from + 999);
                    if (error) throw error;
                    type LineRow = { account_id: unknown; journal_entry_id: unknown; debit: unknown; credit: unknown; entry: { date?: unknown } | null };
                    for (const l of (data || []) as LineRow[]) {
                        all.push({
                            accountId: String(l.account_id),
                            entryId: String(l.journal_entry_id),
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

    // Signed balance per account over the lines that pass `keep`.
    const signedBalances = useMemo(() => {
        return (keep: (l: LedgerLine) => boolean): Map<string, number> => {
            const raw = new Map<string, { d: number; c: number }>();
            for (const l of lines || []) {
                if (!keep(l)) continue;
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
        };
    }, [lines, accounts]);

    const rowsOfType = (type: AccountType, bal: Map<string, number>, prev?: Map<string, number>): StatementRow[] =>
        accounts
            .filter(a => a.account_type === type)
            .filter(a => a.is_active || (bal.get(a.id) || 0) !== 0 || (prev?.get(a.id) || 0) !== 0)
            .map(a => ({ code: a.account_code, name: a.account_name, amount: bal.get(a.id) || 0, ...(prev ? { prev: prev.get(a.id) || 0 } : {}) }));

    const sumOf = (rows: StatementRow[]) => rows.reduce((s, r) => s + r.amount, 0);
    const sumPrev = (rows: StatementRow[]) => rows.reduce((s, r) => s + (r.prev || 0), 0);

    // ── Balance Sheet (as at endDate; Equity absorbs Revenue − Expenses to date) ──
    const balanceSheet = useMemo(() => {
        const at = signedBalances(l => l.date <= endDate);
        const prevAt = compare ? signedBalances(l => l.date <= shiftYears(endDate, -1)) : undefined;
        const earningsOf = (m: Map<string, number>) => {
            let e = 0;
            for (const a of accounts) {
                if (a.account_type === 'Revenue') e += m.get(a.id) || 0;
                if (a.account_type === 'Expense') e -= m.get(a.id) || 0;
            }
            return e;
        };
        const assets = rowsOfType('Asset', at, prevAt);
        const liabilities = rowsOfType('Liability', at, prevAt);
        const equityAccounts = rowsOfType('Equity', at, prevAt);
        const equity: StatementRow[] = [
            ...equityAccounts,
            { code: '', name: 'Retained Earnings (to date)', amount: earningsOf(at), ...(prevAt ? { prev: earningsOf(prevAt) } : {}) },
        ];
        const totals = { assets: sumOf(assets), liabilities: sumOf(liabilities), equity: sumOf(equity) };
        return {
            assets, liabilities, equity, totals,
            prevTotals: prevAt ? { assets: sumPrev(assets), liabilities: sumPrev(liabilities), equity: sumPrev(equity) } : null,
            balanced: Math.abs(totals.assets - (totals.liabilities + totals.equity)) < 0.005,
            gap: totals.assets - (totals.liabilities + totals.equity),
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signedBalances, accounts, endDate, compare]);

    // ── Income Statement (startDate → endDate) ──
    const incomeStatement = useMemo(() => {
        const inRange = signedBalances(l => l.date >= startDate && l.date <= endDate);
        const prevRange = compare
            ? signedBalances(l => l.date >= shiftYears(startDate, -1) && l.date <= shiftYears(endDate, -1))
            : undefined;
        const revenue = rowsOfType('Revenue', inRange, prevRange);
        const expenses = rowsOfType('Expense', inRange, prevRange);
        return {
            revenue, expenses,
            totals: { revenue: sumOf(revenue), expenses: sumOf(expenses), net: sumOf(revenue) - sumOf(expenses) },
            prevTotals: prevRange ? { revenue: sumPrev(revenue), expenses: sumPrev(expenses), net: sumPrev(revenue) - sumPrev(expenses) } : null,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signedBalances, accounts, startDate, endDate, compare]);

    // ── Cash Flow (startDate → endDate): cash accounts = Asset accounts whose name
    // mentions cash/bank; each entry's cash delta is attributed to its other lines. ──
    const cashFlow = useMemo(() => {
        const cashIds = new Set(accounts.filter(a => a.account_type === 'Asset' && /cash|bank/i.test(a.account_name)).map(a => a.id));
        const nameOf = new Map(accounts.map(a => [a.id, `${a.account_code} · ${a.account_name}`]));
        let opening = 0;
        const byEntry = new Map<string, LedgerLine[]>();
        for (const l of lines || []) {
            if (cashIds.has(l.accountId) && l.date < startDate) opening += l.debit - l.credit;
            if (l.date >= startDate && l.date <= endDate) {
                const arr = byEntry.get(l.entryId);
                if (arr) arr.push(l); else byEntry.set(l.entryId, [l]);
            }
        }
        const flows = new Map<string, number>();
        let net = 0;
        for (const entryLines of byEntry.values()) {
            const delta = entryLines.filter(l => cashIds.has(l.accountId)).reduce((s, l) => s + l.debit - l.credit, 0);
            if (Math.abs(delta) < 0.0005) continue;
            net += delta;
            const counters = entryLines.filter(l => !cashIds.has(l.accountId));
            const weight = counters.reduce((s, l) => s + Math.abs(l.debit - l.credit), 0);
            if (counters.length === 0 || weight === 0) {
                flows.set('Cash-to-cash transfer', (flows.get('Cash-to-cash transfer') || 0) + delta);
                continue;
            }
            for (const c of counters) {
                const key = nameOf.get(c.accountId) || '(Deleted account)';
                const share = delta * (Math.abs(c.debit - c.credit) / weight);
                flows.set(key, (flows.get(key) || 0) + share);
            }
        }
        const rows = Array.from(flows.entries()).map(([name, amount]) => ({ name, amount }))
            .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
        return { hasCash: cashIds.size > 0, opening, rows, net, closing: opening + net };
    }, [accounts, lines, startDate, endDate]);

    // ── Trial Balance (as at endDate, raw debit/credit sides) ──
    const trialBalance = useMemo(() => {
        const raw = new Map<string, { d: number; c: number }>();
        for (const l of lines || []) {
            if (l.date > endDate) continue;
            const s = raw.get(l.accountId) || { d: 0, c: 0 };
            s.d += l.debit; s.c += l.credit;
            raw.set(l.accountId, s);
        }
        const rows = accounts.map(a => {
            const s = raw.get(a.id);
            const net = s ? s.d - s.c : 0;
            return { code: a.account_code, name: a.account_name, type: a.account_type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
        });
        const totals = { debit: rows.reduce((s, r) => s + r.debit, 0), credit: rows.reduce((s, r) => s + r.credit, 0) };
        return { rows, totals, balanced: Math.abs(totals.debit - totals.credit) < 0.005 };
    }, [accounts, lines, endDate]);

    const loading = lines === null;
    const prevEnd = shiftYears(endDate, -1);

    // ── Export / print: one flat table per tab, shared by CSV and Print/PDF ──
    const activeTable = (): { name: string; period: string; columns: string[]; rows: (string | number)[][] } => {
        const money = (n: number) => fmt(n);
        if (tab === 'balance') {
            const section = (label: string, rows: StatementRow[], total: number) => [
                ...rows.map(r => [r.code, `${label}: ${r.name}`, money(r.amount), ...(compare ? [money(r.prev || 0)] : [])]),
                ['', `Total ${label}`, money(total), ...(compare ? [''] : [])],
            ];
            return {
                name: 'Balance Sheet', period: `As at ${displayDate(endDate)}`,
                columns: ['Code', 'Account', `As at ${displayDate(endDate)}`, ...(compare ? [`As at ${displayDate(prevEnd)}`] : [])],
                rows: [
                    ...section('Assets', balanceSheet.assets, balanceSheet.totals.assets),
                    ...section('Liabilities', balanceSheet.liabilities, balanceSheet.totals.liabilities),
                    ...section('Equity', balanceSheet.equity, balanceSheet.totals.equity),
                ],
            };
        }
        if (tab === 'income') {
            const section = (label: string, rows: StatementRow[], total: number) => [
                ...rows.map(r => [r.code, `${label}: ${r.name}`, money(r.amount), ...(compare ? [money(r.prev || 0)] : [])]),
                ['', `Total ${label}`, money(total), ...(compare ? [''] : [])],
            ];
            return {
                name: 'Income Statement', period: `${displayDate(startDate)} – ${displayDate(endDate)}`,
                columns: ['Code', 'Account', 'This period', ...(compare ? ['Previous year'] : [])],
                rows: [
                    ...section('Revenue', incomeStatement.revenue, incomeStatement.totals.revenue),
                    ...section('Expenses', incomeStatement.expenses, incomeStatement.totals.expenses),
                    ['', 'Net Income', money(incomeStatement.totals.net), ...(compare ? [money(incomeStatement.prevTotals?.net || 0)] : [])],
                ],
            };
        }
        if (tab === 'cashflow') {
            return {
                name: 'Cash Flow', period: `${displayDate(startDate)} – ${displayDate(endDate)}`,
                columns: ['Line', 'Amount'],
                rows: [
                    ['Opening cash', money(cashFlow.opening)],
                    ...cashFlow.rows.map(r => [r.name, money(r.amount)]),
                    ['Net change in cash', money(cashFlow.net)],
                    ['Closing cash', money(cashFlow.closing)],
                ],
            };
        }
        return {
            name: 'Trial Balance', period: `As at ${displayDate(endDate)}`,
            columns: ['Code', 'Account', 'Debit', 'Credit'],
            rows: [
                ...trialBalance.rows.map(r => [r.code, r.name, r.debit ? money(r.debit) : '', r.credit ? money(r.credit) : '']),
                ['', 'Total', money(trialBalance.totals.debit), money(trialBalance.totals.credit)],
            ],
        };
    };

    const exportCsv = () => {
        const t = activeTable();
        const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const csv = [t.columns, ...t.rows].map(r => r.map(esc).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${t.name.toLowerCase().replace(/ /g, '-')}-${endDate}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const printReport = () => {
        const t = activeTable();
        const w = window.open('', '_blank', 'width=900,height=700');
        if (!w) return;
        const numericCols = tab === 'trial' ? 2 : compare ? 2 : 1;
        const body = t.rows.map(r =>
            `<tr>${r.map((c, i) => `<td style="text-align:${i >= t.columns.length - numericCols ? 'right' : 'left'}">${escapeHtml(String(c))}</td>`).join('')}</tr>`
        ).join('');
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${t.name}</title><style>
            body{font-family:Segoe UI,Arial,sans-serif;color:#1a1f36;padding:28px}
            h1{font-size:20px;margin:0}p{color:#64748b;margin:4px 0 20px;font-size:13px}
            table{width:100%;border-collapse:collapse;font-size:13px}
            th{font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #cbd5e1;padding:8px;text-align:left}
            td{padding:7px 8px;border-bottom:1px solid #e2e8f0;font-variant-numeric:tabular-nums}
        </style></head><body><h1>${t.name}</h1><p>${t.period} · All figures are in USD.</p>
        <table><thead><tr>${t.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></body></html>`);
        w.document.close();
        w.focus();
        w.print();
    };

    // ── UI building blocks ──
    const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };

    const amountText = (n: number, bold = false): React.ReactNode => (
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: bold ? 700 : 500, color: n < 0 ? RED : 'var(--color-text-main)' }}>
            {loading ? '…' : fmt(n)}
        </span>
    );

    const TotalCard: React.FC<{ label: string; value: number; prev?: number | null; color: string }> = ({ label, value, prev, color }) => (
        <div style={{ ...cardStyle, padding: '16px 20px' }}>
            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: '26px', fontWeight: 800, color, marginTop: '6px', fontVariantNumeric: 'tabular-nums' }}>{loading ? '…' : fmt(value)}</div>
            {compare && prev !== undefined && prev !== null && (
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>Previous year: {fmt(prev)}</div>
            )}
        </div>
    );

    const SectionCard: React.FC<{ title: string; color: string; rows: StatementRow[]; totalLabel: string; total: number; prevTotal?: number }> =
        ({ title, color, rows, totalLabel, total, prevTotal }) => (
            <div style={{ ...cardStyle, borderLeft: `4px solid ${color}`, overflow: 'hidden' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '0.8px', textTransform: 'uppercase', color }}>{title}</span>
                    {compare && <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>current · previous year</span>}
                </div>
                {rows.length === 0 ? (
                    <div style={{ padding: '18px 20px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>No accounts of this type.</div>
                ) : rows.map((r, i) => (
                    <div key={`${r.code}|${r.name}`} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 20px', borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--color-border)', fontSize: '14px' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--color-text-secondary)', width: '44px', flexShrink: 0 }}>{r.code}</span>
                        <span className="d2-khmer" style={{ flex: 1, color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</span>
                        {compare && <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)', fontSize: '13px' }}>{loading ? '…' : fmt(r.prev || 0)}</span>}
                        {amountText(r.amount)}
                    </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '12px 20px', borderTop: '2px solid var(--color-border)', background: 'var(--color-bg)', fontSize: '14px', fontWeight: 700 }}>
                    <span style={{ color: 'var(--color-text-main)' }}>{totalLabel}</span>
                    <span style={{ display: 'flex', gap: '16px', alignItems: 'baseline' }}>
                        {compare && prevTotal !== undefined && <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)', fontWeight: 500, fontSize: '13px' }}>{loading ? '…' : fmt(prevTotal)}</span>}
                        {amountText(total, true)}
                    </span>
                </div>
            </div>
        );

    // Banner message per tab: the integrity check that statement must satisfy.
    const banner = (() => {
        if (tab === 'balance') return balanceSheet.balanced
            ? { ok: true, title: 'Accounting Equation Balanced', sub: 'Assets = Liabilities + Equity' }
            : { ok: false, title: `Accounting Equation Off by ${fmt(balanceSheet.gap)}`, sub: 'Assets ≠ Liabilities + Equity — check the journal entries' };
        if (tab === 'trial') return trialBalance.balanced
            ? { ok: true, title: 'Trial Balance Balanced', sub: 'Total debits equal total credits' }
            : { ok: false, title: `Trial Balance Off by ${fmt(trialBalance.totals.debit - trialBalance.totals.credit)}`, sub: 'Total debits do not equal total credits' };
        if (tab === 'income') return {
            ok: incomeStatement.totals.net >= 0,
            title: `${incomeStatement.totals.net >= 0 ? 'Net Income' : 'Net Loss'}: ${fmt(Math.abs(incomeStatement.totals.net))}`,
            sub: 'Revenue − Expenses for the selected period',
        };
        return {
            ok: cashFlow.net >= 0,
            title: `Net Cash Change: ${fmt(cashFlow.net)}`,
            sub: cashFlow.hasCash ? 'Across accounts named cash or bank' : 'No cash accounts found (name containing cash or bank)',
        };
    })();

    const totalCards = (() => {
        if (tab === 'balance') return [
            { label: 'Total Assets', value: balanceSheet.totals.assets, prev: balanceSheet.prevTotals?.assets ?? null, color: BLUE },
            { label: 'Total Liabilities', value: balanceSheet.totals.liabilities, prev: balanceSheet.prevTotals?.liabilities ?? null, color: RED },
            { label: 'Total Equity', value: balanceSheet.totals.equity, prev: balanceSheet.prevTotals?.equity ?? null, color: PURPLE },
        ];
        if (tab === 'income') return [
            { label: 'Total Revenue', value: incomeStatement.totals.revenue, prev: incomeStatement.prevTotals?.revenue ?? null, color: GREEN },
            { label: 'Total Expenses', value: incomeStatement.totals.expenses, prev: incomeStatement.prevTotals?.expenses ?? null, color: RED },
            { label: 'Net Income', value: incomeStatement.totals.net, prev: incomeStatement.prevTotals?.net ?? null, color: incomeStatement.totals.net < 0 ? RED : BLUE },
        ];
        if (tab === 'cashflow') return [
            { label: 'Opening Cash', value: cashFlow.opening, prev: null, color: BLUE },
            { label: 'Net Change', value: cashFlow.net, prev: null, color: cashFlow.net < 0 ? RED : GREEN },
            { label: 'Closing Cash', value: cashFlow.closing, prev: null, color: cashFlow.closing < 0 ? RED : BLUE },
        ];
        return [
            { label: 'Total Debits', value: trialBalance.totals.debit, prev: null, color: BLUE },
            { label: 'Total Credits', value: trialBalance.totals.credit, prev: null, color: RED },
            { label: 'Difference', value: trialBalance.totals.debit - trialBalance.totals.credit, prev: null, color: trialBalance.balanced ? GREEN : AMBER },
        ];
    })();

    const btnStyle: React.CSSProperties = {
        display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px',
        border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-main)',
        fontSize: '13px', fontWeight: 600, cursor: 'pointer',
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Period line + options */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                    {tab === 'balance' || tab === 'trial'
                        ? <>As at <strong style={{ color: 'var(--color-text-main)' }}>{displayDate(endDate)}</strong> · This statement is struck at the end date.</>
                        : <>From <strong style={{ color: 'var(--color-text-main)' }}>{displayDate(startDate)}</strong> to <strong style={{ color: 'var(--color-text-main)' }}>{displayDate(endDate)}</strong></>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    {(tab === 'balance' || tab === 'income') && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: 'var(--color-text-main)', cursor: 'pointer', userSelect: 'none' }}>
                            <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} style={{ accentColor: BLUE, cursor: 'pointer' }} />
                            Compare with previous year
                        </label>
                    )}
                    <button onClick={() => setRefreshKey(k => k + 1)} title="Reload the ledger" style={{ ...btnStyle, padding: '7px 10px' }}>
                        <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '4px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '4px', flexWrap: 'wrap', alignSelf: 'flex-start' }}>
                {TABS.map(({ key, label, icon: Icon }) => (
                    <button key={key} onClick={() => setTab(key)} style={{
                        display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 16px', borderRadius: '9px', border: 'none',
                        background: tab === key ? 'var(--color-surface)' : 'transparent',
                        color: tab === key ? BLUE : 'var(--color-text-secondary)',
                        fontWeight: tab === key ? 700 : 500, fontSize: '13px', cursor: 'pointer',
                        boxShadow: tab === key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none', transition: 'all 0.15s',
                    }}>
                        <Icon size={15} /> {label}
                    </button>
                ))}
            </div>

            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>All figures are in USD.</div>

            {/* Integrity banner + actions */}
            <div style={{ ...cardStyle, borderLeft: `4px solid ${loading ? 'var(--color-border)' : banner.ok ? GREEN : AMBER}`, padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {loading ? <RefreshCw size={20} color="var(--color-text-secondary)" style={{ animation: 'spin 1s linear infinite' }} />
                        : banner.ok ? <CheckCircle2 size={20} color={GREEN} /> : <AlertTriangle size={20} color={AMBER} />}
                    <div>
                        <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--color-text-main)' }}>{loading ? 'Loading the ledger…' : banner.title}</div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>{banner.sub}</div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={printReport} disabled={loading} style={{ ...btnStyle, opacity: loading ? 0.5 : 1 }}><Printer size={14} /> Print / PDF</button>
                    <button onClick={exportCsv} disabled={loading} style={{ ...btnStyle, opacity: loading ? 0.5 : 1 }}><Download size={14} /> Export CSV</button>
                </div>
            </div>

            {/* Totals */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                {totalCards.map(c => <TotalCard key={c.label} label={c.label} value={c.value} prev={c.prev} color={c.color} />)}
            </div>

            {/* Statement body */}
            {tab === 'balance' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', gap: '20px', alignItems: 'start' }}>
                    <SectionCard title="Assets" color={BLUE} rows={balanceSheet.assets} totalLabel="Total Assets" total={balanceSheet.totals.assets} prevTotal={balanceSheet.prevTotals?.assets} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <SectionCard title="Liabilities" color={RED} rows={balanceSheet.liabilities} totalLabel="Total Liabilities" total={balanceSheet.totals.liabilities} prevTotal={balanceSheet.prevTotals?.liabilities} />
                        <SectionCard title="Equity" color={PURPLE} rows={balanceSheet.equity} totalLabel="Total Equity" total={balanceSheet.totals.equity} prevTotal={balanceSheet.prevTotals?.equity} />
                        <div style={{ ...cardStyle, padding: '12px 20px', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '14px' }}>
                            <span style={{ color: 'var(--color-text-main)' }}>Total Liabilities & Equity</span>
                            {amountText(balanceSheet.totals.liabilities + balanceSheet.totals.equity, true)}
                        </div>
                    </div>
                </div>
            )}

            {tab === 'income' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', gap: '20px', alignItems: 'start' }}>
                    <SectionCard title="Revenue" color={GREEN} rows={incomeStatement.revenue} totalLabel="Total Revenue" total={incomeStatement.totals.revenue} prevTotal={incomeStatement.prevTotals?.revenue} />
                    <SectionCard title="Expenses" color={RED} rows={incomeStatement.expenses} totalLabel="Total Expenses" total={incomeStatement.totals.expenses} prevTotal={incomeStatement.prevTotals?.expenses} />
                </div>
            )}

            {tab === 'cashflow' && (
                <div style={{ ...cardStyle, borderLeft: `4px solid ${BLUE}`, overflow: 'hidden' }}>
                    <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', fontSize: '12px', fontWeight: 800, letterSpacing: '0.8px', textTransform: 'uppercase', color: BLUE }}>
                        Cash Movements
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 20px', borderBottom: '1px solid var(--color-border)', fontSize: '14px' }}>
                        <span style={{ color: 'var(--color-text-secondary)' }}>Opening cash ({displayDate(startDate)})</span>
                        {amountText(cashFlow.opening)}
                    </div>
                    {cashFlow.rows.length === 0 ? (
                        <div style={{ padding: '18px 20px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                            {cashFlow.hasCash ? 'No cash movements in this period.' : 'No accounts named cash or bank exist, so no cash flow can be derived.'}
                        </div>
                    ) : cashFlow.rows.map(r => (
                        <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '10px 20px', borderBottom: '1px solid var(--color-border)', fontSize: '14px' }}>
                            <span className="d2-khmer" style={{ color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</span>
                            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: r.amount < 0 ? RED : GREEN }}>{loading ? '…' : `${r.amount >= 0 ? '+' : ''}${fmt(r.amount)}`}</span>
                        </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 20px', borderBottom: '1px solid var(--color-border)', fontSize: '14px', fontWeight: 700 }}>
                        <span style={{ color: 'var(--color-text-main)' }}>Net change in cash</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums', color: cashFlow.net < 0 ? RED : GREEN }}>{loading ? '…' : fmt(cashFlow.net)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 20px', background: 'var(--color-bg)', fontSize: '14px', fontWeight: 800 }}>
                        <span style={{ color: 'var(--color-text-main)' }}>Closing cash ({displayDate(endDate)})</span>
                        {amountText(cashFlow.closing, true)}
                    </div>
                </div>
            )}

            {tab === 'trial' && (
                <div style={{ ...cardStyle, overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', minWidth: '600px' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--color-border)', background: 'var(--color-bg)' }}>
                                    <th style={{ padding: '12px 20px', textAlign: 'left', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)', width: '90px' }}>Code</th>
                                    <th style={{ padding: '12px 20px', textAlign: 'left', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)' }}>Account</th>
                                    <th style={{ padding: '12px 20px', textAlign: 'left', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)', width: '110px' }}>Type</th>
                                    <th style={{ padding: '12px 20px', textAlign: 'right', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: BLUE, width: '140px' }}>Debit</th>
                                    <th style={{ padding: '12px 20px', textAlign: 'right', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: RED, width: '140px' }}>Credit</th>
                                </tr>
                            </thead>
                            <tbody>
                                {trialBalance.rows.map((r, i) => (
                                    <tr key={`${r.code}|${r.name}`} style={{ borderBottom: '1px solid var(--color-border)', background: i % 2 ? 'rgba(0,0,0,0.015)' : 'transparent' }}>
                                        <td style={{ padding: '10px 20px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--color-text-secondary)' }}>{r.code}</td>
                                        <td className="d2-khmer" style={{ padding: '10px 20px', color: 'var(--color-text-main)' }}>{r.name}</td>
                                        <td style={{ padding: '10px 20px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{r.type}</td>
                                        <td style={{ padding: '10px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-main)' }}>{loading ? '…' : r.debit ? fmt(r.debit) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</td>
                                        <td style={{ padding: '10px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-main)' }}>{loading ? '…' : r.credit ? fmt(r.credit) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ borderTop: '2px solid var(--color-border)', background: 'var(--color-bg)', fontWeight: 800 }}>
                                    <td colSpan={3} style={{ padding: '12px 20px', color: 'var(--color-text-main)' }}>Total</td>
                                    <td style={{ padding: '12px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: BLUE }}>{loading ? '…' : fmt(trialBalance.totals.debit)}</td>
                                    <td style={{ padding: '12px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: RED }}>{loading ? '…' : fmt(trialBalance.totals.credit)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}

            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default FinancialStatements;
