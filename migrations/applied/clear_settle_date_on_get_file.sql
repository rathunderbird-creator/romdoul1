-- "Get File" orders showing a Settled/Paid Date.
--
-- The bulk edit used to treat Get File like Paid, stamping settle_date and
-- amount_received = total on orders whose payment had not actually settled.
-- The app no longer does that; this cleans up the rows written before the fix.
-- amount_received falls back to the deposit (kept visible) or zero.
--
-- Run once in the Supabase SQL editor.

UPDATE sales
SET settle_date = NULL,
    amount_received = COALESCE(deposit_amount, 0)
WHERE payment_status = 'Get File'
  AND (settle_date IS NOT NULL OR amount_received <> COALESCE(deposit_amount, 0));
