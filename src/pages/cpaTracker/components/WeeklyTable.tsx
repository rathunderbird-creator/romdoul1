// Sheet 4 — Weekly Summary: one row per Monday–Sunday week the range touches
// (oldest first), with closing rate and week-over-week profit change.
import React from 'react';
import type { WeekRow } from '../metrics';
import type { Translate, Language } from '../types';
import { fill } from '../../pageIncomePrediction/format';
import { parseDay } from '../../../utils/dateRange';
import { thStyle, tdNum, MoneyText, PctText, StatusChip, ACCENT } from './ui';

const COLS: { key: string; width: number; align?: 'left' | 'right' | 'center'; color?: string }[] = [
    { key: 'week', width: 190, align: 'left' },
    { key: 'spend', width: 104, color: '#F59E0B' },
    { key: 'chats', width: 80 },
    { key: 'costPerChat', width: 92 },
    { key: 'closed', width: 80 },
    { key: 'closingRate', width: 92 },
    { key: 'shippedDelivered', width: 132 },
    { key: 'delivered', width: 96 },
    { key: 'deliveryRate', width: 92 },
    { key: 'netCpa', width: 92, color: ACCENT },
    { key: 'revenue', width: 108, color: '#10B981' },
    { key: 'hardCosts', width: 108, color: '#EF4444' },
    { key: 'netProfit', width: 112, color: ACCENT },
    { key: 'margin', width: 80 },
    { key: 'profitPerOrder', width: 96 },
    { key: 'profitChange', width: 104 },
    { key: 'health', width: 112, align: 'center' },
];

const shortDate = (key: string, language: Language): string =>
    parseDay(key).toLocaleDateString(language === 'km' ? 'km-KH' : 'en-US', { day: 'numeric', month: 'short' });

const WeeklyTable: React.FC<{ weeks: WeekRow[]; t: Translate; language: Language }> = ({ weeks, t, language }) => {
    const width = COLS.reduce((s, c) => s + c.width, 0);
    const rows = [...weeks].reverse();   // newest week on top
    return (
        <div className="glass-panel" style={{ border: '1px solid var(--color-border)', borderRadius: 16, padding: 0, overflowX: 'auto' }}>
            <table className="spreadsheet-table" style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', width, minWidth: '100%', border: 'none' }}>
                <colgroup>{COLS.map(c => <col key={c.key} style={{ width: c.width }} />)}</colgroup>
                <thead>
                    <tr>
                        {COLS.map((c, i) => (
                            <th key={c.key} scope="col" className={i === 0 ? 'pip-sticky-first' : undefined}
                                style={{ ...thStyle, textAlign: c.align || 'right', color: c.color || thStyle.color }}>
                                {t(`cpaTracker.columns.${c.key}`)}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((w, idx) => (
                        <tr key={w.weekStart} className="pip-row" style={{ background: idx % 2 ? 'rgba(0,0,0,0.015)' : 'transparent' }}>
                            <td className="pip-sticky-first" style={{ padding: '8px 12px', borderRight: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                                <div style={{ fontWeight: 700, fontSize: 12 }}>
                                    {fill(t('cpaTracker.weekLabel'), { n: w.isoWeek })}
                                    {w.partial && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: '#B45309' }} title={t('cpaTracker.partialWeekTitle')}>{t('cpaTracker.partialWeek')}</span>}
                                    {w.inProgress && !w.partial && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: '#1D4ED8' }} title={t('cpaTracker.weekly.inProgressTitle')}>{t('cpaTracker.weekly.inProgress')}</span>}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{shortDate(w.weekStart, language)} – {shortDate(w.weekEnd, language)}</div>
                            </td>
                            <td style={tdNum}><MoneyText value={w.spend > 0 ? w.spend : null} /></td>
                            <td style={tdNum}>{w.chatsEntered ? w.chats.toLocaleString() : '-'}</td>
                            <td style={tdNum}><MoneyText value={w.costPerChat} /></td>
                            <td style={tdNum}>{w.closed.toLocaleString()}</td>
                            <td style={tdNum}><PctText value={w.closingRate} /></td>
                            <td style={tdNum}>{w.shippedDelivered.toLocaleString()}</td>
                            <td style={tdNum}>
                                {w.delivered.toLocaleString()}
                                {w.open > 0 && <span style={{ color: '#3B82F6', fontSize: 10, marginLeft: 4 }} title={fill(t('cpaTracker.inTransitTitle'), { n: w.open })}>+{w.open}</span>}
                            </td>
                            <td style={tdNum}><PctText value={w.deliveryRate} /></td>
                            <td style={tdNum}><MoneyText value={w.netCpa} bold /></td>
                            <td style={tdNum}><MoneyText value={w.revenue} /></td>
                            <td style={tdNum}><MoneyText value={w.hardCosts} muted /></td>
                            <td style={tdNum}><MoneyText value={w.netProfit} signed bold /></td>
                            <td style={tdNum}><PctText value={w.margin} signed /></td>
                            <td style={tdNum}><MoneyText value={w.profitPerOrder} signed /></td>
                            <td style={tdNum}><PctText value={w.profitChange} signed /></td>
                            <td style={{ ...tdNum, textAlign: 'center' }}><StatusChip status={w.health} t={t} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default WeeklyTable;
