// Pure aggregation for the "Stock Movement Summary" popup
// (src/components/StockMovementSummaryModal.tsx). No React, no Supabase.
//
// Both views — per PRODUCT and per SALESMAN — bucket a stock_movements row through the
// ONE classifier below, so for the same period and warehouse the by-Salesman totals are
// equal to the by-Product totals by construction (the review harness checks it on live
// data). The buckets are exactly the ones the per-product recap has always used:
//   sold      out, not a wholesale order   (order shipped/delivered, manual out, …)
//   wholesale out, from a wholesale order
//   ret       in, Customer Return          (shown as "ReStock")
//   buy       in, anything else            (purchase-order receipts, manual in, …)

export interface MovementRow {
    id?: string | null;
    product_id?: string | null;
    product_name?: string | null;
    type?: string | null;
    quantity?: number | null;
    source?: string | null;
    reason?: string | null;
    reference_id?: string | null;   // retail order id for shipped/delivered stock-outs
    note?: string | null;           // "Restocked from order #<8 chars> …" for customer returns
    customer_phone?: string | null;
}

export type MovementKind = 'sold' | 'wholesale' | 'ret' | 'buy';

export const isWholesale = (m: MovementRow): boolean => m.source === 'Wholesale Order' || m.reason === 'Wholesale Sale';

export const kindOf = (m: MovementRow): MovementKind => {
    if (m.type === 'out') return isWholesale(m) ? 'wholesale' : 'sold';
    return m.source === 'Customer Return' ? 'ret' : 'buy';
};

export interface KindTotals { sold: number; wholesale: number; ret: number; buy: number }

export const emptyTotals = (): KindTotals => ({ sold: 0, wholesale: 0, ret: 0, buy: 0 });

/** Stock added minus stock removed. */
export const netOf = (t: KindTotals): number => (t.ret + t.buy) - (t.sold + t.wholesale);

export const movedOf = (t: KindTotals): number => t.sold + t.wholesale + t.ret + t.buy;

// ─── Per product ──────────────────────────────────────────────────────────

export interface ProductBucket extends KindTotals { name: string }

/** Same key the recap has always used: id, else name, else '?'. */
export const productKeyOf = (m: MovementRow): string => m.product_id || m.product_name || '?';

export const summarizeByProduct = (movements: MovementRow[]): Map<string, ProductBucket> => {
    const out = new Map<string, ProductBucket>();
    for (const m of movements) {
        const key = productKeyOf(m);
        let agg = out.get(key);
        if (!agg) { agg = { ...emptyTotals(), name: m.product_name || 'Unknown' }; out.set(key, agg); }
        agg[kindOf(m)] += m.quantity || 0;
    }
    return out;
};

// ─── Which order (and so which salesman) a movement belongs to ────────────
//
// "Salesman" = the salesman on the ORDER (sales.salesman), not the person who
// pressed Ship. Only two kinds of movement belong to a retail order:
//   • a stock-out for a shipped/delivered order — reference_id is the order id;
//   • a customer return — its note names the order as "#<first 8 chars of the id>"
//     (there is no reference_id on returns), which is NOT unique on its own, so it
//     is narrowed by the customer's phone and the returned product. A BULK restock
//     merges one product from SEVERAL orders into a single movement (quantity = the
//     sum of each order's quantity, note = "#a (name phone), #b (...), …"), so that
//     movement is split across the orders it lists, each getting its own quantity.
// Everything else (purchase-order receipts, manual adjustments, wholesale orders)
// has no retail salesman by nature.

/** A stock-out that belongs to a retail order: out, not wholesale, with an order reference. */
export const isRetailOut = (m: MovementRow): boolean => m.type === 'out' && !isWholesale(m) && !!m.reference_id;

export const isReturn = (m: MovementRow): boolean => m.type !== 'out' && m.source === 'Customer Return';

const digitsOf = (s: string | null | undefined): string => String(s ?? '').replace(/\D/g, '');

/** One order named in a return's note: its id prefix and, if written, its customer's phone. */
export interface ReturnSegment { prefix: string; phone: string | null }

/**
 * Every order a return's note names. Single restock: "Restocked from order #17902370 —
 * name | phone" (one segment; its phone is the movement's own customer_phone). Bulk
 * restock: "Bulk restocked from #17902370 (name 0965435105), #17905511 (name 012345678)"
 * — one segment per order, each with the phone written in its own parentheses.
 */
export const returnSegmentsOf = (note: string | null | undefined): ReturnSegment[] => {
    const out: ReturnSegment[] = [];
    const seen = new Set<string>();
    const re = /#([0-9A-Za-z]{6,12})(?:\s*\(([^)]*)\))?/g;
    const text = note || '';
    let hit: RegExpExecArray | null;
    while ((hit = re.exec(text)) !== null) {
        const last = (hit[2] || '').trim().split(/\s+/).pop() || '';
        const phone = digitsOf(last).length >= 8 ? last : null;
        const key = `${hit[1]}|${phone ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ prefix: hit[1], phone });
    }
    return out;
};

/** The first order named in a return's note. */
export const returnPrefixOf = (note: string | null | undefined): string | null => returnSegmentsOf(note)[0]?.prefix ?? null;

/** One order that a return's "#prefix" could refer to. */
export interface SaleCandidate {
    id: string;
    salesman: string;        // trimmed; '' = the order has no salesman
    phone: string;           // customer phone on the order (any format)
    items: { productId: string; quantity: number }[];
}

/** How many units of a product this order contained. */
export const qtyOfProduct = (s: SaleCandidate, productId: string | null | undefined): number =>
    productId ? s.items.reduce((a, i) => a + (i.productId === productId ? i.quantity : 0), 0) : 0;

export interface SalesmanLookups {
    /** Trimmed salesman for every order found (retail orders, plus deleted orders as a fallback). */
    salesmanBySaleId: ReadonlyMap<string, string>;
    /** Return "#prefix" -> the orders whose id starts with it. */
    returnCandidates: ReadonlyMap<string, SaleCandidate[]>;
}

// Same customer if the last 8 digits agree (numbers are stored with/without the
// leading 0 or country code). Both sides must have digits — an empty phone must
// never "match" everything.
const samePhone = (a: string, b: string): boolean => {
    const x = digitsOf(a), y = digitsOf(b);
    if (!x || !y) return false;
    return x.endsWith(y.slice(-8)) || y.endsWith(x.slice(-8));
};

/**
 * Narrow the orders an 8-char prefix could mean: by the customer's phone, then by
 * "this order actually contained the returned product". Each step is only applied
 * if it leaves at least one order.
 */
export const narrowCandidates = (candidates: SaleCandidate[], phone: string | null | undefined, productId: string | null | undefined): SaleCandidate[] => {
    let pool = candidates;
    if (pool.length > 1 && phone) {
        const byPhone = pool.filter(s => samePhone(s.phone, phone));
        if (byPhone.length > 0) pool = byPhone;
    }
    if (pool.length > 1 && productId) {
        const byProduct = pool.filter(s => qtyOfProduct(s, productId) > 0);
        if (byProduct.length > 0) pool = byProduct;
    }
    return pool;
};

/** The one salesman a pool of orders agrees on, or undefined if it is empty or they differ. */
export const salesmanOfPool = (pool: SaleCandidate[]): string | undefined => {
    if (pool.length === 0) return undefined;
    const names = new Set(pool.map(s => s.salesman));
    return names.size === 1 ? Array.from(names)[0] : undefined;
};

// ─── Per salesman ─────────────────────────────────────────────────────────

/** Rows that are not a real salesman, pinned below the named ones. */
export type SpecialRow = 'no-salesman' | 'unknown' | 'not-order';

export const SPECIAL_LABELS: Record<SpecialRow, string> = {
    'no-salesman': '(No salesman)',
    'unknown': '(Order unknown)',
    'not-order': '(Not from a retail order)',
};

export const SPECIAL_HINTS: Record<SpecialRow, string> = {
    'no-salesman': 'The order has no salesman set',
    'unknown': 'The order was deleted, or a return could not be matched to a single order',
    'not-order': 'Purchase-order receipts, manual adjustments and wholesale orders — not tied to a retail order',
};

// Fixed order of the pinned rows.
export const SPECIAL_ORDER: SpecialRow[] = ['no-salesman', 'unknown', 'not-order'];

export interface SalesmanProductRow extends KindTotals { id: string; name: string }

export interface SalesmanSummaryRow extends KindTotals {
    key: string;
    label: string;
    special: SpecialRow | null;
    // Movement lines touching this row: a shipped order line = 1; a bulk restock that is
    // split across salesmen counts once in each of them.
    movements: number;
    products: SalesmanProductRow[]; // what was moved under this salesman, most units first
}

interface Attribution { key: string; label: string; special: SpecialRow | null }

const specialAttribution = (s: SpecialRow): Attribution => ({ key: `special:${s}`, label: SPECIAL_LABELS[s], special: s });

const attributionOf = (salesman: string | undefined): Attribution => {
    if (salesman === undefined) return specialAttribution('unknown');
    if (salesman === '') return specialAttribution('no-salesman');
    return { key: `salesman:${salesman}`, label: salesman, special: null };
};

/** Part of one movement's quantity, credited to one salesman (or pinned row). */
export interface Portion { who: Attribution; qty: number }

// A bulk restock: one movement, several orders in its note. Each order gets ITS OWN
// quantity of the product; whatever can't be placed (an order that can't be found or
// pinned to one salesman, or a quantity that no longer adds up) is '(Order unknown)'.
// Every portion is capped by what is left, so the portions always add up to the
// movement's quantity exactly.
const splitBulkReturn = (m: MovementRow, segments: ReturnSegment[], lookups: SalesmanLookups): Portion[] => {
    let remaining = m.quantity || 0;
    const portions: Portion[] = [];
    for (const seg of segments) {
        if (remaining <= 0) break;
        const pool = narrowCandidates(lookups.returnCandidates.get(seg.prefix) || [], seg.phone, m.product_id);
        const orderQty = pool.length > 0 ? qtyOfProduct(pool[0], m.product_id) : 0;
        const qty = Math.min(remaining, orderQty);
        if (qty <= 0) continue;
        portions.push({ who: attributionOf(salesmanOfPool(pool)), qty });
        remaining -= qty;
    }
    if (remaining > 0) portions.push({ who: specialAttribution('unknown'), qty: remaining });
    // One entry per salesman.
    const merged = new Map<string, Portion>();
    for (const p of portions) {
        const prev = merged.get(p.who.key);
        if (prev) prev.qty += p.qty; else merged.set(p.who.key, { who: p.who, qty: p.qty });
    }
    return Array.from(merged.values());
};

/** Who a movement's quantity is credited to — usually one portion; a bulk restock can be several. */
export const attributeMovement = (m: MovementRow, lookups: SalesmanLookups): Portion[] => {
    const qty = m.quantity || 0;
    if (isRetailOut(m)) return [{ who: attributionOf(lookups.salesmanBySaleId.get(m.reference_id as string)), qty }];
    if (!isReturn(m)) return [{ who: specialAttribution('not-order'), qty }];
    const segments = returnSegmentsOf(m.note);
    if (segments.length === 0) return [{ who: specialAttribution('unknown'), qty }];
    if (segments.length === 1) {
        const pool = narrowCandidates(lookups.returnCandidates.get(segments[0].prefix) || [], m.customer_phone, m.product_id);
        return [{ who: attributionOf(salesmanOfPool(pool)), qty }];
    }
    return splitBulkReturn(m, segments, lookups);
};

/**
 * `productNames` (product key -> display name) makes every product carry ONE name
 * across all salesmen, the same one the By Product view shows. Without it a line
 * takes the `product_name` saved on whichever movement is seen first — a snapshot
 * from write time — so a renamed product could show under two different names.
 */
export const summarizeBySalesman = (
    movements: MovementRow[],
    lookups: SalesmanLookups,
    productNames?: ReadonlyMap<string, string>
): SalesmanSummaryRow[] => {
    const rows = new Map<string, SalesmanSummaryRow & { _p: Map<string, SalesmanProductRow> }>();

    for (const m of movements) {
        const kind = kindOf(m);
        const pk = productKeyOf(m);
        for (const { who, qty } of attributeMovement(m, lookups)) {
            let r = rows.get(who.key);
            if (!r) { r = { key: who.key, label: who.label, special: who.special, ...emptyTotals(), movements: 0, products: [], _p: new Map() }; rows.set(who.key, r); }
            r[kind] += qty;
            r.movements += 1;
            let p = r._p.get(pk);
            if (!p) { p = { id: pk, name: productNames?.get(pk) || m.product_name || 'Unknown', ...emptyTotals() }; r._p.set(pk, p); }
            p[kind] += qty;
        }
    }

    return Array.from(rows.values()).map(({ _p, ...r }) => ({
        ...r,
        products: Array.from(_p.values()).sort((a, b) => movedOf(b) - movedOf(a) || a.name.localeCompare(b.name)),
    }));
};
