// Prediction by Page — pure metric derivation over mapped `Sale` objects.
// No React, no Supabase, no Date.now(): `now` is always passed in, so the
// dev preview (src/dev/pageIncomePrediction-preview.tsx) is deterministic.
//
// Money rules mirror ../IncomePrediction.tsx (lines 229-241) exactly, so the
// sum over pages reconciles with that page's live totals:
//   revenue  = order.total for orders whose shipping.status is Shipped or
//              Delivered (payment status is irrelevant);
//   COGS     = Σ product.purchaseCost × quantity (unknown product → 0);
//   shipping = shippingRates[shipping.company || 'Unassigned'] per order,
//              unless the (date, page) input row overrides the day's total.
// Boost (ad spend) is a manual per-(date, page) input. Staff is deliberately
// NOT a per-page figure — it is shared overhead, read from income_predictions
// and shown once under the overview totals — so the per-page bottom line is
// called "contribution", never "profit".
//
// Dates are browser-local (the business and its staff run in UTC+7), exactly
// as the sibling page: the range's bounds are local-midnight instants and a
// sale belongs to the local calendar day of its `date`. The screen shows an
// inclusive DateRange of days (default: the current calendar month; up to
// MAX_RANGE_DAYS, possibly spanning months) — every figure here is a sum over
// the days of that range, so it is additive over any split of the range.
// TODO: derive from config.timezone when both pages switch together.
import type { Sale, Product } from '../../types';
import { groupKeyOf } from '../dashboard2/metrics';
import { roundCents } from '../../utils/money';
import {
    inRange, dayKeysOfRange, rangeLength, rangeStateOf, completedWindow, dayNumberOf, parseDay,
    type DateRange, type RangeState,
} from '../../utils/dateRange';

export type Order = Sale;

// ─── Calendar helpers ─────────────────────────────────────────────────────

// Month-based helpers: this screen itself now works in DateRanges (see
// ../../utils/dateRange) and no longer uses monthBounds / addMonths /
// dayKeysOfMonth / monthStateOf. They are still exported because
// ../productIncomePrediction/metrics.ts and ../staffIncomePrediction/metrics.ts
// import them from here.
const pad2 = (n: number): string => String(n).padStart(2, '0');

export const monthKeyOf = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
export const dayKeyOf = (d: Date): string => `${monthKeyOf(d)}-${pad2(d.getDate())}`;
export const isMonthKey = (s: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export interface MonthBounds {
    year: number;
    monthIdx: number;      // 0-based
    daysInMonth: number;
    startIso: string;      // local midnight of the 1st, as an instant
    endIso: string;        // local midnight of the NEXT month's 1st (exclusive)
    firstDay: string;      // YYYY-MM-01 — for DATE-typed columns
    lastDay: string;       // YYYY-MM-<last>
}

export const monthBounds = (month: string): MonthBounds => {
    const [y, m] = month.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    return {
        year: y,
        monthIdx: m - 1,
        daysInMonth,
        startIso: new Date(y, m - 1, 1).toISOString(),
        endIso: new Date(y, m, 1).toISOString(),
        firstDay: `${month}-01`,
        lastDay: `${month}-${pad2(daysInMonth)}`,
    };
};

export const addMonths = (month: string, delta: number): string => {
    const { year, monthIdx } = monthBounds(month);
    return monthKeyOf(new Date(year, monthIdx + delta, 1));
};

export const dayKeysOfMonth = (month: string): string[] =>
    Array.from({ length: monthBounds(month).daysInMonth }, (_, i) => `${month}-${pad2(i + 1)}`);

// Local calendar day of a sale ('' if its date is unparseable).
export const saleDayOf = (o: Order): string => {
    const d = new Date(o.date);
    return Number.isNaN(d.getTime()) ? '' : dayKeyOf(d);
};

export type MonthState = 'past' | 'current' | 'future';

export const monthStateOf = (month: string, now: Date): MonthState => {
    const current = monthKeyOf(now);
    return month === current ? 'current' : month < current ? 'past' : 'future';
};

// ─── Order classification ─────────────────────────────────────────────────

// Same attribution rule as Dashboard 2 (trim + page_source → snapshot page
// fallback). '' is the unassigned bucket — it is stored as-is in
// page_income_predictions.page and only turned into a label in the view.
export const pageKeyOf = (o: Order): string => groupKeyOf(o, 'page');

export const statusOf = (o: Order): string => o.shipping?.status || 'Pending';

export const REVENUE_STATUSES: ReadonlySet<string> = new Set(['Shipped', 'Delivered']);
// 'Drafted' (the status CheckoutForm gives a brand-new order) is grouped with
// Pending/Confirmed — "not yet shipped" — so it is never silently invisible
// to every count on this page, the same failure mode dashboard2/metrics.ts's
// otherStatusCounts comment guards against.
export const PENDING_STATUSES: ReadonlySet<string> = new Set(['Pending', 'Confirmed', 'Drafted']);
export const CANCELLED_STATUSES: ReadonlySet<string> = new Set(['Cancelled', 'Returned', 'ReStock']);

export const isRevenueOrder = (o: Order): boolean => REVENUE_STATUSES.has(statusOf(o));

export const productCostMapOf = (products: Product[]): Map<string, number> => {
    const map = new Map<string, number>();
    products.forEach(p => map.set(p.id, p.purchaseCost || 0));
    return map;
};

export const cogsOf = (o: Order, costMap: Map<string, number>): number =>
    (o.items || []).reduce((sum, it) => sum + (costMap.get(it.id) || 0) * (Number(it.quantity) || 1), 0);

export const shippingFeeOf = (o: Order, rates: Record<string, number>): number =>
    rates[o.shipping?.company || 'Unassigned'] || 0;

// ─── Inputs ───────────────────────────────────────────────────────────────

// One row of page_income_predictions (manual inputs only).
export interface PageInputRow {
    date: string;            // YYYY-MM-DD
    page: string;            // pageKeyOf() value; '' = unassigned
    boostPage: number;
    shipping: number | null; // null = use the rate table
}

export type InputField = 'boostPage' | 'shipping';

export const inputKey = (date: string, page: string): string => `${date}|${page}`;

// One row of the sibling income_predictions table (a day the user froze on
// the Income Prediction page). Only the fields this screen reads.
export interface SiblingRow {
    date: string;
    shippedDelivered: number;
    boostPage: number;
    shipping: number;
    staff: number;
}

// Income Prediction's auto-saved Staff for one day (income_prediction_staff).
// Unlike a SiblingRow it says nothing about freezing — it's just the input —
// and for its day it wins over the frozen row's staff copy.
export interface StaffInputRow {
    date: string;
    staff: number;
}

export interface MetricsInput {
    sales: Order[];
    inputs: PageInputRow[];
    sibling: SiblingRow[] | null;   // null = the sibling table couldn't be read
    staffInputs?: StaffInputRow[];  // omitted/empty where that table doesn't exist yet
    products: Product[];
    shippingRates: Record<string, number>;
    configPages: string[];          // Settings → Pages
    range: DateRange;               // inclusive local days, YYYY-MM-DD both ends
    now: Date;
}

// ─── Per-day flows ────────────────────────────────────────────────────────

export interface DayFlow {
    orders: number;          // Shipped/Delivered
    revenue: number;
    cogs: number;
    shipping: number;        // computed from the rate table
    pending: number;         // Pending/Confirmed — not yet counted
    pendingAmount: number;
    cancelled: number;       // Cancelled/Returned/ReStock
}

const emptyFlow = (): DayFlow => ({ orders: 0, revenue: 0, cogs: 0, shipping: 0, pending: 0, pendingAmount: 0, cancelled: 0 });

const addToFlow = (f: DayFlow, o: Order, costMap: Map<string, number>, rates: Record<string, number>): void => {
    const st = statusOf(o);
    if (REVENUE_STATUSES.has(st)) {
        f.orders += 1;
        f.revenue += o.total || 0;
        f.cogs += cogsOf(o, costMap);
        f.shipping += shippingFeeOf(o, rates);
    } else if (PENDING_STATUSES.has(st)) {
        f.pending += 1;
        f.pendingAmount += o.total || 0;
    } else if (CANCELLED_STATUSES.has(st)) {
        f.cancelled += 1;
    }
};

// page → day → flow, for sales inside `range` only (the query is already
// range-bounded; the filter protects the fixture-driven preview). A day is
// identified by its YYYY-MM-DD string, so the lexical inRange compare is exact
// ('' — an unparseable sale date — sorts before every real day and is skipped).
const bucketByPageAndDay = (sales: Order[], range: DateRange, costMap: Map<string, number>, rates: Record<string, number>): Map<string, Map<string, DayFlow>> => {
    const byPage = new Map<string, Map<string, DayFlow>>();
    for (const o of sales) {
        const day = saleDayOf(o);
        if (!inRange(day, range)) continue;
        const page = pageKeyOf(o);
        let days = byPage.get(page);
        if (!days) { days = new Map(); byPage.set(page, days); }
        let flow = days.get(day);
        if (!flow) { flow = emptyFlow(); days.set(day, flow); }
        addToFlow(flow, o, costMap, rates);
    }
    return byPage;
};

// ─── Projection ───────────────────────────────────────────────────────────

export interface Projection {
    basis: 'run-rate' | 'actual' | 'none';
    completedDays: number;           // full days already behind us (current range only)
    // Distinguishes "hasn't started yet" from "the current range, but too
    // early to extrapolate (0-2 completed days)" — both have completedDays
    // near 0, which used to be the ONLY signal the view had, so day 1 of
    // every current month was wrongly labelled "Month not started".
    isFutureRange: boolean;
    revenue: number | null;
    contribution: number | null;
}

// `date` (YYYY-MM-DD) is the identity of a day; the day-of-month alone repeats
// across the months of a range.
interface FlowDay { date: string; revenue: number; cogs: number; shipping: number }

// Current range (it contains today): run-rate over COMPLETED days only (today
// is partial and the newest days are still mostly Pending), scaled up to the
// whole range, with boost carried exactly as entered — never extrapolated, it is
// paid in lumps. Fewer than 3 completed days is too thin to extrapolate
// ('none'). A whole current month behaves exactly as the month-only model did:
// completed = today − 1, scale = days in month / completed.
const projectFlows = (days: FlowDay[], boostTotal: number, range: DateRange, now: Date): Projection => {
    const state = rangeStateOf(range, now);
    const cw = completedWindow(range, now);
    const sum = (rows: FlowDay[], k: keyof Omit<FlowDay, 'date'>): number => rows.reduce((s, d) => s + d[k], 0);
    if (state === 'future') return { basis: 'none', completedDays: 0, isFutureRange: true, revenue: null, contribution: null };
    if (state === 'past') {
        return {
            basis: 'actual',
            completedDays: cw.total,
            isFutureRange: false,
            revenue: sum(days, 'revenue'),
            contribution: sum(days, 'revenue') - sum(days, 'cogs') - sum(days, 'shipping') - boostTotal,
        };
    }
    const completed = cw.completed;
    if (completed < 3 || cw.lastCompleted === null) return { basis: 'none', completedDays: completed, isFutureRange: false, revenue: null, contribution: null };
    const lastCompleted = cw.lastCompleted;
    const done = days.filter(d => d.date >= range.from && d.date <= lastCompleted);
    const scale = cw.total / completed;
    const revenue = sum(done, 'revenue') * scale;
    const cogs = sum(done, 'cogs') * scale;
    const shipping = sum(done, 'shipping') * scale;
    return { basis: 'run-rate', completedDays: completed, isFutureRange: false, revenue, contribution: revenue - cogs - shipping - boostTotal };
};

// ─── Ledger (one page, one range, one row per day) ────────────────────────

export interface LedgerDay {
    date: string;                  // YYYY-MM-DD — the day's identity
    dayNum: number;                // day of the month (1..31), for display only
    dow: number;                   // 0 = Sunday
    orders: number;
    revenue: number;
    cogs: number;
    shippingComputed: number;
    shippingOverride: number | null;
    shipping: number;              // override ?? computed
    boost: number;
    contribution: number;          // revenue − cogs − shipping − boost
    pending: number;
    pendingAmount: number;
    cancelled: number;
    isToday: boolean;
    isFuture: boolean;
    isWeekend: boolean;
    // Sibling row exists for this day and its frozen revenue (all pages)
    // differs from today's live all-page revenue by this much (live − frozen);
    // null when there is no frozen row.
    frozenDiff: number | null;
}

export interface LedgerTotals {
    orders: number;
    revenue: number;
    cogs: number;
    shipping: number;
    boost: number;
    contribution: number;
    expenses: number;              // cogs + shipping + boost
    pending: number;
    pendingAmount: number;
    cancelled: number;
}

export interface LedgerResult {
    page: string;
    days: LedgerDay[];
    totals: LedgerTotals;
    projection: Projection;
    rangeState: RangeState;
    today: number | null;          // 1-based position of today in the range; null unless the range contains today
    daysInRange: number;
}

interface Prepared {
    byPage: Map<string, Map<string, DayFlow>>;
    inputsByKey: Map<string, PageInputRow>;
    siblingByDate: Map<string, SiblingRow> | null;
    staffInputByDate: Map<string, number>;
    liveRevenueByDay: Map<string, number>;   // all pages
    dayKeys: string[];
    todayKey: string;
    rangeState: RangeState;
    range: DateRange;
    now: Date;
}

const prepare = (input: MetricsInput): Prepared => {
    const costMap = productCostMapOf(input.products);
    const byPage = bucketByPageAndDay(input.sales, input.range, costMap, input.shippingRates);
    // The sibling / staff / input rows are DATE-typed and range-bounded by the
    // query, but only rows inside the range may ever be summed here (the
    // Staff/Net footer, boost + shipping reconciliation, ledger cells).
    const inputsByKey = new Map<string, PageInputRow>();
    for (const r of input.inputs) if (inRange(r.date, input.range)) inputsByKey.set(inputKey(r.date, r.page), r);
    let siblingByDate: Map<string, SiblingRow> | null = null;
    if (input.sibling) {
        siblingByDate = new Map();
        for (const r of input.sibling) if (inRange(r.date, input.range)) siblingByDate.set(r.date, r);
    }
    const staffInputByDate = new Map<string, number>();
    for (const r of input.staffInputs ?? []) if (inRange(r.date, input.range)) staffInputByDate.set(r.date, r.staff);
    const liveRevenueByDay = new Map<string, number>();
    for (const days of byPage.values()) {
        for (const [day, flow] of days) liveRevenueByDay.set(day, (liveRevenueByDay.get(day) || 0) + flow.revenue);
    }
    return {
        byPage,
        inputsByKey,
        siblingByDate,
        staffInputByDate,
        liveRevenueByDay,
        dayKeys: dayKeysOfRange(input.range),
        todayKey: dayKeyOf(input.now),
        rangeState: rangeStateOf(input.range, input.now),
        range: input.range,
        now: input.now,
    };
};

const ledgerFor = (page: string, p: Prepared): LedgerResult => {
    const flows = p.byPage.get(page) || new Map<string, DayFlow>();
    const days: LedgerDay[] = p.dayKeys.map(date => {
        const flow = flows.get(date) || emptyFlow();
        const row = p.inputsByKey.get(inputKey(date, page));
        const shippingOverride = row?.shipping ?? null;
        const shipping = shippingOverride ?? flow.shipping;
        const boost = row?.boostPage || 0;
        // Weekday and day-of-month both come from the date string itself (the
        // row's position in the range says nothing about either once the range
        // doesn't start on the 1st).
        const local = parseDay(date);
        const dow = local.getDay();
        const frozen = p.siblingByDate?.get(date);
        return {
            date,
            dayNum: local.getDate(),
            dow,
            orders: flow.orders,
            revenue: flow.revenue,
            cogs: flow.cogs,
            shippingComputed: flow.shipping,
            shippingOverride,
            shipping,
            boost,
            contribution: flow.revenue - flow.cogs - shipping - boost,
            pending: flow.pending,
            pendingAmount: flow.pendingAmount,
            cancelled: flow.cancelled,
            isToday: date === p.todayKey,
            isFuture: date > p.todayKey,
            isWeekend: dow === 0 || dow === 6,
            frozenDiff: frozen ? (p.liveRevenueByDay.get(date) || 0) - frozen.shippedDelivered : null,
        };
    });
    const totals = days.reduce<LedgerTotals>((acc, d) => {
        acc.orders += d.orders; acc.revenue += d.revenue; acc.cogs += d.cogs; acc.shipping += d.shipping;
        acc.boost += d.boost; acc.contribution += d.contribution; acc.pending += d.pending;
        acc.pendingAmount += d.pendingAmount; acc.cancelled += d.cancelled;
        return acc;
    }, { orders: 0, revenue: 0, cogs: 0, shipping: 0, boost: 0, contribution: 0, expenses: 0, pending: 0, pendingAmount: 0, cancelled: 0 });
    // Boost is typed in cents, so its range total is exact to the cent — it's
    // also the value the Overview's editable Boost cell shows.
    totals.boost = roundCents(totals.boost);
    totals.expenses = totals.cogs + totals.shipping + totals.boost;
    const projection = projectFlows(days, totals.boost, p.range, p.now);
    return {
        page,
        days,
        totals,
        projection,
        rangeState: p.rangeState,
        today: dayNumberOf(p.range, p.now),
        daysInRange: rangeLength(p.range),
    };
};

export const buildLedger = (input: MetricsInput & { page: string }): LedgerResult => ledgerFor(input.page, prepare(input));

// ─── Overview (one row per page) ──────────────────────────────────────────

export interface PageRow {
    key: string;                   // '' = unassigned
    inConfig: boolean;             // listed under Settings → Pages
    orders: number;
    pending: number;
    pendingAmount: number;
    cancelled: number;
    revenue: number;
    cogs: number;
    shipping: number;
    boost: number;
    contribution: number;
    margin: number | null;         // contribution / revenue
    roas: number | null;           // revenue / boost
    boostPerOrder: number | null;  // boost / orders
    projection: Projection;
}

export interface SharedFooter {
    available: boolean;            // sibling table readable
    staff: number;                 // Σ income_predictions.staff over the days of the range
    siblingBoost: number;          // Σ income_predictions.boost_page (range days only)
    allocatedBoost: number;        // Σ page inputs' boost (all pages)
    siblingShipping: number;       // Σ income_predictions.shipping — a day frozen on the
                                    // classic page can carry its own manually-typed shipping
                                    // total, independent of any (date,page) shipping override
    allocatedShipping: number;     // Σ page inputs'/computed shipping (all pages)
    net: number;                   // Σ contribution − staff
}

export interface OverviewResult {
    rows: PageRow[];               // contribution desc, unassigned last
    totals: PageRow;               // key '*'
    shared: SharedFooter;
    unassignedShare: number;       // unassigned revenue / total revenue (0..1)
    rangeState: RangeState;
    today: number | null;          // 1-based position of today in the range; null unless the range contains today
    daysInRange: number;
    completedDays: number;
}

// Exported for reuse by ../productIncomePrediction/metrics.ts — avoid a second copy.
export const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

// Defined in src/utils/money.ts (shared with the classic IncomePrediction
// screen); re-exported so this folder's existing imports keep working.
export { roundCents };

const rowFromLedger = (key: string, inConfig: boolean, l: LedgerResult): PageRow => ({
    key,
    inConfig,
    orders: l.totals.orders,
    pending: l.totals.pending,
    pendingAmount: l.totals.pendingAmount,
    cancelled: l.totals.cancelled,
    revenue: l.totals.revenue,
    cogs: l.totals.cogs,
    shipping: l.totals.shipping,
    boost: l.totals.boost,
    contribution: l.totals.contribution,
    margin: ratio(l.totals.contribution, l.totals.revenue),
    roas: ratio(l.totals.revenue, l.totals.boost),
    boostPerOrder: ratio(l.totals.boost, l.totals.orders),
    projection: l.projection,
});

export const buildOverview = (input: MetricsInput): OverviewResult => {
    const p = prepare(input);
    const config = input.configPages.map(s => String(s || '').trim()).filter(Boolean);
    const configSet = new Set(config);
    const keys = new Set<string>(config);
    for (const k of p.byPage.keys()) keys.add(k);
    for (const r of p.inputsByKey.values()) keys.add(r.page);

    const rows = Array.from(keys).map(key => rowFromLedger(key, configSet.has(key), ledgerFor(key, p)));
    rows.sort((a, b) => {
        if (a.key === '' || b.key === '') return a.key === '' ? 1 : -1;
        if (b.contribution !== a.contribution) return b.contribution - a.contribution;
        if (b.revenue !== a.revenue) return b.revenue - a.revenue;
        return a.key.localeCompare(b.key);
    });

    const sum = (k: 'orders' | 'pending' | 'pendingAmount' | 'cancelled' | 'revenue' | 'cogs' | 'shipping' | 'boost' | 'contribution'): number =>
        rows.reduce((s, r) => s + r[k], 0);
    const projSum = (k: 'revenue' | 'contribution'): number | null =>
        rows.length === 0 || rows.some(r => r.projection[k] === null) ? null : rows.reduce((s, r) => s + (r.projection[k] as number), 0);
    const anyProjection = rows[0]?.projection;
    const totals: PageRow = {
        key: '*',
        inConfig: true,
        orders: sum('orders'),
        pending: sum('pending'),
        pendingAmount: sum('pendingAmount'),
        cancelled: sum('cancelled'),
        revenue: sum('revenue'),
        cogs: sum('cogs'),
        shipping: sum('shipping'),
        boost: roundCents(sum('boost')),
        contribution: sum('contribution'),
        margin: ratio(sum('contribution'), sum('revenue')),
        roas: ratio(sum('revenue'), sum('boost')),
        boostPerOrder: ratio(sum('boost'), sum('orders')),
        projection: {
            basis: anyProjection?.basis ?? (p.rangeState === 'past' ? 'actual' : 'none'),
            completedDays: anyProjection?.completedDays ?? (p.rangeState === 'current' ? completedWindow(p.range, input.now).completed : 0),
            isFutureRange: anyProjection?.isFutureRange ?? (p.rangeState === 'future'),
            revenue: projSum('revenue'),
            contribution: projSum('contribution'),
        },
    };

    const siblingRows = p.siblingByDate ? Array.from(p.siblingByDate.values()) : [];
    // Staff per day: the auto-saved input where there is one, else the frozen
    // row's copy (days frozen before Staff was auto-saved).
    const staffByDate = new Map<string, number>();
    for (const r of siblingRows) staffByDate.set(r.date, r.staff);
    for (const [date, amount] of p.staffInputByDate) staffByDate.set(date, amount);
    const staff = roundCents(Array.from(staffByDate.values()).reduce((s, v) => s + v, 0));
    const siblingBoost = roundCents(siblingRows.reduce((s, r) => s + r.boostPage, 0));
    const siblingShipping = roundCents(siblingRows.reduce((s, r) => s + r.shipping, 0));
    const shared: SharedFooter = {
        available: p.siblingByDate !== null,
        staff,
        siblingBoost,
        allocatedBoost: totals.boost,
        siblingShipping,
        allocatedShipping: totals.shipping,
        net: totals.contribution - staff,
    };

    const unassigned = rows.find(r => r.key === '');
    return {
        rows,
        totals,
        shared,
        unassignedShare: unassigned && totals.revenue > 0 ? unassigned.revenue / totals.revenue : 0,
        rangeState: p.rangeState,
        today: dayNumberOf(p.range, input.now),
        daysInRange: rangeLength(p.range),
        completedDays: completedWindow(p.range, input.now).completed,
    };
};
