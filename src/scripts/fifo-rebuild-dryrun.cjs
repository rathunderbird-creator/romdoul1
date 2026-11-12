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
 *   D1 = sum over the same S+U units of (layer cost - basis cost), where the
 *        basis cost is products.purchase_cost unless --basis overrides it
 *   Guard: |D1 - (V - B)| <= 1, i.e. sum basis x (S+U) must equal B. When it
 *   fails, the rebuild must not book D1.
 *
 * Usage:
 *   node src/scripts/fifo-rebuild-dryrun.cjs [--store=Romdoul1|Romdoul2|Romdoul3] [--out=<dir>]
 *        [--basis=<product name or id>=<cost>[,...]]
 *   --store  defaults to Romdoul1; --out defaults to ./fifo-dryrun.
 *   --basis  sets the basis cost the ledger carries for a product when it
 *            differs from today's purchase_cost (for example a cost changed
 *            after the true-up). It changes D1 and the guard only.
 */
const fs = require('fs');
const path = require('path');

const SETTLED = new Set(['Paid', 'Settled', 'Paid/Settled']);
const HOLDS_STOCK = new Set(['Shipped', 'Delivered', 'Returned']);
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

// Newest first: received DESC, id DESC (the order the SQL rebuild uses).
function newestFirst(a, b) {
    const d = tsKey(b.created_at) - tsKey(a.created_at);
    if (d !== 0) return d;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Pure planner, no I/O. Input:
 *   products   [{id, name, stock, purchase_cost}]
 *   items      [{id, product_id, cost_of_purchase, status, sale_id, created_at}]
 *   sales      Map id -> {shipping_status, payment_status, date}
 *   saleItems  [{id, sale_id, product_id, quantity}]
 *   cogsOrders Set of order ids that have a COGS entry
 *   shipAt     Map order id -> ship timestamp (falls back to sales.date)
 *   receiptCost Map product id -> {cost, source} (last receipt cost > 0)
 *   B          1300 balance (number)
 *   basis      Map product id -> basis cost override
 *   uStatuses  Set of shipping statuses whose unsettled lines form U
 *              (default Shipped, Delivered, Returned)
 *   uFrom      timestamp; orders dated before it are left out of U
 *   ledgerStart timestamp of the opening entry (for the residual breakdown)
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

    const uLinesByProduct = new Map();
    const diag = { settledNoCogsOrders: new Set(), cogsNotSettledOrders: new Set(), fractionalLines: 0 };
    const excluded = { by_status: { orders: new Set(), qty: 0, basis_value: 0 }, before_u_from: { orders: new Set(), qty: 0, basis_value: 0 } };
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
        const ex = !uStatuses.has(s.shipping_status) ? excluded.by_status
            : uFromKey !== null && tsKey(s.date) < uFromKey ? excluded.before_u_from : null;
        if (ex) { ex.orders.add(li.sale_id); ex.qty += q; ex.basis_value += atBasis; continue; }
        if (s.shipping_status === 'Returned') explain.returned_u += atBasis;
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
    const guardDiff = r2(D1 - VminusB);
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
            B, V_minus_B: VminusB, basis_value_S_plus_U: basisTotal, D1,
            guard_diff_D1_minus_VminusB: guardDiff,
            guard_pass: Math.abs(guardDiff) <= 1,
        },
        // basis(S+U) - B split into the parts the dry run can name. A Returned
        // line is counted once, under u_on_returned_orders, even when it also
        // predates the ledger start.
        residual: (() => {
            const total = r2(basisTotal - B);
            const inactive = r2(inactiveS.reduce((t, x) => t + x.basis_value, 0));
            const returned = r2(explain.returned_u);
            const preLedger = r2(explain.pre_ledger_start_u);
            return {
                basis_minus_B: total,
                inactive_products_stock: inactive, inactive_products: inactiveS,
                u_on_returned_orders: returned,
                u_on_orders_before_ledger_start: preLedger,
                unexplained: r2(total - inactive - returned - preLedger),
            };
        })(),
        excluded_from_u: {
            by_status: { orders: excluded.by_status.orders.size, qty: r4(excluded.by_status.qty), basis_value: r2(excluded.by_status.basis_value) },
            before_u_from: { orders: excluded.before_u_from.orders.size, qty: r4(excluded.before_u_from.qty), basis_value: r2(excluded.before_u_from.basis_value) },
        },
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
        old_cost: u.row ? num(u.row.cost_of_purchase) : '', received_at: u.row ? u.row.created_at : '',
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

async function loadStore(sb, basisArgs, opts) {
    const [products, items, salesRows, saleItems, accounts] = await Promise.all([
        fetchAll(sb, 'products', 'id,name,stock,purchase_cost,is_active'),
        fetchAll(sb, 'inventory_items', 'id,product_id,cost_of_purchase,status,sale_id,created_at'),
        fetchAll(sb, 'sales', 'id,shipping_status,payment_status,date'),
        fetchAll(sb, 'sale_items', 'id,sale_id,product_id,quantity'),
        fetchAll(sb, 'chart_of_accounts', 'id,account_code,account_name'),
    ]);
    const sales = new Map(salesRows.map((s) => [s.id, s]));
    const invAcc = accounts.filter((a) => a.account_code === '1300').map((a) => a.id);
    const cogsAcc = accounts.filter((a) => a.account_code === '5000').map((a) => a.id);
    if (invAcc.length !== 1 || cogsAcc.length !== 1) throw new Error(`expected one 1300 and one 5000 account, found ${invAcc.length} / ${cogsAcc.length}`);

    const [entries, lines, txs] = await Promise.all([
        fetchAll(sb, 'journal_entries', 'id,reference_id,status,date'),
        fetchAll(sb, 'journal_entry_lines', 'id,journal_entry_id,account_id,debit,credit', { filter: (q) => q.in('account_id', [invAcc[0], cogsAcc[0]]) }),
        fetchAll(sb, 'transactions', 'id,order_id', { filter: (q) => q.not('order_id', 'is', null) }),
    ]);
    const entryById = new Map(entries.map((e) => [e.id, e]));
    const txOrder = new Map(txs.map((t) => [t.id, t.order_id]));
    const opening = entries.filter((e) => e.reference_id === 'OPENING-INV').map((e) => e.date).sort()[0] || null;

    let B = 0, Bposted = 0, Bdraft = 0;
    const cogsOrders = new Set();
    for (const l of lines) {
        const e = entryById.get(l.journal_entry_id);
        if (l.account_id === invAcc[0]) {
            const amt = num(l.debit) - num(l.credit);
            B += amt;
            if (e && (e.status || 'Posted') === 'Draft') Bdraft += amt; else Bposted += amt;
        } else if (e && e.reference_id) {
            const ref = e.reference_id;
            let m = ref.match(/^ORD-(.+)-COGS$/);
            if (m) cogsOrders.add(m[1]);
            m = ref.match(/^TX-(.+)$/);
            if (m && txOrder.has(m[1])) cogsOrders.add(txOrder.get(m[1]));
        }
    }

    // Ship time of every unsettled holding order: its newest 'out' movement.
    const uOrders = [...new Set(saleItems
        .filter((li) => li.product_id && HOLDS_STOCK.has((sales.get(li.sale_id) || {}).shipping_status || '')
            && !SETTLED.has((sales.get(li.sale_id) || {}).payment_status || '') && !cogsOrders.has(li.sale_id))
        .map((li) => li.sale_id))];
    const moves = await fetchIn(sb, 'stock_movements', 'id,reference_id,created_at', 'reference_id', uOrders, (q) => q.eq('type', 'out'));
    const shipAt = new Map();
    for (const m of moves) {
        if (!shipAt.has(m.reference_id) || tsKey(m.created_at) > tsKey(shipAt.get(m.reference_id))) shipAt.set(m.reference_id, m.created_at);
    }

    // Last receipt cost > 0 per product: restocks, then received PO lines.
    const [restocks, pos] = await Promise.all([
        fetchAll(sb, 'restocks', 'id,product_id,cost,date'),
        fetchAll(sb, 'purchase_orders', 'id,status,order_date'),
    ]);
    const receivedPo = new Map(pos.filter((p) => p.status === 'Received').map((p) => [p.id, p]));
    const poItems = receivedPo.size ? await fetchAll(sb, 'purchase_order_items', 'id,purchase_order_id,product_id,unit_price,created_at') : [];
    const newest = (list, source) => {
        const best = new Map();
        for (const x of list) {
            if (!x.pid || !(x.cost > 0)) continue;
            const cur = best.get(x.pid);
            if (!cur || tsKey(x.ts) > cur.ts) best.set(x.pid, { cost: x.cost, ts: tsKey(x.ts), source });
        }
        return best;
    };
    const fromRestocks = newest(restocks.map((r) => ({ pid: r.product_id, cost: num(r.cost), ts: r.date })), 'restock (last receipt)');
    const fromPo = newest(poItems.filter((it) => receivedPo.has(it.purchase_order_id))
        .map((it) => ({ pid: it.product_id, cost: num(it.unit_price), ts: it.created_at })), 'PO line (last received)');
    const receiptCost = new Map([...fromPo, ...fromRestocks]);

    const basis = new Map();
    const basisNotes = [];
    for (const spec of basisArgs) {
        const m = spec.match(/^(.+)=([0-9.]+)$/);
        if (!m) throw new Error(`bad --basis entry "${spec}"`);
        const hits = products.filter((p) => p.id === m[1] || p.name === m[1]);
        if (hits.length !== 1) throw new Error(`--basis "${m[1]}" matches ${hits.length} products`);
        basis.set(hits[0].id, Number(m[2]));
        basisNotes.push({ product_id: hits[0].id, name: hits[0].name, purchase_cost: num(hits[0].purchase_cost), basis_cost: Number(m[2]) });
    }

    return {
        input: {
            products, items, sales, saleItems, cogsOrders, shipAt, receiptCost, B: r2(B), basis,
            uStatuses: opts.uStatuses, uFrom: localMidnight(opts.uFrom), ledgerStart: localMidnight(opening),
        },
        meta: { B_posted: r2(Bposted), B_draft: r2(Bdraft), cogs_booked_orders: cogsOrders.size, basis_overrides: basisNotes, ledger_start: opening },
    };
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
    const outDir = path.resolve(arg('out', 'fifo-dryrun'));
    const basisArgs = (arg('basis', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const uStatusArg = arg('u-statuses', '');
    const uStatuses = uStatusArg ? new Set(uStatusArg.split(',').map((s) => s.trim()).filter(Boolean)) : HOLDS_STOCK;
    for (const st of uStatuses) if (!HOLDS_STOCK.has(st)) throw new Error(`--u-statuses: "${st}" does not hold stock (use ${[...HOLDS_STOCK].join(', ')})`);
    const uFrom = arg('u-from', '') || null;
    if (uFrom && !/^\d{4}-\d{2}-\d{2}$/.test(uFrom)) throw new Error('--u-from must be YYYY-MM-DD');

    const { createClient } = require('@supabase/supabase-js');
    const { instances } = require('../../migrations/db_instances.json');
    const inst = instances.find((i) => i.name === storeName);
    if (!inst) throw new Error(`unknown store "${storeName}" (known: ${instances.map((i) => i.name).join(', ')})`);
    const sb = createClient(inst.url, inst.anonKey || inst.key);

    const { input, meta } = await loadStore(sb, basisArgs, { uStatuses, uFrom });
    const plan = planStore(input);

    fs.mkdirSync(outDir, { recursive: true });
    const base = path.join(outDir, storeName);
    fs.writeFileSync(`${base}_products.csv`, toCsv(plan.productRows));
    fs.writeFileSync(`${base}_unsettled_lines.csv`, toCsv(plan.linePlan));
    fs.writeFileSync(`${base}_rows.csv`, toCsv(plan.rowPlan));
    const summary = {
        store: storeName, generated_at: new Date().toISOString(), read_only: true,
        totals: plan.totals, ledger: { ...plan.ledger, B_posted: meta.B_posted, B_draft: meta.B_draft },
        options: { u_statuses: [...uStatuses], u_from: uFrom, ledger_start: meta.ledger_start },
        basis_overrides: meta.basis_overrides,
        residual: plan.residual, excluded_from_u: plan.excluded_from_u,
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
    console.log(`V ${L.V} (in_stock ${L.V_in_stock} + unsettled ${L.V_unsettled}) | B ${L.B} (posted ${meta.B_posted}, draft ${meta.B_draft})`);
    console.log(`basis value of S+U ${L.basis_value_S_plus_U} | D1 ${L.D1} | V-B ${L.V_minus_B} | D1-(V-B) ${L.guard_diff_D1_minus_VminusB} -> guard ${L.guard_pass ? 'PASS' : 'FAIL (do not book D1)'}`);
    const R = plan.residual;
    console.log(`basis - B ${R.basis_minus_B} = inactive stock ${R.inactive_products_stock} + U on Returned ${R.u_on_returned_orders} + U before ledger start ${R.u_on_orders_before_ledger_start} + unexplained ${R.unexplained}`);
    const X = plan.excluded_from_u;
    if (X.by_status.orders || X.before_u_from.orders) console.log(`left out of U: ${X.by_status.orders} orders by status (${X.by_status.basis_value}), ${X.before_u_from.orders} orders before ${uFrom} (${X.before_u_from.basis_value})`);
    console.log(`written to ${outDir}`);
}

if (require.main === module) {
    main().catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { planStore, tsKey };
