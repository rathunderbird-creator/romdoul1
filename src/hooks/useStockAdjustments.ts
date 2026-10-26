import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { nextJournalEntryNumber } from '../utils/journalEntryNumber';
import type { StockAdjustment, StockAdjustmentLine, StockAdjustmentReason } from '../types';

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

    // A Draft has made no stock/ledger changes yet, so deleting one is a
    // plain delete (lines cascade). Posted is final — same rule as every
    // other ledger-backed record in this app.
    const deleteAdjustment = useCallback(async (id: string, status: string) => {
        if (status !== 'Draft') throw new Error('Posted adjustments cannot be deleted — make a correcting adjustment instead.');
        const { error } = await supabase.from('stock_adjustments').delete().eq('id', id);
        if (error) throw new Error(errorMessage(error));
        await fetchAdjustments(true);
    }, [fetchAdjustments]);

    // Moves the quantity deltas into warehouse_stock and the product's flat
    // total, logs a stock_movements row per line (so Stock Movements shows
    // these too), books a Dr/Cr journal entry for the net value, and flips
    // status to Posted. Both stock tables are kept in sync here even though
    // elsewhere in the app they can drift — see the ADJ-prefixed reference
    // comment below.
    const postAdjustment = useCallback(async (adjustment: StockAdjustment, createdBy?: string) => {
        if (adjustment.status === 'Posted') return;
        const lines = adjustment.lines || [];
        if (lines.length === 0) throw new Error('This adjustment has no lines.');
        const warehouseId = adjustment.warehouse_id || '';

        for (const line of lines) {
            const qty = Number(line.quantity) || 0;
            if (qty === 0) continue;
            const productId = line.product_id;

            if (warehouseId) {
                const { data: ws } = await supabase.from('warehouse_stock')
                    .select('id, quantity').eq('warehouse_id', warehouseId).eq('product_id', productId).maybeSingle();
                if (ws) {
                    await supabase.from('warehouse_stock').update({ quantity: Math.max(0, (Number(ws.quantity) || 0) + qty) }).eq('id', ws.id);
                } else {
                    await supabase.from('warehouse_stock').insert({ warehouse_id: warehouseId, product_id: productId, quantity: Math.max(0, qty) });
                }
            }

            const { data: prod } = await supabase.from('products').select('stock, name').eq('id', productId).single();
            if (prod) {
                await supabase.from('products').update({ stock: Math.max(0, (Number(prod.stock) || 0) + qty) }).eq('id', productId);
            }

            await supabase.from('stock_movements').insert({
                product_id: productId,
                product_name: prod?.name || line.product?.name || '',
                type: qty > 0 ? 'in' : 'out',
                quantity: Math.abs(qty),
                unit_price: Number(line.unit_cost) || 0,
                source: 'Stock Adjustment',
                reason: adjustment.reason,
                reference_id: 'ADJ-' + adjustment.id,
                note: adjustment.notes || '',
                movement_date: adjustment.adjustment_date,
                created_by: createdBy || null,
                warehouse_id: warehouseId || null,
            });
        }

        await postStockAdjustmentEntry(adjustment, lines, showToast);

        const { error } = await supabase.from('stock_adjustments').update({ status: 'Posted' }).eq('id', adjustment.id);
        if (error) throw new Error(errorMessage(error));
        await fetchAdjustments(true);
    }, [fetchAdjustments, showToast]);

    return { adjustments, isLoading, schemaReady, fetchAdjustments, saveAdjustment, deleteAdjustment, postAdjustment };
}

type ToastFn = (msg: string, kind: 'success' | 'error' | 'info') => void;

// Dr Inventory / Cr Equity when the adjustment nets positive and is
// corrective (Opening balance / Stock correction / Other); Dr Cost of Goods
// Sold / Cr Inventory when it's a real loss (damaged/expired/stolen/given
// away). A corrective adjustment that nets NEGATIVE reverses the same pair
// (Dr Equity / Cr Inventory), and a loss-reason adjustment that nets
// POSITIVE reverses its pair too (Dr Inventory / Cr COGS) — e.g. correcting
// an over-reported write-off. Reference 'ADJ-<id>' so this never double-posts.
async function postStockAdjustmentEntry(
    adjustment: StockAdjustment,
    lines: StockAdjustmentLine[],
    showToast: ToastFn
) {
    try {
        const netValue = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0);
        const amount = Math.round(Math.abs(netValue) * 100) / 100;
        if (amount <= 0) return;

        const { data: existing, error: exErr } = await supabase.from('journal_entries')
            .select('id, status').eq('reference_id', 'ADJ-' + adjustment.id).limit(1).maybeSingle();
        if (exErr) { console.error('Could not check for an existing adjustment entry:', exErr); return; }
        if (existing) return; // Already posted for this adjustment — Posted adjustments never re-post.

        const { data: coa } = await supabase.from('chart_of_accounts')
            .select('id, account_code, account_name, account_type').eq('is_active', true);
        const pool = coa || [];
        const inventoryAcc = pool.find(a => a.account_code === '1300')
            || pool.find(a => a.account_type === 'Asset' && /inventor|stock/i.test(a.account_name));
        const corrective = CORRECTIVE_REASONS.has(adjustment.reason);
        const balancingAcc = corrective
            ? (pool.find(a => a.account_code === '3000') || pool.find(a => a.account_type === 'Equity'))
            : (pool.find(a => a.account_code === '5000') || pool.find(a => a.account_type === 'Expense' && /cost of goods|cogs/i.test(a.account_name)) || pool.find(a => a.account_type === 'Expense'));

        if (!inventoryAcc || !balancingAcc) {
            showToast(`Adjustment posted, but no Inventory or ${corrective ? 'Equity' : 'Expense'} account exists in the Chart of Accounts — no ledger entry was posted.`, 'info');
            return;
        }

        const entryNumber = await nextJournalEntryNumber('ADJ', adjustment.adjustment_date);
        const entryPayload: Record<string, unknown> = {
            date: adjustment.adjustment_date,
            description: `Stock adjustment · ${adjustment.reason}${adjustment.notes ? ' · ' + adjustment.notes : ''}`,
            reference_id: 'ADJ-' + adjustment.id,
            status: 'Draft',
        };
        if (entryNumber) entryPayload.entry_number = entryNumber;

        let entry: { id: string } | null | undefined;
        let jeErr: { message?: string } | null | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
            ({ data: entry, error: jeErr } = await supabase.from('journal_entries').insert([entryPayload]).select().single());
            if (!jeErr) break;
            const msg = jeErr.message || '';
            if (/entry_number/i.test(msg) && 'entry_number' in entryPayload) { delete entryPayload.entry_number; continue; }
            break;
        }
        if (jeErr && /status/i.test(jeErr.message || '')) {
            showToast('Adjustment posted — run migrations/add_entry_status.sql on this instance to also post the ledger entry as a draft.', 'info');
            return;
        }
        if (jeErr || !entry) {
            console.error('Failed to post the adjustment ledger entry:', jeErr);
            showToast('Adjustment posted, but the ledger entry failed to post.', 'error');
            return;
        }

        const netPositive = netValue > 0;
        const debitInventory = netPositive ? amount : 0;
        const creditInventory = netPositive ? 0 : amount;
        const { error: lErr } = await supabase.from('journal_entry_lines').insert([
            { journal_entry_id: entry.id, account_id: inventoryAcc.id, debit: debitInventory, credit: creditInventory },
            { journal_entry_id: entry.id, account_id: balancingAcc.id, debit: creditInventory, credit: debitInventory },
        ]);
        if (lErr) {
            console.error('Failed to post the adjustment ledger entry lines:', lErr);
            await supabase.from('journal_entries').delete().eq('id', entry.id);
            showToast('Adjustment posted, but the ledger entry failed to post.', 'error');
        }
    } catch (e) {
        console.error('Failed to post the adjustment ledger entry:', e);
    }
}
