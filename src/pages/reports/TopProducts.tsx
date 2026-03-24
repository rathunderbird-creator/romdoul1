import React, { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ShoppingBag, TrendingUp, DollarSign } from 'lucide-react';

const TopProducts: React.FC = () => {
    const { reportSales, startDate, endDate } = useOutletContext<any>();
    const [sortStrategy, setSortStrategy] = useState<'quantity' | 'revenue'>('quantity');

    const { productData, kpis } = useMemo(() => {
        const pMap = new Map<string, { id: string; name: string; quantity: number; revenue: number }>();
        let totalItemsSold = 0;
        let totalRevenue = 0;

        const validSales = (reportSales || []).filter((s:any) => s.paymentStatus === 'Paid');

        validSales.forEach((sale: any) => {
            sale.items.forEach((item: any) => {
                if (!pMap.has(item.id)) {
                    pMap.set(item.id, { id: item.id, name: item.name, quantity: 0, revenue: 0 });
                }
                const entry = pMap.get(item.id)!;
                entry.quantity += item.quantity;
                entry.revenue += (item.price * item.quantity);

                totalItemsSold += item.quantity;
                totalRevenue += (item.price * item.quantity);
            });
        });

        const sortedMap = Array.from(pMap.values()).sort((a, b) => {
            if (sortStrategy === 'quantity') return b.quantity - a.quantity;
            return b.revenue - a.revenue;
        });

        return {
            productData: sortedMap,
            kpis: {
                totalItemsSold,
                totalRevenue,
                uniqueProducts: sortedMap.length
            }
        };
    }, [reportSales, startDate, endDate, sortStrategy]);

    const chartData = useMemo(() => productData.slice(0, 10), [productData]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: 'var(--color-text-main)' }}>Top Selling Products</h2>
                <select 
                    value={sortStrategy}
                    onChange={(e) => setSortStrategy(e.target.value as any)}
                    className="search-input"
                    style={{ padding: '8px 12px', fontSize: '14px', background: 'var(--color-surface)', color: 'var(--color-text-main)' }}
                >
                    <option value="quantity">Rank by Quantity Sold</option>
                    <option value="revenue">Rank by Revenue Generated</option>
                </select>
            </div>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(59, 130, 246, 0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(59, 130, 246, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Units Sold</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(59, 130, 246, 0.15)', color: '#3B82F6' }}><ShoppingBag size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-text-main)' }}>{kpis.totalItemsSold.toLocaleString()}</div>
                </div>

                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(16, 185, 129, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Product Revenue</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', color: '#10B981' }}><DollarSign size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-text-main)' }}>${kpis.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>

                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(245, 158, 11, 0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(245, 158, 11, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Unique Products</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.15)', color: '#F59E0B' }}><TrendingUp size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-text-main)' }}>{kpis.uniqueProducts}</div>
                </div>
            </div>

            {/* Top 10 Chart */}
            <div className="glass-panel hover-lift" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--color-text-main)' }}>Top 10 Performers</h3>
                {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                            <XAxis 
                                dataKey="name" 
                                stroke="var(--color-text-secondary)" 
                                fontSize={11} 
                                tickLine={false} 
                                axisLine={false} 
                                angle={-45}
                                textAnchor="end"
                                height={60}
                            />
                            <YAxis 
                                stroke="var(--color-text-secondary)" 
                                fontSize={12} 
                                tickLine={false} 
                                axisLine={false} 
                                tickFormatter={(val) => sortStrategy === 'revenue' ? `$${val}` : val} 
                            />
                            <Tooltip 
                                cursor={{ fill: 'rgba(59, 130, 246, 0.05)' }}
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                formatter={(value: any) => [sortStrategy === 'revenue' ? `$${Number(value).toFixed(2)}` : value, sortStrategy === 'revenue' ? 'Revenue' : 'Quantity Sold']}
                            />
                            <Bar dataKey={sortStrategy} fill="#3B82F6" radius={[4, 4, 0, 0]} barSize={32} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No product data found.</div>
                )}
            </div>

            {/* Detailed Table */}
            <div className="glass-panel hover-lift" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--color-text-main)' }}>Product Breakdown</h3>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                                <th style={{ padding: '12px 8px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Rank</th>
                                <th style={{ padding: '12px 8px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Product Name</th>
                                <th style={{ padding: '12px 8px', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'center' }}>Units Sold</th>
                                <th style={{ padding: '12px 8px', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'right' }}>Revenue</th>
                            </tr>
                        </thead>
                        <tbody>
                            {productData.length === 0 ? (
                                <tr>
                                    <td colSpan={4} style={{ padding: '30px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No data available.</td>
                                </tr>
                            ) : (
                                productData.map((item, index) => (
                                    <tr key={item.id} style={{ borderBottom: '1px solid var(--color-border)' }} className="hover-lift">
                                        <td style={{ padding: '12px 8px', fontWeight: 600, color: index < 3 ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                                            #{index + 1}
                                        </td>
                                        <td style={{ padding: '12px 8px', fontWeight: 500 }}>{item.name}</td>
                                        <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 'bold' }}>{item.quantity}</td>
                                        <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 'bold', color: 'var(--color-green)' }}>
                                            ${item.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default TopProducts;
