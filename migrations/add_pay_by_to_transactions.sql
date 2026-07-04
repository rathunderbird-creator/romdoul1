-- Add pay_by column to transactions table
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS pay_by TEXT;
