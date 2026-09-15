// Data layer for Dashboard2: orders for the selected range AND the equally
// long period before it (for the "vs previous" deltas), plus stock-movement
// totals for the inventory detail. Same Supabase queries the original
// dashboard uses, chunk-fetched so wide ranges never hit the ~1000-row cap.
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../utils/fetchAll';
import { mapSaleEntity } from '../../utils/mapper';
import type { Sale } from '../../types';
import { previousRange, todayKey, type DateRange } from './metrics';

const RANGE_KEY = 'dashboard2_dateRange';

const readStoredRange = (): DateRange => {
    try {
        const raw = localStorage.getItem(RANGE_KEY);
        if (raw) {
            const v = JSON.parse(raw);
            if (v && typeof v.start === 'string' && typeof v.end === 'string') return { start: v.start, end: v.end };
        }
    } catch { /* ignore */ }
    const today = todayKey();
    return { start: today, end: today };
};

// Local midnight / end-of-day for a YYYY-MM-DD key (parsed as a LOCAL date —
// `new Date('YYYY-MM-DD')` would be UTC midnight and shift the day west of UTC).
const localDayStart = (key: string): Date => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
};
const localDayEnd = (key: string): Date => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59, 999);
};

const fetchSales = async (range: DateRange): Promise<Sale[]> => {
    const rows = await fetchAll((from, to) => {
        let q = supabase.from('sales').select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)');
        if (range.start) q = q.gte('date', localDayStart(range.start).toISOString());
        if (range.end) q = q.lte('date', localDayEnd(range.end).toISOString());
        return q.order('id', { ascending: true }).range(from, to);
    });
    return rows.map(mapSaleEntity);
};

const fetchStockTotals = async (range: DateRange): Promise<{ stockIn: number; stockOut: number }> => {
    const rows = await fetchAll<{ id: string; type: string; quantity: number }>((from, to) => {
        let q = supabase.from('stock_movements').select('id, type, quantity');
        if (range.start) q = q.gte('movement_date', range.start);
        if (range.end) q = q.lte('movement_date', range.end);
        return q.order('id', { ascending: true }).range(from, to);
    });
    let stockIn = 0, stockOut = 0;
    for (const r of rows) {
        if (r.type === 'in') stockIn += Number(r.quantity) || 0;
        else if (r.type === 'out') stockOut += Number(r.quantity) || 0;
    }
    return { stockIn, stockOut };
};

export interface Dashboard2DataState {
    range: DateRange;
    setRange: (r: DateRange) => void;
    previous: DateRange | null;
    orders: Sale[];
    previousOrders: Sale[];
    previousAvailable: boolean;   // false when the comparison fetch failed
    stockIn: number;
    stockOut: number;
    loading: boolean;             // no data yet for this range → skeletons
    refreshing: boolean;          // data on screen, refetch in flight
    salesError: string | null;
    inventoryError: string | null;
    refresh: () => void;
    retrySales: () => void;
    retryInventory: () => void;
    now: Date;
}

const errMessage = (e: unknown): string => (e as { message?: string })?.message || String(e);

export const useDashboard2Data = (): Dashboard2DataState => {
    const [range, setRangeState] = useState<DateRange>(readStoredRange);
    const [orders, setOrders] = useState<Sale[]>([]);
    const [previousOrders, setPreviousOrders] = useState<Sale[]>([]);
    const [previousAvailable, setPreviousAvailable] = useState(true);
    const [stock, setStock] = useState({ stockIn: 0, stockOut: 0 });
    const [salesError, setSalesError] = useState<string | null>(null);
    const [inventoryError, setInventoryError] = useState<string | null>(null);
    const [salesLoading, setSalesLoading] = useState(true);
    const [loadedKey, setLoadedKey] = useState<string | null>(null);
    const [now, setNow] = useState(() => new Date());
    // Ignore responses from superseded requests (fast range switching).
    const salesReqRef = useRef(0);
    const stockReqRef = useRef(0);

    const rangeKey = `${range.start}|${range.end}`;
    const previous = previousRange(range);

    const setRange = useCallback((r: DateRange) => {
        setRangeState(r);
        try { localStorage.setItem(RANGE_KEY, JSON.stringify(r)); } catch { /* ignore */ }
    }, []);

    const loadSales = useCallback(async () => {
        const id = ++salesReqRef.current;
        setSalesLoading(true);
        setSalesError(null);
        const prev = previousRange(range);
        const [cur, prevRes] = await Promise.allSettled([
            fetchSales(range),
            prev ? fetchSales(prev) : Promise.resolve([] as Sale[]),
        ]);
        if (id !== salesReqRef.current) return;
        setNow(new Date());
        if (cur.status === 'fulfilled') {
            setOrders(cur.value);
            setLoadedKey(`${range.start}|${range.end}`);
        } else {
            console.error('Dashboard2: orders fetch failed', cur.reason);
            setSalesError(errMessage(cur.reason));
        }
        if (prevRes.status === 'fulfilled') {
            setPreviousOrders(prevRes.value);
            setPreviousAvailable(true);
        } else {
            console.warn('Dashboard2: previous-period fetch failed', prevRes.reason);
            setPreviousOrders([]);
            setPreviousAvailable(false);
        }
        setSalesLoading(false);
    }, [range]);

    const loadStock = useCallback(async () => {
        const id = ++stockReqRef.current;
        setInventoryError(null);
        try {
            const totals = await fetchStockTotals(range);
            if (id !== stockReqRef.current) return;
            setStock(totals);
        } catch (e) {
            if (id !== stockReqRef.current) return;
            console.error('Dashboard2: stock movements fetch failed', e);
            setInventoryError(errMessage(e));
        }
    }, [range]);

    useEffect(() => { loadSales(); }, [loadSales]);
    useEffect(() => { loadStock(); }, [loadStock]);

    const refresh = useCallback(() => { loadSales(); loadStock(); }, [loadSales, loadStock]);

    const hasDataForRange = loadedKey === rangeKey;
    return {
        range,
        setRange,
        previous,
        orders: hasDataForRange ? orders : [],
        previousOrders: hasDataForRange ? previousOrders : [],
        previousAvailable,
        stockIn: stock.stockIn,
        stockOut: stock.stockOut,
        loading: salesLoading && !hasDataForRange,
        refreshing: salesLoading && hasDataForRange,
        salesError,
        inventoryError,
        refresh,
        retrySales: loadSales,
        retryInventory: loadStock,
        now,
    };
};
