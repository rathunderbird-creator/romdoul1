// FIFO read RPCs (migrations/add_fifo_costing.sql; guarded wrappers in
// migrations/add_session_guards.sql): fifo_inventory_valuation,
// fifo_inventory_check and fifo_peek. A store that has not run those files
// answers "missing", and each caller falls back to its old calculation and
// says so on screen.
import { useCallback, useEffect, useState } from 'react';
import { isRpcMissingError } from '../context/StoreContext';
import { rpcWithSession } from '../utils/dbFunctions';

export const FIFO_MISSING_MESSAGE = 'FIFO costing is not set up on this store yet: it needs migrations/add_fifo_costing.sql, the pool rebuild (migrations/fifo_rebuild_pool.sql), the four stock packs and migrations/add_session_guards.sql, run in this store\'s Supabase SQL editor.';

const errorMessage = (e: unknown): string => {
    if (e && typeof e === 'object' && 'message' in e) return String((e as { message?: unknown }).message || '');
    return String(e || '');
};

// The guarded wrapper exists but its implementation does not: it raises
// "FIFO costing is not set up" rather than a missing-function error.
export const isFifoMissingError = (e: unknown): boolean => {
    const msg = errorMessage(e);
    return isRpcMissingError(e) || /FIFO costing is not set up/i.test(msg)
        || (/fifo_/i.test(msg) && /schema cache|does not exist/i.test(msg));
};

const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

export interface FifoValuationRow {
    product_id: string;
    product_name: string;
    is_active: boolean;
    stock: number;
    qty: number;
    value: number;
    avg_cost: number | null;
    next_cost: number | null;
    last_cost: number | null;
}

export type FifoStatus = 'loading' | 'ready' | 'missing' | 'error';

export interface FifoValuationState {
    status: FifoStatus;
    rows: Map<string, FifoValuationRow>;
    message: string | null;
    reload: () => void;
}

// Unit cost of a product's stock at FIFO: the in_stock layers' value over
// their count; with no layers, the last receipt cost; with neither, the
// caller's fallback (products.purchase_cost).
export function fifoUnitCost(row: FifoValuationRow | undefined, fallback: number): number {
    if (row && row.qty > 0) return row.value / row.qty;
    if (row && row.last_cost !== null && row.last_cost > 0) return row.last_cost;
    return fallback;
}

// Products whose in_stock layer count is not products.stock.
export function fifoMismatchCount(rows: Map<string, FifoValuationRow>, productIds?: Iterable<string>): number {
    let n = 0;
    if (productIds) {
        for (const id of productIds) {
            const r = rows.get(id);
            if (r && r.qty !== r.stock) n++;
        }
        return n;
    }
    for (const r of rows.values()) if (r.qty !== r.stock) n++;
    return n;
}

export async function fetchFifoValuation(): Promise<{ status: Exclude<FifoStatus, 'loading'>; rows: Map<string, FifoValuationRow>; message: string | null }> {
    const { data, error } = await rpcWithSession('fifo_inventory_valuation', {});
    if (error) {
        if (isFifoMissingError(error)) return { status: 'missing', rows: new Map(), message: FIFO_MISSING_MESSAGE };
        return { status: 'error', rows: new Map(), message: `Could not read the FIFO valuation: ${error.message || 'unknown error'}` };
    }
    const rows = new Map<string, FifoValuationRow>();
    for (const r of (Array.isArray(data) ? data : []) as Record<string, unknown>[]) {
        const id = String(r.product_id ?? '');
        if (!id) continue;
        rows.set(id, {
            product_id: id,
            product_name: String(r.product_name ?? ''),
            is_active: r.is_active !== false,
            stock: num(r.stock),
            qty: num(r.qty),
            value: num(r.value),
            avg_cost: numOrNull(r.avg_cost),
            next_cost: numOrNull(r.next_cost),
            last_cost: numOrNull(r.last_cost),
        });
    }
    return { status: 'ready', rows, message: null };
}

// reloadKey: any value that changes when stock may have moved.
export function useFifoValuation(enabled = true, reloadKey?: unknown): FifoValuationState {
    const [state, setState] = useState<Omit<FifoValuationState, 'reload'>>({ status: 'loading', rows: new Map(), message: null });
    const [tick, setTick] = useState(0);
    const reload = useCallback(() => setTick(t => t + 1), []);
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        fetchFifoValuation()
            .then(res => { if (!cancelled) setState(res); })
            .catch(e => { if (!cancelled) setState({ status: 'error', rows: new Map(), message: `Could not read the FIFO valuation: ${errorMessage(e) || 'unknown error'}` }); });
        return () => { cancelled = true; };
    }, [enabled, reloadKey, tick]);
    return { ...state, reload };
}

export interface FifoCheck {
    pool_units: number;
    pool_value: number;
    ledger_1300: number;
    ledger_1300_posted: number;
    inventory_account_found: boolean;
    retail_out_unbooked: number;
    retail_booked_not_out: number;
    retail_booked_out_diff: number;
    expected_1300: number;
    variance: number;
    product_mismatches: number;
    products: { product_id: string; name: string; stock: number; pool_qty: number }[];
    // wholesale_backfill_*: open wholesale lines from before the rebuild, held
    // at their booked WSO COGS (not a shortfall).
    shortfall: {
        retail_lines: number; retail_qty: number; wholesale_lines: number; wholesale_qty: number;
        wholesale_backfill_lines: number; wholesale_backfill_qty: number; wholesale_backfill_cost: number;
    };
}

export async function fetchFifoCheck(): Promise<{ status: Exclude<FifoStatus, 'loading'>; data: FifoCheck | null; message: string | null }> {
    const { data, error } = await rpcWithSession('fifo_inventory_check', {});
    if (error) {
        if (isFifoMissingError(error)) return { status: 'missing', data: null, message: FIFO_MISSING_MESSAGE };
        return { status: 'error', data: null, message: `Could not run the FIFO check: ${error.message || 'unknown error'}` };
    }
    const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const s = (d.shortfall && typeof d.shortfall === 'object' ? d.shortfall : {}) as Record<string, unknown>;
    return {
        status: 'ready',
        message: null,
        data: {
            pool_units: num(d.pool_units),
            pool_value: num(d.pool_value),
            ledger_1300: num(d.ledger_1300),
            ledger_1300_posted: num(d.ledger_1300_posted),
            inventory_account_found: d.inventory_account_found !== false,
            retail_out_unbooked: num(d.retail_out_unbooked),
            retail_booked_not_out: num(d.retail_booked_not_out),
            retail_booked_out_diff: num(d.retail_booked_out_diff),
            expected_1300: num(d.expected_1300),
            variance: num(d.variance),
            product_mismatches: num(d.product_mismatches),
            products: (Array.isArray(d.products) ? d.products : []).map((p: Record<string, unknown>) => ({
                product_id: String(p.product_id ?? ''),
                name: String(p.name ?? p.product_id ?? ''),
                stock: num(p.stock),
                pool_qty: num(p.pool_qty),
            })),
            shortfall: {
                retail_lines: num(s.retail_lines),
                retail_qty: num(s.retail_qty),
                wholesale_lines: num(s.wholesale_lines),
                wholesale_qty: num(s.wholesale_qty),
                wholesale_backfill_lines: num(s.wholesale_backfill_lines),
                wholesale_backfill_qty: num(s.wholesale_backfill_qty),
                wholesale_backfill_cost: num(s.wholesale_backfill_cost),
            },
        },
    };
}

export interface FifoPeek {
    product_id: string;
    qty: number;
    cost: number;
    unit_cost: number | null;
    available: number;
    short_qty: number;
    fallback_cost: number;
}

export type FifoPeekResult = { ok: true; data: FifoPeek } | { ok: false; missing: boolean; message: string };

export async function fetchFifoPeek(productId: string, qty: number): Promise<FifoPeekResult> {
    const { data, error } = await rpcWithSession('fifo_peek', { p_product_id: productId, p_qty: qty });
    if (error) {
        if (isFifoMissingError(error)) return { ok: false, missing: true, message: FIFO_MISSING_MESSAGE };
        return { ok: false, missing: false, message: error.message || 'unknown error' };
    }
    const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
        ok: true,
        data: {
            product_id: String(d.product_id ?? productId),
            qty: num(d.qty),
            cost: num(d.cost),
            unit_cost: numOrNull(d.unit_cost),
            available: num(d.available),
            short_qty: num(d.short_qty),
            fallback_cost: num(d.fallback_cost),
        },
    };
}

// stock_movements.unit_cost does not exist before add_fifo_costing.sql.
export const isMissingColumnError = (e: unknown, column: string): boolean => {
    const code = String((e as { code?: unknown })?.code || '');
    const msg = errorMessage(e);
    return (code === '42703' || code === 'PGRST204' || /does not exist|could not find/i.test(msg)) && msg.includes(column);
};
