-- Products: "Inactive" — a product the store no longer sells (discontinued,
-- seasonal, replaced) but that still exists: it keeps its stock, its cost
-- history and its name on every past order, and can be made active again.
--
-- Separate from is_active on purpose: is_active = false is the app's
-- soft DELETE (the product disappears everywhere). inactive = true only
-- hides the product from the pickers used to start new sales (POS,
-- new-order form, wholesale orders, quotations, price list); Inventory
-- still lists it (filter "Inactive") with an Inactive badge.
--
-- Safe to run more than once, on every store. Until it is run, the
-- Inventory page loads normally and marking a product inactive says
-- "run add_product_inactive.sql".
ALTER TABLE products ADD COLUMN IF NOT EXISTS inactive BOOLEAN NOT NULL DEFAULT false;

-- Make PostgREST pick the new column up immediately.
NOTIFY pgrst, 'reload schema';
