-- Stock Movements: columns the app writes that the base schema never created.
--
-- * warehouse_id — written by wholesale orders (and read by the Stock Movements
--   page's warehouse filter). Without it, the wholesale stock-out insert was
--   rejected wholesale, so nothing appeared in Stock Movements.
-- * supplier — written by addStock() when receiving purchase orders.
--
-- Safe to re-run.
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS warehouse_id TEXT;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS supplier TEXT DEFAULT '';
