import React, { useMemo } from 'react';
import { DollarSign, ShoppingBag, AlertTriangle, TrendingUp, RefreshCw, CreditCard, Package } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import StatsCard from '../components/StatsCard';
import { DateRangePicker } from '../components';

import { supabase } from '../lib/supabase';
import { mapSaleEntity } from '../utils/mapper';
import type { Sale } from '../types';



const Dashboard: React.FC = () => {
    const { products, refreshData } = useStore();
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
        const today = now.toISOString().split('T')[0];
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(now.getDate() - 30);
        return { start: thirtyDaysAgo.toISOString().split('T')[0], end: today };
    });

    const [filteredSales, setFilteredSales] = React.useState<Sale[]>([]);
    const [isLoadingSales, setIsLoadingSales] = React.useState(false);

    const fetchDashboardSales = React.useCallback(async () => {
        setIsLoadingSales(true);
        try {
            let query = supabase.from('sales').select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)');

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

            const { data, error } = await query;
            if (error) throw error;

            const mapped = (data || []).map(mapSaleEntity);
            setFilteredSales(mapped);

        } catch (error) {
            console.error("Failed to fetch dashboard sales:", error);
        } finally {
            setIsLoadingSales(false);
        }
    }, [dateRange]);

    React.useEffect(() => {
        fetchDashboardSales();
    }, [fetchDashboardSales]);

    const stats = useMemo(() => {
        const properSales = filteredSales.filter(sale => sale.paymentStatus !== 'Cancel' && sale.shipping?.status !== 'ReStock');
        const totalRevenue = properSales.reduce((sum, sale) => sum + sale.total, 0);
        const totalProperSales = properSales.length;
        const lowStockCount = products.filter(p => p.stock < (p.lowStockThreshold || 5)).length;
        const totalProducts = products.reduce((sum, p) => sum + p.stock, 0);
        return { totalRevenue, totalProperSales, lowStockCount, totalProducts };
    }, [filteredSales, products]);

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

    const orderStatusStats = useMemo(() => {
        const stats: Record<string, { count: number; total: number }> = {};
        filteredSales.forEach(sale => {
            const status = sale.shipping?.status || 'Pending';
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



    const pivotStats = useMemo(() => {
        const createPivot = () => ({
            ordered: 0,
            pending: 0,
            shipped: 0,
            delivered: 0,
            cancelled: 0,
            returned: 0,
            restock: 0,
            total: 0
        });
        const productMap: Record<string, ReturnType<typeof createPivot>> = {};

        filteredSales.forEach(sale => {
            const status = sale.shipping?.status;
            let field: 'ordered' | 'pending' | 'shipped' | 'delivered' | 'cancelled' | 'returned' | 'restock' | null = null;

            if (status === 'Ordered') field = 'ordered';
            else if (status === 'Pending') field = 'pending';
            else if (status === 'Shipped') field = 'shipped';
            else if (status === 'Delivered') field = 'delivered';
            else if (status === 'Cancelled') field = 'cancelled';
            else if (status === 'Returned') field = 'returned';
            else if (status === 'ReStock') field = 'restock';

            if (!field) return;

            sale.items.forEach(item => {
                const qty = item.quantity;

                // Product Pivot
                const product = item.name;
                if (!productMap[product]) productMap[product] = createPivot();
                productMap[product][field!] += qty;
                productMap[product].total += qty;
            });
        });

        const formatData = (map: Record<string, ReturnType<typeof createPivot>>) =>
            Object.entries(map)
                .map(([name, stats]) => ({ name, ...stats }))
                .sort((a, b) => b.total - a.total);

        return {
            product: formatData(productMap)
        };
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
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    width: isMobile ? '100%' : 'auto'
                }}>
                    <div style={{ flex: 1 }}>
                        <DateRangePicker value={dateRange} onChange={setDateRange} />
                    </div>
                    <button
                        disabled={isLoadingSales}
                        onClick={() => {
                            const btn = document.getElementById('dashboard-refresh-btn');
                            if (btn) btn.style.animation = 'spin 1s linear infinite';

                            Promise.all([
                                refreshData(true),
                                fetchDashboardSales()
                            ]).finally(() => {
                                if (btn) btn.style.animation = 'none';
                            });
                        }}
                        className="secondary-button"
                        style={{
                            padding: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '42px', // Match date picker height roughly
                            aspectRatio: '1/1'
                        }}
                        title="Refresh Data"
                    >
                        <RefreshCw id="dashboard-refresh-btn" size={20} />
                    </button>
                    <style>{`
                        @keyframes spin { 
                            100% { -webkit-transform: rotate(360deg); transform:rotate(360deg); } 
                        }
                    `}</style>
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



            {/* Pay Status Cards */}
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>Payment Status</h3>
            <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '16px',
                marginBottom: '24px'
            }}>
                {paymentStatusStats.map((stat, idx) => {
                    let color = 'var(--color-primary)';
                    if (stat.status === 'Paid') color = 'var(--color-green)';
                    else if (stat.status === 'Unpaid') color = 'var(--color-red)';
                    
                    return (
                        <StatsCard
                            key={idx}
                            title={stat.status + " Orders"}
                            value={stat.count}
                            icon={CreditCard}
                            trend={`$${stat.total.toLocaleString()} Revenue`}
                            color={color}
                        />
                    );
                })}
            </div>

            {/* Order Status Cards */}
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>Order Status</h3>
            <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '16px',
                marginBottom: '24px'
            }}>
                {orderStatusStats.map((stat, idx) => {
                    let color = 'var(--color-primary)'; // default blue
                    if (stat.status === 'Delivered') color = 'var(--color-green)';
                    else if (stat.status === 'Cancelled' || stat.status === 'Returned') color = 'var(--color-red)';
                    else if (stat.status === 'ReStock') color = 'var(--color-purple)';
                    else if (stat.status === 'Ordered') color = 'var(--color-yellow)';

                    return (
                        <StatsCard
                            key={idx}
                            title={stat.status}
                            value={stat.count}
                            icon={Package}
                            trend={`$${stat.total.toLocaleString()} Revenue`}
                            color={color}
                        />
                    );
                })}
            </div>

            {/* Reports Grid: Remaining Panels */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : '1fr',
                gap: '16px'
            }}>


                {/* 3. Top Selling Products */}
                <div className="glass-panel" style={{
                    padding: '20px',
                    height: isMobile ? '300px' : 'auto',
                    overflowY: 'auto',
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

            </div>

            {/* Pivot Tables Section */}
            <div style={{
                marginTop: '20px',
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : '1fr',
                gap: '20px'
            }}>
                <PivotTable title="Product Report" data={pivotStats.product} />
            </div>
        </div>
    );
};

// Pivot Table Component
const PivotTable: React.FC<{
    title: string;
    data: { name: string; ordered: number; pending: number; shipped: number; delivered: number; cancelled: number; returned: number; restock: number; total: number }[]
}> = ({ title, data }) => {
    const totals = data.reduce((acc, curr) => ({
        ordered: acc.ordered + curr.ordered,
        pending: acc.pending + curr.pending,
        shipped: acc.shipped + curr.shipped,
        delivered: acc.delivered + curr.delivered,
        cancelled: acc.cancelled + curr.cancelled,
        returned: acc.returned + curr.returned,
        restock: acc.restock + curr.restock,
        total: acc.total + curr.total
    }), { ordered: 0, pending: 0, shipped: 0, delivered: 0, cancelled: 0, returned: 0, restock: 0, total: 0 });

    return (
        <div className="glass-panel" style={{ padding: '20px', overflowX: 'auto' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>{title}</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', minWidth: '800px' }}>
                <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                        <th style={{ padding: '8px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Name</th>
                        <th style={{ padding: '8px', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'center' }}>Ordered</th>
                        <th style={{ padding: '8px', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'center' }}>Pending</th>
                        <th style={{ padding: '8px', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'center' }}>Shipped</th>
                        <th style={{ padding: '8px', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'center' }}>Delivered</th>
                        <th style={{ padding: '8px', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'center' }}>Returned</th>
                        <th style={{ padding: '8px', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'center' }}>ReStock</th>
                        <th style={{ padding: '8px', color: 'var(--color-text-secondary)', fontWeight: 600, textAlign: 'right' }}>Total</th>
                    </tr>
                </thead>
                <tbody>
                    {data.length === 0 ? (
                        <tr><td colSpan={8} style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No data</td></tr>
                    ) : (data.map((row, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--color-border)' }}>
                            <td style={{ padding: '8px', fontWeight: 500 }}>{row.name}</td>
                            <td style={{ padding: '8px', textAlign: 'center' }}>{row.ordered || ''}</td>
                            <td style={{ padding: '8px', textAlign: 'center' }}>{row.pending || ''}</td>
                            <td style={{ padding: '8px', textAlign: 'center' }}>{row.shipped || ''}</td>
                            <td style={{ padding: '8px', textAlign: 'center' }}>{row.delivered || ''}</td>
                            <td style={{ padding: '8px', textAlign: 'center' }}>{row.returned || ''}</td>
                            <td style={{ padding: '8px', textAlign: 'center' }}>{row.restock || ''}</td>
                            <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>{row.total}</td>
                        </tr>
                    )))}
                </tbody>
                {data.length > 0 && (
                    <tfoot>
                        <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                            <td style={{ padding: '12px 8px', fontWeight: 'bold' }}>Total Summary</td>
                            <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 'bold' }}>{totals.ordered}</td>
                            <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 'bold' }}>{totals.pending}</td>
                            <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 'bold' }}>{totals.shipped}</td>
                            <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 'bold' }}>{totals.delivered}</td>
                            <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 'bold' }}>{totals.returned}</td>
                            <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 'bold' }}>{totals.restock}</td>
                            <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 'bold' }}>{totals.total}</td>
                        </tr>
                    </tfoot>
                )}
            </table>
        </div>
    );
};

export default Dashboard;
