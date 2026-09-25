import React, { useMemo, useState } from 'react';
import { ChevronRight, AlertTriangle, ArrowUp, ArrowDown, ChevronsUpDown, Search } from 'lucide-react';
import { summarizeRows, type OverviewResult, type ProductRow, type Projection } from '../metrics';
import type { Translate } from '../types';
import { fmtMoney, fmtPct, fill } from '../../pageIncomePrediction/format';
import { useColumnWidths } from '../../pageIncomePrediction/useColumnWidths';

export interface OverviewTableProps {
    result: OverviewResult;
    now: Date;      // for the filtered-footer projection fallback — see summarizeRows
    t: Translate;
    isMobile: boolean;
    onOpenProduct: (productId: string) => void;
}

const COLUMNS = ['product', 'units', 'orders', 'pending', 'cancelled', 'revenue', 'cogs', 'grossProfit', 'margin', 'avgPrice', 'avgCost', 'projected'] as const;
type ColKey = typeof COLUMNS[number];

const DEFAULT_WIDTHS: Record<ColKey, number> = {
    product: 220, units: 70, orders: 70, pending: 110, cancelled: 90, revenue: 110, cogs: 100,
    grossProfit: 120, margin: 80, avgPrice: 90, avgCost: 90, projected: 130,
};

const HEADER_COLORS: Partial<Record<ColKey, string>> = {
    revenue: '#10B981', cogs: '#EF4444', grossProfit: '#8B5CF6', projected: '#8B5CF6',
};

const NUMERIC = new Set<ColKey>(['units', 'orders', 'pending', 'cancelled', 'revenue', 'cogs', 'grossProfit', 'margin', 'avgPrice', 'avgCost', 'projected']);

const thStyle: React.CSSProperties = {
    borderBottom: '2px solid var(--color-border)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.5px', padding: '10px 12px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 12, whiteSpace: 'nowrap' };

// Shared between the desktop table and the mobile cards.
export const projectionText = (p: Projection, t: Translate): { text: string; title: string; muted: boolean } => {
    if (p.basis === 'run-rate' && p.grossProfit !== null) {
        return { text: fmtMoney(p.grossProfit), title: fill(t('productPrediction.basedOnDays'), { n: p.completedDays }), muted: false };
    }
    if (p.basis === 'actual' && p.grossProfit !== null) {
        return { text: fmtMoney(p.grossProfit), title: t('productPrediction.actual'), muted: false };
    }
    // A genuinely future range vs. the CURRENT range with 0-2 completed days
    // both land here with completedDays near 0 — isFutureRange is what tells
    // them apart, so day 1 of the current month reads "too early", not the
    // wrong (and stranger) "hasn't started yet".
    if (!p.isFutureRange) return { text: '—', title: fill(t('productPrediction.tooEarly'), { n: p.completedDays }), muted: true };
    return { text: '—', title: t('productPrediction.futureMonth'), muted: true };
};

const signColor = (n: number): string => (n > 0.005 ? '#8B5CF6' : n < -0.005 ? '#EF4444' : 'var(--color-text-secondary)');

// ─── Sorting — click a header to rank products by that column ─────────────
// No sort chosen (null) falls back to metrics.ts's own default order (gross
// profit desc, the unknown-product bucket always last); once the user picks
// a column, that bucket sorts like any other row on that column instead.

interface OverviewSort { key: ColKey; direction: 'asc' | 'desc' }

const sortValueOf = (row: ProductRow, key: ColKey, t: Translate): number | string | null => {
    switch (key) {
        case 'product': return row.id === '' ? t('productPrediction.unknownProduct') : row.name;
        case 'units': return row.units;
        case 'orders': return row.orders;
        case 'pending': return row.pendingUnits;
        case 'cancelled': return row.cancelledUnits;
        case 'revenue': return row.revenue;
        case 'cogs': return row.cogs;
        case 'grossProfit': return row.grossProfit;
        case 'margin': return row.margin;
        case 'avgPrice': return row.avgPrice;
        case 'avgCost': return row.avgCost;
        case 'projected': return row.projection.grossProfit;
        default: return null;
    }
};

// Nulls always sort to the bottom regardless of direction.
const sortRows = (rows: ProductRow[], sort: OverviewSort, t: Translate): ProductRow[] => {
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

const OverviewTable: React.FC<OverviewTableProps> = ({ result, now, t, isMobile, onOpenProduct }) => {
    const { widthStyle, resizeHandle, totalWidth } = useColumnWidths('pip_product_overview', DEFAULT_WIDTHS);
    const productLabel = (row: ProductRow): string => (row.id === '' ? t('productPrediction.unknownProduct') : row.name);

    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<OverviewSort | null>(null);
    const toggleSort = (key: ColKey) => setSort(prev => {
        if (!prev || prev.key !== key) return { key, direction: 'desc' };
        if (prev.direction === 'desc') return { key, direction: 'asc' };
        return null;
    });

    const filteredRows = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return result.rows;
        // productLabel closes over `t` — a live language switch changes what
        // it returns (e.g. the unknown-product bucket's label), so `t` has to
        // be a real dependency or a stale filtered list can survive the
        // switch (and keep/drop rows a fresh filter of the same query text
        // would no longer keep/drop under the new language).
        return result.rows.filter(r => productLabel(r).toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
    }, [result.rows, search, t]);
    const displayRows = sort ? sortRows(filteredRows, sort, t) : filteredRows;
    // "Totals" always means "sum of what's currently shown" — searching down
    // to a handful of products re-sums just those, rather than staying
    // pinned to the whole catalogue's grand total. A search that matches
    // nothing gets an explicit zero/no-data footer rather than piping an
    // empty row set through summarizeRows: with no rows there's no real
    // projection basis to report, and synthesizing one from the range's state
    // alone produces a misleading tooltip (e.g. "Period not started" for a
    // period that's already over) — see the noData branch below.
    const isFiltered = search.trim() !== '';
    const noData = isFiltered && filteredRows.length === 0;
    const totals = !isFiltered ? result.totals : (noData ? summarizeRows([], result.range, now) : summarizeRows(filteredRows, result.range, now));

    const searchBox = (
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <Search size={14} aria-hidden style={{ position: 'absolute', left: 10, color: 'var(--color-text-secondary)', pointerEvents: 'none' }} />
            <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('productPrediction.searchPlaceholder')}
                aria-label={t('productPrediction.searchPlaceholder')}
                style={{ padding: '8px 10px 8px 30px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: 13, outline: 'none', height: 36, boxSizing: 'border-box', width: isMobile ? '100%' : 220 }}
            />
        </div>
    );

    if (isMobile) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {searchBox}
                {displayRows.length === 0 && (
                    <div style={{ padding: '16px 4px', fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'center' }}>{t('productPrediction.noMatch')}</div>
                )}
                {displayRows.map(row => {
                    const proj = projectionText(row.projection, t);
                    const deleted = row.id !== '' && !row.inCatalogue;
                    return (
                        <div
                            key={row.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => onOpenProduct(row.id)}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenProduct(row.id); } }}
                            className="glass-panel pip-row-clickable"
                            style={{ textAlign: 'left', width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${deleted ? 'rgba(245,158,11,0.5)' : 'var(--color-border)'}`, background: deleted ? 'rgba(245,158,11,0.06)' : 'var(--color-surface)', color: 'var(--color-text-main)', boxSizing: 'border-box' }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                <span className="khmer" style={{ fontWeight: 700, fontSize: 14, fontStyle: row.id === '' ? 'italic' : undefined, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{productLabel(row)}</span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 800, fontSize: 15, color: signColor(row.grossProfit), flexShrink: 0 }}>
                                    {fmtMoney(row.grossProfit)} <ChevronRight size={14} aria-hidden />
                                </span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 8, fontSize: 11, color: 'var(--color-text-secondary)' }}>
                                <span>{t('productPrediction.columns.units')}<br /><strong style={{ color: 'var(--color-text-main)' }}>{row.units}</strong></span>
                                <span>{t('productPrediction.columns.revenue')}<br /><strong style={{ color: '#10B981' }}>{fmtMoney(row.revenue)}</strong></span>
                                <span>{t('productPrediction.columns.margin')}<br /><strong style={{ color: 'var(--color-text-main)' }}>{fmtPct(row.margin)}</strong></span>
                            </div>
                            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-secondary)' }} title={proj.title}>
                                {t('productPrediction.columns.projected')}: <strong style={{ color: proj.muted ? undefined : signColor(row.projection.grossProfit || 0) }}>{proj.text}</strong>
                                {deleted && <span style={{ marginLeft: 8, fontStyle: 'italic' }}>· {t('productPrediction.deletedProduct')}</span>}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    const header = (key: ColKey, label: string) => {
        const active = sort?.key === key;
        const ariaSort: 'ascending' | 'descending' | 'none' = active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none';
        return (
            <th
                key={key}
                className={key === 'product' ? 'pip-sticky-first' : undefined}
                scope="col"
                aria-sort={ariaSort}
                style={{ ...thStyle, ...widthStyle(key), textAlign: NUMERIC.has(key) ? 'right' : 'left', color: HEADER_COLORS[key] || thStyle.color, ...(key === 'product' ? { background: 'var(--color-surface)' } : {}) }}
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
        <td key={key} className={key === 'product' ? 'pip-sticky-first' : undefined} style={{ ...tdStyle, ...widthStyle(key), overflow: 'hidden', textOverflow: 'ellipsis', textAlign: NUMERIC.has(key) ? 'right' : 'left', ...extra }}>
            {content}
        </td>
    );

    const money = (n: number, color: string) => (n !== 0 ? <span style={{ fontWeight: 600, color }}>{fmtMoney(n)}</span> : <span style={{ color: 'var(--color-text-secondary)' }}>-</span>);

    const renderRow = (row: ProductRow) => {
        const proj = projectionText(row.projection, t);
        const deleted = row.id !== '' && !row.inCatalogue;
        const rowBg = deleted ? 'rgba(245,158,11,0.08)' : undefined;
        return (
            <tr
                key={row.id}
                className="pip-row pip-row-clickable"
                tabIndex={0}
                title={productLabel(row)}
                onClick={() => onOpenProduct(row.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenProduct(row.id); } }}
                style={{ background: rowBg }}
            >
                {cell('product', (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
                        {deleted && <AlertTriangle size={13} style={{ color: '#F59E0B', flexShrink: 0 }} aria-hidden />}
                        <span className="khmer" style={{ fontWeight: 700, fontSize: 13, fontStyle: row.id === '' ? 'italic' : undefined, color: row.id === '' ? 'var(--color-text-secondary)' : 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{productLabel(row)}</span>
                        {deleted && (
                            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', padding: '1px 5px', borderRadius: 4, background: 'rgba(245,158,11,0.15)', color: '#B45309', flexShrink: 0 }}>{t('productPrediction.deletedProduct')}</span>
                        )}
                        <ChevronRight size={13} style={{ color: 'var(--color-text-secondary)', flexShrink: 0, marginLeft: 'auto' }} aria-hidden />
                    </span>
                ), { background: rowBg || 'var(--color-surface)' })}
                {cell('units', <span style={{ fontWeight: 600, color: row.units > 0 ? 'var(--color-text-main)' : 'var(--color-text-secondary)' }}>{row.units > 0 ? row.units : '-'}</span>)}
                {cell('orders', <span style={{ fontWeight: 600, color: row.orders > 0 ? 'var(--color-text-main)' : 'var(--color-text-secondary)' }}>{row.orders > 0 ? row.orders : '-'}</span>)}
                {cell('pending', row.pendingUnits > 0 ? <span style={{ color: '#F59E0B', fontWeight: 600 }}>{row.pendingUnits} · {row.pendingOrders}{t('productPrediction.ordersAbbrev')}</span> : <span style={{ color: 'var(--color-text-secondary)' }}>-</span>)}
                {cell('cancelled', row.cancelledUnits > 0 ? <span style={{ color: '#EF4444', fontWeight: 600 }}>{row.cancelledUnits}</span> : <span style={{ color: 'var(--color-text-secondary)' }}>-</span>)}
                {cell('revenue', money(row.revenue, '#10B981'))}
                {cell('cogs', money(row.cogs, '#EF4444'))}
                {cell('grossProfit', <span style={{ fontWeight: 700, fontSize: 13, color: signColor(row.grossProfit) }}>{fmtMoney(row.grossProfit)}</span>, { background: row.grossProfit !== 0 ? `rgba(${row.grossProfit > 0 ? '139,92,246' : '239,68,68'},0.04)` : undefined })}
                {cell('margin', <span style={{ fontWeight: 600, color: row.margin === null ? 'var(--color-text-secondary)' : signColor(row.margin) }}>{fmtPct(row.margin)}</span>)}
                {cell('avgPrice', <span style={{ color: row.avgPrice === null ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>{row.avgPrice === null ? '—' : fmtMoney(row.avgPrice)}</span>)}
                {cell('avgCost', <span style={{ color: row.avgCost === null ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>{row.avgCost === null ? '—' : fmtMoney(row.avgCost)}</span>)}
                {cell('projected', <span title={proj.title} style={{ fontWeight: 700, color: proj.muted ? 'var(--color-text-secondary)' : signColor(row.projection.grossProfit || 0) }}>{proj.text}</span>)}
            </tr>
        );
    };

    const totalsProj = noData ? { text: '—', title: t('productPrediction.noMatch'), muted: true } : projectionText(totals.projection, t);
    const footCell = (key: ColKey, content: React.ReactNode, color?: string) => (
        <td key={key} className={key === 'product' ? 'pip-sticky-first' : undefined} style={{ ...widthStyle(key), textAlign: NUMERIC.has(key) ? 'right' : 'left', fontWeight: 700, fontSize: 12, padding: 12, color: color || 'var(--color-text-main)', background: 'var(--color-surface)', whiteSpace: 'nowrap' }}>
            {content}
        </td>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, flex: '0 1 auto' }}>
            <div>{searchBox}</div>
            <div className="glass-panel" style={{ overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 16, padding: 0, flex: '0 1 auto', minHeight: 0 }}>
                <table className="spreadsheet-table" style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', width: totalWidth, minWidth: '100%' }}>
                    <thead>
                        <tr style={{ background: 'var(--color-surface)' }}>
                            {header('product', t('productPrediction.columns.product'))}
                            {header('units', t('productPrediction.columns.units'))}
                            {header('orders', t('productPrediction.columns.orders'))}
                            {header('pending', t('productPrediction.columns.pending'))}
                            {header('cancelled', t('productPrediction.columns.cancelled'))}
                            {header('revenue', t('productPrediction.columns.revenue'))}
                            {header('cogs', t('productPrediction.columns.cogs'))}
                            {header('grossProfit', t('productPrediction.columns.grossProfit'))}
                            {header('margin', t('productPrediction.columns.margin'))}
                            {header('avgPrice', t('productPrediction.columns.avgPrice'))}
                            {header('avgCost', t('productPrediction.columns.avgCost'))}
                            {header('projected', t('productPrediction.columns.projected'))}
                        </tr>
                    </thead>
                    <tbody>
                        {displayRows.length === 0 ? (
                            <tr><td colSpan={COLUMNS.length} style={{ textAlign: 'center', padding: '24px 10px', color: 'var(--color-text-secondary)', fontSize: 13 }}>{t('productPrediction.noMatch')}</td></tr>
                        ) : displayRows.map(renderRow)}
                    </tbody>
                    <tfoot>
                        <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                            {footCell('product', t('productPrediction.totals'))}
                            {footCell('units', totals.units || '-')}
                            {footCell('orders', totals.orders || '-')}
                            {footCell('pending', totals.pendingUnits > 0 ? `${totals.pendingUnits} · ${totals.pendingOrders}${t('productPrediction.ordersAbbrev')}` : '-', '#F59E0B')}
                            {footCell('cancelled', totals.cancelledUnits || '-', '#EF4444')}
                            {footCell('revenue', fmtMoney(totals.revenue), '#10B981')}
                            {footCell('cogs', fmtMoney(totals.cogs), '#EF4444')}
                            {footCell('grossProfit', fmtMoney(totals.grossProfit), signColor(totals.grossProfit))}
                            {footCell('margin', fmtPct(totals.margin), totals.margin === null ? undefined : signColor(totals.margin))}
                            {footCell('avgPrice', totals.avgPrice === null ? '—' : fmtMoney(totals.avgPrice))}
                            {footCell('avgCost', totals.avgCost === null ? '—' : fmtMoney(totals.avgCost))}
                            {footCell('projected', <span title={totalsProj.title}>{totalsProj.text}</span>, totalsProj.muted ? 'var(--color-text-secondary)' : signColor(totals.projection.grossProfit || 0))}
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
};

export default OverviewTable;
