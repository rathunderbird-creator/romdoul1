import { supabase } from '../lib/supabase';

type ReceiveLine = { product_id?: string | null; quantity?: number | null; unit_price?: number | null };

// The note every restock from this PO carries; how a receive (or a retry of one)
// knows what already arrived.
export const poReceiveMarker = (poId: string) => `Received from PO-${poId.substring(0, 8)}`;

// Per product: the units this PO orders (its lines added up — the same product can
// be on several lines, e.g. two cartons at different prices) and how many of them
// have not arrived yet, from the restocks this PO already made.
export async function outstandingReceipt(poId: string, lines: ReceiveLine[]) {
    const ordered = new Map<string, { qty: number; value: number }>();
    for (const line of lines) {
        const qty = Number(line.quantity) || 0;
        if (!line.product_id || qty <= 0) continue;
        const cur = ordered.get(line.product_id) || { qty: 0, value: 0 };
        cur.qty += qty;
        cur.value += qty * (Number(line.unit_price) || 0);
        ordered.set(line.product_id, cur);
    }
    const received = new Map<string, number>();
    if (ordered.size > 0) {
        const { data: done, error } = await supabase.from('restocks')
            .select('product_id, quantity')
            .like('note', `%${poReceiveMarker(poId)}%`)
            .in('product_id', [...ordered.keys()]);
        if (error) throw error;
        for (const r of done || []) {
            if (r.product_id) received.set(r.product_id, (received.get(r.product_id) || 0) + (Number(r.quantity) || 0));
        }
    }
    return [...ordered].map(([productId, { qty, value }]) => ({
        productId,
        missing: Math.max(0, qty - (received.get(productId) || 0)),
        // Lines of one product at different prices: book the average unit cost.
        unitCost: Math.round((value / qty) * 100) / 100,
    }));
}

// Receiving itself is receivePurchaseOrder in StoreContext: one database
// function that adds the goods still outstanding (worked out the same way as
// above), marks the PO Received and books its purchase, in one transaction.
