// Data layer for Prediction by Staff: the selected date range's sales,
// chunk-fetched (one parallel fetch per calendar month the range touches) with
// the exact same select as ../IncomePrediction.tsx and the other Income
// Prediction screens so all four reconcile. No writes, no second table.
//
// Products come from fetchAllProducts (../../utils/fetchAllProducts) rather
// than useStore() — same reasoning as the other two prediction screens: a
// discontinued product's historical COGS in this period must not silently drop
// to 0 just because useStore().products is active-only.
import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchInMonthWindows } from '../../utils/fetchInMonthWindows';
import { fetchAllProducts } from '../../utils/fetchAllProducts';
import { mapSaleEntity } from '../../utils/mapper';
import type { DateRange } from '../../utils/dateRange';
import type { Order } from './metrics';
import type { Product } from '../../types';

export interface StaffIncomeDataState {
    sales: Order[];
    products: Product[];   // active AND inactive — see file header
    now: Date;
    loading: boolean;
    refreshing: boolean;
    error: string | null;
    refresh: () => void;
}

const errMessage = (e: unknown): string => (e as { message?: string })?.message || String(e);

export const useStaffIncomeData = (range: DateRange): StaffIncomeDataState => {
    // Depend on the two day strings, not the `range` object: the caller rebuilds
    // it whenever the URL changes (e.g. opening a staff member), and that must
    // not trigger a refetch.
    const { from, to } = range;
    const rangeKey = `${from}|${to}`;
    const [sales, setSales] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [now, setNow] = useState<Date>(() => new Date());
    const [loading, setLoading] = useState(true);
    // Which range `sales` currently holds — see the other Income Prediction
    // hooks' identical loadedRange comment for why this isn't just a boolean.
    const [loadedRange, setLoadedRange] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const reqRef = useRef(0);

    const load = useCallback(async () => {
        const id = ++reqRef.current;
        setLoading(true);
        setError(null);
        try {
            const [salesRows, productsRows] = await Promise.all([
                fetchInMonthWindows({ from, to }, (startIso, endIso) => (a, b) =>
                    supabase.from('sales')
                        .select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)')
                        .gte('date', startIso).lt('date', endIso)
                        .order('id', { ascending: true }).range(a, b)
                ),
                fetchAllProducts(),
            ]);
            if (id !== reqRef.current) return;
            setSales(salesRows.map(mapSaleEntity));
            setProducts(productsRows);
            setNow(new Date());
            setLoadedRange(`${from}|${to}`);
        } catch (e) {
            if (id !== reqRef.current) return;
            console.error('Prediction by Staff: fetch failed', e);
            setError(errMessage(e));
        } finally {
            if (id === reqRef.current) setLoading(false);
        }
    }, [from, to]);

    useEffect(() => { load(); }, [load]);

    const hasData = loadedRange === rangeKey;
    return {
        sales: hasData ? sales : [],
        products: hasData ? products : [],
        now,
        loading: loading && !hasData,
        refreshing: loading && hasData,
        error,
        refresh: load,
    };
};
