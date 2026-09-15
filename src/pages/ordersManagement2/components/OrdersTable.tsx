// Orders Management 2 — the core orders table (spec §4.3). Frozen checkbox +
// Customer columns, sortable headers, hover-reveal row actions, a max-height
// scroll container in place of virtualization (order volumes here are small
// enough that a plain scrolling <table> is the right mitigation — see the
// "known limitation" note returned with this component).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, ChevronsUpDown, Eye, Copy, Check, Printer, Flag } from 'lucide-react';
import { D2, tabular, fmtMoney, fmtInt } from '../../dashboard2/theme';
import { useLocalStorageState } from '../../dashboard2/ui';
import { MutedPill, AlertPill, ORDER_STATUS_TONE, PAY_STATUS_TONE, copyToClipboard } from '../ui2';
import { orderStatusOf, payStatusOf, trackingStateOf, orderBalance, receivedAmountOf, ALL_PAGE_SIZE, type Order, type SortState, type SortKey } from '../metrics';
import type { OM2Filters } from '../urlFilters';
import { getOperatorForPhone } from '../../../utils/telecom';
import { getPaymentLogo, getPaymentColor } from '../../../utils/payment';
import { getShippingLogo } from '../../../utils/shipping';
import { getShippingCoColor } from '../../../utils/orderUtils';

export interface OrdersTableProps {
    orders: Order[];
    totalCount: number;
    filters: OM2Filters;
    onFiltersChange: (next: OM2Filters | ((prev: OM2Filters) => OM2Filters)) => void;
    selectedIds: Set<string>;
    onSelectedIdsChange: (s: Set<string>) => void;
    onRowClick: (o: Order) => void;
    onPrintOrder: (o: Order) => void;
    visibleColumns: string[];
    columnLabels: Record<string, string>;
    sort: SortState | null;
    onSortChange: (s: SortState | null) => void;
    isMissingTracking: (o: Order) => boolean;
}

// Plain-text summary for the clipboard — the common daily need is pasting an
// order into a courier or customer chat, not a structured export.
const orderSummaryText = (o: Order): string => {
    const lines = [
        o.customer?.name || 'Unknown customer',
        o.customer?.phone || '',
        o.customer?.address || '',
        ...o.items.map(it => `${it.name} x${it.quantity}`),
        `Total: ${fmtMoney(o.total)}`,
    ];
    if (o.shipping?.trackingNumber) lines.push(`Tracking: ${o.shipping.trackingNumber}`);
    return lines.filter(Boolean).join('\n');
};

// Middle columns in their fixed display order (spec §4.3). Each key also
// happens to be a valid SortKey, so headers sort directly off it. Everything
// after 'time' is opt-in (not in DEFAULT_VISIBLE_COLUMNS) — the Columns
// picker offers them from columnLabels regardless, so they must have a slot
// here or toggling them on in the picker silently does nothing.
const MIDDLE_COLUMNS: SortKey[] = [
    'product', 'total', 'owed', 'status', 'payStatus', 'courier', 'time',
    'address', 'page', 'customerCare', 'payBy', 'received', 'settledDate', 'lastEditBy', 'remark',
    'salesman',
];
const RIGHT_ALIGNED: ReadonlySet<SortKey> = new Set(['total', 'owed', 'received']);
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250];

// Resizable columns: Customer (frozen) + every middle column. Defaults match
// the original fixed layout; dragged widths persist per browser.
const DEFAULT_COL_WIDTH: Record<string, number> = {
    customer: 190, product: 170, total: 90, owed: 90, status: 110, payStatus: 150, courier: 170, time: 90,
    address: 180, page: 120, customerCare: 130, payBy: 120, received: 90, settledDate: 120, lastEditBy: 150, remark: 180,
    salesman: 130,
};
const MIN_COL_WIDTH = 70;

// A resize handle at the right edge of a <th>. Drags update a CSS custom
// property directly (no React re-render per pixel, same trick the classic
// Orders table uses for 100+ rows) and only commit to state — which
// localStorage-persists — on mouseup.
const ResizeHandle: React.FC<{ colKey: string; onResizeStart: (e: React.MouseEvent, colKey: string) => void }> = ({ colKey, onResizeStart }) => (
    <div
        onMouseDown={e => onResizeStart(e, colKey)}
        onClick={e => e.stopPropagation()}
        role="presentation"
        aria-hidden
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 8, cursor: 'col-resize', transform: 'translateX(50%)', zIndex: 5 }}
    />
);

// ─── Sortable header cell (aria-sort lives on the <th>, not the button) ────

const SortTh: React.FC<{
    label: string;
    sortKey: SortKey;
    sort: SortState | null;
    onToggle: (key: SortKey) => void;
    align?: 'left' | 'right';
    className?: string;
    style?: React.CSSProperties;
    resizeKey?: string;
    onResizeStart?: (e: React.MouseEvent, colKey: string) => void;
}> = ({ label, sortKey, sort, onToggle, align = 'left', className, style, resizeKey, onResizeStart }) => {
    const active = sort?.key === sortKey;
    const ariaSort: 'ascending' | 'descending' | 'none' = active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none';
    // No inline `position` here — ordersManagement2.css's `.om2-table thead th`
    // already sets position:sticky (top:0), which doubles as the positioned
    // ancestor the ResizeHandle needs. An inline position:relative used to sit
    // here, and since inline styles always beat classes, it silently demoted
    // the frozen Customer column's own position:sticky (left:40px) down to
    // relative, turning its "stick at 40px when scrolled" offset into a
    // permanent rightward shift that pushed Customer on top of Product.
    return (
        <th scope="col" aria-sort={ariaSort} className={className} style={{ textAlign: align, ...style }}>
            <button
                type="button"
                onClick={() => onToggle(sortKey)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', justifyContent: align === 'right' ? 'flex-end' : 'flex-start', background: 'none', border: 'none', padding: 0, font: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit', color: active ? D2.blue : 'inherit', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                {active ? (sort!.direction === 'asc' ? <ArrowUp size={12} aria-hidden style={{ flexShrink: 0 }} /> : <ArrowDown size={12} aria-hidden style={{ flexShrink: 0 }} />) : <ChevronsUpDown size={12} aria-hidden style={{ opacity: 0.35, flexShrink: 0 }} />}
            </button>
            {resizeKey && onResizeStart && <ResizeHandle colKey={resizeKey} onResizeStart={onResizeStart} />}
        </th>
    );
};

// ─── Courier / tracking cell (spec §4.4) — merged with the standalone
// "Shipping company" column: the company row (logo + brand-colored name)
// used to duplicate between the two, and Courier/tracking already carried
// all the info Shipping company did plus the tracking number, so there's no
// reason to keep them as two separate columns. ─────────────────────────────

const CourierCell: React.FC<{ order: Order; missing: boolean }> = ({ order, missing }) => {
    const [copied, setCopied] = useState(false);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

    const state = trackingStateOf(order);
    const tracking = order.shipping?.trackingNumber || '';
    const company = order.shipping?.company || '';
    const logo = getShippingLogo(company);
    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        const ok = await copyToClipboard(tracking);
        if (!ok) return;
        setCopied(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                {logo && <img src={logo} alt="" style={{ width: 12, height: 12, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />}
                <span className="om2-khmer" style={{ fontSize: 12, color: getShippingCoColor(company), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }} title={company}>{company || '—'}</span>
            </div>
            {state === 'own-driver' && <span style={{ color: D2.muted, fontSize: 11 }}>no tracking needed</span>}
            {state === 'not-shipped' && <span style={{ color: D2.muted, fontSize: 11 }}>not shipped</span>}
            {state === 'missing' && missing && <AlertPill icon={<Flag size={11} aria-hidden />}>no tracking</AlertPill>}
            {state === 'tracked' && (
                <button
                    type="button"
                    onClick={handleCopy}
                    title="Copy tracking number"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, color: D2.blue, fontSize: 11, cursor: 'pointer', ...tabular }}
                >
                    <Copy size={11} aria-hidden />
                    {copied ? 'Copied!' : tracking}
                </button>
            )}
        </div>
    );
};

const iconButtonStyle: React.CSSProperties = {
    width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 7, border: `1px solid ${D2.border}`, background: D2.card, color: D2.muted, cursor: 'pointer',
};

const OrdersTable: React.FC<OrdersTableProps> = ({ orders, totalCount, filters, onFiltersChange, selectedIds, onSelectedIdsChange, onRowClick, onPrintOrder, visibleColumns, columnLabels, sort, onSortChange, isMissingTracking }) => {
    const wrapRef = useRef<HTMLDivElement>(null);
    const headerCheckboxRef = useRef<HTMLInputElement>(null);
    const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null);
    const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current); }, []);

    const handleCopyOrder = async (e: React.MouseEvent, order: Order) => {
        e.stopPropagation();
        const ok = await copyToClipboard(orderSummaryText(order));
        if (!ok) return;
        setCopiedOrderId(order.id);
        if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = setTimeout(() => setCopiedOrderId(null), 1500);
    };

    // Column resizing — same drag pattern as the classic Orders table
    // (../../Orders.tsx): drag updates a CSS custom property directly via
    // the DOM so 25-250 rows don't re-render per pixel, and only commits to
    // state (which persists to localStorage) on mouseup.
    const [columnWidths, setColumnWidths] = useLocalStorageState<Record<string, number>>('om2_column_widths', {});
    const resizeDragRef = useRef<{ startX: number; startWidth: number; colKey: string } | null>(null);

    const handleResizeMove = useCallback((e: MouseEvent) => {
        const drag = resizeDragRef.current;
        if (!drag) return;
        const width = Math.max(MIN_COL_WIDTH, drag.startWidth + (e.clientX - drag.startX));
        document.documentElement.style.setProperty(`--om2-col-${drag.colKey}-width`, `${width}px`);
    }, []);

    const handleResizeEnd = useCallback((e: MouseEvent) => {
        const drag = resizeDragRef.current;
        if (!drag) return;
        const width = Math.max(MIN_COL_WIDTH, drag.startWidth + (e.clientX - drag.startX));
        setColumnWidths(prev => ({ ...prev, [drag.colKey]: width }));
        document.documentElement.style.removeProperty(`--om2-col-${drag.colKey}-width`);
        resizeDragRef.current = null;
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
        document.body.style.cursor = '';
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handleResizeMove, setColumnWidths]);

    const handleResizeStart = useCallback((e: React.MouseEvent, colKey: string) => {
        e.preventDefault();
        e.stopPropagation();
        const startWidth = columnWidths[colKey] || DEFAULT_COL_WIDTH[colKey] || 150;
        resizeDragRef.current = { startX: e.clientX, startWidth, colKey };
        document.addEventListener('mousemove', handleResizeMove);
        document.addEventListener('mouseup', handleResizeEnd);
        document.body.style.cursor = 'col-resize';
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [columnWidths, handleResizeMove, handleResizeEnd]);

    // Stop dragging if the component unmounts mid-drag (e.g. navigating away).
    useEffect(() => () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
        document.body.style.cursor = '';
    }, [handleResizeMove, handleResizeEnd]);

    // width + min-width + max-width, all equal, plus overflow:hidden on the cell
    // itself: with table-layout:fixed, an unbreakable (white-space:nowrap) run of
    // text inside a cell — e.g. a long Khmer customer name — can still force that
    // column wider than its specified width despite table-layout:fixed, unless the
    // cell is pinned on every axis; a plain `width` alone (or width+min-width) is
    // just a hint the browser reshuffles once real content disagrees with it. This
    // is what was hiding the Customer/Product header text: those two columns'
    // widest cells contain the least predictable content (customer names, product
    // names), so they were the ones the browser silently overrode.
    const colWidthStyle = (key: string): React.CSSProperties => {
        const px = columnWidths[key] || DEFAULT_COL_WIDTH[key] || 150;
        const width = `var(--om2-col-${key}-width, ${px}px)`;
        return { width, minWidth: width, maxWidth: width };
    };

    // Data cells additionally need overflow:hidden on the <td> itself (not just a
    // nested span/div) — the resize handle lives on the <th>, so headers skip this
    // to keep its full hit area, but a <td>'s content (a long customer/product name)
    // is what actually forces the column wider than colWidthStyle's width if the
    // cell itself doesn't clip it.
    const colCellStyle = (key: string): React.CSSProperties => ({ ...colWidthStyle(key), overflow: 'hidden' });

    const allSelected = orders.length > 0 && orders.every(o => selectedIds.has(o.id));
    const someSelected = orders.some(o => selectedIds.has(o.id));

    useEffect(() => {
        if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = someSelected && !allSelected;
    }, [someSelected, allSelected]);

    const handleScroll = () => {
        const el = wrapRef.current;
        if (!el) return;
        el.setAttribute('data-scrolled', el.scrollLeft > 0 ? 'true' : 'false');
    };

    const toggleSelectAll = () => {
        const next = new Set(selectedIds);
        if (allSelected) orders.forEach(o => next.delete(o.id));
        else orders.forEach(o => next.add(o.id));
        onSelectedIdsChange(next);
    };

    const toggleRow = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id); else next.add(id);
        onSelectedIdsChange(next);
    };

    const toggleSort = (key: SortKey) => {
        if (!sort || sort.key !== key) onSortChange({ key, direction: 'desc' });
        else if (sort.direction === 'desc') onSortChange({ key, direction: 'asc' });
        else onSortChange(null);
    };

    const showCustomer = visibleColumns.includes('customer');
    const middleColumns = MIDDLE_COLUMNS.filter(key => visibleColumns.includes(key));
    const showActions = visibleColumns.includes('actions');

    const from = totalCount === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
    const to = Math.min(filters.page * filters.pageSize, totalCount);
    const canPrev = filters.page > 1;
    const canNext = filters.page * filters.pageSize < totalCount;
    const totalPages = Math.max(1, Math.ceil(totalCount / filters.pageSize));

    const setPage = (page: number) => onFiltersChange(prev => ({ ...prev, page }));
    const setPageSize = (pageSize: number) => onFiltersChange(prev => ({ ...prev, pageSize, page: 1 }));

    return (
        <div>
            <div
                ref={wrapRef}
                className="om2-table-wrap"
                data-scrolled="false"
                onScroll={handleScroll}
                style={{ background: D2.card, border: `1px solid ${D2.border}`, borderRadius: D2.radius, maxHeight: 'calc(var(--vh-full) - 260px)' }}
            >
                <table className="om2-table" style={{ tableLayout: 'fixed' }}>
                    <thead>
                        <tr>
                            <th scope="col" className="om2-col-frozen-1" style={{ width: 40, minWidth: 40, maxWidth: 40 }}>
                                <input
                                    ref={headerCheckboxRef}
                                    type="checkbox"
                                    checked={allSelected}
                                    onChange={toggleSelectAll}
                                    aria-label="Select all orders on this page"
                                />
                            </th>
                            {showCustomer && (
                                <SortTh
                                    label={columnLabels.customer || 'Customer'}
                                    sortKey="customer"
                                    sort={sort}
                                    onToggle={toggleSort}
                                    style={colWidthStyle('customer')}
                                    resizeKey="customer"
                                    onResizeStart={handleResizeStart}
                                />
                            )}
                            {middleColumns.map(key => (
                                <SortTh
                                    key={key}
                                    label={columnLabels[key] || key}
                                    sortKey={key}
                                    sort={sort}
                                    onToggle={toggleSort}
                                    align={RIGHT_ALIGNED.has(key) ? 'right' : 'left'}
                                    style={colWidthStyle(key)}
                                    resizeKey={key}
                                    onResizeStart={handleResizeStart}
                                />
                            ))}
                            {showActions && (
                                <th scope="col" style={{ width: 90, minWidth: 90, maxWidth: 90, textAlign: 'right' }}>Actions</th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {orders.map(order => {
                            const name = order.customer?.name || 'Unknown customer';
                            const operator = getOperatorForPhone(order.customer?.phone);
                            const missing = isMissingTracking(order);
                            const status = orderStatusOf(order);
                            const pay = payStatusOf(order);
                            const item = order.items[0];
                            const extraItems = order.items.length - 1;
                            const balance = orderBalance(order);
                            const timestamp = order.lastEditedAt || order.date;
                            const timeDate = new Date(timestamp);
                            const selected = selectedIds.has(order.id);
                            return (
                                <tr
                                    key={order.id}
                                    className={`om2-row om2-row-clickable${selected ? ' om2-row-selected' : ''}`}
                                    title={`${name} — ${fmtMoney(order.total)}`}
                                    onClick={() => onRowClick(order)}
                                >
                                    <td className="om2-col-frozen-1" onClick={e => e.stopPropagation()} style={{ width: 40, minWidth: 40, maxWidth: 40, overflow: 'hidden' }}>
                                        <input
                                            type="checkbox"
                                            checked={selected}
                                            onClick={e => e.stopPropagation()}
                                            onChange={() => toggleRow(order.id)}
                                            aria-label={`Select order for ${name}`}
                                        />
                                    </td>
                                    {showCustomer && (
                                        <td style={colCellStyle('customer')}>
                                            <button
                                                type="button"
                                                onClick={() => onRowClick(order)}
                                                aria-label={`Open order details for ${name}`}
                                                style={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer' }}
                                            >
                                                <div className="om2-khmer" title={name} style={{ fontSize: 13, fontWeight: 600, color: D2.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{name}</div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: D2.muted, overflow: 'hidden' }}>
                                                    {operator?.logo && <img src={operator.logo} alt={operator.name} title={operator.name} style={{ width: 12, height: 12, objectFit: 'contain', borderRadius: 2, flexShrink: 0 }} />}
                                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.customer?.phone || '—'}</span>
                                                </div>
                                            </button>
                                        </td>
                                    )}
                                    {middleColumns.map(key => {
                                        switch (key) {
                                            case 'product':
                                                return (
                                                    <td key={key} style={colCellStyle(key)}>
                                                        {item ? (
                                                            <>
                                                                <div style={{ fontSize: 13, color: D2.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}{extraItems > 0 ? ` +${extraItems} more` : ''}</div>
                                                                <div style={{ fontSize: 11, color: D2.muted }}>{'×'} {item.quantity}</div>
                                                            </>
                                                        ) : <span style={{ color: D2.muted }}>—</span>}
                                                    </td>
                                                );
                                            case 'total':
                                                return <td key={key} style={{ textAlign: 'right', ...tabular, ...colCellStyle(key) }}>{fmtMoney(order.total)}</td>;
                                            case 'owed':
                                                return (
                                                    <td key={key} style={{ textAlign: 'right', ...tabular, ...colCellStyle(key) }}>
                                                        {balance > 0
                                                            ? <span style={{ color: D2.amber, fontWeight: 700 }}>{fmtMoney(balance)}</span>
                                                            : <span style={{ color: D2.muted }}>—</span>}
                                                    </td>
                                                );
                                            case 'status':
                                                return <td key={key} style={colCellStyle(key)}><MutedPill tone={ORDER_STATUS_TONE[status] || 'neutral'}>{status}</MutedPill></td>;
                                            case 'payStatus':
                                                return (
                                                    <td key={key} style={colCellStyle(key)}>
                                                        <MutedPill tone={PAY_STATUS_TONE[pay] || 'neutral'}>
                                                            {pay === 'Deposit' ? `Deposit ${fmtMoney(order.depositAmount || order.amountReceived || 0)}` : pay}
                                                        </MutedPill>
                                                    </td>
                                                );
                                            case 'courier':
                                                return <td key={key} style={colCellStyle(key)}><CourierCell order={order} missing={missing} /></td>;
                                            case 'time':
                                                return (
                                                    <td key={key} style={{ ...tabular, ...colCellStyle(key) }} title={timeDate.toLocaleString()}>
                                                        {timeDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                                    </td>
                                                );
                                            case 'address':
                                                return (
                                                    <td key={key} className="om2-khmer" style={{ ...colCellStyle(key), textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={order.customer?.address || ''}>
                                                        {order.customer?.address || <span style={{ color: D2.muted }}>—</span>}
                                                    </td>
                                                );
                                            case 'page':
                                                return <td key={key} style={{ ...colCellStyle(key), textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.customer?.page || <span style={{ color: D2.muted }}>—</span>}</td>;
                                            case 'customerCare':
                                                return <td key={key} style={{ ...colCellStyle(key), textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.customerCare || <span style={{ color: D2.muted }}>—</span>}</td>;
                                            case 'payBy': {
                                                const logo = getPaymentLogo(order.paymentMethod);
                                                return (
                                                    <td key={key} style={colCellStyle(key)}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                                                            {logo && <img src={logo} alt="" style={{ width: 14, height: 14, borderRadius: 2, objectFit: 'contain', flexShrink: 0 }} />}
                                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: getPaymentColor(order.paymentMethod) }}>{order.paymentMethod || '—'}</span>
                                                        </div>
                                                    </td>
                                                );
                                            }
                                            case 'received':
                                                return (
                                                    <td key={key} style={{ textAlign: 'right', ...tabular, ...colCellStyle(key), color: (pay === 'Paid' || pay === 'Deposit') ? D2.blue : D2.red, fontWeight: 700 }}>
                                                        {fmtMoney(receivedAmountOf(order))}
                                                    </td>
                                                );
                                            case 'settledDate':
                                                return <td key={key} style={{ ...tabular, ...colCellStyle(key) }}>{order.settleDate ? new Date(order.settleDate).toLocaleDateString() : <span style={{ color: D2.muted }}>—</span>}</td>;
                                            case 'lastEditBy':
                                                return (
                                                    <td key={key} style={colCellStyle(key)}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
                                                            <span style={{ fontSize: 12, color: D2.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.lastEditedBy || <span style={{ color: D2.muted }}>—</span>}</span>
                                                            {order.lastEditedAt && <span style={{ fontSize: 11, color: D2.muted, ...tabular }}>{new Date(order.lastEditedAt).toLocaleString()}</span>}
                                                        </div>
                                                    </td>
                                                );
                                            case 'remark':
                                                return (
                                                    <td key={key} className="om2-khmer" style={{ ...colCellStyle(key), textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={order.remark || ''}>
                                                        {order.remark || <span style={{ color: D2.muted }}>—</span>}
                                                    </td>
                                                );
                                            case 'salesman':
                                                return <td key={key} style={{ ...colCellStyle(key), textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.salesman || <span style={{ color: D2.muted }}>—</span>}</td>;
                                            default:
                                                return null;
                                        }
                                    })}
                                    {showActions && (
                                        <td onClick={e => e.stopPropagation()} style={{ textAlign: 'right', width: 90, minWidth: 90, maxWidth: 90, overflow: 'hidden' }}>
                                            <div style={{ display: 'inline-flex', gap: 4 }}>
                                                <button type="button" className="om2-row-actions" style={iconButtonStyle} onClick={e => { e.stopPropagation(); onRowClick(order); }} aria-label={`View order for ${name}`} title="View">
                                                    <Eye size={14} />
                                                </button>
                                                <button
                                                    type="button"
                                                    className="om2-row-actions"
                                                    style={{ ...iconButtonStyle, color: copiedOrderId === order.id ? D2.green : iconButtonStyle.color }}
                                                    onClick={e => handleCopyOrder(e, order)}
                                                    aria-label={`Copy order summary for ${name}`}
                                                    title={copiedOrderId === order.id ? 'Copied!' : 'Copy order summary'}
                                                >
                                                    {copiedOrderId === order.id ? <Check size={14} /> : <Copy size={14} />}
                                                </button>
                                                <button type="button" className="om2-row-actions" style={iconButtonStyle} onClick={e => { e.stopPropagation(); onPrintOrder(order); }} aria-label={`Print receipt for ${name}`} title="Print receipt">
                                                    <Printer size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, padding: '10px 4px 0', fontSize: 12, color: D2.muted }}>
                <span style={tabular}>Showing {from}-{to} of {fmtInt(totalCount)}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        Rows per page
                        <select
                            value={filters.pageSize}
                            onChange={e => setPageSize(Number(e.target.value))}
                            style={{ padding: '4px 8px', borderRadius: 7, border: `1px solid ${D2.border}`, background: D2.card, color: D2.ink, fontSize: 12 }}
                        >
                            {PAGE_SIZE_OPTIONS.map(size => <option key={size} value={size}>{size}</option>)}
                            <option value={ALL_PAGE_SIZE}>All</option>
                        </select>
                    </label>
                    <button
                        type="button"
                        onClick={() => setPage(filters.page - 1)}
                        disabled={!canPrev}
                        style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${D2.border}`, background: D2.card, color: canPrev ? D2.ink : D2.muted, cursor: canPrev ? 'pointer' : 'default', opacity: canPrev ? 1 : 0.5 }}
                    >
                        Prev
                    </button>
                    <span style={tabular}>
                        Page <span style={{ color: D2.ink, fontWeight: 600 }}>{fmtInt(Math.min(filters.page, totalPages))}</span> of {fmtInt(totalPages)}
                    </span>
                    <button
                        type="button"
                        onClick={() => setPage(filters.page + 1)}
                        disabled={!canNext}
                        style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${D2.border}`, background: D2.card, color: canNext ? D2.ink : D2.muted, cursor: canNext ? 'pointer' : 'default', opacity: canNext ? 1 : 0.5 }}
                    >
                        Next
                    </button>
                </div>
            </div>
        </div>
    );
};

export default OrdersTable;
