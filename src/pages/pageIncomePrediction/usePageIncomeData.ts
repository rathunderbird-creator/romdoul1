// Data layer for Prediction by Page: one month's sales (chunk-fetched, same
// select as ../IncomePrediction.tsx so both screens see identical rows), the
// full product catalogue (active AND inactive — see ../../utils/
// fetchAllProducts.ts; a discontinued SKU's historical COGS this month must
// not silently drop to 0 just because useStore().products is active-only),
// the manual input rows for that month, and the sibling income_predictions
// rows (for the shared Staff / boost-reconciliation footer).
//
// The reads are awaited separately where it matters: the app runs against
// three hand-migrated Supabase instances, so page_income_predictions can be
// missing on one of them. In that case the screen still shows live numbers
// with the inputs disabled (`missingTable`), instead of blanking the month
// the way a single Promise.all across ALL of them would.
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../utils/fetchAll';
import { fetchAllProducts } from '../../utils/fetchAllProducts';
import { isMissingTableError, errMessage } from '../../utils/supabaseErrors';
import { mapSaleEntity } from '../../utils/mapper';
import { monthBounds, inputKey, type Order, type PageInputRow, type SiblingRow, type StaffInputRow, type InputField } from './metrics';
import type { Product } from '../../types';

export interface PageIncomeDataState {
    sales: Order[];
    products: Product[];   // active AND inactive — see file header
    inputs: PageInputRow[];
    sibling: SiblingRow[] | null;
    staffInputs: StaffInputRow[];
    now: Date;
    loading: boolean;
    refreshing: boolean;
    error: string | null;
    missingTable: boolean;
    refresh: () => void;
    commitInput: (date: string, page: string, field: InputField, value: number | null) => Promise<void>;
}

const INPUT_TABLE = 'page_income_predictions';
const SIBLING_TABLE = 'income_predictions';
// Income Prediction's auto-saved Staff input (create_income_prediction_staff.sql).
const STAFF_TABLE = 'income_prediction_staff';

const mapInput = (r: any): PageInputRow => ({
    date: String(r.date),
    page: String(r.page ?? ''),
    boostPage: Number(r.boost_page) || 0,
    shipping: r.shipping === null || r.shipping === undefined ? null : Number(r.shipping),
});

const mapSibling = (r: any): SiblingRow => ({
    date: String(r.date),
    shippedDelivered: Number(r.shipped_delivered) || 0,
    boostPage: Number(r.boost_page) || 0,
    shipping: Number(r.shipping) || 0,
    staff: Number(r.staff) || 0,
});

export const usePageIncomeData = (month: string, userName: string | undefined): PageIncomeDataState => {
    const [sales, setSales] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [inputs, setInputs] = useState<PageInputRow[]>([]);
    const [sibling, setSibling] = useState<SiblingRow[] | null>(null);
    const [staffInputs, setStaffInputs] = useState<StaffInputRow[]>([]);
    const [now, setNow] = useState<Date>(() => new Date());
    const [loading, setLoading] = useState(true);
    // Which month's data `sales`/`inputs`/`sibling` currently hold — not just
    // "has any load ever finished" — so switching month doesn't render stale
    // data (previously fetched month, now filtered to nothing by metrics.ts's
    // month prefix check) as a false "empty month" while the new fetch is in
    // flight. Same pattern as useDashboard2Data.ts's loadedKey/rangeKey.
    const [loadedMonth, setLoadedMonth] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [missingTable, setMissingTable] = useState(false);
    const reqRef = useRef(0);
    const inputsRef = useRef(inputs);
    inputsRef.current = inputs;
    // Serializes commits to the same (date, page) row so a second edit (e.g.
    // the adjacent Shipping cell, blurred while the Boost cell's save is still
    // in flight) is computed from — and reaches the database after — the
    // first edit, instead of both racing off a stale snapshot.
    const chainRef = useRef<Record<string, Promise<void>>>({});

    const load = useCallback(async () => {
        const id = ++reqRef.current;
        setLoading(true);
        setError(null);
        const b = monthBounds(month);
        try {
            // Half-open range of real instants from LOCAL midnight boundaries
            // (a `${month}-01T00:00:00Z` string would start 7 hours late).
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

            // DATE-typed columns are bounded by the month's own YYYY-MM-DD strings.
            let inputRows: PageInputRow[] = [];
            let missing = false;
            try {
                const rows = await fetchAll((from, to) =>
                    supabase.from(INPUT_TABLE).select('*')
                        .gte('date', b.firstDay).lte('date', b.lastDay)
                        .order('date', { ascending: true }).order('page', { ascending: true }).range(from, to)
                );
                inputRows = rows.map(mapInput);
            } catch (e) {
                if (!isMissingTableError(e)) throw e;
                missing = true;
            }

            let siblingRows: SiblingRow[] | null = null;
            try {
                const rows = await fetchAll((from, to) =>
                    supabase.from(SIBLING_TABLE).select('date, shipped_delivered, boost_page, shipping, staff')
                        .gte('date', b.firstDay).lte('date', b.lastDay)
                        .order('date', { ascending: true }).range(from, to)
                );
                siblingRows = rows.map(mapSibling);
            } catch (e) {
                // The footer degrades to "—"; the per-page numbers don't need it.
                console.warn('Prediction by Page: income_predictions unreadable', e);
            }

            // Auto-saved Staff from Income Prediction — overrides the frozen rows'
            // copy in the footer. Where the table isn't migrated yet the footer
            // just uses the frozen rows, as before.
            let staffRows: StaffInputRow[] = [];
            try {
                const rows = await fetchAll<{ date: string; staff: number | string | null }>((from, to) =>
                    supabase.from(STAFF_TABLE).select('date, staff')
                        .gte('date', b.firstDay).lte('date', b.lastDay)
                        .order('date', { ascending: true }).range(from, to)
                );
                staffRows = rows.map(r => ({ date: String(r.date), staff: Number(r.staff) || 0 }));
            } catch (e) {
                if (!isMissingTableError(e)) console.warn('Prediction by Page: income_prediction_staff unreadable', e);
            }

            if (id !== reqRef.current) return;
            setSales(salesRows.map(mapSaleEntity));
            setProducts(productsRows);
            setInputs(inputRows);
            setSibling(siblingRows);
            setStaffInputs(staffRows);
            setMissingTable(missing);
            setNow(new Date());
            setLoadedMonth(month);
        } catch (e) {
            if (id !== reqRef.current) return;
            console.error('Prediction by Page: fetch failed', e);
            setError(errMessage(e));
        } finally {
            if (id === reqRef.current) setLoading(false);
        }
    }, [month]);

    useEffect(() => { load(); }, [load]);

    // The actual upsert/delete for one commit, run only once it's this row's
    // turn in the chain (see commitInput below) — so `existing` always
    // reflects every earlier commit to the same row, including ones still
    // settling on the network when this one was queued.
    const doCommit = useCallback(async (date: string, page: string, field: InputField, value: number | null) => {
        const existing = inputsRef.current.find(r => r.date === date && r.page === page);
        const next: PageInputRow = {
            date,
            page,
            boostPage: existing?.boostPage ?? 0,
            shipping: existing?.shipping ?? null,
        };
        if (field === 'boostPage') next.boostPage = value ?? 0;
        else next.shipping = value;
        const empty = next.boostPage === 0 && next.shipping === null;

        // Optimistic patch applied synchronously (both the ref, read by the
        // very next queued commit, and React state, read by the view) —
        // reverted in the catch below if the write fails.
        const patch = (rows: PageInputRow[]): PageInputRow[] => {
            const rest = rows.filter(r => !(r.date === date && r.page === page));
            return empty ? rest : [...rest, next];
        };
        const previous = inputsRef.current;
        inputsRef.current = patch(previous);
        setInputs(inputsRef.current);

        try {
            if (empty) {
                if (existing) {
                    const { error: delError } = await supabase.from(INPUT_TABLE).delete().eq('date', date).eq('page', page);
                    if (delError) throw delError;
                }
            } else {
                const { error: upError } = await supabase.from(INPUT_TABLE).upsert({
                    date,
                    page,
                    boost_page: next.boostPage,
                    shipping: next.shipping,
                    updated_at: new Date().toISOString(),
                    updated_by: userName || 'System',
                }, { onConflict: 'date,page' });
                if (upError) throw upError;
            }
        } catch (e) {
            inputsRef.current = previous;
            setInputs(previous);
            throw e;
        }
    }, [userName]);

    // Upsert on the composite key (explicit onConflict — the three instances
    // are migrated by hand, so never rely on the live PK being inferred), or
    // delete the row once both inputs are back to "nothing entered". Queued
    // per (date, page) so overlapping edits to the two fields of one row
    // (Boost, Shipping) never race off the same stale snapshot.
    const commitInput = useCallback((date: string, page: string, field: InputField, value: number | null): Promise<void> => {
        const key = inputKey(date, page);
        const prior = chainRef.current[key] ?? Promise.resolve();
        const run = prior.catch(() => {}).then(() => doCommit(date, page, field, value));
        // Swallow so an awaited-later link in the chain never sees this
        // commit's rejection as its own — the caller still gets it via `run`.
        chainRef.current[key] = run.catch(() => {});
        return run;
    }, [doCommit]);

    const hasData = loadedMonth === month;
    return {
        sales: hasData ? sales : [],
        products: hasData ? products : [],
        inputs: hasData ? inputs : [],
        sibling: hasData ? sibling : null,
        staffInputs: hasData ? staffInputs : [],
        now,
        loading: loading && !hasData,
        refreshing: loading && hasData,
        error,
        missingTable,
        refresh: load,
        commitInput,
    };
};
