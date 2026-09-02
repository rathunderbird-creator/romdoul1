import React, { useMemo } from 'react';
import { ShoppingBag, AlertTriangle, TrendingUp, RefreshCw, CreditCard, Package, User, Plus, Truck, Globe } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useHeader } from '../context/HeaderContext';
import { useLanguage } from '../context/LanguageContext';
import { useMobile } from '../hooks/useMobile';
import StatsCard from '../components/StatsCard';
import { DateRangePicker } from '../components';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { mapSaleEntity } from '../utils/mapper';
import { fetchAll } from '../utils/fetchAll';
import type { Sale } from '../types';

// Canonical status ordering used by every performance section.
const STATUS_ORDER = ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Drafted', 'Cancelled', 'Returned', 'ReStock'];

// Single source of truth for status colors, so every card stays consistent.
const getStatusStyle = (status: string): { color: string; bgColor: string } => {
    switch (status) {
        case 'Delivered': return { color: '#059669', bgColor: '#D1FAE5' };
        case 'Cancelled':
        case 'Returned': return { color: '#DC2626', bgColor: '#FEE2E2' };
        case 'ReStock': return { color: '#7E22CE', bgColor: '#F3E8FF' };
        case 'Confirmed': return { color: '#0369A1', bgColor: '#E0F2FE' };
        case 'Drafted':
        case 'Pending': return { color: '#D97706', bgColor: '#FEF3C7' };
        default: return { color: '#1D4ED8', bgColor: '#EFF6FF' };
    }
};

// Sorted, translated status pills shared by the salesman/page/shipping/product cards.
const StatusBadges: React.FC<{ statuses: Record<string, number>; t: (k: string) => string }> = ({ statuses, t }) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
        {Object.entries(statuses)
            .filter(([, count]) => count > 0)
            .sort((a, b) => {
                const ia = STATUS_ORDER.indexOf(a[0]);
                const ib = STATUS_ORDER.indexOf(b[0]);
                return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
            })
            .map(([status, count]) => {
                const { color, bgColor } = getStatusStyle(status);
                return (
                    <span key={status} style={{
                        fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
                        backgroundColor: bgColor, color, fontWeight: 600,
                        display: 'inline-flex', alignItems: 'center'
                    }}>
                        {t(`status.${status.toLowerCase()}`) || status}: {count}
                    </span>
                );
            })}
    </div>
);

// Section heading with an icon badge and an optional count pill / right-side action.
const SectionHeader: React.FC<{
    icon: React.ComponentType<{ size?: number }>;
    title: string;
    count?: number;
    action?: React.ReactNode;
}> = ({ icon: Icon, title, count, action }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '30px', height: '30px', borderRadius: '8px', background: 'var(--color-primary-light)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={17} />
            </div>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0 }}>{title}</h3>
            {typeof count === 'number' && (
                <span style={{ fontSize: '12px', fontWeight: 600, padding: '2px 9px', borderRadius: '20px', background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>{count}</span>
            )}
        </div>
        {action}
    </div>
);

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
        const stored = localStorage.getItem('dashboard_dateRange');
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {}
        }
        const now = new Date();
        const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
        return { start: today, end: today };
    });

    React.useEffect(() => {
        localStorage.setItem('dashboard_dateRange', JSON.stringify(dateRange));
    }, [dateRange]);

    const [filteredSales, setFilteredSales] = React.useState<Sale[]>([]);
    // Get File is a settlement pipeline (files waiting for payout), so its card
    // counts ALL orders in that status — independent of the dashboard date range.
    const [getFileGlobal, setGetFileGlobal] = React.useState({ count: 0, total: 0 });
    const [stockInCount, setStockInCount] = React.useState(0);
    const [stockOutCount, setStockOutCount] = React.useState(0);
    const [isLoadingSales, setIsLoadingSales] = React.useState(false);
    const [salesmanStatusFilter, setSalesmanStatusFilter] = React.useState<string>('All');
    const [pageStatusFilter, setPageStatusFilter] = React.useState<string>('All');

    const fetchDashboardSales = React.useCallback(async () => {
        setIsLoadingSales(true);
        try {
            // All three queries are chunk-fetched (fetchAll) so wide ranges are
            // never silently truncated at the API's ~1000-row cap.
            const invData = await fetchAll((from, to) => {
                let invQuery = supabase.from('stock_movements').select('id, type, quantity');
                if (dateRange.start) {
                    invQuery = invQuery.gte('movement_date', dateRange.start.split('T')[0]);
                }
                if (dateRange.end) {
                    invQuery = invQuery.lte('movement_date', dateRange.end.split('T')[0]);
                }
                return invQuery.order('id', { ascending: true }).range(from, to);
            });
            const inTotal = invData.filter((d: any) => d.type === 'in').reduce((sum: number, d: any) => sum + (d.quantity || 0), 0);
            const outTotal = invData.filter((d: any) => d.type === 'out').reduce((sum: number, d: any) => sum + (d.quantity || 0), 0);
            setStockInCount(inTotal);
            setStockOutCount(outTotal);

            const data = await fetchAll((from, to) => {
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
                return query.order('id', { ascending: true }).range(from, to);
            });

            // Global Get File pipeline, ignoring the date range.
            const gfRows = await fetchAll((from, to) =>
                supabase.from('sales').select('id, total').eq('payment_status', 'Get File')
                    .order('id', { ascending: true }).range(from, to)
            );
            setGetFileGlobal({
                count: gfRows.length,
                total: gfRows.reduce((s: number, r: any) => s + (Number(r.total) || 0), 0)
            });

            const mapped = data.map(mapSaleEntity);
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

        // Get File shows the GLOBAL pipeline (all orders awaiting settlement),
        // not just those ordered inside the date range.
        if (getFileGlobal.count > 0) {
            stats['Get File'] = { ...getFileGlobal };
        } else {
            delete stats['Get File'];
        }

        return Object.entries(stats).map(([status, data]) => ({
            status,
            count: data.count,
            total: data.total
        })).sort((a, b) => b.total - a.total);
    }, [filteredSales, getFileGlobal]);

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
        const stats: Record<string, { 
            count: number; 
            total: number; 
            soldItems: number; 
            shippedDeliveredTotal: number;
            statuses: Record<string, number>;
        }> = {};

        filteredSales.forEach(sale => {
            const salesman = sale.salesman || 'Unassigned';
            const status = sale.shipping?.status || 'Pending';
            
            if (salesmanStatusFilter !== 'All' && status !== salesmanStatusFilter) return;

            if (!stats[salesman]) {
                stats[salesman] = { 
                    count: 0, 
                    total: 0, 
                    soldItems: 0, 
                    shippedDeliveredTotal: 0,
                    statuses: {}
                };
            }
            stats[salesman].count += 1;
            stats[salesman].total += sale.total;

            if (!stats[salesman].statuses[status]) {
                stats[salesman].statuses[status] = 0;
            }
            stats[salesman].statuses[status] += 1;

            if (status === 'Confirmed' || status === 'Shipped' || status === 'Delivered') {
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
            shippedDeliveredTotal: data.shippedDeliveredTotal,
            statuses: data.statuses
        })).sort((a, b) => b.total - a.total);
    }, [filteredSales, salesmanStatusFilter]);

    const pageStats = useMemo(() => {
        const stats: Record<string, { 
            count: number; 
            total: number; 
            soldItems: number; 
            shippedDeliveredTotal: number;
            statuses: Record<string, number>;
        }> = {};

        filteredSales.forEach(sale => {
            const page = sale.pageSource || sale.customer?.page || 'Unknown Page';
            const status = sale.shipping?.status || 'Pending';
            
            if (pageStatusFilter !== 'All' && status !== pageStatusFilter) return;

            if (!stats[page]) {
                stats[page] = { 
                    count: 0, 
                    total: 0, 
                    soldItems: 0, 
                    shippedDeliveredTotal: 0,
                    statuses: {}
                };
            }
            stats[page].count += 1;
            stats[page].total += sale.total;

            if (!stats[page].statuses[status]) {
                stats[page].statuses[status] = 0;
            }
            stats[page].statuses[status] += 1;

            if (status === 'Confirmed' || status === 'Shipped' || status === 'Delivered') {
                stats[page].shippedDeliveredTotal += sale.total;
                sale.items.forEach(item => {
                    stats[page].soldItems += item.quantity;
                });
            }
        });
        return Object.entries(stats).map(([name, data]) => ({
            name,
            count: data.count,
            total: data.total,
            soldItems: data.soldItems,
            shippedDeliveredTotal: data.shippedDeliveredTotal,
            statuses: data.statuses
        })).sort((a, b) => b.total - a.total);
    }, [filteredSales, pageStatusFilter]);

    const pivotStats = useMemo(() => {
        const createPivot = () => ({
            ordered: 0,
            pending: 0,
            confirmed: 0,
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
            let field: 'ordered' | 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled' | 'returned' | 'restock' | null = null;

            if (status === 'Drafted') field = 'ordered';
            else if (status === 'Confirmed') field = 'confirmed';
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
                .map(([name, stats]) => {
                    const productObj = products.find(p => p.name === name);
                    return { name, ...stats, stock: productObj ? productObj.stock : 0 };
                })
                .sort((a, b) => b.total - a.total);

        return {
            product: formatData(productMap)
        };
    }, [filteredSales, products]);

    const shippingStats = useMemo(() => {
        const stats: Record<string, { 
            count: number; 
            cost: number; 
            delivered: number;
            statuses: Record<string, number>;
        }> = {};
        
        filteredSales.forEach(sale => {
            const ship = sale.shipping;
            if (ship && ship.company) {
                const company = ship.company;
                const status = ship.status || 'Pending';
                if (!stats[company]) {
                    stats[company] = { 
                        count: 0, 
                        cost: 0, 
                        delivered: 0,
                        statuses: {}
                    };
                }
                stats[company].count += 1;
                stats[company].cost += ship.cost || 0;

                if (!stats[company].statuses[status]) {
                    stats[company].statuses[status] = 0;
                }
                stats[company].statuses[status] += 1;

                if (status === 'Confirmed' || status === 'Shipped' || status === 'Delivered') {
                    stats[company].delivered += 1;
                }
            }
        });

        return Object.entries(stats).map(([name, data]) => ({
            name,
            count: data.count,
            cost: data.cost,
            delivered: data.delivered,
            statuses: data.statuses
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
                        @keyframes dashLoad {
                            0% { margin-left: -40%; }
                            100% { margin-left: 100%; }
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

            {/* Slim loading indicator shown while dashboard data refetches */}
            <div style={{ height: '3px', marginBottom: '17px', borderRadius: '2px', overflow: 'hidden', background: isLoadingSales ? 'var(--color-primary-light)' : 'transparent' }}>
                {isLoadingSales && (
                    <div style={{ height: '100%', width: '40%', background: 'var(--color-primary)', borderRadius: '2px', animation: 'dashLoad 1s ease-in-out infinite' }} />
                )}
            </div>

            {/* Sales & Orders Overview */}
            <SectionHeader icon={ShoppingBag} title="Sales & Orders" count={stats.totalSalesCount} />
            <div className="dashboard-flex-container" style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '16px',
                marginBottom: '24px'
            }}>
                <StatsCard
                    title={t('dashboard.totalOrders') || 'Total Orders'}
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
                        localStorage.setItem('orders_pageFilter', JSON.stringify([]));
                        navigate('/orders');
                    }}
                />
                {orderStatusStats.map((stat, idx) => {
                    let color = '#1D4ED8', bgColor = '#EFF6FF'; // default blue (Shipped, etc)
                    if (stat.status === 'Delivered') { color = '#059669'; bgColor = '#D1FAE5'; } // green
                    else if (stat.status === 'Cancelled' || stat.status === 'Returned') { color = '#DC2626'; bgColor = '#FEE2E2'; } // red
                    else if (stat.status === 'ReStock') { color = '#7E22CE'; bgColor = '#F3E8FF'; } // purple
                    else if (stat.status === 'Confirmed') { color = '#0369A1'; bgColor = '#E0F2FE'; } // sky blue
                    else if (stat.status === 'Drafted' || stat.status === 'Pending') { color = '#D97706'; bgColor = '#FEF3C7'; } // yellow

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
                                localStorage.setItem('orders_pageFilter', JSON.stringify([]));
                                navigate('/orders');
                            }}
                        />
                    );
                })}
            </div>

            {/* Pay Status Cards */}
            <SectionHeader icon={CreditCard} title={t('dashboard.paymentStatus')} count={paymentStatusStats.length} />
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
                                // Get File is counted globally, so open Orders without a
                                // date filter — otherwise the table would show fewer.
                                localStorage.setItem('orders_dateRange', JSON.stringify(stat.status === 'Get File' ? { start: '', end: '' } : dateRange));
                                localStorage.setItem('orders_salesmanFilter', 'All');
                                localStorage.setItem('orders_shippingCoFilter', JSON.stringify([]));
                                localStorage.setItem('orders_pageFilter', JSON.stringify([]));
                                navigate('/orders');
                            }}
                        />
                    );
                })}
            </div>

            {/* Inventory Overview */}
            <SectionHeader icon={Package} title={t('dashboard.inventory')} />
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
                <StatsCard
                    title="Stock-In (Qty)"
                    value={stockInCount}
                    icon={Package}
                    color="#059669"
                    bgColor="#D1FAE5"
                    onClick={() => navigate('/stock-in')}
                />
                <StatsCard
                    title="Stock-Out (Qty)"
                    value={stockOutCount}
                    icon={Package}
                    color="#DC2626"
                    bgColor="#FEE2E2"
                    onClick={() => navigate('/stock-out')}
                />
            </div>



            {/* Top Selling Products */}
            <div style={{ marginBottom: '32px' }}>
                <SectionHeader icon={TrendingUp} title={t('dashboard.topSellingProducts')} count={topProducts.length} />
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
                                    localStorage.setItem('orders_pageFilter', JSON.stringify([]));
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
                    <SectionHeader
                        icon={User}
                        title={t('dashboard.salesmanPerformance')}
                        count={salesmanStats.length}
                        action={
                            <select
                                className="text-input"
                                style={{ padding: '4px', fontSize: '12px', width: 'auto', minWidth: '100px' }}
                                value={salesmanStatusFilter}
                                onChange={(e) => setSalesmanStatusFilter(e.target.value)}
                            >
                                <option value="All">{t('dashboard.allStatuses')}</option>
                                <option value="Delivered">{t('status.delivered')}</option>
                                <option value="Shipped">{t('status.shipped')}</option>
                                <option value="Confirmed">{t('status.confirmed')}</option>
                                <option value="Pending">{t('status.pending')}</option>
                                <option value="Drafted">{t('status.ordered')}</option>
                                <option value="Cancelled">{t('status.cancelled')}</option>
                                <option value="Returned">{t('status.returned')}</option>
                            </select>
                        }
                    />
                    {salesmanStats.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg)' }} className="glass-panel">{t('dashboard.noData')}</div>
                    ) : (
                        <div className="dashboard-flex-container" style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '16px'
                        }}>
                            {salesmanStats.map((s, index) => {
                                return (
                                    <StatsCard
                                        key={index}
                                        title={s.name}
                                        value={`$${s.shippedDeliveredTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                        trend={
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                                                    <span style={{ color: '#1B3B6F', fontWeight: 600 }}>{s.soldItems} {t('dashboard.soldItems')}</span>
                                                    {' | '}
                                                    <span style={{ color: '#E65F2B', fontWeight: 600 }}>{s.count} {t('dashboard.orders')}</span>
                                                </div>
                                                <StatusBadges statuses={s.statuses} t={t} />
                                            </div>
                                        }
                                        icon={User}
                                        color="var(--color-primary)"
                                        onClick={() => {
                                            localStorage.setItem('orders_salesmanFilter', s.name);
                                            localStorage.setItem('orders_statusFilter', JSON.stringify([]));
                                            localStorage.setItem('orders_payStatusFilter', JSON.stringify([]));
                                            localStorage.setItem('orders_searchTerm', '');
                                            localStorage.setItem('orders_shippingCoFilter', JSON.stringify([]));
                                            localStorage.setItem('orders_pageFilter', JSON.stringify([]));
                                            localStorage.setItem('orders_dateRange', JSON.stringify(dateRange));
                                            navigate('/orders');
                                        }}
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* 4.5 Page Performance */}
                <div style={{ marginBottom: '32px' }}>
                    <SectionHeader
                        icon={Globe}
                        title="Page Performance"
                        count={pageStats.length}
                        action={
                            <select
                                className="text-input"
                                style={{ padding: '4px', fontSize: '12px', width: 'auto', minWidth: '100px' }}
                                value={pageStatusFilter}
                                onChange={(e) => setPageStatusFilter(e.target.value)}
                            >
                                <option value="All">{t('dashboard.allStatuses')}</option>
                                <option value="Delivered">{t('status.delivered')}</option>
                                <option value="Shipped">{t('status.shipped')}</option>
                                <option value="Confirmed">{t('status.confirmed')}</option>
                                <option value="Pending">{t('status.pending')}</option>
                                <option value="Drafted">{t('status.ordered')}</option>
                                <option value="Cancelled">{t('status.cancelled')}</option>
                                <option value="Returned">{t('status.returned')}</option>
                            </select>
                        }
                    />
                    {pageStats.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg)' }} className="glass-panel">{t('dashboard.noData')}</div>
                    ) : (
                        <div className="dashboard-flex-container" style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '16px'
                        }}>
                            {pageStats.map((s, index) => {
                                return (
                                    <StatsCard
                                        key={index}
                                        title={s.name}
                                        value={`$${s.shippedDeliveredTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                        trend={
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                                                    <span style={{ color: '#1B3B6F', fontWeight: 600 }}>{s.soldItems} {t('dashboard.soldItems')}</span>
                                                    {' | '}
                                                    <span style={{ color: '#E65F2B', fontWeight: 600 }}>{s.count} {t('dashboard.orders')}</span>
                                                </div>
                                                <StatusBadges statuses={s.statuses} t={t} />
                                            </div>
                                        }
                                        icon={Globe}
                                        color="var(--color-primary)"
                                        onClick={() => {
                                            localStorage.setItem('orders_pageFilter', JSON.stringify([s.name]));
                                            localStorage.setItem('orders_searchTerm', '');
                                            localStorage.setItem('orders_statusFilter', JSON.stringify([]));
                                            localStorage.setItem('orders_payStatusFilter', JSON.stringify([]));
                                            localStorage.setItem('orders_salesmanFilter', 'All');
                                            localStorage.setItem('orders_shippingCoFilter', JSON.stringify([]));
                                            localStorage.setItem('orders_dateRange', JSON.stringify(dateRange));
                                            navigate('/orders');
                                        }}
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* 5. Shipping Performance */}
                <div style={{ marginBottom: '32px' }}>
                    <SectionHeader icon={Truck} title={t('dashboard.shippingPerformance')} count={shippingStats.length} />
                    {shippingStats.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg)' }} className="glass-panel">{t('dashboard.noData')}</div>
                    ) : (
                        <div className="dashboard-flex-container" style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '16px'
                        }}>
                            {shippingStats.map((carrier, index) => {
                                return (
                                    <StatsCard
                                        key={index}
                                        title={carrier.name}
                                        value={<span>{carrier.count} <span style={{ color: '#E65F2B', fontSize: '14px', fontWeight: 500 }}>{t('dashboard.orders')}</span></span>}
                                        trend={
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                                    ${carrier.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cost | <span style={{ color: '#E65F2B', fontWeight: 600 }}>{carrier.delivered} {t('dashboard.orders')}</span>
                                                </div>
                                                <StatusBadges statuses={carrier.statuses} t={t} />
                                            </div>
                                        }
                                        icon={Truck}
                                        color="var(--color-primary)"
                                        onClick={() => {
                                            localStorage.setItem('orders_shippingCoFilter', JSON.stringify([carrier.name]));
                                            localStorage.setItem('orders_statusFilter', JSON.stringify([]));
                                            localStorage.setItem('orders_payStatusFilter', JSON.stringify([]));
                                            localStorage.setItem('orders_searchTerm', '');
                                            localStorage.setItem('orders_pageFilter', JSON.stringify([]));
                                            localStorage.setItem('orders_dateRange', JSON.stringify(dateRange));
                                            navigate('/orders');
                                        }}
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>

            {/* Product Report Cards */}
            <div style={{ marginBottom: '32px' }}>
                <SectionHeader icon={Package} title={t('dashboard.productReport')} count={pivotStats.product.length} />
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
                                value={<span>{p.total} <span style={{ color: '#E65F2B', fontSize: '14px', fontWeight: 500 }}>{t('dashboard.orders')}</span></span>}
                                trend={
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                                            <span style={{ color: '#1B3B6F', fontWeight: 600 }}>{p.confirmed + p.shipped + p.delivered} {t('dashboard.sold')}</span>
                                            {' | '}
                                            <span style={{ color: '#E65F2B', fontWeight: 600 }}>{p.total} {t('dashboard.orders')}</span>
                                            {' | '}
                                            <span style={{ color: '#059669', fontWeight: 600 }}>{p.stock} {t('dashboard.stock')}</span>
                                        </div>
                                        <StatusBadges statuses={{
                                            Pending: p.pending,
                                            Confirmed: p.confirmed,
                                            Shipped: p.shipped,
                                            Delivered: p.delivered,
                                            Drafted: p.ordered,
                                            Cancelled: p.cancelled,
                                            Returned: p.returned,
                                            ReStock: p.restock
                                        }} t={t} />
                                    </div>
                                }
                                icon={Package}
                                color="var(--color-purple)"
                                onClick={() => {
                                    localStorage.setItem('orders_searchTerm', `"${p.name}"`);
                                    localStorage.setItem('orders_statusFilter', JSON.stringify([]));
                                    localStorage.setItem('orders_payStatusFilter', JSON.stringify([]));
                                    localStorage.setItem('orders_salesmanFilter', 'All');
                                    localStorage.setItem('orders_shippingCoFilter', JSON.stringify([]));
                                    localStorage.setItem('orders_pageFilter', JSON.stringify([]));
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
