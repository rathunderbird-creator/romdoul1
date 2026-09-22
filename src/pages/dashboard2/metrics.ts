// Dashboard2 metric derivation — pure functions over the existing `Sale` /
// `Product` shapes (spec §3). No React, no Supabase, no Date.now() except
// where a `now` is passed in, so everything here is unit-testable.
//
// Verified 2026-09-06 against Romdoul1 for Sep 7, 2026 (spec §3 known-good):
//   orders 23 · pieces 21 · revenueBooked 678.00 · cashCollected 75.00 ·
//   outstanding 603.00 · pay Unpaid 18 / Deposit 1 / Paid 2 / Cancel 2.
// Note the spec's "23 orders" counts EVERY order in range (cancelled included)
// while revenue / cash / outstanding / pieces cover the active set only.
import type { Sale, Product } from '../../types';
import { isRevenueOrder, orderRevenue, orderCollected, orderRevenuePieces, orderBalance as sharedOrderBalance } from '../../utils/orderMoney';

export type Order = Sale;
export type DateRange = { start: string; end: string }; // YYYY-MM-DD (local days); '' = open

// ─── Order classification ─────────────────────────────────────────────────

export const PIPELINE_STAGES = ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'] as const;
export type PipelineStage = typeof PIPELINE_STAGES[number];

// Orders that no longer carry revenue. The spec names Cancelled and Returned;
// ReStock (a returned order whose goods went back on the shelf — an
// app-specific status the spec doesn't list) is treated the same way, matching
// the order list's own balance rule.
const EXCLUDED_STATUSES = new Set(['Cancelled', 'Returned', 'ReStock']);

export const orderStatusOf = (o: Order): string => o.shipping?.status || 'Pending';
export const payStatusOf = (o: Order): string => o.paymentStatus || 'Unpaid';
// "Active" = not voided — used for ORDER COUNTS (activeCount, pipeline-style
// tallies), which include Pending/Drafted/Confirmed. Money totals use the
// narrower, shared isRevenueOrder gate instead (see orderBalance below).
export const isActiveOrder = (o: Order): boolean => !EXCLUDED_STATUSES.has(orderStatusOf(o));

// Balance still owed — the exact rule Orders.tsx and Orders Management 2
// use (../../utils/orderMoney): a Deposit order always shows total minus
// deposit regardless of status; otherwise nothing is owed before dispatch
// (Pending/Drafted) or after a void.
export const orderBalance = (o: Order): number => sharedOrderBalance(o);

// Raw per-order item count, no revenue gating — callers that want "pieces
// that count toward revenue" should gate with isRevenueOrder themselves (see
// summarize/groupOrders/productRows) or use orderRevenuePieces directly.
export const orderPieces = (o: Order): number =>
    (o.items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0);

// In-house driver — legitimately has no tracking number (spec §7).
export const IN_HOUSE_COURIER = 'អ្នកដឹក';

export const isExternalCourier = (company: string | null | undefined): boolean => {
    const c = String(company || '').trim();
    return c !== '' && c !== IN_HOUSE_COURIER;
};

// Spec §7: shipped/delivered via an external courier with no tracking id.
export const isMissingTracking = (o: Order): boolean => {
    const st = orderStatusOf(o);
    if (st !== 'Shipped' && st !== 'Delivered') return false;
    if (!isExternalCourier(o.shipping?.company)) return false;
    return String(o.shipping?.trackingNumber || '').trim() === '';
};

// ─── Dates ────────────────────────────────────────────────────────────────

// Local calendar day (YYYY-MM-DD) of an ISO timestamp or a plain date string.
export const localDayOf = (v: string | null | undefined): string => {
    if (!v) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v).slice(0, 10);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const todayKey = (now: Date = new Date()): string => localDayOf(now.toISOString());

const parseDay = (key: string): Date | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

const dayKey = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const addDays = (key: string, n: number): string => {
    const d = parseDay(key);
    if (!d) return key;
    d.setDate(d.getDate() + n);
    return dayKey(d);
};

// Number of local days in a closed range; null when the range is open-ended.
export const rangeLength = (range: DateRange): number | null => {
    const a = parseDay(range.start), b = parseDay(range.end);
    if (!a || !b) return null;
    return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
};

// The equally long period immediately before `range` (spec §3
// deltaVsPrevious: yesterday for a single day, previous 7 days for a week…).
export const previousRange = (range: DateRange): DateRange | null => {
    const len = rangeLength(range);
    if (len === null) return null;
    return { start: addDays(range.start, -len), end: addDays(range.start, -1) };
};

// Every day key in a closed range, oldest first (capped to avoid runaway loops).
export const daysInRange = (range: DateRange, cap = 400): string[] => {
    const len = rangeLength(range);
    if (len === null) return [];
    const out: string[] = [];
    for (let i = 0; i < Math.min(len, cap); i++) out.push(addDays(range.start, i));
    return out;
};

// ─── KPIs ─────────────────────────────────────────────────────────────────

export interface KpiSummary {
    orderCount: number;      // every order in range (spec's "23 orders")
    activeCount: number;     // excluding Cancelled / Returned
    cancelledCount: number;  // Cancelled + Returned
    pieces: number;          // items across active orders
    revenueBooked: number;
    cashCollected: number;
    outstanding: number;
    collectionRate: number | null; // cash / revenue, null when revenue is 0
    unpaidCount: number;     // active orders with payStatus Unpaid
    depositCount: number;    // active orders with payStatus Deposit
    statusCounts: Record<string, number>;
    payCounts: Record<string, number>;
}

export const summarize = (orders: Order[]): KpiSummary => {
    const active = orders.filter(isActiveOrder);
    // Booked / collected / pieces: gated by isRevenueOrder (Confirmed, Shipped
    // or Delivered, not Cancel-paid) — the shared rule (../../utils/orderMoney)
    // that also drives Orders.tsx's desktop and mobile footers, so all three
    // never disagree again.
    const revenueBooked = orders.reduce((s, o) => s + orderRevenue(o), 0);
    const cashCollected = orders.reduce((s, o) => s + orderCollected(o), 0);
    // Outstanding sums the canonical per-order balance over EVERY order
    // (not just `active`) — the formula already zeroes Pending/Drafted/
    // cancelled orders itself, and a Deposit taken before confirmation must
    // still show as owed.
    const outstanding = orders.reduce((s, o) => s + orderBalance(o), 0);
    const statusCounts: Record<string, number> = {};
    const payCounts: Record<string, number> = {};
    for (const o of orders) {
        const st = orderStatusOf(o);
        statusCounts[st] = (statusCounts[st] || 0) + 1;
        const ps = payStatusOf(o);
        payCounts[ps] = (payCounts[ps] || 0) + 1;
    }
    return {
        orderCount: orders.length,
        activeCount: active.length,
        cancelledCount: orders.length - active.length,
        pieces: orders.reduce((s, o) => s + orderRevenuePieces(o), 0),
        revenueBooked,
        cashCollected,
        outstanding,
        collectionRate: revenueBooked > 0 ? cashCollected / revenueBooked : null,
        unpaidCount: active.filter(o => payStatusOf(o) === 'Unpaid').length,
        depositCount: active.filter(o => payStatusOf(o) === 'Deposit').length,
        statusCounts,
        payCounts,
    };
};

// (current − previous) / previous; null when there is no previous figure to
// compare against (spec §3: guard zero denominator → render "—").
export const delta = (current: number, previous: number | null | undefined): number | null => {
    if (previous === null || previous === undefined || !Number.isFinite(previous) || previous === 0) return null;
    return (current - previous) / previous;
};

// ─── Payment breakdown (ported from the classic dashboard) ────────────────

export const PAY_ORDER = ['Unpaid', 'Deposit', 'Paid', 'Cancel'];

export interface PayRow { status: string; count: number; total: number }

// Count + order-total per payment status in the range. 'Get File' is left
// out: it is a settlement pipeline (files waiting for payout), shown as an
// ALL-TIME figure fetched separately — same rule the classic dashboard uses.
export const payRows = (orders: Order[]): PayRow[] => {
    const map = new Map<string, PayRow>();
    for (const o of orders) {
        const status = payStatusOf(o);
        if (status === 'Get File') continue;
        let row = map.get(status);
        if (!row) { row = { status, count: 0, total: 0 }; map.set(status, row); }
        row.count += 1;
        row.total += Number(o.total) || 0;
    }
    return Array.from(map.values()).sort((a, b) => {
        const ia = PAY_ORDER.indexOf(a.status), ib = PAY_ORDER.indexOf(b.status);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? PAY_ORDER.length : ia) - (ib === -1 ? PAY_ORDER.length : ib);
        return a.status.localeCompare(b.status);
    });
};

// The global Get File pipeline (all orders awaiting settlement, any date).
export interface GetFilePipeline { count: number; total: number }

export const pipelineCounts = (orders: Order[]): Record<PipelineStage, number> => {
    const out = { Pending: 0, Confirmed: 0, Shipped: 0, Delivered: 0, Cancelled: 0 } as Record<PipelineStage, number>;
    for (const o of orders) {
        const st = orderStatusOf(o) as PipelineStage;
        if (st in out) out[st] += 1;
    }
    return out;
};

// Statuses outside the five pipeline stages (Drafted / Returned / ReStock), so
// nothing in the range is silently hidden.
export const otherStatusCounts = (orders: Order[]): Record<string, number> => {
    const out: Record<string, number> = {};
    const stages = new Set<string>(PIPELINE_STAGES);
    for (const o of orders) {
        const st = orderStatusOf(o);
        if (!stages.has(st)) out[st] = (out[st] || 0) + 1;
    }
    return out;
};

// ─── Chart series ─────────────────────────────────────────────────────────

export interface DayPoint { day: string; collected: number; outstanding: number; orders: number }

// One point per local day in the range (zero-filled). For an open-ended range
// the days present in the data are used instead.
export const dailySeries = (orders: Order[], range: DateRange): DayPoint[] => {
    const byDay = new Map<string, DayPoint>();
    const keys = daysInRange(range);
    for (const k of keys) byDay.set(k, { day: k, collected: 0, outstanding: 0, orders: 0 });
    for (const o of orders) {
        const k = localDayOf(o.date);
        if (!k) continue;
        if (!byDay.has(k)) {
            if (keys.length > 0) continue; // outside a closed range (shouldn't happen)
            byDay.set(k, { day: k, collected: 0, outstanding: 0, orders: 0 });
        }
        const p = byDay.get(k)!;
        p.orders += 1;
        p.collected += orderCollected(o);
        p.outstanding += orderBalance(o);
    }
    return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
};

// ─── Grouped performance rows (Salesmen / Pages / Shipping) ───────────────

export type GroupKind = 'salesman' | 'page' | 'shippingCo';

export interface GroupRow {
    key: string;              // raw value ('' for unassigned)
    label: string;            // display label
    orders: number;           // all orders in the group
    pieces: number;           // items across active orders
    revenue: number;          // active orders' totals
    cashCollected: number;
    outstanding: number;
    share: number | null;     // revenue / sum of all groups' revenue
    aov: number | null;       // revenue / active orders
    statusCounts: Record<string, number>;
    shippingCost: number;     // shipping tab
    trackable: number;        // shipped/delivered via external courier
    tracked: number;          // …of which have a tracking id
}

export const groupKeyOf = (o: Order, kind: GroupKind): string => {
    if (kind === 'salesman') return String(o.salesman || '').trim();
    if (kind === 'page') return String(o.pageSource || o.customer?.page || '').trim();
    return String(o.shipping?.company || '').trim();
};

export const UNASSIGNED_LABEL = '(unassigned)';

export const groupOrders = (orders: Order[], kind: GroupKind, statusFilter = 'All'): GroupRow[] => {
    const scoped = statusFilter === 'All' ? orders : orders.filter(o => orderStatusOf(o) === statusFilter);
    const map = new Map<string, GroupRow & { revenueOrders: number }>();
    for (const o of scoped) {
        const key = groupKeyOf(o, kind);
        let row = map.get(key);
        if (!row) {
            row = { key, label: key || UNASSIGNED_LABEL, orders: 0, pieces: 0, revenue: 0, cashCollected: 0, outstanding: 0, share: null, aov: null, statusCounts: {}, shippingCost: 0, trackable: 0, tracked: 0, revenueOrders: 0 };
            map.set(key, row);
        }
        row.orders += 1;
        const st = orderStatusOf(o);
        row.statusCounts[st] = (row.statusCounts[st] || 0) + 1;
        // Outstanding uses the canonical per-order balance unconditionally —
        // it already zeroes Pending/Drafted/cancelled orders itself, and a
        // Deposit taken before confirmation must still show as owed.
        row.outstanding += orderBalance(o);
        if (isRevenueOrder(o)) {
            row.revenueOrders += 1;
            row.pieces += orderRevenuePieces(o);
            row.revenue += orderRevenue(o);
            row.cashCollected += orderCollected(o);
            row.shippingCost += Number(o.shipping?.cost) || 0;
        }
        if ((st === 'Shipped' || st === 'Delivered') && isExternalCourier(o.shipping?.company)) {
            row.trackable += 1;
            if (String(o.shipping?.trackingNumber || '').trim() !== '') row.tracked += 1;
        }
    }
    const totalRevenue = Array.from(map.values()).reduce((s, r) => s + r.revenue, 0);
    return Array.from(map.values())
        .map(({ revenueOrders, ...r }) => ({
            ...r,
            share: totalRevenue > 0 ? r.revenue / totalRevenue : null,
            aov: revenueOrders > 0 ? r.revenue / revenueOrders : null,
        }))
        .sort((a, b) => b.revenue - a.revenue || b.orders - a.orders || a.label.localeCompare(b.label));
};

// ─── Products ─────────────────────────────────────────────────────────────

export type StockLevel = 'ok' | 'low' | 'critical';

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
export const CRITICAL_UNITS = 5;

export const thresholdOf = (p: Pick<Product, 'lowStockThreshold'>): number =>
    Number(p.lowStockThreshold) > 0 ? Number(p.lowStockThreshold) : DEFAULT_LOW_STOCK_THRESHOLD;

// Spec §4.6: red ≤ 5 units, amber ≤ 20 % of typical, green above. "Typical"
// is taken as five times the product's low-stock threshold, so the amber band
// starts exactly at the threshold the owner configured.
export const stockCapacity = (p: Pick<Product, 'stock' | 'lowStockThreshold'>): number =>
    Math.max(thresholdOf(p) * 5, Number(p.stock) || 0, 1);

export const stockLevel = (p: Pick<Product, 'stock' | 'lowStockThreshold'>): StockLevel => {
    const stock = Number(p.stock) || 0;
    if (stock <= CRITICAL_UNITS) return 'critical';
    if (stock <= thresholdOf(p)) return 'low';
    return 'ok';
};

// Products needing attention (spec §4.4), most critical first. Same gate as
// stockLevel — at/below their threshold OR inside the universal red band
// (≤ CRITICAL_UNITS, which applies even when the owner set a lower
// threshold) — so this list always contains every product the Products tab
// marks low/critical, and the attention card never disagrees with a chip.
export const lowStockProducts = (products: Product[]): Product[] =>
    products
        .filter(p => p.isActive !== false && stockLevel(p) !== 'ok')
        .sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0) || a.name.localeCompare(b.name));

export interface ProductRow {
    id: string;
    name: string;
    sold: number;             // pieces across active orders in range
    orders: number;           // active orders containing the product
    revenue: number;          // price × qty across active orders
    stock: number | null;     // null when the product is unknown to the catalogue
    threshold: number;
    capacity: number;
    level: StockLevel | null;
    // Units per order status across ALL scoped orders (cancelled included) —
    // the classic dashboard's Product Report chips. Unlike sold/revenue this
    // is not revenue-gated, so nothing in the range is silently hidden.
    statusUnits: Record<string, number>;
}

export const productRows = (orders: Order[], products: Product[], statusFilter = 'All'): ProductRow[] => {
    const catalogue = new Map(products.map(p => [p.id, p]));
    const scoped = statusFilter === 'All' ? orders : orders.filter(o => orderStatusOf(o) === statusFilter);
    const map = new Map<string, ProductRow>();
    for (const o of scoped) {
        // Every order contributes to the per-status unit chips; only revenue
        // orders (Confirmed/Shipped/Delivered, not Cancel-paid) contribute to
        // sold / revenue / order counts — the shared money rule.
        const revenue = isRevenueOrder(o);
        const st = orderStatusOf(o);
        const seen = new Set<string>();
        for (const it of o.items || []) {
            const id = String(it.id);
            const p = catalogue.get(id);
            let row = map.get(id);
            if (!row) {
                row = {
                    id,
                    name: p?.name || it.name || id,
                    sold: 0, orders: 0, revenue: 0,
                    stock: p ? Number(p.stock) || 0 : null,
                    threshold: p ? thresholdOf(p) : DEFAULT_LOW_STOCK_THRESHOLD,
                    capacity: p ? stockCapacity(p) : 1,
                    level: p ? stockLevel(p) : null,
                    statusUnits: {},
                };
                map.set(id, row);
            }
            const qty = Number(it.quantity) || 0;
            row.statusUnits[st] = (row.statusUnits[st] || 0) + qty;
            if (revenue) {
                row.sold += qty;
                row.revenue += (Number(it.price) || 0) * qty;
                if (!seen.has(id)) { seen.add(id); row.orders += 1; }
            }
        }
    }
    return Array.from(map.values()).sort((a, b) => b.sold - a.sold || b.revenue - a.revenue || a.name.localeCompare(b.name));
};

// ─── Attention items ──────────────────────────────────────────────────────

export interface PendingItem {
    order: Order;
    ageHours: number | null;
    deposit: number;
    balance: number;
}

export const pendingOrders = (orders: Order[], now: Date = new Date()): PendingItem[] =>
    orders
        .filter(o => orderStatusOf(o) === 'Pending')
        .map(o => {
            const t = new Date(o.date).getTime();
            return {
                order: o,
                ageHours: isNaN(t) ? null : Math.max(0, (now.getTime() - t) / 3600000),
                deposit: Number(o.depositAmount) || Number(o.amountReceived) || 0,
                balance: orderBalance(o),
            };
        })
        .sort((a, b) => (b.ageHours ?? 0) - (a.ageHours ?? 0));

export const missingTrackingOrders = (orders: Order[]): Order[] => orders.filter(isMissingTracking);

// Courier names present among the missing-tracking orders (for the click-through filter).
export const couriersOf = (orders: Order[]): string[] =>
    Array.from(new Set(orders.map(o => String(o.shipping?.company || '').trim()).filter(Boolean)));
