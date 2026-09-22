// Dashboard2 — Performance panel (spec §4.5). One card, four tabs
// (Salesmen / Pages / Shipping / Products) sharing a single order-status
// filter. Every row is a link: clicking it opens the order list pre-filtered
// to exactly that subset (spec §6.1). Derivations are injected pure helpers
// so the panel renders unchanged against fixture data.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Users } from 'lucide-react';
import type { PerformancePanelProps, PerformanceTab, Translate } from '../types';
import type { GroupRow, ProductRow } from '../metrics';
import { PIPELINE_STAGES, orderStatusOf } from '../metrics';
import type { OrderListFilters } from '../../../utils/orderListFilters';
import { D2, STATUS_COLORS, PASSIVE_OPACITY, tabular, fmtMoney, fmtPct, fmtInt } from '../theme';
import { Card, Chip, SortableTable, StatusChips, useLocalStorageState } from '../ui';
import type { Column, SortState } from '../ui';

// ─── Constants ────────────────────────────────────────────────────────────

const TABS: PerformanceTab[] = ['salesmen', 'pages', 'shipping', 'products'];

const TAB_LABEL_KEY: Record<PerformanceTab, string> = {
    salesmen: 'dashboard2.salesmen',
    pages: 'dashboard2.pages',
    shipping: 'dashboard2.shipping',
    products: 'dashboard2.products',
};

// Status chips inside rows follow the pipeline order, then anything else.
const STAGE_ORDER: string[] = [...PIPELINE_STAGES];

const tabDomId = (tab: PerformanceTab) => `d2-perf-tab-${tab}`;
const panelDomId = (tab: PerformanceTab) => `d2-perf-panel-${tab}`;

// t() returns the key itself when a translation is missing; fall back to the
// raw status name rather than showing "dashboard2.status.Foo".
const statusLabel = (t: Translate, status: string): string => {
    const key = `dashboard2.status.${status}`;
    const label = t(key);
    return label === key ? status : label;
};

// ─── Cell renderers ───────────────────────────────────────────────────────

// Money that de-emphasises a zero (tier 3) — "$0.00" is a real figure here
// (e.g. every order in the group was cancelled), but it should not compete
// with the rows that carry revenue. Unknown values render "—" via fmtMoney.
const Money: React.FC<{ value: number | null | undefined }> = ({ value }) => {
    const zero = value === 0;
    const unknown = value === null || value === undefined || !Number.isFinite(value);
    return (
        <span style={{ ...tabular, fontWeight: zero || unknown ? 500 : 600, color: zero || unknown ? D2.muted : D2.ink, opacity: zero ? PASSIVE_OPACITY : 1 }}>
            {fmtMoney(value)}
        </span>
    );
};

// "12" in bold with a small muted "9 pcs" beside it.
const OrdersCell: React.FC<{ orders: number; pieces: number; t: Translate }> = ({ orders, pieces, t }) => (
    <span style={{ ...tabular, whiteSpace: 'nowrap' }}>
        <span style={{ fontWeight: 700, color: D2.ink }}>{fmtInt(orders)}</span>
        <span style={{ fontSize: 11, color: D2.muted, marginLeft: 6, opacity: pieces === 0 ? PASSIVE_OPACITY : 1 }}>
            {fmtInt(pieces)} {t('dashboard2.pieces')}
        </span>
    </span>
);

const PassiveDash: React.FC = () => (
    <span aria-hidden style={{ color: D2.muted, opacity: PASSIVE_OPACITY }}>—</span>
);

// Shipping tab: "3/5 have tracking IDs" — red until every trackable parcel has
// an id, green once complete. Rows with nothing trackable show a passive dash.
const TrackingCell: React.FC<{ row: GroupRow; t: Translate }> = ({ row, t }) => {
    if (row.trackable === 0) return <PassiveDash />;
    const complete = row.tracked >= row.trackable;
    return (
        <Chip color={complete ? D2.green : D2.red} bg={complete ? D2.greenBg : D2.redBg}>
            {fmtInt(row.tracked)}/{fmtInt(row.trackable)} {t('dashboard2.haveTrackingIds')}
        </Chip>
    );
};

// Products tab: 64px mini bar (stock ÷ capacity), the number, and a low /
// critical chip when the level warrants one. Unknown stock → "—".
const StockCell: React.FC<{ row: ProductRow; t: Translate }> = ({ row, t }) => {
    if (row.stock === null) return <PassiveDash />;
    const ratio = Math.max(0, Math.min(1, row.stock / Math.max(row.capacity, 1)));
    const line = row.level === 'critical' ? D2.redLine : row.level === 'low' ? D2.amberLine : D2.greenLine;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
            <span aria-hidden style={{ width: 64, height: 6, borderRadius: 3, background: D2.border, overflow: 'hidden', flexShrink: 0 }}>
                <span style={{ display: 'block', width: `${ratio * 100}%`, height: '100%', borderRadius: 3, background: line }} />
            </span>
            <span style={{ ...tabular, fontWeight: 600, color: D2.ink, minWidth: 28, textAlign: 'right' }}>{fmtInt(row.stock)}</span>
            {row.level === 'low' && <Chip color={D2.amber} bg={D2.amberBg}>{t('dashboard2.low')}</Chip>}
            {row.level === 'critical' && <Chip color={D2.red} bg={D2.redBg}>{t('dashboard2.critical')}</Chip>}
        </span>
    );
};

// ─── Component ────────────────────────────────────────────────────────────

const PerformancePanel: React.FC<PerformancePanelProps> = ({
    orders, products, range, onOpenOrders, onOpenInventory, t, isMobile, groupOrders, productRows,
}) => {
    // Active tab is remembered per browser; guard against a stale stored value.
    const [storedTab, setTab] = useLocalStorageState<PerformanceTab>('d2_perf_tab', 'salesmen');
    const activeTab: PerformanceTab = TABS.includes(storedTab) ? storedTab : 'salesmen';

    // The status filter is deliberately NOT persisted — it is a question
    // about this range, not a preference.
    const [statusFilter, setStatusFilter] = useState<string>('All');

    // Statuses that actually occur in the range: pipeline order first, then
    // anything else (Drafted / Returned / ReStock…) alphabetically.
    const statusOptions = useMemo(() => {
        const present = new Set(orders.map(orderStatusOf));
        const staged: string[] = PIPELINE_STAGES.filter(s => present.has(s));
        const rest = Array.from(present)
            .filter(s => !STAGE_ORDER.includes(s))
            .sort((a, b) => a.localeCompare(b));
        return [...staged, ...rest];
    }, [orders]);

    // If the range changed and the chosen status vanished, fall back to All
    // without an effect (no extra render, no flash).
    const activeFilter = statusFilter === 'All' || statusOptions.includes(statusFilter) ? statusFilter : 'All';

    // Rows per tab (injected pure helpers).
    const salesmen = useMemo(() => groupOrders(orders, 'salesman', activeFilter), [groupOrders, orders, activeFilter]);
    const pages = useMemo(() => groupOrders(orders, 'page', activeFilter), [groupOrders, orders, activeFilter]);
    const shipping = useMemo(() => groupOrders(orders, 'shippingCo', activeFilter), [groupOrders, orders, activeFilter]);
    const prod = useMemo(() => productRows(orders, products, activeFilter), [productRows, orders, products, activeFilter]);

    const counts: Record<PerformanceTab, number> = {
        salesmen: salesmen.length,
        pages: pages.length,
        shipping: shipping.length,
        products: prod.length,
    };

    // One sort state per tab so switching tabs never loses the user's order.
    const [salesmenSort, setSalesmenSort] = useState<SortState | null>(null);
    const [pagesSort, setPagesSort] = useState<SortState | null>(null);
    const [shippingSort, setShippingSort] = useState<SortState | null>(null);
    const [productsSort, setProductsSort] = useState<SortState | null>(null);

    // Every click-through carries the status filter and the range so the
    // order list shows exactly what the row counted (spec §6.1).
    const openWith = useCallback((extra: OrderListFilters) => {
        onOpenOrders({
            ...extra,
            statuses: activeFilter === 'All' ? undefined : [activeFilter],
            dateRange: range,
        });
    }, [onOpenOrders, activeFilter, range]);

    const openLabel = t('dashboard2.openOrderList');
    const groupName = useCallback((row: GroupRow) => (row.key === '' ? t('dashboard2.unassigned') : row.label), [t]);

    // ── Column definitions ────────────────────────────────────────────────

    // Name / Orders / Status / Revenue are shared by the three grouped tabs.
    const groupColumns = useCallback((nameHeader: string): Column<GroupRow>[] => [
        {
            key: 'name',
            header: nameHeader,
            khmer: true,
            minWidth: 160,
            sortValue: row => groupName(row),
            render: row => (
                <div className="d2-label-block">
                    {row.key === ''
                        ? <span style={{ color: D2.muted, fontStyle: 'italic' }}>{t('dashboard2.unassigned')}</span>
                        : <span style={{ fontWeight: 600, color: D2.ink }}>{row.label}</span>}
                </div>
            ),
        },
        {
            key: 'orders',
            header: t('dashboard2.orders'),
            align: 'right',
            sortValue: row => row.orders,
            render: row => <OrdersCell orders={row.orders} pieces={row.pieces} t={t} />,
        },
        {
            key: 'status',
            header: t('orders.orderStatus'),
            minWidth: 180,
            render: row => <StatusChips counts={row.statusCounts} colors={STATUS_COLORS} order={STAGE_ORDER} label={s => statusLabel(t, s)} />,
        },
        {
            key: 'revenue',
            header: t('dashboard2.revenue'),
            align: 'right',
            sortValue: row => row.revenue,
            render: row => <Money value={row.revenue} />,
        },
    ], [t, groupName]);

    const salesmenColumns = useMemo<Column<GroupRow>[]>(() => [
        ...groupColumns(t('dashboard2.name')),
        {
            key: 'share',
            header: t('dashboard2.share'),
            align: 'right',
            sortValue: row => row.share,
            render: row => (
                <span style={{ ...tabular, color: row.share === null ? D2.muted : D2.ink, opacity: row.share === null || row.share === 0 ? PASSIVE_OPACITY : 1 }}>
                    {fmtPct(row.share)}
                </span>
            ),
        },
    ], [groupColumns, t]);

    const pagesColumns = useMemo<Column<GroupRow>[]>(() => [
        ...groupColumns(t('dashboard2.page')),
        {
            key: 'aov',
            header: t('dashboard2.avgOrder'),
            align: 'right',
            sortValue: row => row.aov,
            render: row => <Money value={row.aov} />,
        },
    ], [groupColumns, t]);

    const shippingColumns = useMemo<Column<GroupRow>[]>(() => [
        ...groupColumns(t('dashboard2.courier')),
        {
            key: 'cost',
            header: t('dashboard2.cost'),
            align: 'right',
            sortValue: row => row.shippingCost,
            render: row => <Money value={row.shippingCost} />,
        },
        {
            key: 'tracking',
            header: t('dashboard2.tracking'),
            minWidth: 150,
            // Ratio of tracked parcels; rows with nothing trackable sort last.
            sortValue: row => (row.trackable > 0 ? row.tracked / row.trackable : null),
            render: row => <TrackingCell row={row} t={t} />,
        },
    ], [groupColumns, t]);

    const productColumns = useMemo<Column<ProductRow>[]>(() => [
        {
            key: 'product',
            header: t('dashboard2.product'),
            khmer: true,
            minWidth: 160,
            sortValue: row => row.name,
            render: row => <div className="d2-label-block"><span style={{ fontWeight: 600, color: D2.ink }}>{row.name}</span></div>,
        },
        {
            key: 'sold',
            header: t('dashboard2.sold'),
            align: 'right',
            sortValue: row => row.sold,
            render: row => <span style={{ ...tabular, fontWeight: 700, color: D2.ink }}>{fmtInt(row.sold)}</span>,
        },
        {
            key: 'orders',
            header: t('dashboard2.orders'),
            align: 'right',
            sortValue: row => row.orders,
            render: row => <span style={tabular}>{fmtInt(row.orders)}</span>,
        },
        {
            key: 'stock',
            header: t('dashboard2.stock'),
            minWidth: 170,
            sortValue: row => row.stock,
            render: row => <StockCell row={row} t={t} />,
        },
    ], [t]);

    // ── Tab bar ───────────────────────────────────────────────────────────

    const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

    // Roving tabindex: Left/Right (and Home/End) move between tabs and focus
    // the newly active one, per the WAI-ARIA tabs pattern.
    const onTabListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const current = TABS.indexOf(activeTab);
        let next: number;
        switch (e.key) {
            case 'ArrowLeft': next = (current - 1 + TABS.length) % TABS.length; break;
            case 'ArrowRight': next = (current + 1) % TABS.length; break;
            case 'Home': next = 0; break;
            case 'End': next = TABS.length - 1; break;
            default: return;
        }
        e.preventDefault();
        setTab(TABS[next]);
        tabRefs.current[next]?.focus();
    };

    const tabStyle = (active: boolean): React.CSSProperties => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        borderRadius: 8,
        border: 'none',
        background: active ? D2.blueBg : 'transparent',
        color: active ? D2.blue : D2.muted,
        fontWeight: active ? 700 : 600,
        fontSize: isMobile ? 12 : 13,
        fontFamily: 'inherit',
        lineHeight: 1.4,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
    });

    const badgeStyle = (active: boolean, count: number): React.CSSProperties => ({
        ...tabular,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: '18px',
        minWidth: 20,
        padding: '0 7px',
        borderRadius: 10,
        textAlign: 'center',
        background: active ? D2.card : '#f1f3f6',
        color: active ? D2.blue : D2.muted,
        opacity: count === 0 ? PASSIVE_OPACITY : 1, // tier 3 for an empty tab
    });

    const captionFor = (tab: PerformanceTab) => `${t('dashboard2.performance')} — ${t(TAB_LABEL_KEY[tab])}`;

    // ── Render ────────────────────────────────────────────────────────────

    return (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
            {/* Header: title · tabs · status filter (wraps on narrow screens). */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: `1px solid ${D2.border}` }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 32 }}>
                    <Users size={16} style={{ color: D2.muted }} aria-hidden />
                    <span style={{ fontSize: 14, fontWeight: 700, color: D2.ink }}>{t('dashboard2.performance')}</span>
                </span>

                <div
                    role="tablist"
                    aria-label={t('dashboard2.performance')}
                    className="d2-tabs"
                    style={{ flex: '1 1 auto', minWidth: 0 }}
                    onKeyDown={onTabListKeyDown}
                >
                    {TABS.map((tab, i) => {
                        const active = tab === activeTab;
                        return (
                            <button
                                key={tab}
                                type="button"
                                role="tab"
                                id={tabDomId(tab)}
                                aria-selected={active}
                                aria-controls={panelDomId(tab)}
                                tabIndex={active ? 0 : -1}
                                ref={el => { tabRefs.current[i] = el; }}
                                onClick={() => setTab(tab)}
                                style={tabStyle(active)}
                            >
                                {t(TAB_LABEL_KEY[tab])}
                                <span style={badgeStyle(active, counts[tab])}>{fmtInt(counts[tab])}</span>
                            </button>
                        );
                    })}
                </div>

                <select
                    aria-label={t('dashboard2.allStatuses')}
                    title={t('dashboard2.allStatuses')}
                    value={activeFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    style={{
                        marginLeft: 'auto',
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: `1px solid ${D2.border}`,
                        background: D2.card,
                        color: D2.ink,
                        fontSize: 12,
                        fontFamily: 'inherit',
                        cursor: 'pointer',
                        maxWidth: '100%',
                    }}
                >
                    <option value="All">{t('dashboard2.allStatuses')}</option>
                    {statusOptions.map(s => (
                        <option key={s} value={s}>{statusLabel(t, s)}</option>
                    ))}
                </select>
            </div>

            {/* Only the active panel is mounted; `key` resets its scroll
                position when switching. A fixed minimum height keeps the card
                from jumping between an empty tab and a full one. */}
            <div
                key={activeTab}
                role="tabpanel"
                id={panelDomId(activeTab)}
                aria-labelledby={tabDomId(activeTab)}
                style={{ minHeight: 140 }}
            >
                {activeTab === 'salesmen' && (
                    <SortableTable<GroupRow>
                        columns={salesmenColumns}
                        rows={salesmen}
                        rowKey={row => row.key || '__unassigned'}
                        sort={salesmenSort}
                        onSort={setSalesmenSort}
                        onRowClick={row => openWith({ salesman: row.key || undefined })}
                        rowLabel={row => `${openLabel}: ${groupName(row)}`}
                        emptyText={t('dashboard2.noRows')}
                        caption={captionFor('salesmen')}
                        maxHeight={380}
                    />
                )}
                {activeTab === 'pages' && (
                    <SortableTable<GroupRow>
                        columns={pagesColumns}
                        rows={pages}
                        rowKey={row => row.key || '__unassigned'}
                        sort={pagesSort}
                        onSort={setPagesSort}
                        onRowClick={row => openWith({ pages: row.key ? [row.key] : undefined })}
                        rowLabel={row => `${openLabel}: ${groupName(row)}`}
                        emptyText={t('dashboard2.noRows')}
                        caption={captionFor('pages')}
                        maxHeight={380}
                    />
                )}
                {activeTab === 'shipping' && (
                    <SortableTable<GroupRow>
                        columns={shippingColumns}
                        rows={shipping}
                        rowKey={row => row.key || '__unassigned'}
                        sort={shippingSort}
                        onSort={setShippingSort}
                        onRowClick={row => openWith({ shippingCos: row.key ? [row.key] : undefined })}
                        rowLabel={row => `${openLabel}: ${groupName(row)}`}
                        emptyText={t('dashboard2.noRows')}
                        caption={captionFor('shipping')}
                        maxHeight={380}
                    />
                )}
                {activeTab === 'products' && (
                    <>
                        <SortableTable<ProductRow>
                            columns={productColumns}
                            rows={prod}
                            rowKey={row => row.id}
                            sort={productsSort}
                            onSort={setProductsSort}
                            // Quoted = the order list's exact-phrase item search. Unquoted,
                            // a multi-word name splits into terms ("BoomBest" OR "LN-716")
                            // and the list would show more orders than the row counted.
                            onRowClick={row => openWith({ search: `"${row.name}"` })}
                            rowLabel={row => `${openLabel}: ${row.name}`}
                            emptyText={t('dashboard2.noRows')}
                            caption={captionFor('products')}
                            maxHeight={380}
                        />
                        {/* Stock figures come from the catalogue — offer the way there. */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 14px', borderTop: `1px solid ${D2.border}` }}>
                            <button
                                type="button"
                                onClick={onOpenInventory}
                                title={t('dashboard2.openInventory')}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 6px', borderRadius: 6, border: 'none', background: 'none', color: D2.blue, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
                            >
                                {t('dashboard2.openInventory')} <ArrowUpRight size={13} aria-hidden />
                            </button>
                        </div>
                    </>
                )}
            </div>
        </Card>
    );
};

export default PerformancePanel;
