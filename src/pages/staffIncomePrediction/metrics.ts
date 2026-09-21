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
// The one thing genuinely new to this screen: `User.monthlyTarget`, the
// same field src/pages/reports/StaffPerformance.tsx already tracks
// (daily/weekly/monthly target-attainment bars) — a month-level "how close
// to target" column fits this screen's monthly cadence better than
// duplicating that page's daily/weekly view.
import type { Sale, Product, User } from '../../types';
import {
    monthBounds, addMonths, dayKeysOfMonth, monthKeyOf, dayKeyOf, isMonthKey, monthStateOf, saleDayOf,
    statusOf, REVENUE_STATUSES, PENDING_STATUSES, CANCELLED_STATUSES, productCostMapOf, cogsOf, ratio,
    type MonthBounds, type MonthState,
} from '../pageIncomePrediction/metrics';

export type Order = Sale;
export { monthBounds, addMonths, dayKeysOfMonth, monthKeyOf, dayKeyOf, isMonthKey, monthStateOf, saleDayOf };
export type { MonthBounds, MonthState };

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

const bucketByStaffAndDay = (sales: Order[], month: string, costMap: Map<string, number>): Map<string, Map<string, StaffDayFlow>> => {
    const byStaff = new Map<string, Map<string, StaffDayFlow>>();
    for (const o of sales) {
        const day = saleDayOf(o);
        if (!day.startsWith(`${month}-`)) continue;
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
    isFutureMonth: boolean;
    revenue: number | null;
    grossProfit: number | null;
}

interface FlowDay { dayNum: number; revenue: number; cogs: number }

const projectFlows = (days: FlowDay[], month: string, now: Date): Projection => {
    const state = monthStateOf(month, now);
    const { daysInMonth } = monthBounds(month);
    const sum = (rows: FlowDay[], k: keyof Omit<FlowDay, 'dayNum'>): number => rows.reduce((s, d) => s + d[k], 0);
    if (state === 'future') return { basis: 'none', completedDays: 0, isFutureMonth: true, revenue: null, grossProfit: null };
    if (state === 'past') {
        const revenue = sum(days, 'revenue');
        return { basis: 'actual', completedDays: daysInMonth, isFutureMonth: false, revenue, grossProfit: revenue - sum(days, 'cogs') };
    }
    const completed = now.getDate() - 1;
    if (completed < 3) return { basis: 'none', completedDays: completed, isFutureMonth: false, revenue: null, grossProfit: null };
    const done = days.filter(d => d.dayNum <= completed);
    const scale = daysInMonth / completed;
    const revenue = sum(done, 'revenue') * scale;
    const cogs = sum(done, 'cogs') * scale;
    return { basis: 'run-rate', completedDays: completed, isFutureMonth: false, revenue, grossProfit: revenue - cogs };
};

// ─── Ledger (one staff member, one month, one row per day) ─────────────────

export interface LedgerDay {
    date: string;
    dayNum: number;
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
    monthState: MonthState;
    today: number | null;
    daysInMonth: number;
}

export interface MetricsInput {
    sales: Order[];
    products: Product[];
    users: User[];
    configSalesmen: string[];       // Settings → Salesmen
    month: string;
    now: Date;
}

interface Prepared {
    byStaff: Map<string, Map<string, StaffDayFlow>>;
    targets: Map<string, number>;
    dayKeys: string[];
    todayKey: string;
    monthState: MonthState;
    bounds: MonthBounds;
    month: string;
    now: Date;
}

const prepare = (input: MetricsInput): Prepared => {
    const costMap = productCostMapOf(input.products);
    return {
        byStaff: bucketByStaffAndDay(input.sales, input.month, costMap),
        targets: targetMapOf(input.users),
        dayKeys: dayKeysOfMonth(input.month),
        todayKey: dayKeyOf(input.now),
        monthState: monthStateOf(input.month, input.now),
        bounds: monthBounds(input.month),
        month: input.month,
        now: input.now,
    };
};

const ledgerFor = (staff: string, p: Prepared): LedgerResult => {
    const flows = p.byStaff.get(staff) || new Map<string, StaffDayFlow>();
    const days: LedgerDay[] = p.dayKeys.map((date, i) => {
        const flow = flows.get(date) || emptyFlow();
        const dow = new Date(p.bounds.year, p.bounds.monthIdx, i + 1).getDay();
        return {
            date,
            dayNum: i + 1,
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
    const projection = projectFlows(days, p.month, p.now);
    return {
        staff,
        days,
        totals,
        projection,
        monthState: p.monthState,
        today: p.monthState === 'current' ? p.now.getDate() : null,
        daysInMonth: p.bounds.daysInMonth,
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
    monthlyTarget: number | null;   // User.monthlyTarget, matched by name — null = no target set
    // Revenue of the staff that monthlyTarget covers — the only numerator that
    // is comparable to it. A staff row's own revenue when it has a target; on
    // the Totals row, the sum over staff WITH a target only (revenue from
    // staff with no target, or unassigned orders, must not count toward a
    // target they don't have). null = nobody here has a target.
    targetedRevenue: number | null;
    targetProgress: number | null;  // targetedRevenue / monthlyTarget
    projectedTargetProgress: number | null; // projected targeted revenue / monthlyTarget
    projection: Projection;
}

export interface OverviewResult {
    rows: StaffRow[];               // gross profit desc, unassigned last
    totals: StaffRow;               // name '*'
    monthState: MonthState;
    today: number | null;
    daysInMonth: number;
    completedDays: number;
}

const rowFromLedger = (name: string, inConfig: boolean, target: number | undefined, l: LedgerResult): StaffRow => ({
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
    targetedRevenue: target ? l.totals.revenue : null,
    targetProgress: target ? ratio(l.totals.revenue, target) : null,
    projectedTargetProgress: target && l.projection.revenue !== null ? ratio(l.projection.revenue, target) : null,
    projection: l.projection,
});

export const summarizeRows = (rows: StaffRow[], monthState: MonthState, now: Date): StaffRow => {
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
    const totalTarget = targeted.reduce((s, r) => s + (r.monthlyTarget || 0), 0) || null;
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
        monthlyTarget: totalTarget,
        targetedRevenue,
        targetProgress: totalTarget && targetedRevenue !== null ? ratio(targetedRevenue, totalTarget) : null,
        projectedTargetProgress: totalTarget && targetedProjRevenue !== null ? ratio(targetedProjRevenue, totalTarget) : null,
        projection: {
            basis: anyProjection?.basis ?? (monthState === 'past' ? 'actual' : 'none'),
            completedDays: anyProjection?.completedDays ?? (monthState === 'current' ? now.getDate() - 1 : 0),
            isFutureMonth: anyProjection?.isFutureMonth ?? (monthState === 'future'),
            revenue: projRevenue,
            grossProfit: projSum('grossProfit'),
        },
    };
};

export const buildOverview = (input: MetricsInput): OverviewResult => {
    const p = prepare(input);
    const config = input.configSalesmen.map(s => String(s || '').trim()).filter(Boolean);
    const configSet = new Set(config);
    // Every configured salesman is shown even with zero sales this month (a
    // "nothing sold" signal, same philosophy as Prediction by Page showing a
    // configured Page with no orders) — union'd with any name seen in sales
    // but not in Settings (renamed/removed staff, or a typo at checkout).
    const names = new Set<string>(config);
    for (const n of p.byStaff.keys()) names.add(n);

    const rows = Array.from(names).map(name => rowFromLedger(name, configSet.has(name), p.targets.get(name), ledgerFor(name, p)));
    rows.sort((a, b) => {
        if (a.name === UNASSIGNED_STAFF_KEY || b.name === UNASSIGNED_STAFF_KEY) return a.name === UNASSIGNED_STAFF_KEY ? 1 : -1;
        if (b.grossProfit !== a.grossProfit) return b.grossProfit - a.grossProfit;
        if (b.revenue !== a.revenue) return b.revenue - a.revenue;
        return a.name.localeCompare(b.name);
    });

    return {
        rows,
        totals: summarizeRows(rows, p.monthState, input.now),
        monthState: p.monthState,
        today: p.monthState === 'current' ? input.now.getDate() : null,
        daysInMonth: p.bounds.daysInMonth,
        completedDays: p.monthState === 'current' ? input.now.getDate() - 1 : p.monthState === 'past' ? p.bounds.daysInMonth : 0,
    };
};
