// Cash In / Out: where the cash accounts' money is, what came in, and where
// it went. Distinct from the formal indirect-method "Cash Flow" statement
// (FinancialStatements.tsx's cashflow tab, still reachable from Balance
// Sheet / Income Statement's tab row) — this page is a cash-book style
// report scoped to the accounts that ARE cash (Asset accounts named cash or
// bank, same filter FinancialStatements already uses for its own cash flow).
import React, { useState, useEffect, useMemo } from 'react';
import { Wallet, BookOpen, TrendingUp, PieChart as PieChartIcon, Printer, Download, RefreshCw } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';
import { supabase } from '../../lib/supabase';
import { useHeader } from '../../context/HeaderContext';
import type { ChartOfAccount } from '../../types';
import { dayKeyFromDate, addDays, daysBetween } from '../../utils/dateRange';

const fmt = (n: number): string => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BLUE = '#3B82F6', RED = '#EF4444', GREEN = '#10B981';
const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TABS = [
    { key: 'position', label: 'Cash Position', icon: Wallet },
    { key: 'book', label: 'Cash Book', icon: BookOpen },
    { key: 'trend', label: 'Trend', icon: TrendingUp },
    { key: 'source', label: 'By Source', icon: PieChartIcon },
] as const;
type TabKey = typeof TABS[number]['key'];

interface RawLine { account_id: unknown; debit: unknown; credit: unknown; description?: unknown }
interface RawEntry { id: unknown; date: unknown; status?: unknown; entry_number?: unknown; description?: unknown; lines?: RawLine[] | null }
interface Line { accountId: string; entryId: string; entryNumber: string; description: string; debit: number; credit: number; date: string }

const todayYmd = (): string => dayKeyFromDate(new Date());
const startOfMonthYmd = (): string => {
    const d = new Date();
    return dayKeyFromDate(new Date(d.getFullYear(), d.getMonth(), 1));
};

const CashInOutPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const [tab, setTab] = useState<TabKey>('position');
    const [range, setRange] = useState<{ start: string; end: string }>({ start: startOfMonthYmd(), end: todayYmd() });
    const [accountFilter, setAccountFilter] = useState<string>('all');
    const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
    const [entries, setEntries] = useState<RawEntry[] | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Cash In / Out</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0 }}>Where the money is, what came in, and where it went</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        let alive = true;
        setEntries(null);
        (async () => {
            try {
                const { data: accs, error: accErr } = await supabase
                    .from('chart_of_accounts').select('*').order('account_code', { ascending: true });
                if (accErr) throw accErr;

                const all: RawEntry[] = [];
                for (let from = 0; from < 100000; from += 1000) {
                    const { data, error } = await supabase
                        .from('journal_entries')
                        .select('*, lines:journal_entry_lines(*)')
                        .order('date', { ascending: true })
                        .range(from, from + 999);
                    if (error) throw error;
                    all.push(...((data || []) as RawEntry[]));
                    if (!data || data.length < 1000) break;
                }
                if (!alive) return;
                setAccounts(accs || []);
                setEntries(all);
            } catch (e) {
                console.error('Failed to load the ledger:', e);
                if (alive) setEntries([]);
            }
        })();
        return () => { alive = false; };
    }, [refreshKey]);

    const loading = entries === null;

    // Cash accounts = Asset accounts named cash or bank — same rule
    // FinancialStatements' Cash Flow tab, and the Deposit/PdFee payment
    // modals, already use to pick a cash/bank destination account.
    const cashAccounts = useMemo(
        () => accounts.filter(a => a.account_type === 'Asset' && /cash|bank/i.test(a.account_name))
            .sort((a, b) => a.account_code.localeCompare(b.account_code)),
        [accounts]
    );
    const cashIds = useMemo(() => new Set(cashAccounts.map(a => a.id)), [cashAccounts]);
    const nameOf = useMemo(() => new Map(accounts.map(a => [a.id, `${a.account_code} · ${a.account_name}`])), [accounts]);

    // Every posted line of every entry — flat, with its entry's date/number/
    // description carried along. `allLines` feeds By Source (needs the
    // non-cash counter lines too); `cashLines` is the subset touching a cash
    // account, which Position/Book/Trend all work from.
    const allLines = useMemo(() => {
        const out: Line[] = [];
        for (const e of entries || []) {
            if (String(e.status || 'Posted') === 'Draft') continue;
            const date = String(e.date || '').slice(0, 10);
            const entryId = String(e.id);
            const entryNumber = String(e.entry_number || '');
            const entryDesc = String(e.description || '');
            for (const l of e.lines || []) {
                out.push({
                    accountId: String(l.account_id),
                    entryId, entryNumber,
                    description: String(l.description || entryDesc || ''),
                    debit: Number(l.debit) || 0,
                    credit: Number(l.credit) || 0,
                    date,
                });
            }
        }
        return out;
    }, [entries]);

    const cashLines = useMemo(() => allLines.filter(l => cashIds.has(l.accountId)), [allLines, cashIds]);

    const scopedCashLines = useMemo(
        () => accountFilter === 'all' ? cashLines : cashLines.filter(l => l.accountId === accountFilter),
        [cashLines, accountFilter]
    );

    // ── Cash Position: per cash account, Opening / Cash In / Cash Out / Net / Closing ──
    const positionRows = useMemo(() => {
        const list = accountFilter === 'all' ? cashAccounts : cashAccounts.filter(a => a.id === accountFilter);
        return list.map(a => {
            let opening = 0, cashIn = 0, cashOut = 0;
            for (const l of cashLines) {
                if (l.accountId !== a.id) continue;
                if (l.date < range.start) { opening += l.debit - l.credit; continue; }
                if (l.date > range.end) continue;
                cashIn += l.debit;
                cashOut += l.credit;
            }
            const net = cashIn - cashOut;
            return { account: a, opening, cashIn, cashOut, net, closing: opening + net };
        });
    }, [cashAccounts, accountFilter, cashLines, range]);

    const positionTotals = useMemo(() => positionRows.reduce((acc, r) => ({
        opening: acc.opening + r.opening, cashIn: acc.cashIn + r.cashIn, cashOut: acc.cashOut + r.cashOut,
        net: acc.net + r.net, closing: acc.closing + r.closing,
    }), { opening: 0, cashIn: 0, cashOut: 0, net: 0, closing: 0 }), [positionRows]);

    // Every entry's lines, keyed by entry id — used to find each cash line's
    // contra account(s): the other side(s) of that entry's double entry.
    const linesByEntry = useMemo(() => {
        const m = new Map<string, Line[]>();
        for (const l of allLines) {
            const arr = m.get(l.entryId);
            if (arr) arr.push(l); else m.set(l.entryId, [l]);
        }
        return m;
    }, [allLines]);

    const contraOf = (entryId: string, accountId: string): string => {
        const siblings = (linesByEntry.get(entryId) || []).filter(l => l.accountId !== accountId);
        if (siblings.length === 0) return '—';
        const names = Array.from(new Set(siblings.map(l => nameOf.get(l.accountId) || '(Deleted account)')));
        return names.join(', ');
    };

    // ── Cash Book: chronological transaction list, running balance ──
    const cashBookRows = useMemo(() => {
        let opening = 0;
        for (const l of scopedCashLines) if (l.date < range.start) opening += l.debit - l.credit;
        const inRange = scopedCashLines.filter(l => l.date >= range.start && l.date <= range.end);
        let running = opening;
        return inRange.map(l => {
            running += l.debit - l.credit;
            return { ...l, accountName: nameOf.get(l.accountId) || '(Deleted account)', contra: contraOf(l.entryId, l.accountId), balance: running };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scopedCashLines, range, nameOf, linesByEntry]);

    // ── Trend: Cash In / Cash Out per day (or per month for long ranges) ──
    const trendData = useMemo(() => {
        const inRange = scopedCashLines.filter(l => l.date >= range.start && l.date <= range.end);
        const span = daysBetween(range.start, range.end) + 1;
        const byMonth = span > 62;
        const bucketOf = (d: string) => byMonth ? d.slice(0, 7) : d;
        const totals = new Map<string, { in: number; out: number }>();
        for (const l of inRange) {
            const k = bucketOf(l.date);
            const v = totals.get(k) || { in: 0, out: 0 };
            v.in += l.debit; v.out += l.credit;
            totals.set(k, v);
        }
        const buckets: string[] = [];
        if (byMonth) {
            let cursor = range.start.slice(0, 7);
            const last = range.end.slice(0, 7);
            while (cursor <= last) {
                buckets.push(cursor);
                const [y, m] = cursor.split('-').map(Number);
                cursor = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
            }
        } else {
            for (let d = range.start; d <= range.end; d = addDays(d, 1)) buckets.push(d);
        }
        return buckets.map(k => {
            const v = totals.get(k) || { in: 0, out: 0 };
            return { period: k, cashIn: v.in, cashOut: -v.out, net: v.in - v.out };
        });
    }, [scopedCashLines, range]);

    // ── By Source: each entry's cash delta attributed to its counter accounts ──
    const bySource = useMemo(() => {
        const inScope = (accId: string) => accountFilter === 'all' ? cashIds.has(accId) : accId === accountFilter;
        const byEntry = new Map<string, Line[]>();
        for (const l of allLines) {
            if (l.date < range.start || l.date > range.end) continue;
            const arr = byEntry.get(l.entryId);
            if (arr) arr.push(l); else byEntry.set(l.entryId, [l]);
        }
        const inflows = new Map<string, number>();
        const outflows = new Map<string, number>();
        for (const entryLines of byEntry.values()) {
            const scoped = entryLines.filter(l => inScope(l.accountId));
            if (scoped.length === 0) continue;
            const delta = scoped.reduce((s, l) => s + l.debit - l.credit, 0);
            if (Math.abs(delta) < 0.0005) continue;
            const counters = entryLines.filter(l => !inScope(l.accountId));
            const weight = counters.reduce((s, l) => s + Math.abs(l.debit - l.credit), 0);
            const target = delta > 0 ? inflows : outflows;
            const amt = Math.abs(delta);
            if (counters.length === 0 || weight === 0) {
                target.set('Cash-to-cash transfer', (target.get('Cash-to-cash transfer') || 0) + amt);
                continue;
            }
            for (const c of counters) {
                const key = nameOf.get(c.accountId) || '(Deleted account)';
                const share = amt * (Math.abs(c.debit - c.credit) / weight);
                target.set(key, (target.get(key) || 0) + share);
            }
        }
        const toRows = (m: Map<string, number>) => Array.from(m.entries()).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
        return { inflows: toRows(inflows), outflows: toRows(outflows) };
    }, [allLines, cashIds, accountFilter, range, nameOf]);

    // ── UI building blocks ──
    const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };
    const labelStyle: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '5px' };
    const inputStyle: React.CSSProperties = { padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', outline: 'none', background: 'var(--color-surface)', color: 'var(--color-text-main)' };
    const btnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' };
    const amountText = (n: number, color?: string): React.ReactNode => (
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: color || 'var(--color-text-main)' }}>{loading ? '…' : fmt(n)}</span>
    );

    const StatCard: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
        <div style={{ ...cardStyle, padding: '16px 20px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{label}</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color, marginTop: '6px', fontVariantNumeric: 'tabular-nums' }}>{loading ? '…' : fmt(value)}</div>
        </div>
    );

    const hasRows = (() => {
        if (tab === 'position') return positionRows.length > 0;
        if (tab === 'book') return cashBookRows.length > 0;
        if (tab === 'trend') return trendData.some(d => d.cashIn !== 0 || d.cashOut !== 0);
        return bySource.inflows.length > 0 || bySource.outflows.length > 0;
    })();

    // ── Export / print: one flat table per tab ──
    const activeTable = (): { name: string; period: string; columns: string[]; rows: (string | number)[][] } => {
        const money = (n: number) => fmt(n);
        const period = `${range.start || '—'} – ${range.end || '—'}`;
        if (tab === 'position') {
            return {
                name: 'Cash Position', period,
                columns: ['Account', 'Opening', 'Cash In', 'Cash Out', 'Net', 'Closing'],
                rows: [
                    ...positionRows.map(r => [`${r.account.account_code} · ${r.account.account_name}`, money(r.opening), money(r.cashIn), money(r.cashOut), money(r.net), money(r.closing)]),
                    ['Total', money(positionTotals.opening), money(positionTotals.cashIn), money(positionTotals.cashOut), money(positionTotals.net), money(positionTotals.closing)],
                ],
            };
        }
        if (tab === 'book') {
            return {
                name: 'Cash Book', period,
                columns: ['Date', 'Entry #', 'Description', 'Account', 'Contra', 'Cash In', 'Cash Out', 'Balance'],
                rows: cashBookRows.map(r => [r.date, r.entryNumber, r.description || '—', r.accountName, r.contra, r.debit ? money(r.debit) : '', r.credit ? money(r.credit) : '', money(r.balance)]),
            };
        }
        if (tab === 'trend') {
            return {
                name: 'Cash Trend', period,
                columns: ['Period', 'Cash In', 'Cash Out', 'Net'],
                rows: trendData.map(d => [d.period, money(d.cashIn), money(-d.cashOut), money(d.net)]),
            };
        }
        return {
            name: 'Cash by Source', period,
            columns: ['Source', 'Cash In', 'Cash Out'],
            rows: [
                ...bySource.inflows.map(r => [r.name, money(r.amount), '']),
                ...bySource.outflows.map(r => [r.name, '', money(r.amount)]),
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
        a.download = `${t.name.toLowerCase().replace(/ /g, '-')}-${range.end || todayYmd()}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const printList = () => {
        const t = activeTable();
        const w = window.open('', '_blank', 'width=900,height=700');
        if (!w) return;
        // All tabs' tables are text columns first, numeric columns last — align
        // by counting the numeric columns back from the end.
        const numericCols = tab === 'position' ? 5 : tab === 'book' ? 3 : tab === 'trend' ? 3 : 2;
        const body = t.rows.map(r => `<tr>${r.map((c, i) => `<td style="text-align:${i >= t.columns.length - numericCols ? 'right' : 'left'}">${escapeHtml(String(c))}</td>`).join('')}</tr>`).join('');
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

    return (
        <div className="acct-page" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Filters */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                    <label style={labelStyle}>From</label>
                    <input type="date" value={range.start} onChange={e => setRange(r => ({ ...r, start: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                    <label style={labelStyle}>To</label>
                    <input type="date" value={range.end} onChange={e => setRange(r => ({ ...r, end: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                    <label style={labelStyle}>Account</label>
                    <select value={accountFilter} onChange={e => setAccountFilter(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="all">All cash accounts</option>
                        {cashAccounts.map(a => <option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>)}
                    </select>
                </div>
                <button onClick={() => setRefreshKey(k => k + 1)} title="Reload" style={{ ...btnStyle, padding: '9px 10px' }}>
                    <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
                </button>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button onClick={printList} disabled={loading || !hasRows} style={{ ...btnStyle, opacity: (loading || !hasRows) ? 0.5 : 1 }}>
                        <Printer size={14} /> Print list
                    </button>
                    <button onClick={exportCsv} disabled={loading || !hasRows} style={{ ...btnStyle, opacity: (loading || !hasRows) ? 0.5 : 1 }}>
                        <Download size={14} /> Export CSV
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

            {/* Summary cards (scoped to the current From/To + Account filters) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <StatCard label="Cash On Hand" value={positionTotals.closing} color="var(--color-text-main)" />
                <StatCard label="Cash In" value={positionTotals.cashIn} color={BLUE} />
                <StatCard label="Cash Out" value={positionTotals.cashOut} color={RED} />
                <StatCard label="Net Movement" value={positionTotals.net} color={positionTotals.net < 0 ? RED : BLUE} />
            </div>

            {/* Cash Position */}
            {tab === 'position' && (
                <div style={{ ...cardStyle, overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '640px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    {['Account', 'Opening', 'Cash In', 'Cash Out', 'Net', 'Closing'].map((h, i) => (
                                        <th key={h} style={{ padding: '10px 20px', textAlign: i === 0 ? 'left' : 'right', fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {positionRows.length === 0 ? (
                                    <tr><td colSpan={6} style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No cash accounts found (Asset accounts named cash or bank).</td></tr>
                                ) : positionRows.map(r => (
                                    <tr key={r.account.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td style={{ padding: '12px 20px' }}>
                                            <div style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{r.account.account_name}</div>
                                            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{r.account.account_code}</div>
                                        </td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right' }}>{amountText(r.opening)}</td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right' }}>{r.cashIn ? amountText(r.cashIn, BLUE) : <span style={{ color: 'var(--color-text-secondary)' }}>—</span>}</td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right' }}>{r.cashOut ? amountText(r.cashOut, RED) : <span style={{ color: 'var(--color-text-secondary)' }}>—</span>}</td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right' }}>{amountText(r.net)}</td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 700 }}>{amountText(r.closing)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            {positionRows.length > 0 && (
                                <tfoot>
                                    <tr style={{ background: 'var(--color-bg)', fontWeight: 700 }}>
                                        <td style={{ padding: '12px 20px' }}>Total</td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right' }}>{amountText(positionTotals.opening)}</td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right' }}>{amountText(positionTotals.cashIn, BLUE)}</td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right' }}>{amountText(positionTotals.cashOut, RED)}</td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right' }}>{amountText(positionTotals.net)}</td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right' }}>{amountText(positionTotals.closing)}</td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>
            )}

            {/* Cash Book */}
            {tab === 'book' && (
                <div style={{ ...cardStyle, overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '720px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    {['Date', 'Entry #', 'Description', 'Account', 'Contra', 'Cash In', 'Cash Out', 'Balance'].map((h, i) => (
                                        <th key={h} style={{ padding: '10px 16px', textAlign: i >= 5 ? 'right' : 'left', fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {cashBookRows.length === 0 ? (
                                    <tr><td colSpan={8} style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No cash transactions in this range.</td></tr>
                                ) : cashBookRows.map((r, i) => (
                                    <tr key={`${r.entryId}-${r.accountId}-${i}`} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td style={{ padding: '10px 16px', whiteSpace: 'nowrap', color: 'var(--color-text-main)' }}>{r.date}</td>
                                        <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--color-text-secondary)' }}>{r.entryNumber || '—'}</td>
                                        <td style={{ padding: '10px 16px', color: 'var(--color-text-main)' }}>{r.description || '—'}</td>
                                        <td style={{ padding: '10px 16px', color: 'var(--color-text-secondary)' }}>{r.accountName}</td>
                                        <td style={{ padding: '10px 16px', color: 'var(--color-text-secondary)' }}>{r.contra}</td>
                                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>{r.debit ? amountText(r.debit, BLUE) : ''}</td>
                                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>{r.credit ? amountText(r.credit, RED) : ''}</td>
                                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>{amountText(r.balance)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Trend */}
            {tab === 'trend' && (
                <div style={{ ...cardStyle, padding: '20px', height: '380px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)' }}>Cash In / Out {trendData.length > 0 && daysBetween(range.start, range.end) + 1 > 62 ? 'by month' : 'by day'}</div>
                    {!hasRows ? (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>No cash movement in this range.</div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                                <XAxis dataKey="period" stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
                                <YAxis stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(Number(v))} />
                                <ReferenceLine y={0} stroke="var(--color-border)" />
                                <Tooltip
                                    contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                                    itemStyle={{ fontWeight: 600 }}
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    formatter={((value: any, name: any) => [fmt(Math.abs(Number(value))), name]) as any}
                                />
                                <Legend wrapperStyle={{ fontSize: '12px' }} />
                                <Bar dataKey="cashIn" name="Cash In" fill={GREEN} radius={[3, 3, 0, 0]} maxBarSize={36} />
                                <Bar dataKey="cashOut" name="Cash Out" fill={RED} radius={[0, 0, 3, 3]} maxBarSize={36} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
            )}

            {/* By Source */}
            {tab === 'source' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', gap: '20px', alignItems: 'start' }}>
                    {([
                        { title: 'Cash In by Source', color: GREEN, rows: bySource.inflows, total: positionTotals.cashIn },
                        { title: 'Cash Out by Source', color: RED, rows: bySource.outflows, total: positionTotals.cashOut },
                    ] as const).map(section => (
                        <div key={section.title} style={{ ...cardStyle, borderLeft: `4px solid ${section.color}`, overflow: 'hidden' }}>
                            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', fontSize: '12px', fontWeight: 800, letterSpacing: '0.8px', textTransform: 'uppercase', color: section.color }}>
                                {section.title}
                            </div>
                            {section.rows.length === 0 ? (
                                <div style={{ padding: '18px 20px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>No movement in this range.</div>
                            ) : section.rows.map((r, i) => (
                                <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 20px', borderBottom: i === section.rows.length - 1 ? 'none' : '1px solid var(--color-border)', fontSize: '14px' }}>
                                    <span className="d2-khmer" style={{ flex: 1, color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</span>
                                    {amountText(r.amount)}
                                </div>
                            ))}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '12px 20px', borderTop: '2px solid var(--color-border)', background: 'var(--color-bg)', fontSize: '14px', fontWeight: 700 }}>
                                <span style={{ color: 'var(--color-text-main)' }}>Total</span>
                                {amountText(section.total, section.color)}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default CashInOutPage;
