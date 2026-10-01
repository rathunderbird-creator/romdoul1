// Sheet 3 — Profit & Performance Summary: one table per page (ad account) and
// one per product. Clicking a row opens the Daily tracker filtered to it.
import React from 'react';
import type { Measures, PageSummaryRow, ProductSummaryRow } from '../metrics';
import type { Translate } from '../types';
import { fill } from '../../pageIncomePrediction/format';
import { thStyle, tdNum, MoneyText, PctText, StatusChip, ACCENT } from './ui';

interface Col<R> { key: string; width: number; align?: 'left' | 'right' | 'center'; color?: string; render: (r: R) => React.ReactNode }

function SummaryTable<R extends Measures>({ title, cols, rows, totals, rowKey, onOpen, t, emptyText }: {
    title: string;
    cols: Col<R>[];
    rows: R[];
    totals: Measures;
    rowKey: (r: R) => string;
    onOpen: (r: R) => void;
    t: Translate;
    emptyText: string;
}) {
    const width = cols.reduce((s, c) => s + c.width, 0);
    return (
        <div className="glass-panel" style={{ border: '1px solid var(--color-border)', borderRadius: 16, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', fontWeight: 800, fontSize: 14, borderBottom: '1px solid var(--color-border)' }}>{title}</div>
            <div style={{ overflowX: 'auto' }}>
                <table className="spreadsheet-table" style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', width, minWidth: '100%', border: 'none' }}>
                    <colgroup>{cols.map(c => <col key={c.key} style={{ width: c.width }} />)}</colgroup>
                    <thead>
                        <tr>
                            {cols.map((c, i) => (
                                <th key={c.key} scope="col" className={i === 0 ? 'pip-sticky-first' : undefined}
                                    style={{ ...thStyle, position: i === 0 ? 'sticky' : undefined, textAlign: c.align || 'right', color: c.color || thStyle.color }}>
                                    {t(`cpaTracker.columns.${c.key}`)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && (
                            <tr><td colSpan={cols.length} style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 13 }}>{emptyText}</td></tr>
                        )}
                        {rows.map((r, idx) => (
                            <tr
                                key={rowKey(r)}
                                className="pip-row pip-row-clickable"
                                tabIndex={0}
                                title={t('cpaTracker.openInDaily')}
                                onClick={() => onOpen(r)}
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(r); } }}
                                style={{ background: idx % 2 ? 'rgba(0,0,0,0.015)' : 'transparent' }}
                            >
                                {cols.map((c, i) => (
                                    <td key={c.key} className={i === 0 ? 'pip-sticky-first' : undefined}
                                        style={i === 0
                                            ? { padding: '8px 12px', borderRight: '1px solid var(--color-border)', background: 'var(--color-surface)', overflow: 'hidden', fontWeight: 700, fontSize: 12 }
                                            : { ...tdNum, textAlign: c.align || 'right' }}>
                                        {c.render(r)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                    {rows.length > 0 && (
                        <tfoot>
                            <tr>
                                {cols.map((c, i) => (
                                    <td key={c.key} className={i === 0 ? 'pip-sticky-first' : undefined}
                                        style={i === 0
                                            ? { padding: '10px 12px', borderRight: '1px solid var(--color-border)', borderTop: '2px solid var(--color-border)', background: 'var(--color-surface)', fontWeight: 800, fontSize: 12 }
                                            : { ...tdNum, fontWeight: 700, borderTop: '2px solid var(--color-border)', textAlign: c.align || 'right' }}>
                                        {i === 0 ? t('cpaTracker.total') : c.key === 'health' || c.key === 'productStatus' || c.key === 'target' ? null : c.render(totals as R)}
                                    </td>
                                ))}
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    );
}

const nameCell = (text: string) => (
    <div className="d2-khmer" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.5 }} title={text}>{text}</div>
);

const deliveredCell = (m: Measures, t: Translate) => (
    <>
        {m.delivered.toLocaleString()}
        {m.open > 0 && <span style={{ color: '#3B82F6', fontSize: 10, marginLeft: 4 }} title={fill(t('cpaTracker.inTransitTitle'), { n: m.open })}>+{m.open}</span>}
    </>
);

export const PageSummaryTable: React.FC<{ rows: PageSummaryRow[]; totals: Measures; t: Translate; onOpen: (page: string) => void }> = ({ rows, totals, t, onOpen }) => (
    <SummaryTable<PageSummaryRow>
        title={t('cpaTracker.byPage')}
        rows={rows}
        totals={totals}
        rowKey={r => `p|${r.page}`}
        onOpen={r => onOpen(r.page)}
        t={t}
        emptyText={t('cpaTracker.emptyPeriod')}
        cols={[
            { key: 'page', width: 200, align: 'left', render: r => nameCell(r.page || t('cpaTracker.noPage')) },
            { key: 'spend', width: 110, color: '#F59E0B', render: r => <MoneyText value={r.spend} /> },
            { key: 'chats', width: 80, render: r => (r.chatsEntered ? r.chats.toLocaleString() : '-') },
            { key: 'closed', width: 80, render: r => r.closed.toLocaleString() },
            { key: 'shippedDelivered', width: 132, render: r => r.shippedDelivered.toLocaleString() },
            { key: 'delivered', width: 100, render: r => deliveredCell(r, t) },
            { key: 'revenue', width: 112, color: '#10B981', render: r => <MoneyText value={r.revenue} /> },
            { key: 'hardCosts', width: 112, color: '#EF4444', render: r => <MoneyText value={r.hardCosts} /> },
            { key: 'netProfit', width: 116, color: ACCENT, render: r => <MoneyText value={r.netProfit} signed bold /> },
            { key: 'netCpa', width: 96, render: r => <MoneyText value={r.netCpa} bold /> },
            { key: 'margin', width: 84, render: r => <PctText value={r.margin} signed /> },
            { key: 'health', width: 120, align: 'center', render: r => <StatusChip status={(r as PageSummaryRow).health} t={t} /> },
        ]}
    />
);

export const ProductSummaryTable: React.FC<{ rows: ProductSummaryRow[]; totals: Measures; t: Translate; onOpen: (productId: string) => void }> = ({ rows, totals, t, onOpen }) => (
    <SummaryTable<ProductSummaryRow>
        title={t('cpaTracker.byProduct')}
        rows={rows}
        totals={totals}
        rowKey={r => `x|${r.productId}`}
        onOpen={r => onOpen(r.productId)}
        t={t}
        emptyText={t('cpaTracker.emptyPeriod')}
        cols={[
            { key: 'product', width: 200, align: 'left', render: r => nameCell(r.productName || t('cpaTracker.unknownProduct')) },
            { key: 'shippedDelivered', width: 132, render: r => r.shippedDelivered.toLocaleString() },
            { key: 'delivered', width: 100, render: r => deliveredCell(r, t) },
            { key: 'revenue', width: 112, color: '#10B981', render: r => <MoneyText value={r.revenue} /> },
            { key: 'hardCosts', width: 112, color: '#EF4444', render: r => <MoneyText value={r.hardCosts} /> },
            { key: 'spend', width: 110, color: '#F59E0B', render: r => <MoneyText value={r.spend} /> },
            { key: 'netProfit', width: 116, color: ACCENT, render: r => <MoneyText value={r.netProfit} signed bold /> },
            { key: 'margin', width: 84, render: r => <PctText value={r.margin} signed /> },
            { key: 'netCpa', width: 96, render: r => <MoneyText value={r.netCpa} bold /> },
            { key: 'target', width: 96, render: r => <MoneyText value={(r as ProductSummaryRow).targetNetCpa} muted /> },
            { key: 'productStatus', width: 168, align: 'center', render: r => <StatusChip status={(r as ProductSummaryRow).status} t={t} /> },
        ]}
    />
);
