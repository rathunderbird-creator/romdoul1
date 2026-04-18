-- Drop old table if exists (safe for fresh setup)
DROP TABLE IF EXISTS stock_movements;

-- Create stock_movements table for tracking Stock-In and Stock-Out
CREATE TABLE stock_movements (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('in', 'out')),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    
    -- Stock-In specific fields
    unit_price NUMERIC DEFAULT 0,           -- purchase/cost price per unit
    source TEXT DEFAULT '',                  -- supplier / where it came from
    
    -- Stock-Out specific fields
    reason TEXT DEFAULT '',                  -- shipped, delivered, damaged, sample, warranty, etc.
    reference_id TEXT DEFAULT '',            -- optional order ID or reference
    
    -- Common fields
    note TEXT DEFAULT '',
    movement_date DATE DEFAULT CURRENT_DATE, -- user-specified date of movement
    created_by TEXT DEFAULT 'unknown',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read
CREATE POLICY "Allow read stock_movements" ON stock_movements
    FOR SELECT USING (true);

-- Allow all authenticated users to insert
CREATE POLICY "Allow insert stock_movements" ON stock_movements
    FOR INSERT WITH CHECK (true);

-- Allow all authenticated users to update
CREATE POLICY "Allow update stock_movements" ON stock_movements
    FOR UPDATE USING (true) WITH CHECK (true);

-- Allow all authenticated users to delete
CREATE POLICY "Allow delete stock_movements" ON stock_movements
    FOR DELETE USING (true);

-- Create indexes for fast filtering
CREATE INDEX idx_stock_movements_type_date ON stock_movements (type, movement_date DESC);
CREATE INDEX idx_stock_movements_product ON stock_movements (product_id);
CREATE INDEX idx_stock_movements_created ON stock_movements (created_at DESC);
