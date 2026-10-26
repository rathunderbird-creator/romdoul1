-- Stock Adjustments (Inventory → Adjust Stock): multi-line manual stock
-- corrections, opening balances and write-offs. Draft until Posted, the
-- same convention Journal Entries uses — Posting is what actually moves
-- warehouse_stock/products.stock and books a ledger entry, using the 'ADJ'
-- entry-number type code already reserved for this in
-- src/utils/journalEntryNumber.ts.
--
-- "Could not find the table 'public.stock_adjustments' in the schema
-- cache" means this file has not been run on that Supabase project yet.
--
-- Safe to re-run. Run once in the SQL editor of every instance listed in
-- db_instances.json that reports it missing (node migrations/sync_database.cjs).

CREATE TABLE IF NOT EXISTS stock_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id TEXT,
    adjustment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    reason TEXT NOT NULL DEFAULT 'Other',
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'Draft', -- Draft | Posted
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- The product FK is REQUIRED: the app embeds product:products(...) through
-- it, same as purchase_order_items.
CREATE TABLE IF NOT EXISTS stock_adjustment_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    adjustment_id UUID NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    bin TEXT DEFAULT 'Default',
    quantity NUMERIC NOT NULL,
    unit_cost NUMERIC DEFAULT 0,
    batch TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE stock_adjustments DISABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustment_lines DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
