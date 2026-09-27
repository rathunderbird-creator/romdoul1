-- Create inventory_items table to track individual unit costs
CREATE TABLE IF NOT EXISTS inventory_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    cost_of_purchase NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'sold', 'returned')),
    sale_id TEXT REFERENCES sales(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Migrate existing stock
DO $$
DECLARE
    prod RECORD;
    i INTEGER;
BEGIN
    FOR prod IN SELECT id, stock, purchase_cost FROM products WHERE stock > 0 LOOP
        FOR i IN 1..prod.stock LOOP
            INSERT INTO inventory_items (product_id, cost_of_purchase, status)
            VALUES (prod.id, prod.purchase_cost, 'in_stock');
        END LOOP;
    END LOOP;
END $$;
