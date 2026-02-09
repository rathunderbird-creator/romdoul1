import React, { useMemo } from 'react';
import { useStore } from '../context/StoreContext';
import { useHeader } from '../context/HeaderContext';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { ShoppingBag, Users, DollarSign, Store } from 'lucide-react';

const COLORS = ['var(--color-blue)', 'var(--color-green)', 'var(--color-primary)', 'var(--color-purple)', 'var(--color-red)'];

const Report: React.FC = () => {
    const { sales } = useStore();
    const { setHeaderContent } = useHeader();

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Reports & Analytics</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Sales performance and insights</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    const stats = useMemo(() => {
        const totalRevenue = sales.reduce((sum, order) => sum + order.total, 0);
        const totalOrders = sales.length;
        const onlineOrders = sales.filter(s => s.type === 'Online').length;
        const posOrders = sales.filter(s => s.type === 'POS').length;

        return { totalRevenue, totalOrders, onlineOrders, posOrders };
    }, [sales]);

    const salesByDay = useMemo(() => {
        const data: Record<string, number> = {};
        // Get last 7 days
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            data[dateStr] = 0;
        }

        sales.forEach(sale => {
            const dateStr = sale.date.split('T')[0];
            if (data[dateStr] !== undefined) {
                data[dateStr] += sale.total;
            }
        });

        return Object.entries(data).map(([date, total]) => ({
            name: new Date(date).toLocaleDateString('en-US', { weekday: 'short' }),
            total
        }));
    }, [sales]);

    const salesByPlatform = useMemo(() => {
        const data: Record<string, number> = {};
        sales.forEach(sale => {
            const platform = sale.customer?.platform || 'Unknown';
            data[platform] = (data[platform] || 0) + sale.total;
        });
        return Object.entries(data).map(([name, value]) => ({ name, value }));
    }, [sales]);

    const salesBySalesman = useMemo(() => {
        const data: Record<string, number> = {};
        sales.forEach(sale => {
            const salesman = sale.salesman || 'Unassigned';
            data[salesman] = (data[salesman] || 0) + sale.total;
        });
        return Object.entries(data).map(([name, value]) => ({ name, value }));
    }, [sales]);

    return (
        <div style={{ paddingBottom: '40px' }}>
            <div style={{ marginBottom: '8px' }}>
                <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Reports & Analytics</h1>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Overview of store performance</p>
            </div>

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '12px' }}>
                <div className="glass-panel" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ padding: '12px', borderRadius: '12px', background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
                        <DollarSign size={24} />
                    </div>
                    <div>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>Total Revenue</p>
                        <h3 style={{ fontSize: '24px', fontWeight: 'bold' }}>${stats.totalRevenue.toFixed(2)}</h3>
                    </div>
                </div>
                <div className="glass-panel" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ padding: '12px', borderRadius: '12px', background: 'var(--color-green-light)', color: 'var(--color-green)' }}>
                        <ShoppingBag size={24} />
                    </div>
                    <div>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>Total Orders</p>
                        <h3 style={{ fontSize: '24px', fontWeight: 'bold' }}>{stats.totalOrders}</h3>
                    </div>
                </div>
                <div className="glass-panel" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ padding: '12px', borderRadius: '12px', background: 'var(--color-blue-light)', color: 'var(--color-blue)' }}>
                        <Users size={24} />
                    </div>
                    <div>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>Online Orders</p>
                        <h3 style={{ fontSize: '24px', fontWeight: 'bold' }}>{stats.onlineOrders}</h3>
                    </div>
                </div>
                <div className="glass-panel" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ padding: '12px', borderRadius: '12px', background: 'var(--color-purple-light)', color: 'var(--color-purple)' }}>
                        <Store size={24} />
                    </div>
                    <div>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>POS Sales</p>
                        <h3 style={{ fontSize: '24px', fontWeight: 'bold' }}>{stats.posOrders}</h3>
                    </div>
                </div>
            </div>

            {/* Charts Row 1 */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', marginBottom: '20px' }}>
                <div className="glass-panel" style={{ padding: '24px', height: '400px' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '20px' }}>Revenue Trend (Last 7 Days)</h3>
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={salesByDay}>
                            <defs>
                                <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                            <XAxis dataKey="name" stroke="var(--color-text-secondary)" />
                            <YAxis stroke="var(--color-text-secondary)" tickFormatter={(value) => `$${value}`} />
                            <Tooltip
                                contentStyle={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', borderRadius: '8px', boxShadow: 'var(--shadow-md)' }}
                                itemStyle={{ color: 'var(--color-text-main)' }}
                                formatter={(value: any) => [`$${value}`, 'Revenue']}
                            />
                            <Area type="monotone" dataKey="total" stroke="var(--color-primary)" fillOpacity={1} fill="url(#colorTotal)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
                <div className="glass-panel" style={{ padding: '24px', height: '400px' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '20px' }}>Sales by Platform</h3>
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={salesByPlatform}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={100}
                                fill="#8884d8"
                                paddingAngle={5}
                                dataKey="value"
                            >
                                {salesByPlatform.map((_entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip
                                contentStyle={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', borderRadius: '8px', boxShadow: 'var(--shadow-md)' }}
                                formatter={(value: any) => [`$${value}`, 'Revenue']}
                            />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Charts Row 2 */}
            <div className="glass-panel" style={{ padding: '24px', height: '400px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '20px' }}>Sales by Salesman</h3>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={salesBySalesman}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                        <XAxis dataKey="name" stroke="var(--color-text-secondary)" />
                        <YAxis stroke="var(--color-text-secondary)" tickFormatter={(value) => `$${value}`} />
                        <Tooltip
                            cursor={{ fill: 'var(--color-surface-hover)' }}
                            contentStyle={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', borderRadius: '8px', boxShadow: 'var(--shadow-md)' }}
                            itemStyle={{ color: 'var(--color-text-main)' }}
                            formatter={(value: any) => [`$${value}`, 'Revenue']}
                        />
                        <Bar dataKey="value" fill="#8884d8" radius={[4, 4, 0, 0]}>
                            {salesBySalesman.map((_entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

// Need to import Area components since I used AreaChart above.
// Re-importing efficiently
import { AreaChart, Area } from 'recharts';


export default Report;
