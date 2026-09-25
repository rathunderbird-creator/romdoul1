import React, { useState } from 'react';
import { ChevronRight, AlertTriangle, ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
import type { OverviewResult, StaffRow, Projection } from '../metrics';
import type { Translate } from '../types';
import { fmtMoney, fmtPct, fill } from '../../pageIncomePrediction/format';
import { useColumnWidths } from '../../pageIncomePrediction/useColumnWidths';

export interface OverviewTableProps {
    result: OverviewResult;
    t: Translate;
    isMobile: boolean;
    onOpenStaff: (staff: string) => void;
}

const COLUMNS = ['staff', 'orders', 'pending', 'cancelled', 'revenue', 'cogs', 'grossProfit', 'margin', 'target', 'projected'] as const;
type ColKey = typeof COLUMNS[number];

const DEFAULT_WIDTHS: Record<ColKey, number> = {
    staff: 200, orders: 70, pending: 110, cancelled: 90, revenue: 110, cogs: 100,
    grossProfit: 120, margin: 80, target: 230, projected: 130,
};

const HEADER_COLORS: Partial<Record<ColKey, string>> = {
    revenue: '#10B981', cogs: '#EF4444', grossProfit: '#8B5CF6', projected: '#8B5CF6',
};

const NUMERIC = new Set<ColKey>(['orders', 'pending', 'cancelled', 'revenue', 'cogs', 'grossProfit', 'margin', 'target', 'projected']);

const thStyle: React.CSSProperties = {
    borderBottom: '2px solid var(--color-border)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.5px', padding: '10px 12px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 12, whiteSpace: 'nowrap' };

// Same attainment color scheme as src/pages/reports/StaffPerformance.tsx's
// target-progress bars, so this reads consistently with that page.
const targetColor = (progress: number | null): string =>
    progress === null ? 'var(--color-text-secondary)' : progress >= 1 ? '#10B981' : progress >= 0.5 ? '#3B82F6' : '#F59E0B';

export const projectionText = (p: Projection, t: Translate): { text: string; title: string; muted: boolean } => {
    if (p.basis === 'run-rate' && p.grossProfit !== null) {
        return { text: fmtMoney(p.grossProfit), title: fill(t('staffPrediction.basedOnDays'), { n: p.completedDays }), muted: false };
    }
    if (p.basis === 'actual' && p.grossProfit !== null) {
        return { text: fmtMoney(p.grossProfit), title: t('staffPrediction.actual'), muted: false };
    }
    if (!p.isFutureRange) return { text: '—', title: fill(t('staffPrediction.tooEarly'), { n: p.completedDays }), muted: true };
    return { text: '—', title: t('staffPrediction.futureMonth'), muted: true };
};

const signColor = (n: number): string => (n > 0.005 ? '#8B5CF6' : n < -0.005 ? '#EF4444' : 'var(--color-text-secondary)');

interface OverviewSort { key: ColKey; direction: 'asc' | 'desc' }

const sortValueOf = (row: StaffRow, key: ColKey, t: Translate): number | string | null => {
    switch (key) {
        case 'staff': return row.name === '' ? t('staffPrediction.unassigned') : row.name;
        case 'orders': return row.orders;
        case 'pending': return row.pending;
        case 'cancelled': return row.cancelled;
        case 'revenue': return row.revenue;
        case 'cogs': return row.cogs;
        case 'grossProfit': return row.grossProfit;
        case 'margin': return row.margin;
        case 'target': return row.targetProgress;
        case 'projected': return row.projection.grossProfit;
        default: return null;
    }
};

const sortRows = (rows: StaffRow[], sort: OverviewSort, t: Translate): StaffRow[] => {
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        const va = sortValueOf(a, sort.key, t);
        const vb = sortValueOf(b, sort.key, t);
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb)) * dir;
    });
};

// "$revenue / $target (pct%)" — revenue is the TARGETED revenue (see
// StaffRow.targetedRevenue): a staff row's own, or on the Totals row only the
// staff who have a target. The target amount is the PERIOD target (the monthly
// target pro-rated to the selected dates; equal to it for a whole month).
const targetText = (row: StaffRow): string => {
    const pct = row.targetProgress !== null ? Math.round(row.targetProgress * 100) : 0;
    return `${fmtMoney(row.targetedRevenue ?? 0)} / ${fmtMoney(row.periodTarget ?? 0)} (${pct}%)`;
};

const targetCellContent = (row: StaffRow, t: Translate): React.ReactNode => {
    if (row.monthlyTarget === null) return <span style={{ color: 'var(--color-text-secondary)' }}>{t('staffPrediction.noTarget')}</span>;
    const pct = row.targetProgress !== null ? Math.round(row.targetProgress * 100) : 0;
    const barPct = Math.min(100, pct);
    const color = targetColor(row.targetProgress);
    const text = targetText(row);
    return (
        // Stretch + right-aligned text (not flex-end): a flex-end item wider than
        // the cell overflows to the LEFT and gets its leading digits clipped
        // with no ellipsis; this ellipsizes at the end and keeps a tooltip.
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'stretch', minWidth: 0 }}>
            <span title={text} style={{ fontWeight: 600, color, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
            <div style={{ width: '100%', height: 4, borderRadius: 2, background: 'var(--color-border)', overflow: 'hidden' }}>
                <div style={{ width: `${barPct}%`, height: '100%', background: color, borderRadius: 2 }} />
            </div>
        </div>
    );
};

const OverviewTable: React.FC<OverviewTableProps> = ({ result, t, isMobile, onOpenStaff }) => {
    const { widthStyle, resizeHandle, totalWidth } = useColumnWidths('pip_staff_overview', DEFAULT_WIDTHS);
    const { rows, totals } = result;
    const staffLabel = (row: StaffRow): string => (row.name === '' ? t('staffPrediction.unassigned') : row.name);

    const [sort, setSort] = useState<OverviewSort | null>(null);
    const toggleSort = (key: ColKey) => setSort(prev => {
        if (!prev || prev.key !== key) return { key, direction: 'desc' };
        if (prev.direction === 'desc') return { key, direction: 'asc' };
        return null;
    });
    const displayRows = sort ? sortRows(rows, sort, t) : rows;

    if (isMobile) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {displayRows.map(row => {
                    const proj = projectionText(row.projection, t);
                    const notInConfig = row.name !== '' && !row.inConfig;
                    return (
                        <div
                            key={row.name}
                            role="button"
                            tabIndex={0}
                            onClick={() => onOpenStaff(row.name)}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenStaff(row.name); } }}
                            className="glass-panel pip-row-clickable"
                            style={{ textAlign: 'left', width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${notInConfig ? 'rgba(245,158,11,0.5)' : 'var(--color-border)'}`, background: notInConfig ? 'rgba(245,158,11,0.06)' : 'var(--color-surface)', color: 'var(--color-text-main)', boxSizing: 'border-box' }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                <span className="khmer" style={{ fontWeight: 700, fontSize: 14, fontStyle: row.name === '' ? 'italic' : undefined, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{staffLabel(row)}</span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 800, fontSize: 15, color: signColor(row.grossProfit), flexShrink: 0 }}>
                                    {fmtMoney(row.grossProfit)} <ChevronRight size={14} aria-hidden />
                                </span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 8, fontSize: 11, color: 'var(--color-text-secondary)' }}>
                                <span>{t('staffPrediction.columns.orders')}<br /><strong style={{ color: 'var(--color-text-main)' }}>{row.orders}</strong></span>
                                <span>{t('staffPrediction.columns.revenue')}<br /><strong style={{ color: '#10B981' }}>{fmtMoney(row.revenue)}</strong></span>
                                <span>{t('staffPrediction.columns.margin')}<br /><strong style={{ color: 'var(--color-text-main)' }}>{fmtPct(row.margin)}</strong></span>
                            </div>
                            {row.monthlyTarget !== null && (
                                <div style={{ marginTop: 8 }}>{targetCellContent(row, t)}</div>
                            )}
                            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-secondary)' }} title={proj.title}>
                                {t('staffPrediction.columns.projected')}: <strong style={{ color: proj.muted ? undefined : signColor(row.projection.grossProfit || 0) }}>{proj.text}</strong>
                                {notInConfig && <span style={{ marginLeft: 8, fontStyle: 'italic' }}>· {t('staffPrediction.notInSettings')}</span>}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    // Set when the monthly target is pro-rated (range isn't a whole month), so
    // the Target column says why its amounts differ from the configured target.
    const targetHeaderTitle = result.targetFactor !== 1 ? t('staffPrediction.targetProrated') : undefined;

    const header = (key: ColKey, label: string, title?: string) => {
        const active = sort?.key === key;
        const ariaSort: 'ascending' | 'descending' | 'none' = active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none';
        return (
            <th
                key={key}
                className={key === 'staff' ? 'pip-sticky-first' : undefined}
                scope="col"
                aria-sort={ariaSort}
                title={title}
                style={{ ...thStyle, ...widthStyle(key), textAlign: NUMERIC.has(key) ? 'right' : 'left', color: HEADER_COLORS[key] || thStyle.color, ...(key === 'staff' ? { background: 'var(--color-surface)' } : {}) }}
            >
                <button
                    type="button"
                    onClick={() => toggleSort(key)}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', justifyContent: NUMERIC.has(key) ? 'flex-end' : 'flex-start', background: 'none', border: 'none', padding: 0, font: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit', color: active ? '#8B5CF6' : 'inherit', cursor: 'pointer', overflow: 'hidden' }}
                >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                    {active ? (sort!.direction === 'asc' ? <ArrowUp size={11} aria-hidden style={{ flexShrink: 0 }} /> : <ArrowDown size={11} aria-hidden style={{ flexShrink: 0 }} />) : <ChevronsUpDown size={11} aria-hidden style={{ opacity: 0.35, flexShrink: 0 }} />}
                </button>
                {resizeHandle(key)}
            </th>
        );
    };

    const cell = (key: ColKey, content: React.ReactNode, extra?: React.CSSProperties) => (
        <td key={key} className={key === 'staff' ? 'pip-sticky-first' : undefined} style={{ ...tdStyle, ...widthStyle(key), overflow: 'hidden', textOverflow: 'ellipsis', textAlign: NUMERIC.has(key) ? 'right' : 'left', ...extra }}>
            {content}
        </td>
    );

    const money = (n: number, color: string) => (n !== 0 ? <span style={{ fontWeight: 600, color }}>{fmtMoney(n)}</span> : <span style={{ color: 'var(--color-text-secondary)' }}>-</span>);

    const renderRow = (row: StaffRow) => {
        const proj = projectionText(row.projection, t);
        const notInConfig = row.name !== '' && !row.inConfig;
        const rowBg = notInConfig ? 'rgba(245,158,11,0.08)' : undefined;
        return (
            <tr
                key={row.name}
                className="pip-row pip-row-clickable"
                tabIndex={0}
                title={staffLabel(row)}
                onClick={() => onOpenStaff(row.name)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenStaff(row.name); } }}
                style={{ background: rowBg }}
            >
                {cell('staff', (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
                        {notInConfig && <AlertTriangle size={13} style={{ color: '#F59E0B', flexShrink: 0 }} aria-hidden />}
                        <span className="khmer" style={{ fontWeight: 700, fontSize: 13, fontStyle: row.name === '' ? 'italic' : undefined, color: row.name === '' ? 'var(--color-text-secondary)' : 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{staffLabel(row)}</span>
                        {notInConfig && (
                            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', padding: '1px 5px', borderRadius: 4, background: 'rgba(245,158,11,0.15)', color: '#B45309', flexShrink: 0 }}>{t('staffPrediction.notInSettings')}</span>
                        )}
                        <ChevronRight size={13} style={{ color: 'var(--color-text-secondary)', flexShrink: 0, marginLeft: 'auto' }} aria-hidden />
                    </span>
                ), { background: rowBg || 'var(--color-surface)' })}
                {cell('orders', <span style={{ fontWeight: 600, color: row.orders > 0 ? 'var(--color-text-main)' : 'var(--color-text-secondary)' }}>{row.orders > 0 ? row.orders : '-'}</span>)}
                {cell('pending', row.pending > 0 ? <span style={{ color: '#F59E0B', fontWeight: 600 }}>{row.pending} · {fmtMoney(row.pendingAmount)}</span> : <span style={{ color: 'var(--color-text-secondary)' }}>-</span>)}
                {cell('cancelled', row.cancelled > 0 ? <span style={{ color: '#EF4444', fontWeight: 600 }}>{row.cancelled}</span> : <span style={{ color: 'var(--color-text-secondary)' }}>-</span>)}
                {cell('revenue', money(row.revenue, '#10B981'))}
                {cell('cogs', money(row.cogs, '#EF4444'))}
                {cell('grossProfit', <span style={{ fontWeight: 700, fontSize: 13, color: signColor(row.grossProfit) }}>{fmtMoney(row.grossProfit)}</span>, { background: row.grossProfit !== 0 ? `rgba(${row.grossProfit > 0 ? '139,92,246' : '239,68,68'},0.04)` : undefined })}
                {cell('margin', <span style={{ fontWeight: 600, color: row.margin === null ? 'var(--color-text-secondary)' : signColor(row.margin) }}>{fmtPct(row.margin)}</span>)}
                {cell('target', targetCellContent(row, t))}
                {cell('projected', <span title={proj.title} style={{ fontWeight: 700, color: proj.muted ? 'var(--color-text-secondary)' : signColor(row.projection.grossProfit || 0) }}>{proj.text}</span>)}
            </tr>
        );
    };

    const totalsProj = projectionText(totals.projection, t);
    const footCell = (key: ColKey, content: React.ReactNode, color?: string) => (
        <td key={key} className={key === 'staff' ? 'pip-sticky-first' : undefined} style={{ ...widthStyle(key), textAlign: NUMERIC.has(key) ? 'right' : 'left', fontWeight: 700, fontSize: 12, padding: 12, color: color || 'var(--color-text-main)', background: 'var(--color-surface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {content}
        </td>
    );

    return (
        <div className="glass-panel" style={{ overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 16, padding: 0, flex: '0 1 auto', minHeight: 0 }}>
            <table className="spreadsheet-table" style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', width: totalWidth, minWidth: '100%' }}>
                <thead>
                    <tr style={{ background: 'var(--color-surface)' }}>
                        {header('staff', t('staffPrediction.columns.staff'))}
                        {header('orders', t('staffPrediction.columns.orders'))}
                        {header('pending', t('staffPrediction.columns.pending'))}
                        {header('cancelled', t('staffPrediction.columns.cancelled'))}
                        {header('revenue', t('staffPrediction.columns.revenue'))}
                        {header('cogs', t('staffPrediction.columns.cogs'))}
                        {header('grossProfit', t('staffPrediction.columns.grossProfit'))}
                        {header('margin', t('staffPrediction.columns.margin'))}
                        {header('target', t('staffPrediction.columns.target'), targetHeaderTitle)}
                        {header('projected', t('staffPrediction.columns.projected'))}
                    </tr>
                </thead>
                <tbody>{displayRows.map(renderRow)}</tbody>
                <tfoot>
                    <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                        {footCell('staff', t('staffPrediction.totals'))}
                        {footCell('orders', totals.orders || '-')}
                        {footCell('pending', totals.pending > 0 ? `${totals.pending} · ${fmtMoney(totals.pendingAmount)}` : '-', '#F59E0B')}
                        {footCell('cancelled', totals.cancelled || '-', '#EF4444')}
                        {footCell('revenue', fmtMoney(totals.revenue), '#10B981')}
                        {footCell('cogs', fmtMoney(totals.cogs), '#EF4444')}
                        {footCell('grossProfit', fmtMoney(totals.grossProfit), signColor(totals.grossProfit))}
                        {footCell('margin', fmtPct(totals.margin), totals.margin === null ? undefined : signColor(totals.margin))}
                        {footCell('target', totals.monthlyTarget === null ? '—' : <span title={`${targetText(totals)} — ${t('staffPrediction.targetedOnly')}`}>{targetText(totals)}</span>)}
                        {footCell('projected', <span title={totalsProj.title}>{totalsProj.text}</span>, totalsProj.muted ? 'var(--color-text-secondary)' : signColor(totals.projection.grossProfit || 0))}
                    </tr>
                </tfoot>
            </table>
        </div>
    );
};

export default OverviewTable;
