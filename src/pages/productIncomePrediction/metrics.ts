// Prediction by Product — pure metric derivation over mapped `Sale` objects.
// No React, no Supabase, no Date.now(): `now` is always passed in, so the
// dev preview (src/dev/productIncomePrediction-preview.tsx) is deterministic.
//
// The period is an arbitrary inclusive DateRange of local calendar days (see
// ../../utils/dateRange.ts) — the default and most common one is a whole
// calendar month. A sale belongs to the local calendar day of its `date`, so
// every figure is additive over any partition of the range.
//
// Unlike Prediction by Page, nothing here is a manual input — ad spend
// ("Boost") is naturally page-scoped (a campaign runs on a Page, not a SKU),
// so this screen has no writes, no new table, and no permission-gated
// editing. Everything is derived live from `sales` and the live `products`
// catalogue, exactly like ../IncomePrediction.tsx's own money rules:
//   revenue = Σ item.price × quantity, scaled per order so the order's own
//             sum equals order.total exactly (order.total already nets out
//             `discount`, which isn't attached to any one line item — see
//             bucketByProductAndDay's revenueScale), for line items on
//             orders whose shipping.status is Shipped or Delivered;
//   COGS    = Σ product.purchaseCost × quantity for the same line items
//             (unknown/deleted product → 0; discounts never apply to cost);
//   gross profit = revenue − COGS (no shipping/boost/staff — those are
//             order- and page-level overhead, already covered by the
//             classic Income Prediction page and Prediction by Page).
//
// Grouping key is the product id (../pageIncomePrediction's `cogsOf` and
// dashboard2/metrics.ts's `productRows` both already establish this
// convention), joined to the live catalogue for name/category with a
// graceful fallback to the sale item's own embedded name for a product
// since deleted from the catalogue (see productLabelOf).
//
// Status/cost helpers are genuinely generic (not page-specific) and are
// reused as-is from the sibling feature rather than duplicated; the calendar
// arithmetic comes from the shared ../../utils/dateRange.ts.
import type { Sale, Product } from '../../types';
import {
    saleDayOf, statusOf, REVENUE_STATUSES, PENDING_STATUSES, CANCELLED_STATUSES, productCostMapOf, ratio,
} from '../pageIncomePrediction/metrics';
import {
    completedWindow, dayKeyFromDate, dayKeysOfRange, dayNumberOf, inRange, parseDay, rangeLength, rangeStateOf,
    type DateRange, type RangeState,
} from '../../utils/dateRange';

export type Order = Sale;
export { saleDayOf, productCostMapOf };

// ─── Product catalogue ──────────────────────────────────────────────────────
// `products` here is expected to include DEACTIVATED products too (see
// useProductIncomeData.ts) — this map is for cost/name/category LOOKUPS,
// deliberately not filtered by isActive, so a discontinued SKU's historical
// COGS in the period is still computed correctly. Which ids count as "still
// active" (for the zero-sales "nothing moved" rows and the "deleted" badge)
// is decided separately in buildOverview.

export const productCatalogueOf = (products: Product[]): Map<string, Product> =>
    new Map(products.map(p => [p.id, p]));

// ─── Per-day flow, one bucket per (product, day) ───────────────────────────

export interface ProductDayFlow {
    units: number;
    orders: number;          // distinct revenue orders containing this product that day
    revenue: number;
    cogs: number;
    pendingUnits: number;
    pendingOrders: number;   // distinct pending/confirmed/drafted orders that day
    cancelledUnits: number;
}

const emptyFlow = (): ProductDayFlow => ({ units: 0, orders: 0, revenue: 0, cogs: 0, pendingUnits: 0, pendingOrders: 0, cancelledUnits: 0 });

// A product id genuinely missing from a line item (a custom/ad-hoc item with
// no catalogue link) buckets here instead of under a literal '' or
// 'undefined' string key.
export const UNKNOWN_PRODUCT_KEY = '';

const idOf = (it: { id?: string }): string => String(it.id || '').trim() || UNKNOWN_PRODUCT_KEY;

// product id → day → flow, for sales inside `range` only (a day is identified
// by its YYYY-MM-DD string, so a multi-month range never mixes up the 5th of
// two months). `orders`/`pendingOrders` de-dup per order (an order listing the
// same product twice as separate line items — a rare data quirk — still counts
// as one order), mirroring dashboard2/metrics.ts's productRows `seen` set.
const bucketByProductAndDay = (sales: Order[], range: DateRange, costMap: Map<string, number>): Map<string, Map<string, ProductDayFlow>> => {
    const byProduct = new Map<string, Map<string, ProductDayFlow>>();
    for (const o of sales) {
        const day = saleDayOf(o);
        if (!inRange(day, range)) continue;
        const st = statusOf(o);
        const isRevenue = REVENUE_STATUSES.has(st);
        const isPending = !isRevenue && PENDING_STATUSES.has(st);
        const isCancelled = !isRevenue && !isPending && CANCELLED_STATUSES.has(st);
        if (!isRevenue && !isPending && !isCancelled) continue;

        // An order's `total` (what ../IncomePrediction.tsx and Prediction by
        // Page both sum directly) already nets out `discount`, but that
        // discount isn't attached to any one line item — Σ item.price×qty
        // overstates revenue (and therefore gross profit/margin) by exactly
        // the discount on every discounted order. Scale every item's
        // revenue by the same ratio so per-product figures stay
        // proportional to list price while the order's own sum still equals
        // order.total exactly — this is what makes the two screens'
        // Shipped/Delivered revenue totals actually reconcile, verified
        // against live data (a real, previously-uncaught gap of ~$170-500/
        // month per instance, ~85 discounted orders each). A negative scale
        // (a negative-total order, e.g. a heavy adjustment) is left as-is —
        // clamping it to 1 would break the very invariant this exists to
        // preserve by flipping that order's sign versus the other two
        // screens, which still count the full (negative) order.total.
        let revenueScale = 1;
        // Only used when every item is priced/quantified at 0 (see below) —
        // there's no price signal left to scale by in that case.
        let flatRevenuePerItem: number | null = null;
        if (isRevenue) {
            const rawItemSum = (o.items || []).reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);
            const total = o.total || 0;
            if (rawItemSum > 0) {
                revenueScale = total / rawItemSum;
                if (!Number.isFinite(revenueScale)) revenueScale = 1; // defensive only; unreachable given rawItemSum>0 and a finite total
            } else if (total !== 0 && (o.items || []).length > 0) {
                // All items $0/0-qty but the order still carries a real total
                // (e.g. a shipping fee folded into total, or free-sample
                // items on an adjusted order) — split it evenly across line
                // items rather than silently dropping it from every
                // product's revenue (the old behavior: revenueScale stayed
                // at 1, and 1 × 0 is still 0 for every item).
                flatRevenuePerItem = total / (o.items || []).length;
            }
        }

        const seenRevenue = new Set<string>();
        const seenPending = new Set<string>();
        for (const it of (o.items || [])) {
            const id = idOf(it);
            const qty = Number(it.quantity) || 0;
            let days = byProduct.get(id);
            if (!days) { days = new Map(); byProduct.set(id, days); }
            let flow = days.get(day);
            if (!flow) { flow = emptyFlow(); days.set(day, flow); }
            if (isRevenue) {
                flow.units += qty;
                flow.revenue += flatRevenuePerItem !== null ? flatRevenuePerItem : (Number(it.price) || 0) * qty * revenueScale;
                // COGS defaults a falsy quantity to 1 unit's worth of cost —
                // matching ../IncomePrediction.tsx (`cost * (item.quantity ||
                // 1)`) and pageIncomePrediction/metrics.ts's cogsOf exactly,
                // so a bad-data zero/missing quantity can't silently zero out
                // real inventory cost and make this screen's COGS total drift
                // below the other two screens' for the same period.
                flow.cogs += (costMap.get(id) || 0) * (Number(it.quantity) || 1);
                if (!seenRevenue.has(id)) { flow.orders += 1; seenRevenue.add(id); }
            } else if (isPending) {
                flow.pendingUnits += qty;
                if (!seenPending.has(id)) { flow.pendingOrders += 1; seenPending.add(id); }
            } else {
                flow.cancelledUnits += qty;
            }
        }
    }
    return byProduct;
};

// ─── Projection ─────────────────────────────────────────────────────────────

export interface Projection {
    basis: 'run-rate' | 'actual' | 'none';
    completedDays: number;
    // Distinguishes "hasn't started yet" from "the current period, but too
    // early to extrapolate (0-2 completed days)" — both have completedDays
    // near 0, which used to be the ONLY signal the view had, so day 1 of
    // every current month was wrongly labelled "Month not started".
    isFutureRange: boolean;
    revenue: number | null;
    grossProfit: number | null;
}

interface FlowDay { date: string; revenue: number; cogs: number }

// Run-rate to the END of the range: the completed days (every day before
// today, see completedWindow) scaled by total-days / completed-days. Days are
// matched by their date string, never by day-of-month, so a range that spans
// months projects correctly.
const projectFlows = (days: FlowDay[], range: DateRange, now: Date): Projection => {
    const state = rangeStateOf(range, now);
    const cw = completedWindow(range, now);
    const sum = (rows: FlowDay[], k: keyof Omit<FlowDay, 'date'>): number => rows.reduce((s, d) => s + d[k], 0);
    if (state === 'future') return { basis: 'none', completedDays: 0, isFutureRange: true, revenue: null, grossProfit: null };
    if (state === 'past') {
        const revenue = sum(days, 'revenue');
        return { basis: 'actual', completedDays: cw.total, isFutureRange: false, revenue, grossProfit: revenue - sum(days, 'cogs') };
    }
    const completed = cw.completed;
    if (completed < 3 || cw.lastCompleted === null) return { basis: 'none', completedDays: completed, isFutureRange: false, revenue: null, grossProfit: null };
    const lastCompleted = cw.lastCompleted;
    const done = days.filter(d => d.date >= range.from && d.date <= lastCompleted);
    const scale = cw.total / completed;
    const revenue = sum(done, 'revenue') * scale;
    const cogs = sum(done, 'cogs') * scale;
    return { basis: 'run-rate', completedDays: completed, isFutureRange: false, revenue, grossProfit: revenue - cogs };
};

// ─── Ledger (one product, one range, one row per day) ──────────────────────

export interface LedgerDay {
    date: string;          // YYYY-MM-DD — the day's identity
    dayNum: number;        // day of month (1..31), display only: repeats across months in a long range
    dow: number;
    units: number;
    orders: number;
    revenue: number;
    cogs: number;
    grossProfit: number;
    pendingUnits: number;
    pendingOrders: number;
    cancelledUnits: number;
    isToday: boolean;
    isFuture: boolean;
    isWeekend: boolean;
}

export interface LedgerTotals {
    units: number;
    orders: number;
    revenue: number;
    cogs: number;
    grossProfit: number;
    pendingUnits: number;
    pendingOrders: number;
    cancelledUnits: number;
    avgPrice: number | null;
    avgCost: number | null;
}

export interface LedgerResult {
    productId: string;
    days: LedgerDay[];
    totals: LedgerTotals;
    projection: Projection;
    rangeState: RangeState;
    today: number | null;      // 1-based position of today inside the range; null unless the range contains today
    daysInRange: number;
}

export interface MetricsInput {
    sales: Order[];
    products: Product[];
    range: DateRange;
    now: Date;
}

interface Prepared {
    byProduct: Map<string, Map<string, ProductDayFlow>>;
    catalogue: Map<string, Product>;
    dayKeys: string[];
    todayKey: string;
    rangeState: RangeState;
    range: DateRange;
    now: Date;
}

const prepare = (input: MetricsInput): Prepared => {
    const costMap = productCostMapOf(input.products);
    const byProduct = bucketByProductAndDay(input.sales, input.range, costMap);
    return {
        byProduct,
        catalogue: productCatalogueOf(input.products),
        dayKeys: dayKeysOfRange(input.range),
        todayKey: dayKeyFromDate(input.now),
        rangeState: rangeStateOf(input.range, input.now),
        range: input.range,
        now: input.now,
    };
};

const totalsWithAverages = (raw: Omit<LedgerTotals, 'avgPrice' | 'avgCost'>): LedgerTotals => ({
    ...raw,
    avgPrice: raw.units > 0 ? raw.revenue / raw.units : null,
    avgCost: raw.units > 0 ? raw.cogs / raw.units : null,
});

const ledgerFor = (productId: string, p: Prepared): LedgerResult => {
    const flows = p.byProduct.get(productId) || new Map<string, ProductDayFlow>();
    const days: LedgerDay[] = p.dayKeys.map(date => {
        const flow = flows.get(date) || emptyFlow();
        // Weekday comes from the date string itself (not from month bounds),
        // and dayNum is the day of the month — display only, since it repeats
        // across the months of a long range.
        const dow = parseDay(date).getDay();
        return {
            date,
            dayNum: Number(date.slice(8, 10)),
            dow,
            units: flow.units,
            orders: flow.orders,
            revenue: flow.revenue,
            cogs: flow.cogs,
            grossProfit: flow.revenue - flow.cogs,
            pendingUnits: flow.pendingUnits,
            pendingOrders: flow.pendingOrders,
            cancelledUnits: flow.cancelledUnits,
            isToday: date === p.todayKey,
            isFuture: date > p.todayKey,
            isWeekend: dow === 0 || dow === 6,
        };
    });
    const rawTotals = days.reduce((acc, d) => {
        acc.units += d.units; acc.orders += d.orders; acc.revenue += d.revenue; acc.cogs += d.cogs;
        acc.grossProfit += d.grossProfit; acc.pendingUnits += d.pendingUnits; acc.pendingOrders += d.pendingOrders;
        acc.cancelledUnits += d.cancelledUnits;
        return acc;
    }, { units: 0, orders: 0, revenue: 0, cogs: 0, grossProfit: 0, pendingUnits: 0, pendingOrders: 0, cancelledUnits: 0 });
    const totals = totalsWithAverages(rawTotals);
    const projection = projectFlows(days, p.range, p.now);
    return {
        productId,
        days,
        totals,
        projection,
        rangeState: p.rangeState,
        today: dayNumberOf(p.range, p.now),
        daysInRange: rangeLength(p.range),
    };
};

export const buildLedger = (input: MetricsInput & { productId: string }): LedgerResult => ledgerFor(input.productId, prepare(input));

// ─── Overview (one row per product) ────────────────────────────────────────

export interface ProductRow {
    id: string;                    // '' = unknown/custom line item with no catalogue id
    name: string;                  // catalogue name, or the sale item's own embedded name as a fallback
    category: string;
    inCatalogue: boolean;          // still a live, active product
    units: number;
    orders: number;
    pendingUnits: number;
    pendingOrders: number;
    cancelledUnits: number;
    revenue: number;
    cogs: number;
    grossProfit: number;
    margin: number | null;         // grossProfit / revenue
    avgPrice: number | null;
    avgCost: number | null;
    projection: Projection;
}

export interface OverviewResult {
    rows: ProductRow[];            // gross profit desc, unknown-product bucket last
    totals: ProductRow;            // id '*'
    range: DateRange;              // the period these rows cover (summarizeRows needs it for its fallback)
    rangeState: RangeState;
    today: number | null;          // 1-based position of today inside the range; null unless the range contains today
    daysInRange: number;
    completedDays: number;
}

// The most recent embedded item name seen for a product, used only as a
// display fallback when the id no longer resolves in the live catalogue
// (the product was deleted after the sale) — never as the grouping key.
// Compares each candidate's own `date` rather than array position — `sales`
// is fetched ordered by `id` (a free-form UUID/timestamp-string primary key,
// not chronological), so scanning the array back-to-front would not
// actually find the most recently sold name.
const fallbackNameOf = (sales: Order[], range: DateRange, id: string): string | null => {
    let latestDate = '';
    let latestName: string | null = null;
    for (const o of sales) {
        if (!inRange(saleDayOf(o), range)) continue;
        const hit = (o.items || []).find(it => idOf(it) === id);
        if (!hit?.name) continue;
        if (o.date > latestDate) { latestDate = o.date; latestName = hit.name; }
    }
    return latestName;
};

const rowFromLedger = (id: string, catalogue: Map<string, Product>, sales: Order[], range: DateRange, l: LedgerResult): ProductRow => {
    const product = catalogue.get(id);
    const name = id === UNKNOWN_PRODUCT_KEY
        ? '' // labelled in the view via i18n, like the Page feature's unassigned bucket
        : (product?.name || fallbackNameOf(sales, range, id) || id);
    return {
        id,
        name,
        category: product?.category || '',
        // "Deleted"/no longer offered — a product missing from the catalogue
        // entirely, OR present but soft-deactivated (the app never hard-
        // deletes; see useProductIncomeData.ts). Cost/name lookups above
        // still use the deactivated row when present — only this flag (and
        // the UI's "deleted" badge) cares about active status.
        inCatalogue: !!product && product.isActive !== false,
        units: l.totals.units,
        orders: l.totals.orders,
        pendingUnits: l.totals.pendingUnits,
        pendingOrders: l.totals.pendingOrders,
        cancelledUnits: l.totals.cancelledUnits,
        revenue: l.totals.revenue,
        cogs: l.totals.cogs,
        grossProfit: l.totals.grossProfit,
        margin: ratio(l.totals.grossProfit, l.totals.revenue),
        avgPrice: l.totals.avgPrice,
        avgCost: l.totals.avgCost,
        projection: l.projection,
    };
};

// Sums an arbitrary row subset into one ProductRow-shaped totals object —
// used for the full overview AND (by the view, over whatever search leaves
// visible) for the footer, so "totals" always means "sum of what's shown".
// `range` is only needed for the no-rows fallback projection below (the range's
// own state and completed-day count); with rows, the projection sums theirs.
export const summarizeRows = (rows: ProductRow[], range: DateRange, now: Date): ProductRow => {
    const rangeState = rangeStateOf(range, now);
    const sum = (k: 'units' | 'orders' | 'pendingUnits' | 'pendingOrders' | 'cancelledUnits' | 'revenue' | 'cogs' | 'grossProfit'): number =>
        rows.reduce((s, r) => s + r[k], 0);
    const projSum = (k: 'revenue' | 'grossProfit'): number | null =>
        rows.length === 0 || rows.some(r => r.projection[k] === null) ? null : rows.reduce((s, r) => s + (r.projection[k] as number), 0);
    const anyProjection = rows[0]?.projection;
    const totalUnits = sum('units');
    const totalRevenue = sum('revenue');
    return {
        id: '*',
        name: '',
        category: '',
        inCatalogue: true,
        units: totalUnits,
        orders: sum('orders'),
        pendingUnits: sum('pendingUnits'),
        pendingOrders: sum('pendingOrders'),
        cancelledUnits: sum('cancelledUnits'),
        revenue: totalRevenue,
        cogs: sum('cogs'),
        grossProfit: sum('grossProfit'),
        margin: ratio(sum('grossProfit'), totalRevenue),
        avgPrice: ratio(totalRevenue, totalUnits),
        avgCost: ratio(sum('cogs'), totalUnits),
        projection: {
            basis: anyProjection?.basis ?? (rangeState === 'past' ? 'actual' : 'none'),
            completedDays: anyProjection?.completedDays ?? (rangeState === 'current' ? completedWindow(range, now).completed : 0),
            isFutureRange: anyProjection?.isFutureRange ?? (rangeState === 'future'),
            revenue: projSum('revenue'),
            grossProfit: projSum('grossProfit'),
        },
    };
};

export const buildOverview = (input: MetricsInput): OverviewResult => {
    const p = prepare(input);
    // Every ACTIVE catalogue product is shown even with zero sales in the period
    // (a "nothing moved" signal, same philosophy as Prediction by Page
    // showing a configured Page with no orders) — union'd with any product id
    // actually seen in sales, active or not (deactivated products keep
    // showing their real historical numbers for periods they did sell in;
    // p.catalogue itself includes inactive rows purely for the cost/name
    // lookups in rowFromLedger, see productCatalogueOf's comment above).
    const ids = new Set<string>();
    for (const [id, product] of p.catalogue) if (product.isActive !== false) ids.add(id);
    for (const id of p.byProduct.keys()) ids.add(id);

    const rows = Array.from(ids).map(id => rowFromLedger(id, p.catalogue, input.sales, input.range, ledgerFor(id, p)));
    rows.sort((a, b) => {
        if (a.id === UNKNOWN_PRODUCT_KEY || b.id === UNKNOWN_PRODUCT_KEY) return a.id === UNKNOWN_PRODUCT_KEY ? 1 : -1;
        if (b.grossProfit !== a.grossProfit) return b.grossProfit - a.grossProfit;
        if (b.revenue !== a.revenue) return b.revenue - a.revenue;
        return a.name.localeCompare(b.name);
    });

    return {
        rows,
        totals: summarizeRows(rows, input.range, input.now),
        range: input.range,
        rangeState: p.rangeState,
        today: dayNumberOf(input.range, input.now),
        daysInRange: rangeLength(input.range),
        completedDays: completedWindow(input.range, input.now).completed,
    };
};
