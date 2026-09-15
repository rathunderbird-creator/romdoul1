-- Prediction by Page (Income & Expense → Prediction by Page): manual inputs
-- per (day, Facebook page) — ad "boost" spend and an optional shipping
-- override. Everything else on that screen (orders, revenue, COGS, computed
-- shipping, contribution) is derived live from `sales` and deliberately NOT
-- stored here, so nothing in this table can drift from the order data.
--
-- "Could not find the table 'public.page_income_predictions' in the schema
-- cache" on that screen means this file has not been run on that Supabase
-- project; until it is, the page still shows live numbers with the inputs
-- disabled and a banner naming this file.
--
-- Safe to re-run. Run once in the SQL editor of every instance listed in
-- db_instances.json that reports it missing (node migrations/sync_database.cjs).

CREATE TABLE IF NOT EXISTS page_income_predictions (
    date DATE NOT NULL,
    -- Page key exactly as the app groups sales: trimmed page_source, falling
    -- back to customer_snapshot->>'page'. '' is the "(unassigned)" bucket —
    -- the label is a translated display string, never stored.
    page TEXT NOT NULL CHECK (page = btrim(page)),
    boost_page NUMERIC DEFAULT 0,
    -- NULL = use the shipping-rate table (Settings → Shipping); a number
    -- replaces that page's computed shipping total for the day.
    shipping NUMERIC,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    PRIMARY KEY (date, page)
);

-- Match the rest of the app, which runs with RLS disabled.
ALTER TABLE page_income_predictions DISABLE ROW LEVEL SECURITY;

-- Make the API see the new table immediately.
NOTIFY pgrst, 'reload schema';
