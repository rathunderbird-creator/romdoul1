// Profit & CPA Tracker — pure metric derivation. No React, no Supabase, no
// Date.now(): `now` is passed in, so the dev preview is deterministic.
//
// Digitises the "Profit & CPA Performance Tracker" workbook (its four sheets:
// Product Catalog & Unit Economics, Daily Profit & CPA Tracker, Profit &
// Performance Summary, Weekly Summary) with ONE deliberate change: closed and
// delivered orders are COUNTED from real orders instead of typed. A typed
// number still overrides the count for that row.
//
// The workbook's formulas, kept 1:1 (its rows are single-product orders sold
// at list price, where every rule below reduces exactly to the sheet's —
// verified by feeding the sheet's inputs through this file):
//   Unit economics (per product)
//     hardCosts      = COGS + courier fee + packaging
//     breakEvenCpa   = price − hardCosts
//     targetNetCpa   = breakEvenCpa − desired profit
//     targetGrossCpa = targetNetCpa × expected delivery rate
//   Daily row (day × page × product)
//     costPerChat  = spend / chats        grossCpa      = spend / closed
//     deliveryRate = delivered / closed   netCpa        = spend / delivered
//     netProfit    = revenue − hardCosts − spend
//     margin       = netProfit / revenue  profitPerOrder = netProfit / delivered
//     status: On target / Margin squeeze / Loss making
//   Page health:    profit > 0 → Healthy, else At risk
//   Product status: on target → Scale winner, else Needs creative refresh
//   Weekly:         the same sums per Monday–Sunday week, plus closing rate
//                   (closed / chats) and week-over-week profit change.
//
// Where real orders need more care than the sheet's typed rows:
//   • Revenue is the ACTUAL revenue of the delivered orders (line price × qty,
//     scaled per order so it sums to order.total — Prediction by Product's
//     discount rule), not delivered × list price.
//   • Costs: COGS per UNIT; courier fee + packaging once per ORDER (split
//     evenly across the products of a multi-product order).
//   • Status is judged on PROFIT, which is the sheet's CPA comparison rewritten
//     so it stays true for discounts and multi-unit orders:
//       netCpa ≤ target      ⇔ netProfit ≥ desired profit × delivered orders
//       netCpa ≤ break-even  ⇔ netProfit ≥ 0
//   • Orders still in transit: a verdict is shown only if it is the same
//     whether the in-transit orders end up delivered or not; otherwise the
//     row/page/product is "pending" (the newest days would otherwise always
//     read as losses — spend is counted in full, deliveries trickle in).
//   • Rows with no ad spend ("No ads"/organic) are never judged, and every
//     CPA (net, gross, product status) divides ad spend by the orders of rows
//     that HAVE ad spend only — organic deliveries must not dilute it.
//   • Cost per chat and closing rate use only rows where chats were typed.
//   • A typed delivered count rescales revenue / units / order share with the
//     row's own per-order figures (delivered orders, else in-transit ones,
//     else list price × 1 unit), and is FINAL: the rest of the row's closed
//     orders count as not delivered, like a typed row in the sheet.
//   • An order still open STALE_OPEN_DAYS after the day it was placed is
//     counted as not delivered (failed), not "in transit" — some instances
//     carry months-old Pending orders that will never ship.
//   • Courier fee + packaging don't depend on the product, so an order line
//     whose product is unknown (deleted) still pays them from the defaults.
//
// Order attribution — the same rules as the Income Prediction family:
//   day     = the local calendar day of the order's `date`
//   page    = page_source, falling back to the customer snapshot's page
//   product = each DISTINCT product on the order (one order with two products
//             counts once for each — rare: ~1 in 100 orders)
//   closed  = every order (any status)   delivered = status Delivered
//   open    = Drafted / Pending / Confirmed / Shipped (may still deliver)
//   failed  = Cancelled / Returned / ReStock
import type { Product } from '../../types';
import { pageKeyOf, saleDayOf, statusOf, ratio, type Order } from '../pageIncomePrediction/metrics';
import { roundCents } from '../../utils/money';
import { addDays, daysBetween, inRange, parseDay, dayKeyFromDate, type DateRange } from '../../utils/dateRange';

export type { Order };

const EPS = 1e-9;

// ─── Inputs ───────────────────────────────────────────────────────────────

// The row a product falls back to, field by field, when it has no own value.
export const DEFAULT_SETTINGS_KEY = '__default__';

export interface ProductSettingRow {
    productId: string;                    // DEFAULT_SETTINGS_KEY = the defaults row
    courierFee: number | null;            // null = inherit
    packaging: number | null;
    desiredProfit: number | null;
    expectedDeliveryRate: number | null;  // 0..1
}

export type SettingField = 'courierFee' | 'packaging' | 'desiredProfit' | 'expectedDeliveryRate';
export const SETTING_FIELDS: SettingField[] = ['courierFee', 'packaging', 'desiredProfit', 'expectedDeliveryRate'];

// Used when neither the product nor the defaults row sets a field: neutral
// values, never invented costs. The view warns while courier/packaging are unset.
export const BUILTIN_SETTINGS: Record<SettingField, number> = { courierFee: 0, packaging: 0, desiredProfit: 0, expectedDeliveryRate: 1 };

export interface DailyEntryRow {
    date: string;                         // YYYY-MM-DD
    page: string;                         // pageKeyOf() value; '' = no page
    productId: string;                    // '' = unknown product
    adSpend: number;
    inboundChats: number | null;          // null = not entered
    closedOverride: number | null;        // null = use the counted orders
    deliveredOverride: number | null;
}

export type EntryField = 'adSpend' | 'inboundChats' | 'closedOverride' | 'deliveredOverride';
export type EntryPatch = Partial<Record<EntryField, number | null>>;

export const entryKey = (date: string, page: string, productId: string): string => `${date}|${page}|${productId}`;

// An entry with nothing in it is deleted rather than stored.
export const isEmptyEntry = (e: Pick<DailyEntryRow, 'adSpend' | 'inboundChats' | 'closedOverride' | 'deliveredOverride'>): boolean =>
    !(e.adSpend > 0) && e.inboundChats === null && e.closedOverride === null && e.deliveredOverride === null;

export interface MetricsInput {
    sales: Order[];
    entries: DailyEntryRow[];
    settings: ProductSettingRow[];
    products: Product[];                  // whole catalogue, active AND inactive
    range: DateRange;
    now: Date;
}

// ─── Unit economics (sheet 1) ─────────────────────────────────────────────

export type SettingSource = 'product' | 'default' | 'builtin';

export interface UnitEconomics {
    productId: string;
    name: string;
    model: string;
    isActive: boolean;
    price: number;
    cogs: number;
    courierFee: number;
    packaging: number;
    hardCosts: number;
    breakEvenCpa: number;
    desiredProfit: number;
    targetNetCpa: number;
    expectedDeliveryRate: number;
    targetGrossCpa: number;
    own: Record<SettingField, number | null>;      // the product's own values (null = inherited)
    source: Record<SettingField, SettingSource>;
}

export const settingsMapOf = (settings: ProductSettingRow[]): Map<string, ProductSettingRow> =>
    new Map(settings.map(s => [s.productId, s]));

const resolveField = (field: SettingField, own: ProductSettingRow | undefined, def: ProductSettingRow | undefined): { value: number; source: SettingSource } => {
    const mine = own?.[field];
    if (mine !== null && mine !== undefined && Number.isFinite(mine)) return { value: mine, source: 'product' };
    const fallback = def?.[field];
    if (fallback !== null && fallback !== undefined && Number.isFinite(fallback)) return { value: fallback, source: 'default' };
    return { value: BUILTIN_SETTINGS[field], source: 'builtin' };
};

export const unitEconomicsOf = (
    product: Pick<Product, 'id' | 'name' | 'model' | 'price' | 'purchaseCost' | 'isActive'>,
    settings: Map<string, ProductSettingRow>,
): UnitEconomics => {
    const own = settings.get(product.id);
    const def = settings.get(DEFAULT_SETTINGS_KEY);
    const courier = resolveField('courierFee', own, def);
    const packaging = resolveField('packaging', own, def);
    const desired = resolveField('desiredProfit', own, def);
    const delivery = resolveField('expectedDeliveryRate', own, def);
    const price = Number(product.price) || 0;
    const cogs = Number(product.purchaseCost) || 0;
    const hardCosts = cogs + courier.value + packaging.value;
    const breakEvenCpa = price - hardCosts;
    const targetNetCpa = breakEvenCpa - desired.value;
    return {
        productId: product.id,
        name: product.name || '',
        model: product.model || '',
        isActive: product.isActive !== false,
        price,
        cogs,
        courierFee: courier.value,
        packaging: packaging.value,
        hardCosts,
        breakEvenCpa,
        desiredProfit: desired.value,
        targetNetCpa,
        expectedDeliveryRate: delivery.value,
        targetGrossCpa: targetNetCpa * delivery.value,
        own: {
            courierFee: own?.courierFee ?? null,
            packaging: own?.packaging ?? null,
            desiredProfit: own?.desiredProfit ?? null,
            expectedDeliveryRate: own?.expectedDeliveryRate ?? null,
        },
        source: { courierFee: courier.source, packaging: packaging.source, desiredProfit: desired.source, expectedDeliveryRate: delivery.source },
    };
};

// The defaults row itself, for the Unit Economics table's first line.
export const defaultSettingsOf = (settings: Map<string, ProductSettingRow>): Record<SettingField, number | null> => {
    const def = settings.get(DEFAULT_SETTINGS_KEY);
    return {
        courierFee: def?.courierFee ?? null,
        packaging: def?.packaging ?? null,
        desiredProfit: def?.desiredProfit ?? null,
        expectedDeliveryRate: def?.expectedDeliveryRate ?? null,
    };
};

// True while some product that matters (active, or appearing in the range)
// has no courier fee or packaging from anywhere — its profit then silently
// leaves them out, so the view warns. Set once in the defaults row, or on
// every such product.
export const logisticsUnsetFor = (economics: UnitEconomics[], settings: Map<string, ProductSettingRow>, unknownProductsSold = false): boolean => {
    const anyBuiltin = economics.some(u => u.source.courierFee === 'builtin' || u.source.packaging === 'builtin');
    if (economics.length > 0 && !unknownProductsSold) return anyBuiltin;
    // No products, or order lines whose product is unknown: those can only
    // take courier/packaging from the defaults row.
    const def = settings.get(DEFAULT_SETTINGS_KEY);
    return anyBuiltin || def?.courierFee == null || def?.packaging == null;
};

// ─── Counted orders per (day, page, product) ──────────────────────────────

export const DELIVERED_STATUS = 'Delivered';
export const SHIPPED_STATUS = 'Shipped';
// Days after the sale day an order may stay open before it counts as not delivered.
export const STALE_OPEN_DAYS = 14;
export const FAILED_STATUSES: ReadonlySet<string> = new Set(['Cancelled', 'Returned', 'ReStock']);

export interface CountedFlow {
    date: string;
    page: string;
    productId: string;
    closed: number;          // orders (any status)
    delivered: number;       // orders now Delivered
    shippedDelivered: number; // orders whose status is Shipped or Delivered (status count, like Income Prediction)
    open: number;            // orders still on the way (may deliver)
    failed: number;          // Cancelled / Returned / ReStock
    deliveredUnits: number;  // Σ qty on delivered orders (a falsy qty counts 1, like COGS elsewhere)
    revenue: number;         // actual revenue of delivered orders (discount-scaled lines)
    deliveredShare: number;  // Σ 1 / (#products on the order) over delivered orders — courier/packaging basis
    openUnits: number;       // the same three for the orders still in transit
    openRevenue: number;
    openShare: number;
}

const emptyFlow = (date: string, page: string, productId: string): CountedFlow => ({
    date, page, productId, closed: 0, delivered: 0, shippedDelivered: 0, open: 0, failed: 0,
    deliveredUnits: 0, revenue: 0, deliveredShare: 0, openUnits: 0, openRevenue: 0, openShare: 0,
});

export const productKeyOfItem = (it: { id?: string | null }): string => String(it.id ?? '');

export const countOrders = (sales: Order[], range: DateRange, today: string): Map<string, CountedFlow> => {
    const out = new Map<string, CountedFlow>();
    for (const o of sales) {
        const day = saleDayOf(o);
        if (!inRange(day, range)) continue;
        const page = pageKeyOf(o);
        const st = statusOf(o);
        const isDelivered = st === DELIVERED_STATUS;
        const isFailed = FAILED_STATUSES.has(st) || (!isDelivered && daysBetween(day, today) > STALE_OPEN_DAYS);
        const isOpen = !isDelivered && !isFailed;
        const items = o.items || [];

        // Same per-order discount scaling as Prediction by Product, so a
        // delivered order's per-product revenue still sums to order.total
        // (also applied to in-transit orders, to value them the same way).
        let revenueScale = 1;
        let flatRevenuePerItem: number | null = null;
        if (!isFailed) {
            const rawItemSum = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);
            const total = o.total || 0;
            if (rawItemSum > 0) {
                revenueScale = total / rawItemSum;
                if (!Number.isFinite(revenueScale)) revenueScale = 1;
            } else if (total !== 0 && items.length > 0) {
                flatRevenuePerItem = total / items.length;
            }
        }
        const distinct = new Set(items.map(productKeyOfItem)).size || 1;
        const share = 1 / distinct;

        const seen = new Set<string>();
        for (const it of items) {
            const pid = productKeyOfItem(it);
            const key = entryKey(day, page, pid);
            let f = out.get(key);
            if (!f) { f = emptyFlow(day, page, pid); out.set(key, f); }
            const units = Number(it.quantity) || 1;
            const revenue = flatRevenuePerItem !== null ? flatRevenuePerItem : (Number(it.price) || 0) * (Number(it.quantity) || 0) * revenueScale;
            if (isDelivered) { f.deliveredUnits += units; f.revenue += revenue; }
            else if (isOpen) { f.openUnits += units; f.openRevenue += revenue; }
            if (seen.has(pid)) continue;   // one order counts once per product
            seen.add(pid);
            f.closed += 1;
            if (isDelivered || st === SHIPPED_STATUS) f.shippedDelivered += 1;
            if (isDelivered) { f.delivered += 1; f.deliveredShare += share; }
            else if (isFailed) f.failed += 1;
            else { f.open += 1; f.openShare += share; }
        }
    }
    return out;
};

// ─── Shared measure set (every table row is one of these) ─────────────────

// 'organic' = sales with no ad spend on that row/product: not an ad result,
// so it is never judged against a CPA target.
export type CpaStatus = 'none' | 'organic' | 'pending' | 'on-target' | 'squeeze' | 'loss';
export type Health = 'none' | 'pending' | 'healthy' | 'at-risk';
export type ProductStatus = 'none' | 'organic' | 'pending' | 'winner' | 'refresh';

interface Sums {
    spend: number;
    chats: number;
    chatsEntered: boolean;   // at least one chats figure was typed
    chatSpend: number;       // spend / closed of the rows that HAVE chats typed
    chatClosed: number;
    closed: number;
    delivered: number;
    shippedDelivered: number;
    open: number;
    failed: number;
    units: number;
    revenue: number;
    hardCosts: number;
    netProfit: number;
    openProfit: number;      // what the in-transit orders would add if all delivered
    adClosed: number;        // the same, over rows WITH ad spend only (CPA basis)
    adDelivered: number;
    adOpen: number;
    adNetProfit: number;
    adOpenProfit: number;
}

export interface Measures extends Sums {
    costPerChat: number | null;
    closingRate: number | null;     // closed / chats (chat rows only)
    grossCpa: number | null;        // ad spend / closed (advertised rows)
    deliveryRate: number | null;    // delivered / closed (all rows)
    netCpa: number | null;          // ad spend / delivered (advertised rows)
    margin: number | null;
    profitPerOrder: number | null;  // per delivered order (the sheet's profit per delivered unit, one unit per order)
}

const emptySums = (): Sums => ({
    spend: 0, chats: 0, chatsEntered: false, chatSpend: 0, chatClosed: 0,
    closed: 0, delivered: 0, shippedDelivered: 0, open: 0, failed: 0, units: 0, revenue: 0, hardCosts: 0, netProfit: 0, openProfit: 0,
    adClosed: 0, adDelivered: 0, adOpen: 0, adNetProfit: 0, adOpenProfit: 0,
});

const finish = (s: Sums): Measures => {
    const spend = roundCents(s.spend);
    return {
        ...s,
        spend,
        costPerChat: s.chatsEntered ? ratio(roundCents(s.chatSpend), s.chats) : null,
        closingRate: s.chatsEntered ? ratio(s.chatClosed, s.chats) : null,
        grossCpa: ratio(spend, s.adClosed),
        deliveryRate: ratio(s.delivered, s.closed),
        netCpa: ratio(spend, s.adDelivered),
        margin: ratio(s.netProfit, s.revenue),
        profitPerOrder: ratio(s.netProfit, s.delivered),
    };
};

const SUM_KEYS = ['spend', 'chats', 'chatSpend', 'chatClosed', 'closed', 'delivered', 'shippedDelivered', 'open', 'failed', 'units', 'revenue',
    'hardCosts', 'netProfit', 'openProfit', 'adClosed', 'adDelivered', 'adOpen', 'adNetProfit', 'adOpenProfit'] as const;

export const sumMeasures = (rows: Measures[]): Measures => {
    const acc = emptySums();
    for (const r of rows) {
        for (const k of SUM_KEYS) acc[k] += r[k];
        acc.chatsEntered = acc.chatsEntered || r.chatsEntered;
    }
    return finish(acc);
};

// ─── Verdicts ─────────────────────────────────────────────────────────────

// The sheet's CPA comparison, in profit form (see the file header).
const cpaVerdict = (profit: number, orders: number, desired: number): 'on-target' | 'squeeze' | 'loss' =>
    profit >= desired * orders - EPS ? 'on-target' : profit >= -EPS ? 'squeeze' : 'loss';

// A verdict is final only if it holds whether the in-transit orders deliver or not.
const settled = <T,>(now: T, ifAllDeliver: T, open: number): T | 'pending' => (open <= 0 || now === ifAllDeliver ? now : 'pending');

export const cpaStatusOf = (m: Pick<Measures, 'spend' | 'closed' | 'delivered' | 'open' | 'netProfit' | 'openProfit'>, desiredProfit: number | null): CpaStatus => {
    if (m.spend <= 0) return m.closed > 0 ? 'organic' : 'none';
    if (desiredProfit === null) return 'none';   // unknown product: no costs to judge with
    return settled(
        cpaVerdict(m.netProfit, m.delivered, desiredProfit),
        cpaVerdict(m.netProfit + m.openProfit, m.delivered + m.open, desiredProfit),
        m.open,
    );
};

export const healthOf = (m: Measures): Health => {
    if (m.closed <= 0 && m.spend <= 0) return 'none';
    const h = (profit: number): Health => (profit > EPS ? 'healthy' : 'at-risk');
    return settled(h(m.netProfit), h(m.netProfit + m.openProfit), m.open);
};

export const productStatusOf = (m: Measures, desiredProfit: number | null): ProductStatus => {
    if (m.spend <= 0) return m.closed > 0 ? 'organic' : 'none';
    if (desiredProfit === null) return 'none';
    const s = (profit: number, orders: number): ProductStatus => (cpaVerdict(profit, orders, desiredProfit) === 'on-target' ? 'winner' : 'refresh');
    return settled(s(m.adNetProfit, m.adDelivered), s(m.adNetProfit + m.adOpenProfit, m.adDelivered + m.adOpen), m.adOpen);
};

// ─── Daily rows (sheet 2) ─────────────────────────────────────────────────

export interface DailyRow extends Measures {
    key: string;                    // entryKey(date, page, productId)
    date: string;
    page: string;
    productId: string;
    productName: string;            // '' when the product is unknown
    hasEntry: boolean;
    inboundChats: number | null;    // as typed
    closedCounted: number;
    deliveredCounted: number;
    closedOverride: number | null;
    deliveredOverride: number | null;
    targetNetCpa: number | null;    // null = unknown product
    breakEvenCpa: number | null;
    status: CpaStatus;
}

interface Prepared {
    rows: DailyRow[];
    economics: Map<string, UnitEconomics>;
    settings: Map<string, ProductSettingRow>;
}

const rowOf = (key: string, date: string, page: string, productId: string, flow: CountedFlow, entry: DailyEntryRow | undefined, ue: UnitEconomics | undefined, defaultLogistics: number): DailyRow => {
    const closedO = entry?.closedOverride ?? null;
    const deliveredO = entry?.deliveredOverride ?? null;
    const closed = closedO ?? flow.closed;
    const delivered = deliveredO ?? flow.delivered;

    // In-transit / failed counts once a typed number replaces a count: a typed
    // delivered count is FINAL (everything else closed counts as not
    // delivered, as in the sheet); typed closed orders beyond the counted
    // ones have an unknown outcome until a delivered count is typed.
    let failed = flow.failed;
    let open = flow.open;
    if (deliveredO !== null) {
        open = 0;
        failed = Math.max(0, closed - delivered);
    } else if (closedO !== null) {
        failed = Math.min(flow.failed, Math.max(0, closed - delivered));
        const unknown = Math.max(0, closedO - flow.closed);
        open = Math.max(0, Math.min(flow.open + unknown, closed - delivered - failed));
    }

    // Per-order valuation basis: delivered orders, else in-transit ones, else
    // the list price × 1 unit (one product per order).
    const basis = (dRev: number, dUnits: number, dShare: number, dN: number, oRev: number, oUnits: number, oShare: number, oN: number) =>
        dN > 0 ? { rev: dRev / dN, units: dUnits / dN, share: dShare / dN }
            : oN > 0 ? { rev: oRev / oN, units: oUnits / oN, share: oShare / oN }
                : { rev: ue?.price ?? 0, units: 1, share: 1 };
    const perDelivered = basis(flow.revenue, flow.deliveredUnits, flow.deliveredShare, flow.delivered, flow.openRevenue, flow.openUnits, flow.openShare, flow.open);
    const perOpen = basis(flow.openRevenue, flow.openUnits, flow.openShare, flow.open, flow.revenue, flow.deliveredUnits, flow.deliveredShare, flow.delivered);

    const typedDelivered = deliveredO !== null;
    const units = typedDelivered ? delivered * perDelivered.units : flow.deliveredUnits;
    const revenue = typedDelivered ? delivered * perDelivered.rev : flow.revenue;
    const share = typedDelivered ? delivered * perDelivered.share : flow.deliveredShare;
    const typedOpen = closedO !== null || deliveredO !== null;
    const openUnits = typedOpen ? open * perOpen.units : flow.openUnits;
    const openRevenue = typedOpen ? open * perOpen.rev : flow.openRevenue;
    const openShare = typedOpen ? open * perOpen.share : flow.openShare;

    const cogs = ue?.cogs ?? 0;
    // Unknown product: no COGS known, but courier + packaging still come from the defaults.
    const logistics = ue ? ue.courierFee + ue.packaging : defaultLogistics;
    const hardCosts = units * cogs + share * logistics;
    const spend = entry?.adSpend ?? 0;
    const netProfit = revenue - hardCosts - roundCents(spend);
    const openProfit = openRevenue - openUnits * cogs - openShare * logistics;
    const chatsEntered = entry?.inboundChats !== null && entry?.inboundChats !== undefined;
    const advertised = spend > 0;

    const m = finish({
        spend,
        chats: entry?.inboundChats ?? 0,
        chatsEntered,
        chatSpend: chatsEntered ? spend : 0,
        chatClosed: chatsEntered ? closed : 0,
        closed, delivered, open, failed, units, revenue, hardCosts, netProfit, openProfit,
        // Counted Shipped+Delivered orders; a typed delivered count can only raise it
        // (every delivered order was shipped first).
        shippedDelivered: deliveredO !== null ? Math.max(delivered, flow.shippedDelivered) : flow.shippedDelivered,
        adClosed: advertised ? closed : 0,
        adDelivered: advertised ? delivered : 0,
        adOpen: advertised ? open : 0,
        adNetProfit: advertised ? netProfit : 0,
        adOpenProfit: advertised ? openProfit : 0,
    });
    return {
        ...m,
        key, date, page, productId,
        productName: ue?.name ?? '',
        hasEntry: !!entry,
        inboundChats: entry?.inboundChats ?? null,
        closedCounted: flow.closed,
        deliveredCounted: flow.delivered,
        closedOverride: closedO,
        deliveredOverride: deliveredO,
        targetNetCpa: ue ? ue.targetNetCpa : null,
        breakEvenCpa: ue ? ue.breakEvenCpa : null,
        status: cpaStatusOf(m, ue ? ue.desiredProfit : null),
    };
};

const prepare = (input: MetricsInput): Prepared => {
    const settings = settingsMapOf(input.settings);
    const economics = new Map<string, UnitEconomics>();
    for (const p of input.products) economics.set(p.id, unitEconomicsOf(p, settings));

    const counted = countOrders(input.sales, input.range, dayKeyFromDate(input.now));
    const entries = new Map<string, DailyEntryRow>();
    // An all-empty stored row (a cleanup that didn't land) is no row at all.
    for (const e of input.entries) if (inRange(e.date, input.range) && !isEmptyEntry(e)) entries.set(entryKey(e.date, e.page, e.productId), e);
    const def = settings.get(DEFAULT_SETTINGS_KEY);
    const defaultLogistics = resolveField('courierFee', undefined, def).value + resolveField('packaging', undefined, def).value;

    // Identity comes from the flow / entry objects themselves — never parsed
    // back out of the key (a page name may contain '|').
    const identities = new Map<string, { date: string; page: string; productId: string }>();
    for (const [key, f] of counted) identities.set(key, f);
    for (const [key, e] of entries) if (!identities.has(key)) identities.set(key, e);
    const rows: DailyRow[] = [];
    for (const [key, { date, page, productId }] of identities) {
        rows.push(rowOf(key, date, page, productId, counted.get(key) || emptyFlow(date, page, productId), entries.get(key), economics.get(productId), defaultLogistics));
    }
    // Newest day first; within a day by page, then by product NAME — a stable
    // order, so a row never jumps away while its cells are being edited.
    rows.sort((a, b) =>
        a.date !== b.date ? (a.date < b.date ? 1 : -1)
            : a.page !== b.page ? (a.page === '' ? 1 : b.page === '' ? -1 : a.page.localeCompare(b.page))
                : a.productName !== b.productName ? (a.productName === '' ? 1 : b.productName === '' ? -1 : a.productName.localeCompare(b.productName))
                    : a.productId.localeCompare(b.productId));
    return { rows, economics, settings };
};

// ─── Grouped views ────────────────────────────────────────────────────────

export interface DayGroup {
    date: string;
    rows: DailyRow[];
    subtotal: Measures;
}

export interface PageSummaryRow extends Measures {
    page: string;
    health: Health;
}

export interface ProductSummaryRow extends Measures {
    productId: string;
    productName: string;
    targetNetCpa: number | null;
    status: ProductStatus;
}

export interface WeekRow extends Measures {
    weekStart: string;              // Monday, YYYY-MM-DD (clipped to the range)
    weekEnd: string;                // Sunday (clipped)
    isoWeek: number;
    isoYear: number;
    partial: boolean;               // the range cuts the week short
    inProgress: boolean;            // the week hasn't ended yet (ends today or later)
    profitChange: number | null;    // vs the previous week (both whole and finished), (N − Nprev) / |Nprev|
    health: Health;
}

export interface CpaTrackerResult {
    days: DayGroup[];               // newest first
    totals: Measures;
    pages: PageSummaryRow[];        // net profit desc, no-page last
    products: ProductSummaryRow[];  // net profit desc
    weeks: WeekRow[];               // oldest first
    economics: UnitEconomics[];     // every ACTIVE product, plus inactive ones that appear in the range
    defaults: Record<SettingField, number | null>;
    logisticsUnset: boolean;
    pageOptions: string[];          // pages seen in the range's rows (for filters / the add form)
}

// ISO-8601 week (Monday start) of a YYYY-MM-DD day.
export const isoWeekOf = (day: string): { year: number; week: number; monday: string } => {
    const d = parseDay(day);
    const dow = (d.getDay() + 6) % 7;             // Monday = 0
    const monday = addDays(day, -dow);
    const thursday = parseDay(addDays(day, 3 - dow));
    const year = thursday.getFullYear();
    const dayOfYear = Math.round((Date.UTC(year, thursday.getMonth(), thursday.getDate()) - Date.UTC(year, 0, 1)) / 86400000);
    return { year, week: Math.floor(dayOfYear / 7) + 1, monday };
};

const byProfitDesc = <T extends Measures>(a: T, b: T): number =>
    b.netProfit !== a.netProfit ? b.netProfit - a.netProfit : b.spend - a.spend;

const groupBy = <K,>(rows: DailyRow[], keyOf: (r: DailyRow) => K): Map<K, DailyRow[]> => {
    const map = new Map<K, DailyRow[]>();
    for (const r of rows) {
        const k = keyOf(r);
        const list = map.get(k);
        if (list) list.push(r); else map.set(k, [r]);
    }
    return map;
};

export const buildCpaTracker = (input: MetricsInput): CpaTrackerResult => {
    const { rows, economics, settings } = prepare(input);

    const days: DayGroup[] = Array.from(groupBy(rows, r => r.date), ([date, list]) => ({ date, rows: list, subtotal: sumMeasures(list) }))
        .sort((a, b) => (a.date < b.date ? 1 : -1));

    const totals = sumMeasures(rows);

    const pages: PageSummaryRow[] = Array.from(groupBy(rows, r => r.page), ([page, list]) => {
        const m = sumMeasures(list);
        return { ...m, page, health: healthOf(m) };
    }).sort((a, b) => (a.page === '' ? 1 : b.page === '' ? -1 : byProfitDesc(a, b)));

    const products: ProductSummaryRow[] = Array.from(groupBy(rows, r => r.productId), ([productId, list]) => {
        const m = sumMeasures(list);
        const ue = economics.get(productId);
        return { ...m, productId, productName: ue?.name ?? '', targetNetCpa: ue ? ue.targetNetCpa : null, status: productStatusOf(m, ue ? ue.desiredProfit : null) };
    }).sort(byProfitDesc);

    // Weeks (Monday–Sunday), clipped to the range; every week the range touches
    // is listed, even an empty one, so week-over-week reads straight down.
    // Week-over-week is only given between two WHOLE, FINISHED weeks (a clipped
    // or still-running week has fewer days of data, so the change would be
    // meaningless — a Wednesday's week would always read as a collapse).
    const today = dayKeyFromDate(input.now);
    const weeks: WeekRow[] = [];
    let cursor = isoWeekOf(input.range.from).monday;
    while (cursor <= input.range.to) {
        const sunday = addDays(cursor, 6);
        const from = cursor < input.range.from ? input.range.from : cursor;
        const to = sunday > input.range.to ? input.range.to : sunday;
        const m = sumMeasures(rows.filter(r => r.date >= from && r.date <= to));
        const iso = isoWeekOf(cursor);
        const partial = from !== cursor || to !== sunday;
        const inProgress = sunday >= today;
        const prev = weeks[weeks.length - 1];
        const comparable = !!prev && !prev.partial && !prev.inProgress && !partial && !inProgress;
        weeks.push({
            ...m,
            weekStart: from,
            weekEnd: to,
            isoWeek: iso.week,
            isoYear: iso.year,
            partial,
            inProgress,
            profitChange: comparable && Math.abs(prev.netProfit) > 0.005 ? (m.netProfit - prev.netProfit) / Math.abs(prev.netProfit) : null,
            health: healthOf(m),
        });
        cursor = addDays(cursor, 7);
    }

    // Unit economics: every active product, plus any inactive one that still
    // appears in this range's rows. Sorted by name.
    const used = new Set(rows.map(r => r.productId));
    const econRows = Array.from(economics.values())
        .filter(u => u.isActive || used.has(u.productId))
        .sort((a, b) => a.name.localeCompare(b.name));

    const pageOptions = Array.from(new Set(rows.map(r => r.page))).sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));

    return {
        days,
        totals,
        pages,
        products,
        weeks,
        economics: econRows,
        defaults: defaultSettingsOf(settings),
        logisticsUnset: logisticsUnsetFor(econRows, settings, rows.some(r => !economics.has(r.productId) && r.delivered > 0)),
        pageOptions,
    };
};
