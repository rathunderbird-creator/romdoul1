// Prediction by Product — pure view. Toolbar (date range, breadcrumb, day-of-
// range chip) → banner → KPI cards → either the per-product OVERVIEW table (with
// search + sortable columns) or one product's read-only daily LEDGER. No
// store / router access: the container passes data and callbacks, and
// src/dev/productIncomePrediction-preview.tsx renders it with fixtures.
//
// Reuses ../pageIncomePrediction's genuinely generic pieces (CSS, format
// helpers, column-resize hook, Sparkline, skeleton rows, the date-range
// control) rather than forking them — see the imports below.
import React, { useMemo } from 'react';
import { ArrowLeft, BarChart3, RefreshCw, TrendingUp, TrendingDown, DollarSign, PackageSearch, AlertCircle, ShoppingBag } from 'lucide-react';
import '../pageIncomePrediction/pageIncomePrediction.css';
import { buildOverview, buildLedger } from './metrics';
import type { ProductIncomeViewProps } from './types';
import { fmtMoney, fmtPct, rangeLabel, fill } from '../pageIncomePrediction/format';
import { MAX_RANGE_DAYS } from '../../utils/dateRange';
import OverviewTable, { projectionText } from './components/OverviewTable';
import LedgerTable from './components/LedgerTable';
import DateRangeControl from '../pageIncomePrediction/components/DateRangeControl';
import SkeletonRows from '../pageIncomePrediction/components/SkeletonRows';
import Sparkline from '../pageIncomePrediction/components/Sparkline';

// ─── Small pieces ─────────────────────────────────────────────────────────

const KpiCard: React.FC<{ label: string; value: string; hint: React.ReactNode; rgb: string; icon: React.ReactNode; title?: string }> = ({ label, value, hint, rgb, icon, title }) => (
    <div className="glass-panel" title={title} style={{ padding: 12, borderRadius: 12, background: `linear-gradient(135deg, rgba(${rgb},0.08), rgba(${rgb},0.02))`, border: `1px solid rgba(${rgb},0.15)`, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
            <div style={{ padding: 4, borderRadius: 6, background: `rgba(${rgb},0.12)`, display: 'flex', flexShrink: 0 }}>{icon}</div>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: `rgb(${rgb})`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
        <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hint}</div>
    </div>
);

const Banner: React.FC<{ tone: 'red'; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }> = ({ icon, children, action }) => (
    <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#B91C1C', fontSize: 13, flexShrink: 0 }}>
        <span style={{ display: 'flex', flexShrink: 0 }}>{icon}</span>
        <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
        {action}
    </div>
);

const SIGN = (n: number): string => (n > 0.005 ? '139,92,246' : n < -0.005 ? '239,68,68' : '107,114,128');

// ─── View ─────────────────────────────────────────────────────────────────

const ProductIncomePredictionView: React.FC<ProductIncomeViewProps> = ({ state, data, loading, refreshing, error, isMobile, t, language, actions }) => {
    const { range, productId } = state;

    // Memoised on the range's two day strings, not the `range` object: the
    // container hands over a fresh object whenever any URL param changes
    // (opening a product), and the overview must not be rebuilt for that.
    const metricsInput = useMemo(() => ({
        sales: data.sales, products: data.products, range: { from: range.from, to: range.to }, now: data.now,
    }), [data.sales, data.products, range.from, range.to, data.now]);

    const overview = useMemo(() => buildOverview(metricsInput), [metricsInput]);
    const ledger = useMemo(() => (productId === null ? null : buildLedger({ ...metricsInput, productId })), [metricsInput, productId]);

    const activeRow = productId === null ? null : overview.rows.find(r => r.id === productId) || null;
    const productTitle = productId === null ? t('productPrediction.title') : (productId === '' ? t('productPrediction.unknownProduct') : (activeRow?.name || productId));
    // "Day X of N": shown while today falls inside the range (X = today's
    // position in it, N = its length — for a whole current month, the day of
    // the month and the days in it).
    const dayChip = overview.today !== null
        ? fill(t('productPrediction.dayOf'), { d: overview.today, n: overview.daysInRange })
        : null;

    const isEmpty = !loading && !error && overview.totals.units === 0 && overview.totals.pendingUnits === 0 && overview.totals.cancelledUnits === 0;

    // ── KPI cards ────────────────────────────────────────────────────────
    const kpis = (() => {
        const src = ledger ? ledger.totals : overview.totals;
        const projection = ledger ? ledger.projection : overview.totals.projection;
        const proj = projectionText(projection, t);
        const grossProfitRgb = SIGN(src.grossProfit);
        const margin = src.revenue > 0 ? src.grossProfit / src.revenue : null;
        return (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 8, flexShrink: 0 }}>
                <KpiCard label={t('productPrediction.kpi.revenue')} value={fmtMoney(src.revenue)} hint={`${src.units} ${t('productPrediction.units')}`} rgb="16,185,129" icon={<TrendingUp size={12} color="#10B981" />} />
                <KpiCard label={t('productPrediction.kpi.cogs')} value={fmtMoney(src.cogs)} hint={`${t('productPrediction.columns.orders')} ${src.orders}`} rgb="239,68,68" icon={<TrendingDown size={12} color="#EF4444" />} />
                <KpiCard label={t('productPrediction.kpi.grossProfit')} value={fmtMoney(src.grossProfit)} hint={`${t('productPrediction.columns.margin')} ${fmtPct(margin)}`} rgb={grossProfitRgb} icon={<DollarSign size={12} color={`rgb(${grossProfitRgb})`} />} />
                <KpiCard label={overview.rangeState === 'past' ? t('productPrediction.actual') : t('productPrediction.kpi.projected')} value={proj.text} hint={proj.title} title={proj.title} rgb={proj.muted ? '107,114,128' : SIGN(projection.grossProfit || 0)} icon={<BarChart3 size={12} color={proj.muted ? '#6B7280' : `rgb(${SIGN(projection.grossProfit || 0)})`} />} />
            </div>
        );
    })();

    // ── Detail trend strip ───────────────────────────────────────────────
    const trend = ledger && (() => {
        const past = ledger.days.filter(d => !d.isFuture);
        const avg = past.length > 0 ? ledger.totals.grossProfit / past.length : 0;
        return (
            <div className="glass-panel" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexShrink: 0, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#8B5CF6', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-main)' }}>{t('productPrediction.trend')}</span>
                </div>
                <div style={{ flex: 1, maxWidth: 500, minWidth: 120 }}><Sparkline values={ledger.days.map(d => d.grossProfit)} width={120} height={32} /></div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                    {t('productPrediction.avgPerDay')}: <strong style={{ color: avg >= 0 ? '#8B5CF6' : '#EF4444' }}>{fmtMoney(avg)}</strong>
                </div>
            </div>
        );
    })();

    return (
        <div className="pip" style={{ padding: isMobile ? 12 : '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, height: isMobile ? undefined : 'calc(var(--vh-full) - 60px)', overflow: isMobile ? undefined : 'hidden' }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    {productId !== null ? (
                        <button type="button" className="pip-icon-button" onClick={actions.onBack} title={t('productPrediction.back')} aria-label={t('productPrediction.back')}>
                            <ArrowLeft size={18} />
                        </button>
                    ) : (
                        <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(139, 92, 246, 0.35)', flexShrink: 0 }}>
                            <PackageSearch size={22} color="white" />
                        </div>
                    )}
                    <div style={{ minWidth: 0 }}>
                        <h2 className="khmer" style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontStyle: productId === '' ? 'italic' : undefined }}>
                            {productId !== null && <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('productPrediction.title')} › </span>}
                            {productTitle}
                        </h2>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: 13, margin: '2px 0 0 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span>{rangeLabel(range, language)}</span>
                            {dayChip && <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 999, background: 'rgba(139,92,246,0.12)', color: '#6D28D9' }}>{dayChip}</span>}
                            {productId === null && <span>· {t('productPrediction.subtitle')}</span>}
                        </p>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <DateRangeControl
                        range={range}
                        now={data.now}
                        onChange={actions.onRangeChange}
                        labels={{ prev: t('productPrediction.prevMonth'), next: t('productPrediction.nextMonth'), tooLong: fill(t('incomeRange.tooLong'), { n: MAX_RANGE_DAYS }) }}
                        compact={isMobile}
                    />
                    <button type="button" className="pip-icon-button" onClick={actions.onRefresh} disabled={loading || refreshing} title={t('productPrediction.refresh')} aria-label={t('productPrediction.refresh')}>
                        <RefreshCw size={16} className={refreshing ? 'pip-spin' : undefined} />
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="glass-panel" aria-busy="true" style={{ overflow: 'hidden', border: '1px solid var(--color-border)', borderRadius: 16, padding: 0, flex: 1, minHeight: 0 }}>
                    <table className="spreadsheet-table" style={{ width: '100%', tableLayout: 'fixed' }}>
                        <tbody><SkeletonRows rows={isMobile ? 6 : 14} cols={isMobile ? 4 : 7} /></tbody>
                    </table>
                </div>
            ) : error ? (
                <Banner tone="red" icon={<AlertCircle size={16} />} action={
                    <button type="button" className="pip-text-button" onClick={error.retry} style={{ height: 32 }}><RefreshCw size={13} /> {t('productPrediction.retry')}</button>
                }>
                    {fill(t('productPrediction.loadError'), { message: error.message })}
                </Banner>
            ) : ledger ? (
                <>
                    {kpis}
                    {trend}
                    <LedgerTable ledger={ledger} range={range} t={t} language={language} isMobile={isMobile} />
                </>
            ) : isEmpty ? (
                <>
                    {kpis}
                    <div className="glass-panel" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)', borderRadius: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, opacity: 0.5 }}><ShoppingBag size={40} /></div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-main)', marginBottom: 6 }}>{t('productPrediction.emptyMonth')}</div>
                        <div style={{ fontSize: 13 }}>{t('productPrediction.emptyHint')}</div>
                    </div>
                </>
            ) : (
                <>
                    {kpis}
                    <OverviewTable result={overview} now={data.now} t={t} isMobile={isMobile} onOpenProduct={actions.onOpenProduct} />
                </>
            )}
        </div>
    );
};

export default ProductIncomePredictionView;
