import React from 'react';
import { DollarSign, ShoppingBag, AlertTriangle, TrendingUp } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useHeader } from '../context/HeaderContext';
import StatsCard from '../components/StatsCard';
import SalesChart from '../components/SalesChart';

const Dashboard: React.FC = () => {
    const { products, sales } = useStore();
    const { setHeaderContent } = useHeader();

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

    const totalRevenue = sales.reduce((sum, sale) => sum + sale.total, 0);
    const totalProperSales = sales.length; // renamed from totalSales to avoid conflict
    const lowStockCount = products.filter(p => p.stock < 5).length;
    const totalProducts = products.reduce((sum, p) => sum + p.stock, 0);

    return (
        <div>


            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '24px',
                marginBottom: '40px'
            }}>
                <StatsCard
                    title="Total Revenue"
                    value={`$${totalRevenue.toLocaleString()}`}
                    icon={DollarSign}
                    trend="+12.5% from last month"
                    color="var(--color-green)"
                />
                <StatsCard
                    title="Total Sales"
                    value={totalProperSales}
                    icon={ShoppingBag}
                    trend="+5 new today"
                    color="var(--color-blue)"
                />
                <StatsCard
                    title="Products in Stock"
                    value={totalProducts}
                    icon={TrendingUp}
                    color="var(--color-primary)"
                />
                <StatsCard
                    title="Low Stock Alert"
                    value={lowStockCount}
                    icon={AlertTriangle}
                    trend="Items require attention"
                    color="var(--color-red)"
                />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
                <div className="glass-panel" style={{ padding: '24px', minHeight: '300px' }}>
                    <h3 style={{ marginBottom: '20px' }}>Recent Sales</h3>
                    {sales.length === 0 ? (
                        <div style={{ color: 'var(--color-text-muted)' }}>No sales recorded yet.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {sales.slice(0, 5).map(sale => (
                                <div key={sale.id} style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '16px', borderBottom: '1px solid var(--color-border)' }}>
                                    <div>
                                        <div style={{ fontWeight: '500' }}>Order #{sale.id.slice(-6)}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{new Date(sale.date).toLocaleDateString()}</div>
                                    </div>
                                    <div style={{ fontWeight: 'bold', color: 'var(--color-primary)' }}>
                                        ${sale.total.toLocaleString()}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="glass-panel" style={{ padding: '24px', minHeight: '300px', display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ marginBottom: '20px' }}>Last 7 Days Sales</h3>
                    <div style={{ flex: 1, minHeight: '200px' }}>
                        <SalesChart />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
