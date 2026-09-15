// Collected vs. outstanding — one stacked bar per day so the COD collection
// gap (amber on top of green) is visible at a glance (spec §4.5). Every bar
// is a link: clicking a day opens the order list filtered to that day (§6.1).
import React, { useCallback, useMemo, useRef } from 'react';
import { BarChart3 } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import type { TooltipContentProps, BarRectangleItem, MouseHandlerDataParam } from 'recharts';
import type { CollectionChartProps } from '../types';
import type { DayPoint } from '../metrics';
import { D2, tabular, fmtMoney, fmtDay, fmtInt, PASSIVE_OPACITY } from '../theme';
import { Card, SectionHeader, useLocalStorageState } from '../ui';

const CHART_HEIGHT = 190;
// Beyond this the fallback row's own horizontal scroll kicks in (same
// treatment as .d2-tabs) instead of wrapping to many lines.
const DAY_BUTTONS_SCROLL_THRESHOLD = 7;
const BODY_ID = 'd2-collection-chart-body';

// Compact currency for axis ticks: "$450", "$1.2k", "$15k". Never "NaN".
const compactMoney = (v: number): string => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 1000) {
        const k = abs / 1000;
        const s = abs >= 10000 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, '');
        return `${sign}$${s}k`;
    }
    return `${sign}$${Math.round(abs)}`;
};

// Recharts hands back the raw datum on `payload`; only trust a YYYY-MM-DD key.
const dayOfPayload = (payload: unknown): string | null => {
    const day = (payload as { day?: unknown } | null | undefined)?.day;
    return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
};

const CollectionChart: React.FC<CollectionChartProps> = ({ series, onOpenOrders, t }) => {
    const [collapsed, setCollapsed] = useLocalStorageState<boolean>('d2_chart_collapsed', false);

    // Zero-filled series (every day $0) shows a message, never a grid of zeros.
    const isEmpty = useMemo(
        () => series.length === 0 || series.every(p => (Number(p.collected) || 0) + (Number(p.outstanding) || 0) === 0),
        [series],
    );

    // Navigate to a single day's orders. Both the bar rectangles and the chart
    // background handle clicks (a $5 bar is only a couple of pixels tall, so the
    // whole day column is the target); the guard collapses the double dispatch
    // when a click lands on a bar and then bubbles to the chart.
    const lastNav = useRef<{ day: string; at: number } | null>(null);
    const go = useCallback((day: string) => {
        const now = Date.now();
        if (lastNav.current && lastNav.current.day === day && now - lastNav.current.at < 150) return;
        lastNav.current = { day, at: now };
        onOpenOrders({ dateRange: { start: day, end: day } });
    }, [onOpenOrders]);

    const onBarClick = useCallback((item: BarRectangleItem) => {
        const day = dayOfPayload(item?.payload);
        if (day) go(day);
    }, [go]);

    const onChartClick = useCallback((state: MouseHandlerDataParam) => {
        const label = state?.activeLabel;
        const day = typeof label === 'string' ? dayOfPayload({ day: label }) : null;
        if (day) go(day);
    }, [go]);

    const collectedLabel = t('dashboard2.collected');
    const outstandingLabel = t('dashboard2.outstanding');
    const openLabel = t('dashboard2.openOrderList');

    // "3 orders" / "1 order" — the plural key is title-case in the catalogue.
    const ordersText = (n: number) => `${fmtInt(n)} ${(n === 1 ? t('dashboard2.order') : t('dashboard2.orders')).toLowerCase()}`;

    // Tooltip: day with year, order count, then the two currency rows.
    const renderTooltip = ({ active, payload }: TooltipContentProps) => {
        if (!active || !payload || payload.length === 0) return null;
        const point = payload[0]?.payload as DayPoint | undefined;
        if (!point) return null;
        const row = (color: string, label: string, value: number) => (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: D2.muted }}>
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    {label}
                </span>
                <span style={{ ...tabular, fontWeight: 700, color: D2.ink }}>{fmtMoney(value)}</span>
            </div>
        );
        return (
            <div style={{ background: D2.card, border: `1px solid ${D2.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 12, color: D2.ink, boxShadow: '0 4px 12px rgba(17, 24, 39, 0.08)', minWidth: 160 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700 }}>{fmtDay(point.day, true)}</span>
                    <span style={{ ...tabular, color: D2.muted }}>{ordersText(point.orders)}</span>
                </div>
                <div style={{ display: 'grid', gap: 3 }}>
                    {row(D2.greenLine, collectedLabel, point.collected)}
                    {row(D2.amberLine, outstandingLabel, point.outstanding)}
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: D2.muted }}>{openLabel}</div>
            </div>
        );
    };

    // Legend text in ink (recharts defaults to the series colour, which is hard to read for amber).
    const legendLabel = (value: string) => <span style={{ color: D2.ink, fontWeight: 600 }}>{value}</span>;

    const header = (
        <SectionHeader
            title={t('dashboard2.collectedVsOutstanding')}
            icon={BarChart3}
            collapsed={collapsed}
            onToggle={() => setCollapsed(c => !c)}
            id={BODY_ID}
        />
    );

    if (collapsed) {
        return <Card style={{ paddingBottom: 4 }}>{header}</Card>;
    }

    // Long ranges thin the ticks so labels never collide; short ones show every day.
    const tickInterval = series.length > DAY_BUTTONS_SCROLL_THRESHOLD ? 'preserveStartEnd' : 0;
    // Always rendered — recharts' keyboard support (arrow keys move the
    // tooltip) never fires the bars' onClick, so this row is the only way a
    // keyboard user can open a specific day for ranges longer than a week,
    // which is most of them (Last 30 days, This month, ...).
    const showDayButtons = !isEmpty && series.length > 0;

    return (
        <Card>
            {header}
            <div id={BODY_ID}>
                <div role="group" style={{ minHeight: CHART_HEIGHT, width: '100%' }} aria-label={t('dashboard2.collectedVsOutstanding')}>
                    {isEmpty ? (
                        <div style={{ minHeight: CHART_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', color: D2.muted, fontSize: 13 }}>
                            {t('dashboard2.noRows')}
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                            <BarChart
                                data={series}
                                margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                                barCategoryGap="28%"
                                onClick={onChartClick}
                                style={{ cursor: 'pointer' }}
                            >
                                <CartesianGrid strokeDasharray="3 3" stroke={D2.border} vertical={false} />
                                <XAxis
                                    dataKey="day"
                                    tickFormatter={(v) => fmtDay(String(v))}
                                    tick={{ fontSize: 11, fill: D2.muted }}
                                    tickLine={false}
                                    axisLine={{ stroke: D2.border }}
                                    interval={tickInterval}
                                    minTickGap={12}
                                    tickMargin={6}
                                />
                                <YAxis
                                    width={56}
                                    tick={{ fontSize: 11, fill: D2.muted }}
                                    tickLine={false}
                                    axisLine={false}
                                    tickFormatter={compactMoney}
                                    allowDecimals={false}
                                />
                                <Tooltip
                                    cursor={{ fill: 'rgba(37, 99, 235, 0.06)' }}
                                    content={renderTooltip}
                                    wrapperStyle={{ outline: 'none', zIndex: 5 }}
                                />
                                <Legend
                                    verticalAlign="top"
                                    align="right"
                                    iconType="circle"
                                    iconSize={8}
                                    formatter={legendLabel}
                                    wrapperStyle={{ fontSize: 11, paddingBottom: 6 }}
                                />
                                <Bar
                                    dataKey="collected"
                                    stackId="cod"
                                    name={collectedLabel}
                                    fill={D2.greenLine}
                                    maxBarSize={44}
                                    isAnimationActive={false}
                                    cursor="pointer"
                                    onClick={onBarClick}
                                />
                                <Bar
                                    dataKey="outstanding"
                                    stackId="cod"
                                    name={outstandingLabel}
                                    fill={D2.amberLine}
                                    radius={[4, 4, 0, 0]}
                                    maxBarSize={44}
                                    isAnimationActive={false}
                                    cursor="pointer"
                                    onClick={onBarClick}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* Keyboard-reachable per-day links (the SVG bars are mouse-only:
                    recharts' own keyboard support only moves the tooltip
                    between bars, it never fires their onClick). Each button's
                    label carries both amounts, not just the order count, since
                    for a keyboard/screen-reader user this row is the only
                    place those daily figures are exposed at all. Long ranges
                    (a month, a lifetime) scroll horizontally instead of
                    wrapping into many lines, matching .d2-tabs. */}
                {showDayButtons && (
                    <div
                        className={series.length > DAY_BUTTONS_SCROLL_THRESHOLD ? 'd2-tabs' : undefined}
                        style={{
                            display: 'flex',
                            flexWrap: series.length > DAY_BUTTONS_SCROLL_THRESHOLD ? 'nowrap' : 'wrap',
                            alignItems: 'center', gap: 6, marginTop: 8, paddingLeft: 56,
                        }}
                    >
                        {series.map(p => {
                            const label = `${openLabel} — ${fmtDay(p.day, true)}: ${collectedLabel} ${fmtMoney(p.collected)}, ${outstandingLabel} ${fmtMoney(p.outstanding)} (${ordersText(p.orders)})`;
                            const passive = p.orders === 0;
                            return (
                                <button
                                    key={p.day}
                                    type="button"
                                    className="d2-clickable"
                                    onClick={() => go(p.day)}
                                    aria-label={label}
                                    title={label}
                                    style={{
                                        ...tabular,
                                        fontSize: 11,
                                        fontWeight: 600,
                                        color: D2.muted,
                                        background: 'none',
                                        border: `1px solid ${D2.border}`,
                                        borderRadius: 999,
                                        padding: '2px 9px',
                                        lineHeight: 1.6,
                                        whiteSpace: 'nowrap',
                                        flexShrink: 0,
                                        opacity: passive ? PASSIVE_OPACITY : 1,
                                    }}
                                >
                                    {fmtDay(p.day)}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </Card>
    );
};

export default CollectionChart;
