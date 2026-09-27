-- Income Prediction → Staff column: the daily staff cost, auto-saved the
-- moment it is typed.
--
-- It lives in its own table rather than in income_predictions because a row
-- there means "this day is frozen" (Save pressed): writing Staff into it
-- would freeze today's live sales, or a future day at $0 revenue. Here it is
-- just the input, independent of freezing — it survives Save and Unsave.
--
-- Read by Income Prediction (IncomePrediction.tsx) and by Prediction by
-- Page's shared Staff footer. For a day with a row here, this value wins over
-- income_predictions.staff; editing Staff on a frozen day updates both.
--
-- Until this has run on an instance, Income Prediction keeps the old
-- behaviour there (Staff only stored by pressing Save) and shows a banner
-- naming this file.
--
-- Safe to re-run. Run once in the SQL editor of every instance listed in
-- db_instances.json that reports it missing (node migrations/sync_database.cjs).

CREATE TABLE IF NOT EXISTS income_prediction_staff (
    date DATE PRIMARY KEY,
    staff NUMERIC NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT
);

-- Match the rest of the app, which runs with RLS disabled.
ALTER TABLE income_prediction_staff DISABLE ROW LEVEL SECURITY;

-- Make the API see the new table immediately.
NOTIFY pgrst, 'reload schema';
