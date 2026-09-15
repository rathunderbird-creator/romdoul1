// Data layer for Prediction by Product: one month's sales, chunk-fetched
// with the exact same select as ../IncomePrediction.tsx and
// ../pageIncomePrediction/usePageIncomeData.ts so all three "Income
// Prediction" screens see identical rows and reconcile. No writes, no
// second table.
//
// Products come from fetchAllProducts (../../utils/fetchAllProducts), not
// useStore() — deliberately including DEACTIVATED products, so a
// discontinued SKU's historical COGS this month isn't silently dropped; see
// that util's header comment for the full reasoning (shared with
// ../pageIncomePrediction/usePageIncomeData.ts, which does the same).
// metrics.ts's buildOverview still only *lists* active products among the
// zero-sales "nothing moved" rows — it uses this full (active + inactive)
// set purely for cost/name/category lookups.
import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../utils/fetchAll';
import { fetchAllProducts } from '../../utils/fetchAllProducts';
import { mapSaleEntity } from '../../utils/mapper';
import { monthBounds, type Order } from './metrics';
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

export const useProductIncomeData = (month: string): ProductIncomeDataState => {
    const [sales, setSales] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [now, setNow] = useState<Date>(() => new Date());
    const [loading, setLoading] = useState(true);
    // Which month `sales` currently holds — not just "has a load ever
    // finished" — so switching month doesn't render the PREVIOUS month's
    // rows (filtered to nothing by metrics.ts's month-prefix check) as a
    // false "no sales" flash while the new fetch is in flight. Same fix as
    // usePageIncomeData.ts's loadedMonth.
    const [loadedMonth, setLoadedMonth] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const reqRef = useRef(0);

    const load = useCallback(async () => {
        const id = ++reqRef.current;
        setLoading(true);
        setError(null);
        try {
            const b = monthBounds(month);
            const [salesRows, productsRows] = await Promise.all([
                fetchAll((from, to) =>
                    supabase.from('sales')
                        .select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)')
                        .gte('date', b.startIso).lt('date', b.endIso)
                        .order('id', { ascending: true }).range(from, to)
                ),
                fetchAllProducts(),
            ]);
            if (id !== reqRef.current) return;
            setSales(salesRows.map(mapSaleEntity));
            setProducts(productsRows);
            setNow(new Date());
            setLoadedMonth(month);
        } catch (e) {
            if (id !== reqRef.current) return;
            console.error('Prediction by Product: fetch failed', e);
            setError(errMessage(e));
        } finally {
            if (id === reqRef.current) setLoading(false);
        }
    }, [month]);

    useEffect(() => { load(); }, [load]);

    const hasData = loadedMonth === month;
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
