-- Disable RLS on custom_locations since the app uses an internal user management system instead of Supabase Auth.
ALTER TABLE public.custom_locations DISABLE ROW LEVEL SECURITY;

-- If you prefer keeping RLS enabled but allowing anon access, run these instead:
-- ALTER TABLE public.custom_locations ENABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "Enable insert access for authenticated users" ON public.custom_locations;
-- DROP POLICY IF EXISTS "Enable update access for authenticated users" ON public.custom_locations;
-- DROP POLICY IF EXISTS "Enable delete access for authenticated users" ON public.custom_locations;
-- CREATE POLICY "Enable full access for all users" ON public.custom_locations FOR ALL USING (true) WITH CHECK (true);
