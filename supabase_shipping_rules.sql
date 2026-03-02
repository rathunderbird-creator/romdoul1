-- Drop table if it exists
DROP TABLE IF EXISTS public.shipping_rules;

-- Create the new shipping_rules table
CREATE TABLE public.shipping_rules (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    pcode TEXT NOT NULL UNIQUE,       -- Code of Province, District, Commune, or Village
    name TEXT NOT NULL,               -- Display name
    is_shippable BOOLEAN DEFAULT true, -- Whether shipping is supported to this location
    shipping_fee NUMERIC DEFAULT 1.50, -- Delivery cost
    estimated_days TEXT DEFAULT '1-2 days', -- ETA
    supported_couriers JSONB DEFAULT '[]'::jsonb, -- Array of couriers
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Note: In this application, RLS is disabled as the POS backend acts as the source of truth
ALTER TABLE public.shipping_rules DISABLE ROW LEVEL SECURITY;

-- (Optional) If RLS was desired for public access later:
-- ALTER TABLE public.shipping_rules ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Enable read access for all users" ON public.shipping_rules FOR SELECT USING (true);
-- CREATE POLICY "Enable full access for all users" ON public.shipping_rules FOR ALL USING (true) WITH CHECK (true);
