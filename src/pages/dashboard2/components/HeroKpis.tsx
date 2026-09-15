// Dashboard2 hero KPIs (spec §4.1): Outstanding (tier 1) · Revenue booked ·
// Cash collected · Orders. Every card is a button that opens the order list
// pre-filtered to exactly the subset it counts (§6.1), and every card carries
// a comparison against the previous period — no KPI without a delta (§3).
import type { CSSProperties, FC, ReactNode } from 'react';
import type { HeroKpisProps } from '../types';
import { delta } from '../metrics';
import { D2, tabular, fmtMoney, fmtPct, fmtInt } from '../theme';
import { Card, DeltaBadge } from '../ui';

// Statuses that still carry revenue — everything except Cancelled / Returned /
// ReStock (the same active set metrics.summarize() uses).
const ACTIVE_STATUSES = ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Drafted'];

// ─── Styles ───────────────────────────────────────────────────────────────
// The Card renders a <button>, so every inner block is a <span> with an
// explicit display (phrasing content only inside a button).

const cardLayout: CSSProperties = { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 116 };
const labelRow: CSSProperties = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, minHeight: 16 };
const labelText: CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: D2.muted };
const hintText: CSSProperties = { fontSize: 11, color: D2.muted, textAlign: 'right', minWidth: 0 };
const subLine: CSSProperties = { display: 'block', fontSize: 12, color: D2.muted, marginTop: 4, minHeight: 18, lineHeight: '18px', ...tabular };
// Pushed to the bottom so the four delta rows line up whatever sits above them.
const deltaRow: CSSProperties = { display: 'block', marginTop: 'auto', paddingTop: 8, minHeight: 26 };

// Tier 1 = 34px, tier 2 = 22px; tier 3 (zero) shrinks and goes muted (§5).
const valueStyle = (size: number, color: string, passive: boolean): CSSProperties => ({
    display: 'block',
    fontSize: passive ? Math.round(size * 0.8) : size,
    fontWeight: 800,
    lineHeight: 1.15,
    letterSpacing: '-0.01em',
    color: passive ? D2.muted : color,
    marginTop: 6,
    ...tabular,
});

// ─── One KPI card ─────────────────────────────────────────────────────────

interface KpiCardProps {
    label: string;
    hint?: string;                       // small muted note beside the label
    value: string;                       // already formatted
    valueColor: string;
    size: number;                        // 34 (tier 1) or 22 (tier 2)
    accent?: { bg: string; line: string };
    passive: boolean;                    // tier 3: zero value
    sub: string;                         // one-line breakdown under the value
    extra?: ReactNode;                   // e.g. the collection progress bar
    change: number | null;               // ratio vs previous period, null → "—"
    changeSuffix?: string;               // "vs Sep 7 ($678.00)"
    invert?: boolean;                    // up is bad (outstanding)
    ariaLabel: string;                   // what the click opens
    onClick: () => void;
}

const KpiCard: FC<KpiCardProps> = ({ label, hint, value, valueColor, size, accent, passive, sub, extra, change, changeSuffix, invert, ariaLabel, onClick }) => (
    <Card onClick={onClick} ariaLabel={ariaLabel} title={ariaLabel} accent={accent} passive={passive} style={cardLayout}>
        <span style={labelRow}>
            <span style={labelText}>{label}</span>
            {hint && <span style={hintText}>{hint}</span>}
        </span>
        <span style={valueStyle(size, valueColor, passive)}>{value}</span>
        <span style={subLine}>{sub}</span>
        {extra}
        <span style={deltaRow}>
            <DeltaBadge value={change} suffix={changeSuffix} invert={invert} />
        </span>
    </Card>
);

// ─── Hero strip ───────────────────────────────────────────────────────────

const HeroKpis: FC<HeroKpisProps> = ({ kpis, previousKpis, previousLabel, range, onOpenOrders, t }) => {
    const vs = t('dashboard2.vs');
    const openList = t('dashboard2.openOrderList');

    // "vs Sep 7 ($678.00)"; "vs Sep 7" when the previous period has no data;
    // nothing at all for an open-ended range (no previous period to name).
    const suffixFor = (previousText: string | null): string | undefined => {
        if (!previousLabel) return undefined;
        return previousText === null ? `${vs} ${previousLabel}` : `${vs} ${previousLabel} (${previousText})`;
    };
    const prev = previousKpis;

    // 1 · Outstanding (tier 1) — unpaid COD + partly paid deposits.
    const outstandingSub = `${fmtInt(kpis.unpaidCount)} ${t('dashboard2.unpaidCod')} · ${fmtInt(kpis.depositCount)} ${t('dashboard2.depositsPartlyPaid')}`;
    const outstandingValue = fmtMoney(kpis.outstanding);

    // 2 · Revenue booked — active orders' totals; sub-line shows the average order.
    const aov = kpis.activeCount > 0 ? kpis.revenueBooked / kpis.activeCount : null;
    const revenueSub = `${fmtMoney(aov)} ${t('dashboard2.avgOrder')}`;
    const revenueValue = fmtMoney(kpis.revenueBooked);

    // 3 · Cash collected — with the collection-rate bar.
    const rate = kpis.collectionRate;
    const ratePct = rate === null ? 0 : Math.max(0, Math.min(100, rate * 100));
    const cashSub = `${fmtPct(rate)} ${t('dashboard2.collectionRate')}`;
    const cashValue = fmtMoney(kpis.cashCollected);
    const rateBar = (
        <span
            role="progressbar"
            aria-label={t('dashboard2.collectionRate')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(ratePct)}
            style={{ display: 'block', height: 6, borderRadius: 3, background: D2.border, marginTop: 6, overflow: 'hidden' }}
        >
            <span style={{ display: 'block', height: '100%', width: `${ratePct}%`, background: D2.greenLine, borderRadius: 3, transition: 'width 0.3s ease' }} />
        </span>
    );

    // 4 · Orders — every order in range, cancelled included.
    const ordersSub = `${fmtInt(kpis.activeCount)} ${t('dashboard2.active')} · ${fmtInt(kpis.cancelledCount)} ${t('dashboard2.cancelled')} · ${fmtInt(kpis.pieces)} ${t('dashboard2.pieces')}`;
    const ordersValue = fmtInt(kpis.orderCount);

    return (
        <div className="d2-hero">
            <KpiCard
                label={t('dashboard2.outstanding')}
                hint={t('dashboard2.outstandingHint')}
                value={outstandingValue}
                valueColor={D2.amber}
                size={34}
                accent={{ bg: D2.amberBg, line: D2.amberLine }}
                passive={kpis.outstanding <= 0}
                sub={outstandingSub}
                change={delta(kpis.outstanding, prev?.outstanding)}
                changeSuffix={suffixFor(prev ? fmtMoney(prev.outstanding) : null)}
                invert
                ariaLabel={`${t('dashboard2.outstanding')} ${outstandingValue} — ${openList}: ${outstandingSub}`}
                onClick={() => onOpenOrders({ payStatuses: ['Unpaid', 'Deposit'], dateRange: range })}
            />
            <KpiCard
                label={t('dashboard2.revenueBooked')}
                value={revenueValue}
                valueColor={D2.ink}
                size={22}
                passive={kpis.revenueBooked <= 0}
                sub={revenueSub}
                change={delta(kpis.revenueBooked, prev?.revenueBooked)}
                changeSuffix={suffixFor(prev ? fmtMoney(prev.revenueBooked) : null)}
                ariaLabel={`${t('dashboard2.revenueBooked')} ${revenueValue} — ${openList}: ${fmtInt(kpis.activeCount)} ${t('dashboard2.active')}`}
                onClick={() => onOpenOrders({ statuses: ACTIVE_STATUSES, dateRange: range })}
            />
            <KpiCard
                label={t('dashboard2.cashCollected')}
                value={cashValue}
                valueColor={D2.green}
                size={22}
                passive={kpis.cashCollected <= 0}
                sub={cashSub}
                extra={rateBar}
                change={delta(kpis.cashCollected, prev?.cashCollected)}
                changeSuffix={suffixFor(prev ? fmtMoney(prev.cashCollected) : null)}
                ariaLabel={`${t('dashboard2.cashCollected')} ${cashValue} — ${openList}: ${cashSub}`}
                onClick={() => onOpenOrders({ payStatuses: ['Paid', 'Deposit', 'Get File'], dateRange: range })}
            />
            <KpiCard
                label={t('dashboard2.orders')}
                value={ordersValue}
                valueColor={D2.ink}
                size={22}
                passive={kpis.orderCount <= 0}
                sub={ordersSub}
                change={delta(kpis.orderCount, prev?.orderCount)}
                changeSuffix={suffixFor(prev ? fmtInt(prev.orderCount) : null)}
                ariaLabel={`${t('dashboard2.orders')} ${ordersValue} — ${openList}: ${ordersSub}`}
                onClick={() => onOpenOrders({ dateRange: range })}
            />
        </div>
    );
};

export default HeroKpis;
