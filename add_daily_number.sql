-- Add daily_number column to sales table
ALTER TABLE sales ADD COLUMN IF NOT EXISTS daily_number INTEGER;

-- Optional: Create an index for faster lookups by date and daily_number
CREATE INDEX IF NOT EXISTS idx_sales_date_daily_number ON sales (date, daily_number);
