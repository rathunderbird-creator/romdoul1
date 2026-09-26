// Looks up which retail order — and so which salesman — a set of stock movements
// belongs to. The rules of WHICH movements link to an order live in
// stockMovementSummary.ts (isRetailOut / returnPrefixOf); this file only fetches.
//
// The client is passed in (not imported) so the same code runs in the browser and
// in the read-only verification scripts.
import type { SupabaseClient } from '@supabase/supabase-js';
import { isRetailOut, isReturn, returnSegmentsOf, type MovementRow, type SaleCandidate, type SalesmanLookups } from './stockMovementSummary';

// Measured on the busiest instance (8.8k orders): 150 ids x 4 parallel took 3.2s, 400 x 6 took 0.8s.
const ID_CHUNK = 400;        // ids per .in() — ~7KB of URL, well under the gateway limit
const PREFIX_CHUNK = 50;     // "#prefix" patterns per .or()
const CONCURRENCY = 6;

const chunked = <T,>(items: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
};

// Small worker pool: run fn over items, at most `limit` in flight, results in order.
const pool = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
    const out: R[] = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (true) {
            const i = next++;
            if (i >= items.length) return;
            out[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
};

const trimmed = (s: unknown): string => String(s ?? '').trim();

export async function fetchSalesmanLookups(client: SupabaseClient, movements: MovementRow[]): Promise<SalesmanLookups> {
    const saleIds = Array.from(new Set(movements.filter(isRetailOut).map(m => m.reference_id as string)));
    // EVERY order a return's note names — a bulk restock lists several.
    const prefixes = Array.from(new Set(
        movements.filter(isReturn).flatMap(m => returnSegmentsOf(m.note).map(s => s.prefix))
    ));

    const salesmanBySaleId = new Map<string, string>();
    const returnCandidates = new Map<string, SaleCandidate[]>();

    // 1) Shipped / delivered stock-outs: the order by id.
    await pool(chunked(saleIds, ID_CHUNK), CONCURRENCY, async ids => {
        const { data, error } = await client.from('sales').select('id, salesman').in('id', ids);
        if (error) throw error;
        for (const s of (data || []) as any[]) salesmanBySaleId.set(String(s.id), trimmed(s.salesman));
    });

    // 2) Orders that were deleted keep their salesman in deleted_orders. Best effort:
    //    a failure here only leaves those movements under "(Order unknown)".
    const missing = saleIds.filter(id => !salesmanBySaleId.has(id));
    if (missing.length > 0) {
        try {
            await pool(chunked(missing, ID_CHUNK), CONCURRENCY, async ids => {
                const { data, error } = await client.from('deleted_orders').select('id, salesman').in('id', ids);
                if (error) throw error;
                for (const s of (data || []) as any[]) salesmanBySaleId.set(String(s.id), trimmed(s.salesman));
            });
        } catch (e) {
            console.warn('Stock movement summary: deleted_orders unreadable — deleted orders stay unattributed', e);
        }
    }

    // 3) Customer returns: every order whose id starts with the note's "#prefix".
    await pool(chunked(prefixes, PREFIX_CHUNK), CONCURRENCY, async batch => {
        const { data, error } = await client
            .from('sales')
            .select('id, salesman, customer_snapshot, items:sale_items(product_id, quantity)')
            .or(batch.map(p => `id.like.${p}%`).join(','));
        if (error) throw error;
        for (const s of (data || []) as any[]) {
            const id = String(s.id);
            const candidate: SaleCandidate = {
                id,
                salesman: trimmed(s.salesman),
                phone: String(s.customer_snapshot?.phone ?? ''),
                items: ((s.items || []) as any[]).map(i => ({ productId: String(i.product_id), quantity: Number(i.quantity) || 0 })),
            };
            for (const p of batch) {
                if (!id.startsWith(p)) continue;
                const list = returnCandidates.get(p);
                if (list) list.push(candidate); else returnCandidates.set(p, [candidate]);
            }
        }
    });

    return { salesmanBySaleId, returnCandidates };
}
