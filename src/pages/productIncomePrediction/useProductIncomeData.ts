// Data layer for Prediction by Product: the selected date range's sales,
// chunk-fetched (one parallel fetchAll per calendar month the range touches,
// see ../../utils/fetchInMonthWindows) with the exact same select as
// ../IncomePrediction.tsx and ../pageIncomePrediction/usePageIncomeData.ts so
// all the "Income Prediction" screens see identical rows and reconcile. No
// writes, no second table.
//
// Products come from fetchAllProducts (../../utils/fetchAllProducts), not
// useStore() — deliberately including DEACTIVATED products, so a
// discontinued SKU's historical COGS in the period isn't silently dropped; see
// that util's header comment for the full reasoning (shared with
// ../pageIncomePrediction/usePageIncomeData.ts, which does the same).
// metrics.ts's buildOverview still only *lists* active products among the
// zero-sales "nothing moved" rows — it uses this full (active + inactive)
// set purely for cost/name/category lookups.
import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchInMonthWindows } from '../../utils/fetchInMonthWindows';
import { fetchAllProducts } from '../../utils/fetchAllProducts';
import { mapSaleEntity } from '../../utils/mapper';
import type { DateRange } from '../../utils/dateRange';
import type { Order } from './metrics';
import type { Product } from '../../types';

export interface ProductIncomeDataState {
    sales: Order[];
    products: Product[];   // active AND inactive — see file header
    now: Date;
    loading: boolean;
    refreshing: boolean;
    error: string | null;
    refresh: () => void;
}

const errMessage = (e: unknown): string => (e as { message?: string })?.message || String(e);

export const useProductIncomeData = (range: DateRange): ProductIncomeDataState => {
    const [sales, setSales] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [now, setNow] = useState<Date>(() => new Date());
    const [loading, setLoading] = useState(true);
    // Key the fetch on the range's two day strings, not on the `range` object:
    // the container rebuilds that object whenever ANY URL param changes (e.g.
    // opening a product), and that must not refetch the same period.
    const { from: rangeFrom, to: rangeTo } = range;
    const rangeKey = `${rangeFrom}|${rangeTo}`;
    // Which range `sales` currently holds — not just "has a load ever
    // finished" — so switching range doesn't render the PREVIOUS range's
    // rows (filtered to nothing by metrics.ts's inRange check) as a
    // false "no sales" flash while the new fetch is in flight. Same fix as
    // usePageIncomeData.ts's loadedRange.
    const [loadedRange, setLoadedRange] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const reqRef = useRef(0);

    const load = useCallback(async () => {
        const id = ++reqRef.current;
        setLoading(true);
        setError(null);
        try {
            const [salesRows, productsRows] = await Promise.all([
                fetchInMonthWindows({ from: rangeFrom, to: rangeTo }, (startIso, endIso) => (from, to) =>
                    supabase.from('sales')
                        .select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)')
                        .gte('date', startIso).lt('date', endIso)
                        .order('id', { ascending: true }).range(from, to)
                ),
                fetchAllProducts(),
            ]);
            if (id !== reqRef.current) return;
            setSales(salesRows.map(mapSaleEntity));
            setProducts(productsRows);
            setNow(new Date());
            setLoadedRange(`${rangeFrom}|${rangeTo}`);
        } catch (e) {
            if (id !== reqRef.current) return;
            console.error('Prediction by Product: fetch failed', e);
            setError(errMessage(e));
        } finally {
            if (id === reqRef.current) setLoading(false);
        }
    }, [rangeFrom, rangeTo]);

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
