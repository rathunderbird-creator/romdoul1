-- Create custom_locations table to store manual map coordinates
CREATE TABLE IF NOT EXISTS public.custom_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pcode TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('province', 'district', 'commune', 'village')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Setup RLS
ALTER TABLE public.custom_locations ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read and write (or adjust based on your role logic)
CREATE POLICY "Enable read access for all users" ON public.custom_locations
    FOR SELECT USING (true);

CREATE POLICY "Enable insert access for authenticated users" ON public.custom_locations
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update access for authenticated users" ON public.custom_locations
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete access for authenticated users" ON public.custom_locations
    FOR DELETE USING (auth.role() = 'authenticated');

-- Create an index on pcode for faster lookups
CREATE INDEX IF NOT EXISTS custom_locations_pcode_idx ON public.custom_locations (pcode);
