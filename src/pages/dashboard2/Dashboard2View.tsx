// Dashboard 2 — pure view. Top to bottom (spec §4): sticky toolbar → hero
// KPIs → order pipeline → needs-attention → collected-vs-outstanding chart →
// tabbed performance panel → collapsed inventory detail.
import React, { useMemo } from 'react';
import { Plus, RefreshCw, ShoppingBag } from 'lucide-react';
import { DateRangePicker } from '../../components';
import './dashboard2.css';
import { D2, fmtDay } from './theme';
import {
    summarize, pipelineCounts, otherStatusCounts, dailySeries, lowStockProducts,
    pendingOrders, missingTrackingOrders, couriersOf, rangeLength, groupOrders, productRows,
} from './metrics';
import type { Dashboard2ViewProps, Dashboard2Derived } from './types';
import { ErrorInline, EmptyState, Skeleton } from './ui';
import HeroKpis from './components/HeroKpis';
import Pipeline from './components/Pipeline';
import AttentionSection from './components/AttentionSection';
import CollectionChart from './components/CollectionChart';
import PerformancePanel from './components/PerformancePanel';
import InventoryDetail from './components/InventoryDetail';

const Dashboard2View: React.FC<Dashboard2ViewProps> = ({ data, loading, refreshing, salesError, inventoryError, actions, t, isMobile }) => {
    const { range, previous, orders, previousOrders, products, stockIn, stockOut, now } = data;

    const derived = useMemo<Dashboard2Derived>(() => {
        const missingTracking = missingTrackingOrders(orders);
        return {
            kpis: summarize(orders),
            previousKpis: previous ? summarize(previousOrders) : null,
            pipeline: pipelineCounts(orders),
            otherStatuses: otherStatusCounts(orders),
            series: dailySeries(orders, range),
            lowStock: lowStockProducts(products),
            pending: pendingOrders(orders, now),
            missingTracking,
            missingTrackingCouriers: couriersOf(missingTracking),
        };
    }, [orders, previousOrders, previous, products, range, now]);

    // "vs Sep 7" for a single day, "vs previous 7 days" for longer ranges.
    const previousLabel = useMemo(() => {
        if (!previous) return '';
        const len = rangeLength(range) || 1;
        return len === 1 ? fmtDay(previous.start) : t('dashboard2.previousDays').replace('{n}', String(len));
    }, [previous, range, t]);

    const isEmpty = !loading && !salesError && orders.length === 0;

    const toolbar = (
        <div
            className="d2-toolbar"
            style={{
                position: 'sticky', top: 0, zIndex: 60,
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 0 10px', marginBottom: 6,
                background: 'var(--color-bg)',
            }}
        >
            <div style={{ flex: isMobile ? '1 1 100%' : '0 1 auto', minWidth: 0 }} title={t('dashboard2.dateRange')}>
                <DateRangePicker value={range} onChange={actions.onRangeChange} compact={isMobile} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                <button
                    type="button"
                    onClick={actions.onRefresh}
                    title={t('dashboard2.refresh')}
                    aria-label={t('dashboard2.refresh')}
                    aria-busy={refreshing}
                    className="d2-clickable"
                    style={{ width: 38, height: 38, borderRadius: 10, border: `1px solid ${D2.border}`, background: D2.card, color: D2.muted, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                    <RefreshCw size={16} className={refreshing ? 'd2-spin' : undefined} aria-hidden />
                </button>
                <button
                    type="button"
                    onClick={actions.onNewOrder}
                    className="primary-button d2-clickable"
                    title={t('dashboard2.newOrder')}
                    aria-label={t('dashboard2.newOrder')}
                    style={{ height: 38, padding: '0 16px', borderRadius: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
                >
                    <Plus size={16} aria-hidden /> {t('dashboard2.newOrder')}
                </button>
            </div>
        </div>
    );

    if (loading) {
        // Skeletons that match the final layout — no spinners, no layout shift (§8).
        return (
            <div className="d2" aria-busy="true">
                {toolbar}
                <div className="d2-hero" style={{ marginBottom: 14 }}>
                    {[0, 1, 2, 3].map(i => <Skeleton key={i} height={104} style={{ borderRadius: 12 }} />)}
                </div>
                <Skeleton height={48} style={{ borderRadius: 12, marginBottom: 14 }} />
                <div className="d2-alerts" style={{ marginBottom: 14 }}>
                    <Skeleton height={120} style={{ borderRadius: 12 }} />
                    <Skeleton height={120} style={{ borderRadius: 12 }} />
                </div>
                <Skeleton height={230} style={{ borderRadius: 12, marginBottom: 14 }} />
                <Skeleton height={320} style={{ borderRadius: 12 }} />
            </div>
        );
    }

    return (
        <div className="d2">
            {toolbar}

            {salesError && (
                <div style={{ marginBottom: 14 }}>
                    <ErrorInline message={`${t('dashboard2.loadError')} ${salesError.message}`} onRetry={salesError.retry} retryLabel={t('dashboard2.retry')} />
                </div>
            )}

            {isEmpty && (
                <div style={{ marginBottom: 14 }}>
                    <EmptyState
                        icon={<ShoppingBag size={40} />}
                        title={t('dashboard2.emptyTitle')}
                        hint={t('dashboard2.emptyHint')}
                        actionLabel={t('dashboard2.createFirstOrder')}
                        onAction={actions.onNewOrder}
                    />
                </div>
            )}

            {!salesError && !isEmpty && (
                <>
                    <div style={{ marginBottom: 14 }}>
                        <HeroKpis kpis={derived.kpis} previousKpis={derived.previousKpis} previousLabel={previousLabel} range={range} onOpenOrders={actions.onOpenOrders} t={t} />
                    </div>
                    <div style={{ marginBottom: 14 }}>
                        <Pipeline counts={derived.pipeline} other={derived.otherStatuses} range={range} onOpenOrders={actions.onOpenOrders} t={t} />
                    </div>
                </>
            )}

            {/* Attention: hides itself entirely when nothing is wrong. Critical
                stock is not order-scoped, so it still shows on an empty day. */}
            <AttentionSection
                lowStock={derived.lowStock}
                pending={salesError ? [] : derived.pending}
                missingTracking={salesError ? [] : derived.missingTracking}
                missingTrackingCouriers={derived.missingTrackingCouriers}
                range={range}
                onOpenOrders={actions.onOpenOrders}
                onOpenInventory={actions.onOpenInventory}
                t={t}
            />

            {!salesError && !isEmpty && (
                <>
                    <div style={{ marginBottom: 14 }}>
                        <CollectionChart series={derived.series} range={range} onOpenOrders={actions.onOpenOrders} t={t} />
                    </div>
                    <div style={{ marginBottom: 14 }}>
                        <PerformancePanel
                            orders={orders}
                            products={products}
                            range={range}
                            onOpenOrders={actions.onOpenOrders}
                            onOpenInventory={actions.onOpenInventory}
                            t={t}
                            isMobile={isMobile}
                            groupOrders={groupOrders}
                            productRows={productRows}
                        />
                    </div>
                </>
            )}

            <InventoryDetail
                products={products}
                lowStockCount={derived.lowStock.length}
                stockIn={stockIn}
                stockOut={stockOut}
                error={inventoryError}
                onOpenInventory={actions.onOpenInventory}
                t={t}
            />
        </div>
    );
};

export default Dashboard2View;
