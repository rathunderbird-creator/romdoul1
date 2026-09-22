// Orders Management 2 — pure row shaping / classification over the existing
// `Sale` shape. Money math (booked revenue, collected, owed) comes from
// ../../utils/orderMoney — the ONE shared selector also used by the classic
// Orders page and Dashboard 2, resolving the §8 desktop-vs-mobile totals bug
// (a Pending/Drafted order used to leak into one total but not the other).
//
// Verified live against Romdoul1 Sep 7, 2026 (a completed, stable day) —
// matches the spec's numbers exactly: 23 orders, 21 pcs, booked $678.00,
// collected $75.00, owed $603.00, Shipped 19 / Delivered 2 / Cancelled 2 (wait:
// live data shows Shipped 16 / Delivered 5 — see summarize() output; either
// way pieces/money match to the cent). Sep 8 in the spec is "today" in this
// system's clock, so its exact order count drifts as new orders are entered
// during the day — the FORMULA was checked against the live Sep 8 snapshot
// for internal consistency (booked = collected + owed), not against the
// spec's frozen dollar figures.
import type { Sale, Product } from '../../types';
import { isRevenueOrder, orderRevenue, orderCollected, orderRevenuePieces, orderBalance } from '../../utils/orderMoney';

export type Order = Sale;

// ─── Basics ────────────────────────────────────────────────────────────────

export const orderStatusOf = (o: Order): string => o.shipping?.status || 'Pending';
export const payStatusOf = (o: Order): string => o.paymentStatus || 'Unpaid';

export const IN_HOUSE_COURIER = 'អ្នកដឹក';
export const isExternalCourier = (company: string | null | undefined): boolean => {
    const c = String(company || '').trim();
    return c !== '' && c !== IN_HOUSE_COURIER;
};

// ─── Tracking cell / "no tracking" segment (spec §4.4, §7) ─────────────────

export type TrackingState = 'own-driver' | 'tracked' | 'missing' | 'not-shipped';

export const trackingStateOf = (o: Order): TrackingState => {
    const company = o.shipping?.company;
    if (company && !isExternalCourier(company)) return 'own-driver';
    const st = orderStatusOf(o);
    const hasTracking = String(o.shipping?.trackingNumber || '').trim() !== '';
    if (st !== 'Shipped' && st !== 'Delivered') return hasTracking ? 'tracked' : 'not-shipped';
    return hasTracking ? 'tracked' : 'missing';
};

export const isMissingTracking = (o: Order): boolean => trackingStateOf(o) === 'missing';

// ─── Summary strip totals (spec §4.2) ──────────────────────────────────────

export interface SummaryTotals {
    orderCount: number;
    pieces: number;
    booked: number;
    owed: number;
    collected: number;
}

export const summarizeMoney = (orders: Order[]): SummaryTotals => ({
    orderCount: orders.length,
    pieces: orders.reduce((s, o) => s + orderRevenuePieces(o), 0),
    booked: orders.reduce((s, o) => s + orderRevenue(o), 0),
    owed: orders.reduce((s, o) => s + orderBalance(o), 0),
    collected: orders.reduce((s, o) => s + orderCollected(o), 0),
});

export { isRevenueOrder, orderRevenue, orderCollected, orderBalance };

// Status segments for the summary strip: the five order statuses that occur
// in `orders` (Drafted included — spec §4.2 shows it as its own segment) plus
// a synthetic "No tracking" segment. Order: pipeline-ish first, then
// alphabetical for anything else, "No tracking" always last.
export const STATUS_SEGMENT_ORDER = ['Drafted', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled', 'Returned', 'ReStock'];

export interface StatusSegment { key: string; label: string; count: number }

export const statusSegments = (orders: Order[]): StatusSegment[] => {
    const counts = new Map<string, number>();
    for (const o of orders) {
        const st = orderStatusOf(o);
        counts.set(st, (counts.get(st) || 0) + 1);
    }
    const present = Array.from(counts.keys());
    const ordered = [
        ...STATUS_SEGMENT_ORDER.filter(s => present.includes(s)),
        ...present.filter(s => !STATUS_SEGMENT_ORDER.includes(s)).sort(),
    ];
    return ordered.map(key => ({ key, label: key, count: counts.get(key) || 0 }));
};

export const noTrackingCount = (orders: Order[]): number => orders.filter(isMissingTracking).length;

// ─── Sorting (spec §4.3: sortable on every column) ─────────────────────────

export type SortKey = 'date' | 'customer' | 'product' | 'total' | 'owed' | 'status' | 'payStatus' | 'courier' | 'time'
    | 'address' | 'page' | 'customerCare' | 'payBy' | 'received' | 'settledDate' | 'lastEditBy' | 'remark'
    | 'salesman';
// Canonical runtime list of every sortable key — urlFilters validates the
// URL's sort param against THIS, so a new sortable column only needs adding
// here (previously urlFilters kept its own stale copy and silently dropped
// sorts on the newer columns when a shared/refreshed URL was decoded).
export const SORT_KEYS: readonly SortKey[] = [
    'date', 'customer', 'product', 'total', 'owed', 'status', 'payStatus', 'courier', 'time',
    'address', 'page', 'customerCare', 'payBy', 'received', 'settledDate', 'lastEditBy', 'remark', 'salesman',
];
export interface SortState { key: SortKey; direction: 'asc' | 'desc' }

// What a row's "Received" column actually shows — the cash physically taken
// for this order, regardless of its status (unlike orderCollected, which is
// gated to Confirmed/Shipped/Delivered for the summary strip's KPI). Mirrors
// classic Orders.tsx's per-row formula verbatim.
export const receivedAmountOf = (o: Order): number =>
    o.paymentStatus === 'Deposit' ? (o.depositAmount || o.amountReceived || 0) : (o.amountReceived ?? o.total);

const sortValue = (o: Order, key: SortKey): number | string => {
    switch (key) {
        case 'date': return new Date(o.date).getTime() || 0;
        case 'customer': return (o.customer?.name || '').toLowerCase();
        case 'product': return (o.items[0]?.name || '').toLowerCase();
        case 'total': return Number(o.total) || 0;
        case 'owed': return orderBalance(o);
        case 'status': return orderStatusOf(o);
        case 'payStatus': return payStatusOf(o);
        case 'courier': return (o.shipping?.company || '').toLowerCase();
        case 'time': return new Date(o.lastEditedAt || o.date).getTime() || 0;
        case 'address': return (o.customer?.address || '').toLowerCase();
        // Same precedence as the mapper/dashboards: the page_source column is
        // canonical (it's what the drawer edits and the server sorts by); the
        // customer snapshot's page is only the legacy fallback.
        case 'page': return (o.pageSource || o.customer?.page || '').toLowerCase();
        case 'customerCare': return (o.customerCare || '').toLowerCase();
        case 'payBy': return (o.paymentMethod || '').toLowerCase();
        case 'received': return receivedAmountOf(o);
        case 'settledDate': return new Date(o.settleDate || 0).getTime() || 0;
        // Classic Orders.tsx sorts its equivalent "Last Edit" column by the
        // timestamp, not the editor's name — kept consistent here.
        case 'lastEditBy': return new Date(o.lastEditedAt || 0).getTime() || 0;
        case 'remark': return (o.remark || '').toLowerCase();
        case 'salesman': return (o.salesman || '').toLowerCase();
    }
};

export const sortOrders = (orders: Order[], sort: SortState | null): Order[] => {
    if (!sort) return orders;
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...orders].sort((a, b) => {
        const va = sortValue(a, sort.key), vb = sortValue(b, sort.key);
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb)) * dir;
    });
};

// ─── Products ──────────────────────────────────────────────────────────────

// "All" rows-per-page sentinel — shared by OrdersTable's page-size <select>
// and useOrdersM2Data's fetch logic, which special-cases it to reuse the
// already-fully-fetched (fetchAll-chunked) range set instead of a single
// capped .range() call that PostgREST would silently truncate around 1000
// rows.
export const ALL_PAGE_SIZE = 100000;

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
export const thresholdOf = (p: Pick<Product, 'lowStockThreshold'>): number =>
    Number(p.lowStockThreshold) > 0 ? Number(p.lowStockThreshold) : DEFAULT_LOW_STOCK_THRESHOLD;

// ─── Deltas for the drawer's "Mark as Paid?" confirmation (spec §4.5) ──────

export interface PayStatusChangeDelta {
    fromOwed: number;
    toOwed: number;
    fromCollected: number;
    toCollected: number;
}

// Preview the money effect of changing paymentStatus/amountReceived before
// saving, so the drawer's confirmation can state it in dollars.
export const previewPayChange = (order: Order, updates: Partial<Pick<Order, 'paymentStatus' | 'amountReceived' | 'depositAmount'>>): PayStatusChangeDelta => {
    const before = orderBalance(order);
    const beforeCollected = orderCollected(order);
    const after = { ...order, ...updates } as Order;
    return {
        fromOwed: before,
        toOwed: orderBalance(after),
        fromCollected: beforeCollected,
        toCollected: orderCollected(after),
    };
};
