// Prediction by Page — pure view. Toolbar (month nav, breadcrumb, day-of-
// month) → banners → KPI cards → either the per-page OVERVIEW table with the
// shared Staff/Net footer, or one page's daily LEDGER with editable Boost and
// Shipping cells. No store / router access: the container passes data and
// callbacks, and src/dev/pageIncomePrediction-preview.tsx renders it with
// fixtures.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BarChart3, Calendar, ChevronLeft, ChevronRight, RefreshCw, TrendingUp, TrendingDown, DollarSign, Megaphone, AlertTriangle, AlertCircle, Lock, ShoppingBag } from 'lucide-react';
import './pageIncomePrediction.css';
import { buildOverview, buildLedger, addMonths, isMonthKey, monthBounds, monthStateOf, roundCents, type InputField } from './metrics';
import type { PageIncomeViewProps } from './types';
import { fmtMoney, fmtPct, fmtRatio, monthLabel, fill } from './format';
import OverviewTable, { projectionText } from './components/OverviewTable';
import LedgerTable, { cellKeyOf } from './components/LedgerTable';
import SkeletonRows from './components/SkeletonRows';
import Sparkline from './components/Sparkline';

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

const Banner: React.FC<{ tone: 'amber' | 'red' | 'grey'; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }> = ({ tone, icon, children, action }) => {
    const colors = tone === 'red'
        ? { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.3)', fg: '#B91C1C' }
        : tone === 'amber'
            ? { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.35)', fg: '#B45309' }
            : { bg: 'rgba(107,114,128,0.08)', border: 'var(--color-border)', fg: 'var(--color-text-secondary)' };
    return (
        <div role={tone === 'red' ? 'alert' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: colors.bg, border: `1px solid ${colors.border}`, color: colors.fg, fontSize: 13, flexShrink: 0 }}>
            <span style={{ display: 'flex', flexShrink: 0 }}>{icon}</span>
            <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
            {action}
        </div>
    );
};

const SIGN = (n: number): string => (n > 0.005 ? '139,92,246' : n < -0.005 ? '239,68,68' : '107,114,128');

// ─── View ─────────────────────────────────────────────────────────────────

const PageIncomePredictionView: React.FC<PageIncomeViewProps> = ({ state, data, loading, refreshing, error, missingTable, canEdit, isMobile, t, language, actions }) => {
    const { month, page } = state;

    const metricsInput = useMemo(() => ({
        sales: data.sales, inputs: data.inputs, sibling: data.sibling, staffInputs: data.staffInputs, products: data.products,
        shippingRates: data.shippingRates, configPages: data.configPages, month, now: data.now,
    }), [data.sales, data.inputs, data.sibling, data.staffInputs, data.products, data.shippingRates, data.configPages, month, data.now]);

    const overview = useMemo(() => buildOverview(metricsInput), [metricsInput]);
    const ledger = useMemo(() => (page === null ? null : buildLedger({ ...metricsInput, page })), [metricsInput, page]);

    // Per-cell saving spinner / 2 s "saved" flash, keyed `${date}|${page}|${field}`.
    const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
    const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
    const timersRef = useRef<number[]>([]);
    useEffect(() => () => { timersRef.current.forEach(id => window.clearTimeout(id)); }, []);
    // Latest request id issued per cell key — lets an overlapping second edit
    // to the same cell (re-focus and blur again before the first save has
    // resolved) win: only the call that is still the latest for its key may
    // touch savingKeys/savedKeys when it settles, so an earlier, now-stale
    // commit can't clear the spinner for — or flash "saved" over — a save
    // that's still actually in flight.
    const requestIdRef = useRef<Map<string, number>>(new Map());

    const commit = async (date: string, field: InputField, value: number | null): Promise<void> => {
        if (page === null) return;
        const key = cellKeyOf(date, page, field);
        const myId = (requestIdRef.current.get(key) ?? 0) + 1;
        requestIdRef.current.set(key, myId);
        const isLatest = () => requestIdRef.current.get(key) === myId;

        setSavingKeys(prev => new Set(prev).add(key));
        try {
            await actions.onCommitInput(date, page, field, value);
            if (!isLatest()) return;
            setSavedKeys(prev => new Set(prev).add(key));
            const id = window.setTimeout(() => { if (isLatest()) setSavedKeys(prev => { const n = new Set(prev); n.delete(key); return n; }); }, 2000);
            timersRef.current.push(id);
        } finally {
            if (isLatest()) setSavingKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
        }
    };

    // Overview-level Boost editing: there's no single row a "month total" can
    // come from once per-day entries exist, so typing a new total here nets
    // it against whatever's already on days other than the 1st and stores the
    // remainder there — day 1 acts as the catch-all lump entry. A page with no
    // per-day entries at all (the common case: boost is only ever typed here)
    // then behaves exactly like a plain total: day 1 IS the whole figure. If
    // per-day entries elsewhere already exceed the typed total, day 1 floors
    // at 0 (never negative) — the displayed total ends up a little higher than
    // typed rather than silently deleting money entered in the daily ledger.
    const [boostSavingKeys, setBoostSavingKeys] = useState<Set<string>>(new Set());
    const [boostSavedKeys, setBoostSavedKeys] = useState<Set<string>>(new Set());
    const boostRequestIdRef = useRef<Map<string, number>>(new Map());

    const editOverviewBoost = async (targetPage: string, total: number | null): Promise<void> => {
        // This always writes to day 1 of `month` — LedgerTable's own per-day
        // cells already refuse to edit any day that hasn't happened yet
        // (`disabled = !canEdit || day.isFuture`), day 1 of a future month
        // included; the Overview cell (disabled via the isFutureMonth check
        // passed into <OverviewTable> below) shouldn't be a second way to
        // write to that same row bypassing that rule. Defensive no-op here
        // too, in case this is ever called from anywhere else.
        if (monthStateOf(month, data.now) === 'future') return;
        const myId = (boostRequestIdRef.current.get(targetPage) ?? 0) + 1;
        boostRequestIdRef.current.set(targetPage, myId);
        const isLatest = () => boostRequestIdRef.current.get(targetPage) === myId;

        const day1 = monthBounds(month).firstDay;
        const others = data.inputs
            .filter(r => r.page === targetPage && r.date !== day1)
            .reduce((sum, r) => sum + r.boostPage, 0);
        // Snapped to cents: total − (a float sum) would otherwise store noise
        // like 1333.7499999999999 in the day-1 row.
        const day1Value = roundCents(Math.max(0, (total ?? 0) - others));

        setBoostSavingKeys(prev => new Set(prev).add(targetPage));
        try {
            await actions.onCommitInput(day1, targetPage, 'boostPage', day1Value);
            if (!isLatest()) return;
            setBoostSavedKeys(prev => new Set(prev).add(targetPage));
            const id = window.setTimeout(() => { if (isLatest()) setBoostSavedKeys(prev => { const n = new Set(prev); n.delete(targetPage); return n; }); }, 2000);
            timersRef.current.push(id);
        } finally {
            if (isLatest()) setBoostSavingKeys(prev => { const n = new Set(prev); n.delete(targetPage); return n; });
        }
    };

    const pageTitle = page === null ? t('pagePrediction.title') : (page === '' ? t('pagePrediction.unassigned') : page);
    const dayChip = overview.today !== null
        ? fill(t('pagePrediction.dayOf'), { d: overview.today, n: overview.daysInMonth })
        : null;

    const isEmpty = !loading && !error && overview.totals.orders === 0 && overview.totals.pending === 0 && overview.totals.cancelled === 0;

    // ── KPI cards ────────────────────────────────────────────────────────
    const kpis = (() => {
        const src = ledger ? ledger.totals : overview.totals;
        const projection = ledger ? ledger.projection : overview.totals.projection;
        const proj = projectionText(projection, t);
        const contributionRgb = SIGN(src.contribution);
        const margin = src.revenue > 0 ? src.contribution / src.revenue : null;
        const roas = src.boost > 0 ? src.revenue / src.boost : null;
        return (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 8, flexShrink: 0 }}>
                <KpiCard label={t('pagePrediction.kpi.revenue')} value={fmtMoney(src.revenue)} hint={`${src.orders} ${t('pagePrediction.orders')}`} rgb="16,185,129" icon={<TrendingUp size={12} color="#10B981" />} />
                {ledger ? (
                    <KpiCard label={t('pagePrediction.kpi.expenses')} value={fmtMoney(src.cogs + src.shipping + src.boost)} hint={`${t('pagePrediction.columns.cogs')} ${fmtMoney(src.cogs)} · ${t('pagePrediction.columns.shipping')} ${fmtMoney(src.shipping)}`} rgb="239,68,68" icon={<TrendingDown size={12} color="#EF4444" />} />
                ) : (
                    <KpiCard label={t('pagePrediction.kpi.boost')} value={fmtMoney(src.boost)} hint={`${t('pagePrediction.columns.roas')} ${fmtRatio(roas)}`} rgb="245,158,11" icon={<Megaphone size={12} color="#F59E0B" />} />
                )}
                <KpiCard label={t('pagePrediction.kpi.contribution')} value={fmtMoney(src.contribution)} hint={`${t('pagePrediction.columns.margin')} ${fmtPct(margin)}${ledger ? ` · ${t('pagePrediction.columns.boost')} ${fmtMoney(src.boost)}` : ''}`} rgb={contributionRgb} icon={<DollarSign size={12} color={`rgb(${contributionRgb})`} />} />
                <KpiCard label={overview.monthState === 'past' ? t('pagePrediction.actual') : t('pagePrediction.kpi.projected')} value={proj.text} hint={proj.title} title={proj.title} rgb={proj.muted ? '107,114,128' : SIGN(projection.contribution || 0)} icon={<BarChart3 size={12} color={proj.muted ? '#6B7280' : `rgb(${SIGN(projection.contribution || 0)})`} />} />
            </div>
        );
    })();

    // ── Overview footer: shared staff, net, boost reconciliation ─────────
    const sharedFooter = (() => {
        const s = overview.shared;
        const line = (label: string, value: string, color: string) => (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
                <strong style={{ color, whiteSpace: 'nowrap' }}>{value}</strong>
            </div>
        );
        return (
            <div className="glass-panel" style={{ padding: '12px 16px', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                {s.available ? (
                    <>
                        {line(t('pagePrediction.staffShared'), s.staff > 0 ? `-${fmtMoney(s.staff)}` : fmtMoney(0), '#3B82F6')}
                        {line(t('pagePrediction.net'), fmtMoney(s.net), s.net >= 0 ? '#6D28D9' : '#DC2626')}
                        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                            {fill(t('pagePrediction.boostReconcile'), { a: fmtMoney(s.siblingBoost), b: fmtMoney(s.allocatedBoost), c: fmtMoney(s.siblingBoost - s.allocatedBoost) })}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                            {fill(t('pagePrediction.shippingReconcile'), { a: fmtMoney(s.siblingShipping), b: fmtMoney(s.allocatedShipping), c: fmtMoney(s.siblingShipping - s.allocatedShipping) })}
                        </div>
                    </>
                ) : (
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{t('pagePrediction.siblingUnavailable')}</div>
                )}
            </div>
        );
    })();

    // ── Detail trend strip ───────────────────────────────────────────────
    const trend = ledger && (() => {
        const past = ledger.days.filter(d => !d.isFuture);
        const avg = past.length > 0 ? ledger.totals.contribution / past.length : 0;
        return (
            <div className="glass-panel" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexShrink: 0, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#8B5CF6', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-main)' }}>{t('pagePrediction.trend')}</span>
                </div>
                <div style={{ flex: 1, maxWidth: 500, minWidth: 120 }}><Sparkline values={ledger.days.map(d => d.contribution)} width={120} height={32} /></div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                    {t('pagePrediction.avgPerDay')}: <strong style={{ color: avg >= 0 ? '#8B5CF6' : '#EF4444' }}>{fmtMoney(avg)}</strong>
                </div>
            </div>
        );
    })();

    return (
        <div className="pip" style={{ padding: isMobile ? 12 : '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, height: isMobile ? undefined : 'calc(var(--vh-full) - 60px)', overflow: isMobile ? undefined : 'hidden' }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    {page !== null ? (
                        <button type="button" className="pip-icon-button" onClick={actions.onBack} title={t('pagePrediction.back')} aria-label={t('pagePrediction.back')}>
                            <ArrowLeft size={18} />
                        </button>
                    ) : (
                        <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(139, 92, 246, 0.35)', flexShrink: 0 }}>
                            <Megaphone size={22} color="white" />
                        </div>
                    )}
                    <div style={{ minWidth: 0 }}>
                        <h2 className="khmer" style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontStyle: page === '' ? 'italic' : undefined }}>
                            {page !== null && <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('pagePrediction.title')} › </span>}
                            {pageTitle}
                        </h2>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: 13, margin: '2px 0 0 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span>{monthLabel(month, language)}</span>
                            {dayChip && <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 999, background: 'rgba(139,92,246,0.12)', color: '#6D28D9' }}>{dayChip}</span>}
                            {page === null && <span>· {t('pagePrediction.subtitle')}</span>}
                        </p>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button type="button" className="pip-icon-button" onClick={() => actions.onMonthChange(addMonths(month, -1))} title={t('pagePrediction.prevMonth')} aria-label={t('pagePrediction.prevMonth')}>
                        <ChevronLeft size={18} />
                    </button>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <Calendar size={16} style={{ position: 'absolute', left: 10, color: 'var(--color-text-secondary)', pointerEvents: 'none' }} />
                        <input
                            type="month"
                            value={month}
                            onChange={e => { if (isMonthKey(e.target.value)) actions.onMonthChange(e.target.value); }}
                            aria-label={t('pagePrediction.month')}
                            style={{ padding: '8px 12px 8px 32px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: 13, fontWeight: 600, outline: 'none', cursor: 'pointer', height: 38, boxSizing: 'border-box' }}
                        />
                    </div>
                    <button type="button" className="pip-icon-button" onClick={() => actions.onMonthChange(addMonths(month, 1))} title={t('pagePrediction.nextMonth')} aria-label={t('pagePrediction.nextMonth')}>
                        <ChevronRight size={18} />
                    </button>
                    <button type="button" className="pip-icon-button" onClick={actions.onRefresh} disabled={loading || refreshing} title={t('pagePrediction.refresh')} aria-label={t('pagePrediction.refresh')}>
                        <RefreshCw size={16} className={refreshing ? 'pip-spin' : undefined} />
                    </button>
                </div>
            </div>

            {/* Banners */}
            {missingTable && (
                <Banner tone="amber" icon={<AlertTriangle size={16} />}>{t('pagePrediction.missingTable')}</Banner>
            )}
            {!missingTable && !canEdit && page !== null && (
                <Banner tone="grey" icon={<Lock size={14} />}>{t('pagePrediction.readOnly')}</Banner>
            )}
            {page === null && !loading && overview.unassignedShare > 0.05 && (
                <Banner tone="amber" icon={<AlertTriangle size={16} />}>{fill(t('pagePrediction.unassignedWarning'), { p: (overview.unassignedShare * 100).toFixed(0) })}</Banner>
            )}

            {loading ? (
                <div className="glass-panel" aria-busy="true" style={{ overflow: 'hidden', border: '1px solid var(--color-border)', borderRadius: 16, padding: 0, flex: 1, minHeight: 0 }}>
                    <table className="spreadsheet-table" style={{ width: '100%', tableLayout: 'fixed' }}>
                        <tbody><SkeletonRows rows={isMobile ? 6 : 14} cols={isMobile ? 4 : 8} /></tbody>
                    </table>
                </div>
            ) : error ? (
                <Banner tone="red" icon={<AlertCircle size={16} />} action={
                    <button type="button" className="pip-text-button" onClick={error.retry} style={{ height: 32 }}><RefreshCw size={13} /> {t('pagePrediction.retry')}</button>
                }>
                    {fill(t('pagePrediction.loadError'), { message: error.message })}
                </Banner>
            ) : ledger ? (
                <>
                    {kpis}
                    {trend}
                    <LedgerTable
                        ledger={ledger}
                        month={month}
                        canEdit={canEdit && !missingTable}
                        t={t}
                        language={language}
                        isMobile={isMobile}
                        savingKeys={savingKeys}
                        savedKeys={savedKeys}
                        onCommit={commit}
                    />
                </>
            ) : isEmpty ? (
                <>
                    {kpis}
                    <div className="glass-panel" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)', borderRadius: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, opacity: 0.5 }}><ShoppingBag size={40} /></div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-main)', marginBottom: 6 }}>{t('pagePrediction.emptyMonth')}</div>
                        <div style={{ fontSize: 13 }}>{t('pagePrediction.emptyHint')}</div>
                    </div>
                    {overview.shared.available && overview.shared.staff > 0 && sharedFooter}
                </>
            ) : (
                <>
                    {kpis}
                    <OverviewTable
                        result={overview}
                        t={t}
                        isMobile={isMobile}
                        onOpenPage={actions.onOpenPage}
                        canEdit={canEdit && !missingTable && monthStateOf(month, data.now) !== 'future'}
                        boostSavingKeys={boostSavingKeys}
                        boostSavedKeys={boostSavedKeys}
                        onEditBoost={editOverviewBoost}
                    />
                    {sharedFooter}
                </>
            )}
        </div>
    );
};

export default PageIncomePredictionView;
