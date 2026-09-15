import React, { useState } from 'react';
import { ChevronRight, AlertTriangle, ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
import type { OverviewResult, PageRow, Projection } from '../metrics';
import type { Translate } from '../types';
import { fmtMoney, fmtPct, fmtRatio, fill } from '../format';
import { useColumnWidths } from '../useColumnWidths';
import EditableMoneyCell from './EditableMoneyCell';

export interface OverviewTableProps {
    result: OverviewResult;
    t: Translate;
    isMobile: boolean;
    onOpenPage: (page: string) => void;
    // Typing a page's month-total Boost here (rather than opening its daily
    // ledger) — see onEditBoost below for what "editing a sum" resolves to.
    canEdit: boolean;
    boostSavingKeys: Set<string>;
    boostSavedKeys: Set<string>;
    onEditBoost: (page: string, value: number | null) => Promise<void>;
}

const COLUMNS = ['page', 'orders', 'pending', 'cancelled', 'revenue', 'cogs', 'shipping', 'boost', 'roas', 'boostPerOrder', 'contribution', 'margin', 'projected'] as const;
type ColKey = typeof COLUMNS[number];

const DEFAULT_WIDTHS: Record<ColKey, number> = {
    page: 200, orders: 70, pending: 110, cancelled: 90, revenue: 110, cogs: 100, shipping: 95,
    boost: 100, roas: 70, boostPerOrder: 100, contribution: 120, margin: 80, projected: 130,
};

const HEADER_COLORS: Partial<Record<ColKey, string>> = {
    revenue: '#10B981', cogs: '#EF4444', shipping: '#EF4444', boost: '#F59E0B', contribution: '#8B5CF6', projected: '#8B5CF6',
};

const NUMERIC = new Set<ColKey>(['orders', 'pending', 'cancelled', 'revenue', 'cogs', 'shipping', 'boost', 'roas', 'boostPerOrder', 'contribution', 'margin', 'projected']);

// The Overview Boost cell edits a whole MONTH's total, unlike the daily
// Ledger's Boost cell (LedgerTable.tsx, warnAbove={2000} for one day) — a
// flat, distinctly larger threshold here, not that same per-day value,
// otherwise any page with a perfectly normal >$5k/month ad budget (well
// under $2k on any single day) would trip the "is this in dollars?" warning
// on every visit.
const OVERVIEW_BOOST_WARN_ABOVE = 20000;

// ─── Sorting — click a header to rank pages by that column ────────────────
// No sort chosen (null) falls back to metrics.ts's own default order
// (contribution desc, unassigned always last); once the user picks a column,
// the unassigned row sorts like any other row on that column instead.

interface OverviewSort { key: ColKey; direction: 'asc' | 'desc' }

const sortValueOf = (row: PageRow, key: ColKey, t: Translate): number | string | null => {
    switch (key) {
        case 'page': return row.key === '' ? t('pagePrediction.unassigned') : row.key;
        case 'orders': return row.orders;
        case 'pending': return row.pending;
        case 'cancelled': return row.cancelled;
        case 'revenue': return row.revenue;
        case 'cogs': return row.cogs;
        case 'shipping': return row.shipping;
        case 'boost': return row.boost;
        case 'roas': return row.roas;
        case 'boostPerOrder': return row.boostPerOrder;
        case 'contribution': return row.contribution;
        case 'margin': return row.margin;
        case 'projected': return row.projection.contribution;
        default: return null;
    }
};

// Nulls (e.g. ROAS with zero boost) always sort to the bottom regardless of
// direction — same convention as dashboard2/ui.tsx's sortRows.
const sortRows = (rows: PageRow[], sort: OverviewSort, t: Translate): PageRow[] => {
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

const thStyle: React.CSSProperties = {
    borderBottom: '2px solid var(--color-border)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.5px', padding: '10px 12px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 12, whiteSpace: 'nowrap' };

// Shared between the desktop table and the mobile cards.
export const projectionText = (p: Projection, t: Translate): { text: string; title: string; muted: boolean } => {
    if (p.basis === 'run-rate' && p.contribution !== null) {
        return { text: fmtMoney(p.contribution), title: fill(t('pagePrediction.basedOnDays'), { n: p.completedDays }), muted: false };
    }
    if (p.basis === 'actual' && p.contribution !== null) {
        return { text: fmtMoney(p.contribution), title: t('pagePrediction.actual'), muted: false };
    }
    // A genuinely future month vs. the CURRENT month with 0-2 completed days
    // both land here with completedDays near 0 — isFutureMonth is what tells
    // them apart, so day 1 of the current month reads "too early", not the
    // wrong (and stranger) "hasn't started yet".
    if (!p.isFutureMonth) return { text: '—', title: fill(t('pagePrediction.tooEarly'), { n: p.completedDays }), muted: true };
    return { text: '—', title: t('pagePrediction.futureMonth'), muted: true };
};

const signColor = (n: number): string => (n > 0.005 ? '#8B5CF6' : n < -0.005 ? '#EF4444' : 'var(--color-text-secondary)');

const OverviewTable: React.FC<OverviewTableProps> = ({ result, t, isMobile, onOpenPage, canEdit, boostSavingKeys, boostSavedKeys, onEditBoost }) => {
    const { widthStyle, resizeHandle, totalWidth } = useColumnWidths('pip_overview', DEFAULT_WIDTHS);
    const { rows, totals, unassignedShare } = result;
    const pageLabel = (row: PageRow): string => (row.key === '' ? t('pagePrediction.unassigned') : row.key);
    const projectedHeader = result.monthState === 'past' ? t('pagePrediction.columns.actual') : t('pagePrediction.columns.projected');

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
                    const warnUnassigned = row.key === '' && unassignedShare > 0.05;
                    return (
                        // A plain div (not <button>) — the Boost input below needs
                        // to be a real interactive descendant, which a <button>
                        // can't contain; tabIndex + Enter/Space mirrors the
                        // desktop table's <tr> pattern for the same reason.
                        <div
                            key={row.key}
                            role="button"
                            tabIndex={0}
                            onClick={() => onOpenPage(row.key)}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenPage(row.key); } }}
                            className="glass-panel pip-row-clickable"
                            style={{ textAlign: 'left', width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${warnUnassigned ? 'rgba(245,158,11,0.5)' : 'var(--color-border)'}`, background: warnUnassigned ? 'rgba(245,158,11,0.06)' : 'var(--color-surface)', color: 'var(--color-text-main)', boxSizing: 'border-box' }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontWeight: 700, fontSize: 14, fontStyle: row.key === '' ? 'italic' : undefined, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{pageLabel(row)}</span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 800, fontSize: 15, color: signColor(row.contribution), flexShrink: 0 }}>
                                    {fmtMoney(row.contribution)} <ChevronRight size={14} aria-hidden />
                                </span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 8, fontSize: 11, color: 'var(--color-text-secondary)', alignItems: 'end' }}>
                                <span>{t('pagePrediction.columns.revenue')}<br /><strong style={{ color: '#10B981' }}>{fmtMoney(row.revenue)}</strong></span>
                                <span>{t('pagePrediction.columns.roas')}<br /><strong style={{ color: 'var(--color-text-main)' }}>{fmtRatio(row.roas)}</strong></span>
                                <span>{t('pagePrediction.columns.orders')}<br /><strong style={{ color: 'var(--color-text-main)' }}>{row.orders}</strong></span>
                            </div>
                            <div style={{ marginTop: 6 }} onClick={e => e.stopPropagation()}>
                                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 2 }}>{t('pagePrediction.columns.boost')}</span>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody><tr>
                                    <EditableMoneyCell
                                        value={row.boost > 0 ? row.boost : null}
                                        disabled={!canEdit}
                                        saving={boostSavingKeys.has(row.key)}
                                        saved={boostSavedKeys.has(row.key)}
                                        color="#F59E0B"
                                        ariaLabel={`${t('pagePrediction.columns.boost')} ${pageLabel(row)}`}
                                        warnAbove={OVERVIEW_BOOST_WARN_ABOVE}
                                        warnTitle={t('pagePrediction.highBoostWarning')}
                                        onCommit={v => onEditBoost(row.key, v)}
                                    />
                                </tr></tbody></table>
                            </div>
                            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-secondary)' }} title={proj.title}>
                                {projectedHeader}: <strong style={{ color: proj.muted ? undefined : signColor(row.projection.contribution || 0) }}>{proj.text}</strong>
                                {!row.inConfig && row.key !== '' && <span style={{ marginLeft: 8, fontStyle: 'italic' }}>· {t('pagePrediction.notInSettings')}</span>}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    const header = (key: ColKey, label: string, title?: string) => {
        const active = sort?.key === key;
        const ariaSort: 'ascending' | 'descending' | 'none' = active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none';
        return (
            <th
                key={key}
                className={key === 'page' ? 'pip-sticky-first' : undefined}
                scope="col"
                aria-sort={ariaSort}
                title={title}
                style={{ ...thStyle, ...widthStyle(key), textAlign: NUMERIC.has(key) ? 'right' : 'left', color: HEADER_COLORS[key] || thStyle.color, ...(key === 'page' ? { background: 'var(--color-surface)' } : {}) }}
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
        <td key={key} className={key === 'page' ? 'pip-sticky-first' : undefined} style={{ ...tdStyle, ...widthStyle(key), overflow: 'hidden', textOverflow: 'ellipsis', textAlign: NUMERIC.has(key) ? 'right' : 'left', ...extra }}>
            {content}
        </td>
    );

    const money = (n: number, color: string) => (n !== 0 ? <span style={{ fontWeight: 600, color }}>{fmtMoney(n)}</span> : <span style={{ color: 'var(--color-text-secondary)' }}>-</span>);

    const renderRow = (row: PageRow) => {
        const proj = projectionText(row.projection, t);
        const warnUnassigned = row.key === '' && unassignedShare > 0.05;
        const rowBg = warnUnassigned ? 'rgba(245,158,11,0.08)' : undefined;
        return (
            <tr
                key={row.key}
                className="pip-row pip-row-clickable"
                tabIndex={0}
                title={pageLabel(row)}
                onClick={() => onOpenPage(row.key)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenPage(row.key); } }}
                style={{ background: rowBg }}
            >
                {cell('page', (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
                        {warnUnassigned && <AlertTriangle size={13} style={{ color: '#F59E0B', flexShrink: 0 }} aria-hidden />}
                        <span className="khmer" style={{ fontWeight: 700, fontSize: 13, fontStyle: row.key === '' ? 'italic' : undefined, color: row.key === '' ? 'var(--color-text-secondary)' : 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pageLabel(row)}</span>
                        {!row.inConfig && row.key !== '' && (
                            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', padding: '1px 5px', borderRadius: 4, background: 'rgba(245,158,11,0.15)', color: '#B45309', flexShrink: 0 }}>{t('pagePrediction.notInSettings')}</span>
                        )}
                        <ChevronRight size={13} style={{ color: 'var(--color-text-secondary)', flexShrink: 0, marginLeft: 'auto' }} aria-hidden />
                    </span>
                ), { background: rowBg || 'var(--color-surface)' })}
                {cell('orders', <span style={{ fontWeight: 600, color: row.orders > 0 ? 'var(--color-text-main)' : 'var(--color-text-secondary)' }}>{row.orders > 0 ? row.orders : '-'}</span>)}
                {cell('pending', row.pending > 0 ? <span style={{ color: '#F59E0B', fontWeight: 600 }}>{row.pending} · {fmtMoney(row.pendingAmount)}</span> : <span style={{ color: 'var(--color-text-secondary)' }}>-</span>)}
                {cell('cancelled', row.cancelled > 0 ? <span style={{ color: '#EF4444', fontWeight: 600 }}>{row.cancelled}</span> : <span style={{ color: 'var(--color-text-secondary)' }}>-</span>)}
                {cell('revenue', money(row.revenue, '#10B981'))}
                {cell('cogs', money(row.cogs, '#EF4444'))}
                {cell('shipping', money(row.shipping, '#EF4444'))}
                {canEdit ? (
                    <EditableMoneyCell
                        key="boost"
                        value={row.boost > 0 ? row.boost : null}
                        disabled={false}
                        saving={boostSavingKeys.has(row.key)}
                        saved={boostSavedKeys.has(row.key)}
                        color="#F59E0B"
                        ariaLabel={`${t('pagePrediction.columns.boost')} ${pageLabel(row)}`}
                        warnAbove={OVERVIEW_BOOST_WARN_ABOVE}
                        warnTitle={t('pagePrediction.highBoostWarning')}
                        onCommit={v => onEditBoost(row.key, v)}
                    />
                ) : cell('boost', money(row.boost, '#F59E0B'))}
                {cell('roas', <span style={{ fontWeight: 600, color: row.roas === null ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>{fmtRatio(row.roas)}</span>)}
                {cell('boostPerOrder', <span style={{ fontWeight: 600, color: row.boostPerOrder === null ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>{row.boostPerOrder === null ? '—' : fmtMoney(row.boostPerOrder)}</span>)}
                {cell('contribution', <span style={{ fontWeight: 700, fontSize: 13, color: signColor(row.contribution) }}>{fmtMoney(row.contribution)}</span>, { background: row.contribution !== 0 ? `rgba(${row.contribution > 0 ? '139,92,246' : '239,68,68'},0.04)` : undefined })}
                {cell('margin', <span style={{ fontWeight: 600, color: row.margin === null ? 'var(--color-text-secondary)' : signColor(row.margin) }}>{fmtPct(row.margin)}</span>)}
                {cell('projected', <span title={proj.title} style={{ fontWeight: 700, color: proj.muted ? 'var(--color-text-secondary)' : signColor(row.projection.contribution || 0) }}>{proj.text}</span>)}
            </tr>
        );
    };

    const totalsProj = projectionText(totals.projection, t);
    const footCell = (key: ColKey, content: React.ReactNode, color?: string) => (
        <td key={key} className={key === 'page' ? 'pip-sticky-first' : undefined} style={{ ...widthStyle(key), textAlign: NUMERIC.has(key) ? 'right' : 'left', fontWeight: 700, fontSize: 12, padding: 12, color: color || 'var(--color-text-main)', background: 'var(--color-surface)', whiteSpace: 'nowrap' }}>
            {content}
        </td>
    );

    return (
        // Sized to its rows (a handful of pages), scrolling only once it would
        // overflow the page — unlike the daily ledger, which fills the height.
        <div className="glass-panel" style={{ overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 16, padding: 0, flex: '0 1 auto', minHeight: 0 }}>
            <table className="spreadsheet-table" style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', width: totalWidth, minWidth: '100%' }}>
                <thead>
                    <tr style={{ background: 'var(--color-surface)' }}>
                        {header('page', t('pagePrediction.columns.page'))}
                        {header('orders', t('pagePrediction.columns.orders'))}
                        {header('pending', t('pagePrediction.columns.pending'))}
                        {header('cancelled', t('pagePrediction.columns.cancelled'))}
                        {header('revenue', t('pagePrediction.columns.revenue'))}
                        {header('cogs', t('pagePrediction.columns.cogs'))}
                        {header('shipping', t('pagePrediction.columns.shipping'))}
                        {header('boost', t('pagePrediction.columns.boost'), canEdit ? t('pagePrediction.boostOverviewHint') : undefined)}
                        {header('roas', t('pagePrediction.columns.roas'))}
                        {header('boostPerOrder', t('pagePrediction.columns.boostPerOrder'))}
                        {header('contribution', t('pagePrediction.columns.contribution'))}
                        {header('margin', t('pagePrediction.columns.margin'))}
                        {header('projected', projectedHeader)}
                    </tr>
                </thead>
                <tbody>{displayRows.map(renderRow)}</tbody>
                <tfoot>
                    <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                        {footCell('page', t('pagePrediction.totals'))}
                        {footCell('orders', totals.orders)}
                        {footCell('pending', totals.pending > 0 ? `${totals.pending} · ${fmtMoney(totals.pendingAmount)}` : '-', '#F59E0B')}
                        {footCell('cancelled', totals.cancelled || '-', '#EF4444')}
                        {footCell('revenue', fmtMoney(totals.revenue), '#10B981')}
                        {footCell('cogs', fmtMoney(totals.cogs), '#EF4444')}
                        {footCell('shipping', fmtMoney(totals.shipping), '#EF4444')}
                        {footCell('boost', fmtMoney(totals.boost), '#F59E0B')}
                        {footCell('roas', fmtRatio(totals.roas))}
                        {footCell('boostPerOrder', totals.boostPerOrder === null ? '—' : fmtMoney(totals.boostPerOrder))}
                        {footCell('contribution', fmtMoney(totals.contribution), signColor(totals.contribution))}
                        {footCell('margin', fmtPct(totals.margin), totals.margin === null ? undefined : signColor(totals.margin))}
                        {footCell('projected', <span title={totalsProj.title}>{totalsProj.text}</span>, totalsProj.muted ? 'var(--color-text-secondary)' : signColor(totals.projection.contribution || 0))}
                    </tr>
                </tfoot>
            </table>
        </div>
    );
};

export default OverviewTable;
