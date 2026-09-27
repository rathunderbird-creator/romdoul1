-- "new row violates row-level security policy for table inventory_items"
--
-- inventory_items has RLS enabled but no policy allowing the app (anon key)
-- to write, so Add Stock fails — and the sold/in_stock updates made when
-- orders ship or revert fail silently too. Every other table in this project
-- runs with RLS disabled, so bring this one in line.
--
-- Run once in the Supabase SQL editor.

ALTER TABLE inventory_items DISABLE ROW LEVEL SECURITY;
