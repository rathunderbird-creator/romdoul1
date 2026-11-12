// Inventory Dashboard: what to buy now, cash tied up in stock, expiry and
// losses, and how fast stock turns — a read-only summary over the same
// products/warehouses/stock-movements/purchase-orders/adjustments data the
// rest of Inventory already uses.
//
// Two mockup-implied fields don't exist in this schema and are handled
// honestly rather than faked:
//  - No max-stock field on Product, so "Buy" always uses the mockup's own
//    documented fallback: reorder point + 30 days' usage.
//  - No batch/lot expiry-date tracking anywhere, so EXPIRING renders as "—"
//    (not a fabricated 0.00) with a caption saying tracking isn't set up.
// "Available" always equals on-hand: this app has no reserved-stock concept.
// Month-end stock value (the chart, and "since last month") is reconstructed
// by walking today's live value backward through logged stock_movements —
// it's only as complete as that movement history.
// Cost basis: stock on hand at FIFO (fifo_inventory_valuation); movements at
// their recorded FIFO cost (stock_movements.unit_cost). A movement recorded
// before FIFO has no cost (an order's unit_price is its selling price), so it
// is valued at its receipt price (stock in) or the product's purchase cost,
// and the page shows how many movements that covers. A store without
// migrations/add_fifo_costing.sql uses purchase cost and says so.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ShoppingCart, Download } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useProcurement } from '../../hooks/useProcurement';
import { useStockAdjustments } from '../../hooks/useStockAdjustments';
import { supabase } from '../../lib/supabase';
import { dayKeyFromDate, addDays } from '../../utils/dateRange';
import { useFifoValuation, fifoUnitCost, isMissingColumnError } from '../../hooks/useFifo';
import type { Product, StockAdjustmentReason } from '../../types';

interface MovementRow {
    product_id: string;
    type: 'in' | 'out';
    quantity: number;
    unit_price: number;
    unit_cost?: number | null;
    movement_date: string;
    warehouse_id?: string | null;
}

const fmt = (n: number): string => (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayYmd = (): string => dayKeyFromDate(new Date());
const monthKeyOf = (d: string): string => d.slice(0, 7);
const monthLabel = (ym: string): string => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};
const addMonths = (ym: string, delta: number): string => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const lastDayOfMonth = (ym: string): string => {
    const [y, m] = ym.split('-').map(Number);
    return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};

const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };
const inputStyle: React.CSSProperties = { padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', fontSize: '13px', outline: 'none', background: 'var(--color-surface)', color: 'var(--color-text-main)' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '5px' };
const btnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-main)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' };
const BLUE = '#3B82F6', RED = '#EF4444', AMBER = '#F59E0B';

const usd = (n: number): React.ReactNode => (
    <><span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-text-secondary)', marginRight: '5px' }}>USD</span>{fmt(n)}</>
);

const KpiCard: React.FC<{ label: string; value: React.ReactNode; sub: string; loading: boolean }> = ({ label, value, sub, loading }) => (
    <div style={{ ...cardStyle, padding: '16px 18px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{label}</div>
        <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '6px', fontVariantNumeric: 'tabular-nums' }}>{loading ? '…' : value}</div>
        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>{sub}</div>
    </div>
);

type Bucket = 'out' | 'below' | 'soon';
const BUCKET_META: Record<Bucket, { label: string; color: string }> = {
    out: { label: 'Out of stock', color: RED },
    below: { label: 'Below reorder', color: AMBER },
    soon: { label: 'Runs out soon', color: BLUE },
};

interface BuyRow { product: Product; onHand: number; available: number; perDay: number; lasts: number | null; buyQty: number; bucket: Bucket }

const PER_DAY_WINDOW = 90;
const RUNS_OUT_SOON_DAYS = 14;
const EXCESS_BUFFER_DAYS = 90;
const LOSS_REASONS: ReadonlySet<StockAdjustmentReason> = new Set(['Damaged goods', 'Expired goods', 'Theft / loss', 'Sample / giveaway']);

const InventoryDashboardPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { products, warehouses, warehouseStock, categories, isLoading: storeLoading, refreshData } = useStore();
    const { purchaseOrders, isLoading: poLoading, fetchPurchaseOrders } = useProcurement();
    const { adjustments, fetchAdjustments } = useStockAdjustments();

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Inventory Dashboard</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0 }}>What to buy now, cash tied up in stock, expiry and losses, and how fast stock turns.</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    const [movements, setMovements] = useState<MovementRow[]>([]);
    const [movementsLoading, setMovementsLoading] = useState(false);
    const fetchMovements = useCallback(async () => {
        setMovementsLoading(true);
        try {
            const since = addDays(todayYmd(), -400); // 12-month chart + the 90-day trailing windows, with a buffer
            const query = (columns: string) => supabase
                .from('stock_movements')
                .select(columns)
                .gte('movement_date', since)
                .order('movement_date', { ascending: true });
            let { data, error } = await query('product_id, type, quantity, unit_price, unit_cost, movement_date, warehouse_id');
            if (error && isMissingColumnError(error, 'unit_cost')) {
                ({ data, error } = await query('product_id, type, quantity, unit_price, movement_date, warehouse_id'));
            }
            if (error) throw error;
            setMovements((data || []) as unknown as MovementRow[]);
        } catch (e) {
            console.error('Failed to fetch stock movements:', e);
        } finally {
            setMovementsLoading(false);
        }
    }, []);

    const fifo = useFifoValuation();
    const { reload: reloadFifo } = fifo;
    const loadAll = useCallback(() => {
        refreshData(true);
        fetchPurchaseOrders(true);
        fetchAdjustments(true);
        fetchMovements();
    }, [refreshData, fetchPurchaseOrders, fetchAdjustments, fetchMovements]);

    useEffect(() => {
        loadAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const isLoading = storeLoading || poLoading || movementsLoading || fifo.status === 'loading';

    // ── Filters ──
    const [warehouseId, setWarehouseId] = useState('');
    const [category, setCategory] = useState('');
    const [deadAfterDays, setDeadAfterDays] = useState(90);
    const [bucketFilter, setBucketFilter] = useState<'all' | Bucket>('all');

    const activeProducts = useMemo(() => products.filter(p => p.isActive !== false), [products]);
    const filteredProducts = useMemo(() => activeProducts.filter(p => !category || p.category === category), [activeProducts, category]);
    const productCategoryById = useMemo(() => new Map(products.map(p => [p.id, p.category])), [products]);
    const purchaseCostById = useMemo(() => new Map(products.map(p => [p.id, Number(p.purchaseCost) || 0])), [products]);
    // FIFO is company-wide: a single-warehouse figure uses the product's average layer cost.
    const unitCostOf = useCallback((p: Product): number => {
        const purchaseCost = Number(p.purchaseCost) || 0;
        return fifo.status === 'ready' ? fifoUnitCost(fifo.rows.get(p.id), purchaseCost) : purchaseCost;
    }, [fifo.status, fifo.rows]);
    const movementCost = useCallback((m: MovementRow): { unit: number; estimated: boolean } => {
        if (m.unit_cost !== null && m.unit_cost !== undefined && Number.isFinite(Number(m.unit_cost))) return { unit: Number(m.unit_cost), estimated: false };
        if (m.type === 'in' && Number(m.unit_price) > 0) return { unit: Number(m.unit_price), estimated: false };
        return { unit: purchaseCostById.get(m.product_id) || 0, estimated: true };
    }, [purchaseCostById]);

    const whStockByProduct = useMemo(() => {
        if (!warehouseId) return null;
        const m = new Map<string, number>();
        for (const ws of warehouseStock) {
            if (ws.warehouseId !== warehouseId) continue;
            m.set(ws.productId, (m.get(ws.productId) || 0) + (Number(ws.quantity) || 0));
        }
        return m;
    }, [warehouseStock, warehouseId]);
    const onHandOf = useCallback((p: Product): number => warehouseId ? (whStockByProduct?.get(p.id) || 0) : (Number(p.stock) || 0), [warehouseId, whStockByProduct]);

    const relevantMovements = useMemo(() => movements.filter(m => {
        if (warehouseId && m.warehouse_id !== warehouseId) return false;
        if (category && productCategoryById.get(m.product_id) !== category) return false;
        return true;
    }), [movements, warehouseId, category, productCategoryById]);

    const perDayByProduct = useMemo(() => {
        const cutoff = addDays(todayYmd(), -PER_DAY_WINDOW);
        const sums = new Map<string, number>();
        for (const m of relevantMovements) {
            if (m.type !== 'out' || m.movement_date < cutoff) continue;
            sums.set(m.product_id, (sums.get(m.product_id) || 0) + (Number(m.quantity) || 0));
        }
        const out = new Map<string, number>();
        for (const [pid, total] of sums) out.set(pid, total / PER_DAY_WINDOW);
        return out;
    }, [relevantMovements]);

    const lastOutDateByProduct = useMemo(() => {
        const m = new Map<string, string>();
        for (const mv of relevantMovements) {
            if (mv.type !== 'out') continue;
            const cur = m.get(mv.product_id);
            if (!cur || mv.movement_date > cur) m.set(mv.product_id, mv.movement_date);
        }
        return m;
    }, [relevantMovements]);

    const onOrderByProduct = useMemo(() => {
        const m = new Map<string, number>();
        for (const po of purchaseOrders) {
            if (po.status !== 'Sent') continue;
            for (const item of po.items || []) {
                if (!item.product_id) continue;
                m.set(item.product_id, (m.get(item.product_id) || 0) + (Number(item.quantity) || 0));
            }
        }
        return m;
    }, [purchaseOrders]);

    // ── Buy Now: out of stock with demand, at/below reorder once on-order
    // stock is counted, or projected to run out within 14 days. Suggested
    // quantity tops up to the reorder point plus 30 days' usage (no max-
    // stock field exists to "top up to max" instead, per the description
    // text itself). On-order stock already covers part of the gap, so it's
    // netted out of the suggested quantity to avoid double-ordering.
    const buyRows = useMemo<BuyRow[]>(() => {
        const rows: BuyRow[] = [];
        for (const p of filteredProducts) {
            const onHand = onHandOf(p);
            const available = onHand;
            const perDay = perDayByProduct.get(p.id) || 0;
            const onOrder = onOrderByProduct.get(p.id) || 0;
            const netPosition = available + onOrder;
            const reorderLevel = Number(p.reorderLevel) || 0;
            const lasts = perDay > 0 ? available / perDay : null;

            let bucket: Bucket | null = null;
            if (netPosition <= 0 && perDay > 0) bucket = 'out';
            else if (netPosition <= reorderLevel) bucket = 'below';
            else if (lasts !== null && lasts <= RUNS_OUT_SOON_DAYS) bucket = 'soon';
            if (!bucket) continue;

            const target = reorderLevel + perDay * 30;
            const buyQty = Math.max(0, Math.ceil(target - netPosition));
            rows.push({ product: p, onHand, available, perDay, lasts, buyQty, bucket });
        }
        return rows;
    }, [filteredProducts, onHandOf, perDayByProduct, onOrderByProduct]);

    const outOfStockCount = buyRows.filter(r => r.bucket === 'out').length;
    const belowReorderCount = buyRows.filter(r => r.bucket === 'below').length;
    const runsOutSoonCount = buyRows.filter(r => r.bucket === 'soon').length;
    const toBuyCost = buyRows.reduce((s, r) => s + r.buyQty * (Number(r.product.purchaseCost) || 0), 0);
    const visibleBuyRows = useMemo(() => bucketFilter === 'all' ? buyRows : buyRows.filter(r => r.bucket === bucketFilter), [buyRows, bucketFilter]);

    // ── Stock value now, and reconstructed month-end history ──
    const stockValueNow = useMemo(() => filteredProducts.reduce((s, p) => s + onHandOf(p) * unitCostOf(p), 0), [filteredProducts, onHandOf, unitCostOf]);
    const estimatedMovements = useMemo(() => relevantMovements.filter(m => movementCost(m).estimated).length, [relevantMovements, movementCost]);

    const monthlySeries = useMemo(() => {
        const today = todayYmd();
        const months: string[] = [];
        for (let i = 11; i >= 0; i--) months.push(addMonths(monthKeyOf(today), -i));
        const thisMonth = monthKeyOf(today);

        let runningValue = stockValueNow;
        const stockValueByMonth = new Map<string, number>();
        for (let i = months.length - 1; i >= 0; i--) {
            const ym = months[i];
            const monthEnd = lastDayOfMonth(ym);
            const cutoff = monthEnd > today ? today : monthEnd;
            stockValueByMonth.set(ym, runningValue);
            // Walk one month further back: undo everything that happened in this month.
            const deltaThisMonth = relevantMovements
                .filter(m => m.movement_date <= cutoff && m.movement_date >= `${ym}-01`)
                .reduce((s, m) => s + (m.type === 'in' ? 1 : -1) * (Number(m.quantity) || 0) * movementCost(m).unit, 0);
            runningValue = Math.max(0, runningValue - deltaThisMonth);
        }

        return months.map(ym => {
            const monthEnd = lastDayOfMonth(ym);
            const from = `${ym}-01`, to = monthEnd > today ? today : monthEnd;
            let boughtMade = 0, usedSold = 0;
            for (const mv of relevantMovements) {
                if (mv.movement_date < from || mv.movement_date > to) continue;
                const val = (Number(mv.quantity) || 0) * movementCost(mv).unit;
                if (mv.type === 'in') boughtMade += val; else usedSold += val;
            }
            const label = monthLabel(ym) + (ym === thisMonth ? ' (so far)' : '');
            return { ym, month: label, stockValue: stockValueByMonth.get(ym) || 0, boughtMade, usedSold };
        });
    }, [relevantMovements, stockValueNow, movementCost]);

    const stockValueLastMonth = monthlySeries.length >= 2 ? monthlySeries[monthlySeries.length - 2].stockValue : stockValueNow;
    const stockValueDelta = stockValueNow - stockValueLastMonth;

    // ── Days on hand / turns ──
    const dailyCogs90 = useMemo(() => {
        const cutoff = addDays(todayYmd(), -PER_DAY_WINDOW);
        const sum = relevantMovements.filter(m => m.type === 'out' && m.movement_date >= cutoff)
            .reduce((s, m) => s + (Number(m.quantity) || 0) * movementCost(m).unit, 0);
        return sum / PER_DAY_WINDOW;
    }, [relevantMovements, movementCost]);
    const daysOnHand = dailyCogs90 > 0 ? stockValueNow / dailyCogs90 : null;
    const turnsPerYear = daysOnHand ? 365 / daysOnHand : 0;

    // ── Cash tied up: dead stock (no outgoing movement within the "dead
    // after" window) plus excess stock (on hand beyond reorder point + a
    // 90-day usage buffer) ──
    const deadCutoff = useMemo(() => addDays(todayYmd(), -deadAfterDays), [deadAfterDays]);
    const { deadValue, excessValue } = useMemo(() => {
        let dead = 0, excess = 0;
        for (const p of filteredProducts) {
            const onHand = onHandOf(p);
            if (onHand <= 0) continue;
            const cost = unitCostOf(p);
            const lastOut = lastOutDateByProduct.get(p.id);
            if (!lastOut || lastOut < deadCutoff) { dead += onHand * cost; continue; }
            const perDay = perDayByProduct.get(p.id) || 0;
            const healthyLevel = (Number(p.reorderLevel) || 0) + perDay * EXCESS_BUFFER_DAYS;
            if (onHand > healthyLevel) excess += (onHand - healthyLevel) * cost;
        }
        return { deadValue: dead, excessValue: excess };
    }, [filteredProducts, onHandOf, unitCostOf, lastOutDateByProduct, deadCutoff, perDayByProduct]);
    const cashTiedUp = deadValue + excessValue;

    // ── Losses: posted write-off adjustments in the "dead after" window ──
    const lossesValue = useMemo(() => {
        return adjustments
            .filter(a => a.status === 'Posted' && a.adjustment_date >= deadCutoff && LOSS_REASONS.has(a.reason))
            .filter(a => !warehouseId || a.warehouse_id === warehouseId)
            .reduce((sum, a) => sum + Math.abs((a.lines || [])
                .filter(l => !category || productCategoryById.get(l.product_id) === category)
                .reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0)), 0);
    }, [adjustments, deadCutoff, warehouseId, category, productCategoryById]);

    const exportBuyNowCsv = () => {
        const header = ['SKU', 'Product', 'Category', 'Reorder At', 'On Hand', 'Available', 'Per Day', 'Lasts (days)', 'Buy', 'Est. Cost'];
        const rows = visibleBuyRows.map(r => [
            r.product.sku || '', r.product.name, r.product.category, fmt(Number(r.product.reorderLevel) || 0),
            fmt(r.onHand), fmt(r.available), fmt(r.perDay), r.lasts === null ? '' : fmt(r.lasts),
            fmt(r.buyQty), fmt(r.buyQty * (Number(r.product.purchaseCost) || 0)),
        ]);
        const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `buy-now-${todayYmd()}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const FilterPill: React.FC<{ bucket: Bucket; count: number }> = ({ bucket, count }) => {
        const meta = BUCKET_META[bucket];
        const active = bucketFilter === bucket;
        return (
            <button
                onClick={() => setBucketFilter(active ? 'all' : bucket)}
                style={{
                    fontSize: '12px', fontWeight: 700, padding: '5px 12px', borderRadius: '999px', cursor: 'pointer',
                    border: `1px solid ${meta.color}55`, background: active ? `${meta.color}33` : `${meta.color}14`, color: meta.color,
                }}
            >
                {meta.label} · {count}
            </button>
        );
    };

    return (
        <div className="acct-page" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Filters */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
                <div>
                    <label style={labelStyle}>Warehouse</label>
                    <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="">All warehouses</option>
                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                </div>
                <div>
                    <label style={labelStyle}>Category</label>
                    <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="">All categories</option>
                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
                <div>
                    <label style={labelStyle}>Dead after</label>
                    <select value={deadAfterDays} onChange={e => setDeadAfterDays(Number(e.target.value))} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value={30}>30 days</option>
                        <option value={60}>60 days</option>
                        <option value={90}>90 days</option>
                        <option value={180}>180 days</option>
                    </select>
                </div>
                <button onClick={() => { loadAll(); reloadFifo(); }} title="Refresh" style={{ ...inputStyle, cursor: 'pointer', display: 'flex' }}>
                    <RefreshCw size={15} style={isLoading ? { animation: 'spin 1s linear infinite' } : {}} />
                </button>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', maxWidth: '820px', lineHeight: 1.5 }}>
                As of {new Date().toLocaleDateString()} · amounts in USD at cost ·{' '}
                {fifo.status === 'ready'
                    ? 'stock valued at FIFO (the cost layers on hand)'
                    : fifo.status === 'loading' ? 'loading FIFO costs…' : <span style={{ color: '#B45309' }}>stock valued at purchase cost, not FIFO. {fifo.message}</span>}
                {' '}· movements at their recorded FIFO cost
                {estimatedMovements > 0 && <span style={{ color: '#B45309' }}>; {estimatedMovements.toLocaleString()} older movement{estimatedMovements === 1 ? '' : 's'} with no recorded cost use the product's purchase cost</span>}.
                {' '}To Buy Now is estimated at purchase cost (last cost).
            </div>
            {/* Rule (INV-1): per-warehouse stock is tracked only by the flows
                that record a warehouse (posted stock adjustments, wholesale,
                stock movements) — retail orders and PO receipts update company
                stock without one. On-hand figures for a single warehouse are
                therefore partial, and this says so instead of presenting them
                as the whole truth; "All warehouses" uses the authoritative
                company stock. */}
            {warehouseId && (
                <div style={{ fontSize: '12px', color: '#B45309', maxWidth: '680px' }}>
                    Single-warehouse figures cover only movements that recorded this warehouse (stock adjustments, wholesale, stock movements).
                    Retail orders and purchase receipts update company stock without a warehouse, so these on-hand and value figures are partial —
                    select “All warehouses” for the full company stock.
                </div>
            )}

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '16px' }}>
                <KpiCard label="Stock Value" value={usd(stockValueNow)} sub={`${stockValueDelta >= 0 ? '+' : ''}${fmt(stockValueDelta)} since last month`} loading={isLoading} />
                <KpiCard label="To Buy Now" value={buyRows.length} sub={`USD ${fmt(toBuyCost)}`} loading={isLoading} />
                <KpiCard label="Days On Hand" value={daysOnHand === null ? '—' : Math.round(daysOnHand)} sub={`Turns ${Math.round(turnsPerYear)}x a year`} loading={isLoading} />
                <KpiCard label="Cash Tied Up" value={usd(cashTiedUp)} sub={`Dead ${fmt(deadValue)} · excess ${fmt(excessValue)}`} loading={isLoading} />
                <KpiCard label="Expiring" value="—" sub="Batch expiry tracking isn't set up" loading={isLoading} />
                <KpiCard label="Losses" value={usd(lossesValue)} sub={`Adjustments and counts, last ${deadAfterDays} days`} loading={isLoading} />
            </div>

            {/* Buy now */}
            <div style={{ ...cardStyle, padding: '20px 22px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShoppingCart size={17} color={BLUE} />
                    <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-text-main)' }}>Buy now</span>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '6px 0 14px', maxWidth: '820px' }}>
                    Out of stock with recent demand, at or below the reorder point once on-order stock is counted, or running out within {RUNS_OUT_SOON_DAYS} days at the last {PER_DAY_WINDOW} days' usage.
                    Suggested quantity tops up to the reorder point plus 30 days' usage.
                </p>
                <button onClick={exportBuyNowCsv} disabled={visibleBuyRows.length === 0} style={{ ...btnStyle, opacity: visibleBuyRows.length === 0 ? 0.5 : 1, marginBottom: '14px' }}>
                    <Download size={14} /> Export CSV
                </button>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <FilterPill bucket="out" count={outOfStockCount} />
                        <FilterPill bucket="below" count={belowReorderCount} />
                        <FilterPill bucket="soon" count={runsOutSoonCount} />
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{buyRows.length} to buy · USD {fmt(toBuyCost)}</div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Product</th>
                                <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>On Hand</th>
                                <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Available</th>
                                <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Per Day</th>
                                <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Lasts</th>
                                <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Buy</th>
                                <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Est. Cost</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading…</td></tr>
                            ) : visibleBuyRows.length === 0 ? (
                                <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Nothing needs buying right now.</td></tr>
                            ) : visibleBuyRows.map(r => {
                                const meta = BUCKET_META[r.bucket];
                                return (
                                    <tr key={r.product.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td style={{ padding: '10px 14px' }}>
                                            <span style={{ display: 'inline-block', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', background: `${meta.color}1F`, color: meta.color, marginBottom: '4px' }}>{meta.label}</span>
                                            <div style={{ fontWeight: 700, color: 'var(--color-text-main)' }}>{r.product.name}</div>
                                            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{r.product.sku || r.product.model} · {r.product.category} · Reorder at {fmt(Number(r.product.reorderLevel) || 0)}</div>
                                        </td>
                                        <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.onHand)}</td>
                                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.available)}</td>
                                        <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.perDay)}</td>
                                        <td style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>{r.lasts === null ? '—' : `${Math.round(r.lasts)}d`}</td>
                                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.buyQty)}</td>
                                        <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.buyQty * (Number(r.product.purchaseCost) || 0))}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Charts */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: '20px', alignItems: 'start' }}>
                <div style={{ ...cardStyle, padding: '18px 20px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)' }}>Stock value</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>Month-end value over 12 months, in USD.</div>
                    <div style={{ height: '260px' }}>
                        {isLoading ? (
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading…</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={monthlySeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                                    <XAxis dataKey="month" stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
                                    <YAxis stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(Number(v))} />
                                    <Tooltip
                                        contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                                        itemStyle={{ color: 'var(--color-text-main)', fontWeight: 600 }}
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        formatter={((value: any) => [fmt(Number(value)), 'Stock value']) as any}
                                    />
                                    <Line type="monotone" dataKey="stockValue" stroke={BLUE} strokeWidth={3} dot={{ r: 4, fill: BLUE, strokeWidth: 0 }} activeDot={{ r: 6, strokeWidth: 0 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                <div style={{ ...cardStyle, padding: '18px 20px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)' }}>Money in and out of stock</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>Cost of what was bought or made, against the cost of what was used or sold (not its selling price), per month. This month is so far.</div>
                    <div style={{ height: '260px' }}>
                        {isLoading ? (
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading…</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={monthlySeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                                    <XAxis dataKey="month" stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
                                    <YAxis stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(Number(v))} />
                                    <Tooltip
                                        contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                                        itemStyle={{ fontWeight: 600 }}
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        formatter={((value: any, name: any) => [fmt(Number(value)), name]) as any}
                                    />
                                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                                    <Bar dataKey="boughtMade" name="Bought / made" fill={BLUE} radius={[3, 3, 0, 0]} maxBarSize={28} />
                                    <Bar dataKey="usedSold" name="Used / sold" fill={AMBER} radius={[3, 3, 0, 0]} maxBarSize={28} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default InventoryDashboardPage;
