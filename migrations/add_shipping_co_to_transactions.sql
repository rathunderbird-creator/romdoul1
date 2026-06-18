-- Migration: Add shipping_co to transactions table
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS shipping_co TEXT;
