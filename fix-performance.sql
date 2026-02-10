-- CRITICAL PERFORMANCE FIX
-- Run this in your Supabase SQL Editor to fix the slow loading issue.

-- 1. Index for foreign key lookups (Fixes the 10s load time)
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);

-- 2. Index for sorting sales by date (Improves ORDER BY performance)
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date DESC);

-- 3. Indexes for common filters
CREATE INDEX IF NOT EXISTS idx_sales_salesman ON sales(salesman);
CREATE INDEX IF NOT EXISTS idx_sales_shipping_status ON sales(shipping_status);
CREATE INDEX IF NOT EXISTS idx_sales_payment_status ON sales(payment_status);

-- Verify indexes are created
SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('sales', 'sale_items');
