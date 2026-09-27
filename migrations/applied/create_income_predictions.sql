-- Income Prediction (Income & Expense → Income Prediction): one frozen row per
-- calendar day, written when the user presses Save on that page.
--
-- The table was created by hand on every instance (column list recorded in
-- sync_database.cjs) and never had a migration file. This one exists so a
-- rebuilt instance can recreate it, and because Prediction by Page reads it
-- for the shared Staff line and the boost reconciliation under its totals.
--
-- Safe to re-run (no-op where the table already exists).

CREATE TABLE IF NOT EXISTS income_predictions (
    date DATE PRIMARY KEY,
    shipped_delivered NUMERIC DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    cogs NUMERIC DEFAULT 0,
    shipping NUMERIC DEFAULT 0,
    boost_page NUMERIC DEFAULT 0,
    staff NUMERIC DEFAULT 0,
    profit NUMERIC DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT
);

-- Match the rest of the app, which runs with RLS disabled.
ALTER TABLE income_predictions DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
