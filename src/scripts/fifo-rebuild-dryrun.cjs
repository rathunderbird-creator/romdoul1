/**
 * READ-ONLY dry run of the one-time FIFO pool rebuild (design section 4).
 * It reads one store's live data, plans what migrations/fifo_rebuild_pool.sql
 * would do, and writes the plan to CSV + JSON. It never writes to the
 * database: every call below is a .select.
 *
 * Per product P:
 *   S  = products.stock (whole units; a fractional or negative stock is
 *        reported as an anomaly and floored at 0).
 *   U  = whole units on retail order lines that hold stock (Shipped /
 *        Delivered / Returned), whose order is not settled (payment_status
 *        Paid / Settled / Paid/Settled) and has no COGS entry (a TX-<tx>
 *        entry of that order's income row with a 5000 line, or
 *        ORD-<id>-COGS). The fractional part of a line is costed as
 *        shortfall at the fallback cost.
 *   Candidate rows = every inventory_items row of P, any status, newest
 *   first (created_at DESC, id DESC; created_at stands in for received_at).
 *   - rows 0..S-1     -> in_stock (consumer links cleared)
 *   - rows S..S+U-1   -> assigned to the U lines, oldest-shipped line gets
 *                        the oldest of these rows
 *   - older rows      -> left 'sold' when linked to a settled / COGS-booked
 *                        order that holds stock (history), else written_off
 *   - missing rows    -> filler layers (cost = last receipt cost from
 *                        restocks / received PO lines, else the fallback),
 *                        older than every kept row, so they fill the oldest
 *                        positions (the U slice first, then the in_stock tail)
 *   Kept or assigned rows at cost 0 are re-costed to fifo_fallback_cost:
 *   newest row of P with cost > 0 (any status), else purchase_cost, else 0.
 *
 * Ledger:
 *   V  = sum in_stock layer cost + sum cogs_cost of the U lines
 *   B  = 1300 balance over every entry (Posted + Draft)
 *   SU = COGS booked for orders whose goods are still on hand (a COGS entry,
 *        status not Shipped / Delivered / Returned): the net 1300 credit of
 *        their COGS entries. Their units are inside S, but 1300 was already
 *        credited for them (design section 3: 1300 = pool + shipped-unsettled
 *        - booked settled-unshipped). Orders with no line, or whose amount
 *        rounds to 0, are left out.
 *   D1 = sum over the same S+U units of (layer cost - basis cost), where the
 *        basis cost is products.purchase_cost unless --basis overrides it
 *   E  = what left 1300 since the basis entry beyond the basis cost, for the
 *        products whose basis is overridden (--basis-ref names the entry,
 *        e.g. TRUEUP-20261112; see basisSalesE): per order / adjustment with
 *        an overridden line and an entry after the basis entry, only the
 *        cost difference of its overridden lines — read from the ledger when
 *        every line is overridden and each amount held lies between those
 *        lines at the basis and at the cost booked, else from the lines. A
 *        duplicate entry or any other extra 1300 change is never absorbed.
 *        NR-3026 sold at 9.30 against the 9.00 basis adds 0.30 a unit. No
 *        basis entry, no overrides: E = 0.
 *   An order's COGS = its TX / ORD-<id>-COGS entries net of -COGS-ADJ and
 *   -COGS-REV; an order a COGS-REV reversed in full is not booked (it can
 *   be in U again).
 *   --u-returned-after-basis (the Romdoul1 preset): a Returned order the
 *   basis entry still counted stays in U although Returned is not a U status
 *   (see returnedAfterBasis).
 *   Guard: |D1 - (V - SU - B - E)| <= 1, i.e. basis x (S+U) - SU - E must
 *   equal B. When it fails, the rebuild must not book D1. The rebuild
 *   records SU on those orders' lines as cogs_booked, so the FIFO check
 *   counts it.
 *   FIFO-REVAL = D1 + E (= V - SU - B up to the guard residual), so after
 *   the rebuild 1300 = V - SU and the FIFO check variance is that residual
 *   (0 when the guard difference is 0).
 *
 * Usage:
 *   node src/scripts/fifo-rebuild-dryrun.cjs --store=Romdoul1|Romdoul2|Romdoul3 --out=<dir>
 *        --preset=romdoul1_trueup_2026_11_12|default
 *   or, instead of --preset, the options one by one:
 *        [--basis=<product name or id>=<cost>[,...]] [--basis-ref=<reference_id>]
 *        [--u-statuses=Shipped,Delivered[,Returned]] [--u-from=YYYY-MM-DD]
 *        [--u-returned-after-basis]
 *   --preset  the same named option sets as migrations/fifo_rebuild_pool.sql:
 *             romdoul1_trueup_2026_11_12 = --basis=NR-3026=9
 *               --basis-ref=TRUEUP-20261112 --u-statuses=Shipped,Delivered
 *               --u-from=2026-10-21 --u-returned-after-basis;
 *             default = no basis override, U = Shipped, Delivered, Returned,
 *               no cutoff.
 *   --store   defaults to Romdoul1.
 *   --out     is required: the CSVs hold live store data, so nothing is
 *             written into the working tree by default.
 *   --basis   sets the basis cost the ledger carries for a product when it
 *             differs from today's purchase_cost (for example a cost changed
 *             after the true-up). It changes D1 and the guard only.
 *   --basis-ref the reference_id of the one journal entry that set that
 *             basis (the true-up); E counts what moved after its created_at.
 */
const fs = require('fs');
const path = require('path');

const SETTLED = new Set(['Paid', 'Settled', 'Paid/Settled']);
const HOLDS_STOCK = new Set(['Shipped', 'Delivered', 'Returned']);
// Kept in step with the presets of migrations/fifo_rebuild_pool.sql.
const PRESETS = {
    romdoul1_trueup_2026_11_12: { basis: ['NR-3026=9'], basisRef: 'TRUEUP-20261112', uStatuses: ['Shipped', 'Delivered'], uFrom: '2026-10-21', uReturnedAfterBasis: true },
    default: { basis: [], basisRef: null, uStatuses: null, uFrom: null, uReturnedAfterBasis: false },
};
const PAGE = 1000;

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const r4 = (v) => Math.round((v + Number.EPSILON) * 10000) / 10000;

// A sortable key with microsecond precision from a PostgREST timestamptz.
function tsKey(ts) {
    if (!ts) return 0;
    const s = String(ts);
    const ms = Date.parse(s);
    if (!Number.isFinite(ms)) return 0;
    const m = s.match(/\.(\d+)/);
    const micro = m ? Number((m[1] + '000000').slice(3, 6)) : 0;
    return ms * 1000 + micro;
}

// The FIFO key of a row: received_at (phase 1), else created_at (a store
// without phase 1, where received_at would be backfilled from it).
const recvOf = (r) => r.received_at || r.created_at;

// Newest first: received DESC, id DESC (the order the SQL rebuild uses).
function newestFirst(a, b) {
    const d = tsKey(recvOf(b)) - tsKey(recvOf(a));
    if (d !== 0) return d;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * E: what left 1300 since the basis entry beyond the basis cost, for the
 * products whose basis is overridden (the same rule as the SQL rebuild).
 * A subject is a retail order, a wholesale order or a stock adjustment that
 * has at least one line of an overridden product and at least one entry
 * touching 1300 created after the basis entry. E only ever explains the
 * cost difference of the overridden lines; anything else stays in the guard.
 * Per subject:
 *   c_pre / c_post = net 1300 credit of its entries created up to / after it
 *   sg = +1 (retail / wholesale: a credit takes its quantity out), -1 (stock
 *     adjustment: lines are signed, a removal is < 0)
 *   held(x) = round(x, 2) > 0 (adjustment: <> 0); held before = held(c_pre);
 *     held after = held(c_pre + c_post), and for a retail order only while
 *     the rebuild counts it as booked (a COGS-REV that reversed it in full
 *     un-books it)
 *   d = held after - held before (+1 booked after the cutoff, -1 reversed
 *     after it, 0 neither); 0 for an order in SU (SU counts what it booked)
 *   per line: b = basis cost, c = the cost the ledger books it at (the
 *     adjustment line's unit_cost when > 0, else purchase_cost)
 *   X (cost difference) = sg x d x sum over overridden lines of q x (c - b)
 *   L (ledger) = c_post - sg x d x sum over every line of q x b
 *   E_subject = L when the subject is pure (every line with a quantity is
 *     overridden) and each amount the ledger held (sg x c_pre when held
 *     before, sg x (c_pre + c_post) when held after) lies between the
 *     overridden lines at b and at c, give or take a cent a unit (and
 *     |c_post| <= a cent a unit when held neither before nor after); else X.
 *     So a duplicate entry, a re-cost beyond purchase_cost or a quantity
 *     change is never absorbed, and a mixed order never reads the cost of its
 *     other products.
 *   E = sum of round(E_subject, 2).
 * E > 0 when more left 1300 than the basis cost (NR-3026 sold at 9.30
 * against a 9.00 basis: +0.30 a unit). bs = {basis_ref, cutoff, subjects:
 * [{kind, id, c_pre, c_post, refs, lines: [{product_id, q, uc}]}]};
 * ctx = {pcOf: Map product -> purchase_cost, booked: Set of booked orders}.
 */
function basisSalesE(bs, basis, basisOf, suSet, ctx = {}) {
    const none = { basis_ref: bs ? bs.basis_ref || null : null, cutoff: bs ? bs.cutoff || null : null, E: 0, subjects: [] };
    if (!bs || !bs.cutoff || !basis || basis.size === 0) return none;
    const pcOf = ctx.pcOf || new Map();
    const booked = ctx.booked || null;
    const subjects = [];
    for (const s of bs.subjects || []) {
        const lines = s.lines.filter((l) => basisOf.has(l.product_id)).map((l) => ({
            q: l.q, over: basis.has(l.product_id), b: basisOf.get(l.product_id),
            c: num(l.uc) > 0 ? num(l.uc) : num(pcOf.get(l.product_id)),
        }));
        if (!lines.some((l) => l.over)) continue;
        const sg = s.kind === 'adjustment' ? -1 : 1;
        const inSu = s.kind === 'retail' && suSet.has(s.id);
        const held = (x) => (s.kind === 'adjustment' ? r2(x) !== 0 : r2(x) > 0);
        const hb = held(s.c_pre);
        const ha = held(s.c_pre + s.c_post) && (s.kind !== 'retail' || !booked || booked.has(s.id));
        const d = inSu ? 0 : (ha ? 1 : 0) - (hb ? 1 : 0);
        let bv = 0, overQty = 0, overAbs = 0, xUnit = 0, r1 = 0, r3 = 0, pure = true;
        for (const l of lines) {
            bv += l.q * l.b;
            if (l.over) {
                overQty += l.q; overAbs += Math.abs(l.q); xUnit += l.q * (l.c - l.b);
                r1 += l.q * Math.min(l.b, l.c); r3 += l.q * Math.max(l.b, l.c);
            } else if (l.q !== 0) pure = false;
        }
        const lo = Math.min(r1, r3), hi = Math.max(r1, r3), tol = 0.01 * overAbs;
        const inRange = (a) => a >= lo - tol - 1e-9 && a <= hi + tol + 1e-9;
        const X = sg * d * xUnit;
        const Lg = inSu ? 0 : s.c_post - sg * d * bv;
        const ledgerOk = pure && !inSu && (!hb || inRange(sg * s.c_pre)) && (!ha || inRange(sg * (s.c_pre + s.c_post)))
            && (hb || ha || Math.abs(s.c_post) <= tol + 1e-9);
        const note = inSu ? 'in SU (booked amount already counted)' : d > 0 ? 'booked after the cutoff'
            : d < 0 ? 'reversed after the cutoff' : ha ? 'held before and after the cutoff' : 'not held after the cutoff';
        const source = inSu ? 'SU' : ledgerOk ? 'ledger' : pure ? 'cost difference (ledger outside basis..cost)' : 'cost difference (mixed)';
        subjects.push({
            kind: s.kind, id: s.id, refs: s.refs.slice().sort(),
            booked_before_cutoff: r2(s.c_pre), booked_after_cutoff: r2(s.c_post),
            overridden_qty: r4(overQty), basis_value: r2(bv), direction: d,
            ledger_excess: r2(Lg), cost_excess: r2(X), E: ledgerOk ? r2(Lg) : r2(X), source, note,
        });
    }
    subjects.sort((a, b) => (a.kind !== b.kind ? (a.kind < b.kind ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { basis_ref: bs.basis_ref || null, cutoff: bs.cutoff, E: r2(subjects.reduce((t, s) => t + s.E, 0)), subjects };
}

// The ledger side of E (see basisSalesE): every entry touching 1300, by
// subject, split at the basis entry's created_at. Refuses unless exactly one
// entry carries basisRef.
const UUID_RE = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
// The created_at of the one entry that set the basis (null without basisRef).
function basisCutoff(raw, basisRef) {
    if (!basisRef) return null;
    const hits = raw.entries.filter((e) => e.reference_id === basisRef);
    if (hits.length !== 1) throw new Error(`the basis entry ${basisRef} matches ${hits.length} journal entries (expected exactly one)`);
    if (!hits[0].created_at) throw new Error(`the basis entry ${basisRef} has no created_at`);
    return hits[0].created_at;
}
function basisSalesInput(raw, facts, basisRef) {
    if (!basisRef) return null;
    const cutoff = basisCutoff(raw, basisRef);
    const cutKey = tsKey(cutoff);
    const txOrder = new Map(raw.txs.filter((t) => t.order_id !== null && t.order_id !== undefined).map((t) => [t.id, t.order_id]));
    const subjectOf = (ref) => {
        let m;
        if ((m = ref.match(/^ORD-(.+)-COGS-ADJ$/)) || (m = ref.match(/^ORD-(.+)-COGS-REV$/)) || (m = ref.match(/^ORD-(.+)-COGS$/))) return ['retail', m[1]];
        if ((m = ref.match(/^TX-(.+)$/)) && txOrder.has(m[1])) return ['retail', txOrder.get(m[1])];
        if ((m = ref.match(new RegExp(`^WSO-(${UUID_RE})-COGS`)))) return ['wholesale', m[1]];
        if ((m = ref.match(/^ADJ-(.+)$/))) return ['adjustment', m[1]];
        return null;
    };
    const subj = new Map();
    for (const e of raw.entries) {
        if (!facts.invOutByEntry.has(e.id) || !e.reference_id) continue;
        const k = subjectOf(e.reference_id);
        if (!k) continue;
        const key = k.join('|');
        if (!subj.has(key)) subj.set(key, { kind: k[0], id: k[1], c_pre: 0, c_post: 0, refs: [], post: false, lines: [] });
        const s = subj.get(key);
        const out = facts.invOutByEntry.get(e.id);
        if (tsKey(e.created_at) > cutKey) { s.c_post += out; s.refs.push(e.reference_id); s.post = true; } else s.c_pre += out;
    }
    const add = (kind, id, product_id, q, uc) => {
        const s = subj.get(`${kind}|${id}`);
        if (s && product_id) s.lines.push({ product_id, q, uc });
    };
    for (const li of raw.saleItems) add('retail', li.sale_id, li.product_id, Math.max(0, num(li.quantity)), null);
    for (const li of raw.wholesaleItems || []) add('wholesale', li.wholesale_order_id, li.product_id, Math.max(0, num(li.quantity)), null);
    for (const li of raw.adjLines || []) add('adjustment', li.adjustment_id, li.product_id, num(li.quantity), li.unit_cost);
    return { basis_ref: basisRef, cutoff, subjects: [...subj.values()].filter((s) => s.post) };
}

// Returned orders that the basis entry still counted: unsettled, not
// booked, not restocked (no 'in' movement), Returned now while 'Returned'
// is not a U status, and either created after the basis entry or edited
// after it with the latest status the activity log records at or before it
// one of Pending / Confirmed / Shipped / Delivered. Their goods were in S or
// U at the true-up, so 1300 still holds them: they stay in U. An order the
// log cannot place stays out (the guard then fails, it is never absorbed).
// Map order id -> its status at the cutoff.
const PRE_RETURN = new Set(['Pending', 'Confirmed', 'Shipped', 'Delivered']);
function returnedAfterBasis(raw, cutoff, uStatuses, cogsOrders) {
    const out = new Map();
    if (!cutoff || uStatuses.has('Returned')) return out;
    const cutKey = tsKey(cutoff);
    const back = new Set();
    for (const m of raw.moves || []) if (m.type === 'in') { if (m.reference_id) back.add(m.reference_id); if (m.order_id) back.add(m.order_id); }
    const logs = new Map();
    for (const l of raw.statusLogs || []) {
        if (!l.order_id || l.status === null || l.status === undefined || tsKey(l.created_at) > cutKey) continue;
        const cur = logs.get(l.order_id);
        const k = tsKey(l.created_at);
        if (!cur || k > cur.k || (k === cur.k && String(l.id) > String(cur.id))) logs.set(l.order_id, { k, id: l.id, status: l.status });
    }
    for (const s of raw.sales) {
        if (s.shipping_status !== 'Returned' || SETTLED.has(s.payment_status || '') || cogsOrders.has(s.id) || back.has(s.id)) continue;
        let st = null;
        if (s.created_at && tsKey(s.created_at) > cutKey) st = 'created after the basis entry';
        else if (s.last_edited_at && tsKey(s.last_edited_at) > cutKey) st = logs.has(s.id) ? logs.get(s.id).status : null;
        if (st === 'created after the basis entry' || PRE_RETURN.has(st)) out.set(s.id, st);
    }
    return out;
}

/**
 * Pure planner, no I/O. migrations/fifo_rebuild_pool.sql implements the same
 * plan in SQL; tests/fifo-rebuild.test.mjs runs both on one database and
 * compares them, so a change here needs the same change there. Input:
 *   products   [{id, name, stock, purchase_cost}]
 *   items      [{id, product_id, cost_of_purchase, status, sale_id, received_at?, created_at}]
 *   sales      Map id -> {shipping_status, payment_status, date}
 *   saleItems  [{id, sale_id, product_id, quantity}]
 *   cogsOrders Set of order ids that have a COGS entry
 *   cogsBooked Map order id -> net 1300 credit of its COGS entries
 *   shipAt     Map order id -> ship timestamp (falls back to sales.date)
 *   receiptCost Map product id -> {cost, source} (last receipt cost > 0)
 *   B          1300 balance (number)
 *   basis      Map product id -> basis cost override
 *   uStatuses  Set of shipping statuses whose unsettled lines form U
 *              (default Shipped, Delivered, Returned)
 *   uFrom      timestamp; orders dated before it are left out of U
 *   ledgerStart timestamp of the opening entry (for the residual breakdown)
 *   basisSales {basis_ref, cutoff, subjects} from basisSalesInput, for E
 */
function planStore(input) {
    const { products, items, sales, saleItems, cogsOrders, shipAt, receiptCost, B } = input;
    const basis = input.basis || new Map();
    const uStatuses = input.uStatuses || HOLDS_STOCK;
    const uFromKey = input.uFrom ? tsKey(input.uFrom) : null;
    const ledgerStartKey = input.ledgerStart ? tsKey(input.ledgerStart) : null;
    const basisOf = new Map(products.map((p) => [p.id, basis.has(p.id) ? basis.get(p.id) : num(p.purchase_cost)]));

    const rowsByProduct = new Map();
    for (const it of items) {
        if (!rowsByProduct.has(it.product_id)) rowsByProduct.set(it.product_id, []);
        rowsByProduct.get(it.product_id).push(it);
    }
    const isSettled = (sid) => SETTLED.has((sales.get(sid) || {}).payment_status || '');
    const holds = (sid) => HOLDS_STOCK.has((sales.get(sid) || {}).shipping_status || '');
    const isUnsettledHolding = (sid) => holds(sid) && !isSettled(sid) && !cogsOrders.has(sid);
    const isHistory = (sid) => holds(sid) && (isSettled(sid) || cogsOrders.has(sid));

    // Booked, goods still on hand (SU).
    const cogsBooked = input.cogsBooked || new Map();
    const ordersWithLines = new Set(saleItems.map((li) => li.sale_id));
    const suOrders = [];
    for (const [sid, sale] of sales) {
        if (holds(sid) || !cogsOrders.has(sid) || !ordersWithLines.has(sid)) continue;
        const amt = r2(num(cogsBooked.get(sid)));
        if (amt === 0) continue;
        suOrders.push({ order_id: sid, shipping_status: sale.shipping_status || '', payment_status: sale.payment_status || '', booked: amt });
    }
    suOrders.sort((a, b) => (a.order_id < b.order_id ? -1 : a.order_id > b.order_id ? 1 : 0));
    const SU = r2(suOrders.reduce((t, o) => t + o.booked, 0));
    const basisSales = basisSalesE(input.basisSales, basis, basisOf, new Set(suOrders.map((o) => o.order_id)),
        { pcOf: new Map(products.map((p) => [p.id, num(p.purchase_cost)])), booked: cogsOrders });
    const E = basisSales.E;
    // Returned orders the basis entry still counted (returnedAfterBasis): in U
    // although 'Returned' is not a U status.
    const uRet = input.uReturnedAfter || new Map();
    const inUStatus = (sid, st) => uStatuses.has(st) || uRet.has(sid);

    const uLinesByProduct = new Map();
    const diag = { settledNoCogsOrders: new Set(), cogsNotSettledOrders: new Set(), fractionalLines: 0 };
    const excluded = { by_status: { orders: new Set(), qty: 0, basis_value: 0 }, before_u_from: { orders: new Set(), qty: 0, basis_value: 0 } };
    const retKept = new Map();
    const explain = { returned_u: 0, pre_ledger_start_u: 0 };
    for (const li of saleItems) {
        if (!li.product_id || !holds(li.sale_id)) continue;
        const settled = isSettled(li.sale_id);
        const booked = cogsOrders.has(li.sale_id);
        if (settled && !booked) diag.settledNoCogsOrders.add(li.sale_id);
        if (!settled && booked) diag.cogsNotSettledOrders.add(li.sale_id);
        if (settled || booked) continue;
        const q = Math.max(0, num(li.quantity));
        if (q === 0) continue;
        const s = sales.get(li.sale_id) || {};
        const atBasis = q * (basisOf.get(li.product_id) || 0);
        const ex = !inUStatus(li.sale_id, s.shipping_status) ? excluded.by_status
            : uFromKey !== null && tsKey(s.date) < uFromKey ? excluded.before_u_from : null;
        if (ex) {
            if (!basisOf.has(li.product_id)) continue;
            ex.orders.add(li.sale_id); ex.qty += q; ex.basis_value += atBasis; continue;
        }
        if (!uStatuses.has(s.shipping_status) && basisOf.has(li.product_id)) {
            const k = retKept.get(li.sale_id) || { order_id: li.sale_id, status_at_cutoff: uRet.get(li.sale_id), qty: 0, basis_value: 0 };
            k.qty += q; k.basis_value += atBasis; retKept.set(li.sale_id, k);
        }
        if (s.shipping_status === 'Returned' && !uRet.has(li.sale_id)) explain.returned_u += atBasis;
        else if (ledgerStartKey !== null && tsKey(s.date) < ledgerStartKey) explain.pre_ledger_start_u += atBasis;
        const poolUnits = Math.floor(q);
        const frac = r4(q - poolUnits);
        if (frac > 0) diag.fractionalLines++;
        const ship = shipAt.get(li.sale_id) || s.date || null;
        if (!uLinesByProduct.has(li.product_id)) uLinesByProduct.set(li.product_id, []);
        uLinesByProduct.get(li.product_id).push({
            order_id: li.sale_id, line_id: li.id, product_id: li.product_id, quantity: q,
            pool_units: poolUnits, frac, ship_at: ship, order_date: s.date || '',
            shipping_status: s.shipping_status || '', payment_status: s.payment_status || '',
        });
    }
    const inactiveS = products.filter((p) => p.is_active === false && num(p.stock) > 0)
        .map((p) => ({ product_id: p.id, name: p.name, stock: num(p.stock), basis_value: r2(Math.max(0, Math.floor(num(p.stock))) * basisOf.get(p.id)) }));

    const productIds = new Set(products.map((p) => p.id));
    const orphanProducts = [...rowsByProduct.keys()].filter((id) => !productIds.has(id));

    const productRows = [];
    const rowPlan = [];
    const linePlan = [];
    const anomalies = [];

    for (const p of products) {
        const pc = num(p.purchase_cost);
        const basisCost = basisOf.get(p.id);
        const rawStock = num(p.stock);
        const S = Math.max(0, Math.floor(rawStock));
        if (rawStock !== S) anomalies.push({ product_id: p.id, name: p.name, issue: `stock ${rawStock} is not a whole non-negative number; planned as ${S}` });

        const rows = (rowsByProduct.get(p.id) || []).slice().sort(newestFirst);
        const lines = (uLinesByProduct.get(p.id) || []).slice().sort((a, b) => {
            const d = tsKey(a.ship_at) - tsKey(b.ship_at);
            if (d !== 0) return d;
            if (a.order_id !== b.order_id) return a.order_id < b.order_id ? -1 : 1;
            return a.line_id < b.line_id ? -1 : a.line_id > b.line_id ? 1 : 0;
        });
        const U = lines.reduce((s, l) => s + l.pool_units, 0);
        const fracU = r4(lines.reduce((s, l) => s + l.frac, 0));

        // fifo_fallback_cost as it stands after the rebuild.
        const newestPriced = rows.find((r) => num(r.cost_of_purchase) > 0);
        let fallback;
        if (newestPriced) fallback = { cost: num(newestPriced.cost_of_purchase), source: 'newest row cost > 0' };
        else if (pc > 0) fallback = { cost: pc, source: 'purchase_cost' };
        else fallback = { cost: 0, source: 'none (0)' };
        const rc = receiptCost.get(p.id);
        const fillerCost = rc && rc.cost > 0 ? rc : fallback;

        const need = S + U;
        const units = [];
        let recosted = 0;
        for (let i = 0; i < rows.length && i < need; i++) {
            const r = rows[i];
            const old = num(r.cost_of_purchase);
            const cost = old > 0 ? old : fallback.cost;
            if (!(old > 0)) recosted++;
            units.push({ row: r, cost, recost: !(old > 0) });
        }
        const fillers = Math.max(0, need - rows.length);
        for (let k = 0; k < fillers; k++) units.push({ row: null, cost: fillerCost.cost, filler: k + 1 });

        const c = {
            kept_in_stock: 0, filler_in_stock: 0, assigned_rows: 0, filler_assigned: 0,
            history_sold: 0, wo_surplus_in_stock: 0, wo_returned: 0, wo_sold_null_sale: 0,
            wo_sold_missing_sale: 0, wo_sold_not_holding: 0, wo_sold_unsettled_unassigned: 0,
            pulled_from_history: 0,
        };
        let valueInStock = 0;
        for (let i = 0; i < S; i++) {
            const u = units[i];
            valueInStock += u.cost;
            if (u.row) {
                c.kept_in_stock++;
                if (u.row.status === 'sold' && u.row.sale_id && isHistory(u.row.sale_id)) c.pulled_from_history++;
            } else c.filler_in_stock++;
            rowPlan.push(rowRecord(p, u, 'in_stock', '', '', u.row ? (u.recost ? 'keep in_stock (re-costed)' : 'keep in_stock') : 'insert filler in_stock'));
        }

        // The U slice, oldest unit first, handed to the oldest-shipped line first.
        const uSlice = units.slice(S, S + U).reverse();
        let k = 0;
        let valueU = 0;
        for (const l of lines) {
            let cost = 0;
            let fillerUnits = 0;
            for (let j = 0; j < l.pool_units; j++, k++) {
                const u = uSlice[k];
                cost += u.cost;
                if (u.row) {
                    c.assigned_rows++;
                    if (u.row.status === 'sold' && u.row.sale_id && isHistory(u.row.sale_id)) c.pulled_from_history++;
                } else { c.filler_assigned++; fillerUnits++; }
                rowPlan.push(rowRecord(p, u, 'sold', l.order_id, l.line_id, u.row ? (u.recost ? 'assign to unsettled order (re-costed)' : 'assign to unsettled order') : 'insert filler sold'));
            }
            const shortCost = l.frac * fallback.cost;
            cost += shortCost;
            valueU += cost;
            linePlan.push({
                order_id: l.order_id, line_id: l.line_id, product_id: p.id, product_name: p.name,
                shipping_status: l.shipping_status, payment_status: l.payment_status, order_date: l.order_date,
                ship_at: l.ship_at || '', quantity: l.quantity,
                pool_units: l.pool_units, filler_units: fillerUnits, cogs_short_qty: l.frac,
                cogs_cost: r4(cost), cost_at_basis: r4(l.quantity * basisCost),
            });
        }

        for (let i = need; i < rows.length; i++) {
            const r = rows[i];
            const u = { row: r, cost: num(r.cost_of_purchase), recost: false };
            let reason;
            if (r.status === 'sold' && r.sale_id && isHistory(r.sale_id)) {
                c.history_sold++;
                rowPlan.push(rowRecord(p, u, 'sold', r.sale_id, '', 'keep sold (history)'));
                continue;
            }
            if (r.status === 'in_stock') { c.wo_surplus_in_stock++; reason = 'surplus in_stock'; }
            else if (r.status === 'returned') { c.wo_returned++; reason = 'returned'; }
            else if (!r.sale_id) { c.wo_sold_null_sale++; reason = 'sold, no sale_id'; }
            else if (!sales.has(r.sale_id)) { c.wo_sold_missing_sale++; reason = 'sold, sale missing'; }
            else if (isUnsettledHolding(r.sale_id)) { c.wo_sold_unsettled_unassigned++; reason = 'sold on unsettled order, not in the U slice'; }
            else { c.wo_sold_not_holding++; reason = `sold on ${(sales.get(r.sale_id) || {}).shipping_status || 'Pending'} order`; }
            rowPlan.push(rowRecord(p, u, 'written_off', 'FIFO-REBUILD', '', 'write off: ' + reason));
        }

        const nowInStock = rows.filter((r) => r.status === 'in_stock').length;
        const nowSold = rows.filter((r) => r.status === 'sold').length;
        const fillerTotal = c.filler_in_stock + c.filler_assigned;
        const basisValue = basisCost * (S + U + fracU);
        const value = valueInStock + valueU;
        const writtenOff = c.wo_surplus_in_stock + c.wo_returned + c.wo_sold_null_sale + c.wo_sold_missing_sale + c.wo_sold_not_holding + c.wo_sold_unsettled_unassigned;
        if (rows.length === 0 && need === 0) continue;
        productRows.push({
            product_id: p.id, name: p.name, purchase_cost: pc, basis_cost: basisCost,
            S, U, u_lines: lines.length, u_frac_qty: fracU,
            rows_total: rows.length, rows_in_stock_now: nowInStock, rows_sold_now: nowSold,
            kept_in_stock: c.kept_in_stock, assigned_rows: c.assigned_rows,
            filler_in_stock: c.filler_in_stock, filler_assigned: c.filler_assigned,
            filler_cost: fillerTotal ? fillerCost.cost : '', filler_cost_source: fillerTotal ? fillerCost.source : '',
            recosted_zero_rows: recosted, recost_cost: recosted ? fallback.cost : '', recost_source: recosted ? fallback.source : '',
            pulled_from_history: c.pulled_from_history,
            history_sold: c.history_sold, written_off: writtenOff,
            wo_surplus_in_stock: c.wo_surplus_in_stock, wo_returned: c.wo_returned,
            wo_sold_null_sale: c.wo_sold_null_sale, wo_sold_missing_sale: c.wo_sold_missing_sale,
            wo_sold_not_holding: c.wo_sold_not_holding, wo_sold_unsettled_unassigned: c.wo_sold_unsettled_unassigned,
            value_in_stock: r2(valueInStock), value_u: r2(valueU), value_fifo: r2(value),
            value_at_basis: r2(basisValue), d1: r2(value - basisValue),
            pool_count_after: S, pool_eq_stock_now: nowInStock === S ? 'yes' : 'no',
        });
    }

    const sum = (k) => productRows.reduce((s, r) => s + num(r[k]), 0);
    const V = r2(sum('value_in_stock') + sum('value_u'));
    const D1 = r2(sum('value_fifo') - sum('value_at_basis'));
    const basisTotal = r2(sum('value_at_basis'));
    const VminusB = r2(V - B);
    const guardDiff = r2(D1 - (V - SU - B - E));
    const reval = r2(D1 + E);
    return {
        totals: {
            products_planned: productRows.length,
            S: sum('S'), U: sum('U'), u_frac_qty: r4(sum('u_frac_qty')), u_lines: linePlan.length,
            u_orders: new Set(linePlan.map((l) => l.order_id)).size,
            rows_total: items.length, rows_in_stock_now: sum('rows_in_stock_now'),
            kept_in_stock: sum('kept_in_stock'), assigned_rows: sum('assigned_rows'),
            filler_in_stock: sum('filler_in_stock'), filler_assigned: sum('filler_assigned'),
            recosted_zero_rows: sum('recosted_zero_rows'), pulled_from_history: sum('pulled_from_history'),
            history_sold: sum('history_sold'), written_off: sum('written_off'),
            wo_surplus_in_stock: sum('wo_surplus_in_stock'), wo_returned: sum('wo_returned'),
            wo_sold_null_sale: sum('wo_sold_null_sale'), wo_sold_missing_sale: sum('wo_sold_missing_sale'),
            wo_sold_not_holding: sum('wo_sold_not_holding'), wo_sold_unsettled_unassigned: sum('wo_sold_unsettled_unassigned'),
            rows_of_unknown_products: items.filter((i) => !productIds.has(i.product_id)).length,
            products_pool_eq_stock_now: productRows.filter((r) => r.pool_eq_stock_now === 'yes').length,
        },
        ledger: {
            V_in_stock: r2(sum('value_in_stock')), V_unsettled: r2(sum('value_u')), V,
            B, V_minus_B: VminusB, settled_unshipped_booked: SU,
            basis_value_S_plus_U: basisTotal, E, expected_B: r2(basisTotal - SU - E), D1,
            guard_diff: guardDiff,
            guard_pass: Math.abs(guardDiff) <= 1,
            reval_amount: reval,
        },
        settled_unshipped: suOrders,
        basis_sales: { basis_ref: basisSales.basis_ref, cutoff: basisSales.cutoff, E, subjects: basisSales.subjects },
        // basis(S+U) - SU - B split into the parts the dry run can name. A Returned
        // line is counted once, under u_on_returned_orders, even when it also
        // predates the ledger start.
        residual: (() => {
            const total = r2(basisTotal - SU - B);
            const inactive = r2(inactiveS.reduce((t, x) => t + x.basis_value, 0));
            const returned = r2(explain.returned_u);
            const preLedger = r2(explain.pre_ledger_start_u);
            return {
                expected_B_minus_B: total,
                basis_sales_E: E,
                inactive_products_stock: inactive, inactive_products: inactiveS,
                u_on_returned_orders: returned,
                u_on_orders_before_ledger_start: preLedger,
                unexplained: r2(total - E - inactive - returned - preLedger),
            };
        })(),
        excluded_from_u: Object.fromEntries(Object.entries(excluded).map(([k, x]) => [k, {
            orders: x.orders.size, qty: r4(x.qty), basis_value: r2(x.basis_value),
            order_ids: [...x.orders].sort(),
        }])),
        u_returned_after_basis: (() => {
            const list = [...retKept.values()].sort((a, b) => (a.order_id < b.order_id ? -1 : a.order_id > b.order_id ? 1 : 0))
                .map((k) => ({ order_id: k.order_id, status_at_cutoff: k.status_at_cutoff, qty: r4(k.qty), basis_value: r2(k.basis_value) }));
            return { orders: list.length, qty: r4(list.reduce((t, k) => t + k.qty, 0)), basis_value: r2(list.reduce((t, k) => t + k.basis_value, 0)), list };
        })(),
        diagnostics: {
            settled_holding_orders_without_cogs_entry: diag.settledNoCogsOrders.size,
            unsettled_holding_orders_with_cogs_entry: diag.cogsNotSettledOrders.size,
            fractional_u_lines: diag.fractionalLines,
            orphan_product_ids_in_pool: orphanProducts,
        },
        anomalies, productRows, linePlan, rowPlan,
    };
}

function rowRecord(p, u, newStatus, consumer, line, action) {
    return {
        row_id: u.row ? u.row.id : `FILLER-${p.id}-${u.filler}`,
        product_id: p.id, product_name: p.name,
        old_status: u.row ? u.row.status : '', old_sale_id: u.row ? (u.row.sale_id || '') : '',
        old_cost: u.row ? num(u.row.cost_of_purchase) : '', received_at: u.row ? recvOf(u.row) : '',
        new_status: newStatus, new_cost: u.cost, consumer_id: consumer, consumer_line_id: line, action,
    };
}

// ---------------------------------------------------------------------------
// Live reads (select only).

// Keyset paging on a unique, sortable column: no 1000-row ceiling, no skips.
async function fetchAll(sb, table, cols, opts = {}) {
    const key = opts.key || 'id';
    const out = [];
    let last = null;
    for (;;) {
        let q = sb.from(table).select(cols).order(key, { ascending: true }).limit(PAGE);
        if (opts.filter) q = opts.filter(q);
        if (last !== null) q = q.gt(key, last);
        const { data, error } = await q;
        if (error) throw new Error(`${table}: ${error.message}`);
        out.push(...data);
        if (data.length < PAGE) break;
        last = data[data.length - 1][key];
    }
    return out;
}

async function fetchIn(sb, table, cols, column, values, extra) {
    const out = [];
    for (let i = 0; i < values.length; i += 100) {
        const chunk = values.slice(i, i + 100);
        out.push(...await fetchAll(sb, table, cols, { filter: (q) => { q = q.in(column, chunk); return extra ? extra(q) : q; } }));
    }
    return out;
}

// Store-local midnight (Cambodia, UTC+7) of a YYYY-MM-DD day.
const localMidnight = (ymd) => (ymd ? `${String(ymd).slice(0, 10)}T00:00:00+07:00` : null);

// What the ledger says about the store: the 1300 / 5000 accounts, the 1300
// balance B (every entry status), the orders with a COGS entry (an entry
// with a 5000 line referenced ORD-<order>-COGS, or TX-<tx> of a transaction
// linked to the order) and what those entries took out of 1300 per order.
function ledgerFacts(raw) {
    const invAcc = raw.accounts.filter((a) => a.account_code === '1300').map((a) => a.id);
    const cogsAcc = raw.accounts.filter((a) => a.account_code === '5000').map((a) => a.id);
    if (invAcc.length !== 1 || cogsAcc.length !== 1) throw new Error(`expected one 1300 and one 5000 account, found ${invAcc.length} / ${cogsAcc.length}`);
    const entryById = new Map(raw.entries.map((e) => [e.id, e]));
    const txOrder = new Map(raw.txs.filter((t) => t.order_id !== null && t.order_id !== undefined).map((t) => [t.id, t.order_id]));
    const opening = raw.entries.filter((e) => e.reference_id === 'OPENING-INV').map((e) => e.date).sort()[0] || null;

    // [order, 'BASE' | 'ADJ' | 'REV']: ORD-<id>-COGS and TX-<tx> are the
    // entries that book an order's COGS; -COGS-ADJ and -COGS-REV change it.
    const orderOfRef = (ref) => {
        let m = ref.match(/^ORD-(.+)-COGS-(ADJ|REV)$/);
        if (m) return [m[1], m[2]];
        m = ref.match(/^ORD-(.+)-COGS$/);
        if (m) return [m[1], 'BASE'];
        m = ref.match(/^TX-(.+)$/);
        return m && txOrder.has(m[1]) ? [txOrder.get(m[1]), 'BASE'] : null;
    };
    let B = 0, Bposted = 0, Bdraft = 0;
    const baseOrders = new Set();
    const revOrders = new Set();
    const invOutByEntry = new Map();
    const cogsEntries = new Set();
    for (const l of raw.lines) {
        const e = entryById.get(l.journal_entry_id);
        if (l.account_id === invAcc[0]) {
            const amt = num(l.debit) - num(l.credit);
            B += amt;
            if (e && (e.status || 'Posted') === 'Draft') Bdraft += amt; else Bposted += amt;
            invOutByEntry.set(l.journal_entry_id, (invOutByEntry.get(l.journal_entry_id) || 0) - amt);
        } else if (l.account_id === cogsAcc[0] && e && e.reference_id) {
            const k = orderOfRef(e.reference_id);
            if (k === null) continue;
            cogsEntries.add(e.id);
            if (k[1] === 'BASE') baseOrders.add(k[0]);
            if (k[1] === 'REV') revOrders.add(k[0]);
        }
    }
    // What the order's COGS entries took out of 1300, net of its -COGS-ADJ and
    // -COGS-REV (os_order_cogs_net). Booked = it has an ORD-<id>-COGS / TX
    // entry and no COGS-REV reversed it in full (the app's
    // os_order_cogs_in_ledger: what a REV took back does not count).
    const cogsBooked = new Map();
    for (const id of cogsEntries) {
        const order = orderOfRef(entryById.get(id).reference_id)[0];
        cogsBooked.set(order, (cogsBooked.get(order) || 0) + (invOutByEntry.get(id) || 0));
    }
    const cogsOrders = new Set([...baseOrders].filter((o) => !(revOrders.has(o) && r2(num(cogsBooked.get(o))) <= 0)));
    return { invAcc: invAcc[0], cogsAcc: cogsAcc[0], B, Bposted, Bdraft, cogsOrders, cogsBooked, opening, invOutByEntry };
}

// Orders that hold stock, are not settled and have no COGS entry: the ones
// whose ship time the plan needs.
function unsettledHoldingOrders(raw, cogsOrders) {
    const sales = new Map(raw.sales.map((s) => [s.id, s]));
    return [...new Set(raw.saleItems
        .filter((li) => li.product_id && HOLDS_STOCK.has((sales.get(li.sale_id) || {}).shipping_status || '')
            && !SETTLED.has((sales.get(li.sale_id) || {}).payment_status || '') && !cogsOrders.has(li.sale_id))
        .map((li) => li.sale_id))];
}

/**
 * Pure: turns the raw table rows into planStore's input. raw =
 *   { products, items, sales, saleItems, accounts, entries, lines (1300 and
 *     5000 lines at least), txs ({id, order_id}), moves ({reference_id, type,
 *     created_at}), restocks, purchaseOrders, poItems }
 * opts = { uStatuses (Set), uFrom ('YYYY-MM-DD'), basisRef (reference_id of the
 * entry that set the basis: E counts what moved after it) }. raw may also
 * carry wholesaleItems ({wholesale_order_id, product_id, quantity}) and
 * adjLines ({adjustment_id, product_id, quantity, unit_cost}) for E, and
 * entries need created_at. opts.uReturnedAfterBasis (needs basisRef) keeps
 * the Returned orders of returnedAfterBasis in U: it reads sales.created_at /
 * last_edited_at, raw.statusLogs ({id, order_id, status, created_at} of the
 * order_status activity log) and the 'in' moves ({reference_id, order_id}).
 */
function buildInput(raw, basisArgs, opts = {}) {
    const { products, items, saleItems } = raw;
    const sales = new Map(raw.sales.map((s) => [s.id, s]));
    const facts = ledgerFacts(raw);
    const { cogsOrders, cogsBooked } = facts;

    // Ship time of every unsettled holding order: its newest 'out' movement.
    const uOrders = new Set(unsettledHoldingOrders(raw, cogsOrders));
    const shipAt = new Map();
    for (const m of raw.moves) {
        if (m.type !== 'out' || !uOrders.has(m.reference_id)) continue;
        if (!shipAt.has(m.reference_id) || tsKey(m.created_at) > tsKey(shipAt.get(m.reference_id))) shipAt.set(m.reference_id, m.created_at);
    }

    // Last receipt cost > 0 per product: restocks, then received PO lines.
    // On equal times the first row in id order wins.
    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const receivedPo = new Set(raw.purchaseOrders.filter((p) => p.status === 'Received').map((p) => p.id));
    const newest = (list, source) => {
        const best = new Map();
        for (const x of list) {
            if (!x.pid || !(x.cost > 0)) continue;
            const cur = best.get(x.pid);
            if (!cur || tsKey(x.ts) > cur.ts) best.set(x.pid, { cost: x.cost, ts: tsKey(x.ts), source });
        }
        return best;
    };
    const fromRestocks = newest(raw.restocks.slice().sort(byId).map((r) => ({ pid: r.product_id, cost: num(r.cost), ts: r.date })), 'restock (last receipt)');
    const fromPo = newest(raw.poItems.filter((it) => receivedPo.has(it.purchase_order_id)).sort(byId)
        .map((it) => ({ pid: it.product_id, cost: num(it.unit_price), ts: it.created_at })), 'PO line (last received)');
    const receiptCost = new Map([...fromPo, ...fromRestocks]);

    const basis = new Map();
    const basisNotes = [];
    for (const spec of basisArgs || []) {
        const m = spec.match(/^(.+)=([0-9.]+)$/);
        if (!m) throw new Error(`bad --basis entry "${spec}"`);
        const hits = products.filter((p) => p.id === m[1] || p.name === m[1]);
        if (hits.length !== 1) throw new Error(`--basis "${m[1]}" matches ${hits.length} products`);
        basis.set(hits[0].id, Number(m[2]));
        basisNotes.push({ product_id: hits[0].id, name: hits[0].name, purchase_cost: num(hits[0].purchase_cost), basis_cost: Number(m[2]) });
    }

    if (opts.uReturnedAfterBasis && !opts.basisRef) throw new Error('--u-returned-after-basis needs a basis entry (--basis-ref)');
    const uReturnedAfter = opts.uReturnedAfterBasis
        ? returnedAfterBasis(raw, basisCutoff(raw, opts.basisRef), opts.uStatuses || HOLDS_STOCK, cogsOrders) : new Map();

    return {
        input: {
            products, items, sales, saleItems, cogsOrders, cogsBooked, shipAt, receiptCost, B: r2(facts.B), basis,
            uStatuses: opts.uStatuses, uFrom: localMidnight(opts.uFrom), ledgerStart: localMidnight(facts.opening),
            basisSales: basisSalesInput(raw, facts, opts.basisRef || null), uReturnedAfter,
        },
        meta: { B_posted: r2(facts.Bposted), B_draft: r2(facts.Bdraft), cogs_booked_orders: cogsOrders.size, basis_overrides: basisNotes, ledger_start: facts.opening },
    };
}

async function loadStore(sb, basisArgs, opts) {
    // received_at exists once add_fifo_costing.sql has run.
    const itemCols = 'id,product_id,cost_of_purchase,status,sale_id,created_at';
    const items = await fetchAll(sb, 'inventory_items', itemCols + ',received_at')
        .catch(() => fetchAll(sb, 'inventory_items', itemCols));
    const [products, sales, saleItems, accounts] = await Promise.all([
        fetchAll(sb, 'products', 'id,name,stock,purchase_cost,is_active'),
        fetchAll(sb, 'sales', 'id,shipping_status,payment_status,date,created_at,last_edited_at'),
        fetchAll(sb, 'sale_items', 'id,sale_id,product_id,quantity'),
        fetchAll(sb, 'chart_of_accounts', 'id,account_code,account_name'),
    ]);
    const invAcc = accounts.filter((a) => a.account_code === '1300').map((a) => a.id);
    const cogsAcc = accounts.filter((a) => a.account_code === '5000').map((a) => a.id);
    if (invAcc.length !== 1 || cogsAcc.length !== 1) throw new Error(`expected one 1300 and one 5000 account, found ${invAcc.length} / ${cogsAcc.length}`);

    const [entries, lines, txs, restocks, purchaseOrders] = await Promise.all([
        fetchAll(sb, 'journal_entries', 'id,reference_id,status,date,created_at'),
        fetchAll(sb, 'journal_entry_lines', 'id,journal_entry_id,account_id,debit,credit', { filter: (q) => q.in('account_id', [invAcc[0], cogsAcc[0]]) }),
        fetchAll(sb, 'transactions', 'id,order_id', { filter: (q) => q.not('order_id', 'is', null) }),
        fetchAll(sb, 'restocks', 'id,product_id,cost,date'),
        fetchAll(sb, 'purchase_orders', 'id,status,order_date'),
    ]);
    const raw = { products, items, sales, saleItems, accounts, entries, lines, txs, restocks, purchaseOrders, moves: [], poItems: [] };
    if (purchaseOrders.some((p) => p.status === 'Received')) {
        raw.poItems = await fetchAll(sb, 'purchase_order_items', 'id,purchase_order_id,product_id,unit_price,created_at');
    }
    if (opts && opts.basisRef) {
        raw.wholesaleItems = await fetchAll(sb, 'wholesale_order_items', 'id,wholesale_order_id,product_id,quantity');
        raw.adjLines = await fetchAll(sb, 'stock_adjustment_lines', 'id,adjustment_id,product_id,quantity,unit_cost');
    }
    const uOrders = unsettledHoldingOrders(raw, ledgerFacts(raw).cogsOrders);
    raw.moves = await fetchIn(sb, 'stock_movements', 'id,reference_id,order_id,type,created_at', 'reference_id', uOrders, (q) => q.eq('type', 'out'));
    if (opts && opts.uReturnedAfterBasis) {
        // The Returned candidates: their 'in' movements (by reference_id or
        // order_id) and their order_status activity log.
        const byId = new Map(raw.sales.map((s) => [s.id, s]));
        const cands = uOrders.filter((id) => (byId.get(id) || {}).shipping_status === 'Returned');
        const cols = 'id,reference_id,order_id,type,created_at';
        raw.moves.push(...await fetchIn(sb, 'stock_movements', cols, 'reference_id', cands, (q) => q.eq('type', 'in')));
        raw.moves.push(...await fetchIn(sb, 'stock_movements', cols, 'order_id', cands, (q) => q.eq('type', 'in')));
        const logs = await fetchIn(sb, 'activity_logs', 'id,metadata,created_at', 'metadata->>orderId', cands, (q) => q.eq('action', 'order_status'));
        raw.statusLogs = logs.map((l) => ({ id: l.id, order_id: (l.metadata || {}).orderId || null, status: (l.metadata || {}).status ?? null, created_at: l.created_at }));
    }
    return buildInput(raw, basisArgs, opts);
}

function toCsv(rows) {
    if (!rows.length) return '';
    const cols = Object.keys(rows[0]);
    const esc = (v) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '\uFEFF' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n') + '\r\n';
}

async function main() {
    const args = process.argv.slice(2);
    const arg = (name, dflt) => {
        const a = args.find((x) => x.startsWith(`--${name}=`));
        return a ? a.slice(name.length + 3) : dflt;
    };
    const storeName = arg('store', 'Romdoul1');
    const outArg = arg('out', '');
    if (!outArg) throw new Error('--out=<dir> is required (outside the repository: the files hold live store data)');
    const outDir = path.resolve(outArg);
    const presetName = arg('preset', '');
    let preset = null;
    if (presetName) {
        if (!Object.prototype.hasOwnProperty.call(PRESETS, presetName)) throw new Error(`unknown --preset "${presetName}" (use ${Object.keys(PRESETS).join(' or ')})`);
        if (['basis', 'basis-ref', 'u-statuses', 'u-from'].some((k) => arg(k, null) !== null) || args.includes('--u-returned-after-basis')) {
            throw new Error('--preset cannot be combined with --basis, --basis-ref, --u-statuses, --u-from or --u-returned-after-basis');
        }
        preset = PRESETS[presetName];
    }
    const basisArgs = preset ? preset.basis : (arg('basis', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const uStatusArg = preset ? (preset.uStatuses || []).join(',') : arg('u-statuses', '');
    const uStatuses = uStatusArg ? new Set(uStatusArg.split(',').map((s) => s.trim()).filter(Boolean)) : HOLDS_STOCK;
    for (const st of uStatuses) if (!HOLDS_STOCK.has(st)) throw new Error(`--u-statuses: "${st}" does not hold stock (use ${[...HOLDS_STOCK].join(', ')})`);
    const uFrom = preset ? preset.uFrom : (arg('u-from', '') || null);
    const basisRef = preset ? preset.basisRef : (arg('basis-ref', '') || null);
    const uReturnedAfterBasis = preset ? !!preset.uReturnedAfterBasis : args.includes('--u-returned-after-basis');
    if (uFrom && !/^\d{4}-\d{2}-\d{2}$/.test(uFrom)) throw new Error('--u-from must be YYYY-MM-DD');

    const { createClient } = require('@supabase/supabase-js');
    const { instances } = require('../../migrations/db_instances.json');
    const inst = instances.find((i) => i.name === storeName);
    if (!inst) throw new Error(`unknown store "${storeName}" (known: ${instances.map((i) => i.name).join(', ')})`);
    const sb = createClient(inst.url, inst.anonKey || inst.key);

    const { input, meta } = await loadStore(sb, basisArgs, { uStatuses, uFrom, basisRef, uReturnedAfterBasis });
    const plan = planStore(input);

    fs.mkdirSync(outDir, { recursive: true });
    const base = path.join(outDir, storeName);
    fs.writeFileSync(`${base}_products.csv`, toCsv(plan.productRows));
    fs.writeFileSync(`${base}_unsettled_lines.csv`, toCsv(plan.linePlan));
    fs.writeFileSync(`${base}_rows.csv`, toCsv(plan.rowPlan));
    const summary = {
        store: storeName, generated_at: new Date().toISOString(), read_only: true,
        totals: plan.totals, ledger: { ...plan.ledger, B_posted: meta.B_posted, B_draft: meta.B_draft },
        options: { preset: presetName || null, u_statuses: [...uStatuses], u_from: uFrom, basis_ref: basisRef, u_returned_after_basis: uReturnedAfterBasis, ledger_start: meta.ledger_start },
        basis_overrides: meta.basis_overrides,
        settled_unshipped: plan.settled_unshipped,
        basis_sales: plan.basis_sales,
        residual: plan.residual, excluded_from_u: plan.excluded_from_u, u_returned_after_basis: plan.u_returned_after_basis,
        diagnostics: { ...plan.diagnostics, cogs_booked_orders: meta.cogs_booked_orders },
        anomalies: plan.anomalies,
        files: [`${base}_products.csv`, `${base}_unsettled_lines.csv`, `${base}_rows.csv`],
    };
    fs.writeFileSync(`${base}_summary.json`, JSON.stringify(summary, null, 2));

    const L = plan.ledger;
    const T = plan.totals;
    console.log(`=== ${storeName} FIFO rebuild dry run (read-only) ===`);
    console.log(`S ${T.S} units | U ${T.U} units on ${T.u_lines} lines / ${T.u_orders} orders (+${T.u_frac_qty} fractional)`);
    console.log(`kept in_stock ${T.kept_in_stock}, assigned ${T.assigned_rows}, fillers ${T.filler_in_stock} in_stock + ${T.filler_assigned} assigned, re-costed ${T.recosted_zero_rows}`);
    console.log(`history kept ${T.history_sold}, written off ${T.written_off} (surplus ${T.wo_surplus_in_stock}, null sale ${T.wo_sold_null_sale}, missing sale ${T.wo_sold_missing_sale}, non-holding orders ${T.wo_sold_not_holding}, unsettled unassigned ${T.wo_sold_unsettled_unassigned}, returned ${T.wo_returned})`);
    console.log(`V ${L.V} (in_stock ${L.V_in_stock} + unsettled ${L.V_unsettled}) | B ${L.B} (posted ${meta.B_posted}, draft ${meta.B_draft}) | SU ${L.settled_unshipped_booked} on ${plan.settled_unshipped.length} orders`);
    const BS = plan.basis_sales;
    console.log(`E ${L.E} (basis-overridden products moved since ${BS.basis_ref || 'no basis entry'}${BS.cutoff ? ' at ' + BS.cutoff : ''}, ${BS.subjects.length} orders / adjustments)`);
    for (const x of BS.subjects) {
        const off = r2(x.ledger_excess - x.E);
        console.log(`  E ${x.kind} ${x.id}: ${x.E} from ${x.source} (${x.note}; booked after ${x.booked_after_cutoff}, ledger ${x.ledger_excess}, cost difference ${x.cost_excess}${off ? `, ${off} NOT explained` : ''}; ${x.overridden_qty} overridden units; ${x.refs.join(', ')})`);
    }
    console.log(`basis value of S+U ${L.basis_value_S_plus_U} | D1 ${L.D1} | V-B ${L.V_minus_B} | D1-(V-SU-B-E) ${L.guard_diff} -> guard ${L.guard_pass ? 'PASS' : 'FAIL (do not book D1)'}`);
    console.log(`FIFO-REVAL amount D1 + E = ${L.reval_amount} (${L.reval_amount >= 0 ? 'Dr 1300 / Cr 5000' : 'Dr 5000 / Cr 1300'})`);
    const R = plan.residual;
    console.log(`basis - SU - B ${R.expected_B_minus_B} = E ${R.basis_sales_E} + inactive stock ${R.inactive_products_stock} + U on Returned ${R.u_on_returned_orders} + U before ledger start ${R.u_on_orders_before_ledger_start} + unexplained ${R.unexplained}`);
    if (R.inactive_products && R.inactive_products.length) {
        console.log(`inactive products holding stock: ${R.inactive_products.map(p => `${p.name} (stock ${p.stock}, ${p.basis_value} at basis cost)`).join('; ')}`);
        console.log('  If one is not real stock (Romdoul1: Test Product), set its stock to 0 with NO ledger entry before fifo_rebuild_pool.sql:');
        console.log("  UPDATE products SET stock = 0 WHERE name = '<name>' AND is_active = false;  (not Adjust Stock / the Inventory page: they book Dr 5000 / Cr 1300)");
    }
    const RA = plan.u_returned_after_basis;
    if (RA.orders) console.log(`kept in U, Returned after ${basisRef}: ${RA.orders} orders (${RA.basis_value} at basis: ${RA.list.map((k) => `${k.order_id} was ${k.status_at_cutoff}`).join(', ')})`);
    const X = plan.excluded_from_u;
    if (X.by_status.orders || X.before_u_from.orders) console.log(`left out of U: ${X.by_status.orders} orders by status (${X.by_status.basis_value}: ${X.by_status.order_ids.join(', ')}), ${X.before_u_from.orders} orders before ${uFrom} (${X.before_u_from.basis_value}: ${X.before_u_from.order_ids.join(', ')})`);
    console.log(`written to ${outDir}`);
}

if (require.main === module) {
    main().catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { planStore, buildInput, ledgerFacts, unsettledHoldingOrders, basisSalesE, basisSalesInput, returnedAfterBasis, tsKey, PRESETS };
