-- Transactions: link a retail payment/deposit row back to the order (sales.id)
-- it came from, plus a snapshot of the customer's phone at the time. Both are
-- nullable and additive — older rows (and any instance that hasn't run this
-- yet) simply have neither. Run this in each instance's Supabase SQL editor.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS order_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS customer_phone TEXT;

-- Make PostgREST pick the new columns up immediately.
NOTIFY pgrst, 'reload schema';
