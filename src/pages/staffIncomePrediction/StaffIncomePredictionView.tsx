// Prediction by Staff — pure view. Toolbar (month nav, breadcrumb, day-of-
// month) → banner → KPI cards → either the per-staff OVERVIEW table (sortable,
// with a Target-attainment column) or one staff member's read-only daily
// LEDGER. No store / router access: the container passes data and callbacks,
// and src/dev/staffIncomePrediction-preview.tsx renders it with fixtures.
//
// Reuses ../pageIncomePrediction's genuinely generic pieces (CSS, format
// helpers, column-resize hook, Sparkline, skeleton rows) rather than forking
// them — see the imports below.
import React, { useMemo } from 'react';
import { ArrowLeft, BarChart3, Calendar, ChevronLeft, ChevronRight, RefreshCw, TrendingUp, TrendingDown, DollarSign, Target, Users, AlertCircle, ShoppingBag } from 'lucide-react';
import '../pageIncomePrediction/pageIncomePrediction.css';
import { buildOverview, buildLedger, addMonths, isMonthKey } from './metrics';
import type { StaffIncomeViewProps } from './types';
import { fmtMoney, fmtPct, monthLabel, fill } from '../pageIncomePrediction/format';
import OverviewTable, { projectionText } from './components/OverviewTable';
import LedgerTable from './components/LedgerTable';
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
const TARGET_RGB = (progress: number | null): string => progress === null ? '107,114,128' : progress >= 1 ? '16,185,129' : progress >= 0.5 ? '59,130,246' : '245,158,11';

// ─── View ─────────────────────────────────────────────────────────────────

const StaffIncomePredictionView: React.FC<StaffIncomeViewProps> = ({ state, data, loading, refreshing, error, isMobile, t, language, actions }) => {
    const { month, staff } = state;

    const metricsInput = useMemo(() => ({
        sales: data.sales, products: data.products, users: data.users, configSalesmen: data.configSalesmen, month, now: data.now,
    }), [data.sales, data.products, data.users, data.configSalesmen, month, data.now]);

    const overview = useMemo(() => buildOverview(metricsInput), [metricsInput]);
    const ledger = useMemo(() => (staff === null ? null : buildLedger({ ...metricsInput, staff })), [metricsInput, staff]);
    const activeRow = staff === null ? null : overview.rows.find(r => r.name === staff) || null;

    const staffTitle = staff === null ? t('staffPrediction.title') : (staff === '' ? t('staffPrediction.unassigned') : staff);
    const dayChip = overview.today !== null
        ? fill(t('staffPrediction.dayOf'), { d: overview.today, n: overview.daysInMonth })
        : null;

    const isEmpty = !loading && !error && overview.totals.orders === 0 && overview.totals.pending === 0 && overview.totals.cancelled === 0;

    // ── KPI cards ────────────────────────────────────────────────────────
    const kpis = (() => {
        const src = ledger ? ledger.totals : overview.totals;
        const projection = ledger ? ledger.projection : overview.totals.projection;
        const proj = projectionText(projection, t);
        const grossProfitRgb = SIGN(src.grossProfit);
        const margin = src.revenue > 0 ? src.grossProfit / src.revenue : null;
        const target = activeRow?.monthlyTarget ?? (staff === null ? overview.totals.monthlyTarget : null);
        const targetProgress = activeRow?.targetProgress ?? (staff === null ? overview.totals.targetProgress : null);
        // Revenue that counts toward `target`: the staff member's own, or on the
        // overview only the staff who have a target (not the whole-team revenue).
        const targetedRevenue = activeRow?.targetedRevenue ?? (staff === null ? overview.totals.targetedRevenue : null);
        const isPast = overview.monthState === 'past';
        return (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 8, flexShrink: 0 }}>
                <KpiCard label={t('staffPrediction.kpi.revenue')} value={fmtMoney(src.revenue)} hint={`${src.orders} ${t('staffPrediction.columns.orders')}`} rgb="16,185,129" icon={<TrendingUp size={12} color="#10B981" />} />
                <KpiCard label={t('staffPrediction.kpi.cogs')} value={fmtMoney(src.cogs)} hint={`${t('staffPrediction.columns.margin')} ${fmtPct(margin)}`} rgb="239,68,68" icon={<TrendingDown size={12} color="#EF4444" />} />
                <KpiCard label={t('staffPrediction.kpi.grossProfit')} value={fmtMoney(src.grossProfit)} hint={proj.muted || isPast ? proj.title : `${t('staffPrediction.kpi.projected')} ${proj.text}`} rgb={grossProfitRgb} icon={<DollarSign size={12} color={`rgb(${grossProfitRgb})`} />} />
                {target !== null ? (
                    <KpiCard
                        label={t('staffPrediction.kpi.target')}
                        value={`${targetProgress !== null ? Math.round(targetProgress * 100) : 0}%`}
                        hint={`${fmtMoney(targetedRevenue ?? 0)} / ${fmtMoney(target)}`}
                        title={staff === null ? t('staffPrediction.targetedOnly') : undefined}
                        rgb={TARGET_RGB(targetProgress)}
                        icon={<Target size={12} color={`rgb(${TARGET_RGB(targetProgress)})`} />}
                    />
                ) : (
                    <KpiCard label={isPast ? t('staffPrediction.actual') : t('staffPrediction.kpi.projected')} value={proj.text} hint={proj.title} title={proj.title} rgb={proj.muted ? '107,114,128' : SIGN(projection.grossProfit || 0)} icon={<BarChart3 size={12} color={proj.muted ? '#6B7280' : `rgb(${SIGN(projection.grossProfit || 0)})`} />} />
                )}
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
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-main)' }}>{t('staffPrediction.trend')}</span>
                </div>
                <div style={{ flex: 1, maxWidth: 500, minWidth: 120 }}><Sparkline values={ledger.days.map(d => d.grossProfit)} width={120} height={32} /></div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                    {t('staffPrediction.avgPerDay')}: <strong style={{ color: avg >= 0 ? '#8B5CF6' : '#EF4444' }}>{fmtMoney(avg)}</strong>
                </div>
            </div>
        );
    })();

    return (
        <div className="pip" style={{ padding: isMobile ? 12 : '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, height: isMobile ? undefined : 'calc(var(--vh-full) - 60px)', overflow: isMobile ? undefined : 'hidden' }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    {staff !== null ? (
                        <button type="button" className="pip-icon-button" onClick={actions.onBack} title={t('staffPrediction.back')} aria-label={t('staffPrediction.back')}>
                            <ArrowLeft size={18} />
                        </button>
                    ) : (
                        <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(139, 92, 246, 0.35)', flexShrink: 0 }}>
                            <Users size={22} color="white" />
                        </div>
                    )}
                    <div style={{ minWidth: 0 }}>
                        <h2 className="khmer" style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontStyle: staff === '' ? 'italic' : undefined }}>
                            {staff !== null && <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('staffPrediction.title')} › </span>}
                            {staffTitle}
                        </h2>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: 13, margin: '2px 0 0 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span>{monthLabel(month, language)}</span>
                            {dayChip && <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 999, background: 'rgba(139,92,246,0.12)', color: '#6D28D9' }}>{dayChip}</span>}
                            {staff === null && <span>· {t('staffPrediction.subtitle')}</span>}
                        </p>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button type="button" className="pip-icon-button" onClick={() => actions.onMonthChange(addMonths(month, -1))} title={t('staffPrediction.prevMonth')} aria-label={t('staffPrediction.prevMonth')}>
                        <ChevronLeft size={18} />
                    </button>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <Calendar size={16} style={{ position: 'absolute', left: 10, color: 'var(--color-text-secondary)', pointerEvents: 'none' }} />
                        <input
                            type="month"
                            value={month}
                            onChange={e => { if (isMonthKey(e.target.value)) actions.onMonthChange(e.target.value); }}
                            aria-label={t('staffPrediction.month')}
                            style={{ padding: '8px 12px 8px 32px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: 13, fontWeight: 600, outline: 'none', cursor: 'pointer', height: 38, boxSizing: 'border-box' }}
                        />
                    </div>
                    <button type="button" className="pip-icon-button" onClick={() => actions.onMonthChange(addMonths(month, 1))} title={t('staffPrediction.nextMonth')} aria-label={t('staffPrediction.nextMonth')}>
                        <ChevronRight size={18} />
                    </button>
                    <button type="button" className="pip-icon-button" onClick={actions.onRefresh} disabled={loading || refreshing} title={t('staffPrediction.refresh')} aria-label={t('staffPrediction.refresh')}>
                        <RefreshCw size={16} className={refreshing ? 'pip-spin' : undefined} />
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="glass-panel" aria-busy="true" style={{ overflow: 'hidden', border: '1px solid var(--color-border)', borderRadius: 16, padding: 0, flex: 1, minHeight: 0 }}>
                    <table className="spreadsheet-table" style={{ width: '100%', tableLayout: 'fixed' }}>
                        <tbody><SkeletonRows rows={isMobile ? 6 : 14} cols={isMobile ? 4 : 6} /></tbody>
                    </table>
                </div>
            ) : error ? (
                <Banner tone="red" icon={<AlertCircle size={16} />} action={
                    <button type="button" className="pip-text-button" onClick={error.retry} style={{ height: 32 }}><RefreshCw size={13} /> {t('staffPrediction.retry')}</button>
                }>
                    {fill(t('staffPrediction.loadError'), { message: error.message })}
                </Banner>
            ) : ledger ? (
                <>
                    {kpis}
                    {trend}
                    <LedgerTable ledger={ledger} month={month} t={t} language={language} isMobile={isMobile} />
                </>
            ) : isEmpty ? (
                <>
                    {kpis}
                    <div className="glass-panel" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)', borderRadius: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, opacity: 0.5 }}><ShoppingBag size={40} /></div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-main)', marginBottom: 6 }}>{t('staffPrediction.emptyMonth')}</div>
                        <div style={{ fontSize: 13 }}>{t('staffPrediction.emptyHint')}</div>
                    </div>
                </>
            ) : (
                <>
                    {kpis}
                    <OverviewTable result={overview} t={t} isMobile={isMobile} onOpenStaff={actions.onOpenStaff} />
                </>
            )}
        </div>
    );
};

export default StaffIncomePredictionView;
