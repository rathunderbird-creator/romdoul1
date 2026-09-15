// Fetches the ENTIRE products catalogue — active AND inactive — mirroring
// StoreContext.tsx's own products select and field mapping (around line 353)
// minus its `.filter(p => p.is_active !== false)` step, and paginated with
// fetchAll so a catalogue past PostgREST's ~1000-row cap can't silently drop
// products (the same failure mode this function otherwise exists to avoid).
//
// The app never hard-deletes a product — deleteProduct/deleteProducts
// (StoreContext.tsx) always soft-delete (is_active=false), and
// StoreContext's own `products` state is then filtered to active-only,
// which is the right list for every "picker" use in the app (checkout,
// editing). But a discontinued SKU's historical sales are still real and
// still had a real cost: every "Income Prediction" screen that computes
// this month's COGS from useStore().products would silently zero out
// purchaseCost for any product deactivated before the screen is viewed,
// quietly overstating gross profit/margin/contribution with no indication.
// Screens that need cost/name/category for historical line items should
// fetch this full set for that purpose, while still only *listing* active
// products among any "nothing moved this month" rows (that decision reads
// each product's own `isActive` field, not whether it's in this array).
import { supabase } from '../lib/supabase';
import { fetchAll } from './fetchAll';
import type { Product } from '../types';

const PRODUCTS_SELECT = 'id, name, model, sku, price, purchase_cost, stock, category, low_stock_threshold, image, invoice_number, supplier, created_at, is_active';

const mapProduct = (p: any): Product => ({
    ...p,
    isActive: p.is_active ?? true,
    lowStockThreshold: p.low_stock_threshold || p.lowStockThreshold || 5,
    stock: Number(p.stock),
    price: Number(p.price),
    purchaseCost: Number(p.purchase_cost || 0),
    sku: p.sku || '',
    invoiceNumber: p.invoice_number,
    supplier: p.supplier,
    createdAt: p.created_at,
});

export const fetchAllProducts = async (): Promise<Product[]> => {
    const rows = await fetchAll((from, to) =>
        supabase.from('products').select(PRODUCTS_SELECT).order('id', { ascending: true }).range(from, to)
    );
    return rows.map(mapProduct);
};
