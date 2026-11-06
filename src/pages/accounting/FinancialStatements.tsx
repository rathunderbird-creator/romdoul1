// Financial statements driven by the double-entry ledger (chart_of_accounts +
// journal_entry_lines): Balance Sheet, Income Statement, Cash Flow and Trial
// Balance. The Balance Sheet and Trial Balance are struck AT the end date;
// the Income Statement and Cash Flow cover the start→end range.
//
// Shared by the Reports-center Financials tab (dates from the reports layout)
// and the standalone /accounting pages (FinancialReportsPage, with its own
// From / As-at pickers).
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scale, TrendingUp, ArrowDownUp, ClipboardList, CheckCircle2, AlertTriangle, Printer, Download, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useMobile } from '../../hooks/useMobile';
import type { ChartOfAccount } from '../../types';
import { dayKeyFromDate } from '../../utils/dateRange';

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
    if (!ymd) return '';
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

// `id` is the chart-of-accounts row's own id, used to deep-link to the
// General Ledger — absent on synthetic lines like "Retained Earnings" below.
interface StatementRow { id?: string; code: string; name: string; amount: number; prev?: number }

// Income-statement bucket of a Revenue/Expense account, driven by sub_type
// (same grouping as IncomeStatementPage). Accounts without one fall back by
// name for COGS — instances whose chart predates sub_type (Romdoul 2/3) still
// get a real Gross Profit — and to the Operating buckets otherwise.
type IncomeBucket = 'revenue' | 'otherRevenue' | 'cogs' | 'opex' | 'otherExpense';
const incomeBucketOf = (a: ChartOfAccount): IncomeBucket => {
    if (a.account_type === 'Revenue') return a.sub_type === 'Other Revenue' ? 'otherRevenue' : 'revenue';
    if (a.sub_type === 'Cost of Goods Sold' || (!a.sub_type && /cost of goods|cogs/i.test(a.account_name))) return 'cogs';
    if (a.sub_type === 'Other Expense') return 'otherExpense';
    return 'opex';
};

export interface FinancialStatementsProps {
    startDate: string;
    endDate: string;
    /** Open on this statement; the sidebar's per-statement pages set it. */
    initialTab?: TabKey;
}

const FinancialStatements: React.FC<FinancialStatementsProps> = ({ startDate, endDate: endDateProp, initialTab }) => {
    // "Lifetime" sends '' for both bounds: '' start is already unbounded, '' end means today.
    const endDate = endDateProp || dayKeyFromDate(new Date());
    const isMobile = useMobile();
    const navigate = useNavigate();
    const goToLedger = (accountId: string) => navigate(`/accounting/general-ledger?account=${accountId}`);
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

                const loadPage = (from: number, withStatus: boolean) => supabase
                    .from('journal_entry_lines')
                    .select(`account_id, journal_entry_id, debit, credit, entry:journal_entries!inner(date${withStatus ? ', status' : ''})`)
                    .order('id', { ascending: true })
                    .range(from, from + 999);

                const all: LedgerLine[] = [];
                // Statements are struck from POSTED entries only — a Draft isn't in
                // the books yet (same rule as the Revenue/Expense totals cards).
                // Instances without add_entry_status.sql have no status column:
                // fall back, and everything counts as Posted.
                let withStatus = true;
                for (let from = 0; from < 100000; from += 1000) {
                    let { data, error } = await loadPage(from, withStatus);
                    if (error && withStatus && /status/i.test(error.message || '')) {
                        withStatus = false;
                        ({ data, error } = await loadPage(from, withStatus));
                    }
                    if (error) throw error;
                    type LineRow = { account_id: unknown; journal_entry_id: unknown; debit: unknown; credit: unknown; entry: { date?: unknown; status?: unknown } | null };
                    for (const l of (data || []) as LineRow[]) {
                        if (String(l.entry?.status || 'Posted') === 'Draft') continue;
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
            .map(a => ({ id: a.id, code: a.account_code, name: a.account_name, amount: bal.get(a.id) || 0, ...(prev ? { prev: prev.get(a.id) || 0 } : {}) }));

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

    // ── Income Statement (startDate → endDate), sectioned like a classic
    // statement: Operating Revenue − Cost of Sales = Gross Profit; − Operating
    // Expenses = Operating Profit; ± Other Revenue/Expenses = Net Income. ──
    const [showEmpty, setShowEmpty] = useState(false);
    const incomeStatement = useMemo(() => {
        const inRange = signedBalances(l => l.date >= startDate && l.date <= endDate);
        const prevRange = compare
            ? signedBalances(l => l.date >= shiftYears(startDate, -1) && l.date <= shiftYears(endDate, -1))
            : undefined;
        const bucketRows = (bucket: IncomeBucket): StatementRow[] =>
            accounts
                .filter(a => (a.account_type === 'Revenue' || a.account_type === 'Expense') && incomeBucketOf(a) === bucket)
                .filter(a => a.is_active || (inRange.get(a.id) || 0) !== 0 || (prevRange?.get(a.id) || 0) !== 0)
                .filter(a => showEmpty || Math.abs(inRange.get(a.id) || 0) >= 0.005 || Math.abs(prevRange?.get(a.id) || 0) >= 0.005)
                .map(a => ({ id: a.id, code: a.account_code, name: a.account_name, amount: inRange.get(a.id) || 0, ...(prevRange ? { prev: prevRange.get(a.id) || 0 } : {}) }));
        // Totals from ALL accounts of the bucket (never affected by the
        // hide-empty-rows display filter — zeros add nothing anyway, but the
        // sums must not depend on what is shown).
        const bucketTotal = (bucket: IncomeBucket, m: Map<string, number>): number =>
            accounts.reduce((s, a) => s + ((a.account_type === 'Revenue' || a.account_type === 'Expense') && incomeBucketOf(a) === bucket ? (m.get(a.id) || 0) : 0), 0);
        const totalsIn = (m: Map<string, number>) => {
            const revenue = bucketTotal('revenue', m), cogs = bucketTotal('cogs', m), opex = bucketTotal('opex', m);
            const otherRevenue = bucketTotal('otherRevenue', m), otherExpenses = bucketTotal('otherExpense', m);
            return {
                revenue, cogs, opex, otherRevenue, otherExpenses,
                grossProfit: revenue - cogs,
                operatingProfit: revenue - cogs - opex,
                totalRevenue: revenue + otherRevenue,
                expenses: cogs + opex + otherExpenses,
                net: revenue + otherRevenue - cogs - opex - otherExpenses,
            };
        };
        return {
            revenue: bucketRows('revenue'),
            cogs: bucketRows('cogs'),
            opex: bucketRows('opex'),
            otherRevenue: bucketRows('otherRevenue'),
            otherExpenses: bucketRows('otherExpense'),
            // Other sections only exist when the chart has such accounts at all.
            hasOtherRevenue: accounts.some(a => a.account_type === 'Revenue' && incomeBucketOf(a) === 'otherRevenue'),
            hasOtherExpenses: accounts.some(a => a.account_type === 'Expense' && incomeBucketOf(a) === 'otherExpense'),
            totals: totalsIn(inRange),
            prevTotals: prevRange ? totalsIn(prevRange) : null,
        };
    }, [signedBalances, accounts, startDate, endDate, compare, showEmpty]);

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

    // ── Indirect-method Cash Flow statement: Net Income, adjusted by the
    // period's working-capital changes, then investing and financing
    // movements. Every entry balances, so cash's change equals minus the sum
    // of all non-cash accounts' net debits — and since every non-cash account
    // lands in exactly ONE bucket below, Operating + Investing + Financing
    // MUST equal the cash accounts' actual change. The banner checks that
    // identity: a mismatch means a classification bug, not bad data. ──
    const cashFlowStatement = useMemo(() => {
        const cashIds = new Set(accounts.filter(a => a.account_type === 'Asset' && /cash|bank/i.test(a.account_name)).map(a => a.id));
        const known = new Set(accounts.map(a => a.id));
        // Period net debit per non-cash account (raw sides, not normal-signed).
        const netDebit = new Map<string, number>();
        let deletedContribution = 0;
        for (const l of lines || []) {
            if (l.date < startDate || l.date > endDate || cashIds.has(l.accountId)) continue;
            if (!known.has(l.accountId)) { deletedContribution += -(l.debit - l.credit); continue; }
            netDebit.set(l.accountId, (netDebit.get(l.accountId) || 0) + l.debit - l.credit);
        }
        // An account's cash contribution: a net debit elsewhere drains cash
        // (asset bought, receivable grown), a net credit frees it.
        const contributionOf = (a: ChartOfAccount): number => -(netDebit.get(a.id) || 0);
        const isInvesting = (a: ChartOfAccount): boolean => a.account_type === 'Asset' && !cashIds.has(a.id)
            && (/fixed|non-current|property|plant|equipment/i.test(a.sub_type || '') || /equipment|vehicle|property|land|building|furniture|machin|fixture/i.test(a.account_name));
        const isFinancing = (a: ChartOfAccount): boolean => a.account_type === 'Equity'
            || (a.account_type === 'Liability' && /loan|borrow|note payable|debt|mortgage/i.test(a.account_name));
        const rowsOf = (pred: (a: ChartOfAccount) => boolean): StatementRow[] => accounts
            .filter(a => !cashIds.has(a.id) && a.account_type !== 'Revenue' && a.account_type !== 'Expense' && pred(a))
            .map(a => ({ id: a.id, code: a.account_code, name: a.account_name, amount: contributionOf(a) }))
            .filter(r => Math.abs(r.amount) >= 0.005);
        // Working capital = every remaining non-cash asset/liability: the
        // catch-all bucket, so the three activities always cover everything.
        const workingCapital = rowsOf(a => !isInvesting(a) && !isFinancing(a));
        if (Math.abs(deletedContribution) >= 0.005) workingCapital.push({ code: '', name: '(Deleted accounts)', amount: deletedContribution });
        const investing = rowsOf(isInvesting);
        const financing = rowsOf(isFinancing);
        let netIncome = 0;
        for (const a of accounts) {
            if (a.account_type === 'Revenue' || a.account_type === 'Expense') netIncome += contributionOf(a);
        }
        const totalWC = workingCapital.reduce((s, r) => s + r.amount, 0);
        const netOperating = netIncome + totalWC;
        const netInvesting = investing.reduce((s, r) => s + r.amount, 0);
        const netFinancing = financing.reduce((s, r) => s + r.amount, 0);
        return {
            netIncome, workingCapital, totalWC, netOperating,
            investing, netInvesting, financing, netFinancing,
            netChange: netOperating + netInvesting + netFinancing,
        };
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
            return { id: a.id, code: a.account_code, name: a.account_name, type: a.account_type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
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
            const t = incomeStatement.totals, pt = incomeStatement.prevTotals;
            const section = (label: string, rows: StatementRow[], total: number, prevTotal?: number) => [
                ...rows.map(r => [r.code, `${label}: ${r.name}`, money(r.amount), ...(compare ? [money(r.prev || 0)] : [])]),
                ['', `Total ${label}`, money(total), ...(compare ? [pt ? money(prevTotal || 0) : ''] : [])],
            ];
            const keyLine = (label: string, value: number, prevValue?: number) =>
                [['', label, money(value), ...(compare ? [pt ? money(prevValue || 0) : ''] : [])]];
            return {
                name: 'Income Statement', period: `${displayDate(startDate)} – ${displayDate(endDate)}`,
                columns: ['Code', 'Account', 'This period', ...(compare ? ['Previous year'] : [])],
                rows: [
                    // "Operating Revenue": the combined figure (incl. Other
                    // Revenue) is the hero/card "Total Revenue" — same label on
                    // a different number would make the export unreconcilable.
                    ...section('Operating Revenue', incomeStatement.revenue, t.revenue, pt?.revenue),
                    ...section('Cost of Sales', incomeStatement.cogs, t.cogs, pt?.cogs),
                    ...keyLine('Gross Profit', t.grossProfit, pt?.grossProfit),
                    ...section('Operating Expenses', incomeStatement.opex, t.opex, pt?.opex),
                    ...keyLine('Operating Profit', t.operatingProfit, pt?.operatingProfit),
                    ...(incomeStatement.hasOtherRevenue ? section('Other Revenue', incomeStatement.otherRevenue, t.otherRevenue, pt?.otherRevenue) : []),
                    ...(incomeStatement.hasOtherExpenses ? section('Other Expenses', incomeStatement.otherExpenses, t.otherExpenses, pt?.otherExpenses) : []),
                    ...keyLine(t.net >= 0 ? 'Net Income' : 'Net Loss', t.net, pt?.net),
                ],
            };
        }
        if (tab === 'cashflow') {
            const cf = cashFlowStatement;
            return {
                name: 'Cash Flow', period: `${displayDate(startDate)} – ${displayDate(endDate)}`,
                columns: ['Code', 'Line', 'Amount'],
                rows: [
                    ['', 'Operating Activities — Net Income', money(cf.netIncome)],
                    ...cf.workingCapital.map(r => [r.code, `Working Capital: ${r.name}`, money(r.amount)]),
                    ['', 'Total Changes in Working Capital', money(cf.totalWC)],
                    ['', 'Net Cash from Operations', money(cf.netOperating)],
                    ...cf.investing.map(r => [r.code, `Investing: ${r.name}`, money(r.amount)]),
                    ['', 'Net Cash from Investing', money(cf.netInvesting)],
                    ...cf.financing.map(r => [r.code, `Financing: ${r.name}`, money(r.amount)]),
                    ['', 'Net Cash from Financing', money(cf.netFinancing)],
                    ['', 'Beginning Cash Balance', money(cashFlow.opening)],
                    ['', 'Net Change in Cash', money(cf.netChange)],
                    ['', 'Ending Cash Balance', money(cashFlow.closing)],
                    ...cashFlow.rows.map(r => ['', `Cash Movement: ${r.name}`, money(r.amount)]),
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

    const SectionCard: React.FC<{ title: string; color: string; rows: StatementRow[]; totalLabel: string; total: number; prevTotal?: number; emptyText?: string }> =
        ({ title, color, rows, totalLabel, total, prevTotal, emptyText }) => (
            <div style={{ ...cardStyle, borderLeft: `4px solid ${color}`, overflow: 'hidden' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '0.8px', textTransform: 'uppercase', color }}>{title}</span>
                    {compare && <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>current · previous year</span>}
                </div>
                {rows.length === 0 ? (
                    <div style={{ padding: '18px 20px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>{emptyText || 'No accounts of this type.'}</div>
                ) : rows.map((r, i) => (
                    <div
                        key={`${r.code}|${r.name}`}
                        className={r.id ? 'hover-highlight' : undefined}
                        onClick={r.id ? () => goToLedger(r.id!) : undefined}
                        title={r.id ? 'View in General Ledger' : undefined}
                        style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 20px', borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--color-border)', fontSize: '14px', cursor: r.id ? 'pointer' : 'default' }}
                    >
                        <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', width: '44px', flexShrink: 0 }}>{r.code}</span>
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
            sub: `Revenue ${fmt(incomeStatement.totals.totalRevenue)} − Expenses ${fmt(incomeStatement.totals.expenses)} · Gross Profit ${fmt(incomeStatement.totals.grossProfit)}`,
        };
        const reconciled = Math.abs(cashFlowStatement.netChange - cashFlow.net) < 0.005;
        return {
            ok: reconciled,
            title: `Net Cash Change: ${fmt(cashFlow.net)}`,
            sub: !cashFlow.hasCash
                ? 'No cash accounts found (name containing cash or bank)'
                : reconciled
                    ? 'Operating + Investing + Financing reconciles with the cash and bank accounts'
                    : `Statement differs from the cash accounts' actual change by ${fmt(cashFlowStatement.netChange - cashFlow.net)} — check account classifications`,
        };
    })();

    const totalCards = (() => {
        if (tab === 'balance') return [
            { label: 'Total Assets', value: balanceSheet.totals.assets, prev: balanceSheet.prevTotals?.assets ?? null, color: BLUE },
            { label: 'Total Liabilities', value: balanceSheet.totals.liabilities, prev: balanceSheet.prevTotals?.liabilities ?? null, color: RED },
            { label: 'Total Equity', value: balanceSheet.totals.equity, prev: balanceSheet.prevTotals?.equity ?? null, color: PURPLE },
        ];
        if (tab === 'income') return [
            { label: 'Total Revenue', value: incomeStatement.totals.totalRevenue, prev: incomeStatement.prevTotals?.totalRevenue ?? null, color: GREEN },
            { label: 'Gross Profit', value: incomeStatement.totals.grossProfit, prev: incomeStatement.prevTotals?.grossProfit ?? null, color: incomeStatement.totals.grossProfit < 0 ? RED : BLUE },
            { label: 'Total Expenses', value: incomeStatement.totals.expenses, prev: incomeStatement.prevTotals?.expenses ?? null, color: RED },
            { label: 'Net Income', value: incomeStatement.totals.net, prev: incomeStatement.prevTotals?.net ?? null, color: incomeStatement.totals.net < 0 ? RED : BLUE },
        ];
        if (tab === 'cashflow') return [
            { label: 'Net Cash from Operations', value: cashFlowStatement.netOperating, prev: null, color: cashFlowStatement.netOperating < 0 ? RED : BLUE },
            { label: 'Net Cash from Investing', value: cashFlowStatement.netInvesting, prev: null, color: cashFlowStatement.netInvesting < 0 ? RED : GREEN },
            { label: 'Net Cash from Financing', value: cashFlowStatement.netFinancing, prev: null, color: cashFlowStatement.netFinancing < 0 ? RED : PURPLE },
            { label: 'Ending Cash', value: cashFlow.closing, prev: null, color: cashFlow.closing < 0 ? RED : BLUE },
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
                    {tab === 'income' && (
                        <label title="Also list accounts with no activity in the period" style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: 'var(--color-text-main)', cursor: 'pointer', userSelect: 'none' }}>
                            <input type="checkbox" checked={showEmpty} onChange={e => setShowEmpty(e.target.checked)} style={{ accentColor: BLUE, cursor: 'pointer' }} />
                            Show empty accounts
                        </label>
                    )}
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
                            <span style={{ color: 'var(--color-text-main)' }}>Liabilities + Equity</span>
                            {amountText(balanceSheet.totals.liabilities + balanceSheet.totals.equity, true)}
                        </div>
                    </div>
                </div>
            )}

            {tab === 'income' && (() => {
                const t = incomeStatement.totals, pt = incomeStatement.prevTotals;
                const noActivity = showEmpty ? undefined : 'No activity in this period.';
                // Gross/Operating Profit and the closing Net line — the bars
                // between sections that make the statement read top-down.
                const KeyBar: React.FC<{ label: string; value: number; prevValue?: number; closing?: boolean }> = ({ label, value, prevValue, closing }) => {
                    const color = value < 0 ? RED : closing ? GREEN : BLUE;
                    return (
                        <div style={{ ...cardStyle, borderLeft: `4px solid ${color}`, background: closing ? `color-mix(in srgb, ${color} 5%, var(--color-surface))` : undefined, padding: closing ? '16px 20px' : '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
                            <span style={{ fontWeight: 800, fontSize: closing ? '16px' : '14px', color: 'var(--color-text-main)' }}>{label}</span>
                            <span style={{ display: 'flex', gap: '16px', alignItems: 'baseline' }}>
                                {compare && prevValue !== undefined && <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)', fontSize: '13px' }}>{loading ? '…' : fmt(prevValue)}</span>}
                                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: closing ? '20px' : '15px', color }}>{loading ? '…' : fmt(value)}</span>
                            </span>
                        </div>
                    );
                };
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '880px' }}>
                        <SectionCard title="Revenue" color={GREEN} rows={incomeStatement.revenue} totalLabel="Total Operating Revenue" total={t.revenue} prevTotal={pt?.revenue} emptyText={noActivity} />
                        <SectionCard title="Cost of Sales" color={AMBER} rows={incomeStatement.cogs} totalLabel="Total Cost of Sales" total={t.cogs} prevTotal={pt?.cogs} emptyText={noActivity} />
                        <KeyBar label="Gross Profit" value={t.grossProfit} prevValue={pt?.grossProfit} />
                        <SectionCard title="Operating Expenses" color={RED} rows={incomeStatement.opex} totalLabel="Total Operating Expenses" total={t.opex} prevTotal={pt?.opex} emptyText={noActivity} />
                        <KeyBar label="Operating Profit" value={t.operatingProfit} prevValue={pt?.operatingProfit} />
                        {incomeStatement.hasOtherRevenue && (
                            <SectionCard title="Other Revenue" color={GREEN} rows={incomeStatement.otherRevenue} totalLabel="Total Other Revenue" total={t.otherRevenue} prevTotal={pt?.otherRevenue} emptyText={noActivity} />
                        )}
                        {incomeStatement.hasOtherExpenses && (
                            <SectionCard title="Other Expenses" color={RED} rows={incomeStatement.otherExpenses} totalLabel="Total Other Expenses" total={t.otherExpenses} prevTotal={pt?.otherExpenses} emptyText={noActivity} />
                        )}
                        <KeyBar label={t.net >= 0 ? 'Net Income' : 'Net Loss'} value={t.net} prevValue={pt?.net} closing />
                    </div>
                );
            })()}

            {tab === 'cashflow' && (() => {
                const cf = cashFlowStatement;
                const lineRow = (r: StatementRow, last: boolean) => (
                    <div
                        key={`${r.code}|${r.name}`}
                        className={r.id ? 'hover-highlight' : undefined}
                        onClick={r.id ? () => goToLedger(r.id!) : undefined}
                        title={r.id ? 'View in General Ledger' : undefined}
                        style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 20px', borderBottom: last ? 'none' : '1px solid var(--color-border)', fontSize: '14px', cursor: r.id ? 'pointer' : 'default' }}
                    >
                        <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', width: '44px', flexShrink: 0 }}>{r.code}</span>
                        <span className="d2-khmer" style={{ flex: 1, color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: r.amount < 0 ? RED : GREEN }}>{loading ? '…' : fmt(r.amount)}</span>
                    </div>
                );
                const footerRow = (label: string, value: number) => (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '12px 20px', borderTop: '2px solid var(--color-border)', background: 'var(--color-bg)', fontSize: '14px', fontWeight: 700 }}>
                        <span style={{ color: 'var(--color-text-main)' }}>{label}</span>
                        {amountText(value, true)}
                    </div>
                );
                const subHeader = (label: string) => (
                    <div style={{ padding: '10px 20px 4px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{label}</div>
                );
                const activityHeader = (label: string, color: string) => (
                    <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', fontSize: '12px', fontWeight: 800, letterSpacing: '0.8px', textTransform: 'uppercase', color }}>{label}</div>
                );
                const emptyNote = (text: string) => (
                    <div style={{ padding: '14px 20px', fontSize: '13px', fontStyle: 'italic', color: 'var(--color-text-secondary)' }}>{text}</div>
                );
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '880px' }}>
                        <div style={{ ...cardStyle, borderLeft: `4px solid ${BLUE}`, overflow: 'hidden' }}>
                            {activityHeader('Operating Activities', BLUE)}
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '12px 20px', borderBottom: '1px solid var(--color-border)', fontSize: '14px', fontWeight: 700 }}>
                                <span style={{ color: 'var(--color-text-main)' }}>Net Income</span>
                                {amountText(cf.netIncome, true)}
                            </div>
                            {subHeader('Changes in Working Capital')}
                            {cf.workingCapital.length === 0
                                ? emptyNote('No working-capital movements')
                                : cf.workingCapital.map((r, i) => lineRow(r, i === cf.workingCapital.length - 1))}
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '10px 20px', borderTop: '1px solid var(--color-border)', fontSize: '13px', fontWeight: 700 }}>
                                <span style={{ color: 'var(--color-text-secondary)' }}>Total Changes in Working Capital</span>
                                {amountText(cf.totalWC)}
                            </div>
                            {footerRow('Net Cash from Operations', cf.netOperating)}
                        </div>

                        <div style={{ ...cardStyle, borderLeft: `4px solid ${GREEN}`, overflow: 'hidden' }}>
                            {activityHeader('Investing Activities', GREEN)}
                            {cf.investing.length === 0
                                ? emptyNote('No investing activities')
                                : cf.investing.map((r, i) => lineRow(r, i === cf.investing.length - 1))}
                            {footerRow('Net Cash from Investing', cf.netInvesting)}
                        </div>

                        <div style={{ ...cardStyle, borderLeft: `4px solid ${PURPLE}`, overflow: 'hidden' }}>
                            {activityHeader('Financing Activities', PURPLE)}
                            {cf.financing.length === 0
                                ? emptyNote('No financing activities')
                                : cf.financing.map((r, i) => lineRow(r, i === cf.financing.length - 1))}
                            {footerRow('Net Cash from Financing', cf.netFinancing)}
                        </div>

                        <div style={{ ...cardStyle, overflow: 'hidden' }}>
                            {activityHeader('Cash Summary', 'var(--color-text-secondary)')}
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '10px 20px', borderBottom: '1px solid var(--color-border)', fontSize: '14px' }}>
                                <span style={{ color: 'var(--color-text-secondary)' }}>Beginning Cash Balance ({displayDate(startDate)})</span>
                                {amountText(cashFlow.opening)}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '10px 20px', borderBottom: '1px solid var(--color-border)', fontSize: '14px' }}>
                                <span style={{ color: 'var(--color-text-secondary)' }}>Net Change in Cash</span>
                                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: cf.netChange < 0 ? RED : GREEN }}>{loading ? '…' : fmt(cf.netChange)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '14px 20px', background: 'var(--color-bg)', fontSize: '15px', fontWeight: 800 }}>
                                <span style={{ color: 'var(--color-text-main)' }}>Ending Cash Balance ({displayDate(endDate)})</span>
                                {amountText(cashFlow.closing, true)}
                            </div>
                        </div>

                        {/* The direct view kept as detail: each counter-account's
                            share of the period's actual cash deltas. */}
                        <div style={{ ...cardStyle, borderLeft: `4px solid ${BLUE}`, overflow: 'hidden' }}>
                    <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)' }}>
                        <div style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '0.8px', textTransform: 'uppercase', color: BLUE }}>Cash Movements</div>
                        <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>Where the cash actually moved — each entry's cash change attributed to its counter-accounts</div>
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
                    {footerRow('Net change in cash', cashFlow.net)}
                        </div>
                    </div>
                );
            })()}

            {tab === 'trial' && isMobile && (
                <div style={{ ...cardStyle, overflow: 'hidden' }}>
                    {/* Phones: one row per account — no sideways scrolling. */}
                    {trialBalance.rows.map(r => (
                        <div
                            key={`${r.code}|${r.name}`}
                            className="hover-highlight"
                            onClick={() => goToLedger(r.id)}
                            title="View in General Ledger"
                            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderBottom: '1px solid var(--color-border)', cursor: 'pointer' }}
                        >
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="d2-khmer" style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                                <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '1px' }}>{r.code} · {r.type.toUpperCase()}</div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontSize: '13px' }}>
                                {loading ? '…' : r.debit ? <span style={{ color: BLUE, fontWeight: 600 }}>Dr {fmt(r.debit)}</span> : r.credit ? <span style={{ color: RED, fontWeight: 600 }}>Cr {fmt(r.credit)}</span> : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                            </div>
                        </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '12px 14px', background: 'var(--color-bg)', fontWeight: 800, fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>
                        <span style={{ color: BLUE }}>Dr {loading ? '…' : fmt(trialBalance.totals.debit)}</span>
                        <span style={{ color: RED }}>Cr {loading ? '…' : fmt(trialBalance.totals.credit)}</span>
                    </div>
                </div>
            )}

            {tab === 'trial' && !isMobile && (
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
                                    <tr
                                        key={`${r.code}|${r.name}`}
                                        className="hover-highlight"
                                        onClick={() => goToLedger(r.id)}
                                        title="View in General Ledger"
                                        style={{ borderBottom: '1px solid var(--color-border)', background: i % 2 ? 'rgba(0,0,0,0.015)' : 'transparent', cursor: 'pointer' }}
                                    >
                                        <td style={{ padding: '10px 20px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>{r.code}</td>
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
