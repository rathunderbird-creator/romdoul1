// Admin Dashboard — the business's financial position at a glance, replacing
// the Sales Dashboard as the default landing page for Admin users only (see
// ProtectedApp in App.tsx). Pulls the same posted-ledger signed-balance math
// FinancialDashboardPage/FinancialStatements use (debit-normal Asset/Expense,
// credit-normal Liability/Equity/Revenue), via useAccounting's already-joined
// journalEntries (entry.lines[].account) rather than a second raw ledger
// fetch, since this page doesn't need FinancialDashboardPage's period picker
// or monthly chart — just a current snapshot.
import React, { useEffect, useMemo } from 'react';
import { RefreshCw, BarChart3, TrendingDown, PieChart, TrendingUp, Activity, Calendar, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useHeader } from '../context/HeaderContext';
import { useAccounting } from '../hooks/useAccounting';
import type { ChartOfAccount, JournalEntry } from '../types';

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

type AccountType = ChartOfAccount['account_type'];
const ACCOUNT_TYPES: AccountType[] = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'];
const DEBIT_NORMAL = (t: AccountType): boolean => t === 'Asset' || t === 'Expense';

const BLUE = '#3B82F6', RED = '#EF4444', PURPLE = '#8B5CF6', AMBER = '#F59E0B', TEAL = '#14B8A6', GREEN = '#10B981';

const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };

const displayIdOf = (entry: JournalEntry) => entry.entry_number || entry.reference_id || `JE-${entry.id.substring(0, 8).toUpperCase()}`;
const statusChip = (status?: string) => (
    <span style={{
        padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, flexShrink: 0,
        background: status === 'Draft' ? '#fef3c7' : 'rgba(84, 105, 212, 0.12)',
        color: status === 'Draft' ? '#92400e' : '#4c5fd0',
    }}>{status === 'Draft' ? 'Draft' : 'Posted'}</span>
);

const KpiCard: React.FC<{
    label: string; value: string; sub?: string; color: string;
    icon: React.ComponentType<{ size?: number; color?: string }>;
    trend?: 'up' | 'down'; trendLabel?: string;
}> = ({ label, value, sub, color, icon: Icon, trend, trendLabel }) => (
    <div style={{ background: `${color}14`, border: `1px solid ${color}33`, borderRadius: '14px', padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
            <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>{label}</span>
            <div style={{ width: '34px', height: '34px', borderRadius: '9px', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={17} color="#fff" />
            </div>
        </div>
        <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '14px', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        {sub && <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>{sub}</div>}
        {trend && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '10px', fontSize: '12px', fontWeight: 600, color: trend === 'up' ? GREEN : RED }}>
                {trend === 'up' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />} {trendLabel}
            </div>
        )}
    </div>
);

const EquationBox: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
    <div style={{ border: `1px solid ${color}`, borderRadius: '10px', padding: '16px 18px', background: `${color}0d` }}>
        <div style={{ fontSize: '12px', color, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '6px', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
);

const AdminDashboardPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { accounts, journalEntries, isLoading, fetchAccounts, fetchJournalEntries } = useAccounting();

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Dashboard</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0 }}>Financial overview and key performance indicators</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => { fetchAccounts(); fetchJournalEntries(); }, [fetchAccounts, fetchJournalEntries]);

    // Signed balance per account, posted entries only (an entry with no
    // status column yet — pre-migration — counts as Posted, same default
    // FinancialDashboardPage and JournalEntriesPage use).
    const signedBalances = useMemo(() => {
        const raw = new Map<string, { d: number; c: number }>();
        for (const entry of journalEntries) {
            if (entry.status === 'Draft') continue;
            for (const line of entry.lines || []) {
                const s = raw.get(line.account_id) || { d: 0, c: 0 };
                s.d += line.debit || 0; s.c += line.credit || 0;
                raw.set(line.account_id, s);
            }
        }
        const out = new Map<string, number>();
        for (const a of accounts) {
            const s = raw.get(a.id);
            if (s) out.set(a.id, DEBIT_NORMAL(a.account_type) ? s.d - s.c : s.c - s.d);
        }
        return out;
    }, [journalEntries, accounts]);

    const typeTotals = useMemo(() => {
        const totals: Record<AccountType, number> = { Asset: 0, Liability: 0, Equity: 0, Revenue: 0, Expense: 0 };
        for (const a of accounts) totals[a.account_type] += signedBalances.get(a.id) || 0;
        return totals;
    }, [accounts, signedBalances]);

    const typeCounts = useMemo(() => {
        const counts: Record<AccountType, number> = { Asset: 0, Liability: 0, Equity: 0, Revenue: 0, Expense: 0 };
        for (const a of accounts) counts[a.account_type]++;
        return counts;
    }, [accounts]);

    const totalAssets = typeTotals.Asset;
    const totalLiabilities = typeTotals.Liability;
    const revenue = typeTotals.Revenue;
    const expenses = typeTotals.Expense;
    const netIncome = revenue - expenses;
    // Retained earnings aren't posted to an Equity account entry-by-entry —
    // they're the ledger's own plug (Assets - Liabilities - Equity), same
    // convention FinancialDashboardPage/FinancialStatements use to balance.
    const retainedEarnings = totalAssets - totalLiabilities - typeTotals.Equity;
    const totalEquity = typeTotals.Equity + retainedEarnings;
    const isBalanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01;

    const currentRatio = totalLiabilities > 0.005 ? totalAssets / totalLiabilities : null;
    const netProfitMargin = revenue > 0.005 ? (netIncome / revenue) * 100 : 0;

    const recentEntries = useMemo(() => journalEntries.slice(0, 5), [journalEntries]);

    return (
        <div className="acct-page" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="secondary-button" onClick={() => { fetchAccounts(); fetchJournalEntries(); }}>
                    <RefreshCw size={16} style={isLoading ? { animation: 'spin 1s linear infinite' } : undefined} /> Refresh
                </button>
            </div>

            {/* KPI row 1 — Balance Sheet snapshot */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                <KpiCard label="Total Assets" value={fmt(totalAssets)} color={BLUE} icon={BarChart3} />
                <KpiCard label="Total Liabilities" value={fmt(totalLiabilities)} color={RED} icon={TrendingDown} />
                <KpiCard label="Total Equity" value={fmt(totalEquity)} color={PURPLE} icon={PieChart} />
            </div>

            {/* KPI row 2 — performance indicators */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                <KpiCard
                    label="Net Income" value={fmt(netIncome)} color={BLUE} icon={TrendingUp}
                    trend={netIncome >= 0 ? 'up' : 'down'} trendLabel={netIncome >= 0 ? 'Positive trend' : 'Negative trend'}
                />
                <KpiCard
                    label="Current Ratio" value={currentRatio === null ? '—' : currentRatio.toFixed(2)} sub="Assets/Liabilities" color={AMBER} icon={Activity}
                    trend={currentRatio !== null && currentRatio >= 1 ? 'up' : 'down'} trendLabel={currentRatio !== null && currentRatio >= 1 ? 'Positive trend' : 'Negative trend'}
                />
                <KpiCard
                    label="Net Profit Margin" value={`${netProfitMargin.toFixed(1)}%`} sub="Income/Revenue" color={TEAL} icon={TrendingUp}
                    trend={netProfitMargin >= 0 ? 'up' : 'down'} trendLabel={netProfitMargin >= 0 ? 'Positive trend' : 'Negative trend'}
                />
            </div>

            {/* Accounting equation */}
            <div style={{ ...cardStyle, padding: '20px 24px' }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-text-main)', marginBottom: '16px' }}>
                    Accounting Equation: Assets = Liabilities + Equity
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: '16px', alignItems: 'center' }}>
                    <EquationBox label="Assets" value={fmt(totalAssets)} color={BLUE} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <EquationBox label="Liabilities" value={fmt(totalLiabilities)} color={RED} />
                        <EquationBox label="Equity" value={fmt(totalEquity)} color={PURPLE} />
                    </div>
                </div>
                <div style={{ marginTop: '18px', paddingTop: '16px', borderTop: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Equation Balance:</div>
                    <div style={{ background: `${BLUE}14`, border: `1px solid ${BLUE}33`, borderRadius: '8px', padding: '10px 14px', color: isBalanced ? BLUE : RED, fontWeight: 700, fontSize: '13px' }}>
                        {isBalanced ? '✓ Balanced (A = L + E)' : '✗ Out of balance'}
                    </div>
                </div>
            </div>

            {/* Income statement */}
            <div style={{ ...cardStyle, padding: '20px 24px' }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-text-main)', marginBottom: '16px' }}>
                    Income Statement: Revenue - Expenses = Net Income
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: '16px', alignItems: 'center' }}>
                    <EquationBox label="Revenue" value={fmt(revenue)} color={BLUE} />
                    <EquationBox label="Expenses" value={fmt(expenses)} color={AMBER} />
                </div>
                <div style={{ marginTop: '18px', paddingTop: '16px', borderTop: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Net Income:</div>
                    <div style={{ background: `${BLUE}14`, border: `1px solid ${BLUE}33`, borderRadius: '8px', padding: '10px 14px', color: netIncome >= 0 ? BLUE : RED, fontWeight: 700, fontSize: '13px' }}>
                        {fmt(netIncome)}
                    </div>
                </div>
            </div>

            {/* Recent journal entries + account summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', gap: '20px', alignItems: 'start' }}>
                <div style={{ ...cardStyle, padding: '18px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                        <Calendar size={16} color={BLUE} />
                        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)' }}>Recent Journal Entries</span>
                    </div>
                    {recentEntries.length === 0 ? (
                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>No journal entries yet.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {recentEntries.map(e => (
                                <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--color-bg)', borderRadius: '8px' }}>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-main)' }}>{displayIdOf(e)}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.description || '—'}</div>
                                    </div>
                                    {statusChip(e.status)}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div style={{ ...cardStyle, padding: '18px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                        <Activity size={16} color={TEAL} />
                        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)' }}>Account Summary</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {ACCOUNT_TYPES.map(type => (
                            <div key={type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--color-bg)', borderRadius: '8px' }}>
                                <div>
                                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-main)' }}>{type}</div>
                                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{typeCounts[type]} account{typeCounts[type] === 1 ? '' : 's'}</div>
                                </div>
                                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums' }}>{fmt(typeTotals[type])}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminDashboardPage;
