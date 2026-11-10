-- Supplier Bills: the date a delivery was billed (the supplier's bill date).
-- Run once in each instance's Supabase SQL editor (Romdoul1, Romdoul2, Romdoul3).
-- Until it is run the app hides the Billed Date field and saves bills without it.
--
-- Existing bills are left blank on purpose: their real billed date was never
-- recorded, and guessing one (e.g. the order date) would look like real data.

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS bill_date DATE;

-- Make the API see the new column straight away.
NOTIFY pgrst, 'reload schema';
