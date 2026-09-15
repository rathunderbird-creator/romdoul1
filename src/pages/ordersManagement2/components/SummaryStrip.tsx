// Orders Management 2 — summary strip (spec §4.2). Pinned directly under the
// command bar / filter chips and BEFORE the table's own scroll container, so
// totals stay visible no matter how far the table itself is scrolled — the
// fix for "totals below the fold". Left: four money/count stats (Owed gets
// extra weight — it's the number that matters most). Right: status counts
// doubling as single-status toggle filters, plus a "No tracking" toggle.
import React from 'react';
import { Flag } from 'lucide-react';
import { D2, tabular, fmtMoney, fmtInt, PASSIVE_OPACITY } from '../../dashboard2/theme';
import { AlertPill, MutedPill } from '../ui2';
import type { SummaryTotals, StatusSegment } from '../metrics';
import type { OM2Filters } from '../urlFilters';

interface SummaryStripProps {
    totals: SummaryTotals;
    segments: StatusSegment[];
    noTracking: number;
    filters: OM2Filters;
    onFiltersChange: (next: OM2Filters | ((prev: OM2Filters) => OM2Filters)) => void;
}

// Exact hues from the spec — deliberately NOT the same map as dashboard2's
// STATUS_COLORS (that one gives Drafted its own grey; here Drafted shares
// Cancelled's #9ca3af).
const SEGMENT_COLOR: Record<string, string> = {
    Pending: '#f59e0b',
    Confirmed: '#3b82f6',
    Shipped: '#8b5cf6',
    Delivered: '#10b981',
    Drafted: '#9ca3af',
    Cancelled: '#9ca3af',
};
const segmentColor = (key: string): string => SEGMENT_COLOR[key] || '#9ca3af';

const Divider: React.FC = () => <span aria-hidden style={{ width: 1, height: 20, background: D2.border, flexShrink: 0 }} />;

const Stat: React.FC<{ label: string; value: string; color?: string; big?: boolean }> = ({ label, value, color, big }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: D2.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
        <span style={{ ...tabular, fontSize: big ? 15 : 14, fontWeight: big ? 800 : 700, color: color || D2.ink }}>{value}</span>
    </div>
);

// One button covers both "All" (color omitted → no dot) and a real status
// segment. Active state tints background/border with the segment's own hue.
const FilterButton: React.FC<{
    active: boolean;
    dimmed?: boolean;
    color?: string;
    label: string;
    count: number;
    ariaLabel: string;
    onClick: () => void;
}> = ({ active, dimmed, color, label, count, ariaLabel, onClick }) => {
    const accent = color || D2.ink;
    return (
        <button
            type="button"
            className="d2-clickable"
            onClick={onClick}
            aria-pressed={active}
            aria-label={ariaLabel}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                color: D2.ink, whiteSpace: 'nowrap', cursor: 'pointer',
                background: active ? `color-mix(in srgb, ${accent} 16%, white)` : 'transparent',
                border: `1px solid ${active ? `color-mix(in srgb, ${accent} 55%, white)` : D2.border}`,
                opacity: dimmed ? PASSIVE_OPACITY : 1,
            }}
        >
            {color && <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />}
            <span>{label}</span>
            <span style={{ ...tabular, fontWeight: 700 }}>{fmtInt(count)}</span>
        </button>
    );
};

const SummaryStrip: React.FC<SummaryStripProps> = ({ totals, segments, noTracking, filters, onFiltersChange }) => {
    const allActive = filters.statuses.length === 0 && !filters.noTrackingOnly;
    const noTrackingActive = filters.noTrackingOnly;

    const selectAll = () => onFiltersChange(prev => ({ ...prev, statuses: [], noTrackingOnly: false, page: 1 }));
    const toggleSegment = (key: string) => onFiltersChange(prev => ({
        ...prev,
        statuses: (prev.statuses.length === 1 && prev.statuses[0] === key) ? [] : [key],
        noTrackingOnly: false,
        page: 1,
    }));
    const toggleNoTracking = () => onFiltersChange(prev => ({ ...prev, noTrackingOnly: !prev.noTrackingOnly, statuses: [], page: 1 }));

    return (
        <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16,
            padding: '10px 14px', marginBottom: 10,
            background: D2.card, border: `1px solid ${D2.border}`, borderRadius: 11,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <Stat label="Orders" value={fmtInt(totals.orderCount)} />
                <Divider />
                <Stat label="Booked" value={fmtMoney(totals.booked)} />
                <Divider />
                <Stat label="Owed" value={fmtMoney(totals.owed)} color={D2.amber} big />
                <Divider />
                <Stat label="Collected" value={fmtMoney(totals.collected)} color={D2.green} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
                <FilterButton
                    active={allActive}
                    label="All"
                    count={totals.orderCount}
                    ariaLabel={`All, ${fmtInt(totals.orderCount)} orders, show all orders`}
                    onClick={selectAll}
                />
                {segments.map(segment => (
                    <FilterButton
                        key={segment.key}
                        active={filters.statuses.length === 1 && filters.statuses[0] === segment.key}
                        dimmed={segment.count === 0}
                        color={segmentColor(segment.key)}
                        label={segment.label}
                        count={segment.count}
                        ariaLabel={`${segment.label}, ${fmtInt(segment.count)} orders, filter to this status`}
                        onClick={() => toggleSegment(segment.key)}
                    />
                ))}
                <button
                    type="button"
                    className="d2-clickable"
                    onClick={toggleNoTracking}
                    aria-pressed={noTrackingActive}
                    aria-label={`No tracking, ${fmtInt(noTracking)} orders, filter to missing tracking`}
                    style={{
                        display: 'inline-flex', alignItems: 'center', background: 'none', border: 'none', padding: 0,
                        borderRadius: 999, cursor: 'pointer',
                        boxShadow: noTrackingActive ? `0 0 0 2px ${D2.red}` : 'none',
                    }}
                >
                    {noTracking > 0 ? (
                        <AlertPill icon={<Flag size={11} aria-hidden />}>{`No tracking ${fmtInt(noTracking)}`}</AlertPill>
                    ) : (
                        <MutedPill tone="neutral">{`No tracking ${fmtInt(noTracking)}`}</MutedPill>
                    )}
                </button>
            </div>
        </div>
    );
};

export default SummaryStrip;
