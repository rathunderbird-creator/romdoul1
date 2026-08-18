-- Rename the retail sales income category from លក់ឥវ៉ាន់ to លក់រាយ.
-- Run once in the Supabase SQL editor. The app writes លក់រាយ from now on
-- (and still recognizes the old name), but this unifies history so filters,
-- breakdowns, and category lists show a single category.

UPDATE transactions
SET category = 'លក់រាយ'
WHERE category = 'លក់ឥវ៉ាន់';
