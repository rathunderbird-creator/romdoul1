// Dashboard2 — order pipeline strip (spec §4.3). One horizontal row of the
// five pipeline stages, each a button that opens the order list filtered to
// that status inside the current range. Zero-count stages are de-emphasised
// (tier 3) but stay clickable; statuses outside the pipeline (Drafted /
// Returned / ReStock) are appended after a divider so nothing in the range
// is silently hidden.
import React from 'react';
import { ChevronRight } from 'lucide-react';
import { D2, STATUS_COLORS, PASSIVE_OPACITY, tabular, fmtInt } from '../theme';
import { PIPELINE_STAGES } from '../metrics';
import type { PipelineStage } from '../metrics';
import type { PipelineProps } from '../types';
import { Card, Chip } from '../ui';

// Statuses outside the five stages, in the order they are shown; anything
// unknown to this list follows alphabetically.
const OTHER_ORDER = ['Drafted', 'Returned', 'ReStock'];

// Shared reset for the stage / chip buttons: the surrounding CSS supplies the
// focus ring (.d2 button:focus-visible) and hover lift (.d2-clickable).
const buttonReset: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    margin: 0,
    font: 'inherit',
    color: 'inherit',
    whiteSpace: 'nowrap',
    flex: '0 0 auto',
};

const Pipeline: React.FC<PipelineProps> = ({ counts, other, range, onOpenOrders, t }) => {
    // Status name via i18n; when a status has no translation key, t() echoes
    // the key back — show the raw status instead of "dashboard2.status.X".
    const statusLabel = (status: string): string => {
        const key = `dashboard2.status.${status}`;
        const label = t(key);
        return label === key ? status : label;
    };

    const openStatus = (status: string) => onOpenOrders({ statuses: [status], dateRange: range });

    const openLabel = (status: string, count: number): string =>
        `${statusLabel(status)}: ${fmtInt(count)} — ${t('dashboard2.openOrderList')}`;

    const otherStatuses = Object.keys(other)
        .filter(status => (other[status] || 0) > 0)
        .sort((a, b) => {
            const ia = OTHER_ORDER.indexOf(a), ib = OTHER_ORDER.indexOf(b);
            if (ia !== -1 || ib !== -1) return (ia === -1 ? OTHER_ORDER.length : ia) - (ib === -1 ? OTHER_ORDER.length : ib);
            return a.localeCompare(b);
        });

    const renderStage = (stage: PipelineStage) => {
        const count = counts[stage] || 0;
        const zero = count === 0;
        return (
            <button
                key={stage}
                type="button"
                className="d2-clickable"
                onClick={() => openStatus(stage)}
                aria-label={openLabel(stage, count)}
                title={openLabel(stage, count)}
                style={{
                    ...buttonReset,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    minHeight: 28,
                    padding: '3px 10px',
                    borderRadius: 8,
                    color: D2.ink,
                    // Tier 3: a stage with nothing in it fades back but stays reachable.
                    opacity: zero ? PASSIVE_OPACITY : 1,
                }}
            >
                <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: STATUS_COLORS[stage] || D2.muted, flexShrink: 0 }} />
                <span className="d2-khmer" style={{ fontSize: 12, fontWeight: 600, color: D2.muted }}>{statusLabel(stage)}</span>
                <span style={{ ...tabular, fontSize: 16, fontWeight: 800, lineHeight: 1.25 }}>{fmtInt(count)}</span>
            </button>
        );
    };

    return (
        <Card style={{ padding: '10px 14px' }}>
            {/* The strip scrolls sideways on narrow screens (overflow-x on
                .d2-pipeline). That overflow would also clip the 2px focus ring
                and the hover lift, so the strip carries a little padding that
                a matching negative margin gives back to the card. */}
            <div
                className="d2-pipeline"
                role="group"
                aria-label={t('dashboard2.pipeline')}
                style={{ padding: '5px 4px', margin: '-5px -4px', minHeight: 28 }}
            >
                {PIPELINE_STAGES.map((stage, i) => (
                    <React.Fragment key={stage}>
                        {i > 0 && <ChevronRight size={14} aria-hidden style={{ color: D2.muted, flexShrink: 0 }} />}
                        {renderStage(stage)}
                    </React.Fragment>
                ))}

                {otherStatuses.length > 0 && (
                    <>
                        <span aria-hidden style={{ width: 1, height: 22, background: D2.border, margin: '0 6px', flex: '0 0 auto' }} />
                        <span className="d2-khmer" style={{ fontSize: 11, color: D2.muted, whiteSpace: 'nowrap', flex: '0 0 auto' }}>
                            {t('dashboard2.alsoInRange')}
                        </span>
                        {otherStatuses.map(status => {
                            const count = other[status] || 0;
                            return (
                                <button
                                    key={status}
                                    type="button"
                                    className="d2-clickable"
                                    onClick={() => openStatus(status)}
                                    aria-label={openLabel(status, count)}
                                    title={openLabel(status, count)}
                                    style={{ ...buttonReset, display: 'inline-flex', padding: 0, borderRadius: 999 }}
                                >
                                    <Chip dot={STATUS_COLORS[status] || D2.muted} style={{ color: D2.ink }}>
                                        <span className="d2-khmer" style={{ lineHeight: 1.6, fontWeight: 600, color: D2.muted }}>{statusLabel(status)}</span>
                                        <span style={{ fontWeight: 800 }}>{fmtInt(count)}</span>
                                    </Chip>
                                </button>
                            );
                        })}
                    </>
                )}
            </div>
        </Card>
    );
};

export default Pipeline;
