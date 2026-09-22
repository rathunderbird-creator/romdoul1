// Dashboard 2 — route container. Resolves store / auth / router concerns and
// hands plain data + callbacks to the pure Dashboard2View (which the dev
// preview in src/dev renders with fixtures).
import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../context/StoreContext';
import { useHeader } from '../../context/HeaderContext';
import { useLanguage } from '../../context/LanguageContext';
import { useMobile } from '../../hooks/useMobile';
import { orderListState, type OrderListFilters } from '../../utils/orderListFilters';
import { useDashboard2Data } from './useDashboard2Data';
import Dashboard2View from './Dashboard2View';
import type { Dashboard2Actions } from './types';

const Dashboard2Page: React.FC = () => {
    const { products, refreshData } = useStore();
    const { setHeaderContent } = useHeader();
    const { t, language } = useLanguage();
    const isMobile = useMobile();
    const navigate = useNavigate();
    const data = useDashboard2Data();

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>{t('dashboard2.title')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>{t('dashboard2.subtitle')}</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

    const { setRange, refresh } = data;
    const actions = useMemo<Dashboard2Actions>(() => ({
        onRangeChange: setRange,
        onRefresh: () => {
            refresh();
            // Products (stock levels) live in the store — refresh them too.
            refreshData(true);
        },
        onOpenOrders: (filters: OrderListFilters) => navigate('/orders', { state: orderListState(filters) }),
        onNewOrder: () => navigate('/orders', { state: { createNew: true } }),
        onOpenInventory: () => navigate('/inventory'),
    }), [setRange, refresh, refreshData, navigate]);

    return (
        <Dashboard2View
            data={{
                range: data.range,
                previous: data.previousAvailable ? data.previous : null,
                orders: data.orders,
                previousOrders: data.previousOrders,
                products,
                getFile: data.getFile,
                stockIn: data.stockIn,
                stockOut: data.stockOut,
                now: data.now,
            }}
            loading={data.loading}
            refreshing={data.refreshing}
            salesError={data.salesError ? { message: data.salesError, retry: data.retrySales } : null}
            inventoryError={data.inventoryError ? { message: data.inventoryError, retry: data.retryInventory } : null}
            actions={actions}
            t={t}
            language={language}
            isMobile={isMobile}
        />
    );
};

export default Dashboard2Page;
