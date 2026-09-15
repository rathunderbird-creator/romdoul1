import React, { useEffect, useRef } from 'react';
import type { LedgerResult, LedgerDay, InputField } from '../metrics';
import { inputKey } from '../metrics';
import type { Translate, Language } from '../types';
import { fmtMoney, fill, weekdayShort } from '../format';
import { useColumnWidths } from '../useColumnWidths';
import EditableMoneyCell from './EditableMoneyCell';

export interface LedgerTableProps {
    ledger: LedgerResult;
    month: string;
    canEdit: boolean;
    t: Translate;
    language: Language;
    isMobile: boolean;
    savingKeys: Set<string>;       // `${date}|${page}|${field}`
    savedKeys: Set<string>;
    onCommit: (date: string, field: InputField, value: number | null) => Promise<void>;
}

const COLUMNS = ['day', 'orders', 'pending', 'revenue', 'cogs', 'shipping', 'boost', 'contribution'] as const;
type ColKey = typeof COLUMNS[number];

const DEFAULT_WIDTHS: Record<ColKey, number> = { day: 130, orders: 70, pending: 100, revenue: 120, cogs: 110, shipping: 125, boost: 125, contribution: 130 };

const HEADER_COLORS: Partial<Record<ColKey, string>> = { revenue: '#10B981', cogs: '#EF4444', shipping: '#EF4444', boost: '#F59E0B', contribution: '#8B5CF6' };

const thStyle: React.CSSProperties = {
    borderBottom: '2px solid var(--color-border)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.5px', padding: '10px 12px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap',
};

export const cellKeyOf = (date: string, page: string, field: InputField): string => `${inputKey(date, page)}|${field}`;

const LedgerTable: React.FC<LedgerTableProps> = ({ ledger, month, canEdit, t, language, isMobile, savingKeys, savedKeys, onCommit }) => {
    const { widthStyle, resizeHandle, totalWidth } = useColumnWidths('pip_ledger', DEFAULT_WIDTHS);
    const wrapRef = useRef<HTMLDivElement>(null);
    const todayRef = useRef<HTMLTableRowElement>(null);

    // Bring today into view once per page/month — scrolling the wrapper only,
    // so the window itself never jumps (and never on every save).
    useEffect(() => {
        const wrap = wrapRef.current;
        const row = todayRef.current;
        if (!wrap || !row) return;
        const top = row.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop;
        wrap.scrollTop = Math.max(0, top - wrap.clientHeight / 2);
    }, [ledger.page, month]);

    const header = (key: ColKey, label: string) => (
        <th key={key} className={key === 'day' ? 'pip-sticky-first' : undefined} scope="col" style={{ ...thStyle, ...widthStyle(key), textAlign: key === 'day' ? 'left' : key === 'orders' ? 'center' : 'right', color: HEADER_COLORS[key] || thStyle.color, background: 'var(--color-surface)' }}>
            {label}{resizeHandle(key)}
        </th>
    );

    const money = (n: number, color: string, weight = 600) => (
        <span style={{ fontWeight: weight, color: n !== 0 ? color : 'var(--color-text-secondary)' }}>{n !== 0 ? fmtMoney(n) : '-'}</span>
    );

    const renderRow = (day: LedgerDay, idx: number) => {
        const rowBg = day.isToday ? 'rgba(139, 92, 246, 0.06)' : day.isFuture ? 'rgba(0,0,0,0.01)' : idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)';
        const disabled = !canEdit || day.isFuture;
        const frozenOff = day.frozenDiff !== null && Math.abs(day.frozenDiff) >= 0.005;
        return (
            <tr
                key={day.date}
                ref={day.isToday ? todayRef : undefined}
                className="pip-row"
                style={{ background: rowBg, opacity: day.isFuture ? 0.5 : 1, borderLeft: day.isToday ? '3px solid #8B5CF6' : '3px solid transparent' }}
            >
                <td className="pip-sticky-first" style={{ ...widthStyle('day'), padding: '8px 12px', borderRight: '1px solid var(--color-border)', fontSize: 12, background: day.isToday ? 'rgba(139,92,246,0.06)' : 'var(--color-surface)', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 16, color: day.isToday ? '#8B5CF6' : day.isWeekend ? '#EF4444' : 'var(--color-text-main)', width: 24 }}>{day.dayNum}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: day.isWeekend ? '#EF4444' : 'var(--color-text-secondary)', textTransform: 'uppercase' }}>{weekdayShort(day.dow, language)}</span>
                        {day.isToday && <span style={{ fontSize: 8, fontWeight: 700, background: '#8B5CF6', color: 'white', padding: '1px 5px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('pagePrediction.today')}</span>}
                        {frozenOff && (
                            <span title={fill(t('pagePrediction.frozenDiff'), { x: fmtMoney(day.frozenDiff as number) })} style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(245,158,11,0.15)', color: '#B45309', whiteSpace: 'nowrap' }}>
                                ≠ {fmtMoney(day.frozenDiff as number)}
                            </span>
                        )}
                    </div>
                </td>
                <td style={{ ...widthStyle('orders'), textAlign: 'center', fontSize: 12, fontWeight: 600, color: day.orders > 0 ? 'var(--color-text-main)' : 'var(--color-text-secondary)', padding: 8 }}>{day.orders > 0 ? day.orders : '-'}</td>
                <td style={{ ...widthStyle('pending'), textAlign: 'right', fontSize: 12, padding: '8px 12px', color: day.pending > 0 ? '#F59E0B' : 'var(--color-text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{day.pending > 0 ? `${day.pending} · ${fmtMoney(day.pendingAmount)}` : '-'}</td>
                <td style={{ ...widthStyle('revenue'), textAlign: 'right', padding: '8px 12px', fontSize: 12 }}>{money(day.revenue, '#10B981')}</td>
                <td style={{ ...widthStyle('cogs'), textAlign: 'right', padding: '8px 12px', fontSize: 12 }}>{money(day.cogs, '#EF4444', 500)}</td>
                <EditableMoneyCell
                    value={day.shippingOverride}
                    placeholder={day.shippingComputed > 0 ? day.shippingComputed.toFixed(2) : '0'}
                    placeholderTitle={t('pagePrediction.shippingHint')}
                    disabled={disabled}
                    saving={savingKeys.has(cellKeyOf(day.date, ledger.page, 'shipping'))}
                    saved={savedKeys.has(cellKeyOf(day.date, ledger.page, 'shipping'))}
                    color="#EF4444"
                    ariaLabel={`${t('pagePrediction.columns.shipping')} ${day.date}`}
                    onCommit={v => onCommit(day.date, 'shipping', v)}
                />
                <EditableMoneyCell
                    value={day.boost > 0 ? day.boost : null}
                    disabled={disabled}
                    saving={savingKeys.has(cellKeyOf(day.date, ledger.page, 'boostPage'))}
                    saved={savedKeys.has(cellKeyOf(day.date, ledger.page, 'boostPage'))}
                    color="#F59E0B"
                    ariaLabel={`${t('pagePrediction.columns.boost')} ${day.date}`}
                    warnAbove={2000}
                    warnTitle={t('pagePrediction.highBoostWarning')}
                    onCommit={v => onCommit(day.date, 'boostPage', v)}
                />
                <td style={{ ...widthStyle('contribution'), textAlign: 'right', padding: '8px 12px', fontWeight: 700, fontSize: 13, color: day.contribution > 0.005 ? '#8B5CF6' : day.contribution < -0.005 ? '#EF4444' : 'var(--color-text-secondary)', background: day.contribution !== 0 ? `rgba(${day.contribution > 0 ? '139,92,246' : '239,68,68'},0.04)` : undefined }}>
                    {day.contribution !== 0 ? fmtMoney(day.contribution) : '-'}
                </td>
            </tr>
        );
    };

    const { totals } = ledger;
    // `bottom: auto` keeps the totals row in flow — .spreadsheet-table makes
    // every tfoot cell sticky at bottom:0, which would stack it on top of the
    // highlight row below (the one that stays pinned while scrolling).
    const footCell = (key: ColKey, content: React.ReactNode, color?: string, align: 'left' | 'center' | 'right' = 'right') => (
        <td key={key} className={key === 'day' ? 'pip-sticky-first' : undefined} style={{ ...widthStyle(key), bottom: 'auto', textAlign: align, fontWeight: 700, fontSize: 12, padding: 12, color: color || 'var(--color-text-main)', background: 'var(--color-surface)', borderRight: key === 'day' ? '1px solid var(--color-border)' : undefined }}>
            {content}
        </td>
    );
    const netColor = totals.contribution >= 0 ? '#6D28D9' : '#DC2626';
    const netBg = totals.contribution >= 0 ? 'linear-gradient(90deg, rgba(139,92,246,0.1), rgba(16,185,129,0.1))' : 'linear-gradient(90deg, rgba(239,68,68,0.1), rgba(239,68,68,0.05))';

    return (
        <div ref={wrapRef} className="glass-panel" style={{ overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 16, padding: 0, flex: isMobile ? undefined : 1, minHeight: 0, maxHeight: isMobile ? '70vh' : undefined, position: 'relative' }}>
            <table className="spreadsheet-table" style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', width: totalWidth, minWidth: '100%' }}>
                <thead>
                    <tr style={{ background: 'var(--color-surface)' }}>
                        {header('day', t('pagePrediction.columns.day'))}
                        {header('orders', t('pagePrediction.columns.orders'))}
                        {header('pending', t('pagePrediction.columns.pending'))}
                        {header('revenue', t('pagePrediction.columns.revenue'))}
                        {header('cogs', t('pagePrediction.columns.cogs'))}
                        {header('shipping', t('pagePrediction.columns.shipping'))}
                        {header('boost', t('pagePrediction.columns.boost'))}
                        {header('contribution', t('pagePrediction.columns.contribution'))}
                    </tr>
                </thead>
                <tbody>{ledger.days.map(renderRow)}</tbody>
                <tfoot>
                    <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                        {footCell('day', t('pagePrediction.totals'), undefined, 'left')}
                        {footCell('orders', totals.orders, undefined, 'center')}
                        {footCell('pending', totals.pending > 0 ? `${totals.pending} · ${fmtMoney(totals.pendingAmount)}` : '-', '#F59E0B')}
                        {footCell('revenue', fmtMoney(totals.revenue), '#10B981')}
                        {footCell('cogs', fmtMoney(totals.cogs), '#EF4444')}
                        {footCell('shipping', fmtMoney(totals.shipping), '#EF4444')}
                        {footCell('boost', fmtMoney(totals.boost), '#F59E0B')}
                        {footCell('contribution', fmtMoney(totals.contribution), netColor)}
                    </tr>
                    <tr>
                        <td colSpan={7} className="pip-sticky-first" style={{ fontWeight: 800, fontSize: 14, padding: 14, color: netColor, background: netBg, borderBottomLeftRadius: 16 }}>
                            {totals.contribution >= 0 ? '🟢' : '🔴'} {t('pagePrediction.contributionTotal')}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 800, fontSize: 17, padding: 14, color: netColor, background: netBg, borderBottomRightRadius: 16 }}>
                            {fmtMoney(totals.contribution)}
                        </td>
                    </tr>
                </tfoot>
            </table>
        </div>
    );
};

export default LedgerTable;
