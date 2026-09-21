// Data layer for Prediction by Staff: one month's sales, chunk-fetched with
// the exact same select as ../IncomePrediction.tsx and the other Income
// Prediction screens so all four reconcile. No writes, no second table.
//
// Products come from fetchAllProducts (../../utils/fetchAllProducts) rather
// than useStore() — same reasoning as the other two prediction screens: a
// discontinued product's historical COGS this month must not silently drop
// to 0 just because useStore().products is active-only.
import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../utils/fetchAll';
import { fetchAllProducts } from '../../utils/fetchAllProducts';
import { mapSaleEntity } from '../../utils/mapper';
import { monthBounds, type Order } from './metrics';
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

export const useStaffIncomeData = (month: string): StaffIncomeDataState => {
    const [sales, setSales] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [now, setNow] = useState<Date>(() => new Date());
    const [loading, setLoading] = useState(true);
    // Which month `sales` currently holds — see the other Income Prediction
    // hooks' identical loadedMonth comment for why this isn't just a boolean.
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
            console.error('Prediction by Staff: fetch failed', e);
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
