import React, { useMemo } from 'react';
import { ShoppingBag, AlertTriangle, TrendingUp, RefreshCw, CreditCard, Package, User, Plus } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useHeader } from '../context/HeaderContext';
import { useLanguage } from '../context/LanguageContext';
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
    const { t } = useLanguage();
    const isMobile = useMobile();
    const navigate = useNavigate();

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>{t('dashboard.title')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>{t('dashboard.subtitle')}</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

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
        const stats: Record<string, { count: number; total: number; soldItems: number; shippedDeliveredTotal: number }> = {};
        filteredSales.forEach(sale => {
            const salesman = sale.salesman || 'Unassigned';
            const status = sale.shipping?.status || 'Pending';
            
            if (salesmanStatusFilter !== 'All' && status !== salesmanStatusFilter) return;

            if (!stats[salesman]) {
                stats[salesman] = { count: 0, total: 0, soldItems: 0, shippedDeliveredTotal: 0 };
            }
            stats[salesman].count += 1;
            stats[salesman].total += sale.total;

            if (status === 'Shipped' || status === 'Delivered') {
                stats[salesman].shippedDeliveredTotal += sale.total;
                sale.items.forEach(item => {
                    stats[salesman].soldItems += item.quantity;
                });
            }
        });
        return Object.entries(stats).map(([name, data]) => ({
            name,
            count: data.count,
            total: data.total,
            soldItems: data.soldItems,
            shippedDeliveredTotal: data.shippedDeliveredTotal
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
                    flexDirection: isMobile ? 'column' : 'row',
                    alignItems: isMobile ? 'stretch' : 'center',
                    gap: '12px',
                    width: isMobile ? '100%' : 'auto'
                }}>
                    <div style={{ flex: 1 }}>
                        <DateRangePicker value={dateRange} onChange={setDateRange} />
                    </div>
                    <div style={{ 
                        display: 'flex', 
                        gap: '12px',
                        justifyContent: isMobile ? 'space-between' : 'flex-end'
                    }}>
                        <button
                            className="primary-button"
                            style={{
                                padding: '10px 16px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                height: '42px',
                                borderRadius: '8px',
                                fontWeight: 500,
                                whiteSpace: 'nowrap',
                                flex: isMobile ? 1 : 'none'
                            }}
                            onClick={() => navigate('/orders', { state: { createNew: true } })}
                        >
                            <Plus size={18} />
                            New Order
                        </button>
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
                    </div>
                </div>
                <style>{`
                        @keyframes spin { 
                            100% { -webkit-transform: rotate(360deg); transform:rotate(360deg); } 
                        }
                        .dashboard-flex-container > * {
                            flex: 1 1 calc(20% - 16px);
                            min-width: 200px;
                        }
                        @media (max-width: 768px) {
                            .dashboard-flex-container > * {
                                flex: 1 1 100%;
                            }
                        }
                    `}</style>
            </div>

            {/* Sales & Orders Overview */}
            <div className="dashboard-flex-container" style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '16px',
                marginBottom: '24px'
            }}>
                <StatsCard
                    title={t('dashboard.totalSales')}
                    value={stats.totalSalesCount}
                    icon={ShoppingBag}
                    trend={t('dashboard.allOrders')}
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
                            color={color}
                            bgColor={bgColor}
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
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>{t('dashboard.paymentStatus')}</h3>
            <div className="dashboard-flex-container" style={{
                display: 'flex',
                flexWrap: 'wrap',
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
                            title={stat.status + ` ${t('dashboard.orders')}`}
                            value={stat.count}
                            icon={CreditCard}
                            color={color}
                            bgColor={bgColor}
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
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>{t('dashboard.inventory')}</h3>
            <div className="dashboard-flex-container" style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '16px',
                marginBottom: '24px'
            }}>
                <StatsCard
                    title={t('dashboard.productsInStock')}
                    value={stats.totalProducts}
                    icon={TrendingUp}
                    color="var(--color-primary)"
                    onClick={() => navigate('/inventory')}
                />
                <StatsCard
                    title={t('dashboard.lowStockAlert')}
                    value={stats.lowStockCount}
                    icon={AlertTriangle}
                    trend={t('dashboard.itemsRequireAttention')}
                    color="var(--color-red)"
                    onClick={() => navigate('/inventory')}
                />
            </div>



            {/* Top Selling Products */}
            <div style={{ marginBottom: '32px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>{t('dashboard.topSellingProducts')}</h3>
                {topProducts.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg)' }} className="glass-panel">{t('dashboard.noData')}</div>
                ) : (
                    <div className="dashboard-flex-container" style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '16px'
                    }}>
                        {topProducts.map((product, index) => (
                            <StatsCard
                                key={index}
                                title={product.name}
                                value={`${product.quantity} ${t('dashboard.sold')}`}
                                icon={ShoppingBag}
                                color="var(--color-primary)"
                                onClick={() => {
                                    localStorage.setItem('orders_searchTerm', `"${product.name}"`);
                                    localStorage.setItem('orders_statusFilter', JSON.stringify(['Shipped', 'Delivered']));
                                    localStorage.setItem('orders_payStatusFilter', JSON.stringify([]));
                                    localStorage.setItem('orders_salesmanFilter', 'All');
                                    localStorage.setItem('orders_shippingCoFilter', JSON.stringify([]));
                                    localStorage.setItem('orders_dateRange', JSON.stringify(dateRange));
                                    navigate('/orders');
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

                {/* 4. Salesman Performance */}
                <div style={{ marginBottom: '32px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ fontSize: '16px', fontWeight: 'bold' }}>{t('dashboard.salesmanPerformance')}</h3>
                        <select 
                            className="text-input" 
                            style={{ padding: '4px', fontSize: '12px', width: 'auto', minWidth: '100px' }}
                            value={salesmanStatusFilter}
                            onChange={(e) => setSalesmanStatusFilter(e.target.value)}
                        >
                            <option value="All">{t('dashboard.allStatuses')}</option>
                            <option value="Delivered">{t('status.delivered')}</option>
                            <option value="Shipped">{t('status.shipped')}</option>
                            <option value="Pending">{t('status.pending')}</option>
                            <option value="Ordered">{t('status.ordered')}</option>
                            <option value="Cancelled">{t('status.cancelled')}</option>
                            <option value="Returned">{t('status.returned')}</option>
                        </select>
                    </div>
                    {salesmanStats.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg)' }} className="glass-panel">{t('dashboard.noData')}</div>
                    ) : (
                        <div className="dashboard-flex-container" style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '16px'
                        }}>
                            {salesmanStats.map((s, index) => (
                                <StatsCard
                                    key={index}
                                    title={s.name}
                                    value={`$${s.shippedDeliveredTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                    trend={`${s.soldItems} ${t('dashboard.soldItems')} | ${s.count} ${t('dashboard.orders')}`}
                                    icon={User}
                                    color="var(--color-primary)"
                                    onClick={() => {
                                        localStorage.setItem('orders_salesmanFilter', s.name);
                                        localStorage.setItem('orders_statusFilter', JSON.stringify([]));
                                        localStorage.setItem('orders_payStatusFilter', JSON.stringify([]));
                                        localStorage.setItem('orders_searchTerm', '');
                                        localStorage.setItem('orders_shippingCoFilter', JSON.stringify([]));
                                        localStorage.setItem('orders_dateRange', JSON.stringify(dateRange));
                                        navigate('/orders');
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </div>

            {/* Product Report Cards */}
            <div style={{ marginBottom: '32px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>{t('dashboard.productReport')}</h3>
                {pivotStats.product.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg)' }} className="glass-panel">{t('dashboard.noData')}</div>
                ) : (
                    <div className="dashboard-flex-container" style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '16px'
                    }}>
                        {pivotStats.product.map((p, idx) => (
                            <StatsCard
                                key={idx}
                                title={p.name}
                                value={`${p.total} ${t('dashboard.units')}`}
                                icon={Package}
                                trend={`${p.delivered} ${t('dashboard.delivered')}`}
                                color="var(--color-purple)"
                                onClick={() => {
                                    localStorage.setItem('orders_searchTerm', `"${p.name}"`);
                                    localStorage.setItem('orders_statusFilter', JSON.stringify([]));
                                    localStorage.setItem('orders_payStatusFilter', JSON.stringify([]));
                                    localStorage.setItem('orders_salesmanFilter', 'All');
                                    localStorage.setItem('orders_shippingCoFilter', JSON.stringify([]));
                                    localStorage.setItem('orders_dateRange', JSON.stringify(dateRange));
                                    navigate('/orders');
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Dashboard;
