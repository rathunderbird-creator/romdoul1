import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Download, RefreshCw, Table2, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { fetchAll } from '../utils/fetchAll';
import { SPECIAL_HINTS, SPECIAL_ORDER, movedOf, netOf, summarizeByProduct, summarizeBySalesman, type MovementRow, type SalesmanSummaryRow } from '../utils/stockMovementSummary';
import { fetchSalesmanLookups } from '../utils/stockMovementSalesmen';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useMobile } from '../hooks/useMobile';
import DateRangePicker from './DateRangePicker';

// One row of the summary (per-product stock recap).
interface MovementSummaryRow {
    id: string;
    name: string;
    oldStock: number;
    sold: number;      // retail stock-outs
    wholesale: number; // wholesale-order stock-outs
    ret: number;
    buy: number;
    newStock: number;
}

type SalesmanSortKey = 'label' | 'sold' | 'wholesale' | 'ret' | 'buy' | 'net' | 'movements';

interface StockMovementSummaryModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Period the popup opens with; empty strings (or omitted) = all time. */
    initialRange?: { start: string; end: string };
    /** Restrict to one warehouse; omit for all warehouses. */
    warehouseId?: string;
}

/**
 * "Show Movements" popup: per-product recap of Old Stock / Sold / Wholesale /
 * Return / Buy / New Stock over a period. New Stock = the stock as it stood at
 * the END of the period (current stock rolled back through any later
 * movements), so every day keeps its own historical record. Old Stock is
 * back-calculated so every row satisfies New = Old + Buy + Return - Sold -
 * Wholesale. Shared by the Stock Movements page and Orders Management.
 */
const StockMovementSummaryModal: React.FC<StockMovementSummaryModalProps> = ({ isOpen, onClose, initialRange, warehouseId }) => {
    const { products, warehouses } = useStore();
    const { showToast } = useToast();
    const isMobile = useMobile();

    const [isLoading, setIsLoading] = useState(false);
    const [rows, setRows] = useState<MovementSummaryRow[]>([]);
    // "By Salesman": the same movements grouped by the salesman on the ORDER each
    // one belongs to (sales.salesman). Finding those orders takes extra queries, so
    // it only runs when this tab is opened, for the movements currently loaded.
    const [view, setView] = useState<'product' | 'salesman'>('product');
    const [movementsData, setMovementsData] = useState<MovementRow[] | null>(null);
    const [productNames, setProductNames] = useState<Map<string, string>>(new Map());
    const [salesmanRows, setSalesmanRows] = useState<SalesmanSummaryRow[]>([]);
    const [salesmanStatus, setSalesmanStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [salesmanError, setSalesmanError] = useState<string | null>(null);
    const [expandedSalesman, setExpandedSalesman] = useState<Set<string>>(new Set());
    const [salesmanSort, setSalesmanSort] = useState<{ key: SalesmanSortKey; direction: 'asc' | 'desc' } | null>(null);
    // The popup has its own date range (seeded from initialRange on open),
    // so the period can be changed without leaving the popup.
    const [range, setRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
    // Table controls: hide zero-movement rows, sortable columns.
    const [onlyMovement, setOnlyMovement] = useState(false);
    const [sort, setSort] = useState<{ key: keyof MovementSummaryRow; direction: 'asc' | 'desc' } | null>(null);

    // Request guard: a wide range is many sequential pages, so an older, slower load
    // can finish AFTER a newer one (change the range, or press "All time", while one
    // is running). Only the latest call may publish rows or clear the spinner; closing
    // the popup also invalidates whatever is in flight.
    const fetchSeq = useRef(0);
    // Same idea for the By Salesman order lookups.
    const salesmanSeq = useRef(0);

    const fetchSummary = async (r: { start: string; end: string }) => {
        const seq = ++fetchSeq.current;
        const isStale = () => seq !== fetchSeq.current;
        setIsLoading(true);
        try {
            // Only the date range and warehouse restriction apply here — callers'
            // other filters (e.g. the movements page In/Out toggle) can't skew it.
            // Paginated (fetchAll, ordered by the unique id): a busy period can hold
            // thousands of movements, and one unbounded select is silently cut at
            // the API row cap on projects that set one.
            const data = await fetchAll<any>((from, to) => {
                let query = supabase.from('stock_movements').select('id, product_id, product_name, type, quantity, source, reason, reference_id, note, customer_phone');
                if (r.start) query = query.gte('movement_date', r.start);
                if (r.end) query = query.lte('movement_date', r.end);
                if (warehouseId) query = query.eq('warehouse_id', warehouseId);
                return query.order('id', { ascending: true }).range(from, to);
            });
            if (isStale()) return;

            // Each day keeps its own record: when the period ends in the past,
            // roll TODAY's stock back through every movement made AFTER the
            // period, so New/Old Stock show what the stock actually was on
            // those days (yesterday's summary stays yesterday's forever).
            const netAfter = new Map<string, number>();
            if (r.end) {
                const afterData = await fetchAll<any>((from, to) => {
                    let afterQuery = supabase.from('stock_movements').select('id, product_id, type, quantity').gt('movement_date', r.end);
                    if (warehouseId) afterQuery = afterQuery.eq('warehouse_id', warehouseId);
                    return afterQuery.order('id', { ascending: true }).range(from, to);
                });
                if (isStale()) return;
                for (const m of afterData) {
                    const key = m.product_id || '?';
                    const delta = (m.type === 'in' ? 1 : -1) * (m.quantity || 0);
                    netAfter.set(key, (netAfter.get(key) || 0) + delta);
                }
            }

            // Wholesale-order outs are split from retail sales; PO receipts + other
            // stock-ins are "Buy". The bucketing lives in one shared classifier
            // (utils/stockMovementSummary.ts) so By Salesman can never disagree with it.
            const byProduct = summarizeByProduct(data);
            // One display name per product, shared by both views: the live catalogue
            // name for products that still exist (as the By Product rows below use),
            // else the name By Product falls back to. Otherwise a renamed product
            // shows the write-time name of whichever movement is seen first.
            const names = new Map<string, string>();
            for (const [key, agg] of byProduct) names.set(key, agg.name);
            for (const p of products) names.set(p.id, p.name);

            // When restricted to one warehouse, base the stock columns on THAT
            // warehouse's stock — using company-wide products.stock here labeled a
            // global figure as warehouse stock. Fetched live (not from the store's
            // boot-time cache) so it lines up with the live movement queries above;
            // warehouse_stock is mutated by exactly the warehouse-tagged movements
            // those queries return, keeping the rollback math consistent.
            let whQty: Map<string, number> | null = null;
            if (warehouseId) {
                const { data: whRows, error: whErr } = await supabase
                    .from('warehouse_stock')
                    .select('product_id, quantity')
                    .eq('warehouse_id', warehouseId);
                if (whErr) throw whErr;
                whQty = new Map((whRows || []).map((ws: any) => [ws.product_id, ws.quantity || 0]));
                if (isStale()) return;
            }

            const built: MovementSummaryRow[] = products.map(p => {
                const agg = byProduct.get(p.id) || { sold: 0, wholesale: 0, ret: 0, buy: 0, name: p.name };
                byProduct.delete(p.id);
                // Stock as it stood at the END of the selected period.
                const baseStock = whQty ? (whQty.get(p.id) || 0) : (p.stock || 0);
                const newStock = baseStock - (netAfter.get(p.id) || 0);
                return {
                    id: p.id,
                    name: p.name,
                    oldStock: newStock - agg.buy - agg.ret + agg.sold + agg.wholesale,
                    sold: agg.sold,
                    wholesale: agg.wholesale,
                    ret: agg.ret,
                    buy: agg.buy,
                    newStock
                };
            });
            // Movements whose product was deleted still show up, with zero current stock.
            for (const [key, agg] of byProduct) {
                built.push({ id: key, name: agg.name, oldStock: agg.sold + agg.wholesale - agg.buy - agg.ret, sold: agg.sold, wholesale: agg.wholesale, ret: agg.ret, buy: agg.buy, newStock: 0 });
            }
            if (isStale()) return;
            setRows(built);
            // A new period: hand the movements to By Salesman and clear its old result
            // (it looks the orders up when that tab is shown).
            salesmanSeq.current++;   // a lookup still running for the OLD period must not publish into this one
            setMovementsData(data);
            setProductNames(names);
            setSalesmanRows([]);
            setSalesmanError(null);
            setSalesmanStatus('idle');
            setExpandedSalesman(new Set());
        } catch (e: any) {
            if (isStale()) return;         // a superseded load's failure isn't news
            console.error('Failed to build movement summary:', e);
            showToast('Failed to build summary: ' + e.message, 'error');
        } finally {
            if (!isStale()) setIsLoading(false);
        }
    };

    // Re-seed the period and refetch every time the popup opens.
    useEffect(() => {
        if (isOpen) {
            const seed = initialRange || { start: '', end: '' };
            setRange(seed);
            fetchSummary(seed);
        } else {
            fetchSeq.current++;            // drop any load still in flight
            salesmanSeq.current++;
            setIsLoading(false);
            setSalesmanStatus(s => (s === 'loading' ? 'idle' : s));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // By Salesman: find each movement's order (and its salesman) the first time the tab
    // is shown for the loaded period. A failure only affects this tab — the By Product
    // recap above is already on screen and stays usable.
    useEffect(() => {
        if (!isOpen || view !== 'salesman' || !movementsData || salesmanStatus !== 'idle') return;
        const seq = ++salesmanSeq.current;
        const isStale = () => seq !== salesmanSeq.current;
        setSalesmanStatus('loading');
        (async () => {
            try {
                const lookups = await fetchSalesmanLookups(supabase, movementsData);
                if (isStale()) return;
                setSalesmanRows(summarizeBySalesman(movementsData, lookups, productNames));
                setSalesmanStatus('ready');
            } catch (e: any) {
                if (isStale()) return;
                console.error('Failed to attribute movements to salesmen:', e);
                setSalesmanError(e?.message || String(e));
                setSalesmanStatus('error');
            }
        })();
    }, [isOpen, view, movementsData, salesmanStatus, productNames]);

    const hasMovement = (r: MovementSummaryRow) => r.sold > 0 || r.wholesale > 0 || r.ret > 0 || r.buy > 0;
    const movementCount = useMemo(() => rows.filter(hasMovement).length, [rows]);

    const displayedRows = useMemo(() => {
        let out = onlyMovement ? rows.filter(hasMovement) : rows;
        if (sort) {
            const { key, direction } = sort;
            out = [...out].sort((a, b) => {
                const av = a[key], bv = b[key];
                const cmp = typeof av === 'string' || typeof bv === 'string'
                    ? String(av).localeCompare(String(bv))
                    : (av as number) - (bv as number);
                return direction === 'asc' ? cmp : -cmp;
            });
        }
        return out;
    }, [rows, onlyMovement, sort]);

    // Footer totals always match what's on screen (and what exports).
    const totals = useMemo(() => displayedRows.reduce(
        (acc, r) => ({
            oldStock: acc.oldStock + r.oldStock,
            sold: acc.sold + r.sold,
            wholesale: acc.wholesale + r.wholesale,
            ret: acc.ret + r.ret,
            buy: acc.buy + r.buy,
            newStock: acc.newStock + r.newStock
        }),
        { oldStock: 0, sold: 0, wholesale: 0, ret: 0, buy: 0, newStock: 0 }
    ), [displayedRows]);

    // ── By Salesman ────────────────────────────────────────────────────────
    // Named salesmen sort like any table. The rows that are not a real salesman —
    // (No salesman), (Order unknown), (Not from a retail order) — stay pinned below
    // them whatever the sort, so the totals still cover every movement.
    const displayedSalesman = useMemo(() => {
        const named = salesmanRows.filter(r => !r.special);
        const pinned = SPECIAL_ORDER
            .map(s => salesmanRows.find(r => r.special === s))
            .filter((r): r is SalesmanSummaryRow => !!r);
        if (!salesmanSort) {
            // Default: whoever moved the most stock first.
            named.sort((a, b) => movedOf(b) - movedOf(a) || a.label.localeCompare(b.label));
        } else {
            const { key, direction } = salesmanSort;
            const valueOf = (r: SalesmanSummaryRow): string | number => key === 'label' ? r.label : key === 'net' ? netOf(r) : r[key];
            named.sort((a, b) => {
                const av = valueOf(a), bv = valueOf(b);
                const cmp = typeof av === 'string' || typeof bv === 'string' ? String(av).localeCompare(String(bv)) : (av as number) - (bv as number);
                return direction === 'asc' ? cmp : -cmp;
            });
        }
        return [...named, ...pinned];
    }, [salesmanRows, salesmanSort]);

    // Footer totals always match what's on screen (and what exports).
    const salesmanTotals = useMemo(() => displayedSalesman.reduce(
        (acc, r) => ({ sold: acc.sold + r.sold, wholesale: acc.wholesale + r.wholesale, ret: acc.ret + r.ret, buy: acc.buy + r.buy, movements: acc.movements + r.movements }),
        { sold: 0, wholesale: 0, ret: 0, buy: 0, movements: 0 }
    ), [displayedSalesman]);
    const namedSalesmanCount = displayedSalesman.filter(r => !r.special).length;

    const toggleSalesmanSort = (key: SalesmanSortKey) => setSalesmanSort(prev => prev?.key === key ? (prev.direction === 'asc' ? { key, direction: 'desc' } : null) : { key, direction: 'asc' });
    const toggleExpanded = (key: string) => setExpandedSalesman(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

    const exportSalesmanSummary = () => {
        if (displayedSalesman.length === 0) return;
        const summary: Record<string, string | number>[] = displayedSalesman.map(r => ({
            'Salesman': r.label, 'Sold': r.sold, 'Wholesale': r.wholesale, 'ReStock': r.ret, 'Buy': r.buy, 'Net': netOf(r), 'Movements': r.movements
        }));
        summary.push({ 'Salesman': 'Total', 'Sold': salesmanTotals.sold, 'Wholesale': salesmanTotals.wholesale, 'ReStock': salesmanTotals.ret, 'Buy': salesmanTotals.buy, 'Net': netOf(salesmanTotals), 'Movements': salesmanTotals.movements });
        // Second sheet: what each salesman's orders moved, product by product.
        const detail: Record<string, string | number>[] = [];
        for (const r of displayedSalesman) for (const p of r.products) {
            detail.push({ 'Salesman': r.label, 'Model': p.name, 'Sold': p.sold, 'Wholesale': p.wholesale, 'ReStock': p.ret, 'Buy': p.buy, 'Net': netOf(p) });
        }
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'By Salesman');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), 'By Salesman & Model');
        XLSX.writeFile(wb, `Movement_Summary_By_Salesman_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    const exportSummary = () => {
        if (view === 'salesman') { exportSalesmanSummary(); return; }
        if (displayedRows.length === 0) return;
        const exportData = displayedRows.map(r => ({
            'Model': r.name, 'Old Stock': r.oldStock, 'Sold': r.sold, 'Wholesale': r.wholesale,
            'ReStock': r.ret, 'Buy': r.buy, 'New Stock': r.newStock
        }));
        exportData.push({ 'Model': 'Total', 'Old Stock': totals.oldStock, 'Sold': totals.sold, 'Wholesale': totals.wholesale, 'ReStock': totals.ret, 'Buy': totals.buy, 'New Stock': totals.newStock });
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Movement Summary');
        XLSX.writeFile(wb, `Movement_Summary_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    if (!isOpen) return null;

    const rangeLabel = range.start || range.end
        ? `${range.start || '…'} → ${range.end || '…'}`
        : 'All time';

    // Tighter cells on phones so more of the table fits before scrolling.
    const numTd: React.CSSProperties = { padding: isMobile ? '7px 8px' : '9px 14px', textAlign: 'center', fontSize: isMobile ? '12px' : '13px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', borderBottom: '1px solid var(--color-border)' };
    const pill = (bg: string, color: string): React.CSSProperties => ({ display: 'inline-block', minWidth: isMobile ? '30px' : '36px', padding: isMobile ? '2px 7px' : '3px 10px', borderRadius: '12px', fontSize: isMobile ? '11px' : '12px', fontWeight: 700, background: bg, color });
    const zero = <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>0</span>;
    const thBase: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 2, padding: isMobile ? '8px 8px' : '10px 14px', background: 'var(--color-bg)', borderBottom: '2px solid var(--color-border)', fontSize: isMobile ? '10px' : '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)', textAlign: 'center', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
    const footTd: React.CSSProperties = { ...numTd, position: 'sticky', bottom: 0, background: 'var(--color-bg)', borderTop: '2px solid var(--color-border)', borderBottom: 'none', fontWeight: 800, padding: isMobile ? '9px 8px' : '11px 14px' };
    const chip = (active: boolean): React.CSSProperties => ({ padding: '6px 14px', borderRadius: '16px', fontSize: '12px', fontWeight: 600, border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`, background: active ? 'var(--color-primary)' : '#FFFFFF', color: active ? 'white' : 'var(--color-text-secondary)', cursor: 'pointer', transition: 'all 0.15s' });
    // Every header is clickable — show a faint ↕ on inactive columns so
    // sortability is visible, and a solid ↑ / ↓ on the active one.
    const arrow = (key: keyof MovementSummaryRow) => sort?.key === key
        ? <span style={{ marginLeft: '4px' }}>{sort.direction === 'asc' ? '↑' : '↓'}</span>
        : <span style={{ marginLeft: '4px', opacity: 0.35 }}>↕</span>;
    const salesmanArrow = (key: SalesmanSortKey) => salesmanSort?.key === key
        ? <span style={{ marginLeft: '4px' }}>{salesmanSort.direction === 'asc' ? '↑' : '↓'}</span>
        : <span style={{ marginLeft: '4px', opacity: 0.35 }}>↕</span>;
    const toggleSort = (key: keyof MovementSummaryRow) => setSort(prev => prev?.key === key ? (prev.direction === 'asc' ? { key, direction: 'desc' } : null) : { key, direction: 'asc' });

    return (
        <div
            onClick={onClose}
            style={{
                // Below the DateRangePicker portal (z 9999) so the calendar
                // opens ON TOP of this popup instead of hiding behind it.
                position: 'fixed', inset: 0, zIndex: 9000,
                background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: isMobile ? '12px' : '24px',
                animation: 'fadeIn 0.2s ease',
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: '#FFFFFF', borderRadius: '20px',
                    width: '100%', maxWidth: '820px', maxHeight: '88vh',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    boxShadow: '0 24px 48px rgba(0,0,0,0.2)',
                    animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
            >
                {/* Header */}
                <div style={{
                    padding: '18px 22px', borderBottom: '1px solid var(--color-border)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'linear-gradient(135deg, rgba(59,130,246,0.07), rgba(37,99,235,0.03))', gap: '10px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '13px', minWidth: 0 }}>
                        <div style={{
                            width: '42px', height: '42px', borderRadius: '12px', flexShrink: 0,
                            background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white',
                        }}>
                            <Table2 size={20} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <h2 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: '#111827' }}>Stock Movement Summary</h2>
                            <p style={{ fontSize: '12px', color: '#6B7280', margin: '2px 0 0 0' }}>
                                {rangeLabel}
                                {view === 'salesman' && ' · by Salesman'}
                                {warehouseId && ` · ${warehouses.find(w => w.id === warehouseId)?.name || ''}`}
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <div style={{ background: '#FFFFFF', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '2px' }}>
                            <DateRangePicker
                                compact={isMobile}
                                value={range}
                                onChange={(v) => { setRange(v); fetchSummary(v); }}
                            />
                        </div>
                        {(range.start || range.end) && (
                            <button
                                onClick={() => { const all = { start: '', end: '' }; setRange(all); fetchSummary(all); }}
                                style={{
                                    padding: '8px 12px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                                    border: '1px solid var(--color-border)', background: '#FFFFFF',
                                    color: '#6B7280', cursor: 'pointer', whiteSpace: 'nowrap'
                                }}
                            >
                                All time
                            </button>
                        )}
                        <button onClick={exportSummary} title="Export to Excel" style={{
                            display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px',
                            borderRadius: '10px', border: '1px solid var(--color-border)',
                            background: 'var(--color-bg)', color: '#111827', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
                        }}>
                            <Download size={14} /> {!isMobile && 'Export'}
                        </button>
                        <button onClick={onClose} style={{
                            background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                            cursor: 'pointer', color: '#6B7280', width: '34px', height: '34px',
                            borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* View toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', padding: isMobile ? '10px 12px' : '12px 22px', borderBottom: '1px solid var(--color-border)', background: '#FFFFFF', flexShrink: 0 }}>
                    <div role="tablist" aria-label="Group movements by" style={{ display: 'inline-flex', gap: '2px', padding: '2px', borderRadius: '18px', border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
                        <button role="tab" aria-selected={view === 'product'} onClick={() => setView('product')} style={{ ...chip(view === 'product'), border: 'none' }}>By Product</button>
                        <button role="tab" aria-selected={view === 'salesman'} onClick={() => setView('salesman')} style={{ ...chip(view === 'salesman'), border: 'none' }}>By Salesman</button>
                    </div>
                    {view === 'product' && (
                        <>
                            <span aria-hidden style={{ width: '1px', height: '20px', background: 'var(--color-border)', margin: '0 4px' }} />
                            <button onClick={() => setOnlyMovement(false)} style={chip(!onlyMovement)}>
                                All Products ({rows.length})
                            </button>
                            <button onClick={() => setOnlyMovement(true)} style={chip(onlyMovement)}>
                                With Movement ({movementCount})
                            </button>
                        </>
                    )}
                </div>

                {/* Body */}
                <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
                    {isLoading ? (
                        <div style={{ padding: '60px', textAlign: 'center', color: '#6B7280' }}>
                            <RefreshCw size={28} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px', display: 'block', opacity: 0.4 }} />
                            Building summary…
                        </div>
                    ) : view === 'salesman' ? (
                        !movementsData ? (
                            // The first load failed (toast already shown): there is nothing to match yet.
                            <div style={{ padding: '48px', textAlign: 'center', color: '#6B7280', fontSize: '13px' }}>
                                No stock movements loaded — change the period or reopen to retry.
                            </div>
                        ) : salesmanStatus === 'idle' || salesmanStatus === 'loading' ? (
                            <div style={{ padding: '60px', textAlign: 'center', color: '#6B7280' }}>
                                <RefreshCw size={28} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px', display: 'block', opacity: 0.4 }} />
                                Matching orders to salesmen…
                            </div>
                        ) : salesmanStatus === 'error' ? (
                            <div style={{ padding: '48px', textAlign: 'center', color: '#B91C1C', fontSize: '13px' }}>
                                Couldn't match movements to salesmen{salesmanError ? `: ${salesmanError}` : '.'}
                                <div style={{ marginTop: '12px' }}>
                                    <button onClick={() => setSalesmanStatus('idle')} style={chip(false)}>Try again</button>
                                </div>
                            </div>
                        ) : displayedSalesman.length === 0 ? (
                            <div style={{ padding: '48px', textAlign: 'center', color: '#6B7280', fontSize: '13px' }}>
                                No stock movements in this period.
                            </div>
                        ) : (
                            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: isMobile ? '520px' : '640px', background: '#FFFFFF' }}>
                                <thead>
                                    <tr>
                                        <th onClick={() => toggleSalesmanSort('label')} style={{ ...thBase, textAlign: 'left' }}>Salesman{salesmanArrow('label')}</th>
                                        <th onClick={() => toggleSalesmanSort('sold')} style={{ ...thBase, color: '#DC2626' }}>Sold{salesmanArrow('sold')}</th>
                                        <th onClick={() => toggleSalesmanSort('wholesale')} style={{ ...thBase, color: '#4F46E5' }}>Wholesale{salesmanArrow('wholesale')}</th>
                                        <th onClick={() => toggleSalesmanSort('ret')} style={{ ...thBase, color: '#B45309' }}>ReStock{salesmanArrow('ret')}</th>
                                        <th onClick={() => toggleSalesmanSort('buy')} style={{ ...thBase, color: '#7E22CE' }}>Buy{salesmanArrow('buy')}</th>
                                        <th onClick={() => toggleSalesmanSort('net')} style={{ ...thBase, color: '#2563EB' }} title="Stock added (ReStock + Buy) minus stock removed (Sold + Wholesale)">Net{salesmanArrow('net')}</th>
                                        <th onClick={() => toggleSalesmanSort('movements')} style={thBase} title="Number of stock movement lines">Movements{salesmanArrow('movements')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayedSalesman.map((r, idx) => {
                                        const moved = movedOf(r) > 0;
                                        const open = moved && expandedSalesman.has(r.key);
                                        const net = netOf(r);
                                        const toggle = () => { if (moved) toggleExpanded(r.key); };
                                        return (
                                            <React.Fragment key={r.key}>
                                                <tr
                                                    onClick={toggle}
                                                    onKeyDown={e => { if (moved && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } }}
                                                    tabIndex={moved ? 0 : undefined}
                                                    aria-expanded={moved ? open : undefined}
                                                    style={{ background: idx % 2 === 1 ? 'rgba(0,0,0,0.015)' : '#FFFFFF', cursor: moved ? 'pointer' : 'default' }}
                                                >
                                                    <td title={r.special ? `${r.label} — ${SPECIAL_HINTS[r.special]}` : r.label} style={{ padding: isMobile ? '7px 10px' : '9px 14px', fontSize: isMobile ? '12px' : '13px', fontWeight: 600, borderBottom: '1px solid var(--color-border)', color: moved ? 'var(--color-text-main)' : 'var(--color-text-secondary)', borderLeft: `3px solid ${r.special ? '#F59E0B' : '#3B82F6'}`, whiteSpace: 'nowrap', maxWidth: isMobile ? '160px' : '260px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', maxWidth: '100%' }}>
                                                            {moved ? (open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />) : <span style={{ width: '14px', flexShrink: 0 }} />}
                                                            <span style={{ fontStyle: r.special ? 'italic' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
                                                        </span>
                                                    </td>
                                                    <td style={numTd}>{r.sold > 0 ? <span style={pill('rgba(239,68,68,0.1)', '#DC2626')}>-{r.sold}</span> : zero}</td>
                                                    <td style={numTd}>{r.wholesale > 0 ? <span style={pill('rgba(99,102,241,0.1)', '#4F46E5')}>-{r.wholesale}</span> : zero}</td>
                                                    <td style={numTd}>{r.ret > 0 ? <span style={pill('rgba(245,158,11,0.12)', '#B45309')}>+{r.ret}</span> : zero}</td>
                                                    <td style={numTd}>{r.buy > 0 ? <span style={pill('rgba(147,51,234,0.1)', '#7E22CE')}>+{r.buy}</span> : zero}</td>
                                                    <td style={{ ...numTd, fontWeight: 800, color: net > 0 ? '#059669' : net < 0 ? '#DC2626' : 'var(--color-text-muted)' }}>{net > 0 ? `+${net}` : net}</td>
                                                    <td style={{ ...numTd, color: 'var(--color-text-secondary)' }}>{r.movements}</td>
                                                </tr>
                                                {open && r.products.map(p => {
                                                    const pn = netOf(p);
                                                    const subTd: React.CSSProperties = { ...numTd, fontSize: isMobile ? '11px' : '12px', fontWeight: 500, background: 'rgba(59,130,246,0.04)' };
                                                    return (
                                                        <tr key={`${r.key}|${p.id}`}>
                                                            <td title={p.name} style={{ padding: isMobile ? '5px 10px 5px 34px' : '6px 14px 6px 40px', fontSize: isMobile ? '11px' : '12px', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', background: 'rgba(59,130,246,0.04)', whiteSpace: 'nowrap', maxWidth: isMobile ? '160px' : '260px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</td>
                                                            <td style={subTd}>{p.sold > 0 ? `-${p.sold}` : zero}</td>
                                                            <td style={subTd}>{p.wholesale > 0 ? `-${p.wholesale}` : zero}</td>
                                                            <td style={subTd}>{p.ret > 0 ? `+${p.ret}` : zero}</td>
                                                            <td style={subTd}>{p.buy > 0 ? `+${p.buy}` : zero}</td>
                                                            <td style={{ ...subTd, color: pn > 0 ? '#059669' : pn < 0 ? '#DC2626' : 'var(--color-text-muted)' }}>{pn > 0 ? `+${pn}` : pn}</td>
                                                            <td style={subTd} />
                                                        </tr>
                                                    );
                                                })}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr>
                                        <td style={{ ...footTd, textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)' }}>
                                            Total · {namedSalesmanCount} {namedSalesmanCount === 1 ? 'salesman' : 'salesmen'}
                                        </td>
                                        <td style={{ ...footTd, color: '#DC2626' }}>{salesmanTotals.sold > 0 ? `-${salesmanTotals.sold}` : 0}</td>
                                        <td style={{ ...footTd, color: '#4F46E5' }}>{salesmanTotals.wholesale > 0 ? `-${salesmanTotals.wholesale}` : 0}</td>
                                        <td style={{ ...footTd, color: '#B45309' }}>{salesmanTotals.ret > 0 ? `+${salesmanTotals.ret}` : 0}</td>
                                        <td style={{ ...footTd, color: '#7E22CE' }}>{salesmanTotals.buy > 0 ? `+${salesmanTotals.buy}` : 0}</td>
                                        <td style={{ ...footTd, color: '#2563EB' }}>{netOf(salesmanTotals) > 0 ? `+${netOf(salesmanTotals)}` : netOf(salesmanTotals)}</td>
                                        <td style={{ ...footTd, color: 'var(--color-text-secondary)' }}>{salesmanTotals.movements}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        )
                    ) : displayedRows.length === 0 ? (
                        <div style={{ padding: '48px', textAlign: 'center', color: '#6B7280', fontSize: '13px' }}>
                            No products with movement in this period.
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: isMobile ? '520px' : '640px', background: '#FFFFFF' }}>
                            <thead>
                                <tr>
                                    <th onClick={() => toggleSort('name')} style={{ ...thBase, textAlign: 'left' }}>Model{arrow('name')}</th>
                                    <th onClick={() => toggleSort('oldStock')} style={thBase}>Old Stock{arrow('oldStock')}</th>
                                    <th onClick={() => toggleSort('sold')} style={{ ...thBase, color: '#DC2626' }}>Sold{arrow('sold')}</th>
                                    <th onClick={() => toggleSort('wholesale')} style={{ ...thBase, color: '#4F46E5' }}>Wholesale{arrow('wholesale')}</th>
                                    <th onClick={() => toggleSort('ret')} style={{ ...thBase, color: '#B45309' }}>ReStock{arrow('ret')}</th>
                                    <th onClick={() => toggleSort('buy')} style={{ ...thBase, color: '#7E22CE' }}>Buy{arrow('buy')}</th>
                                    <th onClick={() => toggleSort('newStock')} style={{ ...thBase, color: '#2563EB' }}>New Stock{arrow('newStock')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayedRows.map((r, idx) => {
                                    const moved = hasMovement(r);
                                    const net = r.newStock - r.oldStock;
                                    return (
                                        <tr key={r.id} style={{ background: idx % 2 === 1 ? 'rgba(0,0,0,0.015)' : '#FFFFFF' }}>
                                            <td style={{ padding: isMobile ? '7px 10px' : '9px 14px', fontSize: isMobile ? '12px' : '13px', fontWeight: 600, borderBottom: '1px solid var(--color-border)', color: moved ? 'var(--color-text-main)' : 'var(--color-text-secondary)', borderLeft: `3px solid ${moved ? '#3B82F6' : 'transparent'}`, whiteSpace: 'nowrap', maxWidth: isMobile ? '140px' : '240px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {r.name}
                                            </td>
                                            <td style={{ ...numTd, color: 'var(--color-text-secondary)' }}>{r.oldStock}</td>
                                            <td style={numTd}>{r.sold > 0 ? <span style={pill('rgba(239,68,68,0.1)', '#DC2626')}>-{r.sold}</span> : zero}</td>
                                            <td style={numTd}>{r.wholesale > 0 ? <span style={pill('rgba(99,102,241,0.1)', '#4F46E5')}>-{r.wholesale}</span> : zero}</td>
                                            <td style={numTd}>{r.ret > 0 ? <span style={pill('rgba(245,158,11,0.12)', '#B45309')}>+{r.ret}</span> : zero}</td>
                                            <td style={numTd}>{r.buy > 0 ? <span style={pill('rgba(147,51,234,0.1)', '#7E22CE')}>+{r.buy}</span> : zero}</td>
                                            <td style={{ ...numTd, fontWeight: 800, color: 'var(--color-text-main)' }}>
                                                {r.newStock}
                                                {net !== 0 && (
                                                    <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 700, color: net > 0 ? '#059669' : '#DC2626' }}>
                                                        {net > 0 ? `▲${net}` : `▼${Math.abs(net)}`}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td style={{ ...footTd, textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)' }}>
                                        Total · {displayedRows.length} {displayedRows.length === 1 ? 'model' : 'models'}
                                    </td>
                                    <td style={{ ...footTd, color: 'var(--color-text-secondary)' }}>{totals.oldStock}</td>
                                    <td style={{ ...footTd, color: '#DC2626' }}>{totals.sold > 0 ? `-${totals.sold}` : 0}</td>
                                    <td style={{ ...footTd, color: '#4F46E5' }}>{totals.wholesale > 0 ? `-${totals.wholesale}` : 0}</td>
                                    <td style={{ ...footTd, color: '#B45309' }}>{totals.ret > 0 ? `+${totals.ret}` : 0}</td>
                                    <td style={{ ...footTd, color: '#7E22CE' }}>{totals.buy > 0 ? `+${totals.buy}` : 0}</td>
                                    <td style={{ ...footTd, color: '#2563EB' }}>{totals.newStock}</td>
                                </tr>
                            </tfoot>
                        </table>
                    )}
                </div>
            </div>
            {/* Entrance animations — defined here so the popup animates on any page. */}
            <style>{`
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideUp { from { opacity: 0; transform: translateY(20px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
            `}</style>
        </div>
    );
};

export default StockMovementSummaryModal;
