import React, { useMemo } from 'react';
import { ShoppingBag, AlertTriangle, TrendingUp, RefreshCw, CreditCard, Package, User } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import StatsCard from '../components/StatsCard';
import { DateRangePicker } from '../components';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { mapSaleEntity } from '../utils/mapper';
import type { Sale } from '../types';



const Dashboard: React.FC = () => {
    const { products, refreshData } = useStore();
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();
    const navigate = useNavigate();

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
    const [salesmanStatusFilter, setSalesmanStatusFilter] = React.useState<string>('All');

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
        const totalSalesCount = filteredSales.length;
        const lowStockCount = products.filter(p => p.stock < (p.lowStockThreshold || 5)).length;
        const totalProducts = products.reduce((sum, p) => sum + p.stock, 0);
        return { totalSalesCount, lowStockCount, totalProducts };
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

    const salesmanStats = useMemo(() => {
        const stats: Record<string, { count: number; total: number }> = {};
        filteredSales.forEach(sale => {
            const salesman = sale.salesman || 'Unassigned';
            const status = sale.shipping?.status || 'Pending';
            
            if (salesmanStatusFilter !== 'All' && status !== salesmanStatusFilter) return;

            if (!stats[salesman]) {
                stats[salesman] = { count: 0, total: 0 };
            }
            stats[salesman].count += 1;
            stats[salesman].total += sale.total;
        });
        return Object.entries(stats).map(([name, data]) => ({
            name,
            count: data.count,
            total: data.total
        })).sort((a, b) => b.total - a.total);
    }, [filteredSales, salesmanStatusFilter]);



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

            {/* Sales & Orders Overview */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '16px',
                marginBottom: '24px'
            }}>
                <StatsCard
                    title="Total Sales"
                    value={stats.totalSalesCount}
                    icon={ShoppingBag}
                    trend="All orders"
                    color="var(--color-blue)"
                    onClick={() => {
                        localStorage.setItem('orders_statusFilter', JSON.stringify([]));
                        localStorage.setItem('orders_payStatusFilter', JSON.stringify([]));
                        localStorage.setItem('orders_dateRange', JSON.stringify(dateRange));
                        localStorage.setItem('orders_salesmanFilter', 'All');
                        localStorage.setItem('orders_shippingCoFilter', JSON.stringify([]));
                        navigate('/orders');
                    }}
                />
                {orderStatusStats.map((stat, idx) => {
                    let color = '#1D4ED8', bgColor = '#EFF6FF'; // default blue (Shipped, etc)
                    if (stat.status === 'Delivered') { color = '#059669'; bgColor = '#D1FAE5'; } // green
                    else if (stat.status === 'Cancelled' || stat.status === 'Returned') { color = '#DC2626'; bgColor = '#FEE2E2'; } // red
                    else if (stat.status === 'ReStock') { color = '#7E22CE'; bgColor = '#F3E8FF'; } // purple
                    else if (stat.status === 'Ordered' || stat.status === 'Pending') { color = '#D97706'; bgColor = '#FEF3C7'; } // yellow

                    return (
                        <StatsCard
                            key={idx}
                            title={stat.status}
                            value={stat.count}
                            icon={Package}
                            trend={`$${stat.total.toLocaleString()}`}
                            color={color}
                            bgColor={bgColor}
                            textColor={color}
                            onClick={() => {
                                localStorage.setItem('orders_statusFilter', JSON.stringify([stat.status]));
                                localStorage.setItem('orders_payStatusFilter', JSON.stringify([]));
                                localStorage.setItem('orders_dateRange', JSON.stringify(dateRange));
                                localStorage.setItem('orders_salesmanFilter', 'All');
                                localStorage.setItem('orders_shippingCoFilter', JSON.stringify([]));
                                navigate('/orders');
                            }}
                        />
                    );
                })}
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
                    let color = '#1D4ED8', bgColor = '#EFF6FF';
                    if (stat.status === 'Paid') { color = '#059669'; bgColor = '#D1FAE5'; }
                    else if (stat.status === 'Unpaid') { color = '#DC2626'; bgColor = '#FEE2E2'; }
                    else if (stat.status === 'Cancel') { color = '#DC2626'; bgColor = '#FEE2E2'; }
                    
                    return (
                        <StatsCard
                            key={idx}
                            title={stat.status + " Orders"}
                            value={stat.count}
                            icon={CreditCard}
                            trend={`$${stat.total.toLocaleString()} Revenue`}
                            color={color}
                            bgColor={bgColor}
                            textColor={color}
                            onClick={() => {
                                localStorage.setItem('orders_payStatusFilter', JSON.stringify([stat.status]));
                                localStorage.setItem('orders_statusFilter', JSON.stringify([]));
                                localStorage.setItem('orders_dateRange', JSON.stringify(dateRange));
                                localStorage.setItem('orders_salesmanFilter', 'All');
                                localStorage.setItem('orders_shippingCoFilter', JSON.stringify([]));
                                navigate('/orders');
                            }}
                        />
                    );
                })}
            </div>

            {/* Inventory Overview */}
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>Inventory</h3>
            <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '16px',
                marginBottom: '24px'
            }}>
                <StatsCard
                    title="Products in Stock"
                    value={stats.totalProducts}
                    icon={TrendingUp}
                    color="var(--color-primary)"
                    onClick={() => navigate('/inventory')}
                />
                <StatsCard
                    title="Low Stock Alert"
                    value={stats.lowStockCount}
                    icon={AlertTriangle}
                    trend="Items require attention"
                    color="var(--color-red)"
                    onClick={() => navigate('/inventory')}
                />
            </div>



            {/* Reports Grid: Remaining Panels */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(300px, 1fr))',
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

                {/* 4. Salesman Performance */}
                <div style={{ marginBottom: '32px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ fontSize: '16px', fontWeight: 'bold' }}>Salesman Performance</h3>
                        <select 
                            className="text-input" 
                            style={{ padding: '4px', fontSize: '12px', width: 'auto', minWidth: '100px' }}
                            value={salesmanStatusFilter}
                            onChange={(e) => setSalesmanStatusFilter(e.target.value)}
                        >
                            <option value="All">All Statuses</option>
                            <option value="Delivered">Delivered</option>
                            <option value="Shipped">Shipped</option>
                            <option value="Pending">Pending</option>
                            <option value="Ordered">Ordered</option>
                            <option value="Cancelled">Cancelled</option>
                            <option value="Returned">Returned</option>
                        </select>
                    </div>
                    {salesmanStats.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg)' }} className="glass-panel">No data.</div>
                    ) : (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))',
                            gap: '16px'
                        }}>
                            {salesmanStats.map((s, index) => (
                                <StatsCard
                                    key={index}
                                    title={s.name}
                                    value={`${s.count} Orders`}
                                    icon={User}
                                    trend={`$${s.total.toLocaleString()} Revenue`}
                                    color="var(--color-primary)"
                                />
                            ))}
                        </div>
                    )}
                </div>

            {/* Product Report Cards */}
            <div style={{ marginBottom: '32px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>Product Report</h3>
                {pivotStats.product.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg)' }} className="glass-panel">No data.</div>
                ) : (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '16px'
                    }}>
                        {pivotStats.product.map((p, idx) => (
                            <StatsCard
                                key={idx}
                                title={p.name}
                                value={`${p.total} Units`}
                                icon={Package}
                                trend={`${p.delivered} Delivered`}
                                color="var(--color-purple)"
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Dashboard;
