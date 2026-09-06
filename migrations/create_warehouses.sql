-- Warehouses (Inventory → Warehouses) and per-warehouse stock.
--
-- "Could not find the table 'public.warehouses' in the schema cache" when
-- creating a warehouse means this file has not been run on that Supabase
-- project. Both tables were created by hand on Romdoul1 and never had a
-- migration, so Romdoul2 and Romdoul3 were missing them (checked 2026-09-06).
-- Column layout copied from the live Romdoul1 tables.
--
-- Safe to re-run. Run once in the SQL editor of every instance listed in
-- db_instances.json that reports it missing (node migrations/sync_database.cjs).

CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    address TEXT,
    contact TEXT,
    capacity INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- One row per (warehouse, product). Ids are TEXT with no FK, matching how the
-- rest of the schema (wholesale_orders, warehouse_transfers, stock_movements)
-- stores warehouse and product ids; the app looks rows up by the pair, so the
-- pair is unique.
CREATE TABLE IF NOT EXISTS warehouse_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity NUMERIC DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (warehouse_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_stock_product ON warehouse_stock(product_id);

-- Match the rest of the app, which runs with RLS disabled.
ALTER TABLE warehouses DISABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_stock DISABLE ROW LEVEL SECURITY;

-- Make the API see the new tables immediately.
NOTIFY pgrst, 'reload schema';
