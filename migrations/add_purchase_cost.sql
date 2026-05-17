-- Add purchase_cost to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS purchase_cost NUMERIC DEFAULT 0;
