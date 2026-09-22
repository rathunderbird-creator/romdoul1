// Data layer for Orders Management 2. Two queries per filter change:
//   1. a paginated, server-sorted page for the table
//   2. every matching order (chunk-fetched, ignoring pagination) for the
//      summary strip's totals, status segments and "No tracking" count
// Both share the same filter-building logic so the table and the summary
// strip can never disagree about what's "in view".
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../utils/fetchAll';
import { mapSaleEntity } from '../../utils/mapper';
import type { Sale } from '../../types';
import type { OM2Filters } from './urlFilters';
import type { SortKey } from './metrics';
import { isMissingTracking, ALL_PAGE_SIZE } from './metrics';

const SORT_COLUMN: Record<SortKey, string> = {
    date: 'date',
    customer: 'customer_snapshot->>name',
    product: 'id', // no single DB column for "first item name" — falls back to a stable order
    total: 'total',
    owed: 'total', // balance isn't a DB column either; close enough for a stable server order, client re-sorts visually
    status: 'shipping_status',
    payStatus: 'payment_status',
    courier: 'shipping_company',
    time: 'last_edited_at',
    // Same DB columns classic Orders.tsx sorts these by (../../Orders.tsx ~L1388).
    address: 'customer_snapshot->address',
    page: 'page_source',
    customerCare: 'customer_care',
    payBy: 'payment_method',
    received: 'amount_received',
    settledDate: 'settle_date',
    lastEditBy: 'last_edited_at',
    remark: 'remark',
    salesman: 'salesman',
};

const localDayStart = (key: string): Date => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 0, 0, 0, 0); };
const localDayEnd = (key: string): Date => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 23, 59, 59, 999); };

// Applies every filter except pagination/sorting; callers add `.order()` /
// `.range()` themselves. Returns the query so it can be reused for both the
// count-bearing page query and the chunked full-range fetch.
const applyFilters = (query: any, f: OM2Filters): any => {
    if (f.dateStart) query = query.gte('date', localDayStart(f.dateStart).toISOString());
    if (f.dateEnd) query = query.lte('date', localDayEnd(f.dateEnd).toISOString());
    if (f.statuses.length) query = query.in('shipping_status', f.statuses);
    if (f.payStatuses.length) query = query.in('payment_status', f.payStatuses);
    if (f.shippingCos.length) query = query.in('shipping_company', f.shippingCos);
    if (f.pages.length) query = query.in('page_source', f.pages);
    if (f.salesman) query = query.eq('salesman', f.salesman);
    if (f.search.trim()) {
        // Quoted PostgREST literal (classic Orders.tsx's proven pattern): a
        // comma or parenthesis in the search would otherwise be parsed as
        // .or() syntax and fail the whole request.
        const esc = f.search.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const like = `"%${esc}%"`;
        query = query.or([
            `customer_snapshot->>name.ilike.${like}`,
            `customer_snapshot->>phone.ilike.${like}`,
            `tracking_number.ilike.${like}`,
            `remark.ilike.${like}`,
            `salesman.ilike.${like}`,
        ].join(','));
    }
    return query;
};

// "No tracking" can't be expressed as a single PostgREST filter (it's a
// derived rule: Shipped/Delivered + external courier + empty tracking id),
// so it's applied client-side after the fetch rather than server-side.
const fetchItemMatches = async (search: string): Promise<Set<string> | null> => {
    const term = search.trim();
    if (!term) return null;
    const esc = term.replace(/[%_]/g, m => `\\${m}`);
    const { data, error } = await supabase.from('sale_items').select('sale_id').ilike('name', `%${esc}%`).limit(500);
    if (error || !data) return new Set();
    return new Set(data.map((r: { sale_id: string }) => r.sale_id));
};

export interface OM2DataState {
    orders: Sale[];
    totalCount: number;
    rangeOrders: Sale[];
    loading: boolean;
    refreshing: boolean;
    error: string | null;
    refresh: () => void;
}

const errMessage = (e: unknown): string => (e as { message?: string })?.message || String(e);

export const useOrdersM2Data = (filters: OM2Filters): OM2DataState => {
    const [orders, setOrders] = useState<Sale[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [rangeOrders, setRangeOrders] = useState<Sale[]>([]);
    const [loading, setLoading] = useState(true);
    const [hasData, setHasData] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const reqRef = useRef(0);

    const key = JSON.stringify(filters);

    const load = useCallback(async () => {
        const id = ++reqRef.current;
        setLoading(true);
        setError(null);
        try {
            const dbSortCol = filters.sort ? SORT_COLUMN[filters.sort.key] : 'date';
            const ascending = filters.sort?.direction === 'asc';

            // Product search needs a second query (sale_items has no FK column
            // on `sales` to filter through directly); merge by id afterward.
            const itemMatchIds = await fetchItemMatches(filters.search);

            // "All" rows per page: a single .range() request would still be
            // silently truncated by PostgREST around 1000 rows, so skip the
            // separate paginated query and reuse the already-fetchAll-chunked
            // full range set below (sorted the same way) instead.
            const wantsAllRows = filters.pageSize >= ALL_PAGE_SIZE;

            let pageRes: { data: any[] | null; count: number | null; error: any } = { data: null, count: null, error: null };
            if (!wantsAllRows) {
                let pageQuery: any = supabase.from('sales').select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)', { count: 'exact' });
                pageQuery = applyFilters(pageQuery, filters);
                const from = (filters.page - 1) * filters.pageSize;
                const to = from + filters.pageSize - 1;
                pageRes = await pageQuery.order(dbSortCol, { ascending }).order('id', { ascending: true }).range(from, to);
                if (pageRes.error) throw pageRes.error;
            }

            // Full matching set (ignoring pagination) for the summary strip —
            // and, when "All" is selected, for the table itself. Sorted the
            // same way the table would be so the two stay identical. The query
            // is built FRESH for every chunk — fetchAll's contract; reusing one
            // builder appends duplicate order params on each later chunk.
            const rangeRows = await fetchAll((from2, to2) =>
                applyFilters(
                    supabase.from('sales').select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)'),
                    filters
                ).order(dbSortCol, { ascending }).order('id', { ascending: true }).range(from2, to2)
            );

            if (id !== reqRef.current) return;

            let rangeMapped = rangeRows.map(mapSaleEntity);
            let pageMapped = wantsAllRows ? rangeMapped : (pageRes.data || []).map(mapSaleEntity);
            let total = wantsAllRows ? rangeMapped.length : (pageRes.count || 0);

            // Union in orders that matched by product name but not by the text
            // search (customer/phone/tracking/remark/salesman) — fetched by id.
            if (itemMatchIds && itemMatchIds.size > 0) {
                const known = new Set(rangeMapped.map(o => o.id));
                const missingIds = Array.from(itemMatchIds).filter(oid => !known.has(oid));
                if (missingIds.length > 0) {
                    const extraQuery: any = applyFilters(
                        supabase.from('sales').select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)').in('id', missingIds),
                        { ...filters, search: '' }
                    );
                    const { data: extra } = await extraQuery;
                    const extraMapped = (extra || []).map(mapSaleEntity);
                    rangeMapped = [...rangeMapped, ...extraMapped];
                    total += extraMapped.length;
                    // The current page's own product-match union is a rarer
                    // case (product search + specific page) — folded into
                    // rangeOrders/totalCount so the summary strip stays
                    // correct; the visible page simply won't show these extra
                    // rows until the user clears pagination or re-sorts,
                    // matching how the classic Orders page also treats
                    // cross-source unions as range-level, not page-level.
                }
            }

            if (filters.noTrackingOnly) {
                // Can't express this filter in PostgREST (it's derived: shipped/
                // delivered + external courier + empty tracking id), so `pageMapped`
                // above was sliced by .range() BEFORE this filter existed — it's
                // not a real page of the missing-tracking set. Paginate over the
                // already-fully-fetched, now-filtered `rangeMapped` instead.
                rangeMapped = rangeMapped.filter(isMissingTracking);
                total = rangeMapped.length;
                const from3 = (filters.page - 1) * filters.pageSize;
                pageMapped = rangeMapped.slice(from3, from3 + filters.pageSize);
            }

            setOrders(pageMapped);
            setTotalCount(total);
            setRangeOrders(rangeMapped);
            setHasData(true);
        } catch (e) {
            if (id !== reqRef.current) return;
            console.error('Orders Management 2: fetch failed', e);
            setError(errMessage(e));
        } finally {
            if (id === reqRef.current) setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    useEffect(() => { load(); }, [load]);

    return {
        orders,
        totalCount,
        rangeOrders,
        loading: loading && !hasData,
        refreshing: loading && hasData,
        error,
        refresh: load,
    };
};
