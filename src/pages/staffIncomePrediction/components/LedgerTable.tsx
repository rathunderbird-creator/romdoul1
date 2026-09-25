import React, { useEffect, useRef } from 'react';
import type { LedgerResult, LedgerDay } from '../metrics';
import type { Translate, Language } from '../types';
import { fmtMoney, weekdayShort, monthShortLabel } from '../../pageIncomePrediction/format';
import { useColumnWidths } from '../../pageIncomePrediction/useColumnWidths';
import { rangeMonths, type DateRange } from '../../../utils/dateRange';

export interface LedgerTableProps {
    ledger: LedgerResult;
    range: DateRange;
    t: Translate;
    language: Language;
    isMobile: boolean;
}

const COLUMNS = ['day', 'orders', 'pending', 'revenue', 'cogs', 'grossProfit'] as const;
type ColKey = typeof COLUMNS[number];

const DEFAULT_WIDTHS: Record<ColKey, number> = { day: 130, orders: 80, pending: 120, revenue: 120, cogs: 110, grossProfit: 130 };
// A range spanning months tags each day with its month ("Sep 15"), which needs a wider Day column.
const MULTI_MONTH_WIDTHS: Record<ColKey, number> = { ...DEFAULT_WIDTHS, day: 170 };

const HEADER_COLORS: Partial<Record<ColKey, string>> = { revenue: '#10B981', cogs: '#EF4444', grossProfit: '#8B5CF6' };

const thStyle: React.CSSProperties = {
    borderBottom: '2px solid var(--color-border)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.5px', padding: '10px 12px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap',
};

// Read-only — Prediction by Staff has no manual inputs (no commission
// concept anywhere in this codebase — see metrics.ts's header comment).
const LedgerTable: React.FC<LedgerTableProps> = ({ ledger, range, t, language, isMobile }) => {
    // Day numbers repeat across months, so when the range touches more than one
    // the Day cell gets a short month tag before the number.
    const multiMonth = rangeMonths(range).length > 1;
    const { widthStyle, resizeHandle, totalWidth } = useColumnWidths('pip_staff_ledger', multiMonth ? MULTI_MONTH_WIDTHS : DEFAULT_WIDTHS);
    const wrapRef = useRef<HTMLDivElement>(null);
    const todayRef = useRef<HTMLTableRowElement>(null);

    useEffect(() => {
        const wrap = wrapRef.current;
        const row = todayRef.current;
        if (!wrap || !row) return;
        const top = row.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop;
        wrap.scrollTop = Math.max(0, top - wrap.clientHeight / 2);
    }, [ledger.staff, range.from, range.to]);

    const header = (key: ColKey, label: string) => (
        <th key={key} className={key === 'day' ? 'pip-sticky-first' : undefined} scope="col" style={{ ...thStyle, ...widthStyle(key), textAlign: key === 'day' ? 'left' : 'right', color: HEADER_COLORS[key] || thStyle.color, background: 'var(--color-surface)' }}>
            {label}{resizeHandle(key)}
        </th>
    );

    const money = (n: number, color: string, weight = 600) => (
        <span style={{ fontWeight: weight, color: n !== 0 ? color : 'var(--color-text-secondary)' }}>{n !== 0 ? fmtMoney(n) : '-'}</span>
    );

    const renderRow = (day: LedgerDay, idx: number) => {
        const rowBg = day.isToday ? 'rgba(139, 92, 246, 0.06)' : day.isFuture ? 'rgba(0,0,0,0.01)' : idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)';
        return (
            <tr
                key={day.date}
                ref={day.isToday ? todayRef : undefined}
                className="pip-row"
                style={{ background: rowBg, opacity: day.isFuture ? 0.5 : 1, borderLeft: day.isToday ? '3px solid #8B5CF6' : '3px solid transparent' }}
            >
                <td className="pip-sticky-first" style={{ ...widthStyle('day'), padding: '8px 12px', borderRight: '1px solid var(--color-border)', fontSize: 12, background: day.isToday ? 'rgba(139,92,246,0.06)' : 'var(--color-surface)', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 16, color: day.isToday ? '#8B5CF6' : day.isWeekend ? '#EF4444' : 'var(--color-text-main)', ...(multiMonth ? { whiteSpace: 'nowrap' } : { width: 24 }) }}>{multiMonth ? `${monthShortLabel(day.date, language)} ${day.dayNum}` : day.dayNum}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: day.isWeekend ? '#EF4444' : 'var(--color-text-secondary)', textTransform: 'uppercase' }}>{weekdayShort(day.dow, language)}</span>
                        {day.isToday && <span style={{ fontSize: 8, fontWeight: 700, background: '#8B5CF6', color: 'white', padding: '1px 5px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('staffPrediction.today')}</span>}
                    </div>
                </td>
                <td style={{ ...widthStyle('orders'), textAlign: 'right', fontSize: 12, fontWeight: 600, color: day.orders > 0 ? 'var(--color-text-main)' : 'var(--color-text-secondary)', padding: 8 }}>{day.orders > 0 ? day.orders : '-'}</td>
                <td style={{ ...widthStyle('pending'), textAlign: 'right', fontSize: 12, padding: '8px 12px', color: day.pending > 0 ? '#F59E0B' : 'var(--color-text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{day.pending > 0 ? `${day.pending} · ${fmtMoney(day.pendingAmount)}` : '-'}</td>
                <td style={{ ...widthStyle('revenue'), textAlign: 'right', padding: '8px 12px', fontSize: 12 }}>{money(day.revenue, '#10B981')}</td>
                <td style={{ ...widthStyle('cogs'), textAlign: 'right', padding: '8px 12px', fontSize: 12 }}>{money(day.cogs, '#EF4444', 500)}</td>
                <td style={{ ...widthStyle('grossProfit'), textAlign: 'right', padding: '8px 12px', fontWeight: 700, fontSize: 13, color: day.grossProfit > 0.005 ? '#8B5CF6' : day.grossProfit < -0.005 ? '#EF4444' : 'var(--color-text-secondary)', background: day.grossProfit !== 0 ? `rgba(${day.grossProfit > 0 ? '139,92,246' : '239,68,68'},0.04)` : undefined }}>
                    {day.grossProfit !== 0 ? fmtMoney(day.grossProfit) : '-'}
                </td>
            </tr>
        );
    };

    const { totals } = ledger;
    const footCell = (key: ColKey, content: React.ReactNode, color?: string, align: 'left' | 'right' = 'right') => (
        <td key={key} className={key === 'day' ? 'pip-sticky-first' : undefined} style={{ ...widthStyle(key), bottom: 'auto', textAlign: align, fontWeight: 700, fontSize: 12, padding: 12, color: color || 'var(--color-text-main)', background: 'var(--color-surface)', borderRight: key === 'day' ? '1px solid var(--color-border)' : undefined }}>
            {content}
        </td>
    );
    const netColor = totals.grossProfit >= 0 ? '#6D28D9' : '#DC2626';
    const netBg = totals.grossProfit >= 0 ? 'linear-gradient(90deg, rgba(139,92,246,0.1), rgba(16,185,129,0.1))' : 'linear-gradient(90deg, rgba(239,68,68,0.1), rgba(239,68,68,0.05))';

    return (
        <div ref={wrapRef} className="glass-panel" style={{ overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 16, padding: 0, flex: isMobile ? undefined : 1, minHeight: 0, maxHeight: isMobile ? '70vh' : undefined, position: 'relative' }}>
            <table className="spreadsheet-table" style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', width: totalWidth, minWidth: '100%' }}>
                <thead>
                    <tr style={{ background: 'var(--color-surface)' }}>
                        {header('day', t('staffPrediction.columns.day'))}
                        {header('orders', t('staffPrediction.columns.orders'))}
                        {header('pending', t('staffPrediction.columns.pending'))}
                        {header('revenue', t('staffPrediction.columns.revenue'))}
                        {header('cogs', t('staffPrediction.columns.cogs'))}
                        {header('grossProfit', t('staffPrediction.columns.grossProfit'))}
                    </tr>
                </thead>
                <tbody>{ledger.days.map(renderRow)}</tbody>
                <tfoot>
                    <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                        {footCell('day', t('staffPrediction.totals'), undefined, 'left')}
                        {footCell('orders', totals.orders || '-')}
                        {footCell('pending', totals.pending > 0 ? `${totals.pending} · ${fmtMoney(totals.pendingAmount)}` : '-', '#F59E0B')}
                        {footCell('revenue', fmtMoney(totals.revenue), '#10B981')}
                        {footCell('cogs', fmtMoney(totals.cogs), '#EF4444')}
                        {footCell('grossProfit', fmtMoney(totals.grossProfit), netColor)}
                    </tr>
                    <tr>
                        <td colSpan={5} className="pip-sticky-first" style={{ fontWeight: 800, fontSize: 14, padding: 14, color: netColor, background: netBg, borderBottomLeftRadius: 16 }}>
                            {totals.grossProfit >= 0 ? '🟢' : '🔴'} {t('staffPrediction.grossProfitTotal')}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 800, fontSize: 17, padding: 14, color: netColor, background: netBg, borderBottomRightRadius: 16 }}>
                            {fmtMoney(totals.grossProfit)}
                        </td>
                    </tr>
                </tfoot>
            </table>
        </div>
    );
};

export default LedgerTable;
