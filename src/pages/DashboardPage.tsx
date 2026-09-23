// The classic dashboard page (now at /dashboard-classic — the merged
// dashboard at / renders these same sections under Dashboard 2's own). All
// the card sections live in ../components/ClassicDashboardSections; this page
// only owns its date range, data fetching, filter bar and error states.
import React from 'react';
import { AlertTriangle, RefreshCw, Plus } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useHeader } from '../context/HeaderContext';
import { useLanguage } from '../context/LanguageContext';
import { useMobile } from '../hooks/useMobile';
import ClassicDashboardSections from '../components/ClassicDashboardSections';
import { DateRangePicker } from '../components';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { mapSaleEntity } from '../utils/mapper';
import { fetchAll } from '../utils/fetchAll';
import { orderListState, type OrderListFilters } from '../utils/orderListFilters';
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
        const stored = localStorage.getItem('dashboard_dateRange');
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch { /* corrupt saved range — fall back to today */ }
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
    const [loadError, setLoadError] = React.useState<string | null>(null);
    // Ignore responses from superseded requests (fast range switching), so a
    // slow wide-range fetch can't land last and overwrite a newer range.
    const fetchReqRef = React.useRef(0);

    const fetchDashboardSales = React.useCallback(async () => {
        const reqId = ++fetchReqRef.current;
        setIsLoadingSales(true);
        setLoadError(null);
        // The three queries are independent: run them in parallel, and don't
        // let one failure stop the others. All are chunk-fetched (fetchAll) so
        // wide ranges are never silently truncated at the API's ~1000-row cap.
        const [invRes, salesRes, gfRes] = await Promise.allSettled([
            fetchAll<{ type: string; quantity: number | null }>((from, to) => {
                let invQuery = supabase.from('stock_movements').select('id, type, quantity');
                if (dateRange.start) {
                    invQuery = invQuery.gte('movement_date', dateRange.start.split('T')[0]);
                }
                if (dateRange.end) {
                    invQuery = invQuery.lte('movement_date', dateRange.end.split('T')[0]);
                }
                return invQuery.order('id', { ascending: true }).range(from, to);
            }),
            fetchAll((from, to) => {
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
            }),
            // Global Get File pipeline, ignoring the date range.
            fetchAll<{ total: number | string | null }>((from, to) =>
                supabase.from('sales').select('id, total').eq('payment_status', 'Get File')
                    .order('id', { ascending: true }).range(from, to)
            ),
        ]);
        if (reqId !== fetchReqRef.current) return;

        if (invRes.status === 'fulfilled') {
            const invData = invRes.value;
            setStockInCount(invData.filter(d => d.type === 'in').reduce((sum, d) => sum + (d.quantity || 0), 0));
            setStockOutCount(invData.filter(d => d.type === 'out').reduce((sum, d) => sum + (d.quantity || 0), 0));
        }
        if (salesRes.status === 'fulfilled') {
            setFilteredSales(salesRes.value.map(mapSaleEntity));
        }
        if (gfRes.status === 'fulfilled') {
            setGetFileGlobal({
                count: gfRes.value.length,
                total: gfRes.value.reduce((s, r) => s + (Number(r.total) || 0), 0)
            });
        }

        const failure = [invRes, salesRes, gfRes].find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failure) {
            console.error("Failed to fetch dashboard data:", failure.reason);
            setLoadError((failure.reason as { message?: string })?.message || String(failure.reason));
        }
        setIsLoadingSales(false);
    }, [dateRange]);

    // Opens the Orders list showing exactly this subset. Orders.tsx resets every
    // filter not given here (including search and column filters), so leftovers
    // from an earlier visit can't hide orders the card counted.
    const openOrders = (filters: OrderListFilters) => navigate('/orders', { state: orderListState(filters) });

    React.useEffect(() => {
        fetchDashboardSales();
    }, [fetchDashboardSales]);

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
                    `}</style>
            </div>

            {/* Slim loading indicator shown while dashboard data refetches */}
            <div style={{ height: '3px', marginBottom: '17px', borderRadius: '2px', overflow: 'hidden', background: isLoadingSales ? 'var(--color-primary-light)' : 'transparent' }}>
                {isLoadingSales && (
                    <div style={{ height: '100%', width: '40%', background: 'var(--color-primary)', borderRadius: '2px', animation: 'dashLoad 1s ease-in-out infinite' }} />
                )}
            </div>

            {loadError && (
                <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '20px', padding: '12px 16px', borderRadius: '8px', border: '1px solid #FECACA', background: '#FEF2F2', color: '#B91C1C', fontSize: '13px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                        {t('dashboard.loadError').replace('{message}', loadError)}
                    </span>
                    <button
                        type="button"
                        onClick={fetchDashboardSales}
                        disabled={isLoadingSales}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '6px', border: '1px solid #FECACA', background: '#fff', color: '#B91C1C', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}
                    >
                        <RefreshCw size={13} /> {t('dashboard.retry')}
                    </button>
                </div>
            )}

            <ClassicDashboardSections
                orders={filteredSales}
                products={products}
                getFileGlobal={getFileGlobal}
                stockIn={stockInCount}
                stockOut={stockOutCount}
                dateRange={dateRange}
                t={t}
                onOpenOrders={openOrders}
                onOpenInventory={() => navigate('/inventory')}
                onOpenStockIn={() => navigate('/stock-in')}
                onOpenStockOut={() => navigate('/stock-out')}
            />
        </div>
    );
};

export default Dashboard;
