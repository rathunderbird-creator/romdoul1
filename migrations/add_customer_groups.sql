-- Sales Setup › Customer Groups: the Orders "Customer group" filter.
--
-- A retail customer is its phone: app_config customerGroupMembers maps the
-- phone's DIGITS to a group (src/utils/customerGroups.ts). Orders keep the
-- phone as typed ('012 345 678', '012-345-678'), so the filter compares
-- digits through this computed field (PostgREST: sales?customer_phone_digits=in.(…)).
-- A function, not a column: nothing is stored and the table isn't rewritten.
-- A label only: nothing prices or posts by it.
--
-- Safe to run more than once, on every store. Until it is run, filtering
-- Orders by Customer group says "run add_customer_groups.sql" (showing and
-- tagging groups work without it). Editing groups with manage_orders (not
-- manage_settings) also needs add_session_guards.sql re-run (its
-- customerGroups / customerGroupMembers lines).
CREATE OR REPLACE FUNCTION public.customer_phone_digits(s public.sales)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT regexp_replace(COALESCE(s.customer_snapshot->>'phone', ''), '\D', '', 'g')
$$;

GRANT EXECUTE ON FUNCTION public.customer_phone_digits(public.sales) TO anon, authenticated;

-- Make PostgREST pick the new field up immediately.
NOTIFY pgrst, 'reload schema';
