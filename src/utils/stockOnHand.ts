// Pure rule behind Stock on Hand / Valuation (INV-1), unit-tested in
// tests/stock-on-hand.test.mjs.
//
// Rule: `products.stock` is the authoritative company-wide quantity — every
// stock-changing flow maintains it (retail orders, PO receipts, Adjust Stock,
// wholesale). `warehouse_stock` is only written by the flows that know a
// warehouse (posted stock adjustments, wholesale, A/R restocks, stock
// movements), so it goes stale for any product whose other movements diverged
// since. The old report trusted warehouse_stock outright whenever a product
// had any row there, so it showed the OLD quantity and silently ignored every
// later sale and receipt.
//
// The fix: per-warehouse rows show what is genuinely tracked per warehouse,
// and whatever remainder is needed to reach the authoritative company total
// goes in an explicit "Unassigned" row — so the report's totals always equal
// the real company stock and nothing is silently wrong.
export interface TrackedWarehouseQty {
    warehouseId: string;
    warehouseName: string;
    qty: number;
}

export interface StockOnHandLine {
    /** null = the Unassigned remainder (stock not tracked to a warehouse). */
    warehouseId: string | null;
    warehouseName: string;
    qty: number;
}

export function productWarehouseLines(
    totalStock: number,
    tracked: TrackedWarehouseQty[]
): StockOnHandLine[] {
    const lines: StockOnHandLine[] = tracked
        .filter(t => (Number(t.qty) || 0) !== 0)
        .map(t => ({ warehouseId: t.warehouseId, warehouseName: t.warehouseName, qty: Number(t.qty) || 0 }));
    const trackedSum = lines.reduce((s, l) => s + l.qty, 0);
    const remainder = (Number(totalStock) || 0) - trackedSum;
    // Tolerance only against float noise — stock quantities are integers in
    // practice, but warehouse_stock is numeric.
    if (Math.abs(remainder) > 1e-9) {
        lines.push({ warehouseId: null, warehouseName: 'Unassigned', qty: remainder });
    }
    return lines;
}
