import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import type { StockAdjustment, StockAdjustmentReason } from '../types';

// Reasons that correct the books rather than record a real-world loss: an
// opening balance, a recount, or something that doesn't fit the others.
// These post against Equity. Everything else (damaged/expired/stolen/given
// away) is a genuine cost and posts against Cost of Goods Sold instead.
const CORRECTIVE_REASONS: ReadonlySet<StockAdjustmentReason> = new Set(['Opening balance', 'Stock correction', 'Other']);

// Missing-table detector for an instance that hasn't run
// migrations/create_stock_adjustments.sql yet — same shape Supabase/PostgREST
// uses for every other "schema cache" miss in this app.
const isMissingTable = (message: string): boolean =>
    /stock_adjustment/i.test(message) && /schema cache|does not exist|relation .* does not exist/i.test(message);

// Supabase/PostgREST errors are plain {code, details, hint, message} objects,
// not Error instances — instanceof Error on one is always false.
const errorMessage = (error: unknown): string => {
    if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
    if (error instanceof Error) return error.message;
    return String(error);
};

export function useStockAdjustments() {
    const { showToast } = useToast();
    const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [schemaReady, setSchemaReady] = useState(true);

    const fetchAdjustments = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('stock_adjustments')
                .select('*, lines:stock_adjustment_lines(*, product:products(*))')
                .order('adjustment_date', { ascending: false })
                .order('created_at', { ascending: false });
            if (error) throw error;
            setSchemaReady(true);
            setAdjustments((data || []) as StockAdjustment[]);
        } catch (error) {
            const message = errorMessage(error);
            if (isMissingTable(message)) {
                setSchemaReady(false);
                setAdjustments([]);
            } else {
                console.error('Failed to fetch stock adjustments:', error);
                showToast('Failed to fetch stock adjustments: ' + message, 'error');
            }
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, [showToast]);

    // Creates a Draft only — no stock or ledger effect until postAdjustment.
    const saveAdjustment = useCallback(async (
        header: { warehouse_id: string; adjustment_date: string; reason: StockAdjustmentReason; notes?: string },
        lines: { product_id: string; bin?: string; quantity: number; unit_cost: number; batch?: string }[],
        createdBy?: string
    ): Promise<string> => {
        const lineProblem = checkLines(lines);
        if (lineProblem) throw new Error(lineProblem);
        const { data: adjustment, error } = await supabase
            .from('stock_adjustments')
            .insert([{ ...header, status: 'Draft', created_by: createdBy || null }])
            .select().single();
        if (error) throw new Error(errorMessage(error));

        const { error: lineErr } = await supabase.from('stock_adjustment_lines').insert(
            lines.map(l => ({ ...l, adjustment_id: adjustment.id }))
        );
        if (lineErr) {
            await supabase.from('stock_adjustments').delete().eq('id', adjustment.id);
            throw new Error(errorMessage(lineErr));
        }
        await fetchAdjustments(true);
        return adjustment.id as string;
    }, [fetchAdjustments]);

    // Rewrites a Draft in place: header fields updated, lines replaced. Runs
    // in the database (save_stock_adjustment) as one transaction that locks
    // the adjustment, so it can't interleave with a post, is refused once the
    // adjustment is Posted, and a bad line leaves the old lines in place.
    const updateAdjustment = useCallback(async (
        id: string,
        header: { warehouse_id: string; adjustment_date: string; reason: StockAdjustmentReason; notes?: string | null },
        lines: { product_id: string; bin?: string; quantity: number; unit_cost: number; batch?: string }[]
    ) => {
        const lineProblem = checkLines(lines);
        if (lineProblem) throw new Error(lineProblem);
        const { error } = await supabase.rpc('save_stock_adjustment', {
            p_id: id,
            p_header: { ...header, notes: header.notes ?? null },
            p_lines: lines,
        });
        if (error) {
            await fetchAdjustments(true);
            throw new Error(rpcMessage(error));
        }
        await fetchAdjustments(true);
    }, [fetchAdjustments]);

    // A Draft has made no stock/ledger changes yet, so deleting one is a
    // plain delete (lines cascade). Posted is final — same rule as every
    // other ledger-backed record in this app. The delete only matches a
    // Draft, so a stale page can't delete one that was just posted.
    const deleteAdjustment = useCallback(async (id: string, status: string) => {
        if (status !== 'Draft') throw new Error('Posted adjustments cannot be deleted — make a correcting adjustment instead.');
        const { data: deleted, error } = await supabase.from('stock_adjustments').delete().eq('id', id).eq('status', 'Draft').select('id');
        if (error) throw new Error(errorMessage(error));
        await fetchAdjustments(true);
        if (!deleted || deleted.length === 0) throw new Error('This adjustment has been posted, so it was not deleted.');
    }, [fetchAdjustments]);

    // Posts a Draft through post_stock_adjustment
    // (migrations/add_stock_adjustment_posting.sql). In one transaction that
    // locks the adjustment it moves products.stock and warehouse_stock, writes
    // the stock movements, books the ledger entry and marks it Posted, so it
    // either all happens or none of it does, and a second Post (another tab
    // or user) waits and is then refused. Removing more than is on hand is
    // refused rather than clamped.
    const postAdjustment = useCallback(async (adjustment: StockAdjustment, createdBy?: string) => {
        if (adjustment.status !== 'Draft') throw new Error('This adjustment has already been posted.');
        const { data, error } = await supabase.rpc('post_stock_adjustment', { p_id: adjustment.id, p_created_by: createdBy || null });
        await fetchAdjustments(true);
        if (error) throw new Error(rpcMessage(error));
        const ledger = (data as { ledger?: string } | null)?.ledger;
        if (ledger === 'no_accounts') {
            const corrective = CORRECTIVE_REASONS.has(adjustment.reason);
            showToast(`Adjustment posted, but no Inventory or ${corrective ? 'Equity' : 'Expense'} account exists in the Chart of Accounts — no ledger entry was posted.`, 'info');
        }
    }, [fetchAdjustments, showToast]);

    return { adjustments, isLoading, schemaReady, fetchAdjustments, saveAdjustment, updateAdjustment, deleteAdjustment, postAdjustment };
}

// The database functions arrive with migrations/add_stock_adjustment_posting.sql;
// until it is run, PostgREST reports the function as missing.
const rpcMessage = (error: unknown): string => {
    const message = errorMessage(error);
    if (/stock_adjustment/i.test(message) && /could not find the function|schema cache|does not exist/i.test(message)) {
        return 'Adjust Stock needs a one-time database update before it can post or edit: run migrations/add_stock_adjustment_posting.sql in this store\'s Supabase SQL editor.';
    }
    return message;
};

// Whole, non-zero quantities (stock_movements.quantity is a whole number), a
// unit cost that isn't negative (a negative cost would flip the ledger
// entry), and each product on one line only. The database checks the same
// rules when saving and posting; this just answers sooner. Returns a message,
// or null when fine.
export function checkLines(lines: { product_id?: string | null; quantity: number; unit_cost: number }[]): string | null {
    const seen = new Set<string>();
    for (const l of lines) {
        if (!l.product_id) return 'Every line needs a product.';
        if (!Number.isFinite(l.quantity) || !Number.isInteger(l.quantity) || l.quantity === 0) return 'Quantities must be whole numbers other than zero.';
        if (!Number.isFinite(l.unit_cost) || l.unit_cost < 0) return 'Unit cost can’t be negative.';
        if (seen.has(l.product_id)) return 'A product is on more than one line. Combine them into one line.';
        seen.add(l.product_id);
    }
    return null;
}
