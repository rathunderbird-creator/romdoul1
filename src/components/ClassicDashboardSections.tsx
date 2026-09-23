// The classic dashboard's card sections — Sales & Orders, Payment Status,
// Inventory, Top Selling, Salesman/Page/Shipping Performance and the Product
// Report — extracted from pages/DashboardPage.tsx so the merged dashboard
// (Dashboard 2 at /) can show them under its own sections, driven by the SAME
// range and the SAME already-fetched orders. Pure: no router, no store, no
// fetching — the host supplies data and navigation callbacks, so the
// Dashboard 2 fixture preview can render it too.
import React, { useMemo } from 'react';
import { ShoppingBag, AlertTriangle, TrendingUp, CreditCard, Package, User, Truck, Globe } from 'lucide-react';
import StatsCard from './StatsCard';
import type { OrderListFilters } from '../utils/orderListFilters';
import type { Sale, Product } from '../types';

export interface ClassicDashboardSectionsProps {
    orders: Sale[];                    // every order in the selected range
    products: Product[];
    getFileGlobal: { count: number; total: number };  // all-time settlement pipeline
    stockIn: number;
    stockOut: number;
    dateRange: { start: string; end: string };
    t: (key: string) => string;
    onOpenOrders: (filters: OrderListFilters) => void;
    onOpenInventory: () => void;
    onOpenStockIn?: () => void;        // fall back to onOpenInventory when absent
    onOpenStockOut?: () => void;
}

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

// Translated order-status label. Drafted is stored under `status.ordered`, and
// `t` returns the key itself when a translation is missing (so a `|| status`
// fallback never fires) — compare against the key instead.
const statusLabel = (status: string, t: (k: string) => string): string => {
    const key = `status.${status === 'Drafted' ? 'ordered' : status.toLowerCase()}`;
    const label = t(key);
    return label === key ? status : label;
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
                        {statusLabel(status, t)}: {count}
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
    /* Extra pill(s) rendered right after the count, next to the title. */
    extra?: React.ReactNode;
    action?: React.ReactNode;
}> = ({ icon: Icon, title, count, extra, action }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '30px', height: '30px', borderRadius: '8px', background: 'var(--color-primary-light)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={17} />
            </div>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0 }}>{title}</h3>
            {typeof count === 'number' && (
                <span style={{ fontSize: '12px', fontWeight: 600, padding: '2px 9px', borderRadius: '20px', background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>{count}</span>
            )}
            {extra}
        </div>
        {action}
    </div>
);

const ClassicDashboardSections: React.FC<ClassicDashboardSectionsProps> = ({
    orders: filteredSales, products, getFileGlobal, stockIn: stockInCount, stockOut: stockOutCount,
    dateRange, t, onOpenOrders: openOrders, onOpenInventory, onOpenStockIn, onOpenStockOut,
}) => {
    const [salesmanStatusFilter, setSalesmanStatusFilter] = React.useState<string>('All');
    const [pageStatusFilter, setPageStatusFilter] = React.useState<string>('All');

    const stats = useMemo(() => {
        const totalSalesCount = filteredSales.length;
        const lowStockCount = products.filter(p => p.stock < (p.lowStockThreshold || 5)).length;
        const totalProducts = products.reduce((sum, p) => sum + p.stock, 0);
        return { totalSalesCount, lowStockCount, totalProducts };
    }, [filteredSales, products]);

    const { topProducts, soldUnits } = useMemo(() => {
        const productStats: Record<string, { name: string; quantity: number; revenue: number }> = {};
        let soldUnits = 0;

        filteredSales.forEach(sale => {
            if (sale.shipping?.status === 'Shipped' || sale.shipping?.status === 'Delivered') {
                sale.items.forEach(item => {
                    const id = item.id;
                    if (!productStats[id]) {
                        productStats[id] = { name: item.name, quantity: 0, revenue: 0 };
                    }
                    productStats[id].quantity += item.quantity;
                    productStats[id].revenue += item.price * item.quantity;
                    soldUnits += item.quantity;
                });
            }
        });

        return {
            topProducts: Object.values(productStats)
                .sort((a, b) => b.quantity - a.quantity)
                .slice(0, 10), // Top 10
            // Every product, not just the top 10 — matches the Sales & Orders "Sold" units.
            soldUnits
        };
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
            total: 0,   // units, across every status
            orders: 0   // orders containing the product
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

            // A product can appear on several lines of one order — count the order once.
            const seen = new Set<string>();
            sale.items.forEach(item => {
                const qty = item.quantity;

                // Product Pivot
                const product = item.name;
                if (!productMap[product]) productMap[product] = createPivot();
                productMap[product][field!] += qty;
                productMap[product].total += qty;
                if (!seen.has(product)) {
                    seen.add(product);
                    productMap[product].orders += 1;
                }
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
        <div>
            {/* The responsive card-grid rule the classic sections rely on. */}
            <style>{`
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

            {/* Sales & Orders Overview */}
            <SectionHeader
                icon={ShoppingBag}
                title="Sales & Orders"
                extra={(() => {
                    const itemQty = (sale: Sale) => sale.items.reduce((x, i) => x + (i.quantity || 0), 0);
                    const totalQty = filteredSales.reduce((s, sale) => s + itemQty(sale), 0);
                    // "Sold" on this dashboard means Shipped + Delivered (same
                    // rule as the Top Selling Products section).
                    const sdSales = filteredSales.filter(s => s.shipping?.status === 'Shipped' || s.shipping?.status === 'Delivered');
                    const sdOrders = sdSales.length;
                    const sdQty = sdSales.reduce((s, sale) => s + itemQty(sale), 0);
                    return (
                        <>
                            <span title="Sold = Shipped + Delivered" style={{ fontSize: '12px', fontWeight: 600, padding: '2px 9px', borderRadius: '20px', background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                                {stats.totalSalesCount.toLocaleString()} {t('dashboard.orders')}
                                <span style={{ color: '#059669', fontWeight: 700 }}> · {sdOrders.toLocaleString()} {t('dashboard.sold')}</span>
                            </span>
                            <span title="Sold = Shipped + Delivered" style={{ fontSize: '12px', fontWeight: 700, padding: '2px 9px', borderRadius: '20px', background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
                                {totalQty.toLocaleString()} {t('orders.products')}
                                <span style={{ color: '#059669' }}> · {sdQty.toLocaleString()} {t('dashboard.sold')}</span>
                            </span>
                        </>
                    );
                })()}
            />
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
                    onClick={() => openOrders({ dateRange })}
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
                            onClick={() => openOrders({ statuses: [stat.status], dateRange })}
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
                            onClick={() => openOrders({
                                payStatuses: [stat.status],
                                // Get File is counted globally, so open Orders without a
                                // date filter — otherwise the table would show fewer.
                                dateRange: stat.status === 'Get File' ? undefined : dateRange
                            })}
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
                    onClick={onOpenInventory}
                />
                <StatsCard
                    title={t('dashboard.lowStockAlert')}
                    value={stats.lowStockCount}
                    icon={AlertTriangle}
                    trend={t('dashboard.itemsRequireAttention')}
                    color="var(--color-red)"
                    onClick={onOpenInventory}
                />
                <StatsCard
                    title="Stock-In (Qty)"
                    value={stockInCount}
                    icon={Package}
                    color="#059669"
                    bgColor="#D1FAE5"
                    onClick={onOpenStockIn || onOpenInventory}
                />
                <StatsCard
                    title="Stock-Out (Qty)"
                    value={stockOutCount}
                    icon={Package}
                    color="#DC2626"
                    bgColor="#FEE2E2"
                    onClick={onOpenStockOut || onOpenInventory}
                />
            </div>



            {/* Top Selling Products */}
            <div style={{ marginBottom: '32px' }}>
                <SectionHeader
                    icon={TrendingUp}
                    title={t('dashboard.topSellingProducts')}
                    count={topProducts.length}
                    extra={soldUnits > 0 ? (
                        <span title="Units sold (Shipped + Delivered), all products in this range" style={{ fontSize: '12px', fontWeight: 700, padding: '2px 9px', borderRadius: '20px', background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
                            {soldUnits.toLocaleString()} {t('dashboard.sold')}
                        </span>
                    ) : null}
                />
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
                                onClick={() => openOrders({ search: `"${product.name}"`, statuses: ['Shipped', 'Delivered'], dateRange })}
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
                                        onClick={() => openOrders({ salesman: s.name, dateRange })}
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
                                        onClick={() => openOrders({ pages: [s.name], dateRange })}
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
                                        onClick={() => openOrders({ shippingCos: [carrier.name], dateRange })}
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>

            {/* Product Report Cards */}
            <div style={{ marginBottom: '32px' }}>
                <SectionHeader
                    icon={Package}
                    title={t('dashboard.productReport')}
                    count={pivotStats.product.length}
                    extra={(() => {
                        const totalQty = pivotStats.product.reduce((s, p) => s + p.total, 0);
                        return totalQty > 0 ? (
                            <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 9px', borderRadius: '20px', background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
                                {totalQty.toLocaleString()} {t('dashboard.units')}
                            </span>
                        ) : null;
                    })()}
                />
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
                                value={<span>{p.total} <span style={{ color: '#E65F2B', fontSize: '14px', fontWeight: 500 }}>{t('dashboard.units')}</span></span>}
                                trend={
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                                            <span style={{ color: '#1B3B6F', fontWeight: 600 }}>{p.confirmed + p.shipped + p.delivered} {t('dashboard.sold')}</span>
                                            {' | '}
                                            <span style={{ color: '#E65F2B', fontWeight: 600 }}>{p.orders} {t('dashboard.orders')}</span>
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
                                onClick={() => openOrders({ search: `"${p.name}"`, dateRange })}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ClassicDashboardSections;
