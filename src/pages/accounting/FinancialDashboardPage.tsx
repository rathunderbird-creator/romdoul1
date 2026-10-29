// Financial Dashboard — the business's financial position at a glance: cash,
// what's owed to and by the business, revenue/expense for the period, and a
// Balance Sheet snapshot, with quick links into the full reports.
//
// Balance Sheet / Income Statement figures are struck from the ledger
// (journal_entry_lines), POSTED entries only — same source and the same
// debit-normal signed-balance math FinancialStatements.tsx uses for the
// real statements, kept as a separate, self-contained computation here
// rather than refactoring that component, since Balance Sheet/Income
// Statement correctness is too high-stakes to risk for a dashboard.
// Receivable/Payable figures mirror AccountsReceivablePage/
// AccountsPayablePage's own simpler order-based totals (not the ledger) —
// same simplification Purchase Dashboard's own Payables card already makes.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Wallet, HandCoins, Scale, TrendingUp, ArrowDownUp, BookOpen, ClipboardList, LayoutDashboard } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useHeader } from '../../context/HeaderContext';
import { useMobile } from '../../hooks/useMobile';
import { useProcurement } from '../../hooks/useProcurement';
import { useWholesale } from '../../hooks/useWholesale';
import { supabase } from '../../lib/supabase';
import { dayKeyFromDate, addDays } from '../../utils/dateRange';
import type { ChartOfAccount } from '../../types';

const fmt = (n: number) => (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayYmd = () => dayKeyFromDate(new Date());
const monthKeyOf = (d: string) => String(d || '').slice(0, 7);
const monthLabel = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};
const addMonths = (ym: string, delta: number) => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthEnd = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};

type AccountType = ChartOfAccount['account_type'];
const DEBIT_NORMAL = (t: AccountType): boolean => t === 'Asset' || t === 'Expense';
interface LedgerLine { accountId: string; debit: number; credit: number; date: string }

const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };
const inputStyle: React.CSSProperties = { padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', outline: 'none', background: 'var(--color-surface)', color: 'var(--color-text-main)' };
const BLUE = '#3B82F6', RED = '#EF4444', GREEN = '#10B981', AMBER = '#F59E0B', PURPLE = '#8B5CF6';

const KpiCard: React.FC<{ label: string; value: React.ReactNode; sub: string; color?: string; loading: boolean }> = ({ label, value, sub, color, loading }) => (
    <div style={{ ...cardStyle, padding: '16px 20px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{label}</div>
        <div style={{ fontSize: '22px', fontWeight: 800, color: color || 'var(--color-text-main)', marginTop: '6px', fontVariantNumeric: 'tabular-nums' }}>{loading ? '…' : value}</div>
        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>{sub}</div>
    </div>
);
const Tile: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
    <div style={{ background: `${color}14`, border: `1px solid ${color}33`, borderRadius: '10px', padding: '10px 14px', flex: 1, minWidth: '110px' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color }}>{label}</div>
        <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '4px' }}>{fmt(value)}</div>
        <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>USD</div>
    </div>
);
const ReportLink: React.FC<{ label: string; icon: React.ComponentType<{ size?: number; color?: string }>; path: string; onClick: (path: string) => void }> = ({ label, icon: Icon, path, onClick }) => (
    <button onClick={() => onClick(path)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
        <Icon size={16} color={BLUE} />
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)' }}>{label}</span>
    </button>
);

const FinancialDashboardPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const navigate = useNavigate();
    const { purchaseOrders, fetchPurchaseOrders } = useProcurement();
    const { wholesaleOrders, fetchWholesaleOrders } = useWholesale();
    const isMobile = useMobile();

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Financial Dashboard</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0 }}>Cash, what's owed to and by the business, and revenue vs. expense for the period.</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchPurchaseOrders();
        fetchWholesaleOrders();
    }, [fetchPurchaseOrders, fetchWholesaleOrders]);

    // ── Ledger lines (posted only) — same source/filter FinancialStatements
    // uses for the real Balance Sheet / Income Statement, fetched separately
    // here so this page never depends on (or risks) that component's state. ──
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
    const isLoading = lines === null;

    // Signed balance per account, over the lines passing `keep`.
    const signedBalances = useCallback((keep: (l: LedgerLine) => boolean): Map<string, number> => {
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
    }, [lines, accounts]);

    const sumByType = useCallback((type: AccountType, bal: Map<string, number>) =>
        accounts.filter(a => a.account_type === type).reduce((s, a) => s + (bal.get(a.id) || 0), 0),
    [accounts]);

    const today = useMemo(() => todayYmd(), []);
    const [endingMonth, setEndingMonth] = useState(() => monthKeyOf(todayYmd()));
    const periodStart = `${endingMonth}-01`;
    const periodEndRaw = monthEnd(endingMonth);
    const periodEnd = periodEndRaw > today ? today : periodEndRaw;
    const startMonth = useMemo(() => addMonths(endingMonth, -11), [endingMonth]);

    // ── Balance Sheet, as of today (always "now", independent of the Income
    // Statement period picker below — a balance is a snapshot, not a range). ──
    const asOfBalances = useMemo(() => signedBalances(l => l.date <= today), [signedBalances, today]);
    const totalAssets = useMemo(() => sumByType('Asset', asOfBalances), [sumByType, asOfBalances]);
    const totalLiabilities = useMemo(() => sumByType('Liability', asOfBalances), [sumByType, asOfBalances]);
    const totalEquityLedger = useMemo(() => sumByType('Equity', asOfBalances), [sumByType, asOfBalances]);
    // Retained earnings aren't posted to an Equity account entry-by-entry —
    // they're the ledger's own plug (Assets - Liabilities - Equity), same
    // convention FinancialStatements' Balance Sheet tab uses to balance.
    const retainedEarnings = totalAssets - totalLiabilities - totalEquityLedger;
    const totalEquity = totalEquityLedger + retainedEarnings;

    const cashAccountIds = useMemo(
        () => new Set(accounts.filter(a => a.account_type === 'Asset' && /cash|bank/i.test(a.account_name)).map(a => a.id)),
        [accounts]
    );
    const cashPosition = useMemo(() => {
        let total = 0;
        for (const [id, bal] of asOfBalances) if (cashAccountIds.has(id)) total += bal;
        return total;
    }, [asOfBalances, cashAccountIds]);

    // ── Income Statement, for the selected period ──
    const periodBalances = useMemo(
        () => signedBalances(l => l.date >= periodStart && l.date <= periodEnd),
        [signedBalances, periodStart, periodEnd]
    );
    const revenue = useMemo(() => sumByType('Revenue', periodBalances), [sumByType, periodBalances]);
    const expenses = useMemo(() => sumByType('Expense', periodBalances), [sumByType, periodBalances]);
    const netIncome = revenue - expenses;

    // ── Revenue vs Expense by month, across the 12-month window ──
    const byMonth = useMemo(() => {
        const months: string[] = [];
        for (let i = 0; i < 12; i++) months.push(addMonths(startMonth, i));
        return months.map(ym => {
            const from = `${ym}-01`, to = monthEnd(ym);
            const bal = signedBalances(l => l.date >= from && l.date <= to);
            return { month: monthLabel(ym), revenue: sumByType('Revenue', bal), expense: sumByType('Expense', bal) };
        });
    }, [startMonth, signedBalances, sumByType]);

    // ── Receivables: wholesale credit sales still owed (mirror of Accounts
    // Receivable's main channel; that page also folds in warehouse transfers,
    // a secondary source this snapshot leaves out). ──
    const openReceivables = useMemo(() => wholesaleOrders.filter(o => o.status !== 'Cancelled' && ((o.total_amount || 0) - (o.amount_paid || 0)) > 0.005), [wholesaleOrders]);
    const receivable = useMemo(() => {
        const due7 = addDays(today, 7), due30 = addDays(today, 30);
        let overdue = 0, within7 = 0, within30 = 0, outstanding = 0;
        for (const o of openReceivables) {
            const out = (o.total_amount || 0) - (o.amount_paid || 0);
            outstanding += out;
            const due = o.due_date;
            if (due && due < today) overdue += out;
            if (due && due >= today && due <= due7) within7 += out;
            if (due && due >= today && due <= due30) within30 += out;
        }
        return { overdue, within7, within30, outstanding };
    }, [openReceivables, today]);

    // ── Payables: supplier bills still owed (same computation as Purchase
    // Dashboard's own Payables card). ──
    const bills = useMemo(() => purchaseOrders.filter(po => po.status === 'Received' && !!po.invoice_number), [purchaseOrders]);
    const payable = useMemo(() => {
        const due7 = addDays(today, 7), due30 = addDays(today, 30);
        let overdue = 0, within7 = 0, within30 = 0, outstanding = 0;
        for (const po of bills) {
            const out = (po.total_amount || 0) - (po.amount_paid || 0);
            if (out <= 0.005) continue;
            outstanding += out;
            const due = po.payment_due_date;
            if (due && due < today) overdue += out;
            if (due && due >= today && due <= due7) within7 += out;
            if (due && due >= today && due <= due30) within30 += out;
        }
        return { overdue, within7, within30, outstanding };
    }, [bills, today]);

    return (
        <div style={isMobile ? { display: 'flex', flexDirection: 'column', gap: '20px' } : { display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
            <div className="acct-page" style={{ flex: isMobile ? undefined : '8 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '18px' }}>
                {/* Filter */}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '5px' }}>Ending month</label>
                        <input type="month" value={endingMonth} max={monthKeyOf(today)} onChange={e => setEndingMonth(e.target.value || monthKeyOf(today))} style={inputStyle} />
                    </div>
                    <button onClick={() => { fetchPurchaseOrders(); fetchWholesaleOrders(); setRefreshKey(k => k + 1); }} title="Refresh" style={{ ...inputStyle, cursor: 'pointer', display: 'flex' }}>
                        <RefreshCw size={15} style={isLoading ? { animation: 'spin 1s linear infinite' } : {}} />
                    </button>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                    Income Statement: {monthLabel(startMonth)} – {monthLabel(endingMonth)} · Balance Sheet: as of {today} · Amounts in USD, posted entries only
                </div>

                {/* KPI row 1 — the period */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                    <KpiCard label="Revenue" value={fmt(revenue)} sub={monthLabel(endingMonth)} color={GREEN} loading={isLoading} />
                    <KpiCard label="Expenses" value={fmt(expenses)} sub={monthLabel(endingMonth)} color={RED} loading={isLoading} />
                    <KpiCard label="Net income" value={fmt(netIncome)} sub={netIncome >= 0 ? 'Profit' : 'Loss'} color={netIncome >= 0 ? GREEN : RED} loading={isLoading} />
                    <KpiCard label="Cash position" value={fmt(cashPosition)} sub="All cash & bank accounts, today" color={BLUE} loading={isLoading} />
                </div>

                {/* KPI row 2 — Balance Sheet snapshot */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                    <KpiCard label="Total assets" value={fmt(totalAssets)} sub="As of today" loading={isLoading} />
                    <KpiCard label="Total liabilities" value={fmt(totalLiabilities)} sub="As of today" color={totalLiabilities > 0 ? AMBER : undefined} loading={isLoading} />
                    <KpiCard label="Total equity" value={fmt(totalEquity)} sub="Including retained earnings" color={PURPLE} loading={isLoading} />
                    <KpiCard label="Receivable" value={fmt(receivable.outstanding)} sub={`${openReceivables.length} order${openReceivables.length === 1 ? '' : 's'} open`} color={receivable.overdue > 0 ? RED : GREEN} loading={isLoading} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: '20px', alignItems: 'start' }}>
                    {/* Receivables */}
                    <div style={{ ...cardStyle, padding: '18px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                            <HandCoins size={16} color={GREEN} />
                            <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)' }}>Receivables</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Owed by customers as of today. Wholesale credit sales only.</span>
                            <button onClick={() => navigate('/accounting/receivable')} style={{ background: 'none', border: 'none', color: BLUE, fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: '8px' }}>Open report →</button>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
                            <Tile label="Overdue" value={receivable.overdue} color={RED} />
                            <Tile label="Due in 7 days" value={receivable.within7} color={AMBER} />
                            <Tile label="Due in 30 days" value={receivable.within30} color={BLUE} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '8px 0', borderTop: '1px solid var(--color-border)', fontWeight: 700 }}>
                            <span style={{ fontSize: '13px', color: 'var(--color-text-main)' }}>Outstanding</span>
                            <span style={{ fontSize: '14px', color: 'var(--color-text-main)' }}>{fmt(receivable.outstanding)}</span>
                        </div>
                    </div>

                    {/* Payables */}
                    <div style={{ ...cardStyle, padding: '18px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                            <Wallet size={16} color={AMBER} />
                            <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)' }}>Payables</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Owed to suppliers as of today.</span>
                            <button onClick={() => navigate('/accounting/payable')} style={{ background: 'none', border: 'none', color: BLUE, fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: '8px' }}>Open report →</button>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
                            <Tile label="Overdue" value={payable.overdue} color={RED} />
                            <Tile label="Due in 7 days" value={payable.within7} color={AMBER} />
                            <Tile label="Due in 30 days" value={payable.within30} color={BLUE} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '8px 0', borderTop: '1px solid var(--color-border)', fontWeight: 700 }}>
                            <span style={{ fontSize: '13px', color: 'var(--color-text-main)' }}>Outstanding</span>
                            <span style={{ fontSize: '14px', color: 'var(--color-text-main)' }}>{fmt(payable.outstanding)}</span>
                        </div>
                    </div>
                </div>

                {/* Revenue vs Expense by month */}
                <div style={{ ...cardStyle, padding: '18px 20px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)' }}>Revenue vs. Expense by month</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>Posted journal entries only, in USD.</div>
                    <div style={{ height: '280px' }}>
                        {isLoading ? (
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading…</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={byMonth} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                                    <XAxis dataKey="month" stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} />
                                    <YAxis stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(Number(v))} />
                                    <Tooltip
                                        contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        formatter={((value: any, name: any) => [fmt(Number(value)), name]) as any}
                                    />
                                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                                    <Bar dataKey="revenue" name="Revenue" fill={GREEN} radius={[4, 4, 0, 0]} maxBarSize={28} />
                                    <Bar dataKey="expense" name="Expense" fill={RED} radius={[4, 4, 0, 0]} maxBarSize={28} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                {/* Quick links into the full reports */}
                <div style={{ ...cardStyle, padding: '18px 20px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)', marginBottom: '12px' }}>Reports</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                        <ReportLink label="Financial Reports" icon={ClipboardList} path="/accounting/financial-reports" onClick={navigate} />
                        <ReportLink label="Balance Sheet" icon={Scale} path="/accounting/balance-sheet" onClick={navigate} />
                        <ReportLink label="Income Statement" icon={TrendingUp} path="/accounting/income-statement" onClick={navigate} />
                        <ReportLink label="Cash In / Out" icon={ArrowDownUp} path="/accounting/cash-in-out" onClick={navigate} />
                        <ReportLink label="General Ledger" icon={BookOpen} path="/accounting/general-ledger" onClick={navigate} />
                        <ReportLink label="Journal Entries" icon={LayoutDashboard} path="/accounting/journal-entries" onClick={navigate} />
                    </div>
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

export default FinancialDashboardPage;
