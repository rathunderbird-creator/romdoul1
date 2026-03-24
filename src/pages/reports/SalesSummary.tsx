import React, { useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, ShoppingBag, DollarSign } from 'lucide-react';

const SalesSummary: React.FC = () => {
    const { reportSales, startDate, endDate } = useOutletContext<any>();

    // Aggregate Sales Data
    const { dailyData, topProducts, totalRevenue, totalOrders } = useMemo(() => {
        // Filter out non-paid orders
        const validSales = (reportSales || []).filter((s: any) => s.paymentStatus === 'Paid');

        // 1. Daily Revenue & Orders map
        const dailyMap = new Map<string, { date: string; revenue: number; orders: number }>();
        
        // 2. Product sales map for top products
        const productStats = new Map<string, { name: string; quantity: number; revenue: number }>();

        let totalRev = 0;
        let totalOrd = validSales.length;

        validSales.forEach((sale: any) => {
            const dateObj = new Date(sale.date);
            // Format as YYYY-MM-DD for grouping
            const dateStr = dateObj.toLocaleDateString();

            if (!dailyMap.has(dateStr)) {
                dailyMap.set(dateStr, { date: dateStr, revenue: 0, orders: 0 });
            }
            const dayStat = dailyMap.get(dateStr)!;
            dayStat.revenue += sale.total;
            dayStat.orders += 1;
            totalRev += sale.total;

            sale.items.forEach((item: any) => {
                if (!productStats.has(item.id)) {
                    productStats.set(item.id, { name: item.name, quantity: 0, revenue: 0 });
                }
                const pStat = productStats.get(item.id)!;
                pStat.quantity += item.quantity;
                pStat.revenue += (item.price * item.quantity);
            });
        });

        // Sort Daily Data by actual date
        const sortedDaily = Array.from(dailyMap.values()).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // Sort Top Products by Quantity string
        const topSellingProducts = Array.from(productStats.values())
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 5); // top 5

        return {
            dailyData: sortedDaily,
            topProducts: topSellingProducts,
            totalRevenue: totalRev,
            totalOrders: totalOrd
        };
    }, [reportSales, startDate, endDate]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: 'var(--color-text-main)' }}>Sales Overview</h2>
            </div>

            {/* High-Level KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(16, 185, 129, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Total Revenue</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', color: '#10B981' }}><DollarSign size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-text-main)' }}>${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>

                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(59, 130, 246, 0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(59, 130, 246, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Total Orders</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(59, 130, 246, 0.15)', color: '#3B82F6' }}><ShoppingBag size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-text-main)' }}>{totalOrders.toLocaleString()}</div>
                </div>

                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(139, 92, 246, 0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(139, 92, 246, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Avg Order Value</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(139, 92, 246, 0.15)', color: '#8B5CF6' }}><TrendingUp size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-text-main)' }}>${totalOrders > 0 ? (totalRevenue / totalOrders).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}</div>
                </div>
            </div>

            {/* Charts Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
                {/* Revenue Trend Chart */}
                <div className="glass-panel hover-lift" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', height: '400px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--color-text-main)' }}>Revenue Trend</h3>
                    {dailyData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={dailyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                                <XAxis dataKey="date" stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} minTickGap={30} />
                                <YAxis stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                                <Tooltip 
                                    contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                                    itemStyle={{ color: 'var(--color-text-main)', fontWeight: 600 }}
                                    formatter={(value: any) => [`$${Number(value).toFixed(2)}`, 'Revenue']}
                                    labelStyle={{ color: 'var(--color-text-secondary)', marginBottom: '4px' }}
                                />
                                <Line type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={3} dot={{ r: 4, fill: '#10B981', strokeWidth: 0 }} activeDot={{ r: 6, strokeWidth: 0 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)' }}>No sales data for this period.</div>
                    )}
                </div>

                {/* Top Products Chart */}
                <div className="glass-panel hover-lift" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', height: '400px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--color-text-main)' }}>Top Selling Products (Quantity)</h3>
                    {topProducts.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={topProducts} layout="vertical" margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                                <XAxis type="number" stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis dataKey="name" type="category" width={100} stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} />
                                <Tooltip 
                                    cursor={{ fill: 'rgba(59, 130, 246, 0.05)' }}
                                    contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                                    itemStyle={{ color: 'var(--color-text-main)', fontWeight: 600 }}
                                    formatter={(value: any) => [`${value} sold`, 'Quantity']}
                                />
                                <Bar dataKey="quantity" fill="#3B82F6" radius={[0, 4, 4, 0]} barSize={24} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)' }}>No product data for this period.</div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SalesSummary;
