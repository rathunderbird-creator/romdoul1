import React, { useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Wallet, TrendingDown, TrendingUp } from 'lucide-react';

const FinancialReport: React.FC = () => {
    const { reportSales, reportTransactions, startDate, endDate } = useOutletContext<any>();

    const { chartData, totalIncome, totalExpense, netProfit } = useMemo(() => {
        let income = 0;
        let expense = 0;

        const dailyMap = new Map<string, { date: string; income: number; expense: number }>();

        // 1. Process Sales as Income (strictly 'Paid' sales)
        const validSales = (reportSales || []).filter((s:any) => s.paymentStatus === 'Paid');
        validSales.forEach((sale:any) => {
            const dateStr = new Date(sale.date).toLocaleDateString();
            if (!dailyMap.has(dateStr)) dailyMap.set(dateStr, { date: dateStr, income: 0, expense: 0 });
            dailyMap.get(dateStr)!.income += sale.total;
            income += sale.total;
        });

        // 2. Process Transactions
        const validTransactions = reportTransactions || [];
        validTransactions.forEach((t:any) => {
            const dateStr = new Date(t.date).toLocaleDateString();
            if (!dailyMap.has(dateStr)) dailyMap.set(dateStr, { date: dateStr, income: 0, expense: 0 });
            
            if (t.type === 'Income') {
                dailyMap.get(dateStr)!.income += t.amount;
                income += t.amount;
            } else if (t.type === 'Expense') {
                dailyMap.get(dateStr)!.expense += Math.abs(t.amount); // Ensure positive for charting
                expense += Math.abs(t.amount);
            }
        });

        const sortedData = Array.from(dailyMap.values()).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        return {
            chartData: sortedData,
            totalIncome: income,
            totalExpense: expense,
            netProfit: income - expense
        };
    }, [reportSales, reportTransactions, startDate, endDate]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: 'var(--color-text-main)' }}>Financial Overview</h2>
            
            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(16, 185, 129, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Total Income</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', color: '#10B981' }}><TrendingUp size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-text-main)' }}>${totalIncome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>

                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(239, 68, 68, 0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(239, 68, 68, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Total Expenses</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(239, 68, 68, 0.15)', color: '#EF4444' }}><TrendingDown size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-text-main)' }}>${totalExpense.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>

                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(59, 130, 246, 0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(59, 130, 246, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Net Profit</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(59, 130, 246, 0.15)', color: '#3B82F6' }}><Wallet size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: netProfit >= 0 ? '#10B981' : '#EF4444' }}>${netProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
            </div>

            {/* Income vs Expense Chart */}
            <div className="glass-panel hover-lift" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', height: '400px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--color-text-main)' }}>Income & Expenses Over Time</h3>
                {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                            <XAxis dataKey="date" stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} minTickGap={30} />
                            <YAxis stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val}`} />
                            <Tooltip 
                                cursor={{ fill: 'rgba(0, 0, 0, 0.05)' }} 
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                formatter={(value: any) => [`$${Number(value).toFixed(2)}`]}
                            />
                            <Legend />
                            <Bar dataKey="income" name="Income" fill="#10B981" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="expense" name="Expense" fill="#EF4444" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)' }}>No financial data available.</div>
                )}
            </div>
        </div>
    );
};

export default FinancialReport;
