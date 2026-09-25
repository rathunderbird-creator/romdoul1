// Prediction by Staff — pure metric derivation over mapped `Sale` objects.
// No React, no Supabase, no Date.now(): `now` is always passed in, so the
// dev preview (src/dev/staffIncomePrediction-preview.tsx) is deterministic.
//
// Attribution is ORDER-level, not item-level: an order has exactly one
// salesman, so (unlike ../productIncomePrediction, which has to split one
// order's revenue across several line items) revenue here is simply
// Σ order.total for that salesman's Shipped/Delivered orders — the same
// rule ../IncomePrediction.tsx and ../pageIncomePrediction/metrics.ts use,
// so this screen reconciles with both directly, no discount-scaling needed.
//
// Like Prediction by Product, this screen has no writes, no new table, and
// no permission-gated editing: there is no commission concept anywhere in
// this codebase (grepped — none), and payroll (base salary + admin-typed
// bonus/deductions) is a wholly separate ERP flow keyed to a different
// `Employee` entity, entirely decoupled from `Sale.salesman`. Staff cost
// stays a single business-wide lump on the classic Income Prediction page,
// exactly as Prediction by Page and Prediction by Product both already
// treat it — never split or re-derived here.
//
// The period is an arbitrary inclusive DateRange (a whole calendar month is
// just the default range). The one thing genuinely new to this screen:
// `User.monthlyTarget`, the same field src/pages/reports/StaffPerformance.tsx
// already tracks (daily/weekly/monthly target-attainment bars). It is a
// MONTHLY figure, so for a range it is pro-rated by monthEquivalents(range)
// (a whole month = exactly 1, Sep 1–15 = 0.5) — see StaffRow.periodTarget.
import type { Sale, Product, User } from '../../types';
import {
    saleDayOf, statusOf, REVENUE_STATUSES, PENDING_STATUSES, CANCELLED_STATUSES, productCostMapOf, cogsOf, ratio,
} from '../pageIncomePrediction/metrics';
import { roundCents } from '../../utils/money';
import {
    completedWindow, dayKeyFromDate, dayKeysOfRange, dayNumberOf, inRange, monthEquivalents, parseDay, rangeLength, rangeStateOf,
    type DateRange, type RangeState,
} from '../../utils/dateRange';

export type Order = Sale;
export type { RangeState };

// Salesman names are a plain string on Sale, populated from a User's name at
// checkout time (no foreign key — see StaffPerformance.tsx's own precedent
// for treating it this way). '' is the unassigned bucket for an order with
// no salesman set.
export const UNASSIGNED_STAFF_KEY = '';

const nameOf = (o: Order): string => String(o.salesman || '').trim();

// A user's own monthlyTarget by name — first match wins if two users
// happen to share a name (an existing, out-of-scope data-model fragility;
// CheckoutForm itself stores user.name, not user.id, as `salesman`).
export const targetMapOf = (users: User[]): Map<string, number> => {
    const map = new Map<string, number>();
    for (const u of users) {
        // Keyed by the TRIMMED name, like nameOf() — live data has users stored
        // as "SNA " / "Chantha " (trailing space), whose orders carry the same
        // untrimmed string. Row keys are trimmed, so an untrimmed key here
        // would never match and their target would silently not show.
        const key = String(u.name || '').trim();
        if (key && !map.has(key) && u.monthlyTarget) map.set(key, u.monthlyTarget);
    }
    return map;
};

// A monthly target pro-rated to the range. A whole calendar month has a factor
// of exactly 1 and passes through untouched (no rounding), so the default view
// is byte-identical to the month-only screen; any other range is snapped to
// whole cents.
const periodTargetOf = (monthlyTarget: number, factor: number): number =>
    factor === 1 ? monthlyTarget : roundCents(monthlyTarget * factor);

// ─── Per-day flow, one bucket per (staff, day) ─────────────────────────────

export interface StaffDayFlow {
    orders: number;
    revenue: number;
    cogs: number;
    pending: number;
    pendingAmount: number;
    cancelled: number;
}

const emptyFlow = (): StaffDayFlow => ({ orders: 0, revenue: 0, cogs: 0, pending: 0, pendingAmount: 0, cancelled: 0 });

// Sales are bucketed by their LOCAL calendar day; a day is identified by its
// YYYY-MM-DD string, so the range filter is a lexical compare. (The query is
// already range-bounded; the filter protects the fixture-driven preview.)
const bucketByStaffAndDay = (sales: Order[], range: DateRange, costMap: Map<string, number>): Map<string, Map<string, StaffDayFlow>> => {
    const byStaff = new Map<string, Map<string, StaffDayFlow>>();
    for (const o of sales) {
        const day = saleDayOf(o);
        if (!inRange(day, range)) continue;
        const name = nameOf(o);
        let days = byStaff.get(name);
        if (!days) { days = new Map(); byStaff.set(name, days); }
        let flow = days.get(day);
        if (!flow) { flow = emptyFlow(); days.set(day, flow); }
        const st = statusOf(o);
        if (REVENUE_STATUSES.has(st)) {
            flow.orders += 1;
            flow.revenue += o.total || 0;
            flow.cogs += cogsOf(o, costMap);
        } else if (PENDING_STATUSES.has(st)) {
            flow.pending += 1;
            flow.pendingAmount += o.total || 0;
        } else if (CANCELLED_STATUSES.has(st)) {
            flow.cancelled += 1;
        }
    }
    return byStaff;
};

// ─── Projection ─────────────────────────────────────────────────────────────

export interface Projection {
    basis: 'run-rate' | 'actual' | 'none';
    completedDays: number;
    isFutureRange: boolean;
    revenue: number | null;
    grossProfit: number | null;
}

interface FlowDay { date: string; revenue: number; cogs: number }

// Run-rate to the END of the range: the completed days (every day of the range
// strictly before today) are scaled by total/completed.
const projectFlows = (days: FlowDay[], range: DateRange, now: Date): Projection => {
    const state = rangeStateOf(range, now);
    const daysInRange = rangeLength(range);
    const sum = (rows: FlowDay[], k: 'revenue' | 'cogs'): number => rows.reduce((s, d) => s + d[k], 0);
    if (state === 'future') return { basis: 'none', completedDays: 0, isFutureRange: true, revenue: null, grossProfit: null };
    if (state === 'past') {
        const revenue = sum(days, 'revenue');
        return { basis: 'actual', completedDays: daysInRange, isFutureRange: false, revenue, grossProfit: revenue - sum(days, 'cogs') };
    }
    const { completed, lastCompleted } = completedWindow(range, now);
    if (completed < 3 || lastCompleted === null) return { basis: 'none', completedDays: completed, isFutureRange: false, revenue: null, grossProfit: null };
    const done = days.filter(d => d.date >= range.from && d.date <= lastCompleted);
    const scale = daysInRange / completed;
    const revenue = sum(done, 'revenue') * scale;
    const cogs = sum(done, 'cogs') * scale;
    return { basis: 'run-rate', completedDays: completed, isFutureRange: false, revenue, grossProfit: revenue - cogs };
};

// ─── Ledger (one staff member, one range, one row per day) ─────────────────

export interface LedgerDay {
    date: string;
    dayNum: number;     // day of month — display only, unique only within one month
    dow: number;
    orders: number;
    revenue: number;
    cogs: number;
    grossProfit: number;
    pending: number;
    pendingAmount: number;
    cancelled: number;
    isToday: boolean;
    isFuture: boolean;
    isWeekend: boolean;
}

export interface LedgerTotals {
    orders: number;
    revenue: number;
    cogs: number;
    grossProfit: number;
    pending: number;
    pendingAmount: number;
    cancelled: number;
}

export interface LedgerResult {
    staff: string;
    days: LedgerDay[];
    totals: LedgerTotals;
    projection: Projection;
    rangeState: RangeState;
    today: number | null;   // 1-based position of today inside the range; null when today is outside it
    daysInRange: number;
}

export interface MetricsInput {
    sales: Order[];
    products: Product[];
    users: User[];
    configSalesmen: string[];       // Settings → Salesmen
    range: DateRange;
    now: Date;
}

interface DayMeta { date: string; dayNum: number; dow: number }

interface Prepared {
    byStaff: Map<string, Map<string, StaffDayFlow>>;
    targets: Map<string, number>;
    dayMeta: DayMeta[];
    todayKey: string;
    rangeState: RangeState;
    daysInRange: number;
    today: number | null;
    completedDays: number;
    targetFactor: number;           // monthEquivalents(range) — what a monthly target is scaled by
    range: DateRange;
    now: Date;
}

const prepare = (input: MetricsInput): Prepared => {
    const costMap = productCostMapOf(input.products);
    const { range, now } = input;
    return {
        byStaff: bucketByStaffAndDay(input.sales, range, costMap),
        targets: targetMapOf(input.users),
        // Day of week comes from the date string itself, never from month bounds.
        dayMeta: dayKeysOfRange(range).map(date => ({ date, dayNum: Number(date.slice(8, 10)), dow: parseDay(date).getDay() })),
        todayKey: dayKeyFromDate(now),
        rangeState: rangeStateOf(range, now),
        daysInRange: rangeLength(range),
        today: dayNumberOf(range, now),
        completedDays: completedWindow(range, now).completed,
        targetFactor: monthEquivalents(range),
        range,
        now,
    };
};

const ledgerFor = (staff: string, p: Prepared): LedgerResult => {
    const flows = p.byStaff.get(staff) || new Map<string, StaffDayFlow>();
    const days: LedgerDay[] = p.dayMeta.map(({ date, dayNum, dow }) => {
        const flow = flows.get(date) || emptyFlow();
        return {
            date,
            dayNum,
            dow,
            orders: flow.orders,
            revenue: flow.revenue,
            cogs: flow.cogs,
            grossProfit: flow.revenue - flow.cogs,
            pending: flow.pending,
            pendingAmount: flow.pendingAmount,
            cancelled: flow.cancelled,
            isToday: date === p.todayKey,
            isFuture: date > p.todayKey,
            isWeekend: dow === 0 || dow === 6,
        };
    });
    const totals = days.reduce<LedgerTotals>((acc, d) => {
        acc.orders += d.orders; acc.revenue += d.revenue; acc.cogs += d.cogs; acc.grossProfit += d.grossProfit;
        acc.pending += d.pending; acc.pendingAmount += d.pendingAmount; acc.cancelled += d.cancelled;
        return acc;
    }, { orders: 0, revenue: 0, cogs: 0, grossProfit: 0, pending: 0, pendingAmount: 0, cancelled: 0 });
    const projection = projectFlows(days, p.range, p.now);
    return {
        staff,
        days,
        totals,
        projection,
        rangeState: p.rangeState,
        today: p.today,
        daysInRange: p.daysInRange,
    };
};

export const buildLedger = (input: MetricsInput & { staff: string }): LedgerResult => ledgerFor(input.staff, prepare(input));

// ─── Overview (one row per staff member) ───────────────────────────────────

export interface StaffRow {
    name: string;                  // '' = unassigned
    inConfig: boolean;              // listed under Settings → Salesmen
    orders: number;
    pending: number;
    pendingAmount: number;
    cancelled: number;
    revenue: number;
    cogs: number;
    grossProfit: number;
    margin: number | null;          // grossProfit / revenue
    monthlyTarget: number | null;   // User.monthlyTarget, matched by name — the raw MONTHLY figure; null = no target set
    // monthlyTarget pro-rated to the selected range (× monthEquivalents(range),
    // whole cents). Exactly monthlyTarget for a whole calendar month. This is
    // the comparable target: every progress ratio and every printed target
    // amount uses it. On the Totals row, Σ over staff WITH a target.
    periodTarget: number | null;
    // Revenue of the staff that periodTarget covers — the only numerator that
    // is comparable to it. A staff row's own revenue when it has a target; on
    // the Totals row, the sum over staff WITH a target only (revenue from
    // staff with no target, or unassigned orders, must not count toward a
    // target they don't have). null = nobody here has a target.
    targetedRevenue: number | null;
    targetProgress: number | null;  // targetedRevenue / periodTarget
    projectedTargetProgress: number | null; // projected targeted revenue / periodTarget
    projection: Projection;
}

export interface OverviewResult {
    rows: StaffRow[];               // gross profit desc, unassigned last
    totals: StaffRow;               // name '*'
    rangeState: RangeState;
    today: number | null;           // 1-based position of today inside the range; null when outside it
    daysInRange: number;
    completedDays: number;
    targetFactor: number;           // monthEquivalents(range); !== 1 means targets are pro-rated
}

const rowFromLedger = (name: string, inConfig: boolean, target: number | undefined, factor: number, l: LedgerResult): StaffRow => {
    const periodTarget = target ? periodTargetOf(target, factor) : null;
    return {
        name,
        inConfig,
        orders: l.totals.orders,
        pending: l.totals.pending,
        pendingAmount: l.totals.pendingAmount,
        cancelled: l.totals.cancelled,
        revenue: l.totals.revenue,
        cogs: l.totals.cogs,
        grossProfit: l.totals.grossProfit,
        margin: ratio(l.totals.grossProfit, l.totals.revenue),
        monthlyTarget: target ?? null,
        periodTarget,
        targetedRevenue: target ? l.totals.revenue : null,
        targetProgress: periodTarget !== null ? ratio(l.totals.revenue, periodTarget) : null,
        projectedTargetProgress: periodTarget !== null && l.projection.revenue !== null ? ratio(l.projection.revenue, periodTarget) : null,
        projection: l.projection,
    };
};

export const summarizeRows = (rows: StaffRow[], range: DateRange, now: Date): StaffRow => {
    const rangeState = rangeStateOf(range, now);
    const factor = monthEquivalents(range);
    const sum = (k: 'orders' | 'pending' | 'pendingAmount' | 'cancelled' | 'revenue' | 'cogs' | 'grossProfit'): number =>
        rows.reduce((s, r) => s + r[k], 0);
    const projSum = (k: 'revenue' | 'grossProfit'): number | null =>
        rows.length === 0 || rows.some(r => r.projection[k] === null) ? null : rows.reduce((s, r) => s + (r.projection[k] as number), 0);
    const anyProjection = rows[0]?.projection;
    const totalRevenue = sum('revenue');
    // Target attainment is computed over the staff who HAVE a target, on both
    // sides of the ratio — dividing every staff member's revenue (incl. the
    // unassigned bucket) by only the targeted staff's summed target would
    // overstate it (e.g. one person at 50% of a $1,000 target next to $5,000
    // of untargeted sales would read 565%).
    const targeted = rows.filter(r => r.monthlyTarget);
    const totalMonthlyTarget = targeted.reduce((s, r) => s + (r.monthlyTarget || 0), 0) || null;
    // Σ of the already-pro-rated per-staff targets; snapped to whole cents only
    // when pro-rating is in play (a factor-1 sum must stay untouched).
    const periodSum = targeted.reduce((s, r) => s + (r.periodTarget || 0), 0);
    const totalPeriodTarget = (factor === 1 ? periodSum : roundCents(periodSum)) || null;
    const targetedRevenue = targeted.length > 0 ? targeted.reduce((s, r) => s + r.revenue, 0) : null;
    const targetedProjRevenue = targeted.length > 0 && targeted.every(r => r.projection.revenue !== null)
        ? targeted.reduce((s, r) => s + (r.projection.revenue as number), 0)
        : null;
    const projRevenue = projSum('revenue');
    return {
        name: '*',
        inConfig: true,
        orders: sum('orders'),
        pending: sum('pending'),
        pendingAmount: sum('pendingAmount'),
        cancelled: sum('cancelled'),
        revenue: totalRevenue,
        cogs: sum('cogs'),
        grossProfit: sum('grossProfit'),
        margin: ratio(sum('grossProfit'), totalRevenue),
        monthlyTarget: totalMonthlyTarget,
        periodTarget: totalPeriodTarget,
        targetedRevenue,
        targetProgress: totalPeriodTarget && targetedRevenue !== null ? ratio(targetedRevenue, totalPeriodTarget) : null,
        projectedTargetProgress: totalPeriodTarget && targetedProjRevenue !== null ? ratio(targetedProjRevenue, totalPeriodTarget) : null,
        projection: {
            basis: anyProjection?.basis ?? (rangeState === 'past' ? 'actual' : 'none'),
            completedDays: anyProjection?.completedDays ?? (rangeState === 'current' ? completedWindow(range, now).completed : 0),
            isFutureRange: anyProjection?.isFutureRange ?? (rangeState === 'future'),
            revenue: projRevenue,
            grossProfit: projSum('grossProfit'),
        },
    };
};

export const buildOverview = (input: MetricsInput): OverviewResult => {
    const p = prepare(input);
    const config = input.configSalesmen.map(s => String(s || '').trim()).filter(Boolean);
    const configSet = new Set(config);
    // Every configured salesman is shown even with zero sales in this period (a
    // "nothing sold" signal, same philosophy as Prediction by Page showing a
    // configured Page with no orders) — union'd with any name seen in sales
    // but not in Settings (renamed/removed staff, or a typo at checkout).
    const names = new Set<string>(config);
    for (const n of p.byStaff.keys()) names.add(n);

    const rows = Array.from(names).map(name => rowFromLedger(name, configSet.has(name), p.targets.get(name), p.targetFactor, ledgerFor(name, p)));
    rows.sort((a, b) => {
        if (a.name === UNASSIGNED_STAFF_KEY || b.name === UNASSIGNED_STAFF_KEY) return a.name === UNASSIGNED_STAFF_KEY ? 1 : -1;
        if (b.grossProfit !== a.grossProfit) return b.grossProfit - a.grossProfit;
        if (b.revenue !== a.revenue) return b.revenue - a.revenue;
        return a.name.localeCompare(b.name);
    });

    return {
        rows,
        totals: summarizeRows(rows, input.range, input.now),
        rangeState: p.rangeState,
        today: p.today,
        daysInRange: p.daysInRange,
        completedDays: p.completedDays,
        targetFactor: p.targetFactor,
    };
};
