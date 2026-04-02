-- Add base_salary to the users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS base_salary NUMERIC DEFAULT 0;

-- Ensure that anyone with access can update this (assuming RLS is set up, you might need to adjust policies if they are restrictive, but since it's a new column on an existing table, existing UPDATE policies will cover it).
