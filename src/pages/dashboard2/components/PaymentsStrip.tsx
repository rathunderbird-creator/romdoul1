// Dashboard2 — payments strip, ported from the classic dashboard's Payment
// Status cards. One horizontal row: each payment status in the range with its
// order count and dollar total, every chip a button that opens the order list
// filtered to that pay status inside the range. After the divider sits the
// ALL-TIME "Get File" pipeline (orders whose settlement file awaits payout) —
// like the classic card it ignores the date range, and clicking it opens the
// order list with the date filter cleared so the counts always match.
import React from 'react';
import type { Translate } from '../types';
import type { PayRow, GetFilePipeline, DateRange } from '../metrics';
import type { OrderListFilters } from '../../../utils/orderListFilters';
import { D2, PAY_COLORS, tabular, fmtMoney, fmtInt } from '../theme';
import { Card, Chip } from '../ui';

export interface PaymentsStripProps {
    rows: PayRow[];                 // in-range statuses (Get File excluded)
    getFile: GetFilePipeline | null; // all-time pipeline; null = fetch failed
    range: DateRange;
    onOpenOrders: (filters: OrderListFilters) => void;
    t: Translate;
}

const buttonReset: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    margin: 0,
    padding: 0,
    font: 'inherit',
    color: 'inherit',
    whiteSpace: 'nowrap',
    flex: '0 0 auto',
    display: 'inline-flex',
    borderRadius: 999,
};

const PaymentsStrip: React.FC<PaymentsStripProps> = ({ rows, getFile, range, onOpenOrders, t }) => {
    // Pay-status name via i18n; a status without a key shows its raw name.
    const payLabel = (status: string): string => {
        const key = `dashboard2.pay.${status}`;
        const label = t(key);
        return label === key ? status : label;
    };

    const showGetFile = getFile !== null && getFile.count > 0;
    if (rows.length === 0 && !showGetFile) return null;

    const chip = (
        status: string,
        count: number,
        total: number,
        onClick: () => void,
        title: string,
    ) => (
        <button key={status} type="button" className="d2-clickable" onClick={onClick} aria-label={title} title={title} style={buttonReset}>
            <Chip dot={PAY_COLORS[status] || D2.muted} style={{ color: D2.ink }}>
                <span className="d2-khmer" style={{ lineHeight: 1.6, fontWeight: 600, color: D2.muted }}>{payLabel(status)}</span>
                <span style={{ fontWeight: 800 }}>{fmtInt(count)}</span>
                <span style={{ ...tabular, color: D2.muted }}>{fmtMoney(total)}</span>
            </Chip>
        </button>
    );

    return (
        <Card style={{ padding: '10px 14px' }}>
            {/* Same scroll/focus-ring treatment as the pipeline strip. */}
            <div
                className="d2-pipeline"
                role="group"
                aria-label={t('dashboard2.payments')}
                style={{ padding: '5px 4px', margin: '-5px -4px', minHeight: 28 }}
            >
                <span className="d2-khmer" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: D2.muted, whiteSpace: 'nowrap', flex: '0 0 auto', marginRight: 2 }}>
                    {t('dashboard2.payments')}
                </span>
                {rows.map(row => chip(
                    row.status,
                    row.count,
                    row.total,
                    () => onOpenOrders({ payStatuses: [row.status], dateRange: range }),
                    `${payLabel(row.status)}: ${fmtInt(row.count)} · ${fmtMoney(row.total)} — ${t('dashboard2.openOrderList')}`,
                ))}
                {showGetFile && (
                    <>
                        <span aria-hidden style={{ width: 1, height: 22, background: D2.border, margin: '0 6px', flex: '0 0 auto' }} />
                        {chip(
                            'Get File',
                            getFile.count,
                            getFile.total,
                            // All-time pipeline → open with the date filter cleared.
                            () => onOpenOrders({ payStatuses: ['Get File'] }),
                            `${payLabel('Get File')}: ${fmtInt(getFile.count)} · ${fmtMoney(getFile.total)} — ${t('dashboard2.getFileAllTime')}`,
                        )}
                    </>
                )}
            </div>
        </Card>
    );
};

export default PaymentsStrip;
