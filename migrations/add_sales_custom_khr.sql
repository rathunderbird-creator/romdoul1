-- Sales: an optional manual override for the receipt's TOTAL/REMAINING
-- KH(₭) figure (Select Shipping Company popup). NULL means "not overridden"
-- — keep computing it live from the deposit/total and the store's exchange
-- rate, same as before this column existed. Run this in each instance's
-- Supabase SQL editor.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS custom_khr_amount NUMERIC;

-- Make PostgREST pick the new column up immediately.
NOTIFY pgrst, 'reload schema';
