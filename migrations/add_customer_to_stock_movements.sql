ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS customer_phone TEXT;
