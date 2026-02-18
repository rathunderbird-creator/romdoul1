-- Disable RLS on users table to allow public access (since we handle auth in app for this local POS context)
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- Alternatively, if you prefer to keep RLS enabled, add a policy:
-- CREATE POLICY "Enable access to all users" ON users FOR ALL USING (true) WITH CHECK (true);
