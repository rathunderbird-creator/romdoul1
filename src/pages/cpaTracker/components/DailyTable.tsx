// Sheet 2 — Daily Profit & CPA Tracker. One group per day (newest first); the
// group's header row carries the day's subtotal, like the workbook's
// "Subtotal" rows. Ad Spend and Chats are typed; Closed and Delivered show the
// counted orders as a grey placeholder and can be typed over (clear = back to
// the count). "+N" next to Delivered = orders still in transit.
import React from 'react';
import type { DayGroup, DailyRow, EntryField, Measures } from '../metrics';
import { entryKey } from '../metrics';
import type { Translate, Language } from '../types';
import { fill, weekdayShort, monthShortLabel } from '../../pageIncomePrediction/format';
import { parseDay } from '../../../utils/dateRange';
import { thStyle, tdNum, MoneyText, PctText, StatusChip, EditableNumberCell, ACCENT } from './ui';

export interface DailyTableProps {
    days: DayGroup[];
    totals: Measures;
    editable: boolean;
    t: Translate;
    language: Language;
    isMobile: boolean;
    savingKeys: Set<string>;
    savedKeys: Set<string>;
    onCommit: (row: DailyRow, field: EntryField, value: number | null) => Promise<void>;
}

const COLS: { key: string; width: number; align?: 'left' | 'right' | 'center'; color?: string }[] = [
    { key: 'item', width: 210, align: 'left' },
    { key: 'spend', width: 112, color: '#F59E0B' },
    { key: 'chats', width: 84 },
    { key: 'costPerChat', width: 92 },
    { key: 'closed', width: 84 },
    { key: 'grossCpa', width: 92 },
    { key: 'shippedDelivered', width: 132 },
    { key: 'delivered', width: 104 },
    { key: 'deliveryRate', width: 92 },
    { key: 'netCpa', width: 92, color: ACCENT },
    { key: 'target', width: 92 },
    { key: 'breakEven', width: 92 },
    { key: 'status', width: 128, align: 'center' },
    { key: 'revenue', width: 104, color: '#10B981' },
    { key: 'hardCosts', width: 104, color: '#EF4444' },
    { key: 'netProfit', width: 110, color: ACCENT },
    { key: 'margin', width: 80 },
    { key: 'profitPerOrder', width: 96 },
];
// On a phone the frozen first column is narrower, so a data column fits beside it.
const MOBILE_ITEM_WIDTH = 140;
const widthOf = (key: string, width: number, isMobile: boolean): number => (key === 'item' && isMobile ? MOBILE_ITEM_WIDTH : width);

export const entryCellKey = (row: Pick<DailyRow, 'date' | 'page' | 'productId'>, field: EntryField): string =>
    `${entryKey(row.date, row.page, row.productId)}|${field}`;

const dayLabel = (date: string, language: Language): string => {
    const d = parseDay(date);
    return `${weekdayShort(d.getDay(), language)} ${d.getDate()} ${monthShortLabel(date, language)}`;
};

// One summary line (a day's subtotal, or the grand total).
const SummaryCells: React.FC<{ m: Measures; t: Translate; footer?: boolean }> = ({ m, t, footer }) => {
    const style: React.CSSProperties = footer
        ? { ...tdNum, fontWeight: 700, position: 'sticky', bottom: 0, zIndex: 2, background: 'var(--color-surface)', borderTop: '2px solid var(--color-border)' }
        : { ...tdNum, fontWeight: 700 };
    return (
        <>
            <td style={style}><MoneyText value={m.spend > 0 ? m.spend : null} bold /></td>
            <td style={style}>{m.chatsEntered ? m.chats.toLocaleString() : '-'}</td>
            <td style={style}><MoneyText value={m.costPerChat} /></td>
            <td style={style}>{m.closed.toLocaleString()}</td>
            <td style={style}><MoneyText value={m.grossCpa} /></td>
            <td style={style}>{m.shippedDelivered.toLocaleString()}</td>
            <td style={style}>
                {m.delivered.toLocaleString()}
                {m.open > 0 && <span style={{ color: '#3B82F6', fontSize: 10, marginLeft: 4 }} title={fill(t('cpaTracker.inTransitTitle'), { n: m.open })}>+{m.open}</span>}
            </td>
            <td style={style}><PctText value={m.deliveryRate} /></td>
            <td style={style}><MoneyText value={m.netCpa} bold /></td>
            <td style={style} />
            <td style={style} />
            <td style={style} />
            <td style={style}><MoneyText value={m.revenue} bold /></td>
            <td style={style}><MoneyText value={m.hardCosts} /></td>
            <td style={style}><MoneyText value={m.netProfit} signed bold /></td>
            <td style={style}><PctText value={m.margin} signed /></td>
            <td style={style}><MoneyText value={m.profitPerOrder} signed /></td>
        </>
    );
};

const DailyTable: React.FC<DailyTableProps> = ({ days, totals, editable, t, language, isMobile, savingKeys, savedKeys, onCommit }) => {
    const countTitle = (n: number) => fill(t('cpaTracker.countedTitle'), { n });

    const renderRow = (row: DailyRow, idx: number) => {
        const product = row.productName || t('cpaTracker.unknownProduct');
        const page = row.page || t('cpaTracker.noPage');
        const cell = (field: EntryField, value: number | null, opts: { placeholder?: string; placeholderTitle?: string; integer?: boolean; prefix?: string; minWidth?: number; column: string }) => (
            <EditableNumberCell
                value={value}
                placeholder={opts.placeholder}
                placeholderTitle={opts.placeholderTitle}
                integer={opts.integer}
                prefix={opts.prefix}
                minWidth={opts.minWidth}
                disabled={!editable}
                saving={savingKeys.has(entryCellKey(row, field))}
                saved={savedKeys.has(entryCellKey(row, field))}
                ariaLabel={`${t(`cpaTracker.columns.${opts.column}`)} · ${product} · ${page} · ${row.date}`}
                onCommit={v => onCommit(row, field, v)}
            />
        );
        return (
            <tr key={row.key} className="pip-row" style={{ background: idx % 2 ? 'rgba(0,0,0,0.015)' : 'transparent' }}>
                <td className="pip-sticky-first" style={{ padding: '6px 12px', borderRight: '1px solid var(--color-border)', background: 'var(--color-surface)', overflow: 'hidden' }}>
                    <div className="d2-khmer" style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.5 }} title={product}>{product}</div>
                    <div className="d2-khmer" style={{ fontSize: 11, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.5 }} title={page}>{page}</div>
                </td>
                <td style={{ padding: '3px 6px' }}>{cell('adSpend', row.spend > 0 ? row.spend : null, { prefix: '$', column: 'spend' })}</td>
                <td style={{ padding: '3px 6px' }}>{cell('inboundChats', row.inboundChats, { placeholder: '-', integer: true, minWidth: 48, column: 'chats' })}</td>
                <td style={tdNum}><MoneyText value={row.costPerChat} /></td>
                <td style={{ padding: '3px 6px' }}>{cell('closedOverride', row.closedOverride, { placeholder: String(row.closedCounted), placeholderTitle: countTitle(row.closedCounted), integer: true, minWidth: 48, column: 'closed' })}</td>
                <td style={tdNum}><MoneyText value={row.grossCpa} /></td>
                <td style={tdNum}>{row.shippedDelivered.toLocaleString()}</td>
                <td style={{ padding: '3px 6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            {cell('deliveredOverride', row.deliveredOverride, { placeholder: String(row.deliveredCounted), placeholderTitle: countTitle(row.deliveredCounted), integer: true, minWidth: 44, column: 'delivered' })}
                        </div>
                        {row.open > 0 && <span style={{ color: '#3B82F6', fontSize: 10, fontWeight: 700, flexShrink: 0 }} title={fill(t('cpaTracker.inTransitTitle'), { n: row.open })}>+{row.open}</span>}
                    </div>
                </td>
                <td style={tdNum}><PctText value={row.deliveryRate} /></td>
                <td style={tdNum}><MoneyText value={row.netCpa} bold /></td>
                <td style={tdNum}><MoneyText value={row.targetNetCpa} muted /></td>
                <td style={tdNum}><MoneyText value={row.breakEvenCpa} muted /></td>
                <td style={{ ...tdNum, textAlign: 'center' }}><StatusChip status={row.status} t={t} title={t(`cpaTracker.statusHelp.${row.status}`)} /></td>
                <td style={tdNum}><MoneyText value={row.revenue} /></td>
                <td style={tdNum}><MoneyText value={row.hardCosts} muted /></td>
                <td style={tdNum}><MoneyText value={row.netProfit} signed bold /></td>
                <td style={tdNum}><PctText value={row.margin} signed /></td>
                <td style={tdNum}><MoneyText value={row.profitPerOrder} signed /></td>
            </tr>
        );
    };

    const dayHeader = (g: DayGroup) => (
        <tr key={`h-${g.date}`} style={{ background: 'rgba(139,92,246,0.07)' }}>
            <td className="pip-sticky-first" style={{ padding: '8px 12px', borderRight: '1px solid var(--color-border)', background: 'rgb(245,243,255)', fontWeight: 800, fontSize: 12, whiteSpace: 'nowrap' }}>
                {dayLabel(g.date, language)}
                <span style={{ fontWeight: 500, color: 'var(--color-text-secondary)', marginLeft: 6, fontSize: 11 }}>{fill(t('cpaTracker.rowsCount'), { n: g.rows.length })}</span>
            </td>
            <SummaryCells m={g.subtotal} t={t} />
        </tr>
    );

    return (
        <div className="glass-panel" style={{ overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 16, padding: 0, maxHeight: isMobile ? '70vh' : 'calc(100vh - 330px)', minHeight: 200, position: 'relative' }}>
            <table className="spreadsheet-table" style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', width: COLS.reduce((s, c) => s + widthOf(c.key, c.width, isMobile), 0), minWidth: '100%' }}>
                <colgroup>{COLS.map(c => <col key={c.key} style={{ width: widthOf(c.key, c.width, isMobile) }} />)}</colgroup>
                <thead>
                    <tr>
                        {COLS.map(c => {
                            const help = t(`cpaTracker.columnHelp.${c.key}`);
                            return (
                                <th key={c.key} scope="col" className={c.key === 'item' ? 'pip-sticky-first' : undefined}
                                    title={help.startsWith('cpaTracker.') ? undefined : help}
                                    style={{ ...thStyle, textAlign: c.align || 'right', color: c.color || thStyle.color }}>
                                    {t(`cpaTracker.columns.${c.key}`)}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {days.map(g => (
                        <React.Fragment key={g.date}>
                            {dayHeader(g)}
                            {g.rows.map(renderRow)}
                        </React.Fragment>
                    ))}
                </tbody>
                <tfoot>
                    <tr>
                        <td className="pip-sticky-first" style={{ padding: '10px 12px', borderRight: '1px solid var(--color-border)', borderTop: '2px solid var(--color-border)', background: 'var(--color-surface)', fontWeight: 800, fontSize: 12, position: 'sticky', bottom: 0, zIndex: 4 }}>
                            {t('cpaTracker.total')}
                        </td>
                        <SummaryCells m={totals} t={t} footer />
                    </tr>
                </tfoot>
            </table>
        </div>
    );
};

export default DailyTable;
