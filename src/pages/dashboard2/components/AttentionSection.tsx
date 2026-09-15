// Dashboard2 — "Needs attention" (spec §4.4 / §7). Three alert cards, each
// rendered only when its condition is met: critical stock, oldest pending
// orders, and shipped/delivered orders sent by an external courier with no
// tracking id. The whole section hides when nothing is wrong, so the page
// never shows an empty "all good" card competing for attention.
//
// Every number is a link (spec §6): stock chips → inventory, pending rows →
// order list filtered to that customer, the tracking card → order list
// filtered to the affected couriers. Buttons are real <button> elements and
// are never nested inside one another.
import type React from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Product } from '../../../types';
import type { AttentionSectionProps } from '../types';
import type { PendingItem } from '../metrics';
import { stockLevel } from '../metrics';
import { D2, tabular, fmtMoney, fmtInt, fmtAge } from '../theme';
import { Card, Chip, SectionHeader } from '../ui';

// ─── Local tokens ─────────────────────────────────────────────────────────

// Chip fills sit one shade deeper than the card tint (D2.redBg / D2.amberBg)
// so they still read on the tinted tier-1 cards.
const RED_CHIP = { color: D2.red, bg: '#fee2e2' } as const;
const AMBER_CHIP = { color: D2.amber, bg: '#fef3c7' } as const;

// Hairline between pending rows — warm so it sits on the amber card.
const PENDING_ROW_BORDER = '#f3e8d3';

const CARD_MIN_HEIGHT = 120;
const MAX_STOCK_CHIPS = 3;
const MAX_PENDING_ROWS = 5;

// ─── Small local pieces ───────────────────────────────────────────────────

// "Critical stock  (3)" — the coloured label row every alert card opens with.
// Spans (not divs) so it is valid inside the tracking card, which is a <button>.
const LabelRow: React.FC<{ label: string; color: string; count: number; chip: { color: string; bg: string } }> = ({ label, color, count, chip }) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, minHeight: 22 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color, lineHeight: 1.3 }}>{label}</span>
        <Chip color={chip.color} bg={chip.bg}>{fmtInt(count)}</Chip>
    </span>
);

// Inline text link rendered as a button ("View all low-stock items (12) →").
const LinkButton: React.FC<{ label: string; color: string; onClick: () => void; ariaLabel: string; size?: number }> = ({ label, color, onClick, ariaLabel, size = 12 }) => (
    <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        title={ariaLabel}
        style={{
            background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: size, fontWeight: 600, color,
            display: 'inline-flex', alignItems: 'center', gap: 4, textAlign: 'left',
            ...tabular,
        }}
    >
        {label} <span aria-hidden>→</span>
    </button>
);

// Joins inline nodes with " · " separators (kept out of the accessible name).
const joinDots = (nodes: ReactNode[]): ReactNode[] =>
    nodes.flatMap((node, i) => (i === 0 ? [node] : [<span key={`sep-${i}`} aria-hidden>{' · '}</span>, node]));

// ─── Card 1: critical stock ───────────────────────────────────────────────

const CriticalStockCard: React.FC<{ lowStock: Product[]; onOpenInventory: () => void; t: AttentionSectionProps['t'] }> = ({ lowStock, onOpenInventory, t }) => {
    const shown = lowStock.slice(0, MAX_STOCK_CHIPS);
    const overflow = lowStock.length > MAX_STOCK_CHIPS;
    return (
        <Card accent={{ bg: D2.redBg, line: D2.redLine }} style={{ minHeight: CARD_MIN_HEIGHT }}>
            <LabelRow label={t('dashboard2.criticalStock')} color={D2.red} count={lowStock.length} chip={RED_CHIP} />

            {/* The three most critical products (already sorted) as clickable chips. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {shown.map(p => {
                    const stock = Number(p.stock) || 0;
                    const palette = stockLevel(p) === 'low' ? AMBER_CHIP : RED_CHIP;
                    const label = `${p.name} · ${fmtInt(stock)} ${t('dashboard2.left')} — ${t('dashboard2.openInventory')}`;
                    return (
                        <button
                            key={p.id}
                            type="button"
                            className="d2-clickable"
                            onClick={onOpenInventory}
                            aria-label={label}
                            title={label}
                            style={{
                                display: 'inline-flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 4,
                                maxWidth: '100%', padding: '2px 9px', borderRadius: 999, border: 'none',
                                fontFamily: 'inherit', fontSize: 12, fontWeight: 600, lineHeight: 1.6,
                                color: palette.color, background: palette.bg, textAlign: 'left',
                                ...tabular,
                            }}
                        >
                            <span className="d2-khmer" style={{ minWidth: 0 }}>{p.name}</span>
                            <span aria-hidden style={{ opacity: 0.6 }}>·</span>
                            <span style={{ whiteSpace: 'nowrap' }}>{fmtInt(stock)} {t('dashboard2.left')}</span>
                        </button>
                    );
                })}
            </div>

            {overflow ? (
                <LinkButton
                    label={`${t('dashboard2.viewAllLowStock')} (${fmtInt(lowStock.length)})`}
                    color={D2.red}
                    onClick={onOpenInventory}
                    ariaLabel={`${t('dashboard2.viewAllLowStock')} (${fmtInt(lowStock.length)}) — ${t('dashboard2.openInventory')}`}
                />
            ) : (
                <LinkButton
                    label={t('dashboard2.openInventory')}
                    color={D2.muted}
                    size={11}
                    onClick={onOpenInventory}
                    ariaLabel={t('dashboard2.openInventory')}
                />
            )}
        </Card>
    );
};

// ─── Card 2: pending orders ───────────────────────────────────────────────

const PendingRow: React.FC<{ item: PendingItem; last: boolean; onClick: () => void; t: AttentionSectionProps['t'] }> = ({ item, last, onClick, t }) => {
    const { order } = item;
    const customerName = order.customer?.name || '—';
    const items = order.items || [];
    const courier = String(order.shipping?.company || '').trim();

    // Line 2 — only the parts that carry information (spec §5: zero/empty is hidden).
    const meta: ReactNode[] = [];
    if (items.length > 0) {
        meta.push(<span key="item">{items[0].name}{items.length > 1 ? ` +${items.length - 1}` : ''}</span>);
    }
    if (item.deposit > 0) {
        meta.push(<span key="deposit" style={{ whiteSpace: 'nowrap' }}>{t('dashboard2.deposit')} {fmtMoney(item.deposit)}</span>);
    }
    if (courier) {
        meta.push(<span key="courier">{courier}</span>);
    }
    meta.push(<span key="age" style={{ whiteSpace: 'nowrap' }}>{t('dashboard2.pendingFor')} {fmtAge(item.ageHours)}</span>);

    const label = `${customerName} · ${fmtMoney(order.total)} · ${t('dashboard2.pendingFor')} ${fmtAge(item.ageHours)} — ${t('dashboard2.openOrderList')}`;

    return (
        <li style={{ margin: 0, padding: 0 }}>
            <button
                type="button"
                className="d2-row-clickable"
                onClick={onClick}
                aria-label={label}
                title={label}
                style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%',
                    padding: '6px 4px', background: 'none', border: 'none', borderRadius: 6,
                    borderBottom: last ? 'none' : `1px solid ${PENDING_ROW_BORDER}`,
                    fontFamily: 'inherit', color: D2.ink, textAlign: 'left',
                }}
            >
                {/* Name + meta block; label-block keeps row height stable when the
                    Khmer name wraps, and the total stays anchored to line 1. */}
                <span className="d2-label-block" style={{ flex: 1, minWidth: 0 }}>
                    <span className="d2-khmer" style={{ fontSize: 13, fontWeight: 600, color: D2.ink, display: 'block' }}>{customerName}</span>
                    <span className="d2-khmer" style={{ fontSize: 12, color: D2.muted, display: 'block', ...tabular }}>{joinDots(meta)}</span>
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: D2.ink, whiteSpace: 'nowrap', flexShrink: 0, lineHeight: 1.85, ...tabular }}>
                    {fmtMoney(order.total)}
                </span>
            </button>
        </li>
    );
};

const PendingCard: React.FC<Pick<AttentionSectionProps, 'pending' | 'range' | 'onOpenOrders' | 't'>> = ({ pending, range, onOpenOrders, t }) => {
    const shown = pending.slice(0, MAX_PENDING_ROWS);
    return (
        <Card accent={{ bg: D2.amberBg, line: D2.amberLine }} style={{ minHeight: CARD_MIN_HEIGHT }}>
            <LabelRow label={t('dashboard2.pendingOrders')} color={D2.amber} count={pending.length} chip={AMBER_CHIP} />

            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {shown.map((item, i) => (
                    <PendingRow
                        key={item.order.id}
                        item={item}
                        last={i === shown.length - 1}
                        t={t}
                        onClick={() => onOpenOrders({
                            statuses: ['Pending'],
                            search: item.order.customer?.phone || item.order.customer?.name || '',
                            dateRange: range,
                        })}
                    />
                ))}
            </ul>

            {pending.length > MAX_PENDING_ROWS && (
                <div style={{ marginTop: 8 }}>
                    <LinkButton
                        label={`${t('dashboard2.viewOrders')} (${fmtInt(pending.length)})`}
                        color={D2.amber}
                        onClick={() => onOpenOrders({ statuses: ['Pending'], dateRange: range })}
                        ariaLabel={`${t('dashboard2.viewOrders')} (${fmtInt(pending.length)}) — ${t('dashboard2.pendingOrders')}`}
                    />
                </div>
            )}
        </Card>
    );
};

// ─── Card 3: shipped without tracking ─────────────────────────────────────

const NoTrackingCard: React.FC<Pick<AttentionSectionProps, 'missingTracking' | 'missingTrackingCouriers' | 'range' | 'onOpenOrders' | 't'>> = ({ missingTracking, missingTrackingCouriers, range, onOpenOrders, t }) => {
    // Affected orders per courier, for the chips.
    const perCourier: Record<string, number> = {};
    for (const o of missingTracking) {
        const c = String(o.shipping?.company || '').trim();
        if (c) perCourier[c] = (perCourier[c] || 0) + 1;
    }
    const label = `${t('dashboard2.noTracking')} (${fmtInt(missingTracking.length)}) — ${t('dashboard2.openOrderList')}`;

    return (
        <Card
            accent={{ bg: D2.redBg, line: D2.redLine }}
            style={{ minHeight: CARD_MIN_HEIGHT, textAlign: 'left' }}
            onClick={() => onOpenOrders({ statuses: ['Shipped', 'Delivered'], shippingCos: missingTrackingCouriers, dateRange: range })}
            ariaLabel={label}
            title={label}
        >
            <LabelRow label={t('dashboard2.noTracking')} color={D2.red} count={missingTracking.length} chip={RED_CHIP} />
            <span style={{ display: 'block', fontSize: 12, color: D2.muted, lineHeight: 1.5 }}>{t('dashboard2.noTrackingHint')}</span>

            {/* Plain spans only — the whole card is already the button, and a
                button may hold phrasing content only (no nested buttons/divs). */}
            {missingTrackingCouriers.length > 0 && (
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {missingTrackingCouriers.map(c => (
                        <Chip key={c} color={RED_CHIP.color} bg={RED_CHIP.bg} style={{ whiteSpace: 'normal', alignItems: 'baseline' }}>
                            <span className="d2-khmer" style={{ minWidth: 0 }}>{c}</span>
                            <span style={{ whiteSpace: 'nowrap' }}>{fmtInt(perCourier[c] || 0)}</span>
                        </Chip>
                    ))}
                </span>
            )}
        </Card>
    );
};

// ─── Section ──────────────────────────────────────────────────────────────

const AttentionSection: React.FC<AttentionSectionProps> = ({ lowStock, pending, missingTracking, missingTrackingCouriers, range, onOpenOrders, onOpenInventory, t }) => {
    const showStock = lowStock.length > 0;
    const showPending = pending.length > 0;
    const showTracking = missingTracking.length > 0;
    if (!showStock && !showPending && !showTracking) return null;

    const cardCount = [showStock, showPending, showTracking].filter(Boolean).length;

    return (
        <section aria-label={t('dashboard2.needsAttention')} style={{ marginBottom: 14 }}>
            <SectionHeader title={t('dashboard2.needsAttention')} icon={AlertTriangle} count={cardCount} />
            <div className="d2-alerts">
                {showStock && <CriticalStockCard lowStock={lowStock} onOpenInventory={onOpenInventory} t={t} />}
                {showPending && <PendingCard pending={pending} range={range} onOpenOrders={onOpenOrders} t={t} />}
                {showTracking && (
                    <NoTrackingCard
                        missingTracking={missingTracking}
                        missingTrackingCouriers={missingTrackingCouriers}
                        range={range}
                        onOpenOrders={onOpenOrders}
                        t={t}
                    />
                )}
            </div>
        </section>
    );
};

export default AttentionSection;
