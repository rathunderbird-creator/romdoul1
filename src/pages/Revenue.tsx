import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, DollarSign, BarChart3 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import { supabase } from '../lib/supabase';
import StatsCard from '../components/StatsCard';
import DateRangePicker from '../components/DateRangePicker';
import type { Transaction } from '../types';

const parseDate = (dateStr: string) => {
    if (!dateStr) return new Date();
    const safeStr = dateStr.includes(' ') ? dateStr.replace(' ', 'T') : dateStr;
    const d = new Date(safeStr);
    return isNaN(d.getTime()) ? new Date() : d;
};

const Revenue: React.FC = () => {
    const { hasPermission } = useStore();
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();

    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Revenue</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Income vs Expense overview</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    const fetchTransactions = useCallback(async () => {
        setIsLoading(true);
        try {
            let query = supabase.from('transactions').select('*');

            if (dateRange.start) {
                const start = new Date(dateRange.start);
                start.setHours(0, 0, 0, 0);
                query = query.gte('date', start.toISOString());
            }
            if (dateRange.end) {
                const end = new Date(dateRange.end);
                end.setHours(23, 59, 59, 999);
                query = query.lte('date', end.toISOString());
            }
            if (!dateRange.start && !dateRange.end) {
                query = query.limit(2000);
            }

            const { data, error } = await query.order('date', { ascending: false });
            if (error) throw error;
            setTransactions((data || []) as Transaction[]);
        } catch (err) {
            console.error('Failed to fetch transactions:', err);
        } finally {
            setIsLoading(false);
        }
    }, [dateRange]);

    useEffect(() => {
        fetchTransactions();
    }, [fetchTransactions]);

    // Stats
    const stats = useMemo(() => {
        let totalIncome = 0;
        let totalExpense = 0;

        transactions.forEach(t => {
            if (t.type === 'Income') totalIncome += Number(t.amount);
            if (t.type === 'Expense') totalExpense += Number(t.amount);
        });

        return {
            totalIncome,
            totalExpense,
            netRevenue: totalIncome - totalExpense,
            profitMargin: totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome * 100) : 0,
            incomeCount: transactions.filter(t => t.type === 'Income').length,
            expenseCount: transactions.filter(t => t.type === 'Expense').length
        };
    }, [transactions]);

    // Monthly breakdown
    const monthlyData = useMemo(() => {
        const months: Record<string, { income: number; expense: number; net: number }> = {};

        transactions.forEach(t => {
            const d = parseDate(t.date);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (!months[key]) months[key] = { income: 0, expense: 0, net: 0 };
            if (t.type === 'Income') months[key].income += Number(t.amount);
            if (t.type === 'Expense') months[key].expense += Number(t.amount);
            months[key].net = months[key].income - months[key].expense;
        });

        return Object.entries(months)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([month, data]) => ({ month, ...data }));
    }, [transactions]);

    // Category breakdown
    const categoryBreakdown = useMemo(() => {
        const incomeCategories: Record<string, number> = {};
        const expenseCategories: Record<string, number> = {};

        transactions.forEach(t => {
            const cat = t.category || 'Uncategorized';
            if (t.type === 'Income') {
                incomeCategories[cat] = (incomeCategories[cat] || 0) + Number(t.amount);
            } else {
                expenseCategories[cat] = (expenseCategories[cat] || 0) + Number(t.amount);
            }
        });

        return { incomeCategories, expenseCategories };
    }, [transactions]);

    const topIncomeCategories = Object.entries(categoryBreakdown.incomeCategories)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8);
    const topExpenseCategories = Object.entries(categoryBreakdown.expenseCategories)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8);

    if (!hasPermission('manage_income_expense')) {
        return (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                You do not have permission to view Revenue.
            </div>
        );
    }

    const maxIncomeBar = topIncomeCategories.length > 0 ? topIncomeCategories[0][1] : 1;
    const maxExpenseBar = topExpenseCategories.length > 0 ? topExpenseCategories[0][1] : 1;

    return (
        <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'flex-end', marginBottom: '24px', gap: '16px' }}>
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 8px 0', color: 'var(--color-primary)' }}>Revenue Overview</h1>
                    <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>Analyze income vs expense and net profit.</p>
                </div>
                <div style={{ width: isMobile ? '100%' : 'auto' }}>
                    <DateRangePicker value={dateRange} onChange={setDateRange} compact={!isMobile} />
                </div>
            </div>

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
                <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '20px', border: '1px solid rgba(16, 185, 129, 0.25)', background: 'var(--color-surface)' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, transparent 100%)' }} />
                    <div style={{ position: 'relative', padding: '8px' }}>
                        <StatsCard title="Total Income" value={`$${stats.totalIncome.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} icon={TrendingUp} color="#10B981" trend={`${stats.incomeCount} transactions`} />
                    </div>
                </div>
                <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '20px', border: '1px solid rgba(239, 68, 68, 0.25)', background: 'var(--color-surface)' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, transparent 100%)' }} />
                    <div style={{ position: 'relative', padding: '8px' }}>
                        <StatsCard title="Total Expense" value={`$${stats.totalExpense.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} icon={TrendingDown} color="#EF4444" trend={`${stats.expenseCount} transactions`} />
                    </div>
                </div>
                <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '20px', border: `1px solid ${stats.netRevenue >= 0 ? 'rgba(59, 130, 246, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`, background: 'var(--color-surface)' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: `linear-gradient(135deg, ${stats.netRevenue >= 0 ? 'rgba(59, 130, 246, 0.12)' : 'rgba(239, 68, 68, 0.12)'} 0%, transparent 100%)` }} />
                    <div style={{ position: 'relative', padding: '8px' }}>
                        <StatsCard title="Net Revenue" value={`$${stats.netRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} icon={DollarSign} color={stats.netRevenue >= 0 ? '#3B82F6' : '#EF4444'} trend={`Margin: ${stats.profitMargin.toFixed(1)}%`} />
                    </div>
                </div>
            </div>

            {isLoading ? (
                <div style={{ padding: '60px', textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading...</div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '24px' }}>
                    {/* Monthly Revenue Table */}
                    <div className="glass-panel" style={{ overflow: 'auto', gridColumn: isMobile ? '1' : '1 / -1', border: '1px solid var(--color-border)' }}>
                        <h3 style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', margin: 0, fontSize: '15px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-main)', position: 'sticky', top: 0, background: 'var(--color-surface)', zIndex: 10 }}>
                            <BarChart3 size={18} style={{ color: 'var(--color-primary)' }} /> Monthly Breakdown
                        </h3>
                        {monthlyData.length === 0 ? (
                            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '13px' }}>No data available.</div>
                        ) : (
                            <table className="spreadsheet-table">
                                <thead>
                                    <tr>
                                        <th>Month</th>
                                        <th style={{ textAlign: 'right', color: '#10B981' }}>Income</th>
                                        <th style={{ textAlign: 'right', color: '#EF4444' }}>Expense</th>
                                        <th style={{ textAlign: 'right' }}>Net</th>
                                        <th style={{ textAlign: 'right' }}>Margin</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {monthlyData.map(row => {
                                        const margin = row.income > 0 ? ((row.net / row.income) * 100) : 0;
                                        return (
                                            <tr key={row.month}>
                                                <td style={{ fontWeight: 600, fontSize: '13px' }}>
                                                    {new Date(row.month + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                                                </td>
                                                <td style={{ textAlign: 'right', color: '#10B981', fontWeight: 600 }}>
                                                    +${row.income.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                </td>
                                                <td style={{ textAlign: 'right', color: '#EF4444', fontWeight: 600 }}>
                                                    -${row.expense.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                </td>
                                                <td style={{ textAlign: 'right', fontWeight: 700, color: row.net >= 0 ? '#3B82F6' : '#EF4444' }}>
                                                    ${row.net.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                </td>
                                                <td style={{ textAlign: 'right', fontSize: '12px' }}>
                                                    <span style={{
                                                        padding: '2px 8px', borderRadius: '12px',
                                                        background: margin >= 0 ? '#ECFDF5' : '#FEF2F2',
                                                        color: margin >= 0 ? '#059669' : '#DC2626',
                                                        fontWeight: 600, fontSize: '11px'
                                                    }}>
                                                        {margin.toFixed(1)}%
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr style={{ borderTop: '2px solid var(--color-border)', fontWeight: 800 }}>
                                        <td style={{ padding: '12px', fontSize: '13px' }}>Total</td>
                                        <td style={{ textAlign: 'right', color: '#10B981', padding: '12px' }}>+${stats.totalIncome.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                        <td style={{ textAlign: 'right', color: '#EF4444', padding: '12px' }}>-${stats.totalExpense.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                        <td style={{ textAlign: 'right', color: stats.netRevenue >= 0 ? '#3B82F6' : '#EF4444', padding: '12px' }}>${stats.netRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                        <td style={{ textAlign: 'right', padding: '12px' }}>
                                            <span style={{ padding: '2px 8px', borderRadius: '12px', background: stats.profitMargin >= 0 ? '#ECFDF5' : '#FEF2F2', color: stats.profitMargin >= 0 ? '#059669' : '#DC2626', fontWeight: 600, fontSize: '11px' }}>
                                                {stats.profitMargin.toFixed(1)}%
                                            </span>
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        )}
                    </div>

                    {/* Top Income Categories */}
                    <div className="glass-panel" style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                        <h3 style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', margin: 0, fontSize: '15px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: '#10B981' }}>
                            <TrendingUp size={18} /> Top Income Categories
                        </h3>
                        {topIncomeCategories.length === 0 ? (
                            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '13px' }}>No income data.</div>
                        ) : (
                            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {topIncomeCategories.map(([cat, amount]) => (
                                    <div key={cat}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 500 }}>{cat}</span>
                                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#10B981' }}>${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                        </div>
                                        <div style={{ height: '6px', borderRadius: '3px', background: 'var(--color-bg)', overflow: 'hidden' }}>
                                            <div style={{ height: '100%', borderRadius: '3px', background: 'linear-gradient(90deg, #10B981, #34D399)', width: `${(amount / maxIncomeBar) * 100}%`, transition: 'width 0.5s ease' }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Top Expense Categories */}
                    <div className="glass-panel" style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                        <h3 style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', margin: 0, fontSize: '15px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: '#EF4444' }}>
                            <TrendingDown size={18} /> Top Expense Categories
                        </h3>
                        {topExpenseCategories.length === 0 ? (
                            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '13px' }}>No expense data.</div>
                        ) : (
                            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {topExpenseCategories.map(([cat, amount]) => (
                                    <div key={cat}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 500 }}>{cat}</span>
                                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#EF4444' }}>${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                        </div>
                                        <div style={{ height: '6px', borderRadius: '3px', background: 'var(--color-bg)', overflow: 'hidden' }}>
                                            <div style={{ height: '100%', borderRadius: '3px', background: 'linear-gradient(90deg, #EF4444, #F87171)', width: `${(amount / maxExpenseBar) * 100}%`, transition: 'width 0.5s ease' }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Revenue;
