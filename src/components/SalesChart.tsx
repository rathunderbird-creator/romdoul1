import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useStore } from '../context/StoreContext';

const SalesChart: React.FC = () => {
    const { sales } = useStore();

    // Process data for the last 7 days
    const last7Days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return d.toISOString().split('T')[0];
    });

    const data = last7Days.map(date => {
        const daySales = sales.filter(s => s.date.startsWith(date));
        const total = daySales.reduce((sum, s) => sum + s.total, 0);
        return {
            name: new Date(date).toLocaleDateString('en-US', { weekday: 'short' }),
            total: total
        };
    });

    return (
        <div style={{ width: '100%', height: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                    <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
                        dy={10}
                    />
                    <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
                        dx={-10}
                        tickFormatter={(value) => `$${value}`}
                    />
                    <Tooltip
                        cursor={{ fill: 'var(--color-surface-hover)' }}
                        contentStyle={{
                            backgroundColor: 'var(--color-surface)',
                            border: '1px solid var(--color-border)',
                            borderRadius: '8px',
                            color: 'var(--color-text-main)',
                            boxShadow: 'var(--shadow-md)'
                        }}
                        itemStyle={{ color: 'var(--color-primary)' }}
                        formatter={(value: any) => [`$${value}`, 'Revenue']}
                    />
                    <Bar
                        dataKey="total"
                        fill="var(--color-primary)"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={50}
                    />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};

export default SalesChart;
