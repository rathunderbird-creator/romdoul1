-- Sales: why a retail order ended Returned, Cancelled or ReStock — picked
-- from Sales Setup › Rejection Reasons (app_config rejectionReasons) when
-- the order moves there, or later in the Orders "Reason" column. Free text
-- (an "Other" reason is typed); NULL means no reason was given. It is a
-- label only: no stock, payment or ledger logic reads it.
--
-- Safe to run more than once, on every store. Until it is run, saving a
-- reason (or filtering/sorting by it) says "run add_sales_return_reason.sql".
-- Editing the Sales Setup list with manage_orders (not manage_settings)
-- also needs add_session_guards.sql re-run (its rejectionReasons line).
ALTER TABLE sales ADD COLUMN IF NOT EXISTS return_reason TEXT;
-- A deleted order keeps it (delete_retail_orders in add_order_payment_functions.sql).
ALTER TABLE deleted_orders ADD COLUMN IF NOT EXISTS return_reason TEXT;

-- Make PostgREST pick the new column up immediately.
NOTIFY pgrst, 'reload schema';
