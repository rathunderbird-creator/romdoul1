-- Create staff_attendance table
CREATE TABLE IF NOT EXISTS public.staff_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Present',
    clock_in TIME,
    clock_out TIME,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);

-- Enable RLS
ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;

-- Drop previous policies if they exist (to fix previous error)
DROP POLICY IF EXISTS "Allow read access for all authenticated users" ON public.staff_attendance;
DROP POLICY IF EXISTS "Allow write access for authenticated users" ON public.staff_attendance;

-- Allow read access to anon users (since app uses custom PIN auth, not Supabase auth)
CREATE POLICY "Allow read access for all"
ON public.staff_attendance
FOR SELECT
USING (true);

-- Allow insert/update/delete 
CREATE POLICY "Allow write access for all"
ON public.staff_attendance
FOR ALL
USING (true)
WITH CHECK (true);

-- Enable realtime
alter publication supabase_realtime add table public.staff_attendance;
