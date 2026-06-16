ALTER TABLE public.custom_locations ADD COLUMN IF NOT EXISTS is_shutdown BOOLEAN DEFAULT false;
