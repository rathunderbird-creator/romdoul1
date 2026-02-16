import React, { useMemo } from 'react';
import { DollarSign, ShoppingBag, AlertTriangle, TrendingUp } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import StatsCard from '../components/StatsCard';
import { DateRangePicker } from '../components';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, BarChart, Bar } from 'recharts';

const COLORS = ['var(--color-blue)', 'var(--color-green)', 'var(--color-primary)', 'var(--color-purple)', 'var(--color-red)'];

const Dashboard: React.FC = () => {
    const { products, sales } = useStore();
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Dashboard</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Overview of your store performance</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    const [dateRange, setDateRange] = React.useState(() => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
        return { start, end };
    });

    const filteredSales = useMemo(() => {
        if (!dateRange.start || !dateRange.end) return sales;
        const start = new Date(dateRange.start);
        const end = new Date(dateRange.end);
        end.setHours(23, 59, 59, 999);
        return sales.filter(sale => {
            const date = new Date(sale.date);
            return date >= start && date <= end;
        });
    }, [sales, dateRange]);

    const stats = useMemo(() => {
        const totalRevenue = filteredSales.reduce((sum, sale) => sum + sale.total, 0);
        const totalProperSales = filteredSales.length;
        const lowStockCount = products.filter(p => p.stock < (p.lowStockThreshold || 5)).length;
        const totalProducts = products.reduce((sum, p) => sum + p.stock, 0);
        return { totalRevenue, totalProperSales, lowStockCount, totalProducts };
    }, [filteredSales, products]);

    const salesByDay = useMemo(() => {
        const data: Record<string, number> = {};
        const days: string[] = [];

        if (dateRange.start && dateRange.end) {
            const current = new Date(dateRange.start);
            const end = new Date(dateRange.end);
            while (current <= end) {
                days.push(current.toISOString().split('T')[0]);
                current.setDate(current.getDate() + 1);
            }
        } else {
            // Default last 7 days
            for (let i = 6; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                days.push(d.toISOString().split('T')[0]);
            }
        }

        days.forEach(date => {
            data[date] = 0;
        });

        filteredSales.forEach(sale => {
            const dateStr = sale.date.split('T')[0];
            if (data[dateStr] !== undefined) {
                data[dateStr] += sale.total;
            }
        });

        return days.map(date => ({
            name: new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' }),
            total: data[date] || 0
        }));
    }, [filteredSales, dateRange]);



    const salesBySalesman = useMemo(() => {
        const data: Record<string, number> = {};
        filteredSales.forEach(sale => {
            const salesman = sale.salesman || 'Unassigned';
            data[salesman] = (data[salesman] || 0) + sale.total;
        });
        return Object.entries(data).map(([name, value]) => ({ name, value }));
    }, [filteredSales]);

    const salesByPage = useMemo(() => {
        const data: Record<string, number> = {};
        filteredSales.forEach(sale => {
            const page = sale.customer?.page || 'Unknown';
            data[page] = (data[page] || 0) + sale.total;
        });
        return Object.entries(data).map(([name, value]) => ({ name, value }));
    }, [filteredSales]);

    const topProducts = useMemo(() => {
        const productStats: Record<string, { name: string; quantity: number; revenue: number }> = {};

        filteredSales.forEach(sale => {
            if (sale.shipping?.status === 'Shipped' || sale.shipping?.status === 'Delivered') {
                sale.items.forEach(item => {
                    const id = item.id;
                    if (!productStats[id]) {
                        productStats[id] = { name: item.name, quantity: 0, revenue: 0 };
                    }
                    productStats[id].quantity += item.quantity;
                    productStats[id].revenue += item.price * item.quantity;
                });
            }
        });

        return Object.values(productStats)
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 10); // Top 10
    }, [filteredSales]);

    const paymentStatusStats = useMemo(() => {
        const stats: Record<string, { count: number; total: number }> = {};

        filteredSales.forEach(sale => {
            const status = sale.paymentStatus || 'Unpaid';
            if (!stats[status]) {
                stats[status] = { count: 0, total: 0 };
            }
            stats[status].count += 1;
            stats[status].total += sale.total;
        });

        return Object.entries(stats).map(([status, data]) => ({
            status,
            count: data.count,
            total: data.total
        })).sort((a, b) => b.total - a.total);
    }, [filteredSales]);

    const shippingStatusStats = useMemo(() => {
        const data: Record<string, number> = {};
        filteredSales.forEach(sale => {
            const status = sale.shipping?.status || 'Pending';
            data[status] = (data[status] || 0) + 1;
        });
        return Object.entries(data).map(([name, value]) => ({ name, value }));
    }, [filteredSales]);

    const shippingCompanyStats = useMemo(() => {
        const stats: Record<string, { count: number; cost: number }> = {};

        filteredSales.forEach(sale => {
            if (sale.shipping?.status === 'Shipped' || sale.shipping?.status === 'Delivered') {
                const company = sale.shipping?.company || 'Unknown';
                if (!stats[company]) {
                    stats[company] = { count: 0, cost: 0 };
                }
                stats[company].count += 1;
                stats[company].cost += sale.shipping?.cost || 0;
            }
        });

        return Object.entries(stats).map(([company, data]) => ({
            company,
            count: data.count,
            cost: data.cost
        })).sort((a, b) => b.count - a.count);
    }, [filteredSales]);

    return (
        <div style={{ paddingBottom: '40px' }}>
            {/* Filters */}
            <div className="glass-panel" style={{
                marginBottom: '20px',
                padding: '16px',
                display: 'flex',
                justifyContent: isMobile ? 'center' : 'flex-end',
                alignItems: 'center',
                position: 'relative',
                zIndex: 50
            }}>
                <div style={{ width: isMobile ? '100%' : 'auto' }}>
                    <DateRangePicker value={dateRange} onChange={setDateRange} />
                </div>
            </div>

            {/* Stats Row */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)',
                gap: '16px',
                marginBottom: '20px'
            }}>
                <StatsCard
                    title="Total Revenue"
                    value={`$${stats.totalRevenue.toLocaleString()}`}
                    icon={DollarSign}
                    trend="+12.5% from last month"
                    color="var(--color-green)"
                />
                <StatsCard
                    title="Total Sales"
                    value={stats.totalProperSales}
                    icon={ShoppingBag}
                    trend="+5 new today"
                    color="var(--color-blue)"
                />
                <StatsCard
                    title="Products in Stock"
                    value={stats.totalProducts}
                    icon={TrendingUp}
                    color="var(--color-primary)"
                />
                <StatsCard
                    title="Low Stock Alert"
                    value={stats.lowStockCount}
                    icon={AlertTriangle}
                    trend="Items require attention"
                    color="var(--color-red)"
                />
            </div>

            {/* Charts Row 1 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px', marginBottom: '16px' }}>
                <div className="glass-panel" style={{ padding: '20px', height: '300px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>Revenue Trend (Last 7 Days)</h3>
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
            </div>

            {/* Reports Grid: 3 Columns */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
                gap: '16px'
            }}>
                {/* 1. Sales by Page */}
                <div className="glass-panel" style={{ padding: '20px', height: '300px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>Sales by Page</h3>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={salesByPage}>
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
                                {salesByPage.map((_entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* 2. Sales by Salesman */}
                <div className="glass-panel" style={{ padding: '20px', height: '300px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>Sales by Salesman</h3>
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

                {/* 3. Top Selling Products */}
                <div className="glass-panel" style={{
                    padding: '20px',
                    height: isMobile ? '300px' : '616px',
                    overflowY: 'auto',
                    gridRow: isMobile ? 'auto' : 'span 2'
                }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>Top Selling Products</h3>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                                    <th style={{ padding: '8px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Product</th>
                                    <th style={{ padding: '8px', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'center' }}>Qty</th>
                                    <th style={{ padding: '8px', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'right' }}>Rev</th>
                                </tr>
                            </thead>
                            <tbody>
                                {topProducts.length === 0 ? (
                                    <tr>
                                        <td colSpan={3} style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No data.</td>
                                    </tr>
                                ) : (
                                    topProducts.map((product, index) => (
                                        <tr key={index} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: '8px', fontWeight: 500 }}>{product.name}</td>
                                            <td style={{ padding: '8px', textAlign: 'center' }}>{product.quantity}</td>
                                            <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', color: 'var(--color-primary)' }}>${product.revenue.toLocaleString()}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                            {topProducts.length > 0 && (
                                <tfoot>
                                    <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                                        <td style={{ padding: '12px 8px', fontWeight: 'bold' }}>Total Summary</td>
                                        <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 'bold' }}>
                                            {topProducts.reduce((sum, p) => sum + p.quantity, 0)}
                                        </td>
                                        <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 'bold', color: 'var(--color-primary)' }}>
                                            ${topProducts.reduce((sum, p) => sum + p.revenue, 0).toLocaleString()}
                                        </td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>

                {/* 4. Payment Status Summary */}
                <div className="glass-panel" style={{ padding: '20px', height: '300px', overflowY: 'auto' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>Payment Status</h3>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                                    <th style={{ padding: '8px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Status</th>
                                    <th style={{ padding: '8px', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'center' }}>Cnt</th>
                                    <th style={{ padding: '8px', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'right' }}>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paymentStatusStats.length === 0 ? (
                                    <tr>
                                        <td colSpan={3} style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No data.</td>
                                    </tr>
                                ) : (
                                    paymentStatusStats.map((stat, index) => (
                                        <tr key={index} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: '8px', fontWeight: 500 }}>
                                                <span style={{
                                                    padding: '2px 6px', borderRadius: '12px', fontSize: '11px',
                                                    background: stat.status === 'Paid' ? '#D1FAE5' : (stat.status === 'Unpaid' ? '#FEE2E2' : '#EFF6FF'),
                                                    color: stat.status === 'Paid' ? '#059669' : (stat.status === 'Unpaid' ? '#DC2626' : '#1D4ED8')
                                                }}>
                                                    {stat.status}
                                                </span>
                                            </td>
                                            <td style={{ padding: '8px', textAlign: 'center' }}>{stat.count}</td>
                                            <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>${stat.total.toLocaleString()}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* 5. Shipping Status */}
                <div className="glass-panel" style={{ padding: '20px', height: '300px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>Shipping Status</h3>
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={shippingStatusStats}
                                cx="50%"
                                cy="50%"
                                innerRadius={50}
                                outerRadius={70}
                                fill="#8884d8"
                                paddingAngle={5}
                                dataKey="value"
                            >
                                {shippingStatusStats.map((_entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip
                                contentStyle={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)', borderRadius: '8px', boxShadow: 'var(--shadow-md)' }}
                            />
                            <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: '12px' }} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                {/* 6. Shipping by Company */}
                <div className="glass-panel" style={{ padding: '20px', height: '300px', overflowY: 'auto' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>Shipping by Company</h3>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                                    <th style={{ padding: '8px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Company</th>
                                    <th style={{ padding: '8px', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'center' }}>Orders</th>
                                    <th style={{ padding: '8px', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'right' }}>Cost</th>
                                </tr>
                            </thead>
                            <tbody>
                                {shippingCompanyStats.length === 0 ? (
                                    <tr>
                                        <td colSpan={3} style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No data.</td>
                                    </tr>
                                ) : (
                                    shippingCompanyStats.map((stat, index) => (
                                        <tr key={index} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: '8px', fontWeight: 500 }}>{stat.company}</td>
                                            <td style={{ padding: '8px', textAlign: 'center' }}>{stat.count}</td>
                                            <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', color: 'var(--color-red)' }}>${stat.cost.toLocaleString()}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
