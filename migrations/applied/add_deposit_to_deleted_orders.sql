-- Deleted orders must keep their deposit fields: without them, deleting and
-- restoring a deposit order wiped deposit_amount, so a later settle logged the
-- FULL total as income on top of the kept deposit row (double-counted revenue),
-- and the leaving-Paid cleanup matched the wrong amounts.
-- (The app tolerates this migration being missing — it retries the archive
-- without the deposit fields — but restores only keep deposits once it runs.)
ALTER TABLE deleted_orders ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC DEFAULT 0;
ALTER TABLE deleted_orders ADD COLUMN IF NOT EXISTS deposit_date DATE;
ALTER TABLE deleted_orders ADD COLUMN IF NOT EXISTS deposit_method TEXT;

NOTIFY pgrst, 'reload schema';
